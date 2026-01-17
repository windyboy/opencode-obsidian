# Design: Permission System Integration

## Overview

Bridge OpenCode Server's permission requests (SSE events) with the plugin's existing permission system. A new `PermissionCoordinator` handles the flow: receive → validate → show modal → respond.

**Key principles:**
- Reuse existing components (PermissionModal, PermissionManager)
- Event-driven via SessionEventBus
- Non-blocking with 60s timeout
- Minimal code changes

## Architecture

### Flow

```
Server SSE Event → OpenCodeClient → SessionEventBus → PermissionCoordinator
                                                              ↓
                                                    PermissionManager (validate)
                                                              ↓
                                                    PermissionModal (user decision)
                                                              ↓
                                                    OpenCodeClient.respondToPermission()
                                                              ↓
                                                    Server HTTP Response
```

### Key Decisions

1. **New PermissionCoordinator** - Bridges server and plugin systems, handles queueing and timeouts
2. **Extend SessionEventBus** - Add `onPermissionRequest()` for event handling
3. **Extend OpenCodeClient** - Add `respondToPermission()` for server responses
4. **Reuse PermissionModal** - Add countdown timer, minimal changes
5. **60s Timeout** - Hardcoded constant, no settings UI

## Integration & Lifecycle

### Plugin Initialization

**File:** `src/main.ts`

The `PermissionCoordinator` is instantiated during plugin load and wired into the existing architecture:

```typescript
export default class OpenCodeObsidianPlugin extends Plugin {
	private permissionCoordinator: PermissionCoordinator | null = null;

	async onload() {
		// ... existing initialization ...

		// Initialize permission coordinator after client and event bus are ready
		this.permissionCoordinator = new PermissionCoordinator(
			this.client,
			this.eventBus,
			this.permissionManager,
			this.auditLogger,
			this.errorHandler
		);
		this.permissionCoordinator.setApp(this.app);

		// ... rest of initialization ...
	}

	async onunload() {
		// Cleanup handled automatically by session end events
		this.permissionCoordinator = null;
	}
}
```

**Rationale:** Coordinator is initialized after all dependencies are available. The `setApp()` pattern follows existing Obsidian plugin conventions where `App` may not be available during constructor.

## Components

### 1. SessionEventBus Extension

**File:** `src/session/session-event-bus.ts`

Add permission request event type and handlers:

```typescript
export interface PermissionRequestEvent {
	sessionId: string;
	requestId: string;
	operation: string;
	resourcePath: string;
	context?: {
		toolName?: string;
		args?: unknown;
		preview?: { originalContent?: string; newContent?: string; mode?: string };
	};
}

export class SessionEventBus {
	private permissionRequestListeners: Array<(event: PermissionRequestEvent) => void> = [];

	onPermissionRequest(listener: (event: PermissionRequestEvent) => void): Unsubscribe {
		this.permissionRequestListeners.push(listener);
		return () => {
			this.permissionRequestListeners = this.permissionRequestListeners.filter(l => l !== listener);
		};
	}

	emitPermissionRequest(event: PermissionRequestEvent): void {
		this.permissionRequestListeners.forEach(listener => listener(event));
	}
}
```

### 2. OpenCodeClient Extension

**File:** `src/opencode-server/client.ts`

Add permission response method and SSE event handling:

```typescript
export class OpenCodeServerClient {
	/**
	 * Respond to server permission request with retry logic
	 */
	async respondToPermission(
		sessionId: string,
		requestId: string,
		approved: boolean,
		reason?: string
	): Promise<void> {
		const maxAttempts = 2; // Initial attempt + 1 retry
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const response = await this.sdkClient.session.permission.respond({
					path: { id: sessionId },
					body: { requestId, approved, reason }
				});

				if (response.error) {
					throw new Error(`Permission response failed: ${response.error}`);
				}

				// Success - return immediately
				return;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				
				if (attempt < maxAttempts) {
					// Log retry attempt
					this.errorHandler.handleError(lastError, {
						module: "OpenCodeClient",
						function: "respondToPermission",
						operation: `Retry attempt ${attempt}`,
						metadata: { sessionId, requestId, approved }
					}, ErrorSeverity.Warning);
					
					// Wait 500ms before retry
					await new Promise(resolve => setTimeout(resolve, 500));
				}
			}
		}

		// All attempts failed
		this.errorHandler.handleError(lastError!, {
			module: "OpenCodeClient",
			function: "respondToPermission",
			operation: "All retry attempts failed",
			metadata: { sessionId, requestId, approved, attempts: maxAttempts }
		}, ErrorSeverity.Error);
		throw lastError!;
	}

	/**
	 * Handle SSE events - add permission.request case
	 */
	private handleSDKEvent(event: any): void {
		// ... existing code ...
		
		if (event.type === "permission.request") {
			const sessionId = this.extractSessionIdFromEvent(event) || "";
			const { requestId, operation, resourcePath, context } = 
				event.properties || event.data || event;

			if (!requestId || !operation || !resourcePath) {
				console.warn("[OpenCodeClient] Malformed permission.request:", event);
				return;
			}

			this.eventBus.emitPermissionRequest({
				sessionId, requestId, operation, resourcePath, context
			});
		}
	}
}
```

### 3. PermissionCoordinator (New)

**File:** `src/tools/obsidian/permission-coordinator.ts`

Core coordinator handling the permission flow:

```typescript
import type { App } from 'obsidian';
import type { OpenCodeServerClient } from '../../opencode-server/client';
import type { SessionEventBus, PermissionRequestEvent } from '../../session/session-event-bus';
import { PermissionManager } from './permission-manager';
import { PermissionModal, type PermissionRequest } from './permission-modal';
import { AuditLogger } from './audit-logger';
import { ErrorHandler, ErrorSeverity } from '../../utils/error-handler';

const TIMEOUT_MS = 60000; // 60 seconds

interface PendingRequest {
	sessionId: string;
	requestId: string;
	operation: string;
	resourcePath: string;
	context?: unknown;
	timeoutId: ReturnType<typeof setTimeout>;
}

export class PermissionCoordinator {
	private app: App | null = null;
	private pendingRequests = new Map<string, PendingRequest>();
	private currentModal: PermissionModal | null = null;
	private requestQueue: PendingRequest[] = [];

	constructor(
		private client: OpenCodeServerClient,
		private eventBus: SessionEventBus,
		private permissionManager: PermissionManager,
		private auditLogger: AuditLogger,
		private errorHandler: ErrorHandler
	) {
		this.setupListeners();
	}

	setApp(app: App): void {
		this.app = app;
	}

	private setupListeners(): void {
		this.eventBus.onPermissionRequest(event => {
			void this.handleRequest(event);
		});

		this.eventBus.onSessionEnd(event => {
			this.cleanupSession(event.sessionId);
		});
	}

	private async handleRequest(event: PermissionRequestEvent): Promise<void> {
		const { sessionId, requestId, operation, resourcePath, context } = event;

		try {
			// Log request
			await this.auditLogger.log({
				id: `perm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
				timestamp: Date.now(),
				toolName: (context as any)?.toolName || 'server.operation',
				sessionId,
				callId: requestId,
				input: { operation, resourcePath, context },
				permissionLevel: this.permissionManager.getPermissionLevel(),
				requiredApproval: true,
				dryRun: false
			});

			// Validate with plugin permission system
			const opType = this.mapOperation(operation);
			const validation = await this.permissionManager.validatePath(resourcePath, opType);

			if (!validation.allowed) {
				// Auto-deny if plugin denies
				await this.denyRequest(sessionId, requestId, `Plugin denied: ${validation.reason}`);
				return;
			}

			// Show modal to user
			await this.showModal(sessionId, requestId, operation, resourcePath, context);
		} catch (error) {
			this.errorHandler.handleError(error, {
				module: 'PermissionCoordinator',
				function: 'handleRequest',
				metadata: { sessionId, requestId }
			}, ErrorSeverity.Error);

			await this.denyRequest(sessionId, requestId, 'Internal error');
		}
	}

	private async showModal(
		sessionId: string,
		requestId: string,
		operation: string,
		resourcePath: string,
		context?: unknown
	): Promise<void> {
		if (!this.app) throw new Error('App required for modal');

		// Queue if modal already open
		if (this.currentModal) {
			this.requestQueue.push({
				sessionId, requestId, operation, resourcePath, context,
				timeoutId: setTimeout(() => void this.handleTimeout(requestId), TIMEOUT_MS)
			});
			return;
		}

		// Set timeout
		const timeoutId = setTimeout(() => void this.handleTimeout(requestId), TIMEOUT_MS);
		this.pendingRequests.set(requestId, {
			sessionId, requestId, operation, resourcePath, context, timeoutId
		});

		// Show modal
		const permRequest: PermissionRequest = {
			sessionId,
			callId: requestId,
			toolName: (context as any)?.toolName || operation,
			args: { path: resourcePath, ...(context as any)?.args },
			preview: (context as any)?.preview
		};

		this.currentModal = new PermissionModal(this.app, permRequest, 
			async (approved, reason) => {
				await this.handleUserResponse(requestId, approved, reason);
			}
		);
		this.currentModal.open();
	}

	private async handleUserResponse(
		requestId: string,
		approved: boolean,
		reason?: string
	): Promise<void> {
		const request = this.pendingRequests.get(requestId);
		if (!request) return;

		clearTimeout(request.timeoutId);
		this.pendingRequests.delete(requestId);
		this.currentModal = null;

		try {
			// Send response to server
			await this.client.respondToPermission(
				request.sessionId, requestId, approved, reason
			);

			// Log decision
			await this.auditLogger.log({
				id: `perm_resp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
				timestamp: Date.now(),
				toolName: (request.context as any)?.toolName || 'server.operation',
				sessionId: request.sessionId,
				callId: requestId,
				output: { approved, reason },
				permissionLevel: this.permissionManager.getPermissionLevel(),
				approved,
				dryRun: false
			});
		} catch (error) {
			this.errorHandler.handleError(error, {
				module: 'PermissionCoordinator',
				function: 'handleUserResponse',
				metadata: { requestId, approved }
			}, ErrorSeverity.Error);
		}

		// Process next queued request
		await this.processNextQueued();
	}

	private async handleTimeout(requestId: string): Promise<void> {
		const request = this.pendingRequests.get(requestId);
		if (!request) return;

		this.pendingRequests.delete(requestId);
		if (this.currentModal) {
			this.currentModal.close();
			this.currentModal = null;
		}

		await this.denyRequest(request.sessionId, requestId, 'Request timed out');
		await this.processNextQueued();
	}

	private async denyRequest(sessionId: string, requestId: string, reason: string): Promise<void> {
		try {
			await this.client.respondToPermission(sessionId, requestId, false, reason);

			await this.auditLogger.log({
				id: `perm_deny_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
				timestamp: Date.now(),
				toolName: 'server.operation',
				sessionId,
				callId: requestId,
				output: { approved: false, reason },
				permissionLevel: this.permissionManager.getPermissionLevel(),
				approved: false,
				dryRun: false
			});
		} catch (error) {
			this.errorHandler.handleError(error, {
				module: 'PermissionCoordinator',
				function: 'denyRequest',
				metadata: { sessionId, requestId }
			}, ErrorSeverity.Warning);
		}
	}

	private async processNextQueued(): Promise<void> {
		const next = this.requestQueue.shift();
		if (!next) return;

		await this.showModal(
			next.sessionId, next.requestId, next.operation, 
			next.resourcePath, next.context
		);
	}

	private cleanupSession(sessionId: string): void {
		// Deny all pending requests for session
		for (const [requestId, request] of this.pendingRequests.entries()) {
			if (request.sessionId === sessionId) {
				clearTimeout(request.timeoutId);
				this.pendingRequests.delete(requestId);
				void this.denyRequest(sessionId, requestId, 'Session ended');
			}
		}

		// Remove from queue
		this.requestQueue = this.requestQueue.filter(r => r.sessionId !== sessionId);
	}

	private mapOperation(op: string): 'read' | 'write' | 'create' | 'modify' | 'delete' {
		const lower = op.toLowerCase();
		if (lower.includes('read') || lower.includes('get')) return 'read';
		if (lower.includes('create')) return 'create';
		if (lower.includes('update') || lower.includes('modify')) return 'modify';
		if (lower.includes('delete')) return 'delete';
		return 'write';
	}
}
```

### 4. PermissionModal Extension

**File:** `src/tools/obsidian/permission-modal.ts`

Add countdown timer display and handle close-without-response:

```typescript
export class PermissionModal extends Modal {
	private timeoutSeconds = 60;
	private countdownInterval: ReturnType<typeof setInterval> | null = null;
	private countdownEl: HTMLElement | null = null;
	private responseHandled = false;

	constructor(
		app: App,
		private request: PermissionRequest,
		private onResponse: (approved: boolean, reason?: string) => Promise<void>
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Title with countdown
		const titleContainer = contentEl.createDiv('permission-title');
		titleContainer.createEl('h2', { text: 'Permission request' });
		this.countdownEl = titleContainer.createEl('span', {
			text: `(${this.timeoutSeconds}s)`,
			cls: 'permission-countdown'
		});

		this.startCountdown();

		// ... rest of existing modal content ...

		// Approve button
		approveBtn.addEventListener('click', async () => {
			this.responseHandled = true;
			await this.onResponse(true);
			this.close();
		});

		// Deny button
		denyBtn.addEventListener('click', async () => {
			this.responseHandled = true;
			await this.onResponse(false, 'User denied');
			this.close();
		});
	}

	private startCountdown(): void {
		this.countdownInterval = setInterval(() => {
			this.timeoutSeconds--;
			if (this.countdownEl) {
				this.countdownEl.textContent = `(${this.timeoutSeconds}s)`;
			}
			if (this.timeoutSeconds <= 0) {
				this.stopCountdown();
			}
		}, 1000);
	}

	private stopCountdown(): void {
		if (this.countdownInterval) {
			clearInterval(this.countdownInterval);
			this.countdownInterval = null;
		}
	}

	onClose() {
		this.stopCountdown();

		// If modal closed without explicit approve/deny, treat as denial
		if (!this.responseHandled) {
			void this.onResponse(false, 'Modal closed without response');
		}

		const { contentEl } = this;
		contentEl.empty();
	}
}
```

**Rationale:** Track whether user explicitly approved/denied. If modal closes (via X button, ESC key, or clicking outside) without a response, automatically deny the request. This ensures no permission request is left in limbo.

### 5. AuditLogger Extension

**File:** `src/tools/obsidian/audit-logger.ts`

Add query method for retrieving audit logs by session:

```typescript
export class AuditLogger {
	// ... existing methods ...

	/**
	 * Query audit logs by session ID
	 */
	async queryBySession(sessionId: string): Promise<AuditLogEntry[]> {
		try {
			const allLogs = await this.getAllLogs();
			return allLogs.filter(log => log.sessionId === sessionId);
		} catch (error) {
			this.errorHandler.handleError(error, {
				module: 'AuditLogger',
				function: 'queryBySession',
				metadata: { sessionId }
			}, ErrorSeverity.Warning);
			return [];
		}
	}

	/**
	 * Query audit logs by request ID
	 */
	async queryByRequestId(requestId: string): Promise<AuditLogEntry[]> {
		try {
			const allLogs = await this.getAllLogs();
			return allLogs.filter(log => log.callId === requestId);
		} catch (error) {
			this.errorHandler.handleError(error, {
				module: 'AuditLogger',
				function: 'queryByRequestId',
				metadata: { requestId }
			}, ErrorSeverity.Warning);
			return [];
		}
	}
}
```

**Rationale:** Satisfies requirement 7.3 for queryable audit logs. Uses existing `getAllLogs()` method and filters in-memory for simplicity. For large audit logs, this could be optimized with indexed storage later.

## Data Models

```typescript
// Permission request event from server
interface PermissionRequestEvent {
	sessionId: string;
	requestId: string;
	operation: string;
	resourcePath: string;
	context?: {
		toolName?: string;
		args?: unknown;
		preview?: { originalContent?: string; newContent?: string; mode?: string };
	};
}

// Permission response to server
interface PermissionResponse {
	requestId: string;
	approved: boolean;
	reason?: string;
}
```

## Correctness Properties

### Property Consolidation

After analyzing requirements, consolidated from 15 to 8 core properties:
- Combined event emission + data integrity (Props 1 + 4.3)
- Combined approval/denial flows (Props 2.4 + 2.5)
- Combined audit logging properties (Props 8.1-8.3)
- Removed redundant validation properties

### Core Properties

**Property 1: Event flow integrity**
*For any* valid `permission.request` SSE event → all registered listeners receive event with complete data (sessionId, requestId, operation, resourcePath)
**Validates: Requirements 1.1, 1.2**

**Property 2: Malformed event handling**
*For any* event missing required fields → auto-deny + log error (no modal)
**Validates: Requirements 1.3**

**Property 3: Plugin validation precedence**
*For any* server request → if PermissionManager denies → auto-deny server request (no modal)
**Validates: Requirements 2.1, 2.2**

**Property 4: Modal display for allowed ops**
*For any* request passing PermissionManager → modal shown with operation, path, preview, countdown
**Validates: Requirements 2.3, 3.1, 3.2, 3.3, 3.4**

**Property 5: User response transmission**
*For any* user decision (approve/deny) → response sent to server with correct requestId + status + retry on failure
**Validates: Requirements 4.1, 4.2, 4.3**

**Property 6: Request queueing**
*For any* request received while modal open → queued and processed after current modal closes
**Validates: Requirement 3.5**

**Property 7: Timeout behavior**
*For any* request without user response within 60s → auto-deny + close modal + send "Request timed out"
**Validates: Requirements 5.1, 5.2, 5.3**

**Property 8: Session cleanup**
*For any* session end → all pending requests for that session auto-denied + removed from queue
**Validates: Requirements 6.1, 6.2**

**Property 9: Audit completeness**
*For any* permission request → audit log contains (sessionId, requestId, operation, path, timestamp, decision) + queryable by sessionId
**Validates: Requirements 7.1, 7.2, 7.3**

## Error Handling

All errors use `ErrorHandler` with appropriate severity:

**Malformed events** → Deny + log warning
**Plugin validation failure** → Deny + log info
**Network failure** → Retry once (500ms delay) + log error
**Timeout** → Deny + log info
**Session end** → Deny pending + log info

```typescript
this.errorHandler.handleError(error, {
	module: 'PermissionCoordinator',
	function: 'handleRequest',
	metadata: { sessionId, requestId }
}, ErrorSeverity.Error);
```

## Testing Strategy

### Approach

**Unit tests** - Specific scenarios, error conditions, UI interactions
**Property tests** - Universal behaviors across all inputs (100+ iterations)

### Test Files

```
src/tools/obsidian/
├── permission-coordinator.test.ts    # Unit + property tests
├── permission-modal.test.ts          # Unit tests (countdown UI)
└── audit-logger.test.ts              # Unit tests (query methods)

src/session/
└── session-event-bus.test.ts         # Property tests (event flow)

src/opencode-server/
└── client.test.ts                    # Unit tests (respondToPermission + retry)
```

### Key Scenarios

**Unit:**
- Valid request → show modal
- Malformed request → deny without modal
- Plugin denies → skip modal
- User approve/deny → send response
- Modal close without response → auto-deny
- Timeout → auto-deny
- Session end → cleanup
- Network failure → retry logic
- Audit log queries by sessionId and requestId

**Property:**
- Event emission completeness (Prop 1)
- Malformed handling (Prop 2)
- Plugin precedence (Prop 3)
- Queueing behavior (Prop 6)
- Session cleanup (Prop 8)
- Audit completeness (Prop 9)

### Mocking

**Mock:** SDK client, Obsidian App, HTTP requests
**Don't mock:** SessionEventBus, PermissionManager, AuditLogger, ErrorHandler

Test real integration, isolate external dependencies.
