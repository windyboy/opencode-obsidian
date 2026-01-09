# OpenCode Obsidian

AI-powered chat interface for Obsidian with support for multiple AI providers (Anthropic Claude, OpenAI GPT, Google Gemini).

## What is this?

OpenCode Obsidian is an Obsidian plugin that provides a chat interface to interact with AI models, enabling you to:

-   Chat with AI directly from Obsidian
-   Support for multiple AI providers (Anthropic, OpenAI, Google)
-   Send prompts and receive streaming responses
-   Attach images to conversations
-   Manage multiple conversation sessions
-   Configure different AI models and agents

## Features

-   **Chat Interface**: Clean, intuitive chat UI integrated into Obsidian
-   **Real-time Streaming**: See AI responses stream in real-time
-   **Image Support**: Attach images to your conversations
-   **Multiple Sessions**: Manage multiple conversation sessions
-   **Multi-Provider Support**: Choose from Anthropic Claude, OpenAI GPT, or Google Gemini
-   **Model Selection**: Choose from different AI models for each provider
-   **Agent Configuration**: Switch between different agent profiles
-   **Settings Panel**: Configure API keys, providers, and default settings

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
    pnpm install
    ```

3. Build the plugin:

    ```bash
    pnpm build
    ```

4. For development with hot reload:

    ```bash
    pnpm dev
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
-   **API Key**: An API key from one of the supported providers:
    -   Anthropic: Get your API key from [console.anthropic.com](https://console.anthropic.com)
    -   OpenAI: Get your API key from [platform.openai.com](https://platform.openai.com)
    -   Google: Get your API key from [makersuite.google.com](https://makersuite.google.com)

## Configuration

### Initial Setup

1. Open Obsidian Settings
2. Go to Community Plugins
3. Enable "OpenCode Obsidian"
4. Open the plugin settings
5. Enter your API Key
6. Select your preferred AI Provider
7. Choose a model

### Settings

Configure the following settings in the plugin settings panel:

-   **API Key**: Your AI provider API key (stored securely)
-   **AI Provider**: Choose from Anthropic (Claude), OpenAI (GPT), or Google (Gemini)
-   **Model ID**: The specific model to use (e.g., `claude-3-5-sonnet-20241022`, `gpt-4`, `gemini-pro`)
-   **Default Agent**: The default agent/system prompt to use for conversations
    -   Assistant
    -   Bootstrap
    -   Thinking Partner
    -   Research Assistant
    -   Read Only

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
3. The image will be attached to your next message

### Managing Conversations

-   Click "New Chat" to start a new conversation
-   Use the conversation selector to switch between conversations
-   Each conversation maintains its own session and context

### Connection Status

-   Green dot: Client initialized and ready
-   The embedded client is always ready once API key is configured

## Development

### Project Structure

```
opencode-obsidian/
├── src/
│   ├── main.ts                      # Main plugin file
│   ├── opencode-obsidian-view.ts    # Chat view component
│   ├── embedded-ai-client.ts        # Embedded AI client (multi-provider support)
│   ├── settings.ts                  # Settings panel
│   └── types.ts                     # TypeScript types
├── styles.css                       # Styles (automatically loaded by Obsidian)
├── manifest.json                    # Plugin manifest
├── versions.json                    # Version compatibility mapping
├── package.json                     # Dependencies
├── tsconfig.json                    # TypeScript configuration
├── eslint.config.mts                # ESLint configuration
├── esbuild.config.mjs               # Build configuration
└── version-bump.mjs                 # Version management script
```

### Building

```bash
# Development build with watch mode
pnpm dev

# Production build (includes TypeScript type checking)
pnpm build
```

### Linting

This project uses [ESLint](https://eslint.org/) to analyze code and find problems, together with a custom [eslint-plugin-obsidianmd](https://github.com/obsidianmd/eslint-plugin-obsidianmd) for Obsidian-specific code guidelines.

```bash
# Run ESLint
pnpm lint
```

A GitHub Action is preconfigured to automatically lint every commit on all branches.

### Version Management

To bump the plugin version:

1. Update `minAppVersion` in `manifest.json` if needed
2. Run `npm version patch`, `npm version minor`, or `npm version major`
3. This will automatically:
    - Bump version in `manifest.json` and `package.json`
    - Add the entry for the new version to `versions.json`
    - Stage the version files for commit

## Troubleshooting

### API Key Issues

-   Ensure your API key is correct and has sufficient credits/quota
-   Check that the API key matches the selected provider
-   Verify the API key is entered correctly in settings (no extra spaces)

### Connection Issues

-   Check your internet connection
-   Verify the API key is valid for the selected provider
-   Check provider status pages for service outages

### Plugin not loading

-   Ensure all dependencies are installed: `pnpm install`
-   Rebuild the plugin: `pnpm build`
-   Check Obsidian console for errors:
    -   **macOS**: Press `Cmd + Option + I` or `View → Toggle Developer Tools`
    -   **Windows/Linux**: Press `Ctrl + Shift + I` or `View → Toggle Developer Tools`

### Images not attaching

-   Ensure the vault has write permissions
-   Check that the `05_Attachments` folder exists (created automatically)
-   Verify image file size is under 10MB

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
4. Run `pnpm build` and `pnpm lint` to ensure code quality
5. Test thoroughly
6. Submit a pull request

## API Documentation

See https://docs.obsidian.md for more information on developing plugins.

## License

MIT - See LICENSE file for details

## Acknowledgments

-   Built for [OpenCode](https://opencode.ai)
-   Designed for [Obsidian](https://obsidian.md)
