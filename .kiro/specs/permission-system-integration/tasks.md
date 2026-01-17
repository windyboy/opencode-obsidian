# Implementation Tasks: Permission System Integration

## Overview

Bridge OpenCode Server's permission requests (SSE events) with the plugin's existing permission system. Implement PermissionCoordinator to handle the flow: receive → validate → show modal → respond.

## Tasks

-   [x] 1. Extend SessionEventBus for Permission Events

    -   [x] 1.1 Add PermissionRequestEvent interface
        -   Add interface to `src/session/session-event-bus.ts`
        -   Include fields: sessionId, requestId, operation, resourcePath, context
        -   Export interface for use in other modules
        -   _Requirements: 1.2_
    -   [x] 1.2 Add permission event handlers
        -   Add `permissionRequestListeners` array
        -   Add `onPermissionRequest()` method returning Unsubscribe
        -   Add `emitPermissionRequest()` method
        -   Follow existing event pattern (onStreamToken, etc.)
        -   _Requirements: 1.2_
    -   [x] 1.3 Test permission event flow
        -   Write unit tests in `src/session/session-event-bus.test.ts`
        -   Test listener receives emitted events
        -   Test multiple listeners receive same event
        -   Test unsubscribe removes listener
        -   _Requirements: 1.2_

-   [x] 2. Extend OpenCodeClient for Permission Handling

    -   [x] 2.1 Add respondToPermission method
        -   Add method to `src/opencode-server/client.ts`
        -   Implement retry logic (2 attempts, 500ms delay)
        -   Call `sdkClient.session.permission.respond()`
        -   Log retry attempts with ErrorSeverity.Warning
        -   Throw error after all attempts fail
        -   _Requirements: 4.1, 4.2, 4.3_
    -   [x] 2.2 Handle permission.request SSE events
        -   Add `permission.request` case in `handleSDKEvent()`
        -   Extract sessionId, requestId, operation, resourcePath, context
        -   Validate required fields
        -   Log warning for malformed events
        -   Call `eventBus.emitPermissionRequest()` with parsed data
        -   _Requirements: 1.1, 1.3_
    -   [x] 2.3 Test respondToPermission
        -   Write unit tests in `src/opencode-server/client.test.ts`
        -   Test successful response
        -   Test retry on first failure, success on second
        -   Test failure after all retries
        -   Test 500ms delay between retries
        -   _Requirements: 4.1, 4.2, 4.3_
    -   [x] 2.4 Test SSE permission event handling
        -   Write unit tests in `src/opencode-server/client.test.ts`
        -   Test valid event emits to eventBus
        -   Test malformed event logs warning, no emission
        -   Test event with all optional fields
        -   _Requirements: 1.1, 1.3_

-   [x] 3. Create PermissionCoordinator

    -   [x] 3.1 Create PermissionCoordinator structure
        -   Create `src/tools/obsidian/permission-coordinator.ts`
        -   Add constructor with dependencies (client, eventBus, permissionManager, auditLogger, errorHandler)
        -   Add `setApp()` method
        -   Add TIMEOUT_MS constant (60000)
        -   Add PendingRequest interface
        -   Setup event listeners in constructor
        -   _Requirements: 2.1, 2.2, 2.3_
    -   [x] 3.2 Implement request handling
        -   Implement `handleRequest()` method
        -   Log request to AuditLogger
        -   Call `permissionManager.validatePath()`
        -   Auto-deny if plugin denies (no modal)
        -   Call `showModal()` if plugin allows
        -   Handle errors with ErrorHandler
        -   _Requirements: 2.1, 2.2, 2.3, 7.1_
    -   [x] 3.3 Implement modal display and queueing
        -   Implement `showModal()` method
        -   Implement queueing logic (only one modal at a time)
        -   Implement `processNextQueued()` method
        -   Set timeout for each request
        -   Create PermissionModal with callback
        -   _Requirements: 3.5_
    -   [x] 3.4 Implement timeout handling
        -   Implement `handleTimeout()` method
        -   Clear timeout on user response
        -   Auto-deny request on timeout
        -   Close modal on timeout
        -   Send "Request timed out" reason
        -   Process next queued request
        -   _Requirements: 5.1, 5.2, 5.3_
    -   [x] 3.5 Implement session cleanup
        -   Implement `cleanupSession()` method
        -   Listen to `eventBus.onSessionEnd()`
        -   Clear all timeouts for session
        -   Deny all pending requests with "Session ended"
        -   Remove requests from queue
        -   Log denials to AuditLogger
        -   _Requirements: 6.1, 6.2_
    -   [x] 3.6 Test PermissionCoordinator flows
        -   Write unit tests in `src/tools/obsidian/permission-coordinator.test.ts`
        -   Test valid request shows modal
        -   Test malformed request auto-denies
        -   Test plugin deny skips modal
        -   Test user approve/deny sends response
        -   Test timeout auto-denies
        -   Test session cleanup denies pending
        -   Test queueing (second request waits)
        -   _Requirements: All_

-   [x] 4. Extend PermissionModal

    -   [x] 4.1 Add countdown timer UI
        -   Update `src/tools/obsidian/permission-modal.ts`
        -   Add countdown timer in modal title
        -   Show "(60s)" initially
        -   Update every second via setInterval
        -   Stop at 0 or when modal closes
        -   Add `countdownEl` and `countdownInterval` properties
        -   _Requirements: 3.3_
    -   [x] 4.2 Add response tracking
        -   Add `responseHandled` flag (defaults to false)
        -   Set to true before calling `onResponse()` callback
        -   Prevents duplicate responses
        -   _Requirements: 3.4_
    -   [x] 4.3 Handle modal close without response
        -   Update `onClose()` method
        -   Check `responseHandled` flag
        -   Call `onResponse(false, 'Modal closed without response')` if not handled
        -   Stop countdown timer
        -   Clear content
        -   _Requirements: 3.4_

-   [x] 5. Extend AuditLogger

    -   [x] 5.1 Add queryBySession method
        -   Add method to `src/tools/obsidian/audit-logger.ts`
        -   Filter logs by sessionId match
        -   Return array of AuditLogEntry
        -   Handle errors with ErrorHandler
        -   Return empty array on error
        -   _Requirements: 7.3_
    -   [x] 5.2 Add queryByRequestId method
        -   Add method to `src/tools/obsidian/audit-logger.ts`
        -   Filter logs by callId match
        -   Return array of AuditLogEntry
        -   Handle errors with ErrorHandler
        -   Return empty array on error
        -   _Requirements: 7.3_

-   [x] 6. Integrate PermissionCoordinator into Plugin

    -   [x] 6.1 Initialize PermissionCoordinator in plugin
        -   Update `src/main.ts`
        -   Add property: `private permissionCoordinator: PermissionCoordinator | null = null`
        -   Initialize in `onload()` after dependencies
        -   Call `setApp(this.app)` after initialization
        -   Set to null in `onunload()`
        -   _Requirements: All_
    -   [x] 6.2 Verify end-to-end integration
        -   Manual testing of permission flow
        -   Plugin loads without errors
        -   Permission request event triggers modal
        -   User can approve/deny
        -   Response sent to server
        -   Timeout works correctly
        -   Session cleanup works
        -   _Requirements: All_

-   [ ] 7. Property-Based Testing

    -   [x] 7.1 Property test: Event flow integrity
        -   Write test in `src/session/session-event-bus.test.ts`
        -   Generate random valid PermissionRequestEvent
        -   Register multiple listeners
        -   Emit event
        -   Verify all listeners received complete data
        -   Run 100+ iterations
        -   _Requirements: 1.1, 1.2_
    -   [x] 7.2 Property test: Malformed event handling
        -   Write test in `src/opencode-server/client.test.ts`
        -   Generate events with missing fields
        -   Verify no modal shown
        -   Verify warning logged
        -   Run 100+ iterations
        -   _Requirements: 1.3_
    -   [x] 7.3 Property test: Plugin validation precedence
        -   Write test in `src/tools/obsidian/permission-coordinator.test.ts`
        -   Generate random requests
        -   Mock PermissionManager to deny
        -   Verify no modal shown
        -   Verify auto-deny sent to server
        -   Run 100+ iterations
        -   _Requirements: 2.1, 2.2_
    -   [x] 7.4 Property test: Modal display for allowed ops
        -   Write test in `src/tools/obsidian/permission-coordinator.test.ts`
        -   Generate random allowed requests
        -   Verify modal shown with correct data
        -   Run 100+ iterations
        -   _Requirements: 2.3, 3.1, 3.2, 3.3, 3.4_
    -   [x] 7.5 Property test: User response transmission
        -   Write test in `src/tools/obsidian/permission-coordinator.test.ts`
        -   Generate random approve/deny decisions
        -   Verify response sent with correct requestId
        -   Verify retry on failure
        -   Run 100+ iterations
        -   _Requirements: 4.1, 4.2, 4.3_
    -   [x] 7.6 Property test: Request queueing
        -   Write test in `src/tools/obsidian/permission-coordinator.test.ts`
        -   Generate multiple concurrent requests
        -   Verify only one modal shown at a time
        -   Verify requests processed in order
        -   Run 100+ iterations
        -   _Requirements: 3.5_
    -   [x] 7.7 Property test: Timeout behavior
        -   Write test in `src/tools/obsidian/permission-coordinator.test.ts`
        -   Generate random requests
        -   Simulate timeout (mock timer)
        -   Verify auto-deny with "Request timed out"
        -   Verify modal closed
        -   Run 100+ iterations
        -   _Requirements: 5.1, 5.2, 5.3_
    -   [x] 7.8 Property test: Session cleanup
        -   Write test in `src/tools/obsidian/permission-coordinator.test.ts`
        -   Generate random pending requests for session
        -   Emit session end event
        -   Verify all requests denied with "Session ended"
        -   Verify requests removed from queue
        -   Run 100+ iterations
        -   _Requirements: 6.1, 6.2_
    -   [x] 7.9 Property test: Audit completeness
        -   Write test in `src/tools/obsidian/permission-coordinator.test.ts`
        -   Generate random permission flows
        -   Verify audit log contains complete data
        -   Verify queryBySession returns correct logs
        -   Run 100+ iterations
        -   _Requirements: 7.1, 7.2, 7.3_

-   [ ] 8. Documentation and Cleanup

    -   [x] 8.1 Add JSDoc comments
        -   Add JSDoc to all public methods
        -   Add @param and @returns tags
        -   Add explanatory comments for complex logic
        -   Document interfaces with field descriptions
    -   [x] 8.2 Update CLAUDE.md files
        -   Update `src/tools/obsidian/CLAUDE.md`
        -   Update `src/session/CLAUDE.md`
        -   Update `src/opencode-server/CLAUDE.md`
        -   Document permission flow
        -   List new components
        -   Explain integration points

## Notes

-   Focus on minimal, secure implementation following existing patterns
-   Reuse existing components (PermissionModal, PermissionManager, AuditLogger)
-   Event-driven architecture via SessionEventBus
-   Non-blocking with 60s timeout
-   Property-based testing validates all correctness properties
