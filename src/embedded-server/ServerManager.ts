import { spawn, ChildProcess } from "child_process";
import { ErrorHandler, ErrorSeverity } from "../utils/error-handler";
import { 
	ServerState, 
	ServerManagerConfig, 
	HealthCheckResult, 
	ServerError,
	ServerStateChangeEvent
} from "./types";
import { performHealthCheck } from "../utils/health-check";

export class ServerManager {
	private process: ChildProcess | null = null;
	private state: ServerState = "stopped";
	private lastError: ServerError | null = null;
	private earlyExitCode: number | null = null;
	private config: ServerManagerConfig;
	private errorHandler: ErrorHandler;
	private onStateChange: (event: ServerStateChangeEvent) => void;
	private restartAttempts: number = 0;
	private maxRestartAttempts: number = 3;
	private autoRestartEnabled: boolean = true;

	/**
	 * 从配置初始化服务器管理器
	 * @param config 服务器配置
	 * @param errorHandler 错误处理器
	 * @param onStateChange 状态变化回调
	 * @param onUrlReady URL 就绪回调（服务器启动成功后调用）
	 * @returns ServerManager 实例，如果不使用内嵌服务器则返回 null
	 */
	static async initializeFromConfig(
		config: { 
			useEmbeddedServer?: boolean;
			url?: string;
			opencodePath?: string;
			embeddedServerPort?: number;
		}, 
		errorHandler: ErrorHandler,
		onStateChange: (event: ServerStateChangeEvent) => void,
		onUrlReady?: (url: string) => Promise<void>
	): Promise<ServerManager | null> {
		// 检查是否启用内嵌服务器
		if (!config.useEmbeddedServer) {
			return null;
		}

		// 创建服务器管理器
		const manager = new ServerManager(
			{
				opencodePath: config.opencodePath || "opencode",
				port: config.embeddedServerPort || 4096,
				hostname: "127.0.0.1",
				startupTimeout: 5000,
				workingDirectory: ".",
			},
			errorHandler,
			onStateChange
		);

		// 启动服务器
		const started = await manager.start();

		// 如果启动成功且提供了 URL 回调，则调用
		if (started && onUrlReady && !config.url) {
			await onUrlReady(manager.getUrl());
		}

		return started ? manager : null;
	}

	constructor(
		config: ServerManagerConfig,
		errorHandler: ErrorHandler,
		onStateChange: (event: ServerStateChangeEvent) => void
	) {
		this.config = config;
		this.errorHandler = errorHandler;
		this.onStateChange = onStateChange;
		this.autoRestartEnabled = config.autoRestart ?? true;
		this.maxRestartAttempts = config.maxRestartAttempts ?? 3;
		
		this.errorHandler.handleError(
		new Error(`ServerManager initialized with config: ${JSON.stringify(config)}`),
		{ module: "ServerManager", function: "constructor" },
		ErrorSeverity.Info
	);
	}

	updateConfig(config: Partial<ServerManagerConfig>): void {
		this.config = { ...this.config, ...config };
		this.errorHandler.handleError(
		new Error(`ServerManager config updated: ${JSON.stringify(this.config)}`),
		{ module: "ServerManager", function: "updateConfig" },
		ErrorSeverity.Info
	);
	}

	getState(): ServerState {
		return this.state;
	}

	getLastError(): ServerError | null {
		return this.lastError;
	}

	getUrl(): string {
		return `http://${this.config.hostname}:${this.config.port}`;
	}

	async start(): Promise<boolean> {
		if (this.state === "running" || this.state === "starting") {
			this.errorHandler.handleError(
				new Error("Server already running or starting, skipping start request"),
				{ module: "ServerManager", function: "start" },
				ErrorSeverity.Info
			);
			return true;
		}

		this.setState("starting", null);
		this.earlyExitCode = null;

		if (!this.config.workingDirectory) {
			return this.setError("Working directory not configured");
		}

		if (await this.checkServerHealth().then(result => result.isHealthy)) {
			this.errorHandler.handleError(
				new Error(`Server already running on ${this.getUrl()}`),
				{ module: "ServerManager", function: "start" },
				ErrorSeverity.Info
			);
			this.setState("running", null);
			return true;
		}

		this.errorHandler.handleError(
			new Error(`Starting OpenCode server at ${this.config.workingDirectory}:${this.config.port}`),
			{ module: "ServerManager", function: "start" },
			ErrorSeverity.Info
		);

		try {
			this.process = spawn(
				this.config.opencodePath,
				[
					"serve",
					"--port",
					this.config.port.toString(),
					"--hostname",
					this.config.hostname,
					"--cors",
					"app://obsidian.md",
				],
				{
					cwd: this.config.workingDirectory,
					env: { ...process.env },
					stdio: ["ignore", "pipe", "pipe"],
					detached: false,
				}
			);

			this.errorHandler.handleError(
			new Error(`Process spawned with PID: ${this.process.pid}`),
			{ module: "ServerManager", function: "start" },
			ErrorSeverity.Info
		);

			this.process.stdout?.on("data", (data) => {
				this.errorHandler.handleError(
				new Error(data.toString().trim()),
				{ module: "OpenCodeServer", function: "stdout" },
				ErrorSeverity.Info
			);
			});

			this.process.stderr?.on("data", (data) => {
				this.errorHandler.handleError(
				new Error(data.toString().trim()),
				{ module: "OpenCodeServer", function: "stderr" },
				ErrorSeverity.Warning
			);
			});

			this.process.on("exit", (code, signal) => {
				this.handleProcessExit(code, signal);
			});

			this.process.on("error", (err: NodeJS.ErrnoException) => {
				this.errorHandler.handleError(
					err,
					{ module: "ServerManager", function: "process.error" },
					ErrorSeverity.Error
				);
				this.process = null;

				if (err.code === "ENOENT") {
					this.setError(`Executable not found at '${this.config.opencodePath}'`, err.code, err);
				} else {
					this.setError(`Failed to start: ${err.message}`, err.code, err);
				}
			});

			const ready = await this.waitForServerOrExit(this.config.startupTimeout);
			if (ready) {
				this.setState("running", null);
				this.restartAttempts = 0;
				return true;
			}

			if (this.state === "error") {
				return false;
			}

			this.stop();
			if (this.earlyExitCode !== null) {
				return this.setError(`Process exited unexpectedly (exit code ${this.earlyExitCode})`);
			}
			if (!this.process) {
				return this.setError("Process exited before server became ready");
			}
			return this.setError("Server failed to start within timeout");
		} catch (error) {
			this.errorHandler.handleError(
				error as Error,
				{ module: "ServerManager", function: "start" },
				ErrorSeverity.Error
			);
			return this.setError(`Unexpected error: ${(error as Error).message}`, undefined, error);
		}
	}

	stop(): void {
		if (!this.process) {
			this.setState("stopped", null);
			return;
		}

		const proc = this.process;
		this.errorHandler.handleError(
			new Error(`Stopping process with PID: ${proc.pid}`),
			{ module: "ServerManager", function: "stop" },
			ErrorSeverity.Info
		);

		this.setState("stopped", null);
		this.process = null;

		proc.kill("SIGTERM");

		// Force kill after 2 seconds if still running
		setTimeout(() => {
			if (proc.exitCode === null && proc.signalCode === null) {
				this.errorHandler.handleError(
					new Error("Process still running, sending SIGKILL"),
					{ module: "ServerManager", function: "stop.forceKill" },
					ErrorSeverity.Warning
				);
				proc.kill("SIGKILL");
			}
		}, 2000);
	}

	async checkServerHealth(): Promise<HealthCheckResult> {
		return await performHealthCheck(
			{
				url: this.getUrl(),
				checkSessionsEndpoint: true,
				timeoutMs: 2000,
				useRequestUrl: false
			},
			this.errorHandler
		);
	}

	/**
	 * 处理进程退出事件
	 */
	private handleProcessExit(code: number | null, signal: string | null): void {
		this.process = null;

		// 记录退出信息
		this.errorHandler.handleError(
			new Error(`Process exited: code=${code}, signal=${signal}`),
			{ module: "ServerManager", function: "handleProcessExit" },
			ErrorSeverity.Info
		);

		// 如果是正常停止，不重启
		if (this.state === "stopped") {
			return;
		}

		// 如果启动阶段失败，记录退出码
		if (this.state === "starting" && code !== null && code !== 0) {
			this.earlyExitCode = code;
			return;
		}

		// 运行中崩溃，尝试自动重启
		if (this.state === "running" && this.autoRestartEnabled) {
			this.attemptAutoRestart();
		} else {
			this.setState("stopped", null);
		}
	}

	/**
	 * 尝试自动重启服务器
	 */
	private attemptAutoRestart(): void {
		if (this.restartAttempts >= this.maxRestartAttempts) {
			this.errorHandler.handleError(
				new Error(`Max restart attempts (${this.maxRestartAttempts}) reached`),
				{ module: "ServerManager", function: "attemptAutoRestart" },
				ErrorSeverity.Error
			);
			this.setState("error", {
				message: "Server crashed and failed to restart",
				code: "MAX_RESTART_ATTEMPTS"
			});
			return;
		}

		this.restartAttempts++;
		const delay = this.calculateBackoffDelay(this.restartAttempts);

		this.errorHandler.handleError(
			new Error(`Auto-restarting in ${delay}ms (attempt ${this.restartAttempts}/${this.maxRestartAttempts})`),
			{ module: "ServerManager", function: "attemptAutoRestart" },
			ErrorSeverity.Warning
		);

		setTimeout(() => {
			void this.start().catch(error => {
				// Log error but don't trigger max restart limit again
				// The error was already handled by start() method
				this.errorHandler.handleError(
					error instanceof Error ? error : new Error(String(error)),
					{
						module: "ServerManager",
						function: "attemptAutoRestart.restart",
						operation: `Restart attempt ${this.restartAttempts}`,
					},
					ErrorSeverity.Warning
				);
			});
		}, delay);
	}

	/**
	 * 计算指数退避延迟
	 */
	private calculateBackoffDelay(attempt: number): number {
		// 指数退避: 1s, 2s, 4s
		return Math.min(1000 * Math.pow(2, attempt - 1), 4000);
	}

	private setState(state: ServerState, error: ServerError | null): void {
		this.state = state;
		this.lastError = error;
		
		const event: ServerStateChangeEvent = {
			state,
			error: error || undefined,
			timestamp: Date.now()
		};
		
		this.errorHandler.handleError(
			new Error(`Server state changed: ${state} ${error ? `(error: ${error.message})` : ""}`),
			{ module: "ServerManager", function: "setState" },
			ErrorSeverity.Info
		);
		
		this.onStateChange(event);
	}

	private setError(message: string, code?: string, originalError?: unknown): false {
		const error: ServerError = {
			message,
			code,
			originalError
		};
		
		this.errorHandler.handleError(
			new Error(message),
			{ module: "ServerManager", function: "setError" },
			ErrorSeverity.Error
		);
		
		this.setState("error", error);
		return false;
	}

	private async waitForServerOrExit(timeoutMs: number): Promise<boolean> {
		const startTime = Date.now();
		const pollInterval = 500;

		while (Date.now() - startTime < timeoutMs) {
			if (!this.process) {
				this.errorHandler.handleError(
				new Error("Process exited before server became ready"),
				{ module: "ServerManager", function: "waitForServerOrExit" },
				ErrorSeverity.Info
			);
				return false;
			}

			const healthCheckResult = await this.checkServerHealth();
			if (healthCheckResult.isHealthy) {
				return true;
			}
			
			await this.sleep(pollInterval);
		}

		return false;
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
