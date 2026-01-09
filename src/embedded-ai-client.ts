import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import https from 'https'
import { URL } from 'url'
import { CONTEXT_CONFIG, SESSION_CONFIG } from './utils/constants'
import { ErrorHandler, ErrorSeverity } from './utils/error-handler'

/**
 * Type definitions for Anthropic SDK stream events
 * These types represent the structure of events from Anthropic's messages.stream() API
 */
export namespace AnthropicEventTypes {
  export interface ContentBlockBase {
    type: string
    id?: string
  }

  export interface ToolUseBlock extends ContentBlockBase {
    type: 'tool_use'
    id: string
    name: string
    input: Record<string, unknown>
  }

  export interface ThinkingBlock extends ContentBlockBase {
    type: 'thinking'
    thinking: string
  }

  export interface TextBlock extends ContentBlockBase {
    type: 'text'
    text: string
  }

  export type ContentBlock = ToolUseBlock | ThinkingBlock | TextBlock

  export interface ContentBlockStartEvent {
    type: 'content_block_start'
    index: number
    content_block: ContentBlock
  }

  export interface TextDelta {
    type: 'text_delta'
    text: string
  }

  export interface InputJsonDelta {
    type: 'input_json_delta'
    partial_json: string
  }

  export type Delta = TextDelta | InputJsonDelta

  export interface ContentBlockDeltaEvent {
    type: 'content_block_delta'
    index: number
    delta: Delta
  }

  export interface ContentBlockStopEvent {
    type: 'content_block_stop'
    index: number
    content_block: ContentBlock
  }

  export interface MessageUsage {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }

  export interface MessageStopEvent {
    type: 'message_stop'
    message: {
      id: string
      type: 'message'
      role: 'assistant'
      content: ContentBlock[]
      model: string
      stop_reason: string | null
      stop_sequence: string | null
      usage: MessageUsage
    }
  }

  export type StreamEvent = 
    | ContentBlockStartEvent 
    | ContentBlockDeltaEvent 
    | ContentBlockStopEvent 
    | MessageStopEvent

  /**
   * Type guard to check if event is a ContentBlockStartEvent
   */
  export function isContentBlockStart(event: unknown): event is ContentBlockStartEvent {
    return (
      typeof event === 'object' &&
      event !== null &&
      'type' in event &&
      event.type === 'content_block_start' &&
      'content_block' in event
    )
  }

  /**
   * Type guard to check if event is a ContentBlockDeltaEvent
   */
  export function isContentBlockDelta(event: unknown): event is ContentBlockDeltaEvent {
    return (
      typeof event === 'object' &&
      event !== null &&
      'type' in event &&
      event.type === 'content_block_delta' &&
      'delta' in event
    )
  }

  /**
   * Type guard to check if event is a ContentBlockStopEvent
   */
  export function isContentBlockStop(event: unknown): event is ContentBlockStopEvent {
    return (
      typeof event === 'object' &&
      event !== null &&
      'type' in event &&
      event.type === 'content_block_stop' &&
      'content_block' in event
    )
  }

  /**
   * Type guard to check if event is a MessageStopEvent
   */
  export function isMessageStop(event: unknown): event is MessageStopEvent {
    return (
      typeof event === 'object' &&
      event !== null &&
      'type' in event &&
      event.type === 'message_stop' &&
      'message' in event
    )
  }

  /**
   * Type guard to check if content block is a ToolUseBlock
   */
  export function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
    return block.type === 'tool_use' && 'id' in block && 'name' in block
  }

  /**
   * Type guard to check if content block is a ThinkingBlock
   */
  export function isThinkingBlock(block: ContentBlock): block is ThinkingBlock {
    return block.type === 'thinking' && 'thinking' in block
  }

  /**
   * Type guard to check if delta is a TextDelta
   */
  export function isTextDelta(delta: Delta): delta is TextDelta {
    return delta.type === 'text_delta' && 'text' in delta
  }

  /**
   * Type guard to check if delta is an InputJsonDelta
   */
  export function isInputJsonDelta(delta: Delta): delta is InputJsonDelta {
    return delta.type === 'input_json_delta' && 'partial_json' in delta
  }
}

export interface ResponseChunk {
  type: 'text' | 'usage' | 'error' | 'done' | 'session_init' | 'thinking' | 'tool_use' | 'tool_result' | 'blocked'
  content?: string
  sessionId?: string
  usage?: {
    model: string
    inputTokens: number
    cacheCreationInputTokens?: number
    cacheReadInputTokens?: number
    contextWindow?: number
    contextTokens?: number
    percentage?: number
  }
  parentToolUseId?: string | null
  id?: string
  name?: string
  input?: unknown
  isError?: boolean
}

/**
 * Built-in provider types
 */
export type BuiltInProviderType = 'anthropic' | 'openai' | 'google' | 'zenmux'

/**
 * Provider type that includes built-in and compatible providers
 */
export type ProviderType = BuiltInProviderType | 'compatible'

/**
 * API type for compatible providers
 */
export type CompatibleApiType = 'openai-compatible' | 'anthropic-compatible'

/**
 * Configuration for compatible providers (custom/third-party providers)
 */
export interface CompatibleProviderConfig {
  id: string
  name: string
  baseURL: string
  apiType: CompatibleApiType
  defaultModel?: string
}

/**
 * Unified provider configuration interface
 */
export interface EmbeddedAIClientConfig {
  apiKey: string
  provider: ProviderType
  model?: string
  baseURL?: string // For custom API endpoints like ZenMux or compatible providers
  apiType?: CompatibleApiType // For compatible providers
  providerId?: string // For compatible providers (original provider ID from config)
  providerName?: string // For compatible providers (display name)
}

export interface EmbeddedSession {
  id: string
  messages: Array<{
    role: 'user' | 'assistant' | 'system'
    content: string | Array<{ 
      type: string
      text?: string
      image_url?: { url: string }
      // Tool use content (for Anthropic)
      tool_use_id?: string
      name?: string
      input?: any
      // Tool result content
      tool_result_id?: string
      tool_result?: string
      is_error?: boolean
    }>
  }>
  createdAt: number
  updatedAt: number
}

export class EmbeddedAIClient {
  private anthropicClient: Anthropic | null = null
  private openaiClient: OpenAI | null = null
  private zenmuxClient: OpenAI | null = null
  private googleClient: GoogleGenerativeAI | null = null
  private config: EmbeddedAIClientConfig
  private sessions: Map<string, EmbeddedSession> = new Map()
  private sessionAccessOrder: string[] = [] // LRU order tracking
  private currentSessionId: string | null = null
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
  private maxSessions: number = SESSION_CONFIG.MAX_SESSIONS
  private errorHandler: ErrorHandler

  constructor(config: EmbeddedAIClientConfig, errorHandler?: ErrorHandler) {
    this.config = config
    this.errorHandler = errorHandler || new ErrorHandler()
    this.initializeClient()
    this.startCleanupTimer()
  }

  private initializeClient() {
    switch (this.config.provider) {
      case 'anthropic':
        this.anthropicClient = new Anthropic({
          apiKey: this.config.apiKey,
        })
        break
      case 'openai':
        this.openaiClient = new OpenAI({
          apiKey: this.config.apiKey,
          dangerouslyAllowBrowser: true, // Required for Obsidian/Electron environment
        })
        break
      case 'zenmux':
        // ZenMux uses OpenAI-compatible API with custom baseURL
        this.zenmuxClient = new OpenAI({
          apiKey: this.config.apiKey,
          baseURL: this.config.baseURL || 'https://zenmux.ai/api/v1',
          dangerouslyAllowBrowser: true, // Required for Obsidian/Electron environment
        })
        break
      case 'google':
        this.googleClient = new GoogleGenerativeAI(this.config.apiKey)
        break
      case 'compatible':
        // Handle compatible providers based on apiType
        if (!this.config.apiType) {
          throw new Error('Compatible provider requires apiType to be specified')
        }
        if (this.config.apiType === 'openai-compatible') {
          this.openaiClient = new OpenAI({
            apiKey: this.config.apiKey,
            baseURL: this.config.baseURL,
            dangerouslyAllowBrowser: true,
          })
        } else if (this.config.apiType === 'anthropic-compatible') {
          // Note: Anthropic SDK may not support baseURL directly
          // This is a limitation - compatible providers using Anthropic API may need special handling
          this.anthropicClient = new Anthropic({
            apiKey: this.config.apiKey,
            // baseURL: this.config.baseURL, // Uncomment if Anthropic SDK supports this in future
          })
          this.errorHandler.handleError(
            new Error('Anthropic-compatible provider initialized, but baseURL support may be limited'),
            {
              module: 'EmbeddedAIClient',
              function: 'initializeClient',
              operation: 'Initializing Anthropic-compatible provider',
              metadata: {
                providerName: this.config.providerName,
                providerId: this.config.providerId
              }
            },
            ErrorSeverity.Warning
          )
        }
        break
    }
  }

  get isConnected(): boolean {
    return true // Always connected in embedded mode
  }

  createSession(): string {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const session: EmbeddedSession = {
      id: sessionId,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    
    // Enforce LRU limit by removing least recently used sessions
    this.enforceLRULimit()
    
    this.sessions.set(sessionId, session)
    this.updateAccessOrder(sessionId)
    this.currentSessionId = sessionId
    return sessionId
  }

  /**
   * Update access order for LRU tracking
   */
  private updateAccessOrder(sessionId: string): void {
    // Remove from current position if exists
    const index = this.sessionAccessOrder.indexOf(sessionId)
    if (index > -1) {
      this.sessionAccessOrder.splice(index, 1)
    }
    // Add to end (most recently used)
    this.sessionAccessOrder.push(sessionId)
  }

  /**
   * Enforce LRU limit by removing least recently used sessions
   */
  private enforceLRULimit(): void {
    while (this.sessions.size >= this.maxSessions) {
      if (this.sessionAccessOrder.length === 0) {
        // Fallback: remove oldest session by timestamp
        let oldestId: string | null = null
        let oldestTime = Infinity
        for (const [id, session] of this.sessions.entries()) {
          if (session.updatedAt < oldestTime) {
            oldestTime = session.updatedAt
            oldestId = id
          }
        }
        if (oldestId) {
          this.sessions.delete(oldestId)
          const index = this.sessionAccessOrder.indexOf(oldestId)
          if (index > -1) {
            this.sessionAccessOrder.splice(index, 1)
          }
        } else {
          break
        }
      } else {
        // Remove least recently used (first in access order)
        const lruId = this.sessionAccessOrder.shift()
        if (lruId) {
          this.sessions.delete(lruId)
        } else {
          break
        }
      }
    }
  }

  /**
   * Start periodic cleanup timer for inactive sessions
   */
  private startCleanupTimer(): void {
    // Clean up every CLEANUP_INTERVAL
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveSessions()
    }, SESSION_CONFIG.CLEANUP_INTERVAL)
  }

  /**
   * Stop cleanup timer
   */
  private stopCleanupTimer(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  /**
   * Clean up inactive sessions (not accessed for IDLE_TIMEOUT)
   */
  private cleanupInactiveSessions(): void {
    const now = Date.now()
    const idleThreshold = now - SESSION_CONFIG.IDLE_TIMEOUT
    
    const sessionsToRemove: string[] = []
    
    for (const [id, session] of this.sessions.entries()) {
      // Skip current session
      if (id === this.currentSessionId) {
        continue
      }
      
      // Remove if inactive
      if (session.updatedAt < idleThreshold) {
        sessionsToRemove.push(id)
      }
    }
    
    // Remove inactive sessions
    for (const id of sessionsToRemove) {
      this.sessions.delete(id)
      const index = this.sessionAccessOrder.indexOf(id)
      if (index > -1) {
        this.sessionAccessOrder.splice(index, 1)
      }
    }
    
    if (sessionsToRemove.length > 0) {
      console.log(`[EmbeddedAIClient] Cleaned up ${sessionsToRemove.length} inactive session(s)`)
    }
  }

  async *sendPrompt(
    prompt: string | Array<{ type: string; text?: string; filePath?: string; [key: string]: unknown }>,
    options: {
      sessionId?: string
      model?: { providerID: string; modelID: string }
      agent?: string
      system?: string
      tools?: { [key: string]: boolean }
      cwd?: string
      abortController?: AbortController
    } = {}
  ): AsyncGenerator<ResponseChunk> {
    const sessionId = options.sessionId || this.currentSessionId || this.createSession()
    let session = this.sessions.get(sessionId)
    
    if (!session) {
      session = {
        id: sessionId,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      // Enforce LRU limit before adding new session
      this.enforceLRULimit()
      this.sessions.set(sessionId, session)
      this.updateAccessOrder(sessionId)
      this.currentSessionId = sessionId
    } else {
      // Update access order for existing session
      this.updateAccessOrder(sessionId)
    }

    // Yield session init
    yield {
      type: 'session_init',
      sessionId,
    }

    try {
      // Convert prompt to messages format
      let userContent: string | Array<any>
      if (typeof prompt === 'string') {
        userContent = prompt
      } else {
        // Handle multi-modal input
        userContent = prompt.map(item => {
          if (item.type === 'text' && item.text) {
            return { type: 'text', text: item.text }
          } else if (item.type === 'image' && 'filePath' in item) {
            // For now, convert image to text description
            // TODO: Implement proper image handling
            return { type: 'text', text: `[Image: ${item.filePath}]` }
          }
          return null
        }).filter(Boolean) as Array<any>
      }

      // Add user message to session
      session.messages.push({
        role: 'user',
        content: typeof userContent === 'string' ? userContent : userContent.map((c: any) => c.text || '').join(' '),
      })

      const model = options.model?.modelID || this.config.model || this.getDefaultModel()
      const systemPrompt = options.system || options.agent || ''
      const tools = options.tools

      // Send request based on provider
      if (this.config.provider === 'anthropic' && this.anthropicClient) {
        yield* this.sendAnthropicRequest(session, model, systemPrompt, options.abortController, tools)
      } else if (this.config.provider === 'openai' && this.openaiClient) {
        yield* this.sendOpenAIRequest(session, model, systemPrompt, options.abortController, tools)
      } else if (this.config.provider === 'zenmux' && this.zenmuxClient) {
        yield* this.sendZenMuxRequest(session, model, systemPrompt, options.abortController, tools)
      } else if (this.config.provider === 'google' && this.googleClient) {
        yield* this.sendGoogleRequest(session, model, systemPrompt, options.abortController, tools)
      } else if (this.config.provider === 'compatible') {
        // Handle compatible providers based on apiType
        if (this.config.apiType === 'openai-compatible' && this.openaiClient) {
          yield* this.sendOpenAIRequest(session, model, systemPrompt, options.abortController, tools)
        } else if (this.config.apiType === 'anthropic-compatible' && this.anthropicClient) {
          yield* this.sendAnthropicRequest(session, model, systemPrompt, options.abortController, tools)
        } else {
          yield {
            type: 'error',
            content: `Compatible provider ${this.config.providerName || this.config.providerId || 'unknown'} not properly initialized (apiType: ${this.config.apiType})`,
          }
          return
        }
      } else {
        yield {
          type: 'error',
          content: `Provider ${this.config.provider} not properly initialized`,
        }
        return
      }

      session.updatedAt = Date.now()
      // Update access order after session update
      this.updateAccessOrder(session.id)
      yield { type: 'done' }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      this.errorHandler.handleError(error, {
        module: 'EmbeddedAIClient',
        function: 'sendPrompt',
        operation: 'Sending prompt',
        metadata: {
          provider: this.config.provider,
          providerId: this.config.providerId,
          hasSession: !!session
        }
      }, ErrorSeverity.Error)
      yield {
        type: 'error',
        content: errorMessage,
      }
    }
  }

  /**
   * Handle content_block_start events (tool_use, thinking)
   * Returns chunks to yield and updated state
   */
  private handleContentBlockStart(
    event: AnthropicEventTypes.ContentBlockStartEvent,
    session: EmbeddedSession,
    currentToolUse: { id: string; name: string; input: Record<string, unknown> } | null,
    toolInputAccumulator: string
  ): { chunks: ResponseChunk[]; toolUse: { id: string; name: string; input: Record<string, unknown> } | null; accumulator: string } {
    const block = event.content_block
    const chunks: ResponseChunk[] = []
    
    if (AnthropicEventTypes.isToolUseBlock(block)) {
      const newToolUse = {
        id: block.id,
        name: block.name,
        input: {} as Record<string, unknown>
      }
      
      chunks.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: {},
        sessionId: session.id,
      })
      
      return { chunks, toolUse: newToolUse, accumulator: '' }
    } else if (AnthropicEventTypes.isThinkingBlock(block)) {
      chunks.push({
        type: 'thinking',
        content: block.thinking || '',
        sessionId: session.id,
      })
    }
    
    return { chunks, toolUse: currentToolUse, accumulator: toolInputAccumulator }
  }

  /**
   * Handle content_block_delta events (text_delta, input_json_delta)
   * Returns chunks to yield and updated state
   */
  private handleContentBlockDelta(
    event: AnthropicEventTypes.ContentBlockDeltaEvent,
    session: EmbeddedSession,
    currentToolUse: { id: string; name: string; input: Record<string, unknown> } | null,
    toolInputAccumulator: string,
    fullResponse: string
  ): { chunks: ResponseChunk[]; toolUse: { id: string; name: string; input: Record<string, unknown> } | null; accumulator: string; response: string } {
    const delta = event.delta
    const chunks: ResponseChunk[] = []
    
    if (currentToolUse && AnthropicEventTypes.isInputJsonDelta(delta)) {
      toolInputAccumulator += delta.partial_json || ''
      try {
        // Try to parse accumulated JSON
        currentToolUse.input = JSON.parse(toolInputAccumulator)
      } catch {
        // JSON might be incomplete, keep accumulating
      }
      
      chunks.push({
        type: 'tool_use',
        id: currentToolUse.id,
        name: currentToolUse.name,
        input: currentToolUse.input,
        sessionId: session.id,
      })
    } else if (AnthropicEventTypes.isTextDelta(delta)) {
      // Regular text delta
      const text = delta.text
      fullResponse += text
      chunks.push({
        type: 'text',
        content: text,
        sessionId: session.id,
      })
    }
    
    return { chunks, toolUse: currentToolUse, accumulator: toolInputAccumulator, response: fullResponse }
  }

  /**
   * Handle content_block_stop events for tool_use
   * Returns chunks to yield and updated state
   */
  private handleContentBlockStop(
    event: AnthropicEventTypes.ContentBlockStopEvent,
    session: EmbeddedSession,
    currentToolUse: { id: string; name: string; input: Record<string, unknown> } | null,
    toolInputAccumulator: string
  ): { chunks: ResponseChunk[]; toolUse: { id: string; name: string; input: Record<string, unknown> } | null; accumulator: string } {
    const block = event.content_block
    const chunks: ResponseChunk[] = []
    
    if (!currentToolUse || !AnthropicEventTypes.isToolUseBlock(block)) {
      return { chunks, toolUse: currentToolUse, accumulator: toolInputAccumulator }
    }
    
    // Try to parse final input
    try {
      if (toolInputAccumulator) {
        currentToolUse.input = JSON.parse(toolInputAccumulator)
      }
    } catch (error) {
      this.errorHandler.handleError(error, {
        module: 'EmbeddedAIClient',
        function: 'handleContentBlockStop',
        operation: 'Parsing tool input',
        metadata: { toolInputAccumulator }
      }, ErrorSeverity.Warning)
    }
    
    // Execute tool (placeholder implementation)
    // TODO: Implement actual tool execution system
    const toolResult = {
      content: `Tool "${currentToolUse.name}" executed with input: ${JSON.stringify(currentToolUse.input)}`,
      isError: false
    }
    
    chunks.push({
      type: 'tool_result',
      id: currentToolUse.id,
      content: toolResult.content,
      isError: toolResult.isError,
      sessionId: session.id,
    })
    
    // Add tool result to session as user message (for Anthropic format)
    session.messages.push({
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_result_id: currentToolUse.id,
        tool_result: toolResult.content,
        is_error: toolResult.isError
      }]
    })
    
    return { chunks, toolUse: null, accumulator: '' }
  }

  /**
   * Handle message_stop events
   * Returns chunks to yield
   */
  private handleMessageStop(
    event: AnthropicEventTypes.MessageStopEvent,
    session: EmbeddedSession,
    model: string,
    fullResponse: string
  ): ResponseChunk[] {
    const chunks: ResponseChunk[] = []
    
    // Save assistant response to session
    // For Anthropic, the message content can include tool uses
    // We'll save the full response as text for now, but the structure supports tool content
    session.messages.push({
      role: 'assistant',
      content: fullResponse,
    })

    // Yield usage info if available
    if (event.message?.usage) {
      chunks.push({
        type: 'usage',
        sessionId: session.id,
        usage: {
          model: `${this.config.provider}:${model}`,
          inputTokens: event.message.usage.input_tokens,
          contextTokens: event.message.usage.input_tokens,
          cacheCreationInputTokens: event.message.usage.cache_creation_input_tokens,
          cacheReadInputTokens: event.message.usage.cache_read_input_tokens,
        },
      })
    }
    
    return chunks
  }

  private async *sendAnthropicRequest(
    session: EmbeddedSession,
    model: string,
    systemPrompt: string,
    abortController?: AbortController,
    tools?: { [key: string]: boolean }
  ): AsyncGenerator<ResponseChunk> {
    if (!this.anthropicClient) return

    const messages = session.messages
      .filter(msg => msg.role !== 'system')
      .map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      }))

    // Convert tools config to Anthropic tools format
    // For now, use empty array as placeholder - actual tool definitions will be added later
    const anthropicTools: any[] = []
    // TODO: When tool registry is implemented, convert tools config to actual tool definitions
    // if (tools) {
    //   const toolRegistry = this.getToolRegistry()
    //   anthropicTools = toolRegistry.toAnthropicTools(tools)
    // }

    try {
      const stream = await this.anthropicClient.messages.stream({
        model: model,
        max_tokens: CONTEXT_CONFIG.DEFAULT_MAX_TOKENS_PER_REQUEST,
        system: systemPrompt || undefined,
        messages: messages,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
      }, {
        signal: abortController?.signal,
      })

      let fullResponse = ''
      let currentToolUse: { id: string; name: string; input: Record<string, unknown> } | null = null
      let toolInputAccumulator: string = ''
      
      for await (const event of stream) {
        if (abortController?.signal.aborted) {
          yield { type: 'done' }
          return
        }

        // Handle content_block_start events (tool_use, thinking)
        if (AnthropicEventTypes.isContentBlockStart(event)) {
          const startResult = this.handleContentBlockStart(event, session, currentToolUse, toolInputAccumulator)
          for (const chunk of startResult.chunks) {
            yield chunk
          }
          currentToolUse = startResult.toolUse
          toolInputAccumulator = startResult.accumulator
        }

        // Handle content_block_delta for tool_use input
        if (AnthropicEventTypes.isContentBlockDelta(event)) {
          const deltaResult = this.handleContentBlockDelta(event, session, currentToolUse, toolInputAccumulator, fullResponse)
          for (const chunk of deltaResult.chunks) {
            yield chunk
          }
          currentToolUse = deltaResult.toolUse
          toolInputAccumulator = deltaResult.accumulator
          fullResponse = deltaResult.response
        }

        // Handle content_block_stop for tool_use
        if (AnthropicEventTypes.isContentBlockStop(event)) {
          const stopResult = this.handleContentBlockStop(event, session, currentToolUse, toolInputAccumulator)
          for (const chunk of stopResult.chunks) {
            yield chunk
          }
          currentToolUse = stopResult.toolUse
          toolInputAccumulator = stopResult.accumulator
        }

        // Handle message_stop
        if (AnthropicEventTypes.isMessageStop(event)) {
          const stopChunks = this.handleMessageStop(event, session, model, fullResponse)
          for (const chunk of stopChunks) {
            yield chunk
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        yield { type: 'done' }
      } else {
        throw error
      }
    }
  }

  private async *sendOpenAIRequest(
    session: EmbeddedSession,
    model: string,
    systemPrompt: string,
    abortController?: AbortController,
    tools?: { [key: string]: boolean }
  ): AsyncGenerator<ResponseChunk> {
    if (!this.openaiClient) return

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
    
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    for (const msg of session.messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({
          role: msg.role,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        })
      }
    }

    // Convert tools config to OpenAI tools format
    // For now, use empty array as placeholder - actual tool definitions will be added later
    const openaiTools: any[] = []
    // TODO: When tool registry is implemented, convert tools config to actual tool definitions
    // if (tools) {
    //   const toolRegistry = this.getToolRegistry()
    //   openaiTools = toolRegistry.toOpenAITools(tools)
    // }

    try {
      const stream = await this.openaiClient.chat.completions.create({
        model: model,
        messages: messages as any,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        stream: true,
      }, {
        signal: abortController?.signal,
      })

      let fullResponse = ''
      const toolCalls: Map<string, { id: string; name: string; arguments: string }> = new Map()
      
      for await (const chunk of stream) {
        if (abortController?.signal.aborted) {
          yield { type: 'done' }
          return
        }

        const delta = chunk.choices[0]?.delta
        
        // Handle text content
        const content = delta?.content
        if (content) {
          fullResponse += content
          yield {
            type: 'text',
            content: content,
            sessionId: session.id,
          }
        }

        // Handle tool calls
        if (delta?.tool_calls) {
          for (const toolCallDelta of delta.tool_calls) {
            const toolCallId = toolCallDelta.id
            if (!toolCallId) continue

            if (!toolCalls.has(toolCallId)) {
              toolCalls.set(toolCallId, {
                id: toolCallId,
                name: toolCallDelta.function?.name || '',
                arguments: toolCallDelta.function?.arguments || ''
              })
              
              // Yield tool_use event when tool call starts
              yield {
                type: 'tool_use',
                id: toolCallId,
                name: toolCallDelta.function?.name || 'unknown',
                input: {},
                sessionId: session.id,
              }
            } else {
              // Accumulate function arguments
              const toolCall = toolCalls.get(toolCallId)!
              toolCall.arguments += toolCallDelta.function?.arguments || ''
              
              // Try to parse arguments
              let parsedInput: any = {}
              try {
                if (toolCall.arguments) {
                  parsedInput = JSON.parse(toolCall.arguments)
                }
              } catch {
                // Arguments might be incomplete, keep accumulating
              }
              
              yield {
                type: 'tool_use',
                id: toolCallId,
                name: toolCall.name,
                input: parsedInput,
                sessionId: session.id,
              }
            }
          }
        }

        // Check if message is complete with tool calls
        const finishReason = chunk.choices[0]?.finish_reason
        if (finishReason === 'tool_calls' && toolCalls.size > 0) {
          // Execute all tool calls
          for (const [toolCallId, toolCall] of toolCalls.entries()) {
            let parsedInput: any = {}
            try {
              if (toolCall.arguments) {
                parsedInput = JSON.parse(toolCall.arguments)
              }
            } catch (error) {
              this.errorHandler.handleError(error, {
                module: 'EmbeddedAIClient',
                function: 'handleContentBlockDelta',
                operation: 'Parsing tool call arguments',
                metadata: { toolCallArguments: toolCall.arguments }
              }, ErrorSeverity.Warning)
            }
            
            // Execute tool (placeholder implementation)
            // TODO: Implement actual tool execution system
            const toolResult = {
              content: `Tool "${toolCall.name}" executed with input: ${JSON.stringify(parsedInput)}`,
              isError: false
            }
            
            yield {
              type: 'tool_result',
              id: toolCallId,
              content: toolResult.content,
              isError: toolResult.isError,
              sessionId: session.id,
            }
            
            // Add tool result to session as user message (for OpenAI format)
            session.messages.push({
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_result_id: toolCallId,
                tool_result: toolResult.content,
                is_error: toolResult.isError
              }]
            })
          }
        }
      }

      // Save assistant response to session
      // For OpenAI, if there were tool calls, the message should include them
      if (toolCalls.size > 0) {
        const toolCallContent: any[] = []
        for (const [toolCallId, toolCall] of toolCalls.entries()) {
          let parsedInput: any = {}
          try {
            if (toolCall.arguments) {
              parsedInput = JSON.parse(toolCall.arguments)
            }
          } catch {
            // Ignore parse errors
          }
          toolCallContent.push({
            type: 'tool_use',
            tool_use_id: toolCallId,
            name: toolCall.name,
            input: parsedInput
          })
        }
        if (fullResponse) {
          toolCallContent.unshift({ type: 'text', text: fullResponse })
        }
        session.messages.push({
          role: 'assistant',
          content: toolCallContent.length > 0 ? toolCallContent : fullResponse,
        })
      } else {
        session.messages.push({
          role: 'assistant',
          content: fullResponse,
        })
      }

      // Note: OpenAI streaming doesn't provide usage in stream, would need separate call
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        yield { type: 'done' }
      } else {
        throw error
      }
    }
  }

  private async *sendGoogleRequest(
    session: EmbeddedSession,
    model: string,
    systemPrompt: string,
    abortController?: AbortController,
    tools?: { [key: string]: boolean }
  ): AsyncGenerator<ResponseChunk> {
    if (!this.googleClient) return

    const genModel = this.googleClient.getGenerativeModel({ model: model })

    // Build conversation history
    const history = session.messages
      .filter(msg => msg.role !== 'system')
      .map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }],
      }))

    const chat = genModel.startChat({ history: history as any })

    try {
      const userMessage = session.messages[session.messages.length - 1]?.content
      if (typeof userMessage !== 'string') {
        yield {
          type: 'error',
          content: 'Invalid message format for Google provider',
        }
        return
      }

      const result = await chat.sendMessageStream(userMessage, {
        signal: abortController?.signal,
      })

      let fullResponse = ''
      for await (const chunk of result.stream) {
        if (abortController?.signal.aborted) {
          yield { type: 'done' }
          return
        }

        const text = chunk.text()
        if (text) {
          fullResponse += text
          yield {
            type: 'text',
            content: text,
            sessionId: session.id,
          }
        }
      }

      // Save assistant response to session
      session.messages.push({
        role: 'assistant',
        content: fullResponse,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        yield { type: 'done' }
      } else {
        throw error
      }
    }
  }

  private async *sendZenMuxRequest(
    session: EmbeddedSession,
    model: string,
    systemPrompt: string,
    abortController?: AbortController,
    tools?: { [key: string]: boolean }
  ): AsyncGenerator<ResponseChunk> {
    if (!this.zenmuxClient) return

    // ZenMux uses OpenAI-compatible API, so same format as OpenAI
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
    
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    for (const msg of session.messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({
          role: msg.role,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        })
      }
    }

    // Convert tools config to OpenAI tools format (ZenMux is OpenAI-compatible)
    const openaiTools: any[] = []
    // TODO: When tool registry is implemented, convert tools config to actual tool definitions

    try {
      const stream = await this.zenmuxClient.chat.completions.create({
        model: model,
        messages: messages as any,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        stream: true,
      }, {
        signal: abortController?.signal,
      })

      let fullResponse = ''
      for await (const chunk of stream) {
        if (abortController?.signal.aborted) {
          yield { type: 'done' }
          return
        }

        const content = chunk.choices[0]?.delta?.content
        if (content) {
          fullResponse += content
          yield {
            type: 'text',
            content: content,
            sessionId: session.id,
          }
        }
      }

      // Save assistant response to session
      session.messages.push({
        role: 'assistant',
        content: fullResponse,
      })

      // Note: Usage info would need separate call or be in final chunk for some providers
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        yield { type: 'done' }
      } else {
        throw error
      }
    }
  }

  private getDefaultModel(): string {
    switch (this.config.provider) {
      case 'anthropic':
        return 'claude-3-5-sonnet-20241022'
      case 'openai':
        return 'gpt-4'
      case 'zenmux':
        return 'x-ai/grok-code-fast-1' // Default ZenMux model - user can override
      case 'google':
        return 'gemini-pro'
      default:
        return 'claude-3-5-sonnet-20241022'
    }
  }

  getSession(sessionId: string): EmbeddedSession | undefined {
    const session = this.sessions.get(sessionId)
    if (session) {
      // Update access order on read
      this.updateAccessOrder(sessionId)
      // Update last access time
      session.updatedAt = Date.now()
    }
    return session
  }

  getAllSessions(): EmbeddedSession[] {
    return Array.from(this.sessions.values())
  }

  deleteSession(sessionId: string): boolean {
    const deleted = this.sessions.delete(sessionId)
    if (deleted) {
      // Remove from access order
      const index = this.sessionAccessOrder.indexOf(sessionId)
      if (index > -1) {
        this.sessionAccessOrder.splice(index, 1)
      }
      // Clear current session if it's the deleted one
      if (this.currentSessionId === sessionId) {
        this.currentSessionId = null
      }
    }
    return deleted
  }

  setCurrentSession(sessionId: string | null): void {
    this.currentSessionId = sessionId
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId
  }

  setSessionId(sessionId: string | null): void {
    this.currentSessionId = sessionId
  }

  getSessionId(): string | null {
    return this.currentSessionId
  }

  /**
   * Fetch available models from the provider's API
   */
  async fetchAvailableModels(): Promise<Array<{ id: string; name?: string }>> {
    try {
      switch (this.config.provider) {
        case 'openai':
          if (!this.openaiClient) return []
          const openaiModels = await this.openaiClient.models.list()
          return openaiModels.data
            .filter(model => model.id.includes('gpt') || model.id.includes('o1'))
            .map(model => ({ id: model.id }))
        case 'zenmux':
          const baseURL = this.config.baseURL || 'https://zenmux.ai/api/v1'
          try {
            const apiKey = this.config.apiKey
            
            if (!apiKey) {
              this.errorHandler.handleError(
                new Error('No API key configured for ZenMux'),
                {
                  module: 'EmbeddedAIClient',
                  function: 'fetchAvailableModels',
                  operation: 'Validating ZenMux API key',
                  metadata: { provider: 'zenmux' }
                },
                ErrorSeverity.Error
              )
              return []
            }
            
            // Use Node's https module to bypass CORS restrictions in Electron/Obsidian
            const url = new URL(`${baseURL}/models`)
            
            const data = await new Promise<any>((resolve, reject) => {
              const req = https.request(
                {
                  hostname: url.hostname,
                  port: url.port || 443,
                  path: url.pathname + url.search,
                  method: 'GET',
                  headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'OpenCode-Obsidian-Plugin'
                  }
                },
                (res) => {
                  let responseData = ''
                  
                  res.on('data', (chunk) => {
                    responseData += chunk
                  })
                  
                  res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                      try {
                        const parsed = JSON.parse(responseData)
                        resolve(parsed)
                      } catch (parseError) {
                        reject(new Error(`Failed to parse response: ${parseError}`))
                      }
                    } else {
                      reject(new Error(`HTTP error! status: ${res.statusCode}, message: ${responseData}`))
                    }
                  })
                }
              )
              
              req.on('error', (error) => {
                reject(error)
              })
              
              req.end()
            })
            
            // Handle both OpenAI-compatible format and direct array format
            const models = data.data || data.models || (Array.isArray(data) ? data : [])
            console.log(`[EmbeddedAIClient] Fetched ${models.length} ZenMux models`)
            return models.map((model: any) => ({ 
              id: model.id || model.name || model 
            }))
          } catch (error: any) {
            this.errorHandler.handleError(error, {
              module: 'EmbeddedAIClient',
              function: 'fetchAvailableModels',
              operation: 'Fetching ZenMux models',
              metadata: { provider: 'zenmux', baseURL }
            }, ErrorSeverity.Error)
            throw error
          }
        case 'google':
          if (!this.googleClient) return []
          // Google Generative AI SDK doesn't have a direct listModels method
          // Try to fetch from their REST API directly
          try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.config.apiKey}`)
            if (response.ok) {
              const data = await response.json()
              if (data.models && Array.isArray(data.models)) {
                return data.models
                  .filter((model: any) => model.name && model.supportedGenerationMethods?.includes('generateContent'))
                  .map((model: any) => ({
                    id: model.name.replace('models/', ''),
                    name: model.displayName || model.name.replace('models/', '')
                  }))
              }
            }
            return []
          } catch (error) {
            this.errorHandler.handleError(error, {
              module: 'EmbeddedAIClient',
              function: 'fetchAvailableModels',
              operation: 'Fetching Google models',
              metadata: { provider: 'google' }
            }, ErrorSeverity.Error)
            return []
          }
        case 'anthropic':
          // Anthropic doesn't have a public models.list() endpoint
          // Try to fetch from their API documentation or make a test call
          // For now, return empty - users must enter model ID manually
          // Could potentially fetch from https://docs.anthropic.com but that's not an official API
          return []
        case 'compatible':
          // Handle compatible providers - fetch models from their /models endpoint
          try {
            if (!this.config.baseURL || !this.config.apiKey) {
              this.errorHandler.handleError(
                new Error('No baseURL or API key configured for compatible provider'),
                {
                  module: 'EmbeddedAIClient',
                  function: 'fetchAvailableModels',
                  operation: 'Validating compatible provider configuration',
                  metadata: {
                    providerId: this.config.providerId,
                    providerName: this.config.providerName,
                    apiType: this.config.apiType
                  }
                },
                ErrorSeverity.Error
              )
              return []
            }
            
            // Use same approach as ZenMux for OpenAI-compatible providers
            if (this.config.apiType === 'openai-compatible') {
              const url = new URL(`${this.config.baseURL}/models`)
              
              const data = await new Promise<any>((resolve, reject) => {
                const req = https.request(
                  {
                    hostname: url.hostname,
                    port: url.port || 443,
                    path: url.pathname + url.search,
                    method: 'GET',
                    headers: {
                      'Authorization': `Bearer ${this.config.apiKey}`,
                      'Content-Type': 'application/json',
                      'User-Agent': 'OpenCode-Obsidian-Plugin'
                    }
                  },
                  (res) => {
                    let responseData = ''
                    
                    res.on('data', (chunk) => {
                      responseData += chunk
                    })
                    
                    res.on('end', () => {
                      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                          const parsed = JSON.parse(responseData)
                          resolve(parsed)
                        } catch (parseError) {
                          reject(new Error(`Failed to parse response: ${parseError}`))
                        }
                      } else {
                        reject(new Error(`HTTP error! status: ${res.statusCode}, message: ${responseData}`))
                      }
                    })
                  }
                )
                
                req.on('error', (error) => {
                  reject(error)
                })
                
                req.end()
              })
              
              // Handle both OpenAI-compatible format and direct array format
              const models = data.data || data.models || (Array.isArray(data) ? data : [])
              console.log(`[EmbeddedAIClient] Fetched ${models.length} models from compatible provider ${this.config.providerName || this.config.providerId}`)
              return models.map((model: any) => ({ 
                id: model.id || model.name || model 
              }))
            } else if (this.config.apiType === 'anthropic-compatible') {
              // Anthropic-compatible providers may not have a models endpoint
              // Return empty for now - users must enter model ID manually
              console.log(`[EmbeddedAIClient] Anthropic-compatible providers may not support model listing`)
              return []
            }
            
            return []
          } catch (error: any) {
            this.errorHandler.handleError(error, {
              module: 'EmbeddedAIClient',
              function: 'fetchAvailableModels',
              operation: 'Fetching models from compatible provider',
              metadata: {
                providerId: this.config.providerId,
                providerName: this.config.providerName,
                apiType: this.config.apiType
              }
            }, ErrorSeverity.Error)
            return []
          }
        default:
          return []
      }
    } catch (error) {
      this.errorHandler.handleError(error, {
        module: 'EmbeddedAIClient',
        function: 'fetchAvailableModels',
        operation: 'Fetching available models',
        metadata: { provider: this.config.provider }
      }, ErrorSeverity.Error)
      return []
    }
  }
}
