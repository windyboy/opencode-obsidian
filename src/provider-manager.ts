import { EmbeddedAIClient, type ResponseChunk, type ProviderType, type CompatibleApiType } from './embedded-ai-client'
import { ErrorHandler, ErrorSeverity } from './utils/error-handler'
import { UI_CONFIG } from './utils/constants'

export type ProviderID = 'anthropic' | 'openai' | 'google' | 'zenmux' | string

export interface CompatibleProviderConfig {
  id: string
  name: string
  apiKey: string
  baseURL: string
  apiType: CompatibleApiType
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

interface CachedModelList {
  models: Array<{ id: string; name?: string }>
  timestamp: number
}

export class ProviderManager {
  private clients: Map<ProviderID, EmbeddedAIClient> = new Map()
  private config: ProviderConfig
  private errorHandler: ErrorHandler
  private modelCache: Map<ProviderID, CachedModelList> = new Map()
  private pendingFetches: Map<ProviderID, Promise<Array<{ id: string; name?: string }>>> = new Map()
  private lastFetchTime: Map<ProviderID, number> = new Map()

  constructor(config: ProviderConfig, errorHandler?: ErrorHandler) {
    this.config = config
    this.errorHandler = errorHandler || new ErrorHandler()
    this.initializeAvailableProviders()
  }

  /**
   * Create an EmbeddedAIClient for a given provider
   * This factory method centralizes the client creation logic to eliminate duplication
   */
  private createProviderClient(
    providerID: ProviderID,
    apiKey: string,
    options?: { model?: string; baseURL?: string }
  ): EmbeddedAIClient | null {
    // Check if it's a compatible provider
    const compatibleProvider = this.config.compatibleProviders?.find(p => p.id === providerID)
    
    if (compatibleProvider) {
      // Create compatible provider client
      try {
        const model = options?.model || this.config.defaultModel?.[providerID] || compatibleProvider.defaultModel
        return new EmbeddedAIClient({
          apiKey: apiKey,
          provider: 'compatible',
          model: model,
          baseURL: compatibleProvider.baseURL,
          apiType: compatibleProvider.apiType,
          providerId: compatibleProvider.id,
          providerName: compatibleProvider.name
        }, this.errorHandler)
      } catch (error) {
        this.errorHandler.handleError(error, {
          module: 'ProviderManager',
          function: 'createProviderClient',
          operation: `Creating compatible provider client: ${providerID}`,
          metadata: { providerID, providerType: 'compatible' }
        }, ErrorSeverity.Error)
        return null
      }
    }
    
    // Create built-in provider client
    const builtInProvider = providerID as 'anthropic' | 'openai' | 'google' | 'zenmux'
    if (!['anthropic', 'openai', 'google', 'zenmux'].includes(providerID)) {
      this.errorHandler.handleError(
        new Error(`Unknown provider type: ${providerID}`),
        {
          module: 'ProviderManager',
          function: 'createProviderClient',
          operation: 'Validating provider type',
          metadata: { providerID }
        },
        ErrorSeverity.Warning
      )
      return null
    }
    
    try {
      const model = options?.model || this.config.defaultModel?.[providerID]
      // Get baseURL from config if available, otherwise use default for ZenMux
      let baseURL: string | undefined = options?.baseURL
      if (!baseURL && providerID === 'zenmux') {
        baseURL = this.config.providerOptions?.zenmux?.baseURL || 'https://zenmux.ai/api/v1'
      }
      
      return new EmbeddedAIClient({
        apiKey: apiKey,
        provider: builtInProvider,
        model: model,
        baseURL: baseURL
      }, this.errorHandler)
    } catch (error) {
      this.errorHandler.handleError(error, {
        module: 'ProviderManager',
        function: 'createProviderClient',
        operation: `Creating built-in provider client: ${providerID}`,
        metadata: { providerID, providerType: 'built-in' }
      }, ErrorSeverity.Error)
      return null
    }
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
        const client = this.createProviderClient(provider, apiKey)
        if (client) {
          this.clients.set(provider, client)
          const baseURL = provider === 'zenmux' 
            ? (this.config.providerOptions?.zenmux?.baseURL || 'https://zenmux.ai/api/v1')
            : undefined
          console.log(`[ProviderManager] Initialized ${provider} client${baseURL ? ` with baseURL: ${baseURL}` : ''}`)
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
        
        const client = this.createProviderClient(compatibleProvider.id, compatibleProvider.apiKey)
        if (client) {
          this.clients.set(compatibleProvider.id, client)
          console.log(`[ProviderManager] Initialized compatible provider ${compatibleProvider.name} (${compatibleProvider.id}) with baseURL: ${compatibleProvider.baseURL}, apiType: ${compatibleProvider.apiType}`)
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
    
    // Clear model cache when API key changes
    this.clearModelCache(providerID)
    
    // Remove existing client if API key is empty
    if (!apiKey || apiKey.trim() === '') {
      this.clients.delete(providerID)
      return
    }

    // Update API key in config for compatible providers
    const compatibleProvider = this.config.compatibleProviders?.find(p => p.id === providerID)
    if (compatibleProvider) {
      compatibleProvider.apiKey = apiKey
    }
    
    // Create or update client using factory method
    const client = this.createProviderClient(providerID, apiKey, { model, baseURL: compatibleProvider?.baseURL })
    if (client) {
      this.clients.set(providerID, client)
      if (compatibleProvider) {
        console.log(`[ProviderManager] Updated compatible provider ${compatibleProvider.name} (${providerID}) client`)
      } else {
        const baseURL = providerID === 'zenmux' 
          ? (this.config.providerOptions?.zenmux?.baseURL || 'https://zenmux.ai/api/v1')
          : undefined
        console.log(`[ProviderManager] Updated ${providerID} client${baseURL ? ` with baseURL: ${baseURL}` : ''}`)
      }
    } else {
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
   * Fetch available models for a provider (with caching and throttling)
   */
  async fetchModels(providerID: ProviderID): Promise<Array<{ id: string; name?: string }>> {
    // Check cache first
    const cached = this.modelCache.get(providerID)
    const now = Date.now()
    if (cached && (now - cached.timestamp) < UI_CONFIG.MODEL_FETCH_CACHE_DURATION) {
      // Return cached result if still valid
      return cached.models
    }

    // Throttle: If there's a pending fetch, return it instead of starting a new one
    const pendingFetch = this.pendingFetches.get(providerID)
    if (pendingFetch) {
      return await pendingFetch
    }

    // Throttle: Check if enough time has passed since last fetch
    const lastFetch = this.lastFetchTime.get(providerID) || 0
    const timeSinceLastFetch = now - lastFetch
    if (timeSinceLastFetch < UI_CONFIG.MODEL_FETCH_THROTTLE_DELAY) {
      // Return cached result even if expired, to avoid too frequent requests
      if (cached) {
        return cached.models
      }
      // If no cache, wait for the remaining time and then fetch
      await new Promise(resolve => setTimeout(resolve, UI_CONFIG.MODEL_FETCH_THROTTLE_DELAY - timeSinceLastFetch))
    }

    // Create fetch promise and cache it
    const fetchPromise = this.fetchModelsInternal(providerID)
    this.pendingFetches.set(providerID, fetchPromise)

    try {
      const models = await fetchPromise

      // Cache the result
      this.modelCache.set(providerID, {
        models,
        timestamp: Date.now()
      })

      this.lastFetchTime.set(providerID, Date.now())
      return models
    } finally {
      // Clear pending fetch
      this.pendingFetches.delete(providerID)
    }
  }

  /**
   * Internal method to actually fetch models (without caching/throttling)
   */
  private async fetchModelsInternal(providerID: ProviderID): Promise<Array<{ id: string; name?: string }>> {
    const client = this.getClient(providerID)
    if (client) {
      try {
        return await client.fetchAvailableModels()
      } catch (error) {
        this.errorHandler.handleError(error, {
          module: 'ProviderManager',
          function: 'fetchModelsInternal',
          operation: `Fetching models from initialized client: ${providerID}`,
          metadata: { providerID }
        }, ErrorSeverity.Warning)
        // Fall through to try creating a temporary client
      }
    }
    
    // If client not initialized or fetch failed, try to create a temporary one if API key exists
    const compatibleProvider = this.config.compatibleProviders?.find(p => p.id === providerID)
    const apiKey = compatibleProvider?.apiKey || this.config.apiKeys[providerID]
    
    if (apiKey && apiKey.trim() !== '') {
      try {
        const baseURL = compatibleProvider?.baseURL || 
          (providerID === 'zenmux' ? (this.config.providerOptions?.zenmux?.baseURL || 'https://zenmux.ai/api/v1') : undefined)
        console.log(`[ProviderManager] Creating temporary client for ${providerID}${baseURL ? ` with baseURL: ${baseURL}` : ''}`)
        const tempClient = this.createProviderClient(providerID, apiKey, { baseURL })
        
        if (tempClient) {
          const models = await tempClient.fetchAvailableModels()
          console.log(`[ProviderManager] Successfully fetched ${models.length} models for ${providerID}`)
          return models
        }
      } catch (error) {
        this.errorHandler.handleError(error, {
          module: 'ProviderManager',
          function: 'fetchModelsInternal',
          operation: `Fetching models for ${providerID}`,
          metadata: { providerID, isTemporaryClient: true }
        }, ErrorSeverity.Error)
      }
    }
    
    this.errorHandler.handleError(
      new Error(`No API key configured for ${providerID}`),
      {
        module: 'ProviderManager',
        function: 'fetchModelsInternal',
        operation: 'Validating API key',
        metadata: { providerID }
      },
      ErrorSeverity.Warning
    )
    return []
  }

  /**
   * Clear model cache for a specific provider (useful when API key changes)
   */
  clearModelCache(providerID?: ProviderID): void {
    if (providerID) {
      this.modelCache.delete(providerID)
      this.pendingFetches.delete(providerID)
      this.lastFetchTime.delete(providerID)
    } else {
      this.modelCache.clear()
      this.pendingFetches.clear()
      this.lastFetchTime.clear()
    }
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
        const compatibleProvider = this.config.compatibleProviders?.find(p => p.id === providerID)
        const model = options.model?.modelID || 
          this.config.defaultModel?.[providerID] || 
          compatibleProvider?.defaultModel
        const baseURL = compatibleProvider?.baseURL || 
          (providerID === 'zenmux' ? (this.config.providerOptions?.zenmux?.baseURL || 'https://zenmux.ai/api/v1') : undefined)
        
        const newClient = this.createProviderClient(providerID, apiKey, { model, baseURL })
        if (newClient) {
          this.clients.set(providerID, newClient)
          yield* newClient.sendPrompt(prompt, options)
          return
        }
        
        throw new Error(`Failed to create client for ${providerID}`)
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
