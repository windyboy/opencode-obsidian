# OpenCode Obsidian

AI-powered chat interface for Obsidian that integrates with OpenCode Server for advanced AI interactions and tool execution.

## What is this?

OpenCode Obsidian is an Obsidian plugin that provides a sophisticated chat interface to interact with AI models via OpenCode Server. It enables you to:

-   Chat with AI directly from Obsidian with real-time streaming responses
-   Connect to OpenCode Server for agent orchestration and tool execution
-   Execute Obsidian tools with permission-based security (read/write notes, search vault, etc.)
-   Manage multiple conversations with auto-save (single active session at a time)
-   Use custom agents and skills for specialized tasks

## Features

-   **Chat Interface**: Clean, intuitive chat UI with incremental DOM updates for smooth performance
-   **Slash commands**: Run `/command` shortcuts with server-provided suggestions
-   **Real-time Streaming**: See AI responses stream in real-time with token-by-token updates
-   **Multiple Conversations**: Manage multiple conversations with auto-save and persistence (only one active OpenCode session/generation at a time)
-   **OpenCode Server Integration**: HTTP + SSE connection for agent orchestration and tool execution
-   **Tool Execution**: 6 core Obsidian tools with permission-based security (read-only, scoped-write, full-write)
-   **Custom Agents & Skills**: Configure specialized agents and skills (managed by OpenCode Server)
-   **Settings Panel**: Comprehensive settings for server connection, permissions, and agent configuration
-   **Error Handling**: Unified error handling system with severity levels and user-friendly notifications
-   **Performance Optimized**: LRU caching, debounced settings, throttled API calls

## Installation

### Manual Installation

1. Download the latest release from GitHub
2. Copy `main.js`, `styles.css`, and `manifest.json` to your vault `.obsidian/plugins/opencode-obsidian/` directory
3. Reload Obsidian and enable the plugin in Settings → Community Plugins

### Development Installation

1. Clone this repository:

    ```bash
    git clone <repository-url> opencode-obsidian
    cd opencode-obsidian
    ```

2. Install dependencies:

    ```bash
    bun install
    ```

3. Build the plugin:

    ```bash
    bun run build
    ```

4. For development with hot reload:

    ```bash
    bun run dev
    ```

5. Link the plugin to your Obsidian vault (optional, for development):

    ```bash
    # On macOS/Linux
    ln -s $(pwd) ~/VaultFolder/.obsidian/plugins/opencode-obsidian

    # On Windows (PowerShell)
    New-Item -ItemType SymbolicLink -Path "$env:APPDATA\Obsidian\plugins\opencode-obsidian" -Target $(Get-Location)
    ```

    Alternatively, you can copy the plugin folder directly to your vault's `.obsidian/plugins/` directory.

## Prerequisites

-   **Node.js**: Version 16 or higher (for development)
-   **Obsidian**: Version 1.0.0 or higher
-   **OpenCode Server**: A running OpenCode Server instance (providers and API keys are managed server-side)

## Start OpenCode Server

You need a running OpenCode Server before using the plugin.

1. Install the OpenCode CLI (see the OpenCode project).
2. Start the server:

    ```bash
    opencode serve
    ```

3. Configure the server URL in plugin settings (e.g., `http://127.0.0.1:4096`).

## Configuration

### Initial Setup

1. Open Obsidian Settings
2. Go to Community Plugins
3. Enable "OpenCode Obsidian"
4. Open the plugin settings
5. Configure OpenCode Server URL (e.g., `http://127.0.0.1:4096`)
6. Set tool permission level (read-only, scoped-write, or full-write)
7. Start using the chat interface

### Settings

Configure the following settings in the plugin settings panel:

-   **OpenCode Server**: Configure HTTP connection URL (e.g., `http://127.0.0.1:4096`)
-   **Default Agent**: Select the default agent for new conversations
    -   Built-in agents: Assistant, Bootstrap, Thinking Partner, Research Assistant, Read Only
    -   Custom agents: Loaded from `.opencode/agent/*.md` files
-   **Tool Permissions**: Set permission level for tool execution
    -   `read-only`: No approval needed for read operations
    -   `scoped-write`: Requires user approval for writes to specific paths
    -   `full-write`: Requires approval for any write operation
-   **Permission Scopes**: Configure allowed/denied paths, file size limits, and extensions

### Advanced Configuration

#### Custom Agents and Skills

Create custom agents and skills by adding files to your vault:

**Agents**: `.opencode/agent/{agent-name}.md`

```markdown
---
name: My Custom Agent
description: A specialized agent for code review
model: anthropic/claude-3-5-sonnet-20241022
skills:
    - code-review
    - testing
tools:
    "*": false
    "github-triage": true
color: "#FF6B6B"
---

You are an expert code reviewer...
```

**Skills**: `.opencode/skill/{skill-name}/SKILL.md`

```markdown
---
name: Code Review
description: Guidelines for code review
---

When reviewing code, focus on:

1. Code quality and maintainability
2. Security vulnerabilities
3. Performance optimizations
   ...
```

**Configuration File**: `.opencode/config.json` or `opencode.json`

```json
{
	"providers": [
		{
			"id": "my-custom-provider",
			"name": "My Custom Provider",
			"baseURL": "https://api.example.com/v1",
			"apiType": "openai-compatible",
			"defaultModel": "custom-model"
		}
	],
	"instructions": [".opencode/instructions/**/*.md", "docs/rules.md"]
}
```

## Usage

### Opening the Chat View

1. Click the bot icon in the ribbon to open the chat view
2. Or use the command palette: "Open chat view"

### Sending Messages

1. Type your message in the input area
2. Press Enter to send (Shift+Enter for new line)
3. View streaming responses in real-time

### Attaching Images

1. Click the 📎 button in the input area
2. Select an image file or drag and drop
3. The image will be saved into the vault. Forwarding image parts to OpenCode Server is currently planned.

### Managing Conversations

-   Click "New Chat" to start a new conversation
-   Use the conversation selector to switch between conversations
-   Each conversation persists locally; only one OpenCode session runs at a time

### Connection Status

-   Green dot: Connected to OpenCode Server
-   Red dot: Disconnected from OpenCode Server
-   The plugin automatically attempts to reconnect if the connection is lost
-   Event streaming runs in the background, so reconnect attempts do not block the UI

## Development

### Project Structure

```
opencode-obsidian/
├── src/
│   ├── main.ts                      # Main plugin entry point
│   ├── opencode-obsidian-view.ts    # Chat view component with incremental DOM updates
│   ├── settings.ts                  # Settings panel UI
│   ├── types.ts                     # TypeScript type definitions
│   ├── opencode-server/
│   │   ├── client.ts                # SDK client helper + Obsidian wrapper (OpenCodeServerClient)
│   │   ├── client.test.ts           # Client unit tests
│   │   └── types.ts                 # Protocol message definitions
│   ├── session/
│   │   ├── connection-manager.ts     # Centralized connection + reconnect lifecycle
│   │   ├── connection-manager.test.ts # ConnectionManager unit tests
│   │   └── session-event-bus.ts      # Domain event bus for streaming/session events
│   ├── tools/
│   │   └── obsidian/                # Obsidian tool system
│   │       ├── tool-executor.ts     # Tool execution with permissions
│   │       ├── tool-registry.ts     # Tool registration and routing
│   │       ├── permission-manager.ts # Permission management
│   │       ├── permission-modal.ts  # Permission request UI
│   │       ├── permission-types.ts  # Permission type definitions
│   │       ├── audit-logger.ts      # Audit logging for tool operations
│   │       └── types.ts             # Tool type definitions
│   ├── views/
│   │   ├── components/              # UI components
│   │   ├── modals/                  # Modal dialogs
│   │   └── services/                # Business logic services
│   └── utils/
│       ├── error-handler.ts         # Unified error handling system
│       ├── constants.ts             # Configuration constants
│       ├── debounce-throttle.ts     # Debounce/throttle utilities
│       └── data-helpers.ts          # Data processing utilities
├── docs/
│   ├── README.md                    # Documentation index
│   ├── architecture/                # Architecture documentation
│   ├── agents/                      # Agent documentation
│   ├── tools/                       # Tool documentation
│   ├── development/                 # Development documentation
│   └── analysis/                    # Analysis and improvement documentation
├── __mocks__/
│   └── obsidian.ts                  # Obsidian API mock for tests
├── styles.css                       # Styles (automatically loaded by Obsidian)
├── manifest.json                    # Plugin manifest
├── versions.json                    # Version compatibility mapping
├── package.json                     # Dependencies
├── tsconfig.json                    # TypeScript configuration
├── vitest.config.ts                 # Vitest test configuration
├── eslint.config.mts                # ESLint configuration
├── esbuild.config.mjs               # Build configuration
└── version-bump.mjs                 # Version management script
```

### Building

```bash
# Development build with watch mode
bun run dev

# Production build (includes TypeScript type checking)
bun run build
```

### Linting

This project uses [ESLint](https://eslint.org/) to analyze code and find problems, together with a custom [eslint-plugin-obsidianmd](https://github.com/obsidianmd/eslint-plugin-obsidianmd) for Obsidian-specific code guidelines.

```bash
# Run ESLint
bun run lint
```

A GitHub Action is preconfigured to automatically lint every commit on all branches.

### Testing

This project uses [Vitest](https://vitest.dev/) for unit testing. Core modules are tested including error handling and validation logic.

```bash
# Run tests once
bun vitest run

# Run tests in watch mode
bun vitest

# Run tests with UI (if installed)
bun vitest --ui
```

### Type Checking

```bash
# Run TypeScript type checking
bun run check
```

### Version Management

To bump the plugin version:

1. Update `minAppVersion` in `manifest.json` if needed
2. Run `npm version patch`, `npm version minor`, or `npm version major`
3. This will automatically:
    - Bump version in `manifest.json` and `package.json`
    - Add the entry for the new version to `versions.json`
    - Stage the version files for commit

## Troubleshooting

### Connection Issues

-   Ensure OpenCode Server is running and accessible
-   Check HTTP URL in settings (e.g., `http://127.0.0.1:4096`)
-   Verify firewall settings allow HTTP connections
-   Check OpenCode Server logs for connection errors

### Plugin not loading

-   Ensure all dependencies are installed: `bun install`
-   Rebuild the plugin: `bun run build`
-   Check Obsidian console for errors:
    -   **macOS**: Press `Cmd + Option + I` or `View → Toggle Developer Tools`
    -   **Windows/Linux**: Press `Ctrl + Shift + I` or `View → Toggle Developer Tools`

### Images not attaching

-   Ensure the vault has write permissions
-   Check that the `05_Attachments` folder exists (created automatically)
-   Verify image file size is under 10MB
-   Note: Sending images to OpenCode Server is currently not supported

### Configuration not loading

-   Verify `.opencode/config.json` or `opencode.json` exists and is valid JSON
-   Check file path - should be in vault root
-   Verify file size is under 1MB
-   Check Obsidian console for validation errors
-   Ensure YAML frontmatter in agent/skill files is valid (use js-yaml format)

### Performance issues

-   Check if too many instruction files are loaded (large files slow down startup)
-   Reduce instruction file sizes (max 10MB per file)
-   Limit number of conversations (sessions are cached with LRU, max 50)
-   Check if model fetching is throttled (2s minimum interval)

## Releasing new releases

1. Update your `manifest.json` with your new version number, such as `1.0.1`, and the minimum Obsidian version required for your latest release.
2. Update your `versions.json` file with `"new-plugin-version": "minimum-obsidian-version"` so older versions of Obsidian can download an older version of your plugin that's compatible.
3. Create new GitHub release using your new version number as the "Tag version". Use the exact version number, don't include a prefix `v`.
4. Upload the files `manifest.json`, `main.js`, `styles.css` as binary attachments. Note: The manifest.json file must be in two places, first the root path of your repository and also in the release.
5. Publish the release.

> You can simplify the version bump process by running `npm version patch`, `npm version minor` or `npm version major` after updating `minAppVersion` manually in `manifest.json`.
> The command will bump version in `manifest.json` and `package.json`, and add the entry for the new version to `versions.json`.

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `bun run build`, `bun run lint`, and `bun test` to ensure code quality
5. Test thoroughly
6. Update documentation if needed
7. Submit a pull request

### Code Quality Standards

-   Follow TypeScript best practices with strict typing
-   Add JSDoc comments for all public interfaces and methods
-   Write unit tests for new features (using Vitest)
-   Ensure all tests pass before submitting
-   Follow existing code style and patterns
-   Use the error handling system for consistent error reporting
-   Extract constants to `src/utils/constants.ts`

## Documentation

The documentation is organized into several categories for better navigation:

### Complete Documentation

See [docs/README.md](docs/README.md) for the complete documentation index with all available documentation files.

### Core Documentation

-   **[Architecture](docs/architecture/ARCHITECTURE.md)** - Detailed architecture design and decision records
-   **[Agents & Skills](docs/agents/AGENTS.md)** - User guide for creating and using custom agents
-   **[OpenCode Server Integration](docs/tools/OPENCODE-SERVER-PLUGIN.md)** - OpenCode Server integration documentation

### Development Documentation

-   **[Developer Guide](docs/development/developer-guide.md)** - Development setup and guidelines
-   **[Code Review Process](docs/development/CODE_REVIEW.md)** - Code review guidelines
-   **[Implementation Status](docs/development/IMPLEMENTATION_STATUS_VERIFICATION.md)** - Implementation status verification

### Analysis & Improvements

-   **[Feature Gap Analysis](docs/analysis/FEATURE_GAP_ANALYSIS.md)** - Detailed feature gap analysis
-   **[Improvements Remaining](docs/analysis/IMPROVEMENTS-REMAINING.md)** - List of planned improvements

### API Documentation

-   **ErrorHandler**: Unified error handling system (`src/utils/error-handler.ts`)
-   **OpenCodeServerClient**: SDK client helper and Obsidian wrapper for OpenCode Server (`src/opencode-server/client.ts`)
-   **ObsidianToolRegistry**: Tool registration and routing (`src/tools/obsidian/tool-registry.ts`)
-   **ObsidianToolExecutor**: Tool execution with permissions (`src/tools/obsidian/tool-executor.ts`)
-   **PermissionManager**: Permission management (`src/tools/obsidian/permission-manager.ts`)
-   **AuditLogger**: Audit logging for tool operations (`src/tools/obsidian/audit-logger.ts`)

All public interfaces and classes include comprehensive JSDoc comments. See source files for detailed API documentation.

For Obsidian plugin development, see https://docs.obsidian.md for more information.

## License

MIT - See LICENSE file for details

## Acknowledgments

-   Built for [OpenCode](https://opencode.ai)
-   Designed for [Obsidian](https://obsidian.md)
