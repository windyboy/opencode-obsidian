# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenCode Obsidian is an Obsidian plugin providing an AI-powered chat interface that integrates with OpenCode Server for agent orchestration and tool execution.

**Tech Stack:** TypeScript (strict mode), Obsidian Plugin API, OpenCode SDK, Vitest, esbuild

## Essential Commands

```bash
# Development
bun run dev              # Watch mode with hot reload
bun run build            # Production build with type checking
bun run check            # Type check only

# Testing
bun vitest run           # Run all tests
bun vitest               # Watch mode
bun vitest run src/path/to/file.test.ts  # Run specific test

# Quality
bun run lint             # ESLint

# Version
npm version patch/minor/major  # Auto-updates manifest.json, package.json, versions.json
```

## Architecture

### Core Pattern: Event-Driven Modular Architecture

```
Plugin (main.ts)
├── OpenCodeServerClient    # HTTP + SSE communication with server
│   ├── ConnectionHandler   # Connection lifecycle
│   ├── StreamHandler       # SSE event processing
│   └── SessionOperations   # Session CRUD
├── SessionEventBus         # Pub-sub event system (decouples components)
├── ConnectionManager       # Connection diagnostics and retry logic
├── Tool System
│   ├── ToolRegistry        # 6 Obsidian tools registration
│   ├── ToolExecutor        # Execution with permission checks
│   ├── PermissionManager   # 3-level permission model
│   └── AuditLogger         # Logs to .opencode/audit/
└── ErrorHandler            # Unified error handling with severity levels
```

### Key Principles

1. **Event-Driven**: SessionEventBus decouples producers/consumers
2. **Dependency Injection**: Components receive dependencies via constructor
3. **Single Responsibility**: Each module has one clear purpose
4. **Type Safety**: Strict TypeScript + Zod validation for external data

## Critical Implementation Details

### Obsidian API Constraints

**Must use `requestUrl` instead of `fetch`:**
- Obsidian plugins cannot use standard `fetch` API
- OpenCodeServerClient implements custom fetch adapter
- Message/prompt endpoints: 60s timeout (longer processing)

**File operations:**
- Use `app.vault.read()`, `app.vault.create()`, `app.vault.modify()`
- Never use Node.js `fs` module
- All paths relative to vault root

### SSE Event Stream

- `connect()` is non-blocking - SSE loop runs in background
- Events processed asynchronously
- Always validate event data before processing

### Session Management

- Single active OpenCode session at a time
- Multiple conversations stored locally
- Sessions cached (LRU, max 50) to reduce server requests

### Permission System

**Three levels:**
1. `read-only` - Auto-approve reads, deny writes
2. `scoped-write` - Require approval for writes to allowed paths
3. `full-write` - Require approval for all writes

**Path matching:** Uses `minimatch` for glob patterns (e.g., `["notes/**/*.md", "!notes/private/**"]`)

## Common Patterns

### Error Handling

Always use ErrorHandler for consistency:

```typescript
try {
    await operation();
} catch (error) {
    this.errorHandler.handleError(error, {
        module: "ModuleName",
        function: "functionName",
        operation: "What was being done"
    }, ErrorSeverity.Error);
}
```

### Event Subscription

Always unsubscribe to prevent memory leaks:

```typescript
const unsubscribe = eventBus.onStreamToken(event => {
    // Handle event
});

// Cleanup when component unmounts
unsubscribe();
```

### Adding a New Tool

1. Define schema in `src/tools/obsidian/types.ts`
2. Register in `ObsidianToolRegistry.registerTools()`
3. Implement execution in `ObsidianToolExecutor`
4. Check permissions, execute, log to audit

## Key File Locations

**Core:**
- `src/main.ts` - Plugin entry point
- `src/types.ts` - Global types
- `src/settings.ts` - Settings UI

**OpenCode Server:**
- `src/opencode-server/client.ts` - Main client wrapper
- `src/opencode-server/connection-handler.ts` - Connection lifecycle
- `src/opencode-server/stream-handler.ts` - SSE processing
- `src/opencode-server/session-operations.ts` - Session CRUD

**Session:**
- `src/session/connection-manager.ts` - Connection diagnostics
- `src/session/session-event-bus.ts` - Event pub-sub

**Tools:**
- `src/tools/obsidian/tool-registry.ts` - Tool registration
- `src/tools/obsidian/tool-executor.ts` - Tool execution
- `src/tools/obsidian/permission-manager.ts` - Permission checks
- `src/tools/obsidian/audit-logger.ts` - Audit logging

**Utils:**
- `src/utils/error-handler.ts` - Error handling
- `src/utils/constants.ts` - Configuration constants

## Testing

**Test files:** `**/*.test.ts` or `**/*.spec.ts`

**Obsidian API mocked in:** `__mocks__/obsidian.ts`

**Coverage excludes:** UI components (main.ts, opencode-obsidian-view.ts, settings.ts)

**Test structure:**
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ComponentName', () => {
    let component: ComponentName;

    beforeEach(() => {
        component = new ComponentName(mockDeps);
    });

    it('should handle success case', async () => {
        const result = await component.doSomething();
        expect(result).toBe(expected);
    });
});
```

## Code Conventions

**Naming:**
- Classes/Interfaces: `PascalCase`
- Functions/Methods: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Private members: prefix with `_`

**Type Safety:**
- Avoid `any` - use `unknown` with type guards
- Use Zod for runtime validation of external data
- Strict TypeScript already configured

**Imports:**
```typescript
// Absolute imports from src/
import { ErrorHandler } from "utils/error-handler";
import { OpenCodeServerClient } from "opencode-server/client";
```

## Debugging

**Open Developer Console:**
- macOS: `Cmd + Option + I`
- Windows/Linux: `Ctrl + Shift + I`

**Common Issues:**
- Plugin not loading → Check console, verify `manifest.json`, run `bun run build`
- Connection issues → Verify server running, check URL in settings, test with `curl http://localhost:4096/health`
- Tool failures → Check permissions, verify paths relative to vault root, check `.opencode/audit/` logs

## Known Limitations

**Implementation Status: ~68% complete** (see `docs/analysis/feature_gap_claude.md`)

**Missing Critical Features:**
- Session fork/branch functionality
- Permission request event system (server → client)
- File and symbol search APIs
- Dynamic agent loading from server

## Documentation

**Key Docs:**
- `README.md` - User guide, installation, usage
- `docs/architecture/ARCHITECTURE.md` - Architecture decisions
- `docs/analysis/feature_gap_claude.md` - Feature gap analysis
- `docs/agents/AGENTS.md` - Custom agents and skills

**Module Docs:**
- `src/opencode-server/CLAUDE.md` - Client implementation, SSE handling
- `src/session/CLAUDE.md` - Event bus, session management

**External:**
- Obsidian Plugin API: https://docs.obsidian.md
- OpenCode SDK: `node_modules/@opencode-ai/sdk/dist/index.d.ts`
