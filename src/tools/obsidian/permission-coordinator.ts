import type { App } from 'obsidian';
import type { OpenCodeServerClient } from '../../client/client';
import type { SessionEventBus, PermissionRequestEvent } from '../../session/session-event-bus';
import type { PermissionManager } from './permission-manager';
import type { AuditLogger } from './audit-logger';
import { ErrorHandler, ErrorSeverity } from '../../utils/error-handler';
import type { OperationType } from './permission-types';
import { PermissionModal, type PermissionRequest } from './permission-modal';

/** Timeout duration for permission requests in milliseconds (60 seconds) */
const TIMEOUT_MS = 60000;

/**
 * Represents a pending permission request awaiting user response
 */
interface PendingRequest {
	/** ID of the session this request belongs to */
	sessionId: string;
	/** Unique identifier for this permission request */
	requestId: string;
	/** Type of operation being requested (e.g., 'read', 'write', 'delete') */
	operation: string;
	/** Path to the resource being accessed */
	resourcePath: string;
	/** Optional additional context about the request (tool name, args, preview) */
	context?: unknown;
	/** Timer ID for the timeout handler */
	timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * Coordinates permission requests between OpenCode Server and the plugin's permission system.
 * 
 * This class bridges server permission requests (received via SSE events) with the plugin's
 * existing permission system. It handles the complete flow:
 * 1. Receive permission request from server
 * 2. Validate against plugin permission rules
 * 3. Show modal to user for approval
 * 4. Send response back to server
 * 
 * Features:
 * - Request queueing (only one modal shown at a time)
 * - 60-second timeout for user responses
 * - Auto-denial for plugin-rejected operations
 * - Session cleanup on session end
 * - Comprehensive audit logging
 * 
 * @example
 * ```typescript
 * const coordinator = new PermissionCoordinator(
 *   client, eventBus, permissionManager, auditLogger, errorHandler
 * );
 * coordinator.setApp(app);
 * // Coordinator automatically listens for permission requests
 * ```
 */
export class PermissionCoordinator {
	/** Obsidian App instance, required for showing modals */
	private app: App | null = null;
	/** Map of pending requests by requestId */
	private pendingRequests = new Map<string, PendingRequest>();
	/** Currently displayed modal, if any */
	private currentModal: PermissionModal | null = null;
	/** Queue of requests waiting to be shown */
	private requestQueue: PendingRequest[] = [];

	/**
	 * Creates a new PermissionCoordinator instance.
	 * 
	 * @param client - OpenCode Server client for sending responses
	 * @param eventBus - Event bus for receiving permission requests
	 * @param permissionManager - Plugin permission manager for validation
	 * @param auditLogger - Logger for recording permission decisions
	 * @param errorHandler - Error handler for logging errors
	 */
	constructor(
		private client: OpenCodeServerClient,
		private eventBus: SessionEventBus,
		private permissionManager: PermissionManager,
		private auditLogger: AuditLogger,
		private errorHandler: ErrorHandler
	) {
		this.setupListeners();
	}

	/**
	 * Sets the Obsidian App instance.
	 * 
	 * This must be called before any permission requests can be shown to the user.
	 * The App instance is required for creating and displaying permission modals.
	 * 
	 * @param app - The Obsidian App instance
	 */
	setApp(app: App): void {
		this.app = app;
	}

	/**
	 * Sets up event listeners for permission requests and session lifecycle events.
	 * 
	 * Registers handlers for:
	 * - Permission requests from the server
	 * - Session end events for cleanup
	 * 
	 * @private
	 */
	private setupListeners(): void {
		this.eventBus.onPermissionRequest(event => {
			void this.handleRequest(event);
		});

		this.eventBus.onSessionEnd(event => {
			this.cleanupSession(event.sessionId);
		});
	}

	/**
	 * Handles an incoming permission request from the server.
	 * 
	 * This method orchestrates the complete permission request flow:
	 * 1. Logs the request to the audit log
	 * 2. Validates the request against plugin permission rules
	 * 3. Auto-denies if plugin denies (no modal shown)
	 * 4. Shows modal to user if plugin allows
	 * 
	 * @param event - The permission request event from the server
	 * @returns Promise that resolves when the request has been processed
	 * @private
	 */
	private async handleRequest(event: PermissionRequestEvent): Promise<void> {
		const { sessionId, requestId, operation, resourcePath, context } = event;

		try {
			// Log request to audit logger
			await this.auditLogger.log({
				id: `perm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
				timestamp: Date.now(),
				toolName: (context as any)?.toolName || 'server.operation',
				sessionId,
				callId: requestId,
				input: { operation, resourcePath, context },
				permissionLevel: this.permissionManager.getPermissionLevel(),
				requiredApproval: true,
				dryRun: false,
				isError: false
			});

			// Validate with plugin permission system
			const opType = this.mapOperation(operation);
			const validation = await this.permissionManager.validatePath(resourcePath, opType);

			if (!validation.allowed) {
				// Auto-deny if plugin denies (no modal shown)
				await this.denyRequest(sessionId, requestId, `Plugin denied: ${validation.reason}`);
				return;
			}

			// Show modal to user (plugin allows the operation)
			await this.showModal(sessionId, requestId, operation, resourcePath, context);
		} catch (error) {
			this.errorHandler.handleError(error, {
				module: 'PermissionCoordinator',
				function: 'handleRequest',
				metadata: { sessionId, requestId, operation, resourcePath }
			}, ErrorSeverity.Error);

			// Deny request on error
			await this.denyRequest(sessionId, requestId, 'Internal error');
		}
	}

	/**
	 * Maps a server operation string to a plugin OperationType.
	 * 
	 * Converts server operation names (which may vary) to standardized
	 * plugin operation types for permission validation.
	 * 
	 * @param op - The operation string from the server
	 * @returns The corresponding OperationType
	 * @private
	 */
	private mapOperation(op: string): OperationType {
		const lower = op.toLowerCase();
		if (lower.includes('read') || lower.includes('get')) return 'read';
		if (lower.includes('create')) return 'create';
		if (lower.includes('update') || lower.includes('modify')) return 'modify';
		if (lower.includes('delete')) return 'delete';
		return 'write';
	}

	/**
	 * Denies a permission request and sends the denial to the server.
	 * 
	 * This method is called when:
	 * - The plugin permission system denies the operation
	 * - The request times out
	 * - The session ends before the user responds
	 * - An error occurs during processing
	 * 
	 * @param sessionId - ID of the session the request belongs to
	 * @param requestId - Unique identifier for the permission request
	 * @param reason - Human-readable reason for the denial
	 * @returns Promise that resolves when the denial has been sent and logged
	 * @private
	 */
	private async denyRequest(sessionId: string, requestId: string, reason: string): Promise<void> {
		try {
			// Send denial to server
			await this.client.respondToPermission(sessionId, requestId, false, reason);

			// Log denial to audit logger
			await this.auditLogger.log({
				id: `perm_deny_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
				timestamp: Date.now(),
				toolName: 'server.operation',
				sessionId,
				callId: requestId,
				input: { reason },
				output: { approved: false, reason },
				permissionLevel: this.permissionManager.getPermissionLevel(),
				requiredApproval: true,
				approved: false,
				dryRun: false,
				isError: false
			});
		} catch (error) {
			this.errorHandler.handleError(error, {
				module: 'PermissionCoordinator',
				function: 'denyRequest',
				metadata: { sessionId, requestId, reason }
			}, ErrorSeverity.Warning);
		}
	}

	/**
	 * Shows a permission modal to the user for approval.
	 * 
	 * Implements queueing logic to ensure only one modal is shown at a time.
	 * If a modal is already open, the request is queued and will be shown
	 * after the current modal closes.
	 * 
	 * Sets up a 60-second timeout for the request. If the user doesn't respond
	 * within this time, the request is automatically denied.
	 * 
	 * @param sessionId - ID of the session the request belongs to
	 * @param requestId - Unique identifier for the permission request
	 * @param operation - Type of operation being requested
	 * @param resourcePath - Path to the resource being accessed
	 * @param context - Optional additional context (tool name, args, preview)
	 * @returns Promise that resolves when the modal has been shown
	 * @throws Error if App instance is not set
	 * @private
	 */
	private async showModal(
		sessionId: string,
		requestId: string,
		operation: string,
		resourcePath: string,
		context?: unknown
	): Promise<void> {
		if (!this.app) {
			throw new Error('App required for modal');
		}

		// Queue if modal already open
		if (this.currentModal) {
			const timeoutId = setTimeout(() => void this.handleTimeout(requestId), TIMEOUT_MS);
			this.requestQueue.push({
				sessionId,
				requestId,
				operation,
				resourcePath,
				context,
				timeoutId
			});
			return;
		}

		// Set timeout for this request
		const timeoutId = setTimeout(() => void this.handleTimeout(requestId), TIMEOUT_MS);
		this.pendingRequests.set(requestId, {
			sessionId,
			requestId,
			operation,
			resourcePath,
			context,
			timeoutId
		});

		// Create permission request object for modal
		const permRequest: PermissionRequest = {
			sessionId,
			callId: requestId,
			toolName: (context as any)?.toolName || operation,
			args: { path: resourcePath, ...(context as any)?.args },
			preview: (context as any)?.preview
		};

		// Show modal with callback
		this.currentModal = new PermissionModal(
			this.app,
			permRequest,
			async (approved: boolean, reason?: string) => {
				await this.handleUserResponse(requestId, approved, reason);
			}
		);
		this.currentModal.open();
	}

	/**
	 * Handles the user's response from the permission modal.
	 * 
	 * This method is called when the user clicks "Approve" or "Deny" in the modal,
	 * or when the modal is closed without an explicit response.
	 * 
	 * Actions performed:
	 * 1. Clears the timeout for this request
	 * 2. Removes the request from pending
	 * 3. Sends the response to the server
	 * 4. Logs the decision to the audit log
	 * 5. Processes the next queued request (if any)
	 * 
	 * @param requestId - Unique identifier for the permission request
	 * @param approved - Whether the user approved or denied the request
	 * @param reason - Optional reason for the decision
	 * @returns Promise that resolves when the response has been sent and logged
	 * @private
	 */
	private async handleUserResponse(
		requestId: string,
		approved: boolean,
		reason?: string
	): Promise<void> {
		const request = this.pendingRequests.get(requestId);
		if (!request) return;

		// Clear timeout and remove from pending
		clearTimeout(request.timeoutId);
		this.pendingRequests.delete(requestId);
		this.currentModal = null;

		try {
			// Send response to server
			await this.client.respondToPermission(
				request.sessionId,
				requestId,
				approved,
				reason
			);

			// Log decision to audit logger
			await this.auditLogger.log({
				id: `perm_resp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
				timestamp: Date.now(),
				toolName: (request.context as any)?.toolName || 'server.operation',
				sessionId: request.sessionId,
				callId: requestId,
				input: { operation: request.operation, resourcePath: request.resourcePath },
				output: { approved, reason },
				permissionLevel: this.permissionManager.getPermissionLevel(),
				requiredApproval: true,
				approved,
				dryRun: false,
				isError: false
			});
		} catch (error) {
			this.errorHandler.handleError(error, {
				module: 'PermissionCoordinator',
				function: 'handleUserResponse',
				metadata: { requestId, approved, reason }
			}, ErrorSeverity.Error);
		}

		// Process next queued request
		await this.processNextQueued();
	}

	/**
	 * Handles timeout for a permission request that wasn't responded to in time.
	 * 
	 * Called automatically after 60 seconds if the user hasn't approved or denied
	 * the request. The request is automatically denied with reason "Request timed out".
	 * 
	 * Actions performed:
	 * 1. Removes the request from pending
	 * 2. Closes the current modal
	 * 3. Denies the request with timeout reason
	 * 4. Processes the next queued request (if any)
	 * 
	 * @param requestId - Unique identifier for the permission request
	 * @returns Promise that resolves when the timeout has been handled
	 * @private
	 */
	private async handleTimeout(requestId: string): Promise<void> {
		const request = this.pendingRequests.get(requestId);
		if (!request) return;

		// Remove from pending
		this.pendingRequests.delete(requestId);

		// Close current modal if it's for this request
		if (this.currentModal) {
			this.currentModal.close();
			this.currentModal = null;
		}

		// Deny request with timeout reason
		await this.denyRequest(request.sessionId, requestId, 'Request timed out');

		// Process next queued request
		await this.processNextQueued();
	}

	/**
	 * Processes the next queued permission request.
	 * 
	 * Called after the current modal closes to show the next request in the queue.
	 * If the queue is empty, this method does nothing.
	 * 
	 * @returns Promise that resolves when the next request has been shown
	 * @private
	 */
	private async processNextQueued(): Promise<void> {
		const next = this.requestQueue.shift();
		if (!next) return;

		await this.showModal(
			next.sessionId,
			next.requestId,
			next.operation,
			next.resourcePath,
			next.context
		);
	}

	/**
	 * Cleans up all pending requests when a session ends.
	 * 
	 * Called automatically when a session end event is received. All pending
	 * requests for the session are automatically denied with reason "Session ended".
	 * 
	 * Actions performed:
	 * 1. Denies all pending requests for the session
	 * 2. Clears all timeouts for those requests
	 * 3. Removes requests from the queue
	 * 4. Closes the current modal if it belongs to this session
	 * 
	 * @param sessionId - ID of the session that ended
	 * @private
	 */
	private cleanupSession(sessionId: string): void {
		// Deny all pending requests for this session
		for (const [requestId, request] of this.pendingRequests.entries()) {
			if (request.sessionId === sessionId) {
				clearTimeout(request.timeoutId);
				this.pendingRequests.delete(requestId);
				void this.denyRequest(sessionId, requestId, 'Session ended');
			}
		}

		// Remove from queue
		this.requestQueue = this.requestQueue.filter(r => r.sessionId !== sessionId);

		// Close current modal if it's for this session
		if (this.currentModal) {
			// Check if current modal is for this session by checking pending requests
			// Since we already cleared pending requests, we can safely close
			this.currentModal.close();
			this.currentModal = null;
		}
	}
}
