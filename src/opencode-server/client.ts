import { createOpencodeClient } from "@opencode-ai/sdk/client";
import type { Session } from "@opencode-ai/sdk/client";
import { requestUrl } from "obsidian";
import { ErrorHandler, ErrorSeverity } from "../utils/error-handler";
import type {
	OpenCodeServerConfig,
	ConnectionState,
	SessionContext,
	ProgressUpdate,
	ReconnectAttemptInfo,
} from "./types";
import type { SessionListItem, Message } from "../types";

export type OpenCodeClient = ReturnType<typeof createOpencodeClient>;

export interface CommandSummary {
	name: string;
	description?: string;
	template?: string;
	agent?: string;
	model?: string;
}

function createClient(
	baseUrl: string,
	fetchImpl?: typeof fetch,
): OpenCodeClient {
	return createOpencodeClient({
		baseUrl,
		fetch: fetchImpl,
	});
}

/**
 * OpenCode SDK client wrapper for Obsidian integration
 * Provides a clean interface to the official OpenCode SDK client
 */
export class OpenCodeServerClient {
	private sdkClient: OpenCodeClient;
	private errorHandler: ErrorHandler;
	private config: OpenCodeServerConfig;
	private connectionState: ConnectionState = "disconnected";
	private lastConnectionError: Error | null = null;

	// Event callback arrays
	private streamTokenCallbacks: Array<
		(sessionId: string, token: string, done: boolean) => void
	> = [];
	private streamThinkingCallbacks: Array<
		(sessionId: string, content: string) => void
	> = [];
	private errorCallbacks: Array<(error: Error) => void> = [];
	private progressUpdateCallbacks: Array<
		(sessionId: string, progress: ProgressUpdate) => void
	> = [];
	private sessionEndCallbacks: Array<
		(sessionId: string, reason?: string) => void
	> = [];
	private connectionStateCallbacks: Array<
		(state: ConnectionState, info?: { error?: Error | null }) => void
	> = [];
	private reconnectAttemptCallbacks: Array<(info: ReconnectAttemptInfo) => void> =
		[];

	// Session management
	private currentSessionId: string | null = null;
	private sessions: Map<string, Session> = new Map();
	private eventStreamAbort: AbortController | null = null;
	private lastEventId: string | null = null;
	private promptInFlightSessionId: string | null = null;
	private commandListCache:
		| { commands: CommandSummary[]; fetchedAt: number }
		| null = null;
	private featureCache:
		| { features: Set<string>; fetchedAt: number }
		| null = null;

	constructor(config: OpenCodeServerConfig, errorHandler: ErrorHandler) {
		const normalizedUrl = this.normalizeServerUrl(config.url);
		this.config = {
			...config,
			url: normalizedUrl,
			requestTimeoutMs: config.requestTimeoutMs ?? 10000,
		};
		this.errorHandler = errorHandler;

		// Initialize SDK client with custom Obsidian fetch
		this.sdkClient = createClient(
			normalizedUrl,
			this.createObsidianFetch(),
		);
	}

	/**
	 * Create custom fetch implementation using Obsidian's requestUrl API
	 */
	private createObsidianFetch(): typeof fetch {
		return async (url: RequestInfo | URL, init?: RequestInit) => {
			const {
				resolvedUrl,
				method,
				headers,
				contentType,
				body,
				bodyLength,
			} = await this.buildRequestOptions(url, init);
			try {
			// Use longer timeout for message endpoints as they may take longer to process
			const baseTimeoutMs = this.config.requestTimeoutMs ?? 10000;
			const isMessageEndpoint = resolvedUrl.includes('/message');
			const isPromptEndpoint = resolvedUrl.includes('/prompt');
			// Message and prompt endpoints may take longer (45+ seconds observed), use 60s minimum
			const timeoutMs = (isMessageEndpoint || isPromptEndpoint) ? Math.max(baseTimeoutMs, 60000) : baseTimeoutMs;
				let timeoutId: ReturnType<typeof setTimeout> | null = null;
				
				// Wrap requestUrl in a try-catch to handle JSON parsing errors
				// requestUrl may attempt to parse JSON based on response Content-Type,
				// even if we set contentType parameter (which only affects request headers)
				let response: Awaited<ReturnType<typeof requestUrl>>;
				
				try {
					const request = requestUrl({
						url: resolvedUrl,
						method,
						headers,
						contentType,
						body,
					});
					
					try {
						response = (timeoutMs > 0
							? await Promise.race([
									request.then((res) => {
										return res;
									}),
									new Promise<never>((_, reject) => {
										timeoutId = setTimeout(() => {
											reject(
												new Error(
													`HTTP request timed out after ${timeoutMs}ms`,
												),
											);
										}, timeoutMs);
									}),
								])
							: await request) as Awaited<ReturnType<typeof requestUrl>>;
					} catch (parseError) {
						// If requestUrl throws a JSON parse error (e.g., HTML response),
						// this is expected for some endpoints (like /health) that return HTML
						// Re-throw to be handled by outer catch block
						throw parseError;
					}
					
				} finally {
					if (timeoutId) {
						clearTimeout(timeoutId);
					}
				}

				// Convert Obsidian response to standard Response object
				// Safely handle response body - use text if available, otherwise try to stringify json
				// If json parsing failed (e.g., HTML response), response.json may be undefined or invalid
				let responseBody: string;
				if (response.text) {
					responseBody = response.text;
				} else if (response.json !== undefined && response.json !== null) {
					try {
						responseBody = JSON.stringify(response.json);
					} catch (jsonError) {
						// If JSON.stringify fails, use empty string or fallback
						responseBody = "";
					}
				} else {
					responseBody = "";
				}
				return new Response(
					responseBody,
					{
						status: response.status,
						statusText: response.status.toString(),
						headers: new Headers(response.headers || {}),
					},
				);
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : "Unknown error";
				const isTimeout = errorMessage.includes("timed out");
				const isJsonParseError = errorMessage.includes("not valid JSON") || 
				                        errorMessage.includes("Unexpected token");
				
				// For JSON parse errors (e.g., HTML responses from /health endpoint),
				// don't log as error - this is expected for some endpoints
				// The caller (e.g., healthCheck) should handle this appropriately
				if (isJsonParseError) {
					// Re-throw without logging - let the caller handle it
					throw error;
				}
				
				// Provide more helpful error message for timeouts
				if (isTimeout) {
					// Use the configured base URL directly (already stored in config)
					const baseUrl = this.config.url;
					const enhancedError = new Error(
						`Unable to connect to OpenCode Server at ${baseUrl}. ` +
						`Please ensure the server is running and accessible.`,
					);
					
					// Store original error for debugging (if cause is supported)
					try {
						(enhancedError as Error & { cause?: unknown }).cause = error;
					} catch {
						// Ignore if cause property is not supported
					}
					
					// Don't add operation prefix for enhanced errors - they're already user-friendly
					this.errorHandler.handleError(
						enhancedError,
						{
							module: "OpenCodeClient",
							function: "createObsidianFetch",
							// Intentionally omit operation to avoid prefixing the user-friendly error message
							metadata: { 
								url: resolvedUrl, 
								method,
								suggestedFix: "Check if OpenCode Server is running at " + baseUrl,
							},
						},
						ErrorSeverity.Error,
					);
					
					throw enhancedError;
				}
				
				this.errorHandler.handleError(
					error,
					{
						module: "OpenCodeClient",
						function: "createObsidianFetch",
						operation: "HTTP request",
						metadata: { url: resolvedUrl, method },
					},
					ErrorSeverity.Error,
				);
				throw error;
			}
		};
	}

	private async buildRequestOptions(
		url: RequestInfo | URL,
		init?: RequestInit,
	): Promise<{
		resolvedUrl: string;
		method: string;
		headers: Record<string, string>;
		contentType?: string;
		bodyLength: number | null;
		body?: string;
	}> {
		const resolvedUrl = this.resolveRequestUrl(url);
		let method = init?.method || "GET";
		let headers = new Headers(init?.headers ?? {});
		let body = init?.body ? String(init.body) : undefined;

		if (typeof Request !== "undefined" && url instanceof Request) {
			method = init?.method ?? url.method ?? method;
			headers = new Headers(url.headers);
			if (init?.headers) {
				const overrideHeaders = new Headers(init.headers);
				overrideHeaders.forEach((value, key) => {
					headers.set(key, value);
				});
			}
			if (init?.body !== undefined) {
				body = String(init.body);
			} else if (url.body && !url.bodyUsed && method !== "GET" && method !== "HEAD") {
				body = await url.clone().text();
			}
		}

		const headerObject: Record<string, string> = {};
		headers.forEach((value, key) => {
			headerObject[key] = value;
		});
		const contentType =
			headers.get("content-type") ?? headers.get("Content-Type") ?? undefined;

		return {
			resolvedUrl,
			method,
			headers: headerObject,
			contentType,
			bodyLength: body ? body.length : null,
			body,
		};
	}

	private resolveRequestUrl(url: RequestInfo | URL): string {
		if (url instanceof URL) {
			return url.toString();
		}
		if (typeof Request !== "undefined" && url instanceof Request) {
			return url.url;
		}
		if (typeof url !== "string") {
			const requestUrl = (url as { url?: unknown }).url;
			if (requestUrl instanceof URL) {
				return requestUrl.toString();
			}
			if (typeof requestUrl === "string") {
				return this.resolveRequestUrl(requestUrl);
			}
			throw new Error("OpenCode Server request URL is invalid.");
		}
		const trimmed = url.trim();
		if (!trimmed) {
			throw new Error("OpenCode Server request URL is empty.");
		}
		const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
		if (hasScheme) {
			return trimmed;
		}
		return new URL(trimmed, `${this.config.url}/`).toString();
	}

	private normalizeServerUrl(url: string): string {
		const trimmed = url.trim();
		if (!trimmed) {
			throw new Error(
				"OpenCode Server URL is empty. Please set it in settings.",
			);
		}

		const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
		const candidate = hasScheme ? trimmed : `http://${trimmed}`;
		let parsed: URL;

		try {
			parsed = new URL(candidate);
		} catch {
			throw new Error(
				"OpenCode Server URL is invalid. Use http:// or https:// (e.g., http://127.0.0.1:4096).",
			);
		}

		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new Error(
				"OpenCode Server URL must use http:// or https://.",
			);
		}

		return candidate.replace(/\/+$/, "");
	}

	/**
	 * Extract session ID from SDK session object
	 * SDK returns may have id in different locations (session.info.id, session.id, etc.)
	 */
	private extractSessionId(session: Session | any): string | null {
		const sessionInfo = (session as { info?: Session }).info ?? session;
		return (
			(sessionInfo as { id?: string; sessionID?: string; sessionId?: string })
				.id ||
			(sessionInfo as { sessionID?: string; sessionId?: string }).sessionID ||
			(sessionInfo as { sessionId?: string }).sessionId ||
			null
		);
	}

	/**
	 * Extract session ID from SDK event object
	 * Events may have sessionId in different locations
	 */
	private extractSessionIdFromEvent(event: any): string | null {
		return (
			event.properties?.part?.sessionID ||
			event.properties?.part?.sessionId ||
			event.properties?.sessionID ||
			event.properties?.sessionId ||
			event.sessionId ||
			event.sessionID ||
			event.id ||
			null
		);
	}

	/**
	 * Check if error is already enhanced with connection details
	 */
	private isEnhancedError(error: Error): boolean {
		const errorMessage = error.message || "";
		return errorMessage.includes("Unable to connect to OpenCode Server");
	}

	/**
	 * Extract HTTP status code from error if available
	 */
	private getErrorStatusCode(error: any): number | null {
		// Check various possible locations for status code
		if (typeof error?.status === "number") {
			return error.status;
		}
		if (typeof error?.statusCode === "number") {
			return error.statusCode;
		}
		if (typeof error?.response?.status === "number") {
			return error.response.status;
		}
		// Try to parse from error message
		const match = error?.message?.match(/\b(404|500)\b/);
		if (match) {
			return parseInt(match[1], 10);
		}
		return null;
	}

	/**
	 * Create appropriate error for HTTP status codes
	 */
	private createHttpError(statusCode: number, operation: string, sessionId?: string): Error {
		switch (statusCode) {
			case 404:
				return new Error(
					sessionId
						? `Session ${sessionId} not found`
						: `Resource not found during ${operation}`,
				);
			case 500:
				return new Error(`Server error during ${operation}. Please try again later.`);
			default:
				return new Error(`HTTP ${statusCode} error during ${operation}`);
		}
	}

	/**
	 * Subscribe to connection state changes.
	 */
	onConnectionStateChange(
		callback: (state: ConnectionState, info?: { error?: Error | null }) => void,
	): void {
		this.connectionStateCallbacks.push(callback);
	}

	/**
	 * Subscribe to reconnect attempt info (next delay, attempt count).
	 */
	onReconnectAttempt(callback: (info: ReconnectAttemptInfo) => void): void {
		this.reconnectAttemptCallbacks.push(callback);
	}

	getLastConnectionError(): Error | null {
		return this.lastConnectionError;
	}

	private setConnectionState(
		state: ConnectionState,
		info?: { error?: Error | null },
	): void {
		if (state === this.connectionState) {
			return;
		}
		this.connectionState = state;
		if (info && "error" in info) {
			this.lastConnectionError = info.error ?? null;
		}
		for (const callback of this.connectionStateCallbacks) {
			try {
				callback(state, { error: this.lastConnectionError });
			} catch (error) {
				this.errorHandler.handleError(
					error,
					{
						module: "OpenCodeClient",
						function: "setConnectionState",
						operation: "Notifying connection state listeners",
						metadata: { state },
					},
					ErrorSeverity.Warning,
				);
			}
		}
	}

	/**
	 * Get current connection state
	 */
	getConnectionState(): ConnectionState {
		return this.connectionState;
	}

	/**
	 * Get current server configuration
	 */
	getConfig(): OpenCodeServerConfig {
		return { ...this.config };
	}

	/**
	 * Check if client is connected
	 */
	isConnected(): boolean {
		return this.connectionState === "connected";
	}

	/**
	 * Get current session ID
	 */
	getCurrentSessionId(): string | null {
		return this.currentSessionId;
	}

	/**
	 * Ensure session exists locally or on server.
	 */
	async ensureSession(sessionId: string): Promise<boolean> {
		if (this.sessions.has(sessionId)) {
			return true;
		}

		try {
			const response = await this.sdkClient.session.get({
				path: { id: sessionId },
			});
			if (response.error || !response.data) {
				return false;
			}
			this.sessions.set(sessionId, response.data);
			return true;
		} catch (error) {
			this.errorHandler.handleError(
				error,
				{
					module: "OpenCodeClient",
					function: "ensureSession",
					operation: "Ensuring session",
					metadata: { sessionId },
				},
				ErrorSeverity.Warning,
			);
			return false;
		}
	}

	// Event callback registration methods
	onStreamToken(
		callback: (sessionId: string, token: string, done: boolean) => void,
	): void {
		this.streamTokenCallbacks.push(callback);
	}

	onStreamThinking(
		callback: (sessionId: string, content: string) => void,
	): void {
		this.streamThinkingCallbacks.push(callback);
	}

	onError(callback: (error: Error) => void): void {
		this.errorCallbacks.push(callback);
	}

	onProgressUpdate(
		callback: (sessionId: string, progress: ProgressUpdate) => void,
	): void {
		this.progressUpdateCallbacks.push(callback);
	}

	onSessionEnd(callback: (sessionId: string, reason?: string) => void): void {
		this.sessionEndCallbacks.push(callback);
	}

	/**
	 * Connect to OpenCode Server and set up event subscriptions
	 */
	async connect(): Promise<void> {
		if (
			this.connectionState === "connected" ||
			this.connectionState === "connecting"
		) {
			return;
		}

		this.lastConnectionError = null;
		this.setConnectionState("connecting", { error: null });

		// Subscribe to SDK client events without blocking the caller.
		this.startEventLoop();
	}

	/**
	 * Disconnect from OpenCode Server
	 */
	async disconnect(): Promise<void> {
		this.eventStreamAbort?.abort();
		this.eventStreamAbort = null;
		this.setConnectionState("disconnected", { error: null });
		this.currentSessionId = null;
		this.promptInFlightSessionId = null;
		this.sessions.clear();
		console.debug("[OpenCodeClient] Disconnected from OpenCode Server");
	}

	/**
	 * Create a new session
	 */
	async createSession(title?: string): Promise<string> {
		if (this.promptInFlightSessionId) {
			throw new Error(
				"Another session operation is already in progress. Only one session can run at a time.",
			);
		}
		try {
			const response = await this.sdkClient.session.create({
				body: {
					title: title || `Session ${new Date().toISOString()}`,
				},
			});

			if (response.error) {
				throw new Error(`Failed to create session: ${response.error}`);
			}

			if (!response.data) {
				throw new Error(
					"OpenCode Server session.create returned no data.",
				);
			}

			const session = response.data;
			const sessionInfo = (session as { info?: Session }).info ?? session;
			const sessionId = this.extractSessionId(sessionInfo);
			if (!sessionId) {
				throw new Error(
					"OpenCode Server session response did not include an id.",
				);
			}
			this.sessions.set(sessionId, sessionInfo);
			this.currentSessionId = sessionId;

			return sessionId;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			const severity = this.isEnhancedError(err)
				? ErrorSeverity.Warning
				: ErrorSeverity.Error;
			this.errorHandler.handleError(
				err,
				{
					module: "OpenCodeClient",
					function: "createSession",
					operation: "Creating session",
					metadata: {
						title,
						...(severity === ErrorSeverity.Error
							? { serverUrl: this.config.url }
							: {}),
					},
				},
				severity,
			);
			throw err;
		}
	}

	/**
	 * Start a session with context (legacy compatibility method)
	 */
	async startSession(
		context?: SessionContext,
		agent?: string,
		instructions?: string[],
	): Promise<string> {
		if (this.promptInFlightSessionId) {
			throw new Error(
				"A session is already active. Only one session can run at a time.",
			);
		}
		try {
			// Create session with context information in title
			const contextInfo = context
				? ` (${context.currentNote || "Unknown note"})`
				: "";
			const title = `Session${contextInfo}`;

			const sessionId = await this.createSession(title);

			// If we have context or instructions, send them as initial system message
			if (context || instructions?.length || agent) {
				const systemMessage = this.buildSystemMessage(
					context,
					agent,
					instructions,
				);
				if (systemMessage) {
					await this.sendMessage(sessionId, systemMessage);
				}
			}

			return sessionId;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			const severity = this.isEnhancedError(err)
				? ErrorSeverity.Warning
				: ErrorSeverity.Error;
			this.errorHandler.handleError(
				err,
				{
					module: "OpenCodeClient",
					function: "startSession",
					operation: "Starting session with context",
					metadata: { context, agent, instructions },
				},
				severity,
			);
			throw err;
		}
	}

	/**
	 * Send a message to a session
	 */
	async sendMessage(sessionId: string, content: string): Promise<void> {
		if (
			this.promptInFlightSessionId &&
			this.promptInFlightSessionId !== sessionId
		) {
			throw new Error(
				"A different session is already running. Only one session can run at a time.",
			);
		}
		if (this.promptInFlightSessionId === sessionId) {
			throw new Error(
				"A message is already in progress for this session. Please wait for it to finish.",
			);
		}
		try {
			let session = this.sessions.get(sessionId);
			if (!session) {
				const response = await this.sdkClient.session.get({
					path: { id: sessionId },
				});
				if (response.error || !response.data) {
					throw new Error(`Session ${sessionId} not found`);
				}
				session = response.data;
				this.sessions.set(sessionId, session);
			}

			this.promptInFlightSessionId = sessionId;

			// session.prompt is a streaming operation - the HTTP request may not return immediately
			// Results are delivered via SSE event stream, so we use Promise.race with a timeout
			// to handle cases where the request doesn't resolve quickly
			const promptPromise = this.sdkClient.session.prompt({
				path: { id: sessionId },
				body: {
					parts: [{ type: "text", text: content }],
				},
			});
			
			// Use a timeout to handle streaming responses that may not resolve immediately
			// If we receive events via SSE, the request is successful even if the Promise doesn't resolve
			const timeoutPromise = new Promise<{ error?: string; data?: any }>((resolve) => {
				setTimeout(() => {
					// For streaming operations, timeout doesn't mean failure
					// If events are received via SSE, the request is successful
					resolve({ data: {} });
				}, 5000); // 5 second timeout for initial response
			});
			
			const response = await Promise.race([promptPromise, timeoutPromise]);
			
			// Continue waiting for promptPromise in the background to catch any errors
			// but don't block the function from returning
			promptPromise.catch((error) => {
				// Log error but don't throw - streaming operations may fail after timeout
				this.errorHandler.handleError(
					error instanceof Error ? error : new Error(String(error)),
					{
						module: "OpenCodeClient",
						function: "sendMessage",
						operation: "Background prompt error",
						metadata: { sessionId },
					},
					ErrorSeverity.Warning,
				);
			});
			if (response.error) {
				throw new Error(`Failed to send message: ${response.error}`);
			}
		} catch (error) {
			if (this.promptInFlightSessionId === sessionId) {
				this.promptInFlightSessionId = null;
			}
			this.errorHandler.handleError(
				error,
				{
					module: "OpenCodeClient",
					function: "sendMessage",
					operation: "Sending message",
					metadata: { sessionId, contentLength: content.length },
				},
				ErrorSeverity.Error,
			);
			throw error;
		}
	}

	/**
	 * Send a session message (legacy compatibility method)
	 */
	async sendSessionMessage(
		sessionId: string,
		content: string,
		images?: any[],
	): Promise<void> {
		try {
			// For now, ignore images as SDK client may handle them differently
			// TODO: Implement image support when SDK client supports it
			if (images?.length) {
				this.errorHandler.handleError(
					new Error("Image attachments not yet supported in SDK client"),
					{
						module: "OpenCodeClient",
						function: "sendSessionMessage",
						operation: "Sending session message with images",
						metadata: { imageCount: images.length },
					},
					ErrorSeverity.Warning,
				);
			}

			await this.sendMessage(sessionId, content);
		} catch (error) {
			this.errorHandler.handleError(
				error,
				{
					module: "OpenCodeClient",
					function: "sendSessionMessage",
					operation: "Sending session message",
					metadata: {
						sessionId,
						contentLength: content.length,
						imageCount: images?.length,
					},
				},
				ErrorSeverity.Error,
			);
			throw error;
		}
	}

	/**
	 * Send a command to a session.
	 */
	async sendSessionCommand(
		sessionId: string,
		command: string,
		argumentsText: string,
		agent?: string,
	): Promise<string | null> {
		if (
			this.promptInFlightSessionId &&
			this.promptInFlightSessionId !== sessionId
		) {
			throw new Error(
				"A different session is already running. Only one session can run at a time.",
			);
		}
		if (this.promptInFlightSessionId === sessionId) {
			throw new Error(
				"A command is already in progress for this session. Please wait for it to finish.",
			);
		}
		try {
			this.promptInFlightSessionId = sessionId;
			const response = await this.sdkClient.session.command({
				path: { id: sessionId },
				body: {
					command,
					arguments: argumentsText,
					...(agent ? { agent } : {}),
				},
			});

			if (response.error) {
				throw new Error(`Failed to send command: ${response.error}`);
			}

			const parts = (response.data as { parts?: Array<{ type?: string; text?: string }> })
				?.parts;
			if (!parts || parts.length === 0) {
				return null;
			}

			const text = parts
				.filter((part) => part.type === "text" && part.text)
				.map((part) => part.text)
				.join("");
			return text || null;
		} catch (error) {
			this.errorHandler.handleError(
				error,
				{
					module: "OpenCodeClient",
					function: "sendSessionCommand",
					operation: "Sending session command",
					metadata: { sessionId, command },
				},
				ErrorSeverity.Error,
			);
			throw error;
		} finally {
			if (this.promptInFlightSessionId === sessionId) {
				this.promptInFlightSessionId = null;
			}
		}
	}

	/**
	 * List available server commands (cached).
	 */
	async listCommands(force: boolean = false): Promise<CommandSummary[]> {
		const cacheTtlMs = 5 * 60 * 1000;
		const now = Date.now();
		if (
			!force &&
			this.commandListCache &&
			now - this.commandListCache.fetchedAt < cacheTtlMs
		) {
			return this.commandListCache.commands;
		}

		try {
			const response = await this.sdkClient.command.list();
			if (response.error || !response.data) {
				throw new Error(
					`Failed to load commands: ${response.error ?? "Unknown error"}`,
				);
			}

			const commands = response.data.map((command) => ({
				name: command.name,
				description: command.description,
				template: command.template,
				agent: command.agent,
				model: command.model,
			}));
			this.commandListCache = { commands, fetchedAt: now };
			return commands;
		} catch (error) {
			this.errorHandler.handleError(
				error,
				{
					module: "OpenCodeClient",
					function: "listCommands",
					operation: "Listing commands",
				},
				ErrorSeverity.Warning,
			);
			return [];
		}
	}

	/**
	 * Abort a session
	 */
	async abortSession(sessionId: string): Promise<void> {
		try {
			const session = this.sessions.get(sessionId);
			if (!session) {
				this.errorHandler.handleError(
					new Error(`Session ${sessionId} not found for abort`),
					{
						module: "OpenCodeClient",
						function: "abortSession",
						operation: "Aborting session",
						metadata: { sessionId },
					},
					ErrorSeverity.Warning,
				);
				return;
			}

			// Abort the session
			const response = await this.sdkClient.session.abort({
				path: { id: sessionId },
			});

			if (response.error) {
				this.errorHandler.handleError(
					new Error(`Failed to abort session: ${response.error}`),
					{
						module: "OpenCodeClient",
						function: "abortSession",
						operation: "Aborting session",
						metadata: { sessionId, error: response.error },
					},
					ErrorSeverity.Warning,
				);
			}

			// Clean up local state
			this.sessions.delete(sessionId);
			if (this.currentSessionId === sessionId) {
				this.currentSessionId = null;
			}
			if (this.promptInFlightSessionId === sessionId) {
				this.promptInFlightSessionId = null;
			}
		} catch (error) {
			this.errorHandler.handleError(
				error,
				{
					module: "OpenCodeClient",
					function: "abortSession",
					operation: "Aborting session",
					metadata: { sessionId },
				},
				ErrorSeverity.Error,
			);
			throw error;
		}
	}

	/**
	 * List all sessions from the server
	 */
	async listSessions(): Promise<SessionListItem[]> {
		try {
			const response = await this.sdkClient.session.list();

			if (response.error) {
				throw new Error(`Failed to list sessions: ${response.error}`);
			}

			if (!response.data) {
				throw new Error("OpenCode Server session.list returned no data.");
			}

			// Transform SDK Session objects to SessionListItem format
			const sessions: SessionListItem[] = response.data.map((session) => ({
				id: session.id,
				title: session.title || `Session ${session.id}`,
				lastUpdated: session.time.updated,
				messageCount: 0, // Will be populated by getSessionMessages if needed
				isActive: session.id === this.currentSessionId,
			}));

			return sessions;
		} catch (error) {
			const statusCode = this.getErrorStatusCode(error);
			let err: Error;

			if (statusCode === 404 || statusCode === 500) {
				err = this.createHttpError(statusCode, "listing sessions");
			} else {
				err = error instanceof Error ? error : new Error(String(error));
			}

			const severity = this.isEnhancedError(err)
				? ErrorSeverity.Warning
				: ErrorSeverity.Error;
			this.errorHandler.handleError(
				err,
				{
					module: "OpenCodeClient",
					function: "listSessions",
					operation: "Listing sessions",
					metadata: { statusCode },
				},
				severity,
			);
			throw err;
		}
	}

	/**
	 * Get messages for a specific session
	 */
	async getSessionMessages(sessionId: string): Promise<Message[]> {
		try {
			const response = await this.sdkClient.session.messages({
				path: { id: sessionId },
			});

			if (response.error) {
				throw new Error(`Failed to get session messages: ${response.error}`);
			}

			if (!response.data) {
				throw new Error("OpenCode Server session.messages returned no data.");
			}

			// Transform SDK message format to our Message format
			const messages: Message[] = response.data.map((msg) => {
				// Extract text content from parts
				const textParts = msg.parts
					.filter((part: any) => part.type === "text" && part.text)
					.map((part: any) => part.text);
				const content = textParts.join("\n");

				return {
					id: msg.info.id,
					role: msg.info.role as "user" | "assistant",
					content,
					timestamp: msg.info.time.created,
				};
			});

			return messages;
		} catch (error) {
			const statusCode = this.getErrorStatusCode(error);
			let err: Error;

			if (statusCode === 404 || statusCode === 500) {
				err = this.createHttpError(statusCode, "getting session messages", sessionId);
			} else {
				err = error instanceof Error ? error : new Error(String(error));
			}

			const severity = this.isEnhancedError(err)
				? ErrorSeverity.Warning
				: ErrorSeverity.Error;
			this.errorHandler.handleError(
				err,
				{
					module: "OpenCodeClient",
					function: "getSessionMessages",
					operation: "Getting session messages",
					metadata: { sessionId, statusCode },
				},
				severity,
			);
			throw err;
		}
	}

	/**
	 * Update session title
	 */
	async updateSessionTitle(sessionId: string, title: string): Promise<void> {
		try {
			const response = await this.sdkClient.session.update({
				path: { id: sessionId },
				body: { title },
			});

			if (response.error) {
				throw new Error(`Failed to update session title: ${response.error}`);
			}

			// Update local session cache if it exists
			const session = this.sessions.get(sessionId);
			if (session) {
				(session as any).title = title;
			}
		} catch (error) {
			const statusCode = this.getErrorStatusCode(error);
			let err: Error;

			if (statusCode === 404 || statusCode === 500) {
				err = this.createHttpError(statusCode, "updating session title", sessionId);
			} else {
				err = error instanceof Error ? error : new Error(String(error));
			}

			const severity = this.isEnhancedError(err)
				? ErrorSeverity.Warning
				: ErrorSeverity.Error;
			this.errorHandler.handleError(
				err,
				{
					module: "OpenCodeClient",
					function: "updateSessionTitle",
					operation: "Updating session title",
					metadata: { sessionId, title, statusCode },
				},
				severity,
			);
			throw err;
		}
	}

	/**
	 * Delete a session from the server
	 */
	async deleteSession(sessionId: string): Promise<void> {
		try {
			const response = await this.sdkClient.session.delete({
				path: { id: sessionId },
			});

			if (response.error) {
				throw new Error(`Failed to delete session: ${response.error}`);
			}

			// Clean up local state
			this.sessions.delete(sessionId);
			if (this.currentSessionId === sessionId) {
				this.currentSessionId = null;
			}
			if (this.promptInFlightSessionId === sessionId) {
				this.promptInFlightSessionId = null;
			}
		} catch (error) {
			const statusCode = this.getErrorStatusCode(error);
			let err: Error;

			if (statusCode === 404 || statusCode === 500) {
				err = this.createHttpError(statusCode, "deleting session", sessionId);
				// For 404 errors during delete, clean up local state anyway
				if (statusCode === 404) {
					this.sessions.delete(sessionId);
					if (this.currentSessionId === sessionId) {
						this.currentSessionId = null;
					}
					if (this.promptInFlightSessionId === sessionId) {
						this.promptInFlightSessionId = null;
					}
				}
			} else {
				err = error instanceof Error ? error : new Error(String(error));
			}

			const severity = this.isEnhancedError(err)
				? ErrorSeverity.Warning
				: ErrorSeverity.Error;
			this.errorHandler.handleError(
				err,
				{
					module: "OpenCodeClient",
					function: "deleteSession",
					operation: "Deleting session",
					metadata: { sessionId, statusCode },
				},
				severity,
			);
			throw err;
		}
	}

	/**
	 * Revert a session to a specific message
	 * Messages after the specified message will be hidden
	 */
	async revertSession(sessionId: string, messageId: string): Promise<void> {
		try {
			const response = await this.sdkClient.session.revert({
				path: { id: sessionId },
				body: { messageID: messageId },
			});

			if (response.error) {
				throw new Error(`Failed to revert session: ${response.error}`);
			}
		} catch (error) {
			const statusCode = this.getErrorStatusCode(error);
			let err: Error;

			if (statusCode === 404 || statusCode === 500) {
				err = this.createHttpError(statusCode, "reverting session", sessionId);
			} else {
				err = error instanceof Error ? error : new Error(String(error));
			}

			const severity = this.isEnhancedError(err)
				? ErrorSeverity.Warning
				: ErrorSeverity.Error;
			this.errorHandler.handleError(
				err,
				{
					module: "OpenCodeClient",
					function: "revertSession",
					operation: "Reverting session",
					metadata: { sessionId, messageId, statusCode },
				},
				severity,
			);
			throw err;
		}
	}

	/**
	 * Unrevert a session to restore all reverted messages
	 */
	async unrevertSession(sessionId: string): Promise<void> {
		try {
			const response = await this.sdkClient.session.unrevert({
				path: { id: sessionId },
			});

			if (response.error) {
				throw new Error(`Failed to unrevert session: ${response.error}`);
			}
		} catch (error) {
			const statusCode = this.getErrorStatusCode(error);
			let err: Error;

			if (statusCode === 404 || statusCode === 500) {
				err = this.createHttpError(statusCode, "unreverting session", sessionId);
			} else {
				err = error instanceof Error ? error : new Error(String(error));
			}

			const severity = this.isEnhancedError(err)
				? ErrorSeverity.Warning
				: ErrorSeverity.Error;
			this.errorHandler.handleError(
				err,
				{
					module: "OpenCodeClient",
					function: "unrevertSession",
					operation: "Unreverting session",
					metadata: { sessionId, statusCode },
				},
				severity,
			);
			throw err;
		}
	}

	/**
	 * Get file changes (diff) for a session
	 * Returns all file modifications made during the session
	 */
	async getSessionDiff(sessionId: string): Promise<import("../types").SessionDiff> {
		try {
			const response = await this.sdkClient.session.diff({
				path: { id: sessionId },
			});

			if (response.error) {
				throw new Error(`Failed to get session diff: ${response.error}`);
			}

			if (!response.data) {
				throw new Error("OpenCode Server session.diff returned no data.");
			}

			// Transform SDK diff format to our SessionDiff format
			const files = (response.data as any).files || [];
			const transformedFiles = files.map((file: any) => ({
				path: file.path || "",
				added: file.added || [],
				removed: file.removed || [],
				language: file.language,
			}));

			return {
				sessionId,
				files: transformedFiles,
			};
		} catch (error) {
			const statusCode = this.getErrorStatusCode(error);
			let err: Error;

			if (statusCode === 404 || statusCode === 500) {
				err = this.createHttpError(statusCode, "getting session diff", sessionId);
			} else {
				err = error instanceof Error ? error : new Error(String(error));
			}

			const severity = this.isEnhancedError(err)
				? ErrorSeverity.Warning
				: ErrorSeverity.Error;
			this.errorHandler.handleError(
				err,
				{
					module: "OpenCodeClient",
					function: "getSessionDiff",
					operation: "Getting session diff",
					metadata: { sessionId, statusCode },
				},
				severity,
			);
			throw err;
		}
	}

	/**
	 * Perform health check on OpenCode Server
	 */
	async healthCheck(): Promise<boolean> {
		try {
			// Health check uses direct requestUrl to avoid JSON parsing issues
			// Health endpoint may return HTML or plain text, not JSON
			
			const healthUrl = `${this.config.url}/health`;
			let response: Awaited<ReturnType<typeof requestUrl>>;
			
			try {
				// Use requestUrl directly with text/plain content type to avoid JSON parsing
				// Note: requestUrl may still attempt to parse JSON based on response Content-Type header
				response = await requestUrl({
					url: healthUrl,
					method: "GET",
					contentType: "text/plain",
				});
			} catch (requestError) {
				// Check if this is a JSON parsing error (expected for HTML responses)
				const errorMessage = requestError instanceof Error ? requestError.message : String(requestError);
				const isJsonParseError = errorMessage.includes("not valid JSON") || 
				                        errorMessage.includes("Unexpected token");
				
				if (isJsonParseError) {
					// JSON parse errors are expected for /health endpoint that returns HTML
					// Don't log this as an error - just treat as unhealthy
					// The server is responding, but with HTML instead of JSON
					return false;
				}
				
				// For other errors (connection errors, etc.), log but don't show to user
				this.errorHandler.handleError(
					requestError,
					{
						module: "OpenCodeClient",
						function: "healthCheck",
						operation: "Health check request",
						metadata: { url: healthUrl },
					},
					ErrorSeverity.Warning,
				);
				return false;
			}

			const isHealthy = response.status >= 200 && response.status < 300;
			if (!isHealthy) {
				// Log non-2xx status as warning via error handler (not console)
				this.errorHandler.handleError(
					new Error(`Health check returned status ${response.status}`),
					{
						module: "OpenCodeClient",
						function: "healthCheck",
						operation: "Health check response",
						metadata: { url: healthUrl, status: response.status },
					},
					ErrorSeverity.Warning,
				);
			}

			return isHealthy;
		} catch (error) {
			// Check if this is a JSON parsing error that bypassed inner catch
			const errorMessage = error instanceof Error ? error.message : String(error);
			const isJsonParseError = errorMessage.includes("not valid JSON") || 
			                        errorMessage.includes("Unexpected token");
			if (isJsonParseError) {
				// JSON parse error bypassed inner catch - treat as unhealthy without logging
				return false;
			}
			// All errors are handled via error handler (Warning severity to avoid user notifications)
			this.errorHandler.handleError(
				error,
				{
					module: "OpenCodeClient",
					function: "healthCheck",
					operation: "Health check",
					metadata: { serverUrl: this.config.url },
				},
				ErrorSeverity.Warning,
			);
			return false;
		}
	}

	/**
	 * Detect available features by checking which API endpoints are available
	 * Results are cached for 5 minutes
	 */
	async detectFeatures(): Promise<Set<string>> {
		const cacheTtlMs = 5 * 60 * 1000; // 5 minutes
		const now = Date.now();

		// Return cached results if still valid
		if (
			this.featureCache &&
			now - this.featureCache.fetchedAt < cacheTtlMs
		) {
			return new Set(this.featureCache.features);
		}

		const features = new Set<string>();

		// Test core session management endpoints
		const endpointsToTest = [
			{ name: "session.list", test: () => this.sdkClient.session.list() },
			{ name: "session.create", test: () => this.sdkClient.session.create({ body: { title: "test" } }) },
			{ name: "session.get", test: () => this.sdkClient.session.get({ path: { id: "test" } }) },
			{ name: "session.update", test: () => this.sdkClient.session.update({ path: { id: "test" }, body: { title: "test" } }) },
			{ name: "session.delete", test: () => this.sdkClient.session.delete({ path: { id: "test" } }) },
			{ name: "session.messages", test: () => this.sdkClient.session.messages({ path: { id: "test" } }) },
		];

		// Test each endpoint
		for (const endpoint of endpointsToTest) {
			try {
				const response = await endpoint.test();
				// If we get a response (even an error response), the endpoint exists
				// 404 means the endpoint exists but the resource doesn't
				// Only mark as unavailable if we get a 404 on the endpoint itself (not the resource)
				if (response.error) {
					const statusCode = this.getErrorStatusCode(response.error);
					// 404 on session.list means the endpoint doesn't exist
					// 404 on other endpoints with an ID means the resource doesn't exist (endpoint exists)
					if (statusCode === 404 && endpoint.name === "session.list") {
						// Endpoint doesn't exist
						continue;
					}
					// For other endpoints, 404 means the test resource doesn't exist, but endpoint is available
					features.add(endpoint.name);
				} else {
					// Success response means endpoint is available
					features.add(endpoint.name);
				}
			} catch (error) {
				// Check if this is a 404 error (endpoint doesn't exist)
				const statusCode = this.getErrorStatusCode(error);
				if (statusCode === 404 && endpoint.name === "session.list") {
					// Endpoint doesn't exist
					continue;
				}
				// For other endpoints, 404 means the test resource doesn't exist, but endpoint is available
				if (statusCode === 404) {
					features.add(endpoint.name);
				}
				// Other errors (network, 500, etc.) - assume endpoint might exist but is temporarily unavailable
				// Don't add to features set
			}
		}

		// Cache the results
		this.featureCache = { features, fetchedAt: now };

		return new Set(features);
	}

	/**
	 * Check if a specific feature is available
	 * Uses cached feature detection results
	 */
	async hasFeature(featureName: string): Promise<boolean> {
		const features = await this.detectFeatures();
		return features.has(featureName);
	}

	/**
	 * Build system message from context and instructions
	 */
	private buildSystemMessage(
		context?: SessionContext,
		agent?: string,
		instructions?: string[],
	): string | null {
		const parts: string[] = [];

		if (agent) {
			parts.push(`Agent: ${agent}`);
		}

		if (instructions?.length) {
			parts.push(`Instructions: ${instructions.join(", ")}`);
		}

		if (context) {
			const contextParts: string[] = [];
			if (context.currentNote)
				contextParts.push(`Current note: ${context.currentNote}`);
			if (context.selection)
				contextParts.push(`Selection: ${context.selection}`);
			if (context.links?.length)
				contextParts.push(`Links: ${context.links.join(", ")}`);
			if (context.tags?.length)
				contextParts.push(`Tags: ${context.tags.join(", ")}`);

			if (contextParts.length) {
				parts.push(`Context: ${contextParts.join("; ")}`);
			}
		}

		return parts.length > 0 ? parts.join("\n") : null;
	}

	/**
	 * Subscribe to SDK client events and translate them to UI callbacks
	 */
	private async subscribeToEvents(): Promise<void> {
		const shouldReconnect = this.config.autoReconnect ?? true;
		const baseDelay = this.config.reconnectDelay ?? 1000;
		const maxDelay = 30000;
		const maxAttempts = this.config.reconnectMaxAttempts ?? 10;
		let attempt = 0;

		this.eventStreamAbort?.abort();
		this.eventStreamAbort = new AbortController();
		const { signal } = this.eventStreamAbort;

		try {
			while (!signal.aborted) {
				try {
					if (attempt > 0) {
						this.setConnectionState("reconnecting");
					}
					
					const stream = await this.createEventStream(signal);

					if (this.connectionState !== "connected") {
						this.setConnectionState("connected");
						console.debug(
							"[OpenCodeClient] Connected to OpenCode Server",
						);
					}
					attempt = 0;
					await this.processEventStream(stream);

					if (!shouldReconnect || signal.aborted) {
						break;
					}
				} catch (error) {
					if (signal.aborted) {
						break;
					}

					if (!shouldReconnect) {
						throw error;
					}

					attempt += 1;
					const cappedAttempt =
						maxAttempts === 0 ? attempt : Math.min(attempt, maxAttempts);
					const delayBase = Math.min(
						baseDelay * 2 ** (cappedAttempt - 1),
						maxDelay,
					);
					const jitter = Math.floor(
						Math.random() *
							Math.max(1, Math.floor(delayBase * 0.25)),
					);
					const delay = delayBase + jitter;

					for (const callback of this.reconnectAttemptCallbacks) {
						try {
							callback({
								attempt: cappedAttempt,
								nextDelayMs: delay,
								maxAttempts,
							});
						} catch (callbackError) {
							this.errorHandler.handleError(
								callbackError,
								{
									module: "OpenCodeClient",
									function: "subscribeToEvents",
									operation:
										"Notifying reconnect attempt listeners",
									metadata: {
										attempt: cappedAttempt,
										nextDelayMs: delay,
									},
								},
								ErrorSeverity.Warning,
							);
						}
					}

					if (maxAttempts !== 0 && attempt >= maxAttempts) {
						const err =
							error instanceof Error ? error : new Error(String(error));
						this.lastConnectionError = err;
						this.setConnectionState("error", { error: err });
						throw err;
					}

					await this.sleep(delay);
				}
			}
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			this.lastConnectionError = err;
			this.errorHandler.handleError(
				err,
				{
					module: "OpenCodeClient",
					function: "subscribeToEvents",
					operation: "Event subscription setup",
				},
				ErrorSeverity.Error,
			);
			throw error;
		}
	}

	private startEventLoop(): void {
		void this.subscribeToEvents().catch(() => {
			if (this.eventStreamAbort?.signal.aborted) {
				this.setConnectionState("disconnected", { error: null });
				return;
			}

			// Preserve error state if it was set; otherwise fall back to disconnected.
			if (this.connectionState !== "error") {
				this.setConnectionState("disconnected", {
					error: this.lastConnectionError,
				});
			}
		});
	}

	private getNodeRequire(): ((id: string) => unknown) | null {
		const nodeRequire = (
			globalThis as { require?: (id: string) => unknown }
		).require;
		return typeof nodeRequire === "function" ? nodeRequire : null;
	}

	private canUseNodeEventStream(): boolean {
		if (this.config.forceSdkEventStream) {
			return false;
		}
		const nodeRequire = this.getNodeRequire();
		return (
			typeof process !== "undefined" &&
			typeof process.versions === "object" &&
			typeof process.versions.node === "string" &&
			typeof nodeRequire === "function"
		);
	}

	private async createEventStream(
		signal: AbortSignal,
	): Promise<AsyncGenerator<any, any, unknown>> {
		const useNodeStream = this.canUseNodeEventStream();
		if (useNodeStream) {
			return this.createNodeEventStream(signal);
		}

		const sub: any = await this.sdkClient.event.subscribe({
			signal,
		});
		const stream = sub?.data?.stream ?? sub?.stream;
		if (!stream) {
			throw new Error("Event subscription did not include a stream");
		}
		return stream;
	}

	private async createNodeEventStream(
		signal: AbortSignal,
	): Promise<AsyncGenerator<any, any, unknown>> {
		const eventUrl = new URL("/event", `${this.config.url}/`);
		return this.nodeEventStream(eventUrl, signal);
	}

	private async *nodeEventStream(
		eventUrl: URL,
		signal: AbortSignal,
	): AsyncGenerator<any, any, unknown> {
		type NodeResponse = AsyncIterable<Uint8Array> & {
			statusCode?: number;
			statusMessage?: string;
			resume?: () => void;
		};
		type NodeRequest = {
			on: (event: "error", listener: (error: Error) => void) => void;
			end: () => void;
		};
		type NodeRequestOptions = {
			method: string;
			headers: Record<string, string>;
			hostname: string;
			port?: string;
			path: string;
			signal: AbortSignal;
		};

		const moduleId = eventUrl.protocol === "https:" ? "node:https" : "node:http";
		const nodeRequire = this.getNodeRequire();
		const httpModule = nodeRequire
			? nodeRequire(moduleId)
			: await import(moduleId);
		const request = (httpModule as unknown as {
			request: (
				options: NodeRequestOptions,
				callback: (response: NodeResponse) => void,
			) => NodeRequest;
		}).request;

		const response = await new Promise<NodeResponse>((resolve, reject) => {
			const headers: Record<string, string> = {
				Accept: "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			};
			if (this.lastEventId) {
				headers["Last-Event-ID"] = this.lastEventId;
			}

			const req = request(
				{
					method: "GET",
					headers,
					hostname: eventUrl.hostname,
					port: eventUrl.port || undefined,
					path: `${eventUrl.pathname}${eventUrl.search}`,
					signal,
				},
				(res) => {
					const statusCode = res.statusCode ?? 0;
					if (statusCode >= 400) {
						res.resume?.();
						reject(
							new Error(
								`Event stream failed: ${statusCode} ${
									res.statusMessage ?? ""
								}`.trim(),
							),
						);
						return;
					}
					resolve(res);
				},
			);

			req.on("error", (error) => reject(error));
			req.end();
		});

		const decoder = new TextDecoder();
		let buffer = "";

		for await (const chunk of response) {
			if (signal.aborted) {
				break;
			}

			buffer += decoder.decode(chunk, { stream: true });
			const chunks = buffer.split("\n\n");
			buffer = chunks.pop() ?? "";

			for (const rawChunk of chunks) {
				const lines = rawChunk.split("\n");
				const dataLines: string[] = [];

				for (const line of lines) {
					const cleaned = line.replace(/\r$/, "");
					if (cleaned.startsWith("data:")) {
						dataLines.push(cleaned.replace(/^data:\s*/, ""));
					} else if (cleaned.startsWith("id:")) {
						this.lastEventId = cleaned.replace(/^id:\s*/, "");
					}
				}

				if (!dataLines.length) {
					continue;
				}

				const rawData = dataLines.join("\n");
				try {
					yield JSON.parse(rawData);
				} catch {
					yield rawData;
				}
			}
		}
	}

	private sleep(durationMs: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, durationMs));
	}

	/**
	 * Process events from the SDK event stream
	 */
	private async processEventStream(
		stream: AsyncGenerator<any, any, unknown>,
	): Promise<void> {
		try {
			let eventCount = 0;
			for await (const event of stream) {
				eventCount++;
				this.handleSDKEvent(event);
			}
		} catch (error) {
			this.errorHandler.handleError(
				error,
				{
					module: "OpenCodeClient",
					function: "processEventStream",
					operation: "Processing event stream",
				},
				ErrorSeverity.Warning,
			);

			// Notify error callbacks
			this.handleSDKError(error as Error);
			throw error;
		}
	}

	/**
	 * Handle SDK client events and translate them to UI callbacks
	 */
	private handleSDKEvent(event: any): void {
		try {
			const sessionId = this.extractSessionIdFromEvent(event) || "";

			// Handle different event types based on the event structure
			if (event.type) {
				switch (event.type) {
					case "message.part.updated":
					case "message.updated":
						this.handleMessagePartUpdated(event, sessionId);
						return; // Prevent fallthrough to else if branch

					case "session.idle":
					case "session.completed":
						this.handleSessionIdle(sessionId);
						return; // Prevent fallthrough to else if branch

					case "session.progress":
						this.handleSessionProgress(event, sessionId);
						return; // Prevent fallthrough to else if branch

					case "session.ended":
					case "session.aborted":
						this.handleSessionEnded(event, sessionId);
						return; // Prevent fallthrough to else if branch

					default:
						console.debug(
							"[OpenCodeClient] Unhandled event type:",
							event.type,
						);
						return; // Prevent fallthrough to else if branch
				}
			}
			
			// Only handle assistant message format if no explicit type was handled above
			if (event.role === "assistant" && event.parts) {
				// Handle message events that might not have explicit type
				this.handleAssistantMessage(event, sessionId);
			}
		} catch (error) {
			this.errorHandler.handleError(
				error,
				{
					module: "OpenCodeClient",
					function: "handleSDKEvent",
					operation: "Processing SDK event",
					metadata: { eventType: event.type },
				},
				ErrorSeverity.Warning,
			);
		}
	}

	/**
	 * Handle message.part.updated events for tokens and thinking content
	 */
	private handleMessagePartUpdated(event: any, sessionId: string): void {
		// Try multiple possible event structures (SDK may use properties, data, or direct fields)
		const part = event.properties?.part || event.data?.part || event.part;
		const delta = event.properties?.delta || event.data?.delta || event.delta;

		if (!part && !delta) {
			return;
		}

		// Prefer delta (incremental update) over part.text (which might be full content)
		// Only use part.text if delta is not available
		const content = delta || (part?.text || "");

		if (part?.type === "text" || (!part?.type && content)) {
			// Stream token content
			this.streamTokenCallbacks.forEach((callback) => {
				try {
					callback(sessionId, content, false);
				} catch (error) {
					console.warn(
						"[OpenCodeClient] Error in stream token callback:",
						error,
					);
				}
			});
		} else if (part?.type === "reasoning" || part?.type === "thinking") {
			// Stream thinking content
			this.streamThinkingCallbacks.forEach((callback) => {
				try {
					callback(sessionId, content);
				} catch (error) {
					console.warn(
						"[OpenCodeClient] Error in stream thinking callback:",
						error,
					);
				}
			});
		}
	}

	/**
	 * Handle assistant message events (alternative format)
	 */
	private handleAssistantMessage(event: any, sessionId: string): void {
		if (event.parts && Array.isArray(event.parts)) {
			for (const part of event.parts) {
				if (part.type === "text" && part.text) {
					this.streamTokenCallbacks.forEach((callback) => {
						try {
							callback(sessionId, part.text, false);
						} catch (error) {
							console.warn(
								"[OpenCodeClient] Error in stream token callback:",
								error,
							);
						}
					});
				} else if (part.type === "reasoning" && part.text) {
					this.streamThinkingCallbacks.forEach((callback) => {
						try {
							callback(sessionId, part.text);
						} catch (error) {
							console.warn(
								"[OpenCodeClient] Error in stream thinking callback:",
								error,
							);
						}
					});
				}
			}
		}
	}

	/**
	 * Handle session.idle events for completion
	 */
	private handleSessionIdle(sessionId: string): void {
		if (this.promptInFlightSessionId === sessionId) {
			this.promptInFlightSessionId = null;
		}
		// Signal completion with empty token and done=true
		this.streamTokenCallbacks.forEach((callback) => {
			try {
				callback(sessionId, "", true);
			} catch (error) {
				console.warn(
					"[OpenCodeClient] Error in stream token completion callback:",
					error,
				);
			}
		});
	}

	/**
	 * Handle session progress events
	 */
	private handleSessionProgress(event: any, sessionId: string): void {
		const progress = event.data?.progress || event.progress;
		if (progress) {
			this.progressUpdateCallbacks.forEach((callback) => {
				try {
					callback(sessionId, progress);
				} catch (error) {
					console.warn(
						"[OpenCodeClient] Error in progress update callback:",
						error,
					);
				}
			});
		}
	}

	/**
	 * Handle session ended events
	 */
	private handleSessionEnded(event: any, sessionId: string): void {
		const reason = event.data?.reason || event.reason || "completed";

		// Clean up session
		this.sessions.delete(sessionId);
		if (this.currentSessionId === sessionId) {
			this.currentSessionId = null;
		}
		if (this.promptInFlightSessionId === sessionId) {
			this.promptInFlightSessionId = null;
		}

		// Notify callbacks
		this.sessionEndCallbacks.forEach((callback) => {
			try {
				callback(sessionId, reason);
			} catch (error) {
				console.warn(
					"[OpenCodeClient] Error in session end callback:",
					error,
				);
			}
		});
	}

	/**
	 * Handle SDK client errors
	 */
	private handleSDKError(error: Error): void {
		this.errorHandler.handleError(
			error,
			{
				module: "OpenCodeClient",
				function: "handleSDKError",
				operation: "SDK event error",
			},
			ErrorSeverity.Error,
		);

		// Notify error callbacks
		this.errorCallbacks.forEach((callback) => {
			try {
				callback(error);
			} catch (callbackError) {
				console.warn(
					"[OpenCodeClient] Error in error callback:",
					callbackError,
				);
			}
		});
	}
}
