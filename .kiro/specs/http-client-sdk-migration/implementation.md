# Implementation Plan: OpenCode SDK Migration

## Task Breakdown

### Task 1: Create New SDK Client

**File**: `src/opencode-server/client.ts` (replace existing)

Create a new `OpenCodeClient` class that:

-   Uses `@opencode-ai/sdk` directly
-   Implements Obsidian-specific fetch adapter
-   Maintains backward-compatible API
-   Handles event subscriptions

**Estimated Effort**: 4-6 hours

### Task 2: Create Minimal Types File

**File**: `src/opencode-server/types.ts` (new)

Define only Obsidian-specific types:

-   `SessionContext` interface
-   `ProgressUpdate` interface
-   Connection state types
-   Re-export necessary SDK types

**Estimated Effort**: 1 hour

### Task 3: Update Main Plugin

**File**: `src/main.ts`

Update imports and initialization:

-   Replace `OpenCodeClientAdapter` with `OpenCodeClient`
-   Update type imports
-   Verify error handling integration

**Estimated Effort**: 1 hour

### Task 4: Update View Layer

**File**: `src/opencode-obsidian-view.ts`

Ensure compatibility:

-   Verify event callback signatures
-   Test streaming functionality
-   Update any type references

**Estimated Effort**: 2 hours

### Task 5: Remove Legacy Files

**Files**: Remove these files

-   `src/opencode-server/client-adapter.ts`
-   `src/opencode-server/sdk-client.ts`
-   `src/opencode-server/sdk-types.ts`

**Estimated Effort**: 30 minutes

### Task 6: Update Tests

**File**: `src/opencode-server/sdk-client.test.ts`

Update or create tests for new client:

-   Test SDK integration
-   Test Obsidian fetch adapter
-   Test event handling

**Estimated Effort**: 2-3 hours

### Task 7: Documentation Update

**Files**: Update documentation

Update any references to old client structure:

-   README.md
-   Architecture docs
-   Code comments

**Estimated Effort**: 1 hour

## Implementation Order

1. **Task 2** - Create types file (foundation)
2. **Task 1** - Implement new client (core functionality)
3. **Task 6** - Update tests (verify functionality)
4. **Task 3** - Update main plugin (integration)
5. **Task 4** - Update view layer (UI integration)
6. **Task 5** - Remove legacy files (cleanup)
7. **Task 7** - Update documentation (finalization)

## Code Examples

### New Client Structure

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk";
import type { App } from "obsidian";
import { requestUrl } from "obsidian";

export class OpenCodeClient {
	private sdkClient: ReturnType<typeof createOpencodeClient>;
	private connectionState: ConnectionState = "disconnected";

	constructor(
		app: App,
		errorHandler: ErrorHandler,
		config: OpenCodeServerConfig,
	) {
		this.sdkClient = createOpencodeClient({
			baseUrl: config.url,
			fetch: this.createObsidianFetch(),
		});
	}

	private createObsidianFetch() {
		return async (
			url: string | URL,
			init?: RequestInit,
		): Promise<Response> => {
			// Obsidian requestUrl adapter implementation
		};
	}

	async connect(): Promise<void> {
		await this.sdkClient.event.subscribe({
			// Event handlers
		});
	}

	// Maintain existing API methods...
}
```

### Type Definitions

```typescript
// Re-export from SDK
export type { Session, Message, Part } from "@opencode-ai/sdk";

// Obsidian-specific types
export interface SessionContext {
	currentNote?: string;
	selection?: string;
	links?: string[];
	tags?: string[];
	properties?: Record<string, unknown>;
}

export interface ProgressUpdate {
	message: string;
	stage?: string;
	progress?: number;
}

export type ConnectionState =
	| "disconnected"
	| "connecting"
	| "connected"
	| "reconnecting";
```

## Testing Strategy

### Unit Tests

-   Test Obsidian fetch adapter
-   Test event handling
-   Test connection state management
-   Test error propagation

### Integration Tests

-   Test with mock OpenCode server
-   Test SSE event processing
-   Test session lifecycle

### Manual Testing

-   Test in Obsidian environment
-   Verify UI updates work correctly
-   Test error scenarios
-   Test reconnection logic

## Success Criteria

1. **Functionality**: All existing features work identically
2. **Performance**: No significant performance degradation
3. **Code Quality**: Reduced complexity, better maintainability
4. **Type Safety**: Full TypeScript coverage
5. **Tests**: All tests pass, good coverage
6. **Documentation**: Updated and accurate

## Rollback Plan

If issues arise:

1. Keep old files in git history
2. Revert main.ts changes
3. Restore old client imports
4. Investigate and fix issues
5. Re-attempt migration

## Dependencies

-   `@opencode-ai/sdk` - Already installed
-   No additional dependencies required
-   Obsidian API compatibility maintained
