# Design: Code Refactoring Large Files

## Overview

Refactor large files (>20KB) into smaller, focused modules. Target files:
- `client.ts` (63.62KB) - OpenCode SDK wrapper
- `opencode-obsidian-view.ts` (32.38KB) - Main UI view
- `tool-executor.ts` (27.13KB) - Vault operations
- `settings.ts` (20.82KB) - Settings UI

## Architecture

### Design Rationale

**Why 15KB target?**
- Files under 15KB are easier to navigate and understand
- Reduces cognitive load when reviewing or debugging
- Improves IDE performance and search speed
- Aligns with single responsibility principle

**Why delegate pattern?**
- Maintains backward compatibility (Requirement 5)
- Allows incremental refactoring with minimal risk
- Public APIs remain unchanged while internals improve
- Easy to test individual handlers in isolation

**Why separate read/write for tools?**
- Clear separation of concerns (read vs write operations)
- Easier to apply different permission checks
- Simpler to test and reason about
- Follows command-query separation principle

**Why extract utilities last?**
- Identifies common patterns across all files first
- Avoids premature abstraction
- Ensures utilities are truly reusable
- Reduces risk of breaking changes

### Current Structure

```
src/
├── opencode-server/
│   └── client.ts (63.62KB) - Everything in one file
├── views/
│   └── opencode-obsidian-view.ts (32.38KB) - All UI logic
├── tools/obsidian/
│   └── tool-executor.ts (27.13KB) - All tool operations
└── settings.ts (20.82KB) - All settings UI
```

### Target Structure

```
src/
├── opencode-server/
│   ├── client.ts (main class, <15KB)
│   ├── connection-handler.ts (connection logic)
│   ├── stream-handler.ts (SSE streaming)
│   └── session-operations.ts (session methods)
├── views/
│   ├── opencode-obsidian-view.ts (main class, <15KB)
│   ├── chat-renderer.ts (message rendering)
│   └── input-handler.ts (user input)
├── tools/obsidian/
│   ├── tool-executor.ts (main class, <15KB)
│   ├── vault-reader.ts (read operations)
│   └── vault-writer.ts (write operations)
├── settings/
│   ├── settings.ts (main class, <15KB)
│   ├── connection-settings.ts (connection UI)
│   └── agent-settings.ts (agent config UI)
└── utils/
    ├── dom-helpers.ts (DOM utilities)
    └── data-helpers.ts (data transformations)
```

## Implementation Details

### 1. Refactor OpenCode Client

**File: `src/opencode-server/client.ts`**

Current: 63.62KB with all logic in one file

**Extract to:**

#### 1.1 `connection-handler.ts`
```typescript
export class ConnectionHandler {
	private config: OpenCodeServerConfig;
	private errorHandler: ErrorHandler;
	private connectionState: ConnectionState = "disconnected";
	
	constructor(config: OpenCodeServerConfig, errorHandler: ErrorHandler) {
		this.config = config;
		this.errorHandler = errorHandler;
	}
	
	async connect(): Promise<void> { /* ... */ }
	async disconnect(): Promise<void> { /* ... */ }
	getConnectionState(): ConnectionState { /* ... */ }
	isConnected(): boolean { /* ... */ }
}
```

#### 1.2 `stream-handler.ts`
```typescript
export class StreamHandler {
	private eventStreamAbort: AbortController | null = null;
	private lastEventId: string | null = null;
	
	startEventLoop(): void { /* SSE event handling */ }
	stopEventLoop(): void { /* cleanup */ }
	handleStreamEvent(event: any): void { /* process events */ }
}
```

#### 1.3 `session-operations.ts`
```typescript
export class SessionOperations {
	private sdkClient: OpenCodeClient;
	private sessions: Map<string, Session> = new Map();
	
	async createSession(title?: string): Promise<string> { /* ... */ }
	async sendMessage(sessionId: string, content: string): Promise<void> { /* ... */ }
	async abortSession(sessionId: string): Promise<void> { /* ... */ }
	async listSessions(): Promise<SessionListItem[]> { /* ... */ }
}
```

#### 1.4 Updated `client.ts`
```typescript
export class OpenCodeServerClient {
	private connectionHandler: ConnectionHandler;
	private streamHandler: StreamHandler;
	private sessionOps: SessionOperations;
	
	constructor(config: OpenCodeServerConfig, errorHandler: ErrorHandler) {
		this.connectionHandler = new ConnectionHandler(config, errorHandler);
		this.streamHandler = new StreamHandler(/* ... */);
		this.sessionOps = new SessionOperations(/* ... */);
	}
	
	// Delegate to handlers
	async connect() { return this.connectionHandler.connect(); }
	async createSession(title?: string) { return this.sessionOps.createSession(title); }
	// ... other delegations
}
```

### 2. Refactor View Component

**File: `src/views/opencode-obsidian-view.ts`**

Current: 32.38KB with all UI logic

**Extract to:**

#### 2.1 `chat-renderer.ts`
```typescript
export class ChatRenderer {
	private messageListComponent: MessageListComponent;
	private messageRendererComponent: MessageRendererComponent;
	
	renderMessages(messages: Message[]): void { /* ... */ }
	scrollToBottom(): void { /* ... */ }
	updateMessageStatus(messageId: string, status: string): void { /* ... */ }
}
```

#### 2.2 `input-handler.ts`
```typescript
export class InputHandler {
	private inputAreaComponent: InputAreaComponent;
	
	handleSendMessage(content: string): Promise<void> { /* ... */ }
	handleCommandInput(command: string): Promise<void> { /* ... */ }
	handleAttachment(): void { /* ... */ }
}
```

#### 2.3 Updated `opencode-obsidian-view.ts`
```typescript
export class OpenCodeObsidianView extends ItemView {
	private chatRenderer: ChatRenderer;
	private inputHandler: InputHandler;
	
	constructor(leaf: WorkspaceLeaf, plugin: OpenCodeObsidianPlugin) {
		super(leaf);
		this.chatRenderer = new ChatRenderer(/* ... */);
		this.inputHandler = new InputHandler(/* ... */);
	}
	
	// Delegate to handlers
	async onOpen() { /* setup */ }
	async onClose() { /* cleanup */ }
}
```

### 3. Refactor Tool Executor

**File: `src/tools/obsidian/tool-executor.ts`**

Current: 27.13KB with all tool operations (Requirement 3)

**Rationale:** Tool executor handles both read and write operations. Separating these:
- Simplifies permission checking logic
- Makes testing easier (mock vault operations separately)
- Follows command-query separation
- Reduces file size significantly

**Extract to:**

#### 3.1 `vault-reader.ts` (Requirement 3 - Read operations)
```typescript
export class VaultReader {
	private vault: Vault;
	private permissionManager: PermissionManager;
	
	constructor(vault: Vault, permissionManager: PermissionManager) {
		this.vault = vault;
		this.permissionManager = permissionManager;
	}
	
	async readFile(path: string): Promise<string> {
		// Check read permissions
		await this.permissionManager.checkPermission("read", path);
		return await this.vault.adapter.read(path);
	}
	
	async searchFiles(pattern: string): Promise<string[]> {
		// Search with permission checks
		/* ... */
	}
	
	async listFiles(folder: string): Promise<string[]> {
		// List with permission checks
		/* ... */
	}
}
```

#### 3.2 `vault-writer.ts` (Requirement 3 - Write operations)
```typescript
export class VaultWriter {
	private vault: Vault;
	private permissionManager: PermissionManager;
	
	constructor(vault: Vault, permissionManager: PermissionManager) {
		this.vault = vault;
		this.permissionManager = permissionManager;
	}
	
	async writeFile(path: string, content: string): Promise<void> {
		// Check write permissions
		await this.permissionManager.checkPermission("write", path);
		await this.vault.adapter.write(path, content);
	}
	
	async createFolder(path: string): Promise<void> {
		// Create with permission checks
		/* ... */
	}
	
	async deleteFile(path: string): Promise<void> {
		// Delete with permission checks
		/* ... */
	}
}
```

#### 3.3 Updated `tool-executor.ts` (Requirements 3.1, 5.1-5.4)
```typescript
export class ToolExecutor {
	private reader: VaultReader;
	private writer: VaultWriter;
	
	constructor(vault: Vault, permissionManager: PermissionManager) {
		this.reader = new VaultReader(vault, permissionManager);
		this.writer = new VaultWriter(vault, permissionManager);
	}
	
	async executeTool(toolName: string, args: any): Promise<any> {
		// Route to reader or writer based on tool operation
		if (this.isReadOperation(toolName)) {
			return this.executeReadTool(toolName, args);
		} else {
			return this.executeWriteTool(toolName, args);
		}
	}
	
	private isReadOperation(toolName: string): boolean {
		return toolName.includes("read") || toolName.includes("search") || toolName.includes("list");
	}
	
	private async executeReadTool(toolName: string, args: any): Promise<any> {
		// Delegate to reader
		/* ... */
	}
	
	private async executeWriteTool(toolName: string, args: any): Promise<any> {
		// Delegate to writer
		/* ... */
	}
}
```

### 4. Refactor Settings Component

**File: `src/settings.ts`**

Current: 20.82KB with all settings UI

**Extract to:**

#### 4.1 `settings/connection-settings.ts`
```typescript
export class ConnectionSettingsRenderer {
	renderConnectionSettings(containerEl: HTMLElement, settings: Settings): void {
		// Server URL, timeout, etc.
	}
}
```

#### 4.2 `settings/agent-settings.ts`
```typescript
export class AgentSettingsRenderer {
	renderAgentSettings(containerEl: HTMLElement, settings: Settings): void {
		// Agent selection, refresh button
	}
}
```

#### 4.3 Updated `settings.ts`
```typescript
export class SettingsTab extends PluginSettingTab {
	private connectionRenderer: ConnectionSettingsRenderer;
	private agentRenderer: AgentSettingsRenderer;
	
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		
		this.connectionRenderer.renderConnectionSettings(containerEl, this.plugin.settings);
		this.agentRenderer.renderAgentSettings(containerEl, this.plugin.settings);
	}
}
```

### 5. Extract Common Utilities

#### 5.1 `utils/dom-helpers.ts`
```typescript
export function createButton(text: string, onClick: () => void): HTMLButtonElement {
	const button = document.createElement("button");
	button.textContent = text;
	button.onclick = onClick;
	return button;
}

export function createDiv(className: string): HTMLDivElement {
	const div = document.createElement("div");
	div.className = className;
	return div;
}
```

#### 5.2 `utils/data-helpers.ts`
```typescript
export function formatTimestamp(timestamp: number): string {
	return new Date(timestamp).toISOString();
}

export function truncateText(text: string, maxLength: number): string {
	return text.length > maxLength ? text.slice(0, maxLength) + "..." : text;
}
```

## Migration Strategy

### Phase 1: Extract Utilities (Requirement 4)
1. Create `utils/dom-helpers.ts` and `utils/data-helpers.ts` (Requirement 4.2, 4.3)
2. Move duplicate code from all files (Requirement 4.1)
3. Keep utilities as pure functions (Requirement 4.4)
4. Update imports in original files
5. Add unit tests for utilities (Requirement 4.5)
6. Run all tests to verify (Requirement 6.2)

### Phase 2: Refactor Client (Requirement 1)
1. Create `connection-handler.ts`, `stream-handler.ts`, `session-operations.ts` (Requirements 1.2-1.4)
2. Move code from `client.ts` ensuring each file is under 15KB (Requirement 1.1)
3. Update `client.ts` to delegate to handlers
4. Re-export from `client.ts` for backward compatibility (Requirements 1.5, 5.2)
5. Run tests to verify no breaking changes (Requirements 1.6, 5.4)

### Phase 3: Refactor View (Requirement 2)
1. Create `chat-renderer.ts`, `input-handler.ts` (Requirements 2.2, 2.3)
2. Move code from `opencode-obsidian-view.ts` ensuring under 15KB (Requirement 2.1)
3. Update view to delegate to handlers
4. Verify public API unchanged (Requirements 2.5, 5.1)
5. Run tests (Requirements 2.6, 6.2)

### Phase 4: Refactor Tool Executor (Requirement 3)
1. Create `vault-reader.ts`, `vault-writer.ts`
2. Move code from `tool-executor.ts` ensuring under 15KB (Requirement 3.1)
3. Update executor to delegate to reader/writer
4. Verify public API unchanged (Requirements 3.4, 5.1)
5. Run tests (Requirements 3.5, 6.2)

### Phase 5: Refactor Settings (Requirements 3.2, 3.3)
1. Create `settings/` folder
2. Create `connection-settings.ts`, `agent-settings.ts` (Requirements 3.2, 3.3)
3. Move code from `settings.ts` ensuring under 15KB (Requirement 3.1)
4. Update settings to delegate to renderers
5. Verify public API unchanged (Requirements 3.4, 5.1)
6. Run tests (Requirements 3.5, 6.2)

### Phase 6: Final Validation (Requirement 6)
1. Verify no files exceed 15KB (Requirement 6.1)
2. Run full test suite (Requirement 6.2)
3. TypeScript compilation check (Requirement 6.3)
4. ESLint validation (Requirement 6.4)
5. Manual testing in Obsidian (Requirement 6.5)
6. Verify all import paths work (Requirements 5.3, 5.4)

## Backward Compatibility

### Design Principle
All refactoring must maintain 100% backward compatibility (Requirement 5). Existing code using these modules should continue to work without any changes.

### Re-exports
All public APIs will be re-exported from original locations (Requirements 5.1, 5.2):

```typescript
// src/opencode-server/client.ts
export { ConnectionHandler } from "./connection-handler";
export { StreamHandler } from "./stream-handler";
export { SessionOperations } from "./session-operations";

// Main class remains in same file
export class OpenCodeServerClient { /* ... */ }
```

### Import Paths
Existing imports continue to work (Requirements 5.3, 5.4):
```typescript
// Still works - no changes needed in consuming code
import { OpenCodeServerClient } from "../opencode-server/client";
```

## Constraints

Following requirements document constraints:

1. **No API Changes** - Keep all public APIs unchanged (Requirement 5.1)
2. **Code Style** - Follow existing patterns (tabs, kebab-case files) per AGENTS.md
3. **Error Handling** - Use existing ErrorHandler patterns consistently
4. **No New Features** - Pure refactoring only, no functionality changes
5. **File Size Target** - All refactored files must be under 15KB (Requirements 1.1, 2.1, 3.1)
6. **Testing** - All existing tests must pass without modification (Requirements 1.6, 2.6, 3.5, 5.4)

## Out of Scope

As specified in requirements:

- Adding new functionality
- Changing public APIs or method signatures
- Performance optimizations (unless they emerge naturally)
- Refactoring files already under 15KB
- Changing testing frameworks or patterns

## Testing Strategy

### Unit Tests

Following project testing standards (see AGENTS.md):
- Minimize mocking (only external APIs and Obsidian API)
- Test behavior, not implementation
- Deterministic tests with fixed timestamps
- Aim for 80%+ coverage on pure logic

1. **Utilities** (Requirement 4.5)
   - Test DOM helpers with mock DOM
   - Test data helpers with sample data
   - Pure function tests without mocks

2. **Connection Handler** (Requirement 1.2)
   - Mock SDK client only
   - Test connect/disconnect flows
   - Test state transitions
   - Test error recovery

3. **Stream Handler** (Requirement 1.3)
   - Mock SSE events
   - Test event processing
   - Test cleanup and abort handling

4. **Session Operations** (Requirement 1.4)
   - Mock SDK client only
   - Test CRUD operations
   - Test error handling
   - Test concurrent session prevention

5. **Chat Renderer** (Requirement 2.2)
   - Mock components
   - Test message rendering
   - Test scroll behavior

6. **Input Handler** (Requirement 2.3)
   - Mock input component
   - Test message sending
   - Test command handling

7. **Vault Reader/Writer** (Requirement 3 - Tool Executor)
   - Mock Obsidian vault
   - Test read/write operations
   - Test permission checks
   - Test error handling

8. **Settings Renderers** (Requirements 3.2, 3.3)
   - Mock container elements
   - Test UI rendering
   - Test user interactions

### Integration Tests

Test interactions between refactored modules:

1. **Client Integration** (Requirements 1.2-1.4)
   - Test full message flow through all handlers
   - Test connection lifecycle with reconnection
   - Test error recovery across modules

2. **View Integration** (Requirements 2.2-2.4)
   - Test chat interaction end-to-end
   - Test session management UI
   - Test UI updates from events

3. **Tool Integration** (Requirement 3 - Tool Executor)
   - Test vault operations through executor
   - Test permission flow with reader/writer
   - Test error handling across tool modules

4. **Settings Integration** (Requirements 3.2, 3.3)
   - Test settings persistence
   - Test UI updates from settings changes

### Manual Testing

Verify plugin functionality after refactoring (Requirement 6.5):

1. Start plugin → verify connection (Requirements 1.2, 5.1-5.4)
2. Send message → verify streaming (Requirements 1.3, 2.2)
3. Create session → verify UI update (Requirements 1.4, 2.3)
4. Execute tool → verify vault operation (Requirement 3)
5. Change settings → verify persistence (Requirements 3.2, 3.3)
6. Test all public APIs → verify no breaking changes (Requirement 5)

## Success Criteria

Aligned with Requirements 6.1-6.5:

- [ ] **6.1** No files exceed 15KB (target: all refactored files under 15KB)
- [ ] **6.2** All tests pass (unit, integration, and property-based tests)
- [ ] **6.3** TypeScript compiles without errors
- [ ] **6.4** ESLint passes with no violations
- [ ] **6.5** Plugin builds and runs successfully in Obsidian
- [ ] **5.1-5.4** All public APIs unchanged and backward compatible
- [ ] No breaking changes to import paths

