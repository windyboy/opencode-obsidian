# Requirements: Permission System Integration

## Overview

Connect OpenCode Server's permission requests (via SSE) with the plugin's existing permission system. Server requests are validated by PermissionManager, shown to users via PermissionModal, and responses sent back to server.

## Glossary

- **PermissionManager**: Plugin component validating vault operations
- **PermissionModal**: UI modal for user approval/denial
- **OpenCode_Client**: SDK wrapper in `src/opencode-server/client.ts`
- **Session_Event_Bus**: Event bus handling SSE events in `src/session/session-event-bus.ts`
- **PermissionCoordinator**: New component bridging server and plugin permission systems

## Requirements

### 1. Receive Server Permission Requests

**User Story:** Receive and parse permission requests from OpenCode Server.

**Acceptance Criteria:**

1.1 OpenCode_Client handles `permission.request` SSE events

1.2 Session_Event_Bus emits events with sessionId, requestId, operation, resourcePath, context

1.3 Malformed events (missing required fields) are denied and logged

### 2. Validate Against Plugin Permissions

**User Story:** Check server requests against existing plugin permission rules.

**Acceptance Criteria:**

2.1 PermissionCoordinator validates requests via PermissionManager before showing modal

2.2 Plugin-denied operations auto-deny server request (no modal shown)

2.3 Plugin-allowed operations show modal to user

### 3. Display Permission Modal

**User Story:** Show permission requests to user for approval.

**Acceptance Criteria:**

3.1 PermissionModal displays operation, resource path, and preview

3.2 Modal provides "Approve" and "Deny" buttons

3.3 Modal shows 60-second countdown timer

3.4 Modal close without response = denial

3.5 Only one modal shown at a time (queue subsequent requests)

### 4. Handle User Response

**User Story:** Send user decisions back to server.

**Acceptance Criteria:**

4.1 OpenCode_Client provides `respondToPermission(sessionId, requestId, approved, reason?)`

4.2 Method sends response to server's permission endpoint

4.3 Failed responses retry once, then log error

4.4 Method completes within 5 seconds or times out

### 5. Timeout Handling

**User Story:** Auto-deny requests if user doesn't respond.

**Acceptance Criteria:**

5.1 60-second timeout starts when modal opens

5.2 Timeout auto-denies request and closes modal

5.3 Timeout sends denial with reason "Request timed out"

### 6. Session Cleanup

**User Story:** Clean up pending requests when session ends.

**Acceptance Criteria:**

6.1 Session end auto-denies all pending requests for that session

6.2 Pending requests removed from queue

### 7. Audit Logging

**User Story:** Track all permission decisions for debugging.

**Acceptance Criteria:**

7.1 Log entry created when request received (sessionId, requestId, operation, path, timestamp)

7.2 Log updated with user decision (approved/denied + reason)

7.3 Audit log queryable by sessionId

## Constraints

- Use existing `@opencode-ai/sdk` client
- Reuse PermissionModal and PermissionManager
- Follow ErrorHandler patterns
- Non-blocking operations
- 60-second timeout (hardcoded, no settings UI for now)

## Out of Scope

- Configurable timeout in settings UI
- Batch permission approval
- Permission history viewer
- Custom timeouts per operation
- Request prioritization beyond FIFO
