import { spawn, ChildProcess } from "child_process";
import { ErrorHandler, ErrorSeverity } from "../utils/error-handler";
import { 
	ServerState, 
	ServerManagerConfig, 
	HealthCheckResult, 
	ServerError,
	ServerStateChangeEvent,
	ProcessMetrics
} from "./types";

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
	private metrics: ProcessMetrics | null = null;
	private metricsInterval: ReturnType<typeof setInterval> | null = null;

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
				this.restartAttempts = 0;  // 重置重启计数
				this.startMetricsCollection();  // 开始收集指标
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
		this.stopMetricsCollection();  // 停止收集指标
		
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
		try {
			const checkedEndpoints: string[] = ["/health"];
			
			// 1. 基础健康检查
			const healthResponse = await fetch(`${this.getUrl()}/health`, {
				method: "GET",
				signal: AbortSignal.timeout(2000),
			});

			if (!healthResponse.ok) {
				return {
					isHealthy: false,
					statusCode: healthResponse.status,
					error: `Health endpoint returned ${healthResponse.status}`,
					checkedEndpoints
				};
			}

			// 2. 验证关键端点（可选，避免过度检查）
			try {
				checkedEndpoints.push("/sessions");
				const sessionsResponse = await fetch(`${this.getUrl()}/sessions`, {
					method: "GET",
					signal: AbortSignal.timeout(2000),
				});

				if (!sessionsResponse.ok) {
					return {
						isHealthy: false,
						statusCode: sessionsResponse.status,
						error: "Sessions endpoint not responding",
						checkedEndpoints
					};
				}
			} catch (sessionError) {
				// 如果/sessions检查失败，记录警告但仍认为健康检查通过
				this.errorHandler.handleError(
					new Error(`Sessions endpoint check failed: ${sessionError instanceof Error ? sessionError.message : "Unknown error"}`),
					{ module: "ServerManager", function: "checkServerHealth" },
					ErrorSeverity.Warning
				);
			}

			this.errorHandler.handleError(
				new Error(`Health check passed for endpoints: ${checkedEndpoints.join(", ")}`),
				{ module: "ServerManager", function: "checkServerHealth" },
				ErrorSeverity.Info
			);
			
			return {
				isHealthy: true,
				statusCode: healthResponse.status,
				checkedEndpoints
			};
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			this.errorHandler.handleError(
				new Error(`Health check failed: ${errorMsg}`),
				{ module: "ServerManager", function: "checkServerHealth" },
				ErrorSeverity.Info
			);
			
			return {
				isHealthy: false,
				error: errorMsg,
				checkedEndpoints: ["/health"]
			};
		}
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
			void this.start();
		}, delay);
	}

	/**
	 * 计算指数退避延迟
	 */
	private calculateBackoffDelay(attempt: number): number {
		// 指数退避: 1s, 2s, 4s
		return Math.min(1000 * Math.pow(2, attempt - 1), 4000);
	}

	/**
	 * 开始收集进程指标
	 */
	private startMetricsCollection(): void {
		// 每 30 秒采集一次（避免过度消耗资源）
		this.metricsInterval = setInterval(() => {
			void this.collectMetrics();
		}, 30000);
	}

	/**
	 * 停止收集进程指标
	 */
	private stopMetricsCollection(): void {
		if (this.metricsInterval) {
			clearInterval(this.metricsInterval);
			this.metricsInterval = null;
		}
		this.metrics = null;
	}

	/**
	 * 收集进程指标
	 */
	private async collectMetrics(): Promise<void> {
		if (!this.process || !this.process.pid) {
			return;
		}

		try {
			// 使用 Node.js 内置 API
			const usage = process.cpuUsage();
			const memUsage = process.memoryUsage();

			this.metrics = {
				cpu: (usage.user + usage.system) / 1000000, // 转换为秒
				memory: memUsage.rss / 1024 / 1024,         // 转换为 MB
				uptime: process.uptime(),
				timestamp: Date.now()
			};

			// 记录到日志（仅在异常时）
			if (this.metrics.memory > 500) {  // 超过 500MB 警告
				this.errorHandler.handleError(
					new Error(`High memory usage: ${this.metrics.memory.toFixed(2)} MB`),
					{ module: "ServerManager", function: "collectMetrics" },
					ErrorSeverity.Warning
				);
			}
		} catch (error) {
			// 静默失败，不影响主流程
		}
	}

	/**
	 * 获取当前进程指标
	 */
	public getMetrics(): ProcessMetrics | null {
		return this.metrics;
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
