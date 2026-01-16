# Implementation Plan: Session Management Enhancement

## Current Status

**Phase 1 (Core Session Management)**: ✅ **COMPLETE**
- All data models, API integration, services, and UI components implemented
- Property-based testing framework set up with fast-check
- All 16 correctness properties implemented and passing

**Phase 2 (Enhanced Sync and Error Handling)**: ✅ **COMPLETE**
- Periodic sync with 5-minute intervals implemented
- Comprehensive error handling with retry logic (3 attempts with exponential backoff)
- Loading states and UI feedback fully implemented
- User-friendly error messages and connection status indicators

**Phase 3 (Polish and Optimization)**: 🟡 **IN PROGRESS**
- Performance optimizations complete (caching, debouncing)
- UI polish mostly complete (transitions, hover effects, tooltips, visual indicators)
- **Remaining**: Keyboard shortcuts (task 22.3)
- **Remaining**: Integration testing and documentation (task 23)
- **Remaining**: Final validation with real server (task 24)

## Overview

This implementation plan adds server-side session management to the OpenCode Obsidian plugin, enabling users to list, view, create, update, and delete sessions with full message history support.

**Testing Framework**: This spec uses property-based testing with `fast-check` to verify correctness properties.

## Tasks

### Phase 1: Core Session Management (MVP)

-   [x] 1. Data Model Updates

    -   [x] 1.1 Add `sessionId?: string` field to existing `Conversation` type in `src/types.ts` (Already exists)
    -   [x] 1.2 Create `SessionListItem` interface in `src/types.ts` for session list display
    -   [x] 1.3 Add `lastSyncTimestamp: number` to plugin data storage schema
    -   _Requirements: 1, 2, 3_

-   [x] 2. OpenCode Client Session API Integration

    -   [x] 2.1 Add `listSessions()` method to `OpenCodeServerClient` using `sdkClient.session.list()`
    -   [x] 2.2 Add `getSessionMessages(sessionId)` method using `sdkClient.session.messages()`
    -   [x] 2.3 Add `updateSessionTitle(sessionId, title)` method using `sdkClient.session.update()`
    -   [x] 2.4 Add `deleteSession(sessionId)` method using `sdkClient.session.delete()`
    -   [x] 2.5 Add error handling for 404 (session not found) and 500 (server error) responses in all session methods
    -   _Requirements: 1, 2, 3_

-   [x] 3. Session Manager Service

    -   [x] 3.1 Create `src/views/services/session-manager.ts` with `SessionManager` class
    -   [x] 3.2 Implement `listSessions()` to fetch server sessions and transform to `SessionListItem[]`
    -   [x] 3.3 Implement `createSession(title?)` that creates server session via client and returns session ID
    -   [x] 3.4 Implement `loadSessionMessages(sessionId)` to fetch message history from server
    -   [x] 3.5 Implement `updateSessionTitle(sessionId, title)` with server sync via client
    -   [x] 3.6 Implement `deleteSession(sessionId)` with server sync and local conversation cleanup
    -   [x] 3.7 Add in-memory session list cache with 5-minute TTL and cache invalidation on create/delete
    -   _Requirements: 1, 2, 3_

-   [x] 4. Update ConversationSync to Use Server Sessions

    -   [x] 4.1 Update `ConversationSync.syncConversationsFromServer()` to call `SessionManager.listSessions()`
    -   [x] 4.2 Map server sessions to local `Conversation` objects with proper field mapping
    -   [x] 4.3 Merge server sessions with existing local conversations (match by sessionId)
    -   [x] 4.4 Handle sessions that exist on server but not locally (create local conversation)
    -   [x] 4.5 Handle sessions that exist locally but not on server (keep local or remove based on policy)
    -   _Requirements: 1, 3_

-   [x] 5. Enhance ConversationManager with Session Operations

    -   [x] 5.1 Update `ConversationManager.createNewConversation()` to call `SessionManager.createSession()`
    -   [x] 5.2 Update `ConversationManager.renameConversation()` to call `SessionManager.updateSessionTitle()` if sessionId exists
    -   [x] 5.3 Update `ConversationManager.deleteConversation()` to call `SessionManager.deleteSession()` if sessionId exists
    -   [x] 5.4 Add `ConversationManager.loadSessionMessages()` to fetch and populate conversation messages from server
    -   [x] 5.5 Ensure all conversation operations update both local state and server when sessionId is present
    -   _Requirements: 1, 2, 3_

-   [x] 6. Update MessageSender for Session Sync

    -   [x] 6.1 Ensure `MessageSender.sendMessage()` creates server session if conversation has no sessionId
    -   [x] 6.2 Update conversation's sessionId after successful session creation
    -   [x] 6.3 Verify session exists on server before sending message (use `ensureSession()`)
    -   [x] 6.4 Handle session not found errors by creating new session and retrying
    -   _Requirements: 1, 3_

-   [x] 7. Enhance ConversationSelector UI

    -   [x] 7.1 Update `ConversationSelectorComponent` to show session metadata (message count, last updated)
    -   [x] 7.2 Add visual indicator for conversations with active server sessions (● icon)
    -   [x] 7.3 Add loading state during session operations (create, rename, delete)
    -   [x] 7.4 Update delete confirmation to mention server session deletion if applicable
    -   [x] 7.5 Add "Sync from server" button to manually trigger session list refresh
    -   _Requirements: 1, 4_

-   [x] 8. Session Context Preservation

    -   [x] 8.1 Save `lastActiveSessionId` to Obsidian workspace state on conversation switch
    -   [x] 8.2 Restore last active session on plugin load from workspace state
    -   [x] 8.3 Handle case where last session no longer exists (fallback to first conversation or create new)
    -   [x] 8.4 Save scroll position per conversation (debounced to 500ms) in plugin data
    -   [x] 8.5 Restore scroll position when switching back to conversation
    -   _Requirements: 4_

-   [x] 9. Unit Testing

    -   [x] 9.1 Create `src/views/services/session-manager.test.ts` with unit tests
    -   [x] 9.2 Test `listSessions()` returns correct data structure and handles errors
    -   [x] 9.3 Test `createSession()` creates session on server and returns ID
    -   [x] 9.4 Test `loadSessionMessages()` fetches and transforms messages correctly
    -   [x] 9.5 Test error handling for network failures, 404, and 500 responses
    -   [x] 9.6 Test session cache TTL and invalidation logic
    -   _Requirements: 1, 2, 3_

-   [x] 10. Property-Based Testing Setup

    -   [x] 10.1 Install `fast-check` as dev dependency: `bun add -D fast-check @types/fast-check`
    -   [x] 10.2 Create `src/views/services/session-manager.property.test.ts` for property tests
    -   [x] 10.3 Create test generators for `SessionListItem`, `Message`, and `EnhancedConversation` types
    -   [x] 10.4 Create mock OpenCodeServerClient that simulates server behavior for property tests
    -   _Requirements: All_

-   [x] 11. Property-Based Tests - Session List Management

    -   [x] 11.1 **Property: Session list idempotency** - Calling `listSessions()` multiple times without modifications returns identical results
        -   **Validates: Requirements 1.1**
        -   Generator: Array of random sessions
        -   Property: `listSessions() === listSessions()` (deep equality)
    -   [x] 11.2 **Property: Session list ordering** - Sessions are always sorted by `lastUpdated` descending
        -   **Validates: Requirements 1.4**
        -   Generator: Array of sessions with random timestamps
        -   Property: `sessions[i].lastUpdated >= sessions[i+1].lastUpdated` for all i
    -   [x] 11.3 **Property: Session list completeness** - All created sessions appear in the list
        -   **Validates: Requirements 1.3**
        -   Generator: Array of session titles to create
        -   Property: After creating N sessions, `listSessions().length >= N`
    -   _Requirements: 1_

-   [x] 12. Property-Based Tests - Session CRUD Operations

    -   [x] 12.1 **Property: Create-read consistency** - A session created with title T can be retrieved with the same title
        -   **Validates: Requirements 2.1**
        -   Generator: Random session titles (strings 1-100 chars)
        -   Property: `createSession(title).then(id => getSession(id).title === title)`
    -   [x] 12.2 **Property: Update idempotency** - Updating a session title multiple times with the same value produces the same result
        -   **Validates: Requirements 2.2**
        -   Generator: Session ID and new title
        -   Property: `updateTitle(id, t); updateTitle(id, t); getSession(id).title === t`
    -   [x] 12.3 **Property: Delete removes session** - After deleting a session, it no longer appears in the list
        -   **Validates: Requirements 2.3**
        -   Generator: Session ID from existing sessions
        -   Property: `deleteSession(id).then(() => !listSessions().includes(id))`
    -   [x] 12.4 **Property: Error handling consistency** - Operations on non-existent sessions always return 404
        -   **Validates: Requirements 2.4**
        -   Generator: Random non-existent session IDs
        -   Property: All operations (get, update, delete) throw 404 error
    -   _Requirements: 2_

-   [x] 13. Property-Based Tests - Message History

    -   [x] 13.1 **Property: Message ordering** - Messages are always returned in chronological order
        -   **Validates: Requirements 3.2**
        -   Generator: Array of messages with random timestamps
        -   Property: `messages[i].timestamp <= messages[i+1].timestamp` for all i
    -   [x] 13.2 **Property: Message persistence** - All sent messages appear in history
        -   **Validates: Requirements 3.3**
        -   Generator: Array of message contents to send
        -   Property: After sending N messages, `getMessages(sessionId).length >= N`
    -   [x] 13.3 **Property: Message immutability** - Retrieved messages never change content
        -   **Validates: Requirements 3.2**
        -   Generator: Session ID with messages
        -   Property: `getMessages(id)[0].content === getMessages(id)[0].content` (multiple calls)
    -   _Requirements: 3_

-   [x] 14. Property-Based Tests - Session Context Preservation

    -   [x] 14.1 **Property: Session restoration** - Saved session ID is always restored correctly
        -   **Validates: Requirements 4.1, 4.2**
        -   Generator: Random session IDs
        -   Property: `saveSessionId(id); restoreSessionId() === id`
    -   [x] 14.2 **Property: Scroll position preservation** - Saved scroll position is restored within 10px tolerance
        -   **Validates: Requirements 4.4**
        -   Generator: Random scroll positions (0-10000)
        -   Property: `|saveScroll(pos); restoreScroll() - pos| <= 10`
    -   [x] 14.3 **Property: Fallback behavior** - When last session doesn't exist, plugin doesn't crash
        -   **Validates: Requirements 4.3**
        -   Generator: Non-existent session IDs
        -   Property: `restoreSession(invalidId)` returns valid state (list view or new session)
    -   _Requirements: 4_

-   [x] 15. Property-Based Tests - API Compatibility

    -   [x] 15.1 **Property: Feature detection caching** - Feature detection results are cached and consistent
        -   **Validates: Requirements 5.1, 5.2**
        -   Generator: Random feature names
        -   Property: `detectFeatures(); hasFeature(f) === hasFeature(f)` (cached result)
    -   [x] 15.2 **Property: Graceful degradation** - Missing optional features don't cause errors
        -   **Validates: Requirements 5.2**
        -   Generator: Subset of available features
        -   Property: All operations complete without throwing when optional features missing
    -   [x] 15.3 **Property: Error messaging** - Missing core features always produce clear error messages
        -   **Validates: Requirements 5.3**
        -   Generator: Core feature names
        -   Property: When core feature missing, error message contains feature name and version requirement
    -   _Requirements: 5_

-   [x] 16. API Compatibility and Feature Detection

    -   [x] 16.1 Add `detectFeatures()` method to `OpenCodeServerClient` to check available endpoints
    -   [x] 16.2 Cache feature detection results in memory with 5-minute TTL
    -   [x] 16.3 Add `hasFeature(featureName)` helper method for UI components
    -   [x] 16.4 Gracefully handle missing session list/CRUD endpoints (fallback to local-only mode)
    -   [x] 16.5 Show clear error message if core features are required but not available
    -   _Requirements: 5_

### Phase 2: Enhanced Sync and Error Handling

-   [x] 17. Periodic Session Sync

    -   [x] 17.1 Add periodic sync timer (every 5 minutes) in `ConversationSync`
    -   [x] 17.2 Implement background sync that updates session list without disrupting UI
    -   [x] 17.3 Handle concurrent modifications by comparing timestamps
    -   [x] 17.4 Add manual sync trigger in UI (refresh button)
    -   [x] 17.5 Clear sync timer on plugin unload
    -   _Requirements: 1, 4, 11_

-   [x] 18. Error Handling Improvements

    -   [x] 18.1 Add user-friendly error messages for common errors (network, 404, 500)
    -   [x] 18.2 Add retry button for failed session operations
    -   [x] 18.3 Handle 404 errors by removing session from local cache automatically
    -   [x] 18.4 Show connection status indicator in header component
    -   [x] 18.5 Add timeout recovery with 3 retries before showing error
    -   _Requirements: 1, 2, Non-Functional: Reliability_

-   [x] 19. Loading States and UI Feedback

    -   [x] 19.1 Add loading spinner for session list fetch in conversation selector
    -   [x] 19.2 Add loading state for conversation switch with progress indicator
    -   [x] 19.3 Add loading state for create/update/delete operations
    -   [x] 19.4 Disable UI actions during loading to prevent duplicate operations
    -   [x] 19.5 Add success toast notifications for create/update/delete operations
    -   _Requirements: Non-Functional: Usability_

-   [x] 20. Phase 2 Testing

    -   [x] 20.1 Test update and delete operations with server sync
    -   [x] 20.2 Test sync service with multiple sessions
    -   [x] 20.3 Test error handling and retry logic
    -   [x] 20.4 Test loading states and UI feedback
    -   [x] 20.5 Test periodic sync timer and manual refresh
    -   _Requirements: 1, 2, 3_

### Phase 3: Polish and Optimization

-   [x] 21. Performance Optimization

    -   [x] 21.1 Verify in-memory session list cache is working with TTL (5 minutes)
    -   [x] 21.2 Cache messages per session in memory (invalidate on new message)
    -   [x] 21.3 Verify scroll position save is debounced using existing `debounce` utility (500ms)
    -   [x] 21.4 Optimize conversation selector rendering for 50+ conversations (if needed)
    -   [x] 21.5 Add performance metrics logging for session operations
    -   _Requirements: Non-Functional: Performance_

-   [x] 22. UI Polish

    -   [x] 22.1 Add smooth CSS transitions for conversation switching
    -   [x] 22.2 Improve conversation selector styling with hover effects and better spacing
    -   [x] 22.3 Add keyboard shortcuts (Ctrl+N for new conversation) using Obsidian command API
    -   [x] 22.4 Add session metadata tooltips (created date, message count, last updated)
    -   [x] 22.5 Improve visual distinction between local-only and server-synced conversations
    -   _Requirements: Non-Functional: Usability_

-   [ ] 23. Integration Testing and Documentation

    -   [ ] 23.1 Write integration tests for complete user flows (create, switch, delete)
    -   [ ] 23.2 Test session context preservation across plugin reload
    -   [ ] 23.3 Verify performance targets (list < 2s, switch < 1s) with 50+ sessions
    -   [ ] 23.4 Update user documentation in README with session management features
    -   [ ] 23.5 Update developer documentation (ARCHITECTURE.md) with session management architecture details
    -   _Requirements: Non-Functional: Performance, Reliability_

-   [ ] 24. Final Validation

    -   [ ] 24.1 Test with real OpenCode Server instance
    -   [ ] 24.2 Test with multiple sessions (10, 50, 100+) for performance
    -   [ ] 24.3 Test error scenarios (network failure, server restart, timeout)
    -   [ ] 24.4 Test backward compatibility with existing conversation data
    -   [ ] 24.5 Verify all acceptance criteria from requirements document are met
    -   _Requirements: All Requirements, Non-Functional: Compatibility, Reliability_

### Optional: Advanced Features (Future)

-   [ ] 25. Session Fork (Requirement 6)

    -   [ ] 25.1 Add `forkSession(sessionId, messageId)` method to `OpenCodeServerClient`
    -   [ ] 25.2 Add "Fork from here" action to message context menu
    -   [ ] 25.3 Test fork creates independent session with history up to fork point
    -   [ ] 25.4 Update UI to show forked session relationship
    -   _Requirements: 6_

-   [x] 26. Message Revert (Requirement 7)

    -   [x] 26.1 Add `revertSession(sessionId, messageId)` method to `OpenCodeServerClient`
    -   [x] 26.2 Add `unrevertSession(sessionId)` method to restore reverted messages
    -   [x] 26.3 Add "Revert to here" action to message context menu
    -   [x] 26.4 Hide reverted messages in UI with visual indicator
    -   [x] 26.5 Add "Unrevert all" action to restore reverted messages
    -   _Requirements: 7_

-   [x] 27. Session Diff Viewer (Requirement 8)

    -   [x] 27.1 Add `getSessionDiff(sessionId)` method to `OpenCodeServerClient`
    -   [x] 27.2 Create diff viewer modal component
    -   [x] 27.3 Add syntax highlighting for code diffs using existing markdown renderer
    -   [x] 27.4 Add "View changes" action to session context menu
    -   _Requirements: 8_

-   [ ] 28. Session Status Monitoring (Requirement 9)

    -   [ ] 28.1 Add `getSessionStatus()` method to `OpenCodeServerClient`
    -   [ ] 28.2 Show status indicators in conversation selector (active, idle, error, completed)
    -   [ ] 28.3 Update status via SSE events from server
    -   [ ] 28.4 Add status color coding and tooltips
    -   _Requirements: 9_

-   [ ] 29. Child Session Management (Requirement 10)

    -   [ ] 29.1 Add `getChildSessions(sessionId)` method to `OpenCodeServerClient`
    -   [ ] 29.2 Show child sessions in session detail view
    -   [ ] 29.3 Add parent-child relationship indicators with tree view
    -   [ ] 29.4 Add navigation between parent and child sessions
    -   _Requirements: 10_

-   [ ] 30. Concurrent Client Support (Requirement 11)

    -   [ ] 30.1 Implement optimistic locking with server timestamps
    -   [ ] 30.2 Detect conflicts via server timestamp comparison
    -   [ ] 30.3 Show conflict resolution UI with diff viewer
    -   [ ] 30.4 Handle SSE events for sessions modified by other clients
    -   [ ] 30.5 Add real-time session list updates from other clients
    -   _Requirements: 11_

-   [ ] 31. Data Migration (Requirement 12)

    -   [ ] 31.1 Create migration function for existing conversations without sessionId
    -   [ ] 31.2 Check migration flag in plugin data on startup
    -   [ ] 31.3 Run migration once automatically on first load
    -   [ ] 31.4 Set migration flag after successful completion
    -   [ ] 31.5 Create backup of original data before migration
    -   _Requirements: 12_

## Notes

-   **Current State**: Basic session management exists via `OpenCodeServerClient`. Tasks focus on adding server-side session list management and UI integration.
-   **MVP Focus**: Phase 1-3 implement core session management only (list, CRUD, sync, error handling)
-   **Advanced Features**: Tasks 25-31 are optional and require additional OpenCode Server API support
-   **Dependencies**: Each phase builds on the previous one
-   **Testing**: Property-based testing with fast-check validates correctness properties
-   **Timeline**: 3-4 weeks for MVP (Phases 1-3), additional time for advanced features
