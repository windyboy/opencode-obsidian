# Session Module

## Overview

This module manages session lifecycle and event communication between the OpenCode Server and the plugin. It provides an event-driven architecture for real-time updates, including permission requests.

## Core Components

### SessionEventBus

**File:** `session-event-bus.ts`

**Purpose:** Centralized event system for session-related communication.

**Event Types:**

#### StreamTokenEvent
- **When:** Real-time message content from server
- **Data:** `sessionId`, `token`, `done`
- **Usage:** Display streaming responses in chat UI

#### StreamThinkingEvent
- **When:** Agent reasoning/thinking content
- **Data:** `sessionId`, `content`
- **Usage:** Show agent's thought process

#### ProgressUpdateEvent
- **When:** Progress updates during long operations
- **Data:** `sessionId`, `progress`
- **Usage:** Display progress indicators

#### SessionEndEvent
- **When:** Session terminates
- **Data:** `sessionId`, `reason?`
- **Usage:** Cleanup resources, close connections

#### PermissionRequestEvent *(New)*
- **When:** Server requests permission for vault operation
- **Data:** `sessionId`, `requestId`, `operation`, `resourcePath`, `context?`
- **Usage:** Trigger permission validation and user approval flow

**Context Structure:**
```typescript
context?: {
	toolName?: string;        // Name of tool making request
	args?: unknown;           // Tool arguments
	preview?: {               // Preview of changes
		originalContent?: string;
		newContent?: string;
		mode?: string;
	};
}
```

#### ErrorEvent
- **When:** Error occurs during session operations
- **Data:** `error`
- **Usage:** Display error messages, log errors

### Event Subscription Pattern

**Subscribe to events:**
```typescript
const unsubscribe = eventBus.onPermissionRequest(event => {
	console.log('Permission requested:', event);
});
```

**Emit events:**
```typescript
eventBus.emitPermissionRequest({
	sessionId: '123',
	requestId: 'req-456',
	operation: 'write',
	resourcePath: 'notes/example.md',
	context: { toolName: 'obsidian.update_note' }
});
```

**Unsubscribe:**
```typescript
unsubscribe(); // Call returned function to remove listener
```

### Event Flow Architecture

**Pattern:** Publisher-Subscriber (Pub-Sub)

**Benefits:**
- Decouples event producers from consumers
- Multiple listeners can subscribe to same event
- Easy to add new event types
- Clean unsubscribe mechanism

**Implementation:**
```typescript
export class SessionEventBus {
	private permissionRequestListeners: Array<
		(event: PermissionRequestEvent) => void
	> = [];

	onPermissionRequest(
		listener: (event: PermissionRequestEvent) => void
	): Unsubscribe {
		this.permissionRequestListeners.push(listener);
		return () => {
			this.permissionRequestListeners = 
				this.permissionRequestListeners.filter(l => l !== listener);
		};
	}

	emitPermissionRequest(event: PermissionRequestEvent): void {
		this.permissionRequestListeners.forEach(listener => listener(event));
	}
}
```

## Permission Request Integration

### Event Flow

```
OpenCodeServerClient (SSE) → SessionEventBus → PermissionCoordinator
                                    ↓
                          Other listeners (if any)
```

### Event Emission

**Source:** OpenCodeServerClient receives `permission.request` SSE event

**Processing:**
1. Client extracts event data (sessionId, requestId, operation, resourcePath, context)
2. Client validates required fields (requestId, operation, resourcePath)
3. If valid → emit via `eventBus.emitPermissionRequest()`
4. If invalid → log warning, no emission

**Validation:**
```typescript
if (!requestId || !operation || !resourcePath) {
	console.warn("[OpenCodeClient] Malformed permission.request:", event);
	return; // Don't emit
}
```

### Event Consumption

**Primary Consumer:** PermissionCoordinator

**Setup:**
```typescript
// In PermissionCoordinator constructor
this.eventBus.onPermissionRequest(event => {
	void this.handleRequest(event);
});
```

**Handler:**
1. Logs request to AuditLogger
2. Validates with PermissionManager
3. Shows modal or auto-denies
4. Sends response to server

### Session End Integration

**Purpose:** Clean up pending permission requests when session ends

**Flow:**
```
Server → Client (SSE) → SessionEventBus.emitSessionEnd()
                              ↓
                    PermissionCoordinator.cleanupSession()
```

**Cleanup Actions:**
1. Find all pending requests for session
2. Clear timeouts
3. Send denials to server
4. Remove from queue
5. Close modal if belongs to session

## Event Bus Lifecycle

### Initialization

**Where:** Plugin initialization in `src/main.ts`

```typescript
export default class OpenCodeObsidianPlugin extends Plugin {
	private eventBus: SessionEventBus;

	async onload() {
		// Create event bus early
		this.eventBus = new SessionEventBus();
		
		// Pass to client for event emission
		this.client = new OpenCodeServerClient(config, errorHandler);
		this.client.setEventBus(this.eventBus);
		
		// Pass to coordinator for event consumption
		this.permissionCoordinator = new PermissionCoordinator(
			this.client,
			this.eventBus, // <-- Event bus
			this.permissionManager,
			this.auditLogger,
			this.errorHandler
		);
	}
}
```

### Event Propagation

**Non-blocking:** All event handlers are called asynchronously

**Error Isolation:** If one listener throws, others still execute

**Order:** Listeners called in registration order

### Memory Management

**Unsubscribe Pattern:** Always unsubscribe when component unmounts

**Example:**
```typescript
class MyComponent {
	private unsubscribe: Unsubscribe | null = null;

	onMount() {
		this.unsubscribe = eventBus.onPermissionRequest(event => {
			// Handle event
		});
	}

	onUnmount() {
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
	}
}
```

## Testing

### Unit Tests

**File:** `session-event-bus.test.ts`

**Test Cases:**
- Listener receives emitted events
- Multiple listeners receive same event
- Unsubscribe removes listener
- Event data integrity (all fields present)

### Additional Coverage

- Event data integrity (required and optional fields)

## Integration Points

### With OpenCodeServerClient
- Client emits events via event bus
- Events sourced from SSE stream
- Client validates event data before emission

### With PermissionCoordinator
- Coordinator subscribes to permission request events
- Coordinator subscribes to session end events
- Coordinator processes events asynchronously

### With UI Components
- UI subscribes to stream token events (chat display)
- UI subscribes to thinking events (show reasoning)
- UI subscribes to progress events (progress bars)
- UI subscribes to error events (error messages)

## Event Data Validation

### Required Fields

**PermissionRequestEvent:**
- `sessionId` - Must be non-empty string
- `requestId` - Must be non-empty string (unique)
- `operation` - Must be non-empty string
- `resourcePath` - Must be non-empty string

**Optional Fields:**
- `context` - Additional metadata (tool name, args, preview)

### Malformed Event Handling

**Detection:** Client checks required fields before emission

**Action:** Log warning, don't emit event

**Reason:** Prevents downstream errors in listeners

**Example:**
```typescript
// In OpenCodeServerClient
if (!requestId || !operation || !resourcePath) {
	console.warn("[OpenCodeClient] Malformed permission.request:", event);
	return; // Don't emit to event bus
}
```

## Error Handling

**Event Emission Errors:** Caught and logged by client

**Listener Errors:** Isolated (don't affect other listeners)

**Pattern:**
```typescript
emitPermissionRequest(event: PermissionRequestEvent): void {
	this.permissionRequestListeners.forEach(listener => {
		try {
			listener(event);
		} catch (error) {
			console.error('Permission request listener error:', error);
		}
	});
}
```

## Best Practices

### For Event Producers (Emitters)

1. **Validate data** before emitting
2. **Use descriptive event names** (e.g., `PermissionRequestEvent`)
3. **Document event structure** with TypeScript interfaces
4. **Emit events asynchronously** (don't block)

### For Event Consumers (Listeners)

1. **Always unsubscribe** when done
2. **Handle errors** within listener (don't throw)
3. **Keep listeners lightweight** (offload heavy work)
4. **Use async handlers** for I/O operations

### For Event Bus Maintainers

1. **Keep event types focused** (single responsibility)
2. **Version event structures** (add optional fields, don't break)
3. **Document event lifecycle** (when emitted, who consumes)
4. **Test event flow** (unit tests)

<claude-mem-context>
# Recent Activity

<!-- This section is auto-generated by claude-mem. Edit content outside the tags. -->

*No recent activity*
</claude-mem-context>
