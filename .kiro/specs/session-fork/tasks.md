# Implementation Tasks: Session Fork

- [x] 1. Client Layer - Add fork API method
  - [x] 1.1 Add `forkSession` method to `src/opencode-server/client.ts`
    - Call `this.sdkClient.session.fork()` with sessionId, optional messageId and title
    - Extract and cache forked session ID from response
    - Handle errors (404, 500) with ErrorHandler
    - Follow pattern from existing `revertSession` method

- [x] 2. Service Layer - Session management
  - [x] 2.1 Add `forkSession` to `src/views/services/session-manager.ts`
    - Check local-only mode, throw error if true
    - Call `client.forkSession()` and invalidate cache
    - Handle 404 by calling `onSessionNotFoundCallback`
    - Add `forkSessionWithRetry` wrapper using existing `retryOperation`

- [x] 3. Service Layer - Conversation management
  - [x] 3.1 Add `forkConversation` to `src/views/services/conversation-manager.ts`
    - Validate conversation exists and has sessionId
    - Generate title: `"Fork of ${parentConversation.title}"`
    - Call `sessionManager.forkSessionWithRetry()`
    - Create new local conversation with forked sessionId
    - Switch to forked conversation and load messages
    - Show success/error Notice

- [x] 4. UI - Message fork button
  - [x] 4.1 Add fork button in `src/views/components/message-renderer.ts`
    - Add 🍴 button with tooltip "Fork from here"
    - On click: disable button, call `view.forkConversation(conversationId, messageId)`
    - Re-enable button after completion
  - [x] 4.2 Add CSS for fork button in `styles.css`
    - Style `.opencode-obsidian-message-action` with hover and disabled states

- [x] 5. UI - Context menu fork option
  - [x] 5.1 Add "Fork session" to context menu in `src/views/components/conversation-selector.ts`
    - Add menu item with "git-fork" icon between Rename and Delete
    - On click: call `view.forkConversation(conversationId)`

- [x] 6. UI - View integration
  - [x] 6.1 Add `forkConversation` method to `src/views/opencode-obsidian-view.ts`
    - Validate conversationManager exists
    - Call `conversationManager.forkConversation()`
    - Show error Notice on failure

---

**Status**: Ready for Implementation  
**Estimated Time**: 2-3 hours
