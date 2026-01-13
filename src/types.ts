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
  /** Default agent identifier */
  agent: string
  /** Loaded agents from .opencode/agent/*.md files (for display/selection) */
  agents?: Agent[]
  /** Loaded skills from .opencode/skill/{skill-name}/SKILL.md files (for reference) */
  skills?: Skill[]
  /** Instruction file paths or glob patterns (managed by OpenCode Server) */
  instructions?: string[]

  /** OpenCode Server configuration (for client/server architecture) */
  opencodeServer?: {
    /** HTTP URL for OpenCode Server (e.g., "http://127.0.0.1:4096" or "https://opencode.example.com") */
    url: string
    /** HTTP request timeout in milliseconds (0 = no timeout, default: 30000) */
    requestTimeoutMs?: number
    /** Whether to automatically reconnect on connection loss (default: true) */
    autoReconnect?: boolean
    /** Delay between reconnection attempts in milliseconds (default: 3000) */
    reconnectDelay?: number
    /** Maximum number of reconnection attempts (default: 10, 0 = unlimited) */
    reconnectMaxAttempts?: number
  }

  /** Tool permission level (default: 'read-only') */
  toolPermission?: 'read-only' | 'scoped-write' | 'full-write'

  /** Permission scope configuration */
  permissionScope?: {
    /** Allowed path patterns (glob patterns) */
    allowedPaths?: string[]
    /** Denied path patterns (glob patterns, checked first) */
    deniedPaths?: string[]
    /** Maximum file size in bytes */
    maxFileSize?: number
    /** Allowed file extensions (e.g., ['.md', '.txt']) */
    allowedExtensions?: string[]
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
  providerID?: string
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
  providerID: string
}
