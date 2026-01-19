import { spawn, ChildProcess, execSync } from "child_process";
import { ErrorHandler, ErrorSeverity } from "../utils/error-handler";
import { 
	ServerState, 
	ServerManagerConfig, 
	HealthCheckResult, 
	ServerError,
	ServerStateChangeEvent
} from "./types";
import { performHealthCheck } from "../utils/health-check";

/**
 * Find executable path (node, bun, etc.)
 * Tries common locations and PATH lookup
 */
function findExecutablePath(executable: string): string | null {
	// Common paths on macOS/Linux
	const commonPaths = [
		`/usr/local/bin/${executable}`,
		`/opt/homebrew/bin/${executable}`, // Apple Silicon Homebrew
		`/usr/bin/${executable}`,
		`/opt/${executable}/bin/${executable}`,
		`${process.env.HOME}/.bun/bin/${executable}`, // Bun user install
		`${process.env.HOME}/.local/bin/${executable}`,
	];

	// Try common paths first
	for (const path of commonPaths) {
		try {
			execSync(`test -x "${path}"`, { stdio: "ignore" });
			return path;
		} catch {
			// Path doesn't exist or not executable
		}
	}

	// Try to find in PATH
	try {
		const execPath = execSync(`which ${executable}`, { encoding: "utf-8" }).trim();
		if (execPath) {
			return execPath;
		}
	} catch {
		// which command failed or executable not in PATH
	}

	return null;
}

/**
 * Build environment variables with node and bun in PATH
 */
function buildEnvWithNodeAndBun(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	const pathsToAdd: string[] = [];
	
	// Find and add node
	const nodePath = findExecutablePath("node");
	if (nodePath) {
		const nodeDir = nodePath.replace(/\/node$/, "");
		pathsToAdd.push(nodeDir);
		// #region agent log
		fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:findExecutablePath',message:'Node path found',data:{nodePath,nodeDir},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
		// #endregion
	}
	
	// Find and add bun
	const bunPath = findExecutablePath("bun");
	if (bunPath) {
		const bunDir = bunPath.replace(/\/bun$/, "");
		pathsToAdd.push(bunDir);
		// #region agent log
		fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:findExecutablePath',message:'Bun path found',data:{bunPath,bunDir},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
		// #endregion
	}
	
	// Also check for bunx
	const bunxPath = findExecutablePath("bunx");
	if (bunxPath) {
		const bunxDir = bunxPath.replace(/\/bunx$/, "");
		if (!pathsToAdd.includes(bunxDir)) {
			pathsToAdd.push(bunxDir);
		}
		// #region agent log
		fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:findExecutablePath',message:'Bunx path found',data:{bunxPath,bunxDir},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
		// #endregion
	}
	
	if (pathsToAdd.length > 0) {
		const currentPath = env.PATH || "";
		// Prepend found directories to PATH
		env.PATH = `${pathsToAdd.join(":")}:${currentPath}`;
		// #region agent log
		fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:buildEnvWithNodeAndBun',message:'Updated PATH with node and bun',data:{newPath:env.PATH,addedPaths:pathsToAdd},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
		// #endregion
	} else {
		// #region agent log
		fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:buildEnvWithNodeAndBun',message:'No node or bun found in PATH',data:{currentPath:env.PATH},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
		// #endregion
	}
	
	return env;
}

export class ServerManager {
	private process: ChildProcess | null = null;
	private state: ServerState = "stopped";
	private lastError: ServerError | null = null;
	private earlyExitCode: number | null = null;
	private config: ServerManagerConfig;
	private errorHandler: ErrorHandler;
	private onStateChange: (event: ServerStateChangeEvent) => void;

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
		// #region agent log
		fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:29',message:'initializeFromConfig entry',data:{useEmbeddedServer:config.useEmbeddedServer,opencodePath:config.opencodePath,port:config.embeddedServerPort,url:config.url},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
		// #endregion
		// 检查是否启用内嵌服务器
		if (!config.useEmbeddedServer) {
			// #region agent log
			fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:42',message:'useEmbeddedServer is false, returning null',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
			// #endregion
			return null;
		}

		// 创建服务器管理器
		const managerConfig = {
			opencodePath: config.opencodePath || "opencode",
			port: config.embeddedServerPort || 4096,
			hostname: "127.0.0.1",
			startupTimeout: 5000,
			workingDirectory: ".",
		};
		// #region agent log
		fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:52',message:'Creating ServerManager with config',data:{config:managerConfig},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
		// #endregion
		const manager = new ServerManager(
			managerConfig,
			errorHandler,
			onStateChange
		);

		// 启动服务器
		// #region agent log
		fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:59',message:'Calling manager.start()',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
		// #endregion
		const started = await manager.start();
		// #region agent log
		fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:62',message:'manager.start() returned',data:{started,state:manager.getState(),lastError:manager.getLastError()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
		// #endregion

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

		console.debug("[ServerManager] Initialized with config:", config);
	}

	updateConfig(config: Partial<ServerManagerConfig>): void {
		this.config = { ...this.config, ...config };
		console.debug("[ServerManager] Config updated:", this.config);
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
		// #region agent log
		fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:98',message:'start() entry',data:{currentState:this.state,config:this.config},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
		// #endregion
		if (this.state === "running" || this.state === "starting") {
			console.debug("[ServerManager] Server already running or starting, skipping start request");
			return true;
		}

		this.setState("starting", null);
		this.earlyExitCode = null;

		if (!this.config.workingDirectory) {
			// #region agent log
			fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:107',message:'Working directory not configured',data:{workingDirectory:this.config.workingDirectory},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
			// #endregion
			return this.setError("Working directory not configured");
		}

		// #region agent log
		fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:111',message:'Checking server health before start',data:{url:this.getUrl()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
		// #endregion
		const existingHealthCheck = await this.checkServerHealth();
		// #region agent log
		fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:113',message:'Health check result before start',data:{isHealthy:existingHealthCheck.isHealthy,error:existingHealthCheck.error},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
		// #endregion
		if (existingHealthCheck.isHealthy) {
			console.debug(`[ServerManager] Server already running on ${this.getUrl()}`);
			this.setState("running", null);
			return true;
		}

		console.debug(`[ServerManager] Starting OpenCode server at ${this.config.workingDirectory}:${this.config.port}`);

		try {
			// Parse opencodePath - support commands like "bunx opencode" or "npx opencode"
			const opencodePathParts = this.config.opencodePath.trim().split(/\s+/);
			const command = opencodePathParts[0];
			if (!command) {
				return this.setError("OpenCode executable path is empty");
			}
			const commandArgs = opencodePathParts.slice(1);
			
			const spawnArgs = [
				...commandArgs, // e.g., ["opencode"] if path is "bunx opencode"
				"serve",
				"--port",
				this.config.port.toString(),
				"--hostname",
				this.config.hostname,
				"--cors",
				"app://obsidian.md",
			];
			// #region agent log
			fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:220',message:'About to spawn process',data:{originalPath:this.config.opencodePath,command,commandArgs,spawnArgs,workingDirectory:this.config.workingDirectory},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
			// #endregion
			// Build environment with node and bun in PATH
			const envWithNodeAndBun = buildEnvWithNodeAndBun();
			// #region agent log
			fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:232',message:'Spawning process with env',data:{command,envPath:envWithNodeAndBun.PATH,hasNode:!!findExecutablePath('node'),hasBun:!!findExecutablePath('bun'),hasBunx:!!findExecutablePath('bunx')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
			// #endregion
			this.process = spawn(
				command,
				spawnArgs,
				{
					cwd: this.config.workingDirectory,
					env: envWithNodeAndBun,
					stdio: ["ignore", "pipe", "pipe"],
					detached: false,
				}
			);

			const proc = this.process;
			console.debug(`[ServerManager] Process spawned with PID: ${proc.pid}`);
			// #region agent log
			fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:239',message:'Process spawned',data:{pid:proc.pid,spawned:proc!==null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
			// #endregion

			proc.stdout?.on("data", (data) => {
				const output = data.toString().trim();
				console.debug("[OpenCodeServer] stdout:", output);
				// #region agent log
				fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:244',message:'Process stdout',data:{output},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
				// #endregion
			});

			proc.stderr?.on("data", (data) => {
				const output = data.toString().trim();
				// #region agent log
				fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:248',message:'Process stderr',data:{output},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
				// #endregion
				this.errorHandler.handleError(
				new Error(output),
				{ module: "OpenCodeServer", function: "stderr" },
				ErrorSeverity.Warning
			);
			});

			proc.on("exit", (code, signal) => {
				// #region agent log
				fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:256',message:'Process exit event',data:{code,signal,state:this.state},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
				// #endregion
				this.handleProcessExit(code, signal);
			});

			proc.on("error", (err: NodeJS.ErrnoException) => {
				// #region agent log
				fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:260',message:'Process error event',data:{code:err.code,message:err.message,name:err.name,path:err.path},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
				// #endregion
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

			// #region agent log
			fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:172',message:'Waiting for server to be ready',data:{timeout:this.config.startupTimeout},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
			// #endregion
			const ready = await this.waitForServerOrExit(this.config.startupTimeout);
			// #region agent log
			fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:175',message:'waitForServerOrExit returned',data:{ready,state:this.state,earlyExitCode:this.earlyExitCode,processExists:this.process!==null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
			// #endregion
			if (ready) {
				this.setState("running", null);
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
		console.debug(`[ServerManager] Stopping process with PID: ${proc.pid}`);

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
				checkSessionsEndpoint: false,
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
		console.debug(`[ServerManager] Process exited: code=${code}, signal=${signal}`);

		// 如果是正常停止，不处理
		if (this.state === "stopped") {
			return;
		}

		// 如果启动阶段失败，记录退出码
		if (this.state === "starting" && code !== null && code !== 0) {
			this.earlyExitCode = code;
			return;
		}

		// 运行中崩溃，设置状态为 stopped (不再自动重启)
		this.setState("stopped", null);
	}

	private setState(state: ServerState, error: ServerError | null): void {
		this.state = state;
		this.lastError = error;
		
		const event: ServerStateChangeEvent = {
			state,
			error: error || undefined,
			timestamp: Date.now()
		};
		
		console.debug(`[ServerManager] Server state changed: ${state}${error ? ` (error: ${error.message})` : ""}`);
		
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
				console.debug("[ServerManager] Process exited before server became ready");
				// #region agent log
				fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:300',message:'Process is null during wait',data:{elapsed:Date.now()-startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
				// #endregion
				return false;
			}

			// #region agent log
			fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:305',message:'Performing health check',data:{url:this.getUrl(),elapsed:Date.now()-startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
			// #endregion
			const healthCheckResult = await this.checkServerHealth();
			// #region agent log
			fetch('http://127.0.0.1:7243/ingest/c3197671-fe00-48d7-972f-f259c2c34eaa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ServerManager.ts:308',message:'Health check result',data:{isHealthy:healthCheckResult.isHealthy,error:healthCheckResult.error,statusCode:healthCheckResult.statusCode},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
			// #endregion
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
