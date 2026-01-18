/**
 * OpenCode Client Types for Obsidian Plugin
 * Minimal type definitions specific to Obsidian integration
 */

// Re-export types from the official SDK client
export type {
	Session,
	Message,
	Part,
	Provider,
	Agent,
	AssistantMessage,
	UserMessage,
} from "@opencode-ai/sdk/client";
export type { OpenCodeClient } from "./client";

/**
 * Connection state
 */
export type ConnectionState =
	| "disconnected"
	| "connecting"
	| "connected"
	| "reconnecting"
	| "error";

export interface ReconnectAttemptInfo {
	attempt: number;
	nextDelayMs: number;
	maxAttempts: number;
}

/**
 * Session context information for Obsidian
 */
export interface SessionContext {
	currentNote?: string;
	selection?: string;
	links?: string[];
	tags?: string[];
	properties?: Record<string, unknown>;
}

/**
 * Progress update information
 */
export interface ProgressUpdate {
	message: string;
	stage?: string;
	progress?: number;
}

/**
 * OpenCode Server client configuration
 */
export interface OpenCodeServerConfig {
	/** Base HTTP URL for OpenCode Server */
	url: string;
	/** Force SDK fetch-based SSE instead of Node http/https */
	forceSdkEventStream?: boolean;
	/** HTTP request timeout in milliseconds (0 = no timeout, default: 30000) */
	requestTimeoutMs?: number;
	/** Whether to automatically reconnect on connection loss (default: true) */
	autoReconnect?: boolean;
	/** Delay between reconnection attempts in milliseconds (default: 3000) */
	reconnectDelay?: number;
	/** Maximum number of reconnection attempts (default: 10, 0 = unlimited) */
	reconnectMaxAttempts?: number;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
	/** Whether the server is healthy */
	isHealthy: boolean;
	/** HTTP status code (only for successful responses) */
	statusCode?: number;
	/** Error message (only for failed responses) */
	error?: string;
}

/**
 * Connection quality metrics
 */
export interface ConnectionQualityMetrics {
	/** Average latency in milliseconds */
	latency: number;
	/** Number of reconnect attempts */
	reconnectCount: number;
	/** Connected duration in seconds */
	connectedDuration: number;
	/** Last ping timestamp */
	lastPingTime: number;
}
