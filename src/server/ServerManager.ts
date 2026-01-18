import { spawn, ChildProcess } from "child_process";
import { ErrorHandler, ErrorSeverity } from "../utils/error-handler";
import { 
	ServerState, 
	ServerManagerConfig, 
	HealthCheckResult, 
	ServerError,
	ServerStateChangeEvent 
} from "./types";

export class ServerManager {
	private process: ChildProcess | null = null;
	private state: ServerState = "stopped";
	private lastError: ServerError | null = null;
	private earlyExitCode: number | null = null;
	private config: ServerManagerConfig;
	private errorHandler: ErrorHandler;
	private onStateChange: (event: ServerStateChangeEvent) => void;

	constructor(
		config: ServerManagerConfig,
		errorHandler: ErrorHandler,
		onStateChange: (event: ServerStateChangeEvent) => void
	) {
		this.config = config;
		this.errorHandler = errorHandler;
		this.onStateChange = onStateChange;
		
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
				this.errorHandler.handleError(
				new Error(`Process exited with code ${code}, signal ${signal}`),
				{ module: "ServerManager", function: "process.exit" },
				ErrorSeverity.Info
			);
				this.process = null;

				if (this.state === "starting" && code !== null && code !== 0) {
					this.earlyExitCode = code;
				}

				if (this.state === "running") {
					this.setState("stopped", null);
				}
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
		try {
			const response = await fetch(`${this.getUrl()}/health`, {
				method: "GET",
				signal: AbortSignal.timeout(2000),
			});
			
			this.errorHandler.handleError(
			new Error(`Health check result: ${response.status} ${response.statusText}`),
			{ module: "ServerManager", function: "checkServerHealth" },
			ErrorSeverity.Info
		);
			
			return {
				isHealthy: response.ok,
				statusCode: response.status
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
				error: errorMsg
			};
		}
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
