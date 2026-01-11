# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Commands

### Development
- `pnpm dev` - Start development build with hot reload
- `pnpm build` - Production build with TypeScript type checking
- `pnpm lint` - Run ESLint to check code quality
- `pnpm check` - Run TypeScript type checking only

### Testing
Testing infrastructure is configured with Vitest but no tests are currently implemented. The vitest.config.ts is set up to support unit tests when they are added.

### Version Management
- `npm version patch|minor|major` - Bump version and update manifest/versions.json

### Debugging
- `pnpm debug` - Run debug script

## Architecture Overview

### Plugin Structure

This is an Obsidian plugin that integrates with OpenCode Server for AI-powered chat and tool execution. The architecture has three main layers:

1. **UI Layer** (`opencode-obsidian-view.ts`): Chat interface with incremental DOM updates
2. **Service Layer**: Provider management, AI client, agent resolution, config loading
3. **OpenCode Server Integration**: HTTP + SSE client for agent orchestration and tool execution

### Key Integration Points

#### OpenCode Server HTTP + SSE Protocol
The plugin communicates with OpenCode Server via HTTP + SSE for:
- **Agent orchestration**: Planning → Executing → Validating → Retrying → Completed states
- **Tool execution**: Server requests Obsidian tool execution with permission handling
- **Streaming responses**: Real-time token/thinking/progress updates via SSE

**HTTP API Endpoints**:
- `POST /session` - Start a new session
- `POST /session/{id}/message` - Send a message to a session
- `POST /session/{id}/abort` - Interrupt/stop a session

**SSE Events**:
- `message.part.updated` - Stream text/reasoning content
- `session.status` - Session status updates
- `session.error` - Session errors
- `session.idle` - Session ended

File: `src/opencode-server/client.ts`

#### Permission System
Tool execution is gated by a three-level permission model:
- **read-only**: No approval needed for reads
- **scoped-write**: Requires user approval for writes to specific paths (shown via PermissionModal)
- **full-write**: Requires approval for any write

Manages both allowed/denied paths with glob patterns and file size limits.

Files: `src/tools/obsidian/permission-manager.ts`, `tool-executor.ts`

#### Obsidian Tools (6 Core Tools)
1. `obsidian.search_vault` - Search notes (read-only)
2. `obsidian.read_note` - Read note content (read-only)
3. `obsidian.list_notes` - List notes in folder (read-only)
4. `obsidian.get_note_metadata` - Get frontmatter, tags, links (read-only)
5. `obsidian.create_note` - Create new note (scoped-write)
6. `obsidian.update_note` - Update with replace/append/prepend/insert modes (scoped-write)

Files: `src/tools/obsidian/tool-executor.ts`, `tool-registry.ts`

### Core Service Modules

**ProviderManager** (`src/provider-manager.ts`): Manages AI provider clients with factory pattern, model caching (30s LRU), and throttling (2s minimum interval).

**EmbeddedAIClient** (`src/embedded-ai-client.ts`): Unified client for all AI providers with streaming support, type-safe event handling, and LRU session cache (max 50 sessions, 30min idle timeout).

**AgentResolver** (`src/agent/agent-resolver.ts`): Resolves agent configurations, merges skills into system prompts, integrates instructions, handles model/tool overrides.

**ConfigLoader** (`src/config-loader.ts`): Loads `.opencode/` configuration with security validations:
- File path validation (prevents traversal)
- Size limits (config: 1MB, agents/skills: 5MB, instructions: 10MB)
- JSON depth/complexity checks
- YAML frontmatter parsing with js-yaml

**ErrorHandler** (`src/utils/error-handler.ts`): Unified error handling with severity levels (Critical/Error/Warning/Info), context-aware messages, and optional error collection for debugging.

**Validators** (`src/utils/validators.ts`): Type-safe input validation for configs, agents, providers with detailed error messages.

### Session and Context Management

**SessionManager** (`src/session/session-manager.ts`): Manages conversation session lifecycle with auto-save mechanism.

**ContextManager** (`src/context/context-manager.ts`): Handles context retrieval, token estimation, budget allocation, and preemptive compaction. Uses RetrievalStrategy interface for pluggable context sources.

**TodoManager** (`src/todo/todo-manager.ts`): Extracts TODOs from conversation messages, creates TaskPlan structures, tracks progress, and persists to vault.

### Known Architecture Issues

The ARCHITECTURE.md file documents several known issues that need attention:

**Critical Issues** (high priority):
1. **Concurrent session callbacks** - `startSession()` uses array instead of Map, causing race conditions
2. **Stream callbacks ignore sessionId** - Messages routed by `activeConv` instead of sessionId matching
3. **Permission preview bypasses PermissionManager** - Direct vault read in `generatePreview()` bypasses security
4. **Orchestrator is placeholder** - Doesn't wait for server responses, immediately marks steps as complete

**Architecture Improvements** (medium priority):
- SessionEventBus for decoupling UI from SSE protocol
- Orchestrator as event-driven state machine (not placeholder)
- Unified permission/audit system (preview and execution use same path)
- Unified TaskPlan source between TodoManager and Orchestrator
- Context fusion strategy extraction
- Unified connection management

See `docs/ARCHITECTURE.md` sections 14+ for detailed improvement plans and implementation roadmap.

## Configuration System

Configurations are loaded from `.opencode/` directory with this priority:
1. `.opencode/config.json`
2. `.opencode.json` in root
3. Fallback to built-in defaults

Custom agents and skills are loaded from:
- **Agents**: `.opencode/agent/{name}.md` with YAML frontmatter
- **Skills**: `.opencode/skill/{name}/SKILL.md` with YAML frontmatter
- **Instructions**: Glob patterns in config pointing to instruction files

All configs are validated and can be patched into the main system prompt. See `src/config-loader.ts` for implementation.

## Memory MCP Servers

This project has access to two memory MCP servers for persistent context and knowledge management:

### claude-mem (Automatic Conversation Memory)

A search-based memory system that automatically tracks conversation history with efficient token usage.

**3-Layer Workflow** (always follow this pattern):
1. `search(query)` - Get index with IDs (~50-100 tokens/result)
2. `timeline(anchor=ID)` - Get context around interesting results
3. `get_observations([IDs])` - Fetch full details ONLY for filtered IDs

**Key Features**:
- Automatically captures observations, sessions, and prompts from conversations
- Optimized for quick searches with minimal token usage
- Timeline view for temporal context around specific results
- Supports filtering by project, type, date range, and observation type

**Usage Pattern**:
```typescript
// Step 1: Search to find relevant IDs
const results = await search({ query: "authentication", limit: 10 });

// Step 2: Get timeline context around interesting result
const context = await timeline({ anchor: "#P123", depth_before: 2, depth_after: 2 });

// Step 3: Fetch full details only for filtered IDs
const details = await get_observations({ ids: [123, 124, 125] });
```

**When to Use**: Quick lookups of past conversations, finding previous decisions or implementations, understanding project history.

### memvid (File-Based Memory System)

A comprehensive memory system that stores data in `.mv2` files with semantic search, tagging, and export capabilities.

**Core Operations**:
- `memvid_create(file_path, description?)` - Create new memory file
- `memvid_add_text(file_path, content, title?, uri?, tags?)` - Add text content
- `memvid_add_file(file_path, source_file, title?, tags?)` - Import file content
- `memvid_commit(file_path)` - Save changes to disk

**Search & Retrieval**:
- `memvid_search(file_path, query, top_k?, snippet_chars?)` - Semantic vector search
- `memvid_search_by_tag(file_path, tag_key, tag_value?)` - Tag-based search
- `memvid_export_search_results(file_path, query, format, top_k?)` - Export as text/json/markdown

**Management**:
- `memvid_info(file_path)` - Get metadata (size, entries, timestamps)
- `memvid_list_contents(file_path, limit?)` - List recent entries
- `memvid_get_status()` - Check server status and features

**Usage Pattern**:
```typescript
// Create memory file
await memvid_create({ file_path: "project-memory.mv2", description: "Project knowledge base" });

// Add content with tags
await memvid_add_text({
  file_path: "project-memory.mv2",
  content: "Authentication uses JWT tokens with 24h expiry",
  title: "Auth Implementation",
  tags: { category: "security", component: "auth" }
});

// Commit changes
await memvid_commit({ file_path: "project-memory.mv2" });

// Search semantically
const results = await memvid_search({
  file_path: "project-memory.mv2",
  query: "how does authentication work",
  top_k: 5
});
```

**When to Use**: Building project knowledge bases, storing architectural decisions, documenting patterns, creating searchable documentation, organizing research notes.

### Choosing Between Memory Systems

**Use claude-mem when**:
- You need to recall past conversations quickly
- You want automatic memory without manual management
- You're looking for temporal context (what was discussed when)
- Token efficiency is critical

**Use memvid when**:
- You need persistent, structured knowledge storage
- You want to organize information with tags
- You need to import external files or documentation
- You want to export memory for sharing or backup
- You're building a project-specific knowledge base

**Use both together**:
- claude-mem for conversation history and quick lookups
- memvid for curated project knowledge and documentation
- Cross-reference between systems for comprehensive context

## Type System

The project uses strict TypeScript with `noImplicitAny`, `strictNullChecks`, and other strict flags enabled. Key type definitions:

**File**: `src/types.ts` - Core interfaces (Settings, PluginConfig, Agent, Skill, Provider, etc.)

**Validation**: All user inputs validated via Zod schemas in:
- `src/utils/validators.ts` - Config, agent, provider schemas
- `src/tools/obsidian/types.ts` - Tool input schemas with Zod

## Testing

Testing infrastructure is configured with **Vitest** (`vitest.config.ts`) but no tests are currently implemented. The test setup includes:
- Mock for Obsidian API (`__mocks__/obsidian.ts`)
- Coverage configuration (v8 provider)
- Alias resolution (`@` for `src/`)

When tests are added, they should cover:
- Core utilities (ErrorHandler, Validators)
- Business logic (AgentResolver, ConfigLoader, ToolExecutor, PermissionManager)
- No E2E tests planned (would require full Obsidian environment)

## Common Development Tasks

### Adding a New Tool
1. Define input schema in `src/tools/obsidian/types.ts` using Zod
2. Implement execution logic in `src/tools/obsidian/tool-executor.ts`
3. Add permission checks using `PermissionManager.canRead()` / `canWrite()`
4. Register in `src/tools/obsidian/tool-registry.ts`
5. Log all operations via `AuditLogger` for audit trail

### Handling Errors
Use the ErrorHandler for consistency:
```typescript
ErrorHandler.handleError(error, {
  module: 'MyModule',
  function: 'myFunction',
  operation: 'describe what failed',
  metadata: { /* context */ }
}, 'Error'); // severity level
```

### Adding Configuration Options
1. Add to Settings interface in `src/types.ts`
2. Add UI controls in `src/settings.ts`
3. Debounce saves using `debounce()` from `src/utils/debounce-throttle.ts`
4. Use `ErrorHandler` for validation errors

### Working with OpenCode Server HTTP + SSE API
The plugin communicates via HTTP requests for sending messages and SSE for receiving streaming updates. When handling tool calls:
1. Check sessionId matches current conversation (⚠️ known issue: currently not validated)
2. Execute via ToolExecutor which handles permissions
3. On PermissionPendingError, show PermissionModal
4. Send result via HTTP API

## Important Notes

- **No External Dependencies**: Plugin size matters - avoid adding lodash, rxjs, etc. Use custom utilities or built-in APIs
- **Obsidian Compatibility**: Must work with Obsidian 1.0.0+. Check `manifest.json` minAppVersion
- **Error Handling**: Always use ErrorHandler - never bare console.error()
- **Performance**: Use debounce/throttle for settings changes. Model list is cached and throttled
- **Security**: Validate all file paths in ConfigLoader, validate JSON structures, check permission scopes for tool execution
- **Incremental DOM Updates**: Use incremental updates in view instead of full re-renders
- **Type Safety**: Leverage strict TypeScript - don't use `any` types. Use type guards for message validation

## Style and Patterns

- **JSDoc comments** for all public interfaces and methods
- **Factory methods** for client creation (see ProviderManager for pattern)
- **Dependency injection** via constructor parameters
- **Error context** passed with all error handling
- **Constants** extracted to `src/utils/constants.ts`
- **Debounce/throttle** for expensive operations (model fetching, settings saves)
- **LRU caches** for sessions and model lists (custom implementation, no external libs)

## Debugging Tips

Use `pnpm debug` to run debug script. Check Obsidian developer console:
- macOS: Cmd + Option + I or View → Toggle Developer Tools
- Windows/Linux: Ctrl + Shift + I or View → Toggle Developer Tools

Look for hooks execution in console - plugin fires hooks at various points for extensibility (`src/hooks/hook-registry.ts`).
