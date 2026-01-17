import type { ProgressUpdate } from "../opencode-server/types";

/**
 * Event emitted when a stream token is received from the server.
 */
export interface StreamTokenEvent {
	/** ID of the session this token belongs to */
	sessionId: string;
	/** The token content */
	token: string;
	/** Whether this is the final token in the stream */
	done: boolean;
}

/**
 * Event emitted when thinking content is received from the server.
 */
export interface StreamThinkingEvent {
	/** ID of the session this thinking content belongs to */
	sessionId: string;
	/** The thinking content */
	content: string;
}

/**
 * Event emitted when a progress update is received from the server.
 */
export interface ProgressUpdateEvent {
	/** ID of the session this progress update belongs to */
	sessionId: string;
	/** The progress update details */
	progress: ProgressUpdate;
}

/**
 * Event emitted when a session ends.
 */
export interface SessionEndEvent {
	/** ID of the session that ended */
	sessionId: string;
	/** Optional reason for the session ending */
	reason?: string;
}

/**
 * Event emitted when the server requests permission for an operation.
 * 
 * This event is triggered when the OpenCode Server needs user approval
 * to perform an operation on the vault (read, write, delete, etc.).
 */
export interface PermissionRequestEvent {
	/** ID of the session the request belongs to */
	sessionId: string;
	/** Unique identifier for this permission request */
	requestId: string;
	/** Type of operation being requested (e.g., 'read', 'write', 'delete') */
	operation: string;
	/** Path to the resource being accessed */
	resourcePath: string;
	/** Optional additional context about the request */
	context?: {
		/** Name of the tool making the request */
		toolName?: string;
		/** Arguments passed to the tool */
		args?: unknown;
		/** Preview of the changes (for write operations) */
		preview?: { 
			/** Original content before changes */
			originalContent?: string; 
			/** New content after changes */
			newContent?: string; 
			/** Mode of the operation */
			mode?: string 
		};
	};
}

/**
 * Event emitted when an error occurs.
 */
export interface ErrorEvent {
	/** The error that occurred */
	error: Error;
}

/** Function to unsubscribe from an event listener */
type Unsubscribe = () => void;

/**
 * Event bus for managing session-related events.
 * 
 * Provides a centralized event system for communication between the OpenCode Server
 * client and the UI components. Supports multiple event types including:
 * - Stream tokens (real-time message content)
 * - Thinking content (agent reasoning)
 * - Progress updates
 * - Session lifecycle events
 * - Permission requests
 * - Errors
 * 
 * @example
 * ```typescript
 * const eventBus = new SessionEventBus();
 * 
 * // Subscribe to events
 * const unsubscribe = eventBus.onStreamToken(event => {
 *   console.log('Token:', event.token);
 * });
 * 
 * // Emit events
 * eventBus.emitStreamToken({ sessionId: '123', token: 'hello', done: false });
 * 
 * // Unsubscribe when done
 * unsubscribe();
 * ```
 */
export class SessionEventBus {
	private streamTokenListeners: Array<(event: StreamTokenEvent) => void> = [];
	private streamThinkingListeners: Array<(event: StreamThinkingEvent) => void> =
		[];
	private errorListeners: Array<(event: ErrorEvent) => void> = [];
	private progressUpdateListeners: Array<
		(event: ProgressUpdateEvent) => void
	> = [];
	private sessionEndListeners: Array<(event: SessionEndEvent) => void> = [];
	private permissionRequestListeners: Array<
		(event: PermissionRequestEvent) => void
	> = [];

	/**
	 * Subscribes to stream token events.
	 * 
	 * Stream tokens are emitted as the server generates response content in real-time.
	 * 
	 * @param listener - Callback function to handle stream token events
	 * @returns Function to unsubscribe from the event
	 */
	onStreamToken(listener: (event: StreamTokenEvent) => void): Unsubscribe {
		this.streamTokenListeners.push(listener);
		return () => {
			this.streamTokenListeners = this.streamTokenListeners.filter(
				(l) => l !== listener,
			);
		};
	}

	/**
	 * Subscribes to stream thinking events.
	 * 
	 * Thinking events contain the agent's reasoning process before generating a response.
	 * 
	 * @param listener - Callback function to handle stream thinking events
	 * @returns Function to unsubscribe from the event
	 */
	onStreamThinking(
		listener: (event: StreamThinkingEvent) => void,
	): Unsubscribe {
		this.streamThinkingListeners.push(listener);
		return () => {
			this.streamThinkingListeners = this.streamThinkingListeners.filter(
				(l) => l !== listener,
			);
		};
	}

	/**
	 * Subscribes to progress update events.
	 * 
	 * Progress updates provide information about long-running operations.
	 * 
	 * @param listener - Callback function to handle progress update events
	 * @returns Function to unsubscribe from the event
	 */
	onProgressUpdate(
		listener: (event: ProgressUpdateEvent) => void,
	): Unsubscribe {
		this.progressUpdateListeners.push(listener);
		return () => {
			this.progressUpdateListeners = this.progressUpdateListeners.filter(
				(l) => l !== listener,
			);
		};
	}

	/**
	 * Subscribes to session end events.
	 * 
	 * Session end events are emitted when a session completes, is aborted, or ends for any reason.
	 * 
	 * @param listener - Callback function to handle session end events
	 * @returns Function to unsubscribe from the event
	 */
	onSessionEnd(listener: (event: SessionEndEvent) => void): Unsubscribe {
		this.sessionEndListeners.push(listener);
		return () => {
			this.sessionEndListeners = this.sessionEndListeners.filter(
				(l) => l !== listener,
			);
		};
	}

	/**
	 * Subscribes to permission request events.
	 * 
	 * Permission request events are emitted when the server needs user approval
	 * to perform an operation on the vault. The event contains details about
	 * the operation, resource path, and optional context.
	 * 
	 * @param listener - Callback function to handle permission request events
	 * @returns Function to unsubscribe from the event
	 */
	onPermissionRequest(
		listener: (event: PermissionRequestEvent) => void,
	): Unsubscribe {
		this.permissionRequestListeners.push(listener);
		return () => {
			this.permissionRequestListeners =
				this.permissionRequestListeners.filter((l) => l !== listener);
		};
	}

	/**
	 * Subscribes to error events.
	 * 
	 * Error events are emitted when an error occurs during event processing.
	 * 
	 * @param listener - Callback function to handle error events
	 * @returns Function to unsubscribe from the event
	 */
	onError(listener: (event: ErrorEvent) => void): Unsubscribe {
		this.errorListeners.push(listener);
		return () => {
			this.errorListeners = this.errorListeners.filter((l) => l !== listener);
		};
	}

	/**
	 * Emits a stream token event to all registered listeners.
	 * 
	 * @param event - The stream token event to emit
	 */
	emitStreamToken(event: StreamTokenEvent): void {
		for (const listener of this.streamTokenListeners) {
			listener(event);
		}
	}

	/**
	 * Emits a stream thinking event to all registered listeners.
	 * 
	 * @param event - The stream thinking event to emit
	 */
	emitStreamThinking(event: StreamThinkingEvent): void {
		for (const listener of this.streamThinkingListeners) {
			listener(event);
		}
	}

	/**
	 * Emits a progress update event to all registered listeners.
	 * 
	 * @param event - The progress update event to emit
	 */
	emitProgressUpdate(event: ProgressUpdateEvent): void {
		for (const listener of this.progressUpdateListeners) {
			listener(event);
		}
	}

	/**
	 * Emits a session end event to all registered listeners.
	 * 
	 * @param event - The session end event to emit
	 */
	emitSessionEnd(event: SessionEndEvent): void {
		for (const listener of this.sessionEndListeners) {
			listener(event);
		}
	}

	/**
	 * Emits a permission request event to all registered listeners.
	 * 
	 * This is called by the OpenCode Server client when a permission.request
	 * SSE event is received from the server.
	 * 
	 * @param event - The permission request event to emit
	 */
	emitPermissionRequest(event: PermissionRequestEvent): void {
		for (const listener of this.permissionRequestListeners) {
			listener(event);
		}
	}

	/**
	 * Emits an error event to all registered listeners.
	 * 
	 * @param event - The error event to emit
	 */
	emitError(event: ErrorEvent): void {
		for (const listener of this.errorListeners) {
			listener(event);
		}
	}
}

