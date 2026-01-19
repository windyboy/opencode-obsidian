# OpenCode Obsidian - Developer Guide

AI-powered chat interface for Obsidian, integrating with OpenCode Server for agent orchestration and tool execution.

**Stack:** TypeScript (strict), Obsidian API, OpenCode SDK, Vitest, esbuild

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

**Pattern:** Event-driven modular architecture with dependency injection

**Key Components:**
- `OpenCodeServerClient` - HTTP + SSE communication (ConnectionHandler, StreamHandler, SessionOperations)
- `ServerManager` - Embedded server lifecycle
- `SessionEventBus` - Pub-sub event system
- `Tool System` - Registry, Executor, PermissionManager, AuditLogger
- `ErrorHandler` - Unified error handling
- `RetryHelper` - Retry logic with exponential backoff

**Principles:** Event-driven decoupling, single responsibility, strict type safety, Zod validation for external data

## Critical Details

**Obsidian API:**
- Use `app.vault.read/create/modify()` not Node.js `fs`
- Use `requestUrl()` not `fetch` (custom adapter in client)
- All paths relative to vault root

**SSE:** Non-blocking connection, async event processing, validate all event data

**Sessions:** Single active session, multiple conversations cached (LRU, max 50)

**Permissions:** 3 levels (read-only, scoped-write, full-write), uses `minimatch` for path patterns

## Common Patterns

**Error Handling:** Use `ErrorHandler.handleError(error, context, severity)`

**Events:** Always unsubscribe to prevent leaks: `const unsub = eventBus.on...; unsub()`

**Retry:** Use `RetryHelper.withRetry(operation, { maxAttempts, delayMs, backoffMultiplier })`

**New Tool:** Define schema → Register → Implement → Check permissions → Log audit

## Key Files

```
src/
├── main.ts, settings.ts, types/
├── client/          # HTTP + SSE (client, connection-handler, stream-handler, session-operations)
├── embedded-server/ # ServerManager, types
├── session/         # connection-manager, session-event-bus
├── tools/obsidian/  # tool-registry, tool-executor, permission-manager, audit-logger
├── utils/           # error-handler, retry-helper, constants
└── views/           # UI components
```

## Testing

**Files:** `**/*.test.ts`, mocks in `__mocks__/obsidian.ts`

**Run:** `bun vitest run` (all) or `bun vitest run src/path/to/file.test.ts` (specific)

**Coverage excludes:** UI components (main.ts, views, settings)

## Code Conventions

**Naming:** PascalCase (classes), camelCase (functions), UPPER_SNAKE_CASE (constants), `_prefix` (private)

**Type Safety:** Avoid `any`, use `unknown` + type guards, Zod for external data validation

**Imports:** Absolute from `src/` - e.g., `import { ErrorHandler } from "utils/error-handler"`

## Debugging

**Console:** `Cmd+Option+I` (macOS) or `Ctrl+Shift+I` (Windows/Linux)

**Common Issues:**
- Not loading → Check console, verify `manifest.json`, run `bun run build`
- Connection → Verify server running, check URL in settings, test `curl http://localhost:4096/health`
- Tool failures → Check permissions, verify vault-relative paths, check `.opencode/audit/` logs

## Known Limitations

**Status:** ~68% complete - Missing session fork, permission events, search APIs, dynamic agent loading

See `docs/analysis/feature_gap_claude.md` for details

## Documentation

**Project Docs:**
- `README.md` - User guide, installation
- `docs/REFACTORING_PLAN.md` - Prioritized refactoring tasks
- `docs/analysis/` - Code review audit, issues, feature gaps
- `docs/architecture/ARCHITECTURE.md` - Architecture decisions

**Module Docs:** Each module has `CLAUDE.md` (client, embedded-server, session, tools, utils, views)

**External:** [Obsidian API](https://docs.obsidian.md), OpenCode SDK in `node_modules/@opencode-ai/sdk/`
