# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenCode Obsidian is an Obsidian plugin providing AI-powered chat with OpenCode Server integration. Built with TypeScript (strict mode), uses HTTP + SSE for real-time streaming, and implements a permission-based tool system for vault operations.

## Essential Commands

**Development:**
```bash
bun install              # Install dependencies
bun run dev              # Dev build with hot reload
bun run build            # Production build (includes type checking)
```

**Quality Checks:**
```bash
bun run lint             # ESLint
bun run check            # TypeScript type checking
bun vitest run           # Run all tests
bun vitest               # Watch mode
bun vitest run -t "name" # Run specific test
```

**Version Management:**
```bash
bun version patch|minor|major  # Bump version (updates manifest.json, package.json, versions.json)
```

## Architecture Overview

**Core Flow:**
```
User → View (UI) → OpenCodeServerClient (HTTP+SSE) → OpenCode Server
                ↓
         ToolExecutor (with permissions) → Vault Operations
```

**Key Modules:**
- `src/main.ts` - Plugin entry point, orchestrates initialization
- `src/views/opencode-obsidian-view.ts` - Main chat UI with incremental DOM updates
- `src/opencode-server/client.ts` - SDK wrapper for OpenCode Server (HTTP + SSE)
- `src/session/` - ConnectionManager and SessionEventBus for state management
- `src/tools/obsidian/` - Permission-based tool execution system
- `src/utils/error-handler.ts` - Centralized error handling with severity levels

**Data Flow:**
1. View sends message → Client creates/uses session → Server processes
2. Server streams tokens via SSE → Client routes to View → UI updates incrementally
3. Server requests tool execution → ToolExecutor checks permissions → Returns result
4. Write operations require user approval via PermissionModal

## Critical Patterns

**Error Handling:**
Always use ErrorHandler at async boundaries:
```typescript
errorHandler.handleError(error, {
  module: 'ModuleName',
  function: 'functionName',
  operation: 'description'
}, ErrorSeverity.Error);
```

**Permission System:**
All vault operations MUST go through PermissionManager:
- Read operations: `canRead(path)` - no approval needed
- Write operations: `canWrite(path)` - requires user approval
- Three levels: read-only, scoped-write, full-write

**Input Validation:**
Use validators from `src/utils/validators.ts` for all external inputs (configs, agents, user data).

## Code Standards

**TypeScript:**
- Strict mode enabled (noImplicitAny, strictNullChecks, noUncheckedIndexedAccess)
- Avoid `any`, prefer `unknown` + validation
- Use discriminated unions and type guards
- Prefer `as const` for literal objects

**Formatting:**
- Indent: tabs (width 4)
- Line endings: LF
- Charset: UTF-8
- UI strings: sentence case ("Test connection", not "Test Connection")

**Naming:**
- Files: `kebab-case`
- Classes/Types: `PascalCase`
- Functions/vars: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE` or `camelCase` with `as const`
- Tools: `obsidian.<verb>_<noun>`

**Imports:**
- Use ESM, prefer `import type` for types
- Group: external deps → internal modules

## Testing Principles

**What to test:**
- ✅ Pure functions and business logic
- ✅ Service layer with injected dependencies
- ✅ Error handling paths

**What to mock:**
- ✅ External APIs (OpenCode Server SDK)
- ✅ Obsidian API (use `__mocks__/obsidian.ts`)
- ✅ File system operations
- ❌ Your own utilities
- ❌ Pure data transformations

**Test patterns:**
```typescript
// Pure functions - no mocks
describe("formatTimestamp", () => {
  it("should format timestamp", () => {
    expect(formatTimestamp(1000)).toBe("1970-01-01T00:00:01.000Z");
  });
});

// Services - inject dependencies, mock external only
describe("SessionManager", () => {
  let mockClient: any;
  let errorHandler: ErrorHandler; // Real instance

  beforeEach(() => {
    errorHandler = new ErrorHandler();
    mockClient = { listSessions: vi.fn() };
    sessionManager = new SessionManager(mockClient, errorHandler);
  });
});
```

**Avoid:**
- Over-mocking your own code
- Testing private methods
- Non-deterministic tests (Date.now())
- Brittle exact object matching

## Key Files Reference

**Configuration:**
- `manifest.json` - Plugin manifest (version, minAppVersion)
- `package.json` - Dependencies (uses bun/pnpm)
- `tsconfig.json` - TypeScript strict mode config
- `esbuild.config.mjs` - Build config (CommonJS output, Obsidian default export fix)
- `vitest.config.ts` - Test configuration

**Core Implementation:**
- `src/types.ts` - Core type definitions
- `src/settings.ts` - Settings UI panel
- `src/opencode-server/types.ts` - Protocol message types
- `src/tools/obsidian/tool-registry.ts` - Tool definitions (6 core tools)
- `src/tools/obsidian/permission-manager.ts` - Permission checks
- `src/utils/constants.ts` - Configuration constants (timeouts, limits, etc.)
- `src/utils/validators.ts` - Input validation functions

## Available Tools

6 core Obsidian tools with permission-based execution:
1. `obsidian.search_vault` - Search notes (read-only)
2. `obsidian.read_note` - Read note content (read-only)
3. `obsidian.list_notes` - List notes in folder (read-only)
4. `obsidian.get_note_metadata` - Get metadata, frontmatter, tags, links (read-only)
5. `obsidian.create_note` - Create new note (scoped-write)
6. `obsidian.update_note` - Update note with modes: replace, append, prepend, insert (scoped-write)

## Build System

Uses esbuild with custom plugin for Obsidian:
1. Bundle to CommonJS (Obsidian requirement)
2. Fix default export wrapper for Obsidian plugin loading
3. Target ES2018
4. External: obsidian, electron, codemirror, node builtins

## Dependencies

**Runtime:**
- `obsidian` - Obsidian API
- `@opencode-ai/sdk` - OpenCode Server SDK client
- `zod` - Schema validation (v4.3.5)
- `minimatch` - Glob pattern matching

**Dev:**
- `esbuild` - Bundler
- `vitest` - Test runner
- `typescript` - Type checking
- `eslint` + `eslint-plugin-obsidianmd` - Linting

## Known Architecture Issues

**Addressed:**
- ✅ SessionEventBus decouples UI from transport layer
- ✅ ConnectionManager centralizes connection lifecycle
- ✅ Preview generation uses PermissionManager

**Current Limitations:**
- Single active OpenCode session at a time (by design)
- No offline mode (requires OpenCode Server)
- Image attachment saves to vault but not sent to server (planned)

## Security Requirements

**Always:**
- Use PermissionManager for ALL vault operations
- Validate inputs with validators.ts
- Never bypass permission checks
- No secrets in logs or error messages
- Audit log all tool executions

**Permission Levels:**
- `read-only`: No approval needed for reads
- `scoped-write`: Approval required, limited to allowed paths
- `full-write`: Approval required, can write anywhere

## Common Development Tasks

**Adding a new tool:**
1. Define schema in `src/tools/obsidian/tool-registry.ts`
2. Implement executor in `src/tools/obsidian/tool-executor.ts`
3. Add permission checks via PermissionManager
4. Add audit logging
5. Write unit tests

**Modifying OpenCode Server integration:**
1. Update types in `src/opencode-server/types.ts`
2. Modify client in `src/opencode-server/client.ts`
3. Update SessionEventBus if event types change
4. Test with mock server responses

**UI changes:**
1. Modify `src/views/opencode-obsidian-view.ts`
2. Use incremental DOM updates (don't re-render entire view)
3. Update styles in `styles.css`
4. Test with different conversation states

## Documentation

- `README.md` - User-facing documentation, installation, usage
- `AGENTS.md` - Concise coding agent instructions
- `docs/ARCHITECTURE.md` - Detailed architecture decisions and data flow
- `CODE_REVIEW.md` - Comprehensive code review findings
- `.kiro/specs/` - Feature specifications and enhancement plans

## Related Projects

- OpenCode Server: Provides agent orchestration and tool execution runtime
- Obsidian: Note-taking app this plugin extends
