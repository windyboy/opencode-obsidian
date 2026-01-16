# AGENTS.md (instructions for coding agents)

**Obsidian plugin** (TypeScript, ESM) integrating with **OpenCode Server** via HTTP + SSE.

Keep changes **minimal, secure, and consistent** with existing patterns.

## Project overview

AI-powered chat plugin for Obsidian with:
- Real-time streaming chat interface
- Vault tool execution (read/write/search notes)
- Multi-session conversation management
- Permission system for vault operations
- Agent and skill configuration

## Architecture

**Core components:**
- `src/opencode-server/client.ts` - OpenCode SDK wrapper with SSE streaming
- `src/session/` - Connection and event bus management
- `src/tools/obsidian/` - Permission-based tool execution
- `src/views/` - UI components and services
- `src/utils/error-handler.ts` - Centralized error handling

**Key patterns:**
- Non-blocking connection with auto-reconnection
- SSE streaming for real-time updates
- Three-tier permission model (read-only, scoped-write, full-write)
- Event-driven architecture with event bus

## Security and error handling

**Security:**
- Always use `PermissionManager` for vault operations
- Never bypass permission checks
- Validate user inputs with `src/utils/validators.ts`
- No secrets in logs

**Error handling:**
- Use `ErrorHandler` at async boundaries
- Pattern: `errorHandler.handleError(error, context, severity)`
- Severity: `Critical`, `Error`, `Warning`, `Info`

## Commands

**Dev:**
- `bun install` - Install dependencies
- `bun run dev` - Dev build with hot reload
- `bun run build` - Production build

**Quality:**
- `bun run lint` - ESLint
- `bun run check` - TypeScript typecheck
- `bun vitest run` - Run all tests
- `bun vitest` - Watch mode
- `bun vitest run -t "test name"` - Run specific test

**Other:**
- `bun run debug` - Debug script
- `bun version patch|minor|major` - Version bump

## Key files

**Core:**
- `src/main.ts` - Plugin entrypoint
- `src/settings.ts` - Settings UI
- `src/types.ts` - Type definitions

**OpenCode integration:**
- `src/opencode-server/client.ts` - SDK wrapper with SSE
- `src/session/` - Connection and event management

**Tools:**
- `src/tools/obsidian/tool-registry.ts` - Tool definitions
- `src/tools/obsidian/permission-manager.ts` - Permission checks

**UI:**
- `src/views/opencode-obsidian-view.ts` - Main view
- `src/views/components/` - UI components
- `src/views/services/` - Business logic

**Config:**
- `esbuild.config.mjs` - Build config
- `tsconfig.json` - TypeScript config (strict mode)
- `vitest.config.ts` - Test config
- `.editorconfig` - Tabs, LF, UTF-8

## Code standards

**Formatting:**
- Indent: tabs (width 4)
- Line endings: LF
- Charset: UTF-8

**ESLint:**
- UI strings: sentence case (e.g., "Test connection", "Invalid HTTP URL")
- Use targeted `// eslint-disable-next-line` only when necessary

**TypeScript:**
- Strict mode enabled
- Avoid `any`, prefer `unknown` + validation
- Use discriminated unions and type guards
- Prefer `as const` for literal objects

## Code style

**Naming:**
- Files: `kebab-case`
- Classes/Types: `PascalCase`
- Functions/vars: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE` or `camelCase` with `as const`
- Tools: `obsidian.<verb>_<noun>`

**Imports:**
- Use ESM, prefer `import type` for types
- Group: external deps → internal modules

**Best practices:**
- Early returns for guard clauses
- Use `ErrorHandler` at async boundaries
- Validate inputs with `src/utils/validators.ts`
- Always use `PermissionManager` for vault operations
- Use `console.debug` for verbose logs

## Testing

**Principles:**
- Unit tests first, minimize mocking
- Test behavior, not implementation
- Deterministic tests (fixed timestamps, no random data)
- Small and focused

**What to mock:**
- ✅ External APIs (OpenCode Server SDK)
- ✅ Obsidian API (use `__mocks__/obsidian.ts`)
- ✅ File system operations
- ❌ Your own utilities
- ❌ Pure data transformations
- ❌ Event emitters (test real flow)

**Patterns:**
```typescript
// Pure functions - no mocks
describe("formatTimestamp", () => {
	it("should format timestamp", () => {
		expect(formatTimestamp(1000)).toBe("1970-01-01T00:00:01.000Z");
	});
});

// Services - inject dependencies, mock external only
describe("SessionManager", () => {
	let mockClient: any; // Mock external
	let errorHandler: ErrorHandler; // Real

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

**Coverage:**
- Aim for 80%+ on pure logic
- Focus on critical paths
- Don't chase 100%

## Dependencies

- `obsidian` - Obsidian API
- `@opencode-ai/sdk` - OpenCode SDK client
- `zod` - Schema validation
- `minimatch` - Glob pattern matching

## Build

esbuild with custom plugin for Obsidian default exports:
1. Bundle to CommonJS
2. Fix default export wrapper
3. Target ES2018
4. External: obsidian, electron, codemirror, node builtins
