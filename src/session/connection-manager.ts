import type {
	ConnectionState,
	ReconnectAttemptInfo,
	ConnectionQualityMetrics
} from "../client/types";
import type { OpenCodeServerClient } from "../client/client";
import { ErrorSeverity, type ErrorHandler } from "../utils/error-handler";

export interface ConnectionDiagnostics {
	state: ConnectionState;
	lastError: Error | null;
	lastReconnectAttempt: ReconnectAttemptInfo | null;
	qualityMetrics?: ConnectionQualityMetrics;
}

type Unsubscribe = () => void;

export class ConnectionManager {
	private client: OpenCodeServerClient;
	private errorHandler: ErrorHandler;
	private state: ConnectionState = "disconnected";
	private lastError: Error | null = null;
	private lastReconnectAttempt: ReconnectAttemptInfo | null = null;
	private qualityMetrics: ConnectionQualityMetrics = {
		latency: 0,
		reconnectCount: 0,
		connectedDuration: 0,
		lastPingTime: 0
	};
	private connectionStartTime: number | null = null;
	private stateListeners: Array<(diagnostics: ConnectionDiagnostics) => void> = [];

	constructor(client: OpenCodeServerClient, errorHandler: ErrorHandler) {
		this.client = client;
		this.errorHandler = errorHandler;
		this.state = client.getConnectionState();
		this.lastError = client.getLastConnectionError();

		this.client.onConnectionStateChange((state, info) => {
			this.state = state;
			this.lastError = info?.error ?? client.getLastConnectionError();
			
			// 更新连接开始时间
			if (state === "connected") {
				this.connectionStartTime = Date.now();
			} else if (state === "disconnected" || state === "error") {
				this.connectionStartTime = null;
			}
			
			this.notify();
		});

		this.client.onReconnectAttempt((info) => {
			this.lastReconnectAttempt = info;
			this.qualityMetrics.reconnectCount++;
			this.notify();
		});
	}

	getDiagnostics(): ConnectionDiagnostics {
		return {
			state: this.state,
			lastError: this.lastError,
			lastReconnectAttempt: this.lastReconnectAttempt,
			qualityMetrics: this.getQualityMetrics()
		};
	}

	/**
	 * 获取连接质量指标
	 */
	getQualityMetrics(): ConnectionQualityMetrics {
		// 更新连接时长
		if (this.connectionStartTime && this.state === "connected") {
			this.qualityMetrics.connectedDuration = 
				Math.floor((Date.now() - this.connectionStartTime) / 1000);
		}
		return { ...this.qualityMetrics };
	}

	/**
	 * 测量连接延迟
	 */
	async measureLatency(): Promise<number> {
		const start = Date.now();
		try {
			await this.client.healthCheck();
			const latency = Date.now() - start;
			this.qualityMetrics.latency = latency;
			this.qualityMetrics.lastPingTime = Date.now();
			return latency;
		} catch (error) {
			this.errorHandler.handleError(
				error,
				{ module: "ConnectionManager", function: "measureLatency" },
				ErrorSeverity.Warning
			);
			return -1; // 表示失败
		}
	}

	onDiagnosticsChange(
		listener: (diagnostics: ConnectionDiagnostics) => void,
	): Unsubscribe {
		this.stateListeners.push(listener);
		listener(this.getDiagnostics());
		return () => {
			this.stateListeners = this.stateListeners.filter((l) => l !== listener);
		};
	}

	private notify(): void {
		const diagnostics = this.getDiagnostics();
		for (const listener of this.stateListeners) {
			try {
				listener(diagnostics);
			} catch (error) {
				this.errorHandler.handleError(
					error,
					{
						module: "ConnectionManager",
						function: "notify",
						operation: "Notifying listeners",
						metadata: { state: diagnostics.state },
					},
					ErrorSeverity.Warning,
				);
			}
		}
	}

	async connect(): Promise<void> {
		await this.client.connect();
	}

	async disconnect(): Promise<void> {
		await this.client.disconnect();
	}

	async retry(): Promise<void> {
		if (this.state === "connected" || this.state === "connecting") {
			return;
		}
		await this.client.connect();
	}

	/**
	 * Ensure the underlying SSE connection is established.
	 * This waits until the client reports "connected" or "error", or times out.
	 */
	async ensureConnected(timeoutMs: number = 10000): Promise<void> {
		if (this.state === "connected") {
			return;
		}

		await this.client.connect();
		await this.waitForConnected(timeoutMs);
	}

	private waitForConnected(timeoutMs: number): Promise<void> {
		if (this.state === "connected") {
			return Promise.resolve();
		}
		if (this.state === "error") {
			return Promise.reject(
				this.lastError ?? new Error("OpenCode Server connection failed."),
			);
		}

		return new Promise<void>((resolve, reject) => {
			let done = false;
			let timeoutId: ReturnType<typeof setTimeout> | null = null;

			const unsubscribe = this.onDiagnosticsChange((diagnostics) => {
				if (done) {
					return;
				}
				if (diagnostics.state === "connected") {
					done = true;
					if (timeoutId) {
						clearTimeout(timeoutId);
					}
					unsubscribe();
					resolve();
					return;
				}
				if (diagnostics.state === "error") {
					done = true;
					if (timeoutId) {
						clearTimeout(timeoutId);
					}
					unsubscribe();
					reject(
						diagnostics.lastError ??
							new Error("OpenCode Server connection failed."),
					);
				}
			});

			if (timeoutMs > 0) {
				timeoutId = setTimeout(() => {
					if (done) {
						return;
					}
					done = true;
					unsubscribe();
					reject(
						new Error(
							`OpenCode Server connection timed out after ${timeoutMs}ms.`,
						),
					);
				}, timeoutMs);
			}
		});
	}
}

