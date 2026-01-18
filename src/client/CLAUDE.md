# OpenCode Server Module

## Overview

This module provides the OpenCode SDK client wrapper for Obsidian integration. It handles HTTP requests, SSE streaming, and permission response communication with the OpenCode Server.

## Core Components

### OpenCodeServerClient

**File:** `client.ts`

**Purpose:** Wrapper around the official OpenCode SDK client with Obsidian-specific adaptations.

**Key Features:**
- Custom fetch implementation using Obsidian's `requestUrl` API
- SSE event stream handling for real-time updates
- Permission response with retry logic
- Session management (create, list, delete)
- Message sending and retrieval
- Connection state management
- Auto-reconnection on failures

## Permission System Integration

### respondToPermission Method

**Purpose:** Send user's permission decision back to OpenCode Server

**Signature:**
```typescript
async respondToPermission(
	sessionId: string,
	requestId: string,
	approved: boolean,
	reason?: string
): Promise<void>
```

**Parameters:**
- `sessionId` - ID of the session the request belongs to
- `requestId` - Unique identifier for the permission request
- `approved` - Whether user approved (true) or denied (false)
- `reason` - Optional reason for decision (e.g., "User denied", "Request timed out")

**Behavior:**

1. **Initial Attempt:**
   - Calls `sdkClient.session.permission.respond()`
   - Sends POST request to `/sessions/{sessionId}/permission/respond`
   - Body: `{ requestId, approved, reason }`

2. **Retry Logic:**
   - Max attempts: 2 (initial + 1 retry)
   - Retry delay: 500ms
   - Logs retry attempts with `ErrorSeverity.Warning`

3. **Success:**
   - Returns immediately on successful response
   - No error thrown

4. **Failure:**
   - Logs all retry attempts
   - Throws error after all attempts fail
   - Logs final error with `ErrorSeverity.Error`

**Example Usage:**
```typescript
// Approve permission
await client.respondToPermission(sessionId, requestId, true);

// Deny with reason
await client.respondToPermission(
	sessionId, 
	requestId, 
	false, 
	"User denied permission"
);

// Auto-deny on timeout
await client.respondToPermission(
	sessionId, 
	requestId, 
	false, 
	"Request timed out"
);
```

**Error Handling:**
```typescript
try {
	await client.respondToPermission(sessionId, requestId, approved, reason);
} catch (error) {
	// All retry attempts failed
	// Error already logged by client
	// Coordinator handles gracefully
}
```

### SSE Event Handling

**Purpose:** Receive real-time events from OpenCode Server, including permission requests

**Event Types:**
- `stream.token` - Message content tokens
- `stream.thinking` - Agent reasoning content
- `progress.update` - Progress updates
- `session.end` - Session termination
- `permission.request` - Permission request from server *(New)*

**Permission Request Event Structure:**
```typescript
{
	type: "permission.request",
	properties: {
		requestId: string,
		operation: string,
		resourcePath: string,
		context?: {
			toolName?: string,
			args?: unknown,
			preview?: {
				originalContent?: string,
				newContent?: string,
				mode?: string
			}
		}
	}
}
```

**Event Processing Flow:**

```
SSE Stream → handleSDKEvent() → Validate → EventBus.emit()
```

**Implementation:**
```typescript
private handleSDKEvent(event: any): void {
	// ... existing event handlers ...
	
	if (event.type === "permission.request") {
		const sessionId = this.extractSessionIdFromEvent(event) || "";
		const { requestId, operation, resourcePath, context } = 
			event.properties || event.data || event;

		// Validate required fields
		if (!requestId || !operation || !resourcePath) {
			console.warn("[OpenCodeClient] Malformed permission.request:", event);
			return; // Don't emit to event bus
		}

		// Emit to event bus
		this.eventBus.emitPermissionRequest({
			sessionId, requestId, operation, resourcePath, context
		});
	}
}
```

**Validation Rules:**
1. Extract sessionId from event metadata
2. Extract requestId, operation, resourcePath from event properties/data
3. Check all required fields are present and non-empty
4. If valid → emit to event bus
5. If invalid → log warning, don't emit

**Malformed Event Handling:**
- Log warning with full event details
- Don't emit to event bus (prevents downstream errors)
- Server should be notified (future enhancement)

## Event Bus Integration

### Event Emission

**Pattern:** Client emits events, doesn't consume them

**Events Emitted:**
- `emitStreamToken()` - For message content
- `emitStreamThinking()` - For agent reasoning
- `emitProgressUpdate()` - For progress updates
- `emitSessionEnd()` - For session termination
- `emitPermissionRequest()` - For permission requests *(New)*
- `emitError()` - For errors

**Event Bus Setup:**
```typescript
// In plugin initialization
const eventBus = new SessionEventBus();
const client = new OpenCodeServerClient(config, errorHandler);

// Client uses event bus for emission
client.setEventBus(eventBus);
```

### Separation of Concerns

**Client Responsibilities:**
- Receive SSE events from server
- Validate event data
- Emit events to event bus
- Send HTTP requests to server

**Client Does NOT:**
- Handle permission logic (that's PermissionCoordinator)
- Show UI modals (that's PermissionModal)
- Validate vault permissions (that's PermissionManager)
- Make permission decisions (that's user via modal)

## HTTP Request Handling

### Custom Fetch Implementation

**Why:** Obsidian plugins must use `requestUrl` API, not standard `fetch`

**Implementation:**
```typescript
private createObsidianFetch(): typeof fetch {
	return async (url: RequestInfo | URL, init?: RequestInit) => {
		// Convert fetch options to Obsidian requestUrl format
		const response = await requestUrl({
			url: resolvedUrl,
			method,
			headers,
			contentType,
			body
		});
		
		// Convert Obsidian response to fetch Response format
		return new Response(response.arrayBuffer, {
			status: response.status,
			headers: response.headers
		});
	};
}
```

**Timeout Handling:**
- Base timeout: 10 seconds (configurable)
- Message/prompt endpoints: 60 seconds minimum (longer processing)
- Permission response: Uses base timeout (10s)

### Retry Logic

**Permission Response Retry:**
- Attempts: 2 (initial + 1 retry)
- Delay: 500ms between attempts
- Logging: Warning on retry, Error on final failure

**Why Retry:**
- Network transient failures
- Server temporary unavailability
- Load balancer issues

**Why Only 2 Attempts:**
- Permission responses are time-sensitive (60s timeout)
- User is waiting for response
- More retries = longer delay
- If server is down, fail fast

## Connection State Management

**States:**
- `disconnected` - Not connected to server
- `connecting` - Connection attempt in progress
- `connected` - Successfully connected
- `reconnecting` - Attempting to reconnect after failure

**State Transitions:**
```
disconnected → connecting → connected
                    ↓
              reconnecting → connected
                    ↓
              disconnected (max retries)
```

**Permission Impact:**
- Permission requests only work when `connected`
- If disconnected during request → timeout will auto-deny
- Session end event triggers cleanup

## Error Handling

### Error Severity Levels

**Critical:** Server unreachable, plugin cannot function
**Error:** Operation failed, user should be notified
**Warning:** Recoverable issue, logged for debugging
**Info:** Informational message, normal operation

### Permission-Related Errors

**Malformed Event:**
- Severity: Warning
- Action: Log warning, don't emit
- User Impact: None (request never reaches coordinator)

**Response Send Failure (Retry):**
- Severity: Warning
- Action: Log retry attempt, wait 500ms, retry
- User Impact: Slight delay (500ms)

**Response Send Failure (Final):**
- Severity: Error
- Action: Log error, throw exception
- User Impact: Coordinator handles gracefully (already logged decision)

**Network Timeout:**
- Severity: Error
- Action: Log error, fail request
- User Impact: Permission request may timeout on user side

### Error Context

**Pattern:**
```typescript
this.errorHandler.handleError(error, {
	module: "OpenCodeClient",
	function: "respondToPermission",
	operation: "Retry attempt 1",
	metadata: { sessionId, requestId, approved }
}, ErrorSeverity.Warning);
```

**Benefits:**
- Structured error logging
- Easy debugging
- Consistent error format
- Metadata for troubleshooting

## Testing

### Unit Tests

**File:** `client.test.ts`

**Test Cases:**

**respondToPermission:**
- Successful response on first attempt
- Retry on first failure, success on second
- Failure after all retries
- 500ms delay between retries
- Correct request body format

**SSE Event Handling:**
- Valid permission.request event emits to event bus
- Malformed event logs warning, no emission
- Event with all optional fields handled correctly
- SessionId extraction from event metadata

### Mocking Strategy

**Mock:** SDK client, HTTP requests, SSE stream
**Don't Mock:** ErrorHandler, EventBus (test real integration)

**Example:**
```typescript
describe("respondToPermission", () => {
	let mockSDKClient: any;
	let client: OpenCodeServerClient;

	beforeEach(() => {
		mockSDKClient = {
			session: {
				permission: {
					respond: vi.fn()
				}
			}
		};
		client = new OpenCodeServerClient(config, errorHandler);
		(client as any).sdkClient = mockSDKClient;
	});

	it("should send response successfully", async () => {
		mockSDKClient.session.permission.respond.mockResolvedValue({
			data: { success: true }
		});

		await client.respondToPermission("session-1", "req-1", true);

		expect(mockSDKClient.session.permission.respond).toHaveBeenCalledWith({
			path: { id: "session-1" },
			body: { requestId: "req-1", approved: true, reason: undefined }
		});
	});
});
```

## Integration Points

### With SessionEventBus
- Emits permission request events
- Emits session end events
- Emits stream token, thinking, progress events

### With PermissionCoordinator
- Coordinator calls `respondToPermission()` to send responses
- Coordinator relies on client's retry logic
- Coordinator handles client errors gracefully

### With ErrorHandler
- All errors logged through ErrorHandler
- Consistent error severity levels
- Structured error context

### With OpenCode Server
- Receives SSE events from server
- Sends HTTP requests to server
- Uses official OpenCode SDK client

## Configuration

**Server URL:** Configured in plugin settings
**Request Timeout:** 10s base, 60s for message/prompt endpoints
**Retry Attempts:** 2 (initial + 1 retry)
**Retry Delay:** 500ms

## Best Practices

### For Client Users

1. **Always handle errors** from `respondToPermission()`
2. **Don't retry manually** (client handles retries)
3. **Use event bus** for event consumption (don't poll)
4. **Check connection state** before critical operations

### For Client Maintainers

1. **Validate all SSE events** before emitting
2. **Use ErrorHandler** for all errors
3. **Keep retry logic simple** (2 attempts max)
4. **Document event structures** with TypeScript interfaces
5. **Test with mocked SDK** (don't hit real server)

<claude-mem-context>
# Recent Activity

<!-- This section is auto-generated by claude-mem. Edit content outside the tags. -->

*No recent activity*
</claude-mem-context>