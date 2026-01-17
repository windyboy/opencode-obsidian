# Design Document: Session Fork

## Overview

This design document describes the implementation of session forking functionality for the OpenCode Obsidian plugin. Session forking allows users to create a new conversation branch from any point in an existing session, enabling parallel exploration of different conversation paths.

The implementation follows existing architectural patterns in the codebase, integrating with the OpenCode SDK client, service layer (SessionManager, ConversationManager), and UI components (MessageRenderer, ConversationSelector).

## Architecture

### High-Level Flow

```
User Action (UI) → View Layer → Service Layer → Client Layer → OpenCode Server
                                                                      ↓
User Feedback (UI) ← View Layer ← Service Layer ← Client Layer ← Server Response
```

### Component Layers

1. **Client Layer** (`src/opencode-server/client.ts`)
   - Wraps OpenCode SDK client
   - Handles HTTP requests and error handling
   - Manages session state and caching

2. **Service Layer** (`src/views/services/`)
   - `SessionManager`: Server session operations with retry logic
   - `ConversationManager`: Local conversation state management

3. **View Layer** (`src/views/`)
   - `OpenCodeObsidianView`: Main view controller
   - `MessageRenderer`: Message display and actions
   - `ConversationSelector`: Session list and context menu

## Components and Interfaces

### 1. Client Layer: OpenCodeServerClient

**New Method: `forkSession`**

```typescript
/**
 * Fork a session from a specific message point
 * @param sessionId - ID of the session to fork
 * @param messageId - Optional message ID to fork from (defaults to latest)
 * @param title - Optional title for the forked session
 * @returns Promise<string> - ID of the newly created forked session
 */
async forkSession(
	sessionId: string,
	messageId?: string,
	title?: string,
): Promise<string> {
	try {
		const response = await this.sdkClient.session.fork({
			path: { id: sessionId },
			body: {
				...(messageId ? { messageID: messageId } : {}),
				...(title ? { title } : {}),
			},
		});

		if (response.error) {
			throw new Error(`Failed to fork session: ${response.error}`);
		}

		if (!response.data) {
			throw new Error("OpenCode Server session.fork returned no data.");
		}

		// Extract session ID from response
		const forkedSessionId = this.extractSessionId(response.data);
		if (!forkedSessionId) {
			throw new Error(
				"OpenCode Server fork response did not include a session id.",
			);
		}

		// Cache the forked session
		this.sessions.set(forkedSessionId, response.data);

		return forkedSessionId;
	} catch (error) {
		const statusCode = getErrorStatusCode(error);
		let err: Error;

		if (statusCode === 404) {
			err = this.createHttpError(
				statusCode,
				"forking session",
				sessionId,
			);
		} else if (statusCode === 500) {
			err = this.createHttpError(statusCode, "forking session");
		} else {
			err = error instanceof Error ? error : new Error(String(error));
		}

		const severity = this.isEnhancedError(err)
			? ErrorSeverity.Warning
			: ErrorSeverity.Error;
		this.errorHandler.handleError(
			err,
			{
				module: "OpenCodeClient",
				function: "forkSession",
				operation: "Forking session",
				metadata: { sessionId, messageId, title, statusCode },
			},
			severity,
		);
		throw err;
	}
}
```

**Pattern Rationale:**
- Follows existing session method patterns (`revertSession`, `deleteSession`)
- Uses SDK client's session.fork endpoint
- Includes comprehensive error handling with status code checking
- Caches forked session locally for immediate access
- Uses ErrorHandler for consistent error logging

### 2. Service Layer: SessionManager

**New Method: `forkSession`**

```typescript
/**
 * Fork a session from a specific message point
 * Creates a new session that branches from the parent session
 * @param sessionId - ID of the session to fork
 * @param messageId - Optional message ID to fork from
 * @param title - Optional title for the forked session
 * @returns Promise<string> - ID of the newly created forked session
 */
async forkSession(
	sessionId: string,
	messageId?: string,
	title?: string,
): Promise<string> {
	if (this.localOnlyMode) {
		throw new Error(
			"Session forking is not available. Server does not support session management.",
		);
	}

	try {
		const forkedSessionId = await this.client.forkSession(
			sessionId,
			messageId,
			title,
		);

		// Invalidate cache to force refresh on next list
		this.invalidateCache();

		return forkedSessionId;
	} catch (error) {
		const statusCode = getErrorStatusCode(error);

		// Handle 404 errors by notifying callback to remove session from local cache
		if (statusCode === 404) {
			console.debug(
				`[SessionManager] Session ${sessionId} not found (404), removing from local cache`,
			);
			this.onSessionNotFoundCallback?.(sessionId);
		}

		// Create user-friendly error
		const friendlyMessage = getUserFriendlyErrorMessage(
			error,
			statusCode,
			{
				operation: "forking session",
				sessionId,
			},
		);

		const enhancedError = new Error(friendlyMessage);
		this.errorHandler.handleError(
			enhancedError,
			{
				module: "SessionManager",
				function: "forkSession",
				operation: "Forking session",
				metadata: { sessionId, messageId, title, statusCode },
			},
			ErrorSeverity.Error,
		);
		throw enhancedError;
	}
}

/**
 * Fork session with automatic retry on failure
 */
async forkSessionWithRetry(
	sessionId: string,
	messageId?: string,
	title?: string,
): Promise<string> {
	return this.retryOperation(
		() => this.forkSession(sessionId, messageId, title),
		"fork session",
	);
}
```

**Pattern Rationale:**
- Follows existing SessionManager patterns (retry logic, error handling)
- Checks local-only mode before attempting fork
- Invalidates cache after successful fork
- Handles 404 errors by removing session from local cache
- Provides retry wrapper for reliability

### 3. Service Layer: ConversationManager

**New Method: `forkConversation`**

```typescript
/**
 * Fork a conversation from a specific message point
 * Creates a new conversation that branches from the parent conversation
 * @param conversationId - ID of the conversation to fork
 * @param messageId - Optional message ID to fork from
 * @returns Promise<string> - ID of the newly created forked conversation
 */
async forkConversation(
	conversationId: string,
	messageId?: string,
): Promise<string> {
	const parentConversation = this.conversations.find(
		(c) => c.id === conversationId,
	);
	if (!parentConversation) {
		throw new Error(`Conversation not found: ${conversationId}`);
	}

	if (!parentConversation.sessionId) {
		throw new Error(
			`Cannot fork conversation without sessionId: ${conversationId}`,
		);
	}

	if (!this.sessionManager) {
		throw new Error("SessionManager not available");
	}

	if (!this.plugin.opencodeClient?.isConnected()) {
		throw new Error("OpenCode client not connected");
	}

	this.setIsLoading?.(true);
	this.updateConversationSelector();

	try {
		// Generate title for forked session
		const forkTitle = `Fork of ${parentConversation.title}`;

		// Fork session on server
		const forkedSessionId = await this.sessionManager.forkSessionWithRetry(
			parentConversation.sessionId,
			messageId,
			forkTitle,
		);

		// Create new local conversation
		const forkedConversation: Conversation = {
			id: `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
			title: forkTitle,
			messages: [], // Will be loaded from server
			createdAt: Date.now(),
			updatedAt: Date.now(),
			sessionId: forkedSessionId,
		};

		// Add to conversations list
		const newConversations = [...this.conversations];
		newConversations.unshift(forkedConversation);
		this.setConversations(newConversations);

		// Switch to forked conversation
		this.setActiveConversationId(forkedConversation.id);

		// Save conversations
		await this.saveConversations();

		// Load messages from server
		await this.loadSessionMessages(forkedConversation.id);

		// Update UI
		this.updateConversationSelector();
		this.updateMessages();

		new Notice("Session forked successfully");

		return forkedConversation.id;
	} catch (error) {
		this.plugin.errorHandler.handleError(
			error,
			{
				module: "ConversationManager",
				function: "forkConversation",
				operation: "Forking conversation",
				metadata: { conversationId, messageId },
			},
			ErrorSeverity.Error,
		);
		new Notice("Failed to fork session");
		throw error;
	} finally {
		this.setIsLoading?.(false);
		this.updateConversationSelector();
	}
}
```

**Pattern Rationale:**
- Follows existing ConversationManager patterns (loading states, error handling)
- Creates local conversation linked to forked server session
- Automatically loads messages from server after fork
- Switches to forked conversation immediately
- Provides user feedback via Notice

### 4. View Layer: MessageRenderer

**UI Integration: Fork Button**

```typescript
/**
 * Add message actions (copy, fork, etc.)
 * Modified to include fork button
 */
private addMessageActions(
	messageEl: HTMLElement,
	message: Message,
	conversationId: string,
): void {
	const actions = messageEl.createDiv({
		cls: "opencode-obsidian-message-actions",
	});

	// Existing copy button
	const copyBtn = actions.createEl("button", {
		text: "📋",
		cls: "opencode-obsidian-message-action",
		attr: { title: "Copy message" },
	});
	copyBtn.addEventListener("click", () => {
		navigator.clipboard.writeText(message.content);
		new Notice("Message copied to clipboard");
	});

	// NEW: Fork button
	const forkBtn = actions.createEl("button", {
		text: "🍴",
		cls: "opencode-obsidian-message-action",
		attr: { title: "Fork from here" },
	});
	forkBtn.addEventListener("click", async () => {
		try {
			// Disable button during fork
			forkBtn.disabled = true;
			forkBtn.textContent = "⏳";

			await this.view.forkConversation(conversationId, message.id);
		} catch (error) {
			// Error already handled by forkConversation
		} finally {
			// Re-enable button
			forkBtn.disabled = false;
			forkBtn.textContent = "🍴";
		}
	});
}
```

**CSS Styling:**

```css
.opencode-obsidian-message-action {
	background: transparent;
	border: none;
	cursor: pointer;
	font-size: 14px;
	padding: 4px 8px;
	opacity: 0.6;
	transition: opacity 0.2s;
}

.opencode-obsidian-message-action:hover {
	opacity: 1;
}

.opencode-obsidian-message-action:disabled {
	cursor: not-allowed;
	opacity: 0.3;
}
```

### 5. View Layer: ConversationSelector

**UI Integration: Context Menu**

```typescript
/**
 * Show context menu for conversation
 * Modified to include fork option
 */
private showContextMenu(
	event: MouseEvent,
	conversationId: string,
): void {
	const menu = new Menu();

	// Existing menu items (rename, delete)
	menu.addItem((item) => {
		item.setTitle("Rename")
			.setIcon("pencil")
			.onClick(() => {
				this.view.renameConversation(conversationId);
			});
	});

	// NEW: Fork menu item
	menu.addItem((item) => {
		item.setTitle("Fork session")
			.setIcon("git-fork")
			.onClick(async () => {
				try {
					await this.view.forkConversation(conversationId);
				} catch (error) {
					// Error already handled by forkConversation
				}
			});
	});

	menu.addItem((item) => {
		item.setTitle("Delete")
			.setIcon("trash")
			.onClick(() => {
				this.view.deleteConversation(conversationId);
			});
	});

	menu.showAtMouseEvent(event);
}
```

### 6. View Layer: OpenCodeObsidianView

**New Method: `forkConversation`**

```typescript
/**
 * Fork a conversation from a specific message point
 * @param conversationId - ID of the conversation to fork
 * @param messageId - Optional message ID to fork from
 */
async forkConversation(
	conversationId: string,
	messageId?: string,
): Promise<void> {
	if (!this.conversationManager) {
		new Notice("Conversation manager not available");
		return;
	}

	try {
		await this.conversationManager.forkConversation(
			conversationId,
			messageId,
		);
	} catch (error) {
		// Error already logged by ConversationManager
		// Just show user-friendly notice
		new Notice("Failed to fork session. Please try again.");
	}
}
```

## Data Models

### Fork Request Body

```typescript
interface ForkSessionRequest {
	messageID?: string; // Optional: fork from specific message
	title?: string; // Optional: custom title for forked session
}
```

### Fork Response

```typescript
interface ForkSessionResponse {
	id: string; // ID of the newly created forked session
	title: string; // Title of the forked session
	time: {
		created: number; // Timestamp of fork creation
		updated: number; // Timestamp of last update
	};
	// ... other session properties
}
```

### Conversation Model (Existing)

```typescript
interface Conversation {
	id: string; // Local conversation ID
	title: string; // Conversation title
	messages: Message[]; // Message history
	createdAt: number; // Creation timestamp
	updatedAt: number; // Last update timestamp
	sessionId?: string; // Server session ID (optional)
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property 1: Fork API Call with Message ID

*For any* session and message, when a user triggers fork from that message, the Plugin should call the fork API with the correct session ID and message ID.

**Validates: Requirements 1.1, 7.2**

### Property 2: Message History Preservation

*For any* session and fork point, when forking from a specific message, the forked session should contain exactly the messages from the parent session up to and including the fork point message.

**Validates: Requirements 1.2**

### Property 3: Automatic Session Switching

*For any* fork operation, when the fork completes successfully, the active session ID should change to the forked session ID.

**Validates: Requirements 1.3**

### Property 4: Success Notification

*For any* successful fork operation, the Plugin should display a success notification to the user.

**Validates: Requirements 1.5**

### Property 5: Fork Without Message ID

*For any* session, when forking without specifying a message ID, the Plugin should call the fork API without a messageID parameter and the forked session should contain all messages from the parent session.

**Validates: Requirements 2.1, 2.2**

### Property 6: Session List Update

*For any* fork operation, when the fork completes successfully, the forked session should appear in the session list.

**Validates: Requirements 2.5**

### Property 7: Default Title Generation

*For any* parent session with title T, when forking without a custom title, the forked session title should be "Fork of T".

**Validates: Requirements 3.1**

### Property 8: Custom Title Usage

*For any* fork operation with a custom title C, the forked session title should be C.

**Validates: Requirements 3.2**

### Property 9: Title Distinctness

*For any* fork operation, the forked session title should be different from the parent session title.

**Validates: Requirements 3.3**

### Property 10: Fork Independence - Parent Unchanged by Fork Modifications

*For any* forked session, when a message is added to the forked session, the parent session's message count should remain unchanged.

**Validates: Requirements 4.1**

### Property 11: Fork Independence - Fork Unchanged by Parent Modifications

*For any* forked session, when a message is added to the parent session, the forked session's message count should remain unchanged.

**Validates: Requirements 4.2**

### Property 12: Fork Independence - Parent Survives Fork Deletion

*For any* forked session, when the forked session is deleted, the parent session should still exist and be accessible.

**Validates: Requirements 4.3**

### Property 13: Fork Independence - Fork Survives Parent Deletion

*For any* forked session, when the parent session is deleted, the forked session should still exist and be accessible.

**Validates: Requirements 4.4**

### Property 14: Retry Logic for Network Errors

*For any* fork operation that encounters a network error, the Plugin should retry the operation up to 3 times before displaying an error.

**Validates: Requirements 5.3**

### Property 15: Error Handler Usage

*For any* fork operation error, the Plugin should call ErrorHandler with appropriate context and severity.

**Validates: Requirements 5.5**

### Property 16: Fork Button Presence

*For any* displayed message, the message actions should include a fork button with the fork icon (🍴).

**Validates: Requirements 6.1**

### Property 17: Fork Button Tooltip

*For any* fork button, hovering over it should display the tooltip "Fork from here".

**Validates: Requirements 6.2**

### Property 18: Context Menu Fork Option

*For any* session in the session list, the context menu should include a "Fork session" option.

**Validates: Requirements 6.3**

### Property 19: Fork Button Disabled During Operation

*For any* fork operation in progress, the fork button should be disabled.

**Validates: Requirements 6.4**

### Property 20: Loading Indicator During Fork

*For any* fork operation in progress, a loading indicator should be displayed.

**Validates: Requirements 6.5**

### Property 21: Fork API Endpoint

*For any* fork operation, the Plugin should call the POST /session/:id/fork endpoint.

**Validates: Requirements 7.1**

### Property 22: Request Body with Message ID

*For any* fork operation with a message ID M, the request body should include messageID: M.

**Validates: Requirements 7.2**

### Property 23: Request Body with Custom Title

*For any* fork operation with a custom title T, the request body should include title: T.

**Validates: Requirements 7.3**

### Property 24: Session ID Extraction

*For any* successful fork API response, the Plugin should extract and return the new session ID.

**Validates: Requirements 7.4**

### Property 25: Cache Update After Fork

*For any* successful fork operation, the forked session should be added to the local session cache immediately.

**Validates: Requirements 8.1**

### Property 26: Cache Usage for Forked Session

*For any* forked session in cache, when switching to that session, the Plugin should load it from cache.

**Validates: Requirements 8.3**

## Error Handling

### Error Categories

1. **Client Errors (4xx)**
   - 404 Not Found: Parent session doesn't exist
   - 400 Bad Request: Invalid message ID or parameters

2. **Server Errors (5xx)**
   - 500 Internal Server Error: Server-side fork failure
   - 503 Service Unavailable: Server temporarily unavailable

3. **Network Errors**
   - Connection timeout
   - Connection refused
   - Network unreachable

### Error Handling Strategy

**404 Not Found:**
```typescript
// Remove parent session from local cache
this.onSessionNotFoundCallback?.(sessionId);
// Display user-friendly error
new Notice("Session not found. It may have been deleted.");
```

**500 Server Error:**
```typescript
// Log error with ErrorHandler
this.errorHandler.handleError(error, context, ErrorSeverity.Error);
// Display user-friendly error
new Notice("Failed to fork session. Please try again later.");
```

**Network Errors:**
```typescript
// Retry up to 3 times with exponential backoff
await this.retryOperation(
	() => this.forkSession(sessionId, messageId, title),
	"fork session",
);
// If all retries fail, display error
new Notice("Unable to connect to server. Please check your connection.");
```

### Error Recovery

1. **Automatic Retry**: Network errors trigger automatic retry (up to 3 attempts)
2. **Cache Cleanup**: 404 errors trigger removal from local cache
3. **User Notification**: All errors display user-friendly messages
4. **State Rollback**: Failed forks don't create local conversations
5. **Button Re-enable**: UI buttons are re-enabled after errors

## Testing Strategy

### Unit Tests

**Client Layer Tests** (`src/opencode-server/client.test.ts`):
- Test `forkSession()` with valid parameters
- Test `forkSession()` with missing message ID (defaults to latest)
- Test `forkSession()` with custom title
- Test `forkSession()` error handling (404, 500, network errors)
- Test session ID extraction from response
- Test cache update after successful fork
- Verify ErrorHandler is called with correct context and severity

**Service Layer Tests** (`src/views/services/session-manager.test.ts`):
- Test `forkSession()` with retry logic (up to 3 attempts)
- Test `forkSession()` in local-only mode (should throw error)
- Test `forkSession()` cache invalidation after successful fork
- Test `forkSession()` error handling and user-friendly messages
- Test 404 error triggers session removal callback
- Verify ErrorHandler integration

**Service Layer Tests** (`src/views/services/conversation-manager.test.ts`):
- Test `forkConversation()` creates new conversation with correct structure
- Test `forkConversation()` generates correct default title ("Fork of [Parent Title]")
- Test `forkConversation()` switches to forked conversation automatically
- Test `forkConversation()` loads messages from server after fork
- Test `forkConversation()` error handling and Notice display
- Test loading state management during fork operation

### Property-Based Tests

**Configuration**: Minimum 100 iterations per property test

**Note**: The following property-based tests demonstrate the testing approach for key correctness properties. Additional property tests should be implemented for remaining properties as needed during development.

**Property Test 1: Message History Preservation**
```typescript
// Feature: session-fork, Property 2: Message History Preservation
test("forked session contains correct message history", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.array(fc.string(), { minLength: 1, maxLength: 20 }), // messages
			fc.integer({ min: 0, max: 19 }), // fork point index
			async (messages, forkIndex) => {
				// Create session with messages
				const sessionId = await createSessionWithMessages(messages);
				const forkPointMessageId = messages[forkIndex].id;

				// Fork from message
				const forkedSessionId = await client.forkSession(
					sessionId,
					forkPointMessageId,
				);

				// Get forked session messages
				const forkedMessages = await client.getSessionMessages(
					forkedSessionId,
				);

				// Verify message count
				expect(forkedMessages.length).toBe(forkIndex + 1);

				// Verify message content
				for (let i = 0; i <= forkIndex; i++) {
					expect(forkedMessages[i].content).toBe(messages[i].content);
				}
			},
		),
		{ numRuns: 100 },
	);
});
```

**Property Test 2: Fork Independence**
```typescript
// Feature: session-fork, Property 10: Fork Independence - Parent Unchanged by Fork Modifications
test("modifying fork doesn't affect parent", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.array(fc.string(), { minLength: 1, maxLength: 10 }), // initial messages
			fc.string(), // new message to add to fork
			async (initialMessages, newMessage) => {
				// Create parent session
				const parentId = await createSessionWithMessages(initialMessages);
				const parentMessageCount = initialMessages.length;

				// Fork session
				const forkedId = await client.forkSession(parentId);

				// Add message to fork
				await client.sendMessage(forkedId, newMessage);

				// Verify parent unchanged
				const parentMessages = await client.getSessionMessages(parentId);
				expect(parentMessages.length).toBe(parentMessageCount);
			},
		),
		{ numRuns: 100 },
	);
});
```

**Property Test 3: Title Generation**
```typescript
// Feature: session-fork, Property 7: Default Title Generation
test("forked session has correct default title", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.string({ minLength: 1, maxLength: 50 }), // parent title
			async (parentTitle) => {
				// Create parent session
				const parentId = await client.createSession(parentTitle);

				// Fork without custom title
				const forkedId = await client.forkSession(parentId);

				// Get forked session
				const forkedSession = await client.getSession(forkedId);

				// Verify title format
				expect(forkedSession.title).toBe(`Fork of ${parentTitle}`);
			},
		),
		{ numRuns: 100 },
	);
});
```

**Property Test 4: Error Handler Usage**
```typescript
// Feature: session-fork, Property 15: Error Handler Usage
test("all fork errors are logged via ErrorHandler", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.oneof(
				fc.constant(404), // Not found
				fc.constant(500), // Server error
				fc.constant("network"), // Network error
			),
			async (errorType) => {
				const errorHandlerSpy = vi.spyOn(errorHandler, "handleError");

				// Mock error based on type
				mockForkError(errorType);

				// Attempt fork
				try {
					await client.forkSession("test-session-id");
				} catch (error) {
					// Expected to throw
				}

				// Verify ErrorHandler was called
				expect(errorHandlerSpy).toHaveBeenCalled();
				expect(errorHandlerSpy).toHaveBeenCalledWith(
					expect.any(Error),
					expect.objectContaining({
						module: "OpenCodeClient",
						function: "forkSession",
					}),
					expect.any(String), // severity
				);
			},
		),
		{ numRuns: 100 },
	);
});
```

### Integration Tests

1. **End-to-End Fork Flow**:
   - Create session → Add messages → Fork from message → Verify forked session
   - Test with various message counts and fork points
   - Verify automatic session switching after fork

2. **UI Integration**:
   - Click fork button → Verify API call → Verify UI update
   - Test context menu fork → Verify session list update
   - Verify loading indicators and button states during fork

3. **Error Scenarios**:
   - Fork non-existent session → Verify error handling and cache cleanup
   - Fork during network outage → Verify retry logic (up to 3 attempts)
   - Fork with invalid message ID → Verify error message
   - Verify ErrorHandler is called for all error cases

### Edge Cases

1. **Empty Session Fork**: Fork session with no messages (should handle gracefully)
2. **Single Message Fork**: Fork session with only one message
3. **Large Session Fork**: Fork session with 100+ messages (performance test)
4. **Concurrent Forks**: Multiple fork operations on same session (should be safe)
5. **Fork During Message Send**: Fork while parent session is active (should not interfere)
6. **Special Characters in Title**: Fork with title containing emojis, unicode
7. **Very Long Title**: Fork with title exceeding 100 characters (should handle or truncate)
8. **Network Timeout**: Fork operation times out (should retry up to 3 times)
9. **Server Unavailable**: Fork when server is down (should show clear error after retries)

## Performance Considerations

### Expected Performance

- **Fork Operation**: < 5 seconds under normal network conditions
- **UI Response**: < 100ms for button click
- **Session List Update**: < 500ms after fork completion
- **Message Loading**: < 2 seconds for sessions with < 100 messages

### Optimization Strategies

1. **Caching**: Cache forked session immediately to avoid refetch
2. **Lazy Loading**: Load forked session messages only when needed
3. **Debouncing**: Prevent multiple fork operations on same session
4. **Background Sync**: Sync session list in background after fork

### Resource Management

1. **Memory**: Limit cached sessions to prevent memory bloat
2. **Network**: Batch API calls when possible
3. **UI**: Use loading states to prevent UI blocking

## Security Considerations

### Authentication

- Fork operations use existing session authentication
- No additional authentication required

### Authorization

- Users can only fork their own sessions
- Server enforces session ownership

### Data Privacy

- Forked sessions inherit parent session privacy settings
- No sensitive data exposed in error messages

### Audit Logging

- All fork operations logged via ErrorHandler
- Includes session IDs, timestamps, and user context

## Dependencies

### External Dependencies

1. **OpenCode Server**: Must support POST /session/:id/fork endpoint
2. **OpenCode SDK**: Must include session.fork method
3. **Obsidian API**: For UI components (Menu, Notice)

### Internal Dependencies

1. **OpenCodeServerClient**: Client layer implementation
2. **SessionManager**: Service layer for session operations
3. **ConversationManager**: Service layer for conversation management
4. **ErrorHandler**: Centralized error handling
5. **MessageRenderer**: UI component for message display
6. **ConversationSelector**: UI component for session list

### Version Requirements

- OpenCode Server: >= 1.0.0 (with fork endpoint support)
- OpenCode SDK: >= 1.0.0
- Obsidian API: >= 1.5.0

## Migration and Compatibility

### Backward Compatibility

- Fork functionality is additive (no breaking changes)
- Existing sessions continue to work without modification
- UI gracefully handles servers without fork support

### Feature Detection

```typescript
// Check if server supports fork
const hasForkFeature = await client.hasFeature("session.fork");

if (!hasForkFeature) {
	// Hide fork UI elements
	forkButton.style.display = "none";
	// Remove fork from context menu
}
```

### Graceful Degradation

- If fork endpoint not available, hide fork UI elements (button and context menu option)
- Display informative message if user attempts to fork on unsupported server
- No errors or crashes if feature unavailable
- Use feature detection to check server capabilities before showing UI

**Rationale**: Ensures plugin remains functional on older OpenCode Server versions that don't support forking, providing a smooth user experience regardless of server capabilities.

## Future Enhancements

### Phase 2 Features (Out of Scope)

1. **Fork Visualization**: Tree view showing parent-child relationships
2. **Bulk Fork**: Fork multiple sessions at once
3. **Fork Templates**: Predefined fork configurations
4. **Fork Merge**: Merge forked sessions back into parent
5. **Fork History**: Track all forks from a session
6. **Fork Notifications**: Notify when someone forks your shared session

### Potential Improvements

1. **Smart Fork Point**: Suggest optimal fork points based on conversation flow
2. **Fork Preview**: Preview forked session before creating
3. **Fork Comparison**: Compare forked sessions side-by-side
4. **Fork Search**: Search within forked sessions
5. **Fork Analytics**: Track fork usage patterns

---

**Document Version**: 2.0  
**Created**: 2026-01-17  
**Last Updated**: 2026-01-17  
**Author**: Kiro AI Assistant  
**Status**: Production Ready
