import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import https from 'https'
import { URL } from 'url'

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

export interface EmbeddedAIClientConfig {
  apiKey: string
  provider: 'anthropic' | 'openai' | 'google' | 'zenmux' | 'compatible'
  model?: string
  baseURL?: string // For custom API endpoints like ZenMux or compatible providers
  apiType?: 'openai-compatible' | 'anthropic-compatible' // For compatible providers
  providerId?: string // For compatible providers (original provider ID from config)
  providerName?: string // For compatible providers (display name)
}

export interface EmbeddedSession {
  id: string
  messages: Array<{
    role: 'user' | 'assistant' | 'system'
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
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
  private currentSessionId: string | null = null

  constructor(config: EmbeddedAIClientConfig) {
    this.config = config
    this.initializeClient()
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
          console.warn(`[EmbeddedAIClient] Anthropic-compatible provider ${this.config.providerName || this.config.providerId} initialized, but baseURL support may be limited`)
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
    this.sessions.set(sessionId, session)
    this.currentSessionId = sessionId
    return sessionId
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
      this.sessions.set(sessionId, session)
      this.currentSessionId = sessionId
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

      // Send request based on provider
      if (this.config.provider === 'anthropic' && this.anthropicClient) {
        yield* this.sendAnthropicRequest(session, model, systemPrompt, options.abortController)
      } else if (this.config.provider === 'openai' && this.openaiClient) {
        yield* this.sendOpenAIRequest(session, model, systemPrompt, options.abortController)
      } else if (this.config.provider === 'zenmux' && this.zenmuxClient) {
        yield* this.sendZenMuxRequest(session, model, systemPrompt, options.abortController)
      } else if (this.config.provider === 'google' && this.googleClient) {
        yield* this.sendGoogleRequest(session, model, systemPrompt, options.abortController)
      } else if (this.config.provider === 'compatible') {
        // Handle compatible providers based on apiType
        if (this.config.apiType === 'openai-compatible' && this.openaiClient) {
          yield* this.sendOpenAIRequest(session, model, systemPrompt, options.abortController)
        } else if (this.config.apiType === 'anthropic-compatible' && this.anthropicClient) {
          yield* this.sendAnthropicRequest(session, model, systemPrompt, options.abortController)
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
      yield { type: 'done' }
    } catch (error) {
      yield {
        type: 'error',
        content: error instanceof Error ? error.message : 'Unknown error occurred',
      }
    }
  }

  private async *sendAnthropicRequest(
    session: EmbeddedSession,
    model: string,
    systemPrompt: string,
    abortController?: AbortController
  ): AsyncGenerator<ResponseChunk> {
    if (!this.anthropicClient) return

    const messages = session.messages
      .filter(msg => msg.role !== 'system')
      .map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      }))

    try {
      const stream = await this.anthropicClient.messages.stream({
        model: model as any,
        max_tokens: 4096,
        system: systemPrompt || undefined,
        messages: messages as any,
      }, {
        signal: abortController?.signal,
      })

      let fullResponse = ''
      for await (const event of stream) {
        if (abortController?.signal.aborted) {
          yield { type: 'done' }
          return
        }

        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          const text = event.delta.text
          fullResponse += text
          yield {
            type: 'text',
            content: text,
            sessionId: session.id,
          }
        }

        if (event.type === 'message_stop') {
          // Save assistant response to session
          session.messages.push({
            role: 'assistant',
            content: fullResponse,
          })

          // Yield usage info if available
          const eventAny = event as any
          if (eventAny.message?.usage) {
            yield {
              type: 'usage',
              sessionId: session.id,
              usage: {
                model: `${this.config.provider}:${model}`,
                inputTokens: eventAny.message.usage.input_tokens,
                contextTokens: eventAny.message.usage.input_tokens,
              },
            }
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
    abortController?: AbortController
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

    try {
      const stream = await this.openaiClient.chat.completions.create({
        model: model,
        messages: messages as any,
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
    abortController?: AbortController
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
    abortController?: AbortController
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

    try {
      const stream = await this.zenmuxClient.chat.completions.create({
        model: model,
        messages: messages as any,
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
    return this.sessions.get(sessionId)
  }

  getAllSessions(): EmbeddedSession[] {
    return Array.from(this.sessions.values())
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId)
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
          try {
            const baseURL = this.config.baseURL || 'https://zenmux.ai/api/v1'
            const apiKey = this.config.apiKey
            
            if (!apiKey) {
              console.error('[EmbeddedAIClient] No API key configured for ZenMux')
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
            console.error('[EmbeddedAIClient] Error fetching ZenMux models:', error)
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
            console.error('[EmbeddedAIClient] Error fetching Google models:', error)
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
              console.error('[EmbeddedAIClient] No baseURL or API key configured for compatible provider')
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
            console.error(`[EmbeddedAIClient] Error fetching models from compatible provider ${this.config.providerName || this.config.providerId}:`, error)
            return []
          }
        default:
          return []
      }
    } catch (error) {
      console.error(`[EmbeddedAIClient] Failed to fetch models for ${this.config.provider}:`, error)
      return []
    }
  }
}
