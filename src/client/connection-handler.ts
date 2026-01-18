import { requestUrl } from "obsidian";
import { ErrorHandler, ErrorSeverity } from "../utils/error-handler";
import type {
	OpenCodeServerConfig,
	ConnectionState,
	ReconnectAttemptInfo,
	HealthCheckResult,
} from "./types";

/**
 * Handles connection state management and health checks for OpenCode Server
 * Extracted from OpenCodeServerClient to improve maintainability
 */
export class ConnectionHandler {
	private config: OpenCodeServerConfig;
	private errorHandler: ErrorHandler;
	private connectionState: ConnectionState = "disconnected";
	private healthStatus: boolean | null = null;
	private lastHealthCheckTime: number | null = null;
	private lastConnectionError: Error | null = null;
	private eventStreamAbort: AbortController | null = null;

	// Connection state callbacks
	private connectionStateCallbacks: Array<
		(state: ConnectionState, info?: { error?: Error | null }) => void
	> = [];
	private reconnectAttemptCallbacks: Array<(info: ReconnectAttemptInfo) => void> =
		[];
	private healthStatusCallbacks: Array<(isHealthy: boolean | null) => void> = [];

	constructor(config: OpenCodeServerConfig, errorHandler: ErrorHandler) {
		this.config = config;
		this.errorHandler = errorHandler;
	}

	/**
	 * Subscribe to connection state changes
	 */
	onConnectionStateChange(
		callback: (state: ConnectionState, info?: { error?: Error | null }) => void,
	): () => void {
		this.connectionStateCallbacks.push(callback);
		return () => {
			const index = this.connectionStateCallbacks.indexOf(callback);
			if (index > -1) {
				this.connectionStateCallbacks.splice(index, 1);
			}
		};
	}

	/**
	 * Subscribe to reconnect attempt info (next delay, attempt count)
	 */
	onReconnectAttempt(callback: (info: ReconnectAttemptInfo) => void): () => void {
		this.reconnectAttemptCallbacks.push(callback);
		return () => {
			const index = this.reconnectAttemptCallbacks.indexOf(callback);
			if (index > -1) {
				this.reconnectAttemptCallbacks.splice(index, 1);
			}
		};
	}

	/**
	 * Get last connection error
	 */
	getLastConnectionError(): Error | null {
		return this.lastConnectionError;
	}

	/**
	 * Subscribe to health status changes
	 */
	onHealthStatusChange(callback: (isHealthy: boolean | null) => void): () => void {
		this.healthStatusCallbacks.push(callback);
		return () => {
			const index = this.healthStatusCallbacks.indexOf(callback);
			if (index > -1) {
				this.healthStatusCallbacks.splice(index, 1);
			}
		};
	}

	/**
	 * Get current health status
	 */
	getHealthStatus(): boolean | null {
		return this.healthStatus;
	}

	/**
	 * Update health status and notify listeners
	 */
	private setHealthStatus(status: boolean | null): void {
		if (this.healthStatus === status) {
			return;
		}
		this.healthStatus = status;
		this.lastHealthCheckTime = Date.now();
		for (const callback of this.healthStatusCallbacks) {
			try {
				callback(status);
			} catch (error) {
				this.errorHandler.handleError(
					error,
					{
						module: "ConnectionHandler",
						function: "setHealthStatus",
						operation: "Notifying health status listeners",
						metadata: { status },
					},
					ErrorSeverity.Warning,
				);
			}
		}
	}

	/**
	 * Set connection state and notify listeners
	 */
	setConnectionState(
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
						module: "ConnectionHandler",
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
	 * Check if client is connected
	 */
	isConnected(): boolean {
		return this.connectionState === "connected";
	}

	/**
	 * Notify reconnect attempt listeners
	 */
	notifyReconnectAttempt(info: ReconnectAttemptInfo): void {
		for (const callback of this.reconnectAttemptCallbacks) {
			try {
				callback(info);
			} catch (callbackError) {
				this.errorHandler.handleError(
					callbackError,
					{
						module: "ConnectionHandler",
						function: "notifyReconnectAttempt",
						operation: "Notifying reconnect attempt listeners",
						metadata: {
							attempt: info.attempt,
							nextDelayMs: info.nextDelayMs,
						},
					},
					ErrorSeverity.Warning,
				);
			}
		}
	}

	/**
	 * Calculate reconnection delay with exponential backoff and jitter
	 */
	calculateReconnectDelay(attempt: number): number {
		const baseDelay = this.config.reconnectDelay ?? 1000;
		const maxDelay = 30000;
		const maxAttempts = this.config.reconnectMaxAttempts ?? 10;

		const cappedAttempt =
			maxAttempts === 0 ? attempt : Math.min(attempt, maxAttempts);
		const delayBase = Math.min(
			baseDelay * 2 ** (cappedAttempt - 1),
			maxDelay,
		);
		const jitter = Math.floor(
			Math.random() * Math.max(1, Math.floor(delayBase * 0.25)),
		);

		return delayBase + jitter;
	}

	/**
	 * Check if should continue reconnecting
	 */
	shouldReconnect(attempt: number): boolean {
		const shouldReconnect = this.config.autoReconnect ?? true;
		if (!shouldReconnect) {
			return false;
		}

		const maxAttempts = this.config.reconnectMaxAttempts ?? 10;
		return maxAttempts === 0 || attempt < maxAttempts;
	}

	/**
	 * Get server configuration
	 */
	getConfig(): OpenCodeServerConfig {
		return { ...this.config };
	}

	/**
	 * Update server configuration
	 */
	updateConfig(config: Partial<OpenCodeServerConfig>): void {
		this.config = { ...this.config, ...config };
	}

	/**
	 * Connect to OpenCode Server
	 * Sets connection state to connecting and returns immediately
	 * Actual connection happens asynchronously via event loop
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
	}

	/**
	 * Disconnect from OpenCode Server
	 * Aborts event stream and cleans up connection state
	 */
	async disconnect(): Promise<void> {
		this.eventStreamAbort?.abort();
		this.eventStreamAbort = null;
		this.setConnectionState("disconnected", { error: null });
		console.debug("[ConnectionHandler] Disconnected from OpenCode Server");
	}

	/**
	 * Start event stream subscription with reconnection logic
	 * @param createStreamFn - Function to create the event stream
	 * @param processStreamFn - Function to process events from the stream
	 */
	async startEventLoop(
		createStreamFn: (signal: AbortSignal) => Promise<AsyncGenerator<any, any, unknown>>,
		processStreamFn: (stream: AsyncGenerator<any, any, unknown>) => Promise<void>,
	): Promise<void> {
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

					const stream = await createStreamFn(signal);

					if (this.connectionState !== "connected") {
						this.setConnectionState("connected");
						console.debug(
							"[ConnectionHandler] Connected to OpenCode Server",
						);
					}
					attempt = 0;
					await processStreamFn(stream);

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

					// Before reconnecting, check if server is actually available
					// This prevents infinite reconnection attempts when server is completely unavailable
					const healthCheckResult = await this.healthCheck();
					if (!healthCheckResult.isHealthy) {
						// If server is unavailable, stop reconnecting immediately
						const err = new Error(`OpenCode Server is unavailable. Stopping reconnection attempts. ${healthCheckResult.error ? `Error: ${healthCheckResult.error}` : ''}`);
						this.lastConnectionError = err;
						this.setConnectionState("error", { error: err });
						throw err;
					}

					this.notifyReconnectAttempt({
						attempt: cappedAttempt,
						nextDelayMs: delay,
						maxAttempts,
					});

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
					module: "ConnectionHandler",
					function: "startEventLoop",
					operation: "Event subscription setup",
				},
				ErrorSeverity.Error,
			);
			throw error;
		}
	}

	/**
	 * Get abort controller for event stream
	 */
	getEventStreamAbort(): AbortController | null {
		return this.eventStreamAbort;
	}

	/**
	 * Perform health check on OpenCode Server
	 */
	async healthCheck(): Promise<HealthCheckResult> {
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
					this.setHealthStatus(false);
					return {
						isHealthy: false,
						error: errorMessage,
					};
				}

				// For other errors (connection errors, etc.), log but don't show to user
				this.errorHandler.handleError(
					requestError,
					{
						module: "ConnectionHandler",
						function: "healthCheck",
						operation: "Health check request",
						metadata: { url: healthUrl },
					},
					ErrorSeverity.Warning,
				);
				this.setHealthStatus(false);
				return {
					isHealthy: false,
					error: errorMessage,
				};
			}

			const isHealthy = response.status >= 200 && response.status < 300;
			if (!isHealthy) {
				// Log non-2xx status as warning via error handler (not console)
				this.errorHandler.handleError(
					new Error(`Health check returned status ${response.status}`),
					{
						module: "ConnectionHandler",
						function: "healthCheck",
						operation: "Health check response",
						metadata: { url: healthUrl, status: response.status },
					},
					ErrorSeverity.Warning,
				);
			}

			this.setHealthStatus(isHealthy);
			return {
				isHealthy,
				statusCode: response.status,
			};
		} catch (error) {
			// Check if this is a JSON parsing error that bypassed inner catch
			const errorMessage = error instanceof Error ? error.message : String(error);
			const isJsonParseError = errorMessage.includes("not valid JSON") ||
				errorMessage.includes("Unexpected token");
			if (isJsonParseError) {
				// JSON parse error bypassed inner catch - treat as unhealthy without logging
				this.setHealthStatus(false);
				return {
					isHealthy: false,
					error: errorMessage,
				};
			}
			// All errors are handled via error handler (Warning severity to avoid user notifications)
			this.errorHandler.handleError(
				error,
				{
					module: "ConnectionHandler",
					function: "healthCheck",
					operation: "Health check",
					metadata: { serverUrl: this.config.url },
				},
				ErrorSeverity.Warning,
			);
			this.setHealthStatus(false);
			return {
				isHealthy: false,
				error: errorMessage,
			};
		}
	}

	/**
	 * Sleep for specified duration
	 */
	private sleep(durationMs: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, durationMs));
	}
}
