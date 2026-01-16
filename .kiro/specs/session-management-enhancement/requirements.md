# Requirements Document: Session Management Enhancement

## Introduction

This specification defines the requirements for enhancing the OpenCode Obsidian plugin's session management capabilities. Currently, the plugin only supports creating new sessions and sending messages, but lacks features for managing multiple sessions and viewing history.

This enhancement focuses on core session management features that users need daily, following an MVP (Minimum Viable Product) approach.

## Glossary

- **Session**: A conversation thread between the user and the AI agent
- **Message**: A single exchange in a session (user or assistant)
- **OpenCode Server**: The backend HTTP server that provides the OpenCode API
- **Plugin**: The OpenCode Obsidian plugin

## Core Requirements

### Requirement 1: Session List Management

**User Story:** As a user, I want to view and manage all my sessions, so that I can easily switch between different conversations.

**API Endpoints:**

- `GET /session` - List all sessions
- `GET /session/:id` - Get session details

**Acceptance Criteria:**

1. WHEN the user opens the session list view, THE Plugin SHALL display all sessions with titles and last update times
2. WHEN the user clicks on a session, THE Plugin SHALL switch to that session
3. WHEN the user creates a new session, THE Plugin SHALL add it to the list immediately
4. THE Plugin SHALL sort sessions by last update time (most recent first)

### Requirement 2: Session CRUD Operations

**User Story:** As a user, I want to create, update, and delete sessions, so that I can manage my conversation history.

**API Endpoints:**

- `POST /session` - Create session
- `PATCH /session/:id` - Update session
- `DELETE /session/:id` - Delete session

**Acceptance Criteria:**

1. WHEN the user creates a session with a custom title, THE Plugin SHALL pass the title to the API
2. WHEN the user updates a session title, THE Plugin SHALL call PATCH /session/:id and update the UI
3. WHEN the user deletes a session, THE Plugin SHALL call DELETE /session/:id and remove it from the list
4. THE Plugin SHALL handle errors gracefully and notify the user

### Requirement 3: Message History Display

**User Story:** As a user, I want to view the complete message history of a session, so that I can review past conversations.

**API Endpoints:**

- `GET /session/:id/message` - List messages

**Acceptance Criteria:**

1. WHEN the user opens a session, THE Plugin SHALL retrieve and display all messages
2. WHEN displaying messages, THE Plugin SHALL show sender, content, and timestamp
3. WHEN a new message is sent, THE Plugin SHALL append it to the history
4. THE Plugin SHALL preserve message formatting (code blocks, lists, links)

### Requirement 4: Session Context Preservation

**User Story:** As a user, I want my session context preserved when I close and reopen the plugin, so that I can continue where I left off.

**Storage Mechanism:**

- Session ID stored in Obsidian workspace state
- Scroll position stored per session in plugin data
- Each window maintains independent state

**Acceptance Criteria:**

1. WHEN the plugin closes, THE Plugin SHALL save the current session ID to workspace state
2. WHEN the plugin reopens, THE Plugin SHALL restore the last active session
3. WHEN the last session no longer exists, THE Plugin SHALL display the session list
4. THE Plugin SHALL restore scroll position for the active session

### Requirement 5: API Compatibility and Feature Detection

**User Story:** As a user, I want the plugin to work with different OpenCode Server versions, so that I can use the plugin even if my server doesn't support all features.

**Acceptance Criteria:**

1. WHEN the plugin connects to the server, THE Plugin SHALL detect which API endpoints are available
2. WHEN an advanced feature is not supported, THE Plugin SHALL hide the corresponding UI elements
3. WHEN a core feature is not supported, THE Plugin SHALL display a clear error message with version requirements
4. THE Plugin SHALL cache feature detection results to avoid repeated checks

**Feature Tiers:**

- **Core (Required)**: Session list, session details, message history, session CRUD
- **Advanced (Optional)**: Fork, revert, diff, child sessions, status monitoring

## Advanced Requirements

### Requirement 6: Session Fork Operation

**User Story:** As a user, I want to fork a session from a specific message, so that I can explore alternative conversation paths.

**API Endpoints:**

- `POST /session/:id/fork` - Fork session

**Acceptance Criteria:**

1. WHEN the user selects "Fork from here" on a message, THE Plugin SHALL call the fork API with the messageID
2. WHEN a fork is created, THE Plugin SHALL switch to the new forked session
3. THE Plugin SHALL name the forked session clearly (e.g., "Fork of [Original Title]")
4. WHEN fork fails, THE Plugin SHALL display an error message

### Requirement 7: Message Revert and Unrevert

**User Story:** As a user, I want to revert messages in a session, so that I can undo mistakes or explore different directions.

**API Endpoints:**

- `POST /session/:id/revert` - Revert to message
- `POST /session/:id/unrevert` - Unrevert messages

**Acceptance Criteria:**

1. WHEN the user selects "Revert to here" on a message, THE Plugin SHALL call the revert API
2. WHEN messages are reverted, THE Plugin SHALL hide messages after the revert point
3. WHEN the user selects "Unrevert all", THE Plugin SHALL restore all reverted messages
4. THE Plugin SHALL visually indicate reverted messages

### Requirement 8: Session Diff Viewer

**User Story:** As a developer, I want to view file changes made during a session, so that I can understand what modifications were made.

**API Endpoints:**

- `GET /session/:id/diff` - Get session diff

**Acceptance Criteria:**

1. WHEN the user requests to view session diff, THE Plugin SHALL call the diff API
2. WHEN displaying diffs, THE Plugin SHALL show file paths, added lines, and removed lines
3. THE Plugin SHALL use syntax highlighting for code diffs
4. WHEN no changes exist, THE Plugin SHALL display "No file modifications"

### Requirement 9: Session Status Monitoring

**User Story:** As a user, I want to see the status of my sessions, so that I can understand what's happening with each conversation.

**API Endpoints:**

- `GET /session/status` - Get all session statuses

**Acceptance Criteria:**

1. WHEN displaying sessions, THE Plugin SHALL show status indicators (active, idle, error, completed)
2. WHEN a session status changes, THE Plugin SHALL update the indicator via SSE events
3. THE Plugin SHALL use distinct colors or icons for different statuses
4. WHEN a session encounters an error, THE Plugin SHALL display the error message

### Requirement 10: Child Session Management

**User Story:** As a user, I want to view child sessions (forks), so that I can navigate between related conversation branches.

**API Endpoints:**

- `GET /session/:id/children` - Get child sessions

**Acceptance Criteria:**

1. WHEN viewing a session with children, THE Plugin SHALL retrieve and display child sessions
2. WHEN the user clicks on a child session, THE Plugin SHALL navigate to it
3. THE Plugin SHALL visually indicate the parent-child relationship
4. WHEN a session has no children, THE Plugin SHALL not display the children section

### Requirement 11: Concurrent Client Support

**User Story:** As a user, I want to use the plugin from multiple Obsidian windows or devices, so that I can work flexibly without conflicts.

**Acceptance Criteria:**

1. WHEN multiple clients modify the same session, THE Plugin SHALL detect conflicts via server timestamps
2. WHEN a conflict is detected, THE Plugin SHALL fetch the latest server state and notify the user
3. WHEN receiving SSE events for sessions modified by other clients, THE Plugin SHALL update the UI in real-time
4. THE Plugin SHALL use optimistic locking to prevent overwriting changes from other clients
5. WHEN a session is deleted by another client, THE Plugin SHALL remove it from the local session list

**Conflict Resolution Strategy:**

- Server state always wins for conflicts
- Local unsaved changes are preserved in a draft state
- User is notified of conflicts with option to view diff

### Requirement 12: Data Migration and Backward Compatibility

**User Story:** As an existing user, I want my conversations to be migrated to the new session management system, so that I don't lose my history.

**Migration Trigger:**

- Check migration flag in plugin data on startup
- If not migrated, run migration once automatically
- Set migration flag after successful completion
- Provide manual migration option in settings for troubleshooting

**Acceptance Criteria:**

1. WHEN the plugin loads with old conversation data, THE Plugin SHALL automatically migrate to EnhancedConversation format
2. WHEN a conversation has no sessionId, THE Plugin SHALL create a new server session and link it
3. WHEN migration encounters corrupted data, THE Plugin SHALL skip the corrupted entry and log the error
4. WHEN migration fails mid-way, THE Plugin SHALL preserve the original data and allow retry
5. THE Plugin SHALL create a backup of original data before migration

**Edge Cases:**

1. **Missing sessionId**: Create new server session, sync conversation history
2. **Corrupted conversation data**: Skip entry, log error, continue with remaining conversations
3. **Server unavailable during migration**: Queue conversations for migration when server reconnects
4. **Duplicate sessionIds**: Keep most recent conversation, archive duplicates with timestamp suffix
5. **Migration failure**: Preserve original data, show error with retry option
6. **Partial migration**: Track migration progress, resume from last successful point

## Non-Functional Requirements

### Performance

1. Session list SHALL load within 2 seconds under normal network conditions
2. Message history SHALL attempt to display within 1 second for sessions with <100 messages
3. Session switching SHALL provide immediate feedback with loading state

### Usability

1. All session operations SHALL provide clear visual feedback (loading states, success/error messages)
2. Error messages SHALL be user-friendly and actionable
3. The UI SHALL be responsive and integrated with existing plugin interface

### Reliability

1. The plugin SHALL handle network failures gracefully without crashing
2. Session state SHALL be preserved even if the plugin crashes
3. The plugin SHALL recover from OpenCode Server restarts automatically
4. All API calls SHALL have appropriate timeouts (30s for normal operations)

**Core Error Recovery Scenarios (MVP):**

1. **Session Not Found (404)**: WHEN switching to a deleted session, THE Plugin SHALL remove it from local cache and display session list
2. **Timeout Recovery**: WHEN API call times out, THE Plugin SHALL retry up to 3 times before showing error
3. **Network Reconnection**: WHEN network connection is restored, THE Plugin SHALL automatically sync pending operations

**Advanced Error Recovery Scenarios (Optional):**

1. **Partial API Failure**: Display session list and show error for message loading
2. **Rate Limiting (429)**: Queue operations and retry with exponential backoff
3. **Concurrent Modification (409)**: Fetch latest state and notify user of conflict
4. **Partial Session Data**: Display metadata and allow retry for messages

### Compatibility

1. The plugin SHALL work with OpenCode Server version 1.0.0 and above
2. The plugin SHALL use the official @opencode-ai/sdk client library

## Dependencies

1. OpenCode Server running and accessible
2. @opencode-ai/sdk version ^1.0.0
3. Obsidian API version ^1.5.0
4. Existing plugin infrastructure (ErrorHandler, ConnectionManager, SessionEventBus)

## Constraints

1. All session operations MUST go through the OpenCode Server API
2. The plugin MUST respect OpenCode Server rate limits
3. The plugin MUST handle concurrent session operations safely

## Success Criteria

1. Users can view and manage all their sessions through the plugin UI
2. Users can switch between sessions seamlessly with preserved context
3. Users can view complete message history for each session
4. The plugin handles errors gracefully and provides clear feedback
5. Existing user data is migrated without loss

## Out of Scope

The following features are explicitly out of scope for this specification:

1. Provider and model selection (see MISSING_FEATURES.md)
2. File search and symbol lookup (see MISSING_FEATURES.md)
3. Project and path management (see MISSING_FEATURES.md)
4. Permission system integration (see MISSING_FEATURES.md)
5. Agent management (see MISSING_FEATURES.md)
6. Session sharing and summarization (deferred to Phase 2)
7. Session search and filtering (deferred to Phase 2)
8. Async message sending (already handled by SSE streaming)
9. Performance optimizations (implement when needed, not prematurely)

---

**Document Version**: 1.0  
**Created**: 2026-01-16  
**Author**: Kiro AI Assistant  
**Status**: Draft
