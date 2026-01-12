import { createOpencodeClient } from "@opencode-ai/sdk/client";
import type { Session } from "@opencode-ai/sdk/client";
import { requestUrl } from "obsidian";
import { ErrorHandler, ErrorSeverity } from "../utils/error-handler";
import type {
	OpenCodeServerConfig,
	ConnectionState,
	SessionContext,
	ProgressUpdate,
} from "./types";

export type OpenCodeClient = ReturnType<typeof createOpencodeClient>;

export function createClient(
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

	// Session management
	private currentSessionId: string | null = null;
	private sessions: Map<string, Session> = new Map();
	private eventStreamAbort: AbortController | null = null;
	private lastEventId: string | null = null;

	constructor(config: OpenCodeServerConfig, errorHandler: ErrorHandler) {
		const normalizedUrl = this.normalizeServerUrl(config.url);
		this.config = { ...config, url: normalizedUrl };
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
				body,
			} = await this.buildRequestOptions(url, init);
			try {
				const response = await requestUrl({
					url: resolvedUrl,
					method,
					headers,
					body,
				});

				// Convert Obsidian response to standard Response object
				return new Response(
					response.text || JSON.stringify(response.json),
					{
						status: response.status,
						statusText: response.status.toString(),
						headers: new Headers(response.headers || {}),
					},
				);
			} catch (error) {
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

		return {
			resolvedUrl,
			method,
			headers: headerObject,
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
			return trimmed;
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
				"OpenCode Server URL is invalid. Use http:// or https:// (e.g., http://localhost:4096).",
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
	 * Get current connection state
	 */
	getConnectionState(): ConnectionState {
		return this.connectionState;
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

		this.connectionState = "connecting";

		// Subscribe to SDK client events without blocking the caller.
		this.startEventLoop();
	}

	/**
	 * Disconnect from OpenCode Server
	 */
	async disconnect(): Promise<void> {
		this.eventStreamAbort?.abort();
		this.eventStreamAbort = null;
		this.connectionState = "disconnected";
		this.currentSessionId = null;
		this.sessions.clear();
		console.debug("[OpenCodeClient] Disconnected from OpenCode Server");
	}

	/**
	 * Create a new session
	 */
	async createSession(title?: string): Promise<string> {
		try {
			const response = await this.sdkClient.session.create({
				body: {
					title: title || `Session ${new Date().toISOString()}`,
				},
			});

			if (response.error) {
				throw new Error(`Failed to create session: ${response.error}`);
			}

			const session = response.data;
			const sessionInfo = (session as { info?: Session }).info ?? session;
			const sessionId =
				(sessionInfo as { id?: string; sessionID?: string; sessionId?: string })
					.id ||
				(sessionInfo as { sessionID?: string; sessionId?: string }).sessionID ||
				(sessionInfo as { sessionId?: string }).sessionId;
			if (!sessionId) {
				throw new Error(
					"OpenCode Server session response did not include an id.",
				);
			}
			this.sessions.set(sessionId, sessionInfo);
			this.currentSessionId = sessionId;

			console.debug("[OpenCodeClient] Created session:", sessionId);
			return sessionId;
		} catch (error) {
			this.errorHandler.handleError(
				error,
				{
					module: "OpenCodeClient",
					function: "createSession",
					operation: "Creating session",
					metadata: { title },
				},
				ErrorSeverity.Error,
			);
			throw error;
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
			this.errorHandler.handleError(
				error,
				{
					module: "OpenCodeClient",
					function: "startSession",
					operation: "Starting session with context",
					metadata: { context, agent, instructions },
				},
				ErrorSeverity.Error,
			);
			throw error;
		}
	}

	/**
	 * Send a message to a session
	 */
	async sendMessage(sessionId: string, content: string): Promise<void> {
		try {
			const session = this.sessions.get(sessionId);
			if (!session) {
				throw new Error(`Session ${sessionId} not found`);
			}

			const response = await this.sdkClient.session.prompt({
				path: { id: sessionId },
				body: {
					parts: [{ type: "text", text: content }],
				},
			});

			if (response.error) {
				throw new Error(`Failed to send message: ${response.error}`);
			}

			console.debug(
				"[OpenCodeClient] Message sent to session:",
				sessionId,
			);
		} catch (error) {
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
				console.warn(
					"[OpenCodeClient] Image attachments not yet supported in SDK client",
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
	 * Abort a session
	 */
	async abortSession(sessionId: string): Promise<void> {
		try {
			const session = this.sessions.get(sessionId);
			if (!session) {
				console.warn(
					`[OpenCodeClient] Session ${sessionId} not found for abort`,
				);
				return;
			}

			// Abort the session
			const response = await this.sdkClient.session.abort({
				path: { id: sessionId },
			});

			if (response.error) {
				console.warn(
					`[OpenCodeClient] Failed to abort session: ${response.error}`,
				);
			}

			// Clean up local state
			this.sessions.delete(sessionId);
			if (this.currentSessionId === sessionId) {
				this.currentSessionId = null;
			}

			console.debug("[OpenCodeClient] Aborted session:", sessionId);
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
	 * Perform health check on OpenCode Server
	 */
	async healthCheck(): Promise<boolean> {
		try {
			// Use SDK client to perform health check
			// This might be a simple request to a health endpoint or server status check
			const response = await this.createObsidianFetch()(
				`${this.config.url}/health`,
				{ method: "GET" },
			);

			const isHealthy = response.ok;

			if (isHealthy) {
				console.debug("[OpenCodeClient] Health check passed");
			} else {
				console.warn(
					"[OpenCodeClient] Health check failed:",
					response.status,
				);
			}

			return isHealthy;
		} catch (error) {
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
						this.connectionState = "reconnecting";
					}
					const stream = await this.createEventStream(signal);

					if (this.connectionState !== "connected") {
						this.connectionState = "connected";
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

					attempt = Math.min(attempt + 1, maxAttempts);
					if (maxAttempts !== 0 && attempt >= maxAttempts) {
						throw error;
					}

					const delay = Math.min(baseDelay * 2 ** attempt, maxDelay);
					await this.sleep(delay);
				}
			}

			console.debug("[OpenCodeClient] Event subscription established");
		} catch (error) {
			this.errorHandler.handleError(
				error,
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
			this.connectionState = "disconnected";
		});
	}

	private getNodeRequire(): ((id: string) => unknown) | null {
		const nodeRequire = (
			globalThis as { require?: (id: string) => unknown }
		).require;
		return typeof nodeRequire === "function" ? nodeRequire : null;
	}

	private canUseNodeEventStream(): boolean {
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
		if (this.canUseNodeEventStream()) {
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
			for await (const event of stream) {
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
			// Extract session ID from various possible locations
			const sessionId = event.sessionId || event.sessionID || event.id;

			// Handle different event types based on the event structure
			if (event.type) {
				switch (event.type) {
					case "message.part.updated":
					case "message.updated":
						this.handleMessagePartUpdated(event, sessionId);
						break;

					case "session.idle":
					case "session.completed":
						this.handleSessionIdle(sessionId);
						break;

					case "session.progress":
						this.handleSessionProgress(event, sessionId);
						break;

					case "session.ended":
					case "session.aborted":
						this.handleSessionEnded(event, sessionId);
						break;

					default:
						console.debug(
							"[OpenCodeClient] Unhandled event type:",
							event.type,
						);
				}
			} else if (event.role === "assistant" && event.parts) {
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
		const part = event.data?.part || event.part;
		const delta = event.data?.delta || event.delta;

		if (!part && !delta) return;

		const content = delta || part?.text || "";

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
