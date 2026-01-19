# Tools/Obsidian Module

## Overview

This module provides permission-based tool execution for Obsidian vault operations. It bridges OpenCode Server's permission requests with the plugin's permission system, ensuring all vault operations are validated and approved by the user.

## Core Components

### PermissionCoordinator

**File:** `permission-coordinator.ts`

**Purpose:** Orchestrates the complete permission request flow between OpenCode Server and the plugin's permission system.

**Key Responsibilities:**
- Receives permission requests from server (via SessionEventBus)
- Validates requests against plugin permission rules (PermissionManager)
- Shows permission modal to user for approval
- Sends responses back to server (via OpenCodeServerClient)
- Manages request queueing (only one modal at a time)
- Handles 60-second timeout for user responses
- Cleans up pending requests on session end

**Flow:**
```
Server SSE Event → SessionEventBus → PermissionCoordinator
                                            ↓
                                  PermissionManager (validate)
                                            ↓
                                  PermissionModal (user decision)
                                            ↓
                                  OpenCodeClient.respondToPermission()
                                            ↓
                                  Server HTTP Response
```

**Key Methods:**
- `handleRequest()` - Processes incoming permission requests
- `showModal()` - Displays permission modal with queueing logic
- `handleUserResponse()` - Sends user decision to server
- `handleTimeout()` - Auto-denies requests after 60 seconds
- `cleanupSession()` - Denies all pending requests when session ends

**Integration:**
- Initialized in `src/main.ts` during plugin load
- Requires: OpenCodeServerClient, SessionEventBus, PermissionManager, AuditLogger, ErrorHandler
- Auto-registers listeners for permission requests and session end events

### PermissionManager

**File:** `permission-manager.ts`

**Purpose:** Validates vault operations against permission rules and scope.

**Permission Levels:**
- `ReadOnly` - Only read operations allowed
- `ScopedWrite` - Write operations allowed within defined scope
- `FullWrite` - All write operations allowed (including delete)

**Key Methods:**
- `validatePath()` - Validates path against permission scope
- `canRead()`, `canWrite()`, `canCreate()`, `canModify()`, `canDelete()` - Operation-specific checks
- `requiresApproval()` - Determines if operation needs user approval

**Validation Rules:**
1. Check denied paths first (highest priority)
2. Check allowed paths (if specified, path must match)
3. Check file extensions (if specified)
4. Check file size limits (for read/modify operations)

**Integration with PermissionCoordinator:**
- PermissionCoordinator calls `validatePath()` before showing modal
- If validation fails, request is auto-denied without showing modal
- If validation passes, modal is shown to user

### PermissionModal

**File:** `permission-modal.ts`

**Purpose:** UI modal for displaying permission requests to users.

**Features:**
- Shows operation type, resource path, and preview
- Displays 60-second countdown timer
- Provides "Approve" and "Deny" buttons
- Auto-denies if modal closed without explicit response
- Supports different preview modes (replace, append, prepend, insert)

**Key Properties:**
- `responseHandled` - Tracks if user explicitly approved/denied
- `countdownInterval` - Timer for countdown display
- `timeoutSeconds` - Remaining seconds (starts at 60)

**Behavior:**
- If user clicks "Approve" or "Deny" → calls callback with decision
- If user closes modal (X, ESC, click outside) → auto-denies with reason "Modal closed without response"
- Countdown updates every second
- Timer stops when modal closes or user responds

### AuditLogger

**File:** `audit-logger.ts`

**Purpose:** Records all permission decisions for debugging and compliance.

**New Methods (for permission system):**
- `queryBySession(sessionId)` - Retrieves all audit logs for a session
- `queryByRequestId(requestId)` - Retrieves audit logs for a specific request

**Audit Log Entries:**
- Request received: sessionId, requestId, operation, path, timestamp
- User decision: approved/denied, reason
- Auto-denials: plugin denied, timeout, session ended

### Tool Registry & Executor

**Files:** `tool-registry.ts`, `tool-executor.ts`

**Purpose:** Define and execute Obsidian vault tools with permission checks.

**Tools:**
- `obsidian.read_note` - Read note content
- `obsidian.update_note` - Update note with various modes
- `obsidian.create_note` - Create new note
- `obsidian.search_notes` - Search vault
- `obsidian.list_notes` - List notes in folder

**Permission Integration:**
- All tools validate operations via PermissionManager
- Write operations require user approval (shown via PermissionModal)
- Tool execution logs to AuditLogger

## Permission Flow

### 1. Server Requests Permission

Server sends `permission.request` SSE event with:
- `sessionId` - Session identifier
- `requestId` - Unique request identifier
- `operation` - Operation type (read, write, delete, etc.)
- `resourcePath` - Path to resource
- `context` - Optional tool name, args, preview

### 2. Event Bus Emits Event

SessionEventBus receives event and emits to registered listeners:
```typescript
eventBus.emitPermissionRequest({
	sessionId, requestId, operation, resourcePath, context
});
```

### 3. Coordinator Validates

PermissionCoordinator receives event and:
1. Logs request to AuditLogger
2. Maps operation to OperationType (read/write/create/modify/delete)
3. Calls `permissionManager.validatePath(resourcePath, opType)`

### 4. Plugin Validation

PermissionManager checks:
- Permission level (read-only blocks all writes)
- Denied paths (auto-deny if matches)
- Allowed paths (auto-deny if doesn't match)
- File extensions (auto-deny if not allowed)
- File size limits (for existing files)

**If validation fails:**
- Auto-deny request (no modal shown)
- Send denial to server with reason
- Log to AuditLogger

**If validation passes:**
- Proceed to show modal

### 5. User Approval

PermissionModal displays:
- Operation type and resource path
- Preview of changes (if available)
- 60-second countdown timer
- Approve/Deny buttons

**User actions:**
- Click "Approve" → approved = true
- Click "Deny" → approved = false, reason = "User denied"
- Close modal → approved = false, reason = "Modal closed without response"
- Wait 60s → approved = false, reason = "Request timed out"

### 6. Response Sent

PermissionCoordinator:
1. Clears timeout
2. Calls `client.respondToPermission(sessionId, requestId, approved, reason)`
3. Logs decision to AuditLogger
4. Processes next queued request (if any)

### 7. Server Receives Response

OpenCodeServerClient sends HTTP POST to server's permission endpoint:
```typescript
POST /sessions/{sessionId}/permission/respond
Body: { requestId, approved, reason }
```

**Retry logic:**
- Initial attempt
- 1 retry after 500ms delay
- Throws error if both fail

## Queueing Behavior

**Problem:** Only one modal can be shown at a time.

**Solution:** Request queueing in PermissionCoordinator.

**How it works:**
1. First request → show modal immediately
2. Subsequent requests → add to queue with timeout
3. When modal closes → process next queued request
4. Each queued request has its own 60s timeout

**Timeout handling:**
- Timeout starts when request is received (not when modal is shown)
- If request times out while queued → auto-denied, removed from queue
- If request times out while modal is open → modal closed, request denied

## Session Cleanup

**Trigger:** Session end event from server

**Actions:**
1. Find all pending requests for session
2. Clear timeouts for those requests
3. Send denial to server with reason "Session ended"
4. Remove requests from pending map
5. Remove requests from queue
6. Close current modal if it belongs to this session

**Purpose:** Ensures no orphaned permission requests when session ends unexpectedly.

## Error Handling

All errors use ErrorHandler with appropriate severity:

**Malformed events** → Deny + log Warning
**Plugin validation failure** → Deny + log Info
**Network failure** → Retry once (500ms delay) + log Error
**Timeout** → Deny + log Info
**Session end** → Deny pending + log Info
**Internal errors** → Deny + log Error

**Pattern:**
```typescript
this.errorHandler.handleError(error, {
	module: 'PermissionCoordinator',
	function: 'handleRequest',
	metadata: { sessionId, requestId }
}, ErrorSeverity.Error);
```

## Integration Points

### With SessionEventBus
- Listens to `onPermissionRequest()` events
- Listens to `onSessionEnd()` events

### With OpenCodeServerClient
- Calls `respondToPermission()` to send responses
- Relies on client's retry logic for network failures

### With PermissionManager
- Calls `validatePath()` to check plugin permissions
- Uses `getPermissionLevel()` for audit logging

### With AuditLogger
- Logs request received
- Logs user decision (approved/denied)
- Logs auto-denials (plugin, timeout, session end)

### With PermissionModal
- Creates modal with request details
- Provides callback for user response
- Modal auto-denies if closed without response

## Testing

**Unit Tests:**
- `permission-coordinator.test.ts` - Core flow, queueing, timeout, cleanup
- `permission-manager.test.ts` - Validation rules, permission levels
- `permission-modal.test.ts` - UI behavior, countdown, auto-deny

**Additional Coverage:**
- Event flow integrity
- Malformed event handling
- Plugin validation precedence
- Request queueing
- Session cleanup
- Audit completeness

## Configuration

**Timeout:** 60 seconds (hardcoded in `TIMEOUT_MS` constant)

**Permission Levels:** Configured in plugin settings
- Read-only: No writes allowed
- Scoped-write: Writes allowed within scope
- Full-write: All operations allowed (including delete)

**Permission Scope:** Configured in plugin settings
- `allowedPaths` - Glob patterns for allowed paths
- `deniedPaths` - Glob patterns for denied paths (highest priority)
- `allowedExtensions` - Allowed file extensions
- `maxFileSize` - Maximum file size for read/modify operations

<claude-mem-context>
# Recent Activity

<!-- This section is auto-generated by claude-mem. Edit content outside the tags. -->

*No recent activity*
</claude-mem-context>
