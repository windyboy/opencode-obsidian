# AGENTS.md (instructions for coding agents)

This repository is an **Obsidian plugin** (TypeScript, ESM) that integrates with **OpenCode Server** via HTTP + SSE for agent orchestration and tool execution.

If you’re an agent working here: keep changes **minimal, secure, and consistent** with existing patterns.

## Global agent instructions

### Memvid MCP memory rules

-   Use the `memvid` MCP server for durable user preferences, decisions, and long-lived project context.
-   At the start of each new task, query memory for relevant context before acting.
    -   Use `memvid_search` (or `memvid_search_by_tag` when tags are available).
-   After each task, write back any new durable preferences/decisions/constraints.
    -   Use `memvid_add_text` or `memvid_add_file`, then `memvid_commit`.
-   Do not store secrets, tokens, credentials, or transient errors/logs.
-   Use consistent tags like `project`, `decision`, `preference`, `constraint`.
-   Default memory file path: `./.mem/memory.mv2`.

### Memvid tracking list (maintain over time)

-   **Project settings**: Memory file path, non-README internal notes, tooling constraints.
-   **Client architecture**: SDK helper (`createClient`), Obsidian wrapper (`OpenCodeServerClient`), non-blocking connect, background SSE loop, reconnect semantics.
-   **Agent rules**: Agent config locations, frontmatter expectations, default behaviors, restrictions.
-   **Security/permissions**: Required permission checks, no direct vault reads/writes without `PermissionManager`.
-   **Error handling**: Use `ErrorHandler` at async boundaries; avoid bare `console.error`.

## Quick commands

### Install

-   `pnpm install`

### Dev / build

-   `pnpm dev` — esbuild dev build with hot reload
-   `pnpm build` — production build (`tsc -noEmit -skipLibCheck` + esbuild production)

### Lint / typecheck

-   `pnpm lint` — `eslint .`
-   `pnpm check` — TypeScript typecheck only (`tsc -noEmit -skipLibCheck`)

Tip: to lint a single file quickly, run:

-   `pnpm eslint src/path/to/file.ts`

### Tests (Vitest)

Vitest is configured (`vitest.config.ts`). Tests live under `src/**` and `tests/**`.

-   If no tests are present, `pnpm vitest run` exits with code 1.
-   Run all tests: `pnpm vitest run`
-   Watch mode: `pnpm vitest`
-   Single test file: `pnpm vitest run tests/unit/some.test.ts`
-   Single test by name (regex): `pnpm vitest run -t "name regex"`
-   Single test file + name: `pnpm vitest run tests/unit/some.test.ts -t "name regex"`
-   UI (if installed): `pnpm vitest --ui`

Notes:

-   Test globs include: `src/**/*.test.ts`, `src/**/*.spec.ts`, `tests/**/*.test.ts`, `tests/**/*.spec.ts`.
-   Obsidian API is mocked via `__mocks__/obsidian.ts` (see `vitest.config.ts`).

### Debug

-   `pnpm debug` — runs `scripts/debug.js`

### Version bump

-   `npm version patch|minor|major` — runs `version-bump.mjs` and stages `manifest.json` + `versions.json`.

## Repo map (high level)

-   `src/main.ts` — plugin entrypoint, lifecycle, settings load/save, client + tool wiring
-   `src/opencode-obsidian-view.ts` — UI layer (chat view, streaming updates)
-   `src/settings.ts` — settings UI and validation
-   `src/opencode-server/` — HTTP + SSE client for OpenCode Server integration
-   `src/orchestrator/` — agent loop state machine and task orchestration
-   `src/context/` — context management, retrieval strategies, token estimation
-   `src/session/` — session lifecycle management and persistence
-   `src/todo/` — task planning, orchestration, and progress tracking
-   `src/mcp/` — Model Context Protocol integration
-   `src/tools/obsidian/` — tool registry/executor, permission manager, audit logging
-   `src/utils/` — error handling, validation, constants, debounce/throttle
-   `__mocks__/obsidian.ts` — Obsidian API mock for tests
-   `docs/` — project docs (architecture, refactoring notes)

## Tooling + formatting expectations

### EditorConfig (authoritative)

`.editorconfig`:

-   Indent: **tabs**, width **4**
-   Line endings: **LF**
-   Charset: UTF-8

## Project memory (Codex)

-   Use a per-project memvid file stored at `./.mem/memory.mv2`.
-   Do not use the global default `~/.codex/memory/memvid.mv2` for this repo.

### ESLint

-   ESLint config: `eslint.config.mts`
-   Uses `eslint-plugin-obsidianmd` (recommended config)
-   Important rule: UI strings must satisfy `obsidianmd/ui/sentence-case`
    -   Prefer rewriting UI text to be sentence case.
    -   If you must bypass (rare), use a **targeted** `// eslint-disable-next-line obsidianmd/ui/sentence-case`.

### TypeScript

`tsconfig.json` enables strictness (not exhaustive):

-   `noImplicitAny`, `strictNullChecks`, `useUnknownInCatchVariables`, `noUncheckedIndexedAccess`, `isolatedModules`

Guidance:

-   Avoid `any`. Prefer `unknown` + validation, discriminated unions, and type guards.
-   Prefer `as const` for literal config objects.

## Code style guidelines

### Imports

-   Use ESM imports.
-   Prefer `import type { ... } from '...'` for type-only imports.
-   Group imports consistently:
    1. external deps (`obsidian`, `zod`, etc.)
    2. internal modules (`./...`)
-   Keep imports at the top of the file; do not interleave imports after executable code.

### Naming

-   Files: kebab-case (e.g., `opencode-obsidian-view.ts`)
-   Classes: `PascalCase`
-   Functions/vars: `camelCase`
-   Types/interfaces: `PascalCase`
-   Constants:
    -   `SCREAMING_SNAKE_CASE` for true constants
    -   otherwise prefer `camelCase` with `as const`
-   Tool names: `obsidian.<verb>_<noun>` (see `src/tools/obsidian/tool-registry.ts`)

### Formatting

-   Match existing file style (this repo is not fully auto-formatted).
-   Prefer early returns for guard clauses.
-   Keep argument lists and object literals readable (wrap when needed).

### Error handling

Use the shared error system:

-   `src/utils/error-handler.ts` (`ErrorHandler`, `ErrorSeverity`)
-   Call `errorHandler.handleError(error, { module, function, operation, metadata }, severity)`

Guidance:

-   In async boundaries (SSE callbacks, tool execution, UI callbacks), catch and route to `ErrorHandler` when user-facing or for consistent logging.
-   Avoid bare `console.error` except inside `ErrorHandler` or as a last-resort fallback when no handler is available.

### Validation + security

-   Validate user-controlled inputs (server config, tool args, file paths).
-   Prefer existing validators in `src/utils/validators.ts`.
-   For vault file operations, always go through permission checks:
    -   `PermissionManager.canRead/canWrite/canCreate/canModify/canDelete`
-   Avoid direct vault reads/writes in paths that should be permission-gated.
-   Do not log secrets (tokens, API keys, note contents unless explicitly needed).

### UI strings

To satisfy `obsidianmd/ui/sentence-case`:

-   Use sentence case for user-visible text.
-   Keep acronyms like “URL”, “HTTP”, “SSE”, and “OpenCode” correctly capitalized.

Examples:

-   Good: `"Test connection"`, `"Invalid HTTP URL"`, `"Open chat view"`
-   Avoid: `"Invalid HTTP url"`, `"test Connection"`

### Logging

-   Prefer `console.debug` for noisy logs; keep structured payloads small.
-   Avoid logging entire note content; log lengths/IDs instead.

## Testing guidelines

-   Keep tests small and deterministic.
-   Prefer unit tests for pure modules (`src/utils`, validators).
-   Obsidian UI isn’t available in tests; avoid E2E/UI tests.

## Existing agent docs

-   `docs/AGENTS.md` describes **OpenCode “agents” config files** (vault `.opencode/agent/*.md`).
-   This root `AGENTS.md` is for **coding agents working on this repository**.

## Other agent instruction files

-   No Cursor rules found in `.cursor/rules/` or `.cursorrules`.
-   No GitHub Copilot rules found in `.github/copilot-instructions.md`.
