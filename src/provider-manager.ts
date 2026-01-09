import { EmbeddedAIClient, type ResponseChunk } from './embedded-ai-client'

export type ProviderID = 'anthropic' | 'openai' | 'google' | 'zenmux' | string

export interface CompatibleProviderConfig {
  id: string
  name: string
  apiKey: string
  baseURL: string
  apiType: 'openai-compatible' | 'anthropic-compatible'
  defaultModel?: string
}

export interface ProviderConfig {
  apiKeys: {
    anthropic?: string
    openai?: string
    google?: string
    zenmux?: string
    [key: string]: string | undefined
  }
  compatibleProviders?: CompatibleProviderConfig[]
  defaultModel?: {
    anthropic?: string
    openai?: string
    google?: string
    zenmux?: string
    [key: string]: string | undefined
  }
  providerOptions?: {
    zenmux?: {
      baseURL?: string
    }
    [key: string]: any
  }
}

export class ProviderManager {
  private clients: Map<ProviderID, EmbeddedAIClient> = new Map()
  private config: ProviderConfig

  constructor(config: ProviderConfig) {
    this.config = config
    this.initializeAvailableProviders()
  }

  /**
   * Initialize clients for all providers that have API keys configured
   */
  private initializeAvailableProviders() {
    const providers: ProviderID[] = ['anthropic', 'openai', 'google', 'zenmux']
    
    // Initialize built-in providers
    for (const provider of providers) {
      const apiKey = this.config.apiKeys[provider]
      if (apiKey && apiKey.trim() !== '') {
        try {
          const model = this.config.defaultModel?.[provider]
          // Get baseURL from config if available, otherwise use default for ZenMux
          let baseURL: string | undefined = undefined
          if (provider === 'zenmux') {
            baseURL = this.config.providerOptions?.zenmux?.baseURL || 'https://zenmux.ai/api/v1'
          }
          this.clients.set(provider, new EmbeddedAIClient({
            apiKey: apiKey,
            provider: provider as 'anthropic' | 'openai' | 'google' | 'zenmux',
            model: model,
            baseURL: baseURL
          }))
          console.log(`[ProviderManager] Initialized ${provider} client${baseURL ? ` with baseURL: ${baseURL}` : ''}`)
        } catch (error) {
          console.error(`[ProviderManager] Failed to initialize ${provider}:`, error)
        }
      }
    }
    
    // Initialize compatible providers
    if (this.config.compatibleProviders && this.config.compatibleProviders.length > 0) {
      for (const compatibleProvider of this.config.compatibleProviders) {
        // Skip if API key is not set
        if (!compatibleProvider.apiKey || compatibleProvider.apiKey.trim() === '') {
          console.log(`[ProviderManager] Skipping compatible provider ${compatibleProvider.id} (${compatibleProvider.name}): no API key configured`)
          continue
        }
        
        try {
          const model = this.config.defaultModel?.[compatibleProvider.id] || compatibleProvider.defaultModel
          
          this.clients.set(compatibleProvider.id, new EmbeddedAIClient({
            apiKey: compatibleProvider.apiKey,
            provider: 'compatible' as any,
            model: model,
            baseURL: compatibleProvider.baseURL,
            apiType: compatibleProvider.apiType,
            providerId: compatibleProvider.id,
            providerName: compatibleProvider.name
          }))
          console.log(`[ProviderManager] Initialized compatible provider ${compatibleProvider.name} (${compatibleProvider.id}) with baseURL: ${compatibleProvider.baseURL}, apiType: ${compatibleProvider.apiType}`)
        } catch (error) {
          console.error(`[ProviderManager] Failed to initialize compatible provider ${compatibleProvider.id}:`, error)
        }
      }
    }
  }

  /**
   * Get client for a specific provider
   */
  getClient(providerID: ProviderID): EmbeddedAIClient | null {
    return this.clients.get(providerID) || null
  }

  /**
   * Check if a provider is available (has API key and client initialized)
   */
  isProviderAvailable(providerID: ProviderID): boolean {
    return this.clients.has(providerID)
  }

  /**
   * Get list of available providers
   */
  getAvailableProviders(): ProviderID[] {
    return Array.from(this.clients.keys())
  }

  /**
   * Update API key for a provider and reinitialize client
   */
  updateProviderApiKey(providerID: ProviderID, apiKey: string, model?: string) {
    this.config.apiKeys[providerID] = apiKey
    
    // Remove existing client if API key is empty
    if (!apiKey || apiKey.trim() === '') {
      this.clients.delete(providerID)
      return
    }

    // Create or update client
    try {
      // Check if it's a compatible provider
      const compatibleProvider = this.config.compatibleProviders?.find(p => p.id === providerID)
      
      if (compatibleProvider) {
        // Update compatible provider
        compatibleProvider.apiKey = apiKey
        const client = new EmbeddedAIClient({
          apiKey: apiKey,
          provider: 'compatible' as any,
          model: model || this.config.defaultModel?.[providerID] || compatibleProvider.defaultModel,
          baseURL: compatibleProvider.baseURL,
          apiType: compatibleProvider.apiType,
          providerId: compatibleProvider.id,
          providerName: compatibleProvider.name
        })
        this.clients.set(providerID, client)
        console.log(`[ProviderManager] Updated compatible provider ${compatibleProvider.name} (${providerID}) client`)
      } else {
        // Update built-in provider
        // Get baseURL from config if available, otherwise use default for ZenMux
        let baseURL: string | undefined = undefined
        if (providerID === 'zenmux') {
          baseURL = this.config.providerOptions?.zenmux?.baseURL || 'https://zenmux.ai/api/v1'
        }
        const client = new EmbeddedAIClient({
          apiKey: apiKey,
          provider: providerID as 'anthropic' | 'openai' | 'google' | 'zenmux',
          model: model || this.config.defaultModel?.[providerID],
          baseURL: baseURL
        })
        this.clients.set(providerID, client)
        console.log(`[ProviderManager] Updated ${providerID} client${baseURL ? ` with baseURL: ${baseURL}` : ''}`)
      }
    } catch (error) {
      console.error(`[ProviderManager] Failed to update ${providerID}:`, error)
      this.clients.delete(providerID)
    }
  }

  /**
   * Update configuration and reinitialize all providers
   */
  updateConfig(config: ProviderConfig) {
    this.config = config
    this.clients.clear()
    this.initializeAvailableProviders()
  }

  /**
   * Fetch available models for a provider
   */
  async fetchModels(providerID: ProviderID): Promise<Array<{ id: string; name?: string }>> {
    const client = this.getClient(providerID)
    if (client) {
      try {
        return await client.fetchAvailableModels()
      } catch (error) {
        console.error(`[ProviderManager] Error fetching models from initialized client for ${providerID}:`, error)
        // Fall through to try creating a temporary client
      }
    }
    
    // If client not initialized or fetch failed, try to create a temporary one if API key exists
    // Check if it's a compatible provider first
    const compatibleProvider = this.config.compatibleProviders?.find(p => p.id === providerID)
    
    if (compatibleProvider && compatibleProvider.apiKey && compatibleProvider.apiKey.trim() !== '') {
      try {
        console.log(`[ProviderManager] Creating temporary compatible provider client for ${providerID}`)
        const tempClient = new EmbeddedAIClient({
          apiKey: compatibleProvider.apiKey,
          provider: 'compatible' as any,
          baseURL: compatibleProvider.baseURL,
          apiType: compatibleProvider.apiType,
          providerId: compatibleProvider.id,
          providerName: compatibleProvider.name
        })
        const models = await tempClient.fetchAvailableModels()
        console.log(`[ProviderManager] Successfully fetched ${models.length} models for compatible provider ${providerID}`)
        return models
      } catch (error) {
        console.error(`[ProviderManager] Failed to fetch models for compatible provider ${providerID}:`, error)
        if (error instanceof Error) {
          console.error(`[ProviderManager] Error message: ${error.message}`)
          console.error(`[ProviderManager] Error stack: ${error.stack}`)
        }
        return []
      }
    }
    
    const apiKey = this.config.apiKeys[providerID]
    if (apiKey && apiKey.trim() !== '') {
      try {
        let baseURL: string | undefined = undefined
        if (providerID === 'zenmux') {
          baseURL = this.config.providerOptions?.zenmux?.baseURL || 'https://zenmux.ai/api/v1'
        }
        console.log(`[ProviderManager] Creating temporary client for ${providerID}${baseURL ? ` with baseURL: ${baseURL}` : ''}`)
        const tempClient = new EmbeddedAIClient({
          apiKey: apiKey,
          provider: providerID as 'anthropic' | 'openai' | 'google' | 'zenmux',
          baseURL: baseURL
        })
        const models = await tempClient.fetchAvailableModels()
        console.log(`[ProviderManager] Successfully fetched ${models.length} models for ${providerID}`)
        return models
      } catch (error) {
        console.error(`[ProviderManager] Failed to fetch models for ${providerID}:`, error)
        // Log more details about the error
        if (error instanceof Error) {
          console.error(`[ProviderManager] Error message: ${error.message}`)
          console.error(`[ProviderManager] Error stack: ${error.stack}`)
        }
        return []
      }
    }
    
    console.warn(`[ProviderManager] No API key configured for ${providerID}`)
    return []
  }

  /**
   * Send prompt using specified provider
   */
  async *sendPrompt(
    providerID: ProviderID,
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
    const client = this.getClient(providerID)
    
    if (!client) {
      const apiKey = this.config.apiKeys[providerID]
      if (!apiKey || apiKey.trim() === '') {
        yield {
          type: 'error',
          content: `Provider ${providerID} is not configured. Please set the API key in settings.`
        }
        return
      }
      
      // Try to initialize on the fly
      try {
        // Check if it's a compatible provider
        const compatibleProvider = this.config.compatibleProviders?.find(p => p.id === providerID)
        
        if (compatibleProvider) {
          // Initialize compatible provider
          const model = options.model?.modelID || this.config.defaultModel?.[providerID] || compatibleProvider.defaultModel
          const newClient = new EmbeddedAIClient({
            apiKey: compatibleProvider.apiKey,
            provider: 'compatible' as any,
            model: model,
            baseURL: compatibleProvider.baseURL,
            apiType: compatibleProvider.apiType,
            providerId: compatibleProvider.id,
            providerName: compatibleProvider.name
          })
          this.clients.set(providerID, newClient)
          yield* newClient.sendPrompt(prompt, options)
          return
        } else {
          // Initialize built-in provider
          let baseURL: string | undefined = undefined
          if (providerID === 'zenmux') {
            baseURL = this.config.providerOptions?.zenmux?.baseURL || 'https://zenmux.ai/api/v1'
          }
          const newClient = new EmbeddedAIClient({
            apiKey: apiKey,
            provider: providerID as 'anthropic' | 'openai' | 'google' | 'zenmux',
            model: options.model?.modelID || this.config.defaultModel?.[providerID],
            baseURL: baseURL
          })
          this.clients.set(providerID, newClient)
          yield* newClient.sendPrompt(prompt, options)
          return
        }
      } catch (error) {
        yield {
          type: 'error',
          content: `Failed to initialize ${providerID}: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
        return
      }
    }

    yield* client.sendPrompt(prompt, options)
  }
}
