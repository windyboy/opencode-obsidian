/**
 * Type index file
 * Re-exports all public types for convenient importing
 */

// Global types
export * from '../types';

// Client types (excluding Agent and Message which conflict with global types)
export type {
	Session,
	Part,
	Provider,
	AssistantMessage,
	UserMessage,
	OpenCodeClient,
	ConnectionState,
	ReconnectAttemptInfo,
	SessionContext,
	ProgressUpdate,
	OpenCodeServerConfig,
	HealthCheckResult,
	ConnectionQualityMetrics,
} from '../client/types';

// Tools types
export * from '../tools/obsidian/types';

// Todo types
export * from '../todo/types';

// Embedded server types
export * from '../embedded-server/types';

// Session event types
export type {
	StreamTokenEvent,
	StreamThinkingEvent,
	ProgressUpdateEvent,
	SessionEndEvent,
	PermissionRequestEvent,
	ErrorEvent,
} from '../session/session-event-bus';
