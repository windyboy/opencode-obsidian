export interface OpenCodeObsidianSettings {
  // Legacy field for migration - will be converted to apiKeys
  apiKey?: string
  // New multi-provider API keys
  apiKeys: {
    anthropic?: string
    openai?: string
    google?: string
    zenmux?: string
  }
  // Provider-specific configuration options
  providerOptions?: {
    zenmux?: {
      baseURL?: string // Custom baseURL for ZenMux API (defaults to https://zenmux.ai/api/v1)
    }
    [key: string]: any // Allow other provider options in the future
  }
  providerID: 'anthropic' | 'openai' | 'google' | 'zenmux' // Default provider
  agent: string
  model: {
    providerID: string
    modelID: string
  }
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
  providerID?: 'anthropic' | 'openai' | 'google' | 'zenmux' // Provider for this conversation
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
  providerID: 'anthropic' | 'openai' | 'google' | 'zenmux'
}

// ServerEvent removed - no longer needed for embedded client
