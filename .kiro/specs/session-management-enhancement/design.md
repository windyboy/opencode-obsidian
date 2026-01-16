# Design Document: Session Management Enhancement

## Introduction

This document provides a simplified technical design for enhancing the OpenCode Obsidian plugin's session management. The focus is on core session operations: list, view, create, update, delete, and message history.

## Architecture Overview

### Current State

The plugin has:

- `OpenCodeServerClient`: Wraps `@opencode-ai/sdk` for API calls
- `ConversationManager`: Manages local conversation state
- `MessageSender`: Handles sending messages
- UI components for chat interface

### What We're Adding

**New Services** (`src/views/services/`):

- `session-manager.ts`: Session CRUD operations
- `session-sync.ts`: Sync between local and server state

**Enhanced UI** (`src/views/components/`):

- `session-list.ts`: Display all sessions
- Enhanced `message-list.ts`: Show full message history

**Data Changes**:

- Add `sessionId` to existing `Conversation` type
- Store last active session in workspace state

## Data Model

### Enhanced Conversation Type

```typescript
interface EnhancedConversation extends Conversation {
    // Existing fields
    id: string;
    title: string;
    messages: Message[];
    createdAt: number;
    updatedAt: number;
    
    // New field
    sessionId?: string;  // Server session ID
}
```

### Session List Item

```typescript
interface SessionListItem {
    id: string;
    title: string;
    lastUpdated: number;
    messageCount: number;
    isActive: boolean;
}
```

## Core Components

### 1. Session Manager

**File**: `src/views/services/session-manager.ts`

**Purpose**: Handle all session operations

**Key Methods**:

```typescript
class SessionManager {
    // List sessions
    async listSessions(): Promise<SessionListItem[]>
    
    // CRUD operations
    async createSession(title?: string): Promise<string>
    async getSession(sessionId: string): Promise<EnhancedConversation>
    async updateSessionTitle(sessionId: string, title: string): Promise<void>
    async deleteSession(sessionId: string): Promise<void>
    
    // Message history
    async getMessages(sessionId: string): Promise<Message[]>
}
```

### 2. Session Sync Service

**File**: `src/views/services/session-sync.ts`

**Purpose**: Keep local and server state in sync

**Key Methods**:

```typescript
class SessionSyncService {
    // Sync operations
    async syncFromServer(): Promise<void>
    async syncSession(sessionId: string): Promise<void>
}
```

### 3. Session List Component

**File**: `src/views/components/session-list.ts`

**Purpose**: Display list of sessions

**Features**:

- Show all sessions sorted by last updated
- Click to switch sessions
- Create new session button
- Delete session action

## API Integration

### Using OpenCode SDK

All API calls go through `@opencode-ai/sdk`:

```typescript
// List sessions
const sessions = await client.session.list();

// Get session details
const session = await client.session.get({ path: { id: sessionId } });

// Create session
const newSession = await client.session.create({ body: { title } });

// Update session
await client.session.update({ path: { id: sessionId }, body: { title } });

// Delete session
await client.session.delete({ path: { id: sessionId } });

// Get messages
const messages = await client.session.messages({ path: { id: sessionId } });
```

## State Management

### Local Storage

```typescript
interface PluginData {
    conversations: EnhancedConversation[];
    activeConversationId: string | null;
    lastSyncTimestamp: number;
}
```

### Workspace State

```typescript
interface WorkspaceState {
    lastActiveSessionId: string | null;
}
```

### Sync Strategy

1. **On plugin load**: Sync session list from server
2. **On session switch**: Load messages from server
3. **On new message**: Update local state immediately
4. **Background**: Periodic sync every 5 minutes

## UI Flow

### Session List View

```text
┌─────────────────────────────────┐
│ Sessions              [+ New]   │
├─────────────────────────────────┤
│ ● Current Session               │
│   5 messages • 2 min ago        │
├─────────────────────────────────┤
│ ○ Previous Session              │
│   12 messages • 1 hour ago      │
└─────────────────────────────────┘
```

### User Actions

1. **View sessions**: Click sessions button → Show session list
2. **Switch session**: Click session → Load messages → Update UI
3. **Create session**: Click "+ New" → Create on server → Switch to it
4. **Delete session**: Click delete → Confirm → Delete on server → Remove from list
5. **Rename session**: Click title → Edit → Update on server

## Error Handling

### Simple Error Strategy

```typescript
try {
    await sessionManager.deleteSession(id);
} catch (error) {
    if (error.status === 404) {
        // Session already deleted, remove from local cache
    } else if (error.status >= 500) {
        // Server error, show retry option
    } else {
        // Other error, show error message
    }
}
```

### Error Types

- **Network errors**: Show "Connection failed, try again"
- **404 errors**: Remove from local cache silently
- **500 errors**: Show "Server error, retry?"
- **Other errors**: Show error message from server

## Implementation Plan

### Phase 1: Core Features (MVP)

**Week 1-2**:

1. Create `SessionManager` service
2. Add session list API calls
3. Build session list UI component
4. Implement session switching

**Deliverables**:

- Users can view all sessions
- Users can switch between sessions
- Users can create new sessions
- Users can see message history

### Phase 2: CRUD Operations

**Week 3**:

1. Add update/delete operations
2. Add session sync service
3. Implement error handling
4. Add loading states

**Deliverables**:

- Users can rename sessions
- Users can delete sessions
- Proper error handling
- Smooth loading experience

### Phase 3: Polish

**Week 4**:

1. Add session context preservation
2. Optimize performance
3. Add tests
4. Documentation

**Deliverables**:

- Session state preserved on reload
- Fast session switching
- Unit tests for services
- User documentation

## Testing

### Unit Tests

Test files:

- `session-manager.test.ts`: Test CRUD operations
- `session-sync.test.ts`: Test sync logic

### Test Cases

1. **List sessions**: Returns all sessions from server
2. **Create session**: Creates session and returns ID
3. **Switch session**: Loads correct messages
4. **Delete session**: Removes from server and local cache
5. **Sync**: Updates local state from server

### Property-Based Testing

This design uses property-based testing (PBT) with `fast-check` to verify correctness properties.

#### Testing Framework

- **Library**: `fast-check` (TypeScript/JavaScript PBT library)
- **Integration**: Vitest test runner with fast-check assertions
- **Coverage**: All core requirements have corresponding properties

#### Correctness Properties

**Property 1: Session List Idempotency**
- **Validates**: Requirement 1.1
- **Statement**: Calling `listSessions()` multiple times without modifications returns identical results
- **Formal**: `∀ state. listSessions(state) = listSessions(state)`
- **Test Strategy**: Generate random session arrays, call listSessions() twice, assert deep equality

**Property 2: Session List Ordering**
- **Validates**: Requirement 1.4
- **Statement**: Sessions are always sorted by `lastUpdated` descending
- **Formal**: `∀ sessions. ∀i ∈ [0, len-1). sessions[i].lastUpdated ≥ sessions[i+1].lastUpdated`
- **Test Strategy**: Generate sessions with random timestamps, verify ordering invariant

**Property 3: Session List Completeness**
- **Validates**: Requirement 1.3
- **Statement**: All created sessions appear in the list
- **Formal**: `∀ title. createSession(title) ⇒ ∃ s ∈ listSessions(). s.title = title`
- **Test Strategy**: Create N sessions, verify list length ≥ N and all titles present

**Property 4: Create-Read Consistency**
- **Validates**: Requirement 2.1
- **Statement**: A session created with title T can be retrieved with the same title
- **Formal**: `∀ title. let id = createSession(title) in getSession(id).title = title`
- **Test Strategy**: Generate random titles, create sessions, verify title matches

**Property 5: Update Idempotency**
- **Validates**: Requirement 2.2
- **Statement**: Updating a session title multiple times with the same value produces the same result
- **Formal**: `∀ id, title. updateTitle(id, title); updateTitle(id, title) ⇒ getSession(id).title = title`
- **Test Strategy**: Update same title twice, verify final state matches

**Property 6: Delete Removes Session**
- **Validates**: Requirement 2.3
- **Statement**: After deleting a session, it no longer appears in the list
- **Formal**: `∀ id. deleteSession(id) ⇒ id ∉ listSessions().map(s => s.id)`
- **Test Strategy**: Delete session, verify not in list

**Property 7: Error Handling Consistency**
- **Validates**: Requirement 2.4
- **Statement**: Operations on non-existent sessions always return 404
- **Formal**: `∀ invalidId. getSession(invalidId) throws 404 ∧ updateSession(invalidId) throws 404 ∧ deleteSession(invalidId) throws 404`
- **Test Strategy**: Generate non-existent IDs, verify all operations throw 404

**Property 8: Message Ordering**
- **Validates**: Requirement 3.2
- **Statement**: Messages are always returned in chronological order
- **Formal**: `∀ sessionId. let msgs = getMessages(sessionId) in ∀i ∈ [0, len-1). msgs[i].timestamp ≤ msgs[i+1].timestamp`
- **Test Strategy**: Generate messages with random timestamps, verify ordering

**Property 9: Message Persistence**
- **Validates**: Requirement 3.3
- **Statement**: All sent messages appear in history
- **Formal**: `∀ sessionId, content. sendMessage(sessionId, content) ⇒ ∃ m ∈ getMessages(sessionId). m.content = content`
- **Test Strategy**: Send N messages, verify history length ≥ N

**Property 10: Message Immutability**
- **Validates**: Requirement 3.2
- **Statement**: Retrieved messages never change content
- **Formal**: `∀ sessionId. getMessages(sessionId)[0].content = getMessages(sessionId)[0].content`
- **Test Strategy**: Call getMessages() multiple times, verify content unchanged

**Property 11: Session Restoration**
- **Validates**: Requirements 4.1, 4.2
- **Statement**: Saved session ID is always restored correctly
- **Formal**: `∀ id. saveSessionId(id); restoreSessionId() = id`
- **Test Strategy**: Generate random session IDs, save and restore, verify equality

**Property 12: Scroll Position Preservation**
- **Validates**: Requirement 4.4
- **Statement**: Saved scroll position is restored within 10px tolerance
- **Formal**: `∀ pos. |saveScroll(pos); restoreScroll() - pos| ≤ 10`
- **Test Strategy**: Generate random scroll positions, verify restoration within tolerance

**Property 13: Fallback Behavior**
- **Validates**: Requirement 4.3
- **Statement**: When last session doesn't exist, plugin doesn't crash
- **Formal**: `∀ invalidId. restoreSession(invalidId) returns validState`
- **Test Strategy**: Generate non-existent IDs, verify graceful fallback

**Property 14: Feature Detection Caching**
- **Validates**: Requirements 5.1, 5.2
- **Statement**: Feature detection results are cached and consistent
- **Formal**: `∀ feature. detectFeatures(); hasFeature(feature) = hasFeature(feature)`
- **Test Strategy**: Call hasFeature() multiple times, verify cached result

**Property 15: Graceful Degradation**
- **Validates**: Requirement 5.2
- **Statement**: Missing optional features don't cause errors
- **Formal**: `∀ optionalFeature. ¬hasFeature(optionalFeature) ⇒ operations complete without throwing`
- **Test Strategy**: Disable optional features, verify operations succeed

**Property 16: Error Messaging**
- **Validates**: Requirement 5.3
- **Statement**: Missing core features always produce clear error messages
- **Formal**: `∀ coreFeature. ¬hasFeature(coreFeature) ⇒ error.message contains featureName ∧ versionRequirement`
- **Test Strategy**: Disable core features, verify error message format

#### Test Generators

**Session Generator**:
```typescript
const sessionArb = fc.record({
    id: fc.uuid(),
    title: fc.string({ minLength: 1, maxLength: 100 }),
    lastUpdated: fc.integer({ min: 0, max: Date.now() }),
    messageCount: fc.integer({ min: 0, max: 1000 }),
    isActive: fc.boolean()
});
```

**Message Generator**:
```typescript
const messageArb = fc.record({
    id: fc.uuid(),
    role: fc.constantFrom('user', 'assistant'),
    content: fc.string({ minLength: 1, maxLength: 5000 }),
    timestamp: fc.integer({ min: 0, max: Date.now() })
});
```

**Conversation Generator**:
```typescript
const conversationArb = fc.record({
    id: fc.uuid(),
    title: fc.string({ minLength: 1, maxLength: 100 }),
    messages: fc.array(messageArb, { minLength: 0, maxLength: 100 }),
    createdAt: fc.integer({ min: 0, max: Date.now() }),
    updatedAt: fc.integer({ min: 0, max: Date.now() }),
    sessionId: fc.option(fc.uuid(), { nil: undefined })
});
```

## Dependencies

- `@opencode-ai/sdk`: ^1.0.0 (already in use)
- `obsidian`: latest (already in use)
- No new dependencies needed

## Migration

### Existing Data

Current conversations already have optional `sessionId` field. No migration needed.

### Backward Compatibility

- Plugin works with or without server session support
- Gracefully handles missing `sessionId`
- Falls back to local-only mode if server unavailable

---

**Document Version**: 2.0  
**Created**: 2026-01-16  
**Author**: Kiro AI Assistant  
**Status**: Draft
