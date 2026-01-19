/**
 * Server state enum
 */
export type ServerState = "stopped" | "starting" | "running" | "error";

/**
 * Server manager configuration interface
 */
export interface ServerManagerConfig {
	/** Path to the opencode executable */
	opencodePath: string;
	/** Port to run the server on */
	port: number;
	/** Hostname to bind to */
	hostname: string;
	/** Timeout for server startup (ms) */
	startupTimeout: number;
	/** Working directory */
	workingDirectory: string;
	/** Whether to automatically restart the server if it crashes */
	autoRestart?: boolean;
	/** Maximum number of restart attempts */
	maxRestartAttempts?: number;
}

/**
 * Re-export HealthCheckResult from client types to maintain consistency
 */
export type { HealthCheckResult } from "../client/types";

/**
 * Server error information
 */
export interface ServerError {
	/** Error message */
	message: string;
	/** Error code if available */
	code?: string;
	/** Original error if available */
	originalError?: unknown;
}



/**
 * Server state change event
 */
export interface ServerStateChangeEvent {
	/** New server state */
	state: ServerState;
	/** Error information if state is error */
	error?: ServerError;
	/** Timestamp of the state change */
	timestamp: number;
}
