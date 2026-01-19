import { ErrorHandler, ErrorSeverity } from "../utils/error-handler";
import { safeJsonParse } from "../utils/data-helpers";
import type { OpenCodeServerConfig, ProgressUpdate } from "./types";
import type { OpenCodeClient } from "./client";

/**
 * Handles SSE event stream processing for OpenCode Server
 * Extracted from OpenCodeServerClient to improve maintainability
 */
export class StreamHandler {
	private config: OpenCodeServerConfig;
	private errorHandler: ErrorHandler;
	private sdkClient: OpenCodeClient;
	private lastEventId: string | null = null;

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
	private permissionRequestCallbacks: Array<
		(sessionId: string, requestId: string, operation: string, resourcePath: string, context?: unknown) => void
	> = [];

	// Session state tracking (references to client state)
	private sessionState: {
		promptInFlightSessionId: string | null;
		sessions: Map<string, any>;
		currentSessionId: string | null;
	};
	private clearPromptInFlightCallback?: (sessionId: string | null) => void;

	constructor(
		config: OpenCodeServerConfig,
		errorHandler: ErrorHandler,
		sdkClient: OpenCodeClient,
		sessionState: {
			promptInFlightSessionId: string | null;
			sessions: Map<string, any>;
			currentSessionId: string | null;
		},
		clearPromptInFlightCallback?: (sessionId: string | null) => void,
	) {
		this.config = config;
		this.errorHandler = errorHandler;
		this.sdkClient = sdkClient;
		this.sessionState = sessionState;
		this.clearPromptInFlightCallback = clearPromptInFlightCallback;
	}

	/**
	 * Subscribe to stream token events
	 */
	onStreamToken(
		callback: (sessionId: string, token: string, done: boolean) => void,
	): void {
		this.streamTokenCallbacks.push(callback);
	}

	/**
	 * Subscribe to stream thinking events
	 */
	onStreamThinking(
		callback: (sessionId: string, content: string) => void,
	): void {
		this.streamThinkingCallbacks.push(callback);
	}

	/**
	 * Subscribe to error events
	 */
	onError(callback: (error: Error) => void): void {
		this.errorCallbacks.push(callback);
	}

	/**
	 * Subscribe to progress update events
	 */
	onProgressUpdate(
		callback: (sessionId: string, progress: ProgressUpdate) => void,
	): void {
		this.progressUpdateCallbacks.push(callback);
	}

	/**
	 * Subscribe to session end events
	 */
	onSessionEnd(callback: (sessionId: string, reason?: string) => void): void {
		this.sessionEndCallbacks.push(callback);
	}

	/**
	 * Subscribe to permission request events
	 */
	onPermissionRequest(
		callback: (sessionId: string, requestId: string, operation: string, resourcePath: string, context?: unknown) => void,
	): void {
		this.permissionRequestCallbacks.push(callback);
	}

	/**
	 * Get last event ID for SSE reconnection
	 */
	getLastEventId(): string | null {
		return this.lastEventId;
	}

	/**
	 * Set last event ID for SSE reconnection
	 */
	setLastEventId(eventId: string | null): void {
		this.lastEventId = eventId;
	}

	/**
	 * Update session state references
	 */
	updateSessionState(sessionState: {
		promptInFlightSessionId: string | null;
		sessions: Map<string, any>;
		currentSessionId: string | null;
	}): void {
		this.sessionState = sessionState;
	}

	/**
	 * Check if Node.js event stream can be used
	 */
	canUseNodeEventStream(): boolean {
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

	/**
	 * Get Node.js require function if available
	 */
	private getNodeRequire(): ((id: string) => unknown) | null {
		const nodeRequire = (
			globalThis as { require?: (id: string) => unknown }
		).require;
		return typeof nodeRequire === "function" ? nodeRequire : null;
	}

	/**
	 * Create event stream (SDK or Node.js based)
	 */
	async createEventStream(
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

	/**
	 * Create Node.js-based event stream
	 */
	private async createNodeEventStream(
		signal: AbortSignal,
	): Promise<AsyncGenerator<any, any, unknown>> {
		const eventUrl = new URL("/event", `${this.config.url}/`);
		return this.nodeEventStream(eventUrl, signal);
	}

	/**
	 * Node.js event stream implementation using native HTTP/HTTPS modules
	 */
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
				const parsed = safeJsonParse(rawData, rawData);
				yield parsed;
			}
		}
	}

	/**
	 * Process events from the SDK event stream
	 */
	async processEventStream(
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
					module: "StreamHandler",
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
	 * Extract session ID from SDK event object
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
						return;

					case "session.idle":
					case "session.completed":
						this.handleSessionIdle(sessionId);
						return;

					case "session.progress":
						this.handleSessionProgress(event, sessionId);
						return;

					case "session.ended":
					case "session.aborted":
						this.handleSessionEnded(event, sessionId);
						return;

					case "permission.request":
						this.handlePermissionRequest(event, sessionId);
						return;

					default:
						console.debug(
							"[StreamHandler] Unhandled event type:",
							event.type,
						);
						return;
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
					module: "StreamHandler",
					function: "handleSDKEvent",
					operation: "Processing SDK event",
					metadata: { eventType: event.type },
				},
				ErrorSeverity.Warning,
			);
		}
	}

	/**
	 * Safely invoke callbacks with error handling
	 */
	private invokeCallbacks<T extends any[]>(
		callbacks: Array<(...args: T) => void>,
		args: T,
		callbackType: string,
	): void {
		callbacks.forEach((callback) => {
			try {
				callback(...args);
			} catch (error) {
				console.warn(`[StreamHandler] Error in ${callbackType} callback:`, error);
			}
		});
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
		const content = delta || (part?.text || "");

		if (part?.type === "text" || (!part?.type && content)) {
			this.invokeCallbacks(this.streamTokenCallbacks, [sessionId, content, false], "stream token");
		} else if (part?.type === "reasoning" || part?.type === "thinking") {
			this.invokeCallbacks(this.streamThinkingCallbacks, [sessionId, content], "stream thinking");
		}
	}

	/**
	 * Handle assistant message events (alternative format)
	 */
	private handleAssistantMessage(event: any, sessionId: string): void {
		if (event.parts && Array.isArray(event.parts)) {
			for (const part of event.parts) {
				if (part.type === "text" && part.text) {
					this.invokeCallbacks(this.streamTokenCallbacks, [sessionId, part.text, false], "stream token");
				} else if (part.type === "reasoning" && part.text) {
					this.invokeCallbacks(this.streamThinkingCallbacks, [sessionId, part.text], "stream thinking");
				}
			}
		}
	}

	/**
	 * Handle session.idle events for completion
	 */
	private handleSessionIdle(sessionId: string): void {
		if (this.clearPromptInFlightCallback) {
			this.clearPromptInFlightCallback(sessionId);
		}
		this.invokeCallbacks(this.streamTokenCallbacks, [sessionId, "", true], "stream token completion");
	}

	/**
	 * Handle session progress events
	 */
	private handleSessionProgress(event: any, sessionId: string): void {
		const progress = event.data?.progress || event.progress;
		if (progress) {
			this.invokeCallbacks(this.progressUpdateCallbacks, [sessionId, progress], "progress update");
		}
	}

	/**
	 * Handle session ended events
	 */
	private handleSessionEnded(event: any, sessionId: string): void {
		const reason = event.data?.reason || event.reason || "completed";

		this.sessionState.sessions.delete(sessionId);
		if (this.sessionState.currentSessionId === sessionId) {
			this.sessionState.currentSessionId = null;
		}
		if (this.clearPromptInFlightCallback) {
			this.clearPromptInFlightCallback(sessionId);
		}

		this.invokeCallbacks(this.sessionEndCallbacks, [sessionId, reason], "session end");
	}

	/**
	 * Handle permission request events from the server
	 */
	private handlePermissionRequest(event: any, sessionId: string): void {
		// Extract data from event - check both properties and data fields
		const eventData = event.properties || event.data || event;
		const { requestId, operation, resourcePath, context } = eventData;

		// Validate required fields
		if (!requestId || !operation || !resourcePath) {
			console.warn(
				"[StreamHandler] Malformed permission.request event - missing required fields:",
				{ requestId, operation, resourcePath, event },
			);
			return;
		}

		this.invokeCallbacks(
			this.permissionRequestCallbacks,
			[sessionId, requestId, operation, resourcePath, context],
			"permission request",
		);
	}

	/**
	 * Handle SDK client errors
	 */
	private handleSDKError(error: Error): void {
		this.errorHandler.handleError(
			error,
			{
				module: "StreamHandler",
				function: "handleSDKError",
				operation: "SDK event error",
			},
			ErrorSeverity.Error,
		);

		this.invokeCallbacks(this.errorCallbacks, [error], "error");
	}
}
