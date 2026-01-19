import { createOpencodeClient } from "@opencode-ai/sdk/client";
import type { Session } from "@opencode-ai/sdk/client";
import { requestUrl } from "obsidian";
import { ErrorHandler, ErrorSeverity } from "../utils/error-handler";
import { getErrorStatusCode } from "../utils/error-messages";
import {
	formatISOTimestamp,
	safeJsonParse,
	safeJsonStringify,
} from "../utils/data-helpers";
import type {
	OpenCodeServerConfig,
	ConnectionState,
	SessionContext,
	ProgressUpdate,
	ReconnectAttemptInfo,
	HealthCheckResult,
} from "./types";
import type { SessionListItem, Message, SearchQuery, SearchResult, FileResult, SymbolResult } from "../types";
import { ConnectionHandler } from "./connection-handler";
import { StreamHandler } from "./stream-handler";
import { SessionOperations } from "./session-operations";

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
	private connectionHandler: ConnectionHandler;
	private streamHandler: StreamHandler;
	private sessionOps: SessionOperations;

	// Session management - delegated to SessionOperations
	// These properties are kept for backward compatibility with direct access
	private get currentSessionId(): string | null {
		return this.sessionOps.getCurrentSessionId();
	}
	private set currentSessionId(value: string | null) {
		this.sessionOps.setCurrentSessionId(value);
	}
	private get sessions(): Map<string, Session> {
		return this.sessionOps.getSessions();
	}
	private get promptInFlightSessionId(): string | null {
		return this.sessionOps.getPromptInFlightSessionId();
	}
	private set promptInFlightSessionId(value: string | null) {
		this.sessionOps.setPromptInFlightSessionId(value);
	}

	// Cache for commands and features
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

		// Initialize connection handler
		this.connectionHandler = new ConnectionHandler(this.config, this.errorHandler);

		// Initialize SDK client with custom Obsidian fetch
		this.sdkClient = createClient(
			normalizedUrl,
			this.createObsidianFetch(),
		);

		// Initialize session operations handler
		this.sessionOps = new SessionOperations(
			this.sdkClient,
			this.errorHandler,
			normalizedUrl,
		);

		// Initialize stream handler with session state from SessionOperations
		this.streamHandler = new StreamHandler(
			this.config,
			this.errorHandler,
			this.sdkClient,
			{
				promptInFlightSessionId: this.sessionOps.getPromptInFlightSessionId(),
				sessions: this.sessionOps.getSessions(),
				currentSessionId: this.sessionOps.getCurrentSessionId(),
			},
			(sessionId) => this.sessionOps.clearPromptInFlight(sessionId),
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
				
				// #region agent log
				fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:147',message:'createObsidianFetch: before requestUrl',data:{url:resolvedUrl,method,hasBody:!!body,bodyLength:body?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
				// #endregion
				
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
										// #region agent log
										fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:160',message:'createObsidianFetch: response received',data:{status:res.status,hasText:!!res.text,textLength:res.text?.length||0,hasJson:res.json!==undefined&&res.json!==null,contentType:res.headers?.['content-type']},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
										// #endregion
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
						// #region agent log
						fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:177',message:'createObsidianFetch: parseError caught',data:{errorMessage:parseError instanceof Error?parseError.message:String(parseError),errorType:parseError?.constructor?.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
						// #endregion
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

				// #region agent log
				fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:189',message:'createObsidianFetch: before response body extraction',data:{status:response.status,hasText:!!response.text,textLength:response.text?.length||0,hasJson:response.json!==undefined&&response.json!==null,contentType:response.headers?.['content-type']},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
				// #endregion

				// Convert Obsidian response to standard Response object
				// Safely handle response body - use text if available, otherwise try to stringify json
				// If json parsing failed (e.g., HTML response), response.json may be undefined or invalid
				let responseBody: string;
				if (response.text) {
					responseBody = response.text;
				} else if (response.json !== undefined && response.json !== null) {
					responseBody = safeJsonStringify(response.json, "");
				} else {
					responseBody = "";
				}
				
				// #region agent log
				fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:199',message:'createObsidianFetch: response body extracted',data:{responseBodyLength:responseBody.length,status:response.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
				// #endregion
				
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
				
				// #region agent log
				fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:206',message:'createObsidianFetch: error caught',data:{errorMessage,errorType:error?.constructor?.name,url:resolvedUrl,method},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
				// #endregion
				
				const isTimeout = errorMessage.includes("timed out");
				const isJsonParseError = errorMessage.includes("not valid JSON") || 
				                        errorMessage.includes("Unexpected token") ||
				                        errorMessage.includes("Unexpected end of JSON input");
				
				// For JSON parse errors (e.g., HTML responses from /health endpoint, or empty responses),
				// handle them appropriately based on the error type
				if (isJsonParseError) {
					// #region agent log
					fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:215',message:'createObsidianFetch: handling JSON parse error',data:{errorMessage,url:resolvedUrl,method,isEndOfJson:errorMessage.includes('Unexpected end of JSON input')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
					// #endregion
					
					// For "Unexpected end of JSON input", the response body is likely empty or incomplete
					// Return a valid JSON response (empty object) to allow the SDK client to parse it
					// This is common for streaming endpoints or 204 No Content responses
					if (errorMessage.includes("Unexpected end of JSON input")) {
						// #region agent log
						fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:220',message:'createObsidianFetch: returning empty JSON response',data:{url:resolvedUrl,method},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
						// #endregion
						// Return empty JSON object instead of empty string so SDK client can parse it
						return new Response("{}", {
							status: 200,
							statusText: "OK",
							headers: new Headers({ "Content-Type": "application/json" }),
						});
					}
					
					// For other JSON parse errors (e.g., HTML responses), re-throw to let caller handle
					// This is expected for some endpoints (like /health) that return HTML
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
	 * Subscribe to connection state changes.
	 */
	onConnectionStateChange(
		callback: (state: ConnectionState, info?: { error?: Error | null }) => void,
	): () => void {
		return this.connectionHandler.onConnectionStateChange(callback);
	}

	/**
	 * Subscribe to health status changes.
	 */
	onHealthStatusChange(callback: (isHealthy: boolean | null) => void): () => void {
		return this.connectionHandler.onHealthStatusChange(callback);
	}

	/**
	 * Get current health status.
	 */
	getHealthStatus(): boolean | null {
		return this.connectionHandler.getHealthStatus();
	}

	/**
	 * Subscribe to reconnect attempt info (next delay, attempt count).
	 */
	onReconnectAttempt(callback: (info: ReconnectAttemptInfo) => void): void {
		this.connectionHandler.onReconnectAttempt(callback);
	}

	getLastConnectionError(): Error | null {
		return this.connectionHandler.getLastConnectionError();
	}

	/**
	 * Get current connection state
	 */
	getConnectionState(): ConnectionState {
		return this.connectionHandler.getConnectionState();
	}

	/**
	 * Get current server configuration
	 */
	getConfig(): OpenCodeServerConfig {
		return this.connectionHandler.getConfig();
	}

	/**
	 * Check if client is connected
	 */
	isConnected(): boolean {
		return this.connectionHandler.isConnected();
	}

	/**
	 * Get current session ID
	 */
	getCurrentSessionId(): string | null {
		return this.sessionOps.getCurrentSessionId();
	}

	/**
	 * Ensure session exists locally or on server.
	 */
	async ensureSession(sessionId: string): Promise<boolean> {
		return this.sessionOps.ensureSession(sessionId);
	}

	// Event callback registration methods
	onStreamToken(
		callback: (sessionId: string, token: string, done: boolean) => void,
	): void {
		this.streamHandler.onStreamToken(callback);
	}

	onStreamThinking(
		callback: (sessionId: string, content: string) => void,
	): void {
		this.streamHandler.onStreamThinking(callback);
	}

	onError(callback: (error: Error) => void): void {
		this.streamHandler.onError(callback);
	}

	onProgressUpdate(
		callback: (sessionId: string, progress: ProgressUpdate) => void,
	): void {
		this.streamHandler.onProgressUpdate(callback);
	}

	onSessionEnd(callback: (sessionId: string, reason?: string) => void): void {
		this.streamHandler.onSessionEnd(callback);
	}

	/**
	 * Subscribes to permission request events from the server.
	 * 
	 * Permission request events are emitted when the server needs user approval
	 * to perform an operation on the vault. The callback receives details about
	 * the operation, resource path, and optional context.
	 * 
	 * @param callback - Function to call when a permission request is received
	 * @example
	 * ```typescript
	 * client.onPermissionRequest((sessionId, requestId, operation, resourcePath, context) => {
	 *   console.log(`Permission requested: ${operation} on ${resourcePath}`);
	 * });
	 * ```
	 */
	onPermissionRequest(
		callback: (sessionId: string, requestId: string, operation: string, resourcePath: string, context?: unknown) => void,
	): void {
		this.streamHandler.onPermissionRequest(callback);
	}

	/**
	 * Connect to OpenCode Server and set up event subscriptions
	 */
	async connect(): Promise<void> {
		// Delegate connection state management to handler
		await this.connectionHandler.connect();

		// Update stream handler with current session state from SessionOperations
		this.streamHandler.updateSessionState({
			promptInFlightSessionId: this.sessionOps.getPromptInFlightSessionId(),
			sessions: this.sessionOps.getSessions(),
			currentSessionId: this.sessionOps.getCurrentSessionId(),
		});

		// Subscribe to SDK client events without blocking the caller.
		this.startEventLoop();
	}

	/**
	 * Disconnect from OpenCode Server
	 */
	async disconnect(): Promise<void> {
		await this.connectionHandler.disconnect();
		this.sessionOps.clearSessionState();
	}

	/**
	 * Create a new session
	 */
	async createSession(title?: string): Promise<string> {
		return this.sessionOps.createSession(title);
	}

	/**
	 * Start a session with context (legacy compatibility method)
	 */
	async startSession(
		context?: SessionContext,
		agent?: string,
		instructions?: string[],
	): Promise<string> {
		return this.sessionOps.startSession(context, agent, instructions);
	}

	/**
	 * Send a message to a session
	 */
	async sendMessage(sessionId: string, content: string): Promise<void> {
		return this.sessionOps.sendMessage(sessionId, content);
	}

	/**
	 * Send a session message (legacy compatibility method)
	 */
	async sendSessionMessage(
		sessionId: string,
		content: string,
		images?: any[],
	): Promise<void> {
		return this.sessionOps.sendSessionMessage(sessionId, content, images);
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
		return this.sessionOps.sendSessionCommand(sessionId, command, argumentsText, agent);
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
	 * List available agents from server
	 * @returns Array of agents with id, name, description
	 * @throws Error if request fails
	 */
	async listAgents(): Promise<import("../types").Agent[]> {
		try {
			const response = await this.sdkClient.app.agents();
			if (response.error || !response.data) {
				throw new Error(
					`Failed to list agents: ${response.error ?? "Unknown error"}`,
				);
			}

			return response.data.map((agent: any) => ({
				id: agent.id,
				name: agent.name,
				description: agent.description,
				systemPrompt: agent.systemPrompt || "",
				model: agent.model,
				tools: agent.tools,
				skills: agent.skills,
				color: agent.color,
				hidden: agent.hidden,
				mode: agent.mode,
			}));
		} catch (error) {
			this.errorHandler.handleError(
				error,
				{
					module: "OpenCodeClient",
					function: "listAgents",
					operation: "Listing agents",
				},
				ErrorSeverity.Warning,
			);
			throw error;
		}
	}

	/**
	 * Abort a session
	 */
	async abortSession(sessionId: string): Promise<void> {
		return this.sessionOps.abortSession(sessionId);
	}

	/**
	 * Responds to a server permission request with retry logic.
	 * 
	 * Sends the user's approval or denial decision back to the OpenCode Server.
	 * Implements automatic retry with exponential backoff:
	 * - Initial attempt
	 * - 1 retry after 500ms delay
	 * - Throws error if both attempts fail
	 * 
	 * This method should be called after the user has approved or denied a
	 * permission request via the permission modal.
	 * 
	 * @param sessionId - ID of the session the permission request belongs to
	 * @param requestId - Unique ID of the permission request
	 * @param approved - Whether the permission was approved (true) or denied (false)
	 * @param reason - Optional reason for the decision (e.g., "User denied", "Request timed out")
	 * @returns Promise that resolves when the response has been successfully sent
	 * @throws Error if all retry attempts fail
	 * 
	 * @example
	 * ```typescript
	 * // Approve a permission request
	 * await client.respondToPermission(sessionId, requestId, true);
	 * 
	 * // Deny a permission request with reason
	 * await client.respondToPermission(sessionId, requestId, false, "User denied");
	 * ```
	 */
	async respondToPermission(
		sessionId: string,
		requestId: string,
		approved: boolean,
		reason?: string,
	): Promise<void> {
		return this.sessionOps.respondToPermission(sessionId, requestId, approved, reason);
	}

	/**
	 * List all sessions from the server
	 */
	async listSessions(): Promise<SessionListItem[]> {
		return this.sessionOps.listSessions();
	}

	/**
	 * Get messages for a specific session
	 */
	async getSessionMessages(sessionId: string): Promise<Message[]> {
		return this.sessionOps.getSessionMessages(sessionId);
	}

	/**
	 * Update session title
	 */
	async updateSessionTitle(sessionId: string, title: string): Promise<void> {
		return this.sessionOps.updateSessionTitle(sessionId, title);
	}

	/**
	 * Delete a session from the server
	 */
	async deleteSession(sessionId: string): Promise<void> {
		return this.sessionOps.deleteSession(sessionId);
	}

	/**
	 * Revert a session to a specific message
	 * Messages after the specified message will be hidden
	 */
	async revertSession(sessionId: string, messageId: string): Promise<void> {
		return this.sessionOps.revertSession(sessionId, messageId);
	}

	/**
	 * Unrevert a session to restore all reverted messages
	 */
	async unrevertSession(sessionId: string): Promise<void> {
		return this.sessionOps.unrevertSession(sessionId);
	}

	/**
	 * Fork a session from a specific message point
	 * Creates a new session that branches from the parent session
	 * @param sessionId - ID of the session to fork
	 * @param messageId - Optional message ID to fork from (defaults to latest)
	 * @param title - Optional title for the forked session
	 * @returns Promise<string> - ID of the newly created forked session
	 */
	async forkSession(
		sessionId: string,
		messageId?: string,
		title?: string,
	): Promise<string> {
		return this.sessionOps.forkSession(sessionId, messageId, title);
	}

	/**
	 * Get file changes (diff) for a session
	 * Returns all file modifications made during the session
	 */
	async getSessionDiff(sessionId: string): Promise<import("../types").SessionDiff> {
		return this.sessionOps.getSessionDiff(sessionId);
	}

	/**
	 * Search for text across all files
	 */
	async searchText(query: SearchQuery): Promise<SearchResult[]> {
		return this.sessionOps.searchText(query);
	}

	/**
	 * Search for files by name or pattern
	 */
	async searchFiles(query: string, limit?: number): Promise<FileResult[]> {
		return this.sessionOps.searchFiles(query, limit);
	}

	/**
	 * Search for symbols across all files
	 */
	async searchSymbols(query: string, limit?: number): Promise<SymbolResult[]> {
		return this.sessionOps.searchSymbols(query, limit);
	}

	/**
	 * Perform health check on OpenCode Server
	 * Delegates to ConnectionHandler for implementation
	 */
	async healthCheck(): Promise<HealthCheckResult> {
		// Delegate health check to ConnectionHandler which has the centralized implementation
		return this.connectionHandler.healthCheck();
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
					const statusCode = getErrorStatusCode(response.error);
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
				const statusCode = getErrorStatusCode(error);
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
	 * Start event loop for SDK client events
	 * Delegates to ConnectionHandler for connection management and StreamHandler for event processing
	 */
	private startEventLoop(): void {
		// Delegate event loop management to connection handler
		// ConnectionHandler handles all connection state transitions and reconnection logic
		void this.connectionHandler.startEventLoop(
			(signal) => this.streamHandler.createEventStream(signal),
			(stream) => this.streamHandler.processEventStream(stream),
		).catch(() => {
			// ConnectionHandler already handled error state and logging
			// No additional action needed here
		});
	}
}
