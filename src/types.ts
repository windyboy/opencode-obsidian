/**
 * Compatible provider configuration
 * Represents a custom AI provider that is compatible with OpenAI or Anthropic APIs
 * 
 * @interface CompatibleProvider
 */
export interface CompatibleProvider {
  /** Unique identifier for the provider */
  id: string
  /** Display name for the provider */
  name: string
  /** API key for authentication (stored securely in Obsidian settings) */
  apiKey: string
  /** Base URL for the provider's API endpoint */
  baseURL: string
  /** API compatibility type - determines which API format to use */
  apiType: 'openai-compatible' | 'anthropic-compatible'
  /** Optional default model ID for this provider */
  defaultModel?: string
}

/**
 * Skill definition
 * Skills are reusable prompt components that can be referenced by agents
 * 
 * @interface Skill
 */
export interface Skill {
  /** Skill identifier - directory name from .opencode/skill/{id}/SKILL.md */
  id: string
  /** Display name for the skill - from frontmatter or derived from id */
  name: string
  /** Optional description from frontmatter */
  description?: string
  /** Markdown content after YAML frontmatter - the skill's prompt content */
  content: string
}

/**
 * Agent definition
 * Agents are AI assistant configurations with system prompts, model overrides, and tool configurations
 * Loaded from .opencode/agent/*.md files
 * 
 * @interface Agent
 */
export interface Agent {
  /** Agent identifier - filename without .md extension (e.g., "docs", "triage") */
  id: string
  /** Display name for the agent - from frontmatter or derived from id */
  name: string
  /** Optional description from frontmatter */
  description?: string
  /** System prompt content - Markdown content after YAML frontmatter */
  systemPrompt: string
  /** Optional agent-specific model override */
  model?: {
    /** Provider identifier (e.g., "anthropic", "openai") */
    providerID: string
    /** Model identifier (e.g., "claude-3-5-sonnet-20241022", "gpt-4") */
    modelID: string
  }
  /** Tool enablement configuration - map of tool IDs to enabled state (e.g., {"*": false, "github-triage": true}) */
  tools?: { [key: string]: boolean }
  /** Array of skill IDs referenced by this agent - skills will be merged into system prompt */
  skills?: string[]
  /** UI color in hex format (e.g., "#38A3EE") */
  color?: string
  /** Hide agent from UI if true */
  hidden?: boolean
  /** Agent mode identifier (e.g., "primary") */
  mode?: string
}

/**
 * Main plugin settings interface
 * Stores all user-configurable settings for the OpenCode Obsidian plugin
 * 
 * @interface OpenCodeObsidianSettings
 */
export interface OpenCodeObsidianSettings {
  /** @deprecated Legacy field for migration - will be converted to apiKeys */
  apiKey?: string
  /** Multi-provider API keys - keys are stored securely in Obsidian settings */
  apiKeys: {
    /** Anthropic (Claude) API key */
    anthropic?: string
    /** OpenAI (GPT) API key */
    openai?: string
    /** Google (Gemini) API key */
    google?: string
    /** ZenMux API key */
    zenmux?: string
    /** Dynamic provider keys for compatible providers */
    [key: string]: string | undefined
  }
  /** Compatible providers loaded from .opencode/config.json */
  compatibleProviders?: CompatibleProvider[]
  /** Provider-specific configuration options */
  providerOptions?: {
    /** ZenMux-specific options */
    zenmux?: {
      /** Custom baseURL for ZenMux API (defaults to https://zenmux.ai/api/v1) */
      baseURL?: string
    }
    /** Allow other provider options in the future */
    [key: string]: any
  }
  /** Default provider identifier - supports built-in and custom provider IDs */
  providerID: 'anthropic' | 'openai' | 'google' | 'zenmux' | string
  /** Default agent identifier */
  agent: string
  /** Default model configuration */
  model: {
    /** Provider identifier */
    providerID: string
    /** Model identifier */
    modelID: string
  }
  /** Loaded agents from .opencode/agent/*.md files */
  agents?: Agent[]
  /** Loaded skills from .opencode/skill/{skill-name}/SKILL.md files */
  skills?: Skill[]
  /** Instruction file paths or glob patterns - can be set via UI or loaded from config.json */
  instructions?: string[]
  
  /** Hook configuration - list of disabled hook IDs */
  disabledHooks?: string[]
  
  /** Context management configuration */
  contextManagement?: {
    /** Threshold for preemptive compaction (default: 0.85 = 85%) */
    preemptiveCompactionThreshold?: number
    /** Maximum context tokens allowed (default: 50000) */
    maxContextTokens?: number
    /** Enable token estimation (default: true) */
    enableTokenEstimation?: boolean
  }
  
  /** TODO management configuration */
  todoManagement?: {
    /** Enable TODO management (default: true) */
    enabled?: boolean
    /** Automatically continue after TODO completion (default: true) */
    autoContinue?: boolean
    /** Respect user interrupt requests (default: true) */
    respectUserInterrupt?: boolean
  }
  
  /** MCP (Model Context Protocol) server configuration */
  mcpServers?: {
    /** MCP server name to configuration mapping */
    [serverName: string]: {
      /** Whether the server is enabled */
      enabled: boolean
      /** Server-specific configuration */
      config: Record<string, unknown>
    }
  }
}

/**
 * Chat message in a conversation
 * 
 * @interface Message
 */
export interface Message {
  /** Unique message identifier */
  id: string
  /** Message role - either 'user' or 'assistant' */
  role: 'user' | 'assistant'
  /** Message content text */
  content: string
  /** Timestamp when message was created (milliseconds since epoch) */
  timestamp: number
  /** Optional image attachments */
  images?: ImageAttachment[]
}

/**
 * Image attachment for a message
 * 
 * @interface ImageAttachment
 */
export interface ImageAttachment {
  /** Base64-encoded image data */
  data: string
  /** MIME type of the image (e.g., "image/png", "image/jpeg") */
  mimeType: string
  /** Optional filename for the image */
  name?: string
}

/**
 * Conversation session
 * Represents a chat conversation with messages and metadata
 * 
 * @interface Conversation
 */
export interface Conversation {
  /** Unique conversation identifier */
  id: string
  /** Conversation title/name */
  title: string
  /** Array of messages in this conversation */
  messages: Message[]
  /** Timestamp when conversation was created (milliseconds since epoch) */
  createdAt: number
  /** Timestamp when conversation was last updated (milliseconds since epoch) */
  updatedAt: number
  /** Optional session ID for maintaining context with AI provider */
  sessionId?: string | null
  /** Path to image file pending to be sent with next message */
  pendingImagePath?: string
  /** Provider identifier for this conversation - supports built-in and custom provider IDs */
  providerID?: 'anthropic' | 'openai' | 'google' | 'zenmux' | string
}

/**
 * Tool use request from AI assistant
 * 
 * @interface ToolUse
 */
export interface ToolUse {
  /** Unique tool use identifier */
  id: string
  /** Tool name/identifier */
  name: string
  /** Tool input parameters (format depends on tool) */
  input: unknown
}

/**
 * Tool execution result
 * 
 * @interface ToolResult
 */
export interface ToolResult {
  /** Tool use identifier this result corresponds to */
  id: string
  /** Result content (text output from tool) */
  content: string
  /** Whether the tool execution resulted in an error */
  isError: boolean
}

/**
 * AI model information
 * 
 * @interface ModelInfo
 */
export interface ModelInfo {
  /** Model identifier (e.g., "claude-3-5-sonnet-20241022", "gpt-4") */
  id: string
  /** Optional display name for the model */
  name?: string
  /** Provider identifier - supports built-in and custom provider IDs */
  providerID: 'anthropic' | 'openai' | 'google' | 'zenmux' | string
}

// ServerEvent removed - no longer needed for embedded client

// Hook system types
export type { Hook, HookContext, HookResult } from './hooks/types'
export { HookEvent } from './hooks/types'