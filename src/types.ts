export interface CompatibleProvider {
  id: string
  name: string
  apiKey: string
  baseURL: string
  apiType: 'openai-compatible' | 'anthropic-compatible'
  defaultModel?: string
}

export interface Agent {
  id: string // Filename without .md extension (e.g., "docs", "triage")
  name: string // Display name (from frontmatter or derived from id)
  description?: string // From frontmatter
  systemPrompt: string // Markdown content after frontmatter
  model?: {
    // Agent-specific model override
    providerID: string
    modelID: string
  }
  tools?: { [key: string]: boolean } // Tool enablement config (e.g., {"*": false, "github-triage": true})
  color?: string // UI color (e.g., "#38A3EE")
  hidden?: boolean // Hide from UI if true
  mode?: string // e.g., "primary"
}

export interface OpenCodeObsidianSettings {
  // Legacy field for migration - will be converted to apiKeys
  apiKey?: string
  // New multi-provider API keys
  apiKeys: {
    anthropic?: string
    openai?: string
    google?: string
    zenmux?: string
    [key: string]: string | undefined // Allow dynamic provider keys for compatible providers
  }
  // Compatible providers loaded from .opencode/config.json
  compatibleProviders?: CompatibleProvider[]
  // Provider-specific configuration options
  providerOptions?: {
    zenmux?: {
      baseURL?: string // Custom baseURL for ZenMux API (defaults to https://zenmux.ai/api/v1)
    }
    [key: string]: any // Allow other provider options in the future
  }
  providerID: 'anthropic' | 'openai' | 'google' | 'zenmux' | string // Default provider (string to support custom provider IDs)
  agent: string
  model: {
    providerID: string
    modelID: string
  }
  agents?: Agent[] // Loaded agents from .opencode/agent/*.md
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  images?: ImageAttachment[]
}

export interface ImageAttachment {
  data: string
  mimeType: string
  name?: string
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  sessionId?: string | null
  pendingImagePath?: string // Path to image file pending to be sent
  providerID?: 'anthropic' | 'openai' | 'google' | 'zenmux' | string // Provider for this conversation (string to support custom provider IDs)
}

export interface ToolUse {
  id: string
  name: string
  input: unknown
}

export interface ToolResult {
  id: string
  content: string
  isError: boolean
}

export interface ModelInfo {
  id: string
  name?: string
  providerID: 'anthropic' | 'openai' | 'google' | 'zenmux' | string // Support custom provider IDs
}

// ServerEvent removed - no longer needed for embedded client
