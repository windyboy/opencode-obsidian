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
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:87',message:'createObsidianFetch: timeout calculation',data:{resolvedUrl,isMessageEndpoint,isPromptEndpoint,baseTimeoutMs,timeoutMs},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'P'})}).catch(()=>{});
			// #endregion
				let timeoutId: ReturnType<typeof setTimeout> | null = null;
				let requestCompleted = false;
				
				// Wrap requestUrl in a try-catch to handle JSON parsing errors
				// requestUrl may attempt to parse JSON based on response Content-Type,
				// even if we set contentType parameter (which only affects request headers)
				let response: Awaited<ReturnType<typeof requestUrl>>;
				const startTime = Date.now();
				
				try {
					const request = requestUrl({
						url: resolvedUrl,
						method,
						headers,
						contentType,
						body,
					});
					
					// Track if request completes
					request.then(() => {
						requestCompleted = true;
					}).catch(() => {
						requestCompleted = true;
					});
					
					try {
						response = (timeoutMs > 0
							? await Promise.race([
									request.then((res) => {
										// #region agent log
										fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:109',message:'createObsidianFetch: request completed',data:{resolvedUrl,method,status:res.status,hasText:!!res.text,hasJson:!!res.json,elapsedMs:Date.now()-startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
										// #endregion
										return res;
									}),
									new Promise<never>((_, reject) => {
										timeoutId = setTimeout(() => {
											// #region agent log
											fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:120',message:'createObsidianFetch: timeout triggered',data:{resolvedUrl,timeoutMs,requestCompleted,elapsedMs:Date.now()-startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
											// #endregion
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
					
					// #region agent log
					fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:118',message:'createObsidianFetch: response received',data:{resolvedUrl,status:response.status,hasText:!!response.text,hasJson:!!response.json,textLength:response.text?.length,headersKeys:Object.keys(response.headers||{})},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
					// #endregion
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
				// #region agent log
				fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:129',message:'createObsidianFetch: creating Response object',data:{resolvedUrl,status:response.status,responseBodyLength:responseBody?.length,responsePreview:responseBody?.substring(0,200),isMessageEndpoint:resolvedUrl.includes('/message')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
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
		// #region agent log
		fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:388',message:'ensureSession: called',data:{sessionId,hasLocalSession:this.sessions.has(sessionId)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'O'})}).catch(()=>{});
		// #endregion
		if (this.sessions.has(sessionId)) {
			return true;
		}

		try {
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:394',message:'ensureSession: calling session.get',data:{sessionId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'P'})}).catch(()=>{});
			// #endregion
			const response = await this.sdkClient.session.get({
				path: { id: sessionId },
			});
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:397',message:'ensureSession: session.get response',data:{sessionId,hasError:!!response.error,hasData:!!response.data,error:response.error},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'Q'})}).catch(()=>{});
			// #endregion
			if (response.error || !response.data) {
				return false;
			}
			this.sessions.set(sessionId, response.data);
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:401',message:'ensureSession: session stored in cache',data:{sessionId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'R'})}).catch(()=>{});
			// #endregion
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
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:477',message:'createSession: calling SDK session.create',data:{title},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
			// #endregion
			const response = await this.sdkClient.session.create({
				body: {
					title: title || `Session ${new Date().toISOString()}`,
				},
			});

			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:483',message:'createSession: SDK session.create response',data:{hasError:!!response.error,hasData:!!response.data,error:response.error,dataKeys:response.data?Object.keys(response.data):[],dataInfoKeys:(response.data as any)?.info?Object.keys((response.data as any).info):[]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
			// #endregion

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
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:490',message:'createSession: extracting sessionId',data:{hasSessionInfo:!!sessionInfo,sessionInfoKeys:sessionInfo?Object.keys(sessionInfo):[],sessionId:this.extractSessionId(sessionInfo)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
			// #endregion
			const sessionId = this.extractSessionId(sessionInfo);
			if (!sessionId) {
				throw new Error(
					"OpenCode Server session response did not include an id.",
				);
			}
			this.sessions.set(sessionId, sessionInfo);
			this.currentSessionId = sessionId;

			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:497',message:'createSession: session created successfully',data:{sessionId,currentSessionId:this.currentSessionId,sessionsSize:this.sessions.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
			// #endregion
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
		try {
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:527',message:'startSession: called',data:{hasContext:!!context,hasAgent:!!agent,hasInstructions:!!instructions?.length,instructionsLength:instructions?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
			// #endregion
			// Create session with context information in title
			const contextInfo = context
				? ` (${context.currentNote || "Unknown note"})`
				: "";
			const title = `Session${contextInfo}`;

			const sessionId = await this.createSession(title);

			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:540',message:'startSession: session created, checking if need to send system message',data:{sessionId,hasContext:!!context,hasInstructions:!!instructions?.length,hasAgent:!!agent},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
			// #endregion
			// If we have context or instructions, send them as initial system message
			if (context || instructions?.length || agent) {
				const systemMessage = this.buildSystemMessage(
					context,
					agent,
					instructions,
				);
				// #region agent log
				fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:543',message:'startSession: built system message',data:{sessionId,hasSystemMessage:!!systemMessage,systemMessageLength:systemMessage?.length,systemMessagePreview:systemMessage?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
				// #endregion
				if (systemMessage) {
					// #region agent log
					fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:548',message:'startSession: sending system message via sendMessage',data:{sessionId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
					// #endregion
					await this.sendMessage(sessionId, systemMessage);
					// #region agent log
					fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:549',message:'startSession: system message sent successfully',data:{sessionId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
					// #endregion
				}
			}

			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:553',message:'startSession: completed',data:{sessionId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
			// #endregion
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
		try {
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:576',message:'sendMessage: called',data:{sessionId,contentLength:content.length,hasLocalSession:this.sessions.has(sessionId)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
			// #endregion
			let session = this.sessions.get(sessionId);
			if (!session) {
				// #region agent log
				fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:580',message:'sendMessage: session not in cache, calling session.get',data:{sessionId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'K'})}).catch(()=>{});
				// #endregion
				const response = await this.sdkClient.session.get({
					path: { id: sessionId },
				});
				// #region agent log
				fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:583',message:'sendMessage: session.get response',data:{sessionId,hasError:!!response.error,hasData:!!response.data,error:response.error},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'L'})}).catch(()=>{});
				// #endregion
				if (response.error || !response.data) {
					throw new Error(`Session ${sessionId} not found`);
				}
				session = response.data;
				this.sessions.set(sessionId, session);
			}

			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:593',message:'sendMessage: calling session.prompt',data:{sessionId,contentLength:content.length,partsFormat:JSON.stringify([{type:"text",text:content.substring(0,50)+"..."}])},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'M'})}).catch(()=>{});
			// #endregion
			
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
					// #region agent log
					fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:600',message:'sendMessage: session.prompt timeout, assuming success for streaming operation',data:{sessionId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'O'})}).catch(()=>{});
					// #endregion
					// For streaming operations, timeout doesn't mean failure
					// If events are received via SSE, the request is successful
					resolve({ data: {} });
				}, 5000); // 5 second timeout for initial response
			});
			
			const response = await Promise.race([promptPromise, timeoutPromise]);
			
			// Continue waiting for promptPromise in the background to catch any errors
			// but don't block the function from returning
			promptPromise.catch((error) => {
				// #region agent log
				fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:610',message:'sendMessage: session.prompt error in background',data:{sessionId,errorMessage:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'P'})}).catch(()=>{});
				// #endregion
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
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:598',message:'sendMessage: session.prompt completed',data:{sessionId,hasError:!!response.error,hasData:!!response.data,error:response.error,dataKeys:response.data?Object.keys(response.data):[]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'N'})}).catch(()=>{});
			// #endregion

			if (response.error) {
				throw new Error(`Failed to send message: ${response.error}`);
			}
		} catch (error) {
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:606',message:'sendMessage: error caught',data:{sessionId,errorMessage:error instanceof Error ? error.message : String(error),isTimeout:error instanceof Error && error.message.includes('timeout')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'P'})}).catch(()=>{});
			// #endregion
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
			// Health check uses direct requestUrl to avoid JSON parsing issues
			// Health endpoint may return HTML or plain text, not JSON
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:702',message:'healthCheck: starting',data:{url:`${this.config.url}/health`},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'L'})}).catch(()=>{});
			// #endregion
			
			const healthUrl = `${this.config.url}/health`;
			let response: Awaited<ReturnType<typeof requestUrl>>;
			
			try {
				// Use requestUrl directly with text/plain content type to avoid JSON parsing
				// Note: requestUrl may still attempt to parse JSON based on response Content-Type header
				// #region agent log
				fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:875',message:'healthCheck: inner try block entered',data:{healthUrl},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
				// #endregion
				response = await requestUrl({
					url: healthUrl,
					method: "GET",
					contentType: "text/plain",
				});
				// #region agent log
				fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:882',message:'healthCheck: requestUrl succeeded',data:{status:response?.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
				// #endregion
			} catch (requestError) {
				// #region agent log
				fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:884',message:'healthCheck: inner catch entered',data:{errorType:requestError?.constructor?.name,errorMessage:requestError instanceof Error ? requestError.message : String(requestError),isError:requestError instanceof Error},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
				// #endregion
				// Check if this is a JSON parsing error (expected for HTML responses)
				const errorMessage = requestError instanceof Error ? requestError.message : String(requestError);
				// #region agent log
				fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:887',message:'healthCheck: error message extracted',data:{errorMessage,hasNotValidJson:errorMessage.includes("not valid JSON"),hasUnexpectedToken:errorMessage.includes("Unexpected token")},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
				// #endregion
				const isJsonParseError = errorMessage.includes("not valid JSON") || 
				                        errorMessage.includes("Unexpected token");
				// #region agent log
				fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:890',message:'healthCheck: JSON parse check result',data:{isJsonParseError},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
				// #endregion
				
				if (isJsonParseError) {
					// #region agent log
					fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:893',message:'healthCheck: JSON parse error detected, returning false silently',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
					// #endregion
					// JSON parse errors are expected for /health endpoint that returns HTML
					// Don't log this as an error - just treat as unhealthy
					// The server is responding, but with HTML instead of JSON
					return false;
				}
				
				// #region agent log
				fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:900',message:'healthCheck: non-JSON error, logging via errorHandler',data:{errorMessage},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
				// #endregion
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
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:710',message:'healthCheck: response received',data:{status:response.status,ok:isHealthy,statusText:response.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'L'})}).catch(()=>{});
			// #endregion

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
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:930',message:'healthCheck: outer catch entered',data:{errorType:error?.constructor?.name,errorMessage:error instanceof Error ? error.message : String(error),isError:error instanceof Error,stack:error instanceof Error ? error.stack?.substring(0,200) : undefined},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
			// #endregion
			// Check if this is a JSON parsing error that bypassed inner catch
			const errorMessage = error instanceof Error ? error.message : String(error);
			const isJsonParseError = errorMessage.includes("not valid JSON") || 
			                        errorMessage.includes("Unexpected token");
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:935',message:'healthCheck: outer catch JSON parse check',data:{isJsonParseError,errorMessage},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
			// #endregion
			if (isJsonParseError) {
				// #region agent log
				fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:938',message:'healthCheck: outer catch detected JSON parse error, returning false silently',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
				// #endregion
				// JSON parse error bypassed inner catch - treat as unhealthy without logging
				return false;
			}
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:943',message:'healthCheck: outer catch non-JSON error, logging via errorHandler',data:{errorMessage},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
			// #endregion
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
		// #region agent log
		fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:883',message:'createEventStream: choosing stream type',data:{useNodeStream,forceSdkEventStream:this.config.forceSdkEventStream,hasNodeRequire:!!this.getNodeRequire()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'N'})}).catch(()=>{});
		// #endregion
		if (useNodeStream) {
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:885',message:'createEventStream: using Node.js event stream',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'N'})}).catch(()=>{});
			// #endregion
			return this.createNodeEventStream(signal);
		}

		// #region agent log
		fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:889',message:'createEventStream: using SDK event.subscribe',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'O'})}).catch(()=>{});
		// #endregion
		const sub: any = await this.sdkClient.event.subscribe({
			signal,
		});
		const stream = sub?.data?.stream ?? sub?.stream;
		if (!stream) {
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:894',message:'createEventStream: SDK subscribe returned no stream',data:{hasSub:!!sub,hasData:!!sub?.data,hasStream:!!sub?.stream},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'O'})}).catch(()=>{});
			// #endregion
			throw new Error("Event subscription did not include a stream");
		}
		// #region agent log
		fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:897',message:'createEventStream: SDK stream obtained',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'O'})}).catch(()=>{});
		// #endregion

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
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:1047',message:'processEventStream: starting to process events',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'Q'})}).catch(()=>{});
			// #endregion
			let eventCount = 0;
			for await (const event of stream) {
				eventCount++;
				// #region agent log
				fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:1051',message:'processEventStream: event received',data:{eventCount,eventType:event?.type,hasProperties:!!event?.properties,hasData:!!event?.data},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'Q'})}).catch(()=>{});
				// #endregion
				this.handleSDKEvent(event);
			}
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:1057',message:'processEventStream: stream ended',data:{totalEvents:eventCount},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'Q'})}).catch(()=>{});
			// #endregion
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

		// #region agent log
		fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:1373',message:'handleMessagePartUpdated: event received',data:{sessionId,hasPart:!!part,hasDelta:!!delta,partType:part?.type,partTextLength:part?.text?.length,deltaLength:delta?.length,partTextPreview:part?.text?.substring(0,100),deltaPreview:delta?.substring(0,100),eventKeys:Object.keys(event)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
		// #endregion

		if (!part && !delta) {
			return;
		}

		// Prefer delta (incremental update) over part.text (which might be full content)
		// Only use part.text if delta is not available
		const content = delta || (part?.text || "");

		// #region agent log
		fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:1384',message:'handleMessagePartUpdated: content extracted',data:{sessionId,contentLength:content.length,contentPreview:content.substring(0,200),isDelta:!!delta,isPartText:!delta && !!part?.text},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
		// #endregion

		if (part?.type === "text" || (!part?.type && content)) {
			// #region agent log
			fetch('http://127.0.0.1:7244/ingest/cee3721f-acd3-48cd-bf4e-9190e480d32e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'client.ts:1386',message:'handleMessagePartUpdated: calling streamToken callbacks',data:{sessionId,contentLength:content.length,contentPreview:content.substring(0,200),callbackCount:this.streamTokenCallbacks.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
			// #endregion
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
