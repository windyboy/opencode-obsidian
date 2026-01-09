import { Plugin, WorkspaceLeaf, Notice } from 'obsidian'
import { type ResponseChunk } from './embedded-ai-client'
import { ProviderManager } from './provider-manager'
import { OpenCodeObsidianView, VIEW_TYPE_OPENCODE_OBSIDIAN } from './opencode-obsidian-view'
import { OpenCodeObsidianSettingTab } from './settings'
import type { OpenCodeObsidianSettings } from './types'
import { ConfigLoader } from './config-loader'
import { HookRegistry } from './hooks/hook-registry'
import { CONTEXT_CONFIG, SESSION_CONFIG, UI_CONFIG } from './utils/constants'
import { AgentResolver } from './agent/agent-resolver'
import { ErrorHandler, ErrorSeverity } from './utils/error-handler'
import { debounceAsync } from './utils/debounce-throttle'

const DEFAULT_SETTINGS: OpenCodeObsidianSettings = {
  apiKeys: {},
  providerID: 'anthropic',
  agent: 'assistant',
  model: {
    providerID: 'anthropic',
    modelID: 'claude-3-5-sonnet-20241022'
  },
  instructions: [],
  disabledHooks: [],
  contextManagement: {
    preemptiveCompactionThreshold: CONTEXT_CONFIG.PREEMPTIVE_THRESHOLD,
    maxContextTokens: CONTEXT_CONFIG.MAX_TOKENS,
    enableTokenEstimation: true,
  },
  todoManagement: {
    enabled: true,
    autoContinue: true,
    respectUserInterrupt: true,
  },
  mcpServers: {},
}

export default class OpenCodeObsidianPlugin extends Plugin {
  settings: OpenCodeObsidianSettings
  providerManager: ProviderManager
  configLoader: ConfigLoader | null = null
  hookRegistry: HookRegistry
  agentResolver: AgentResolver
  errorHandler: ErrorHandler

  async onload() {
    console.log('[OpenCode Obsidian] Plugin loading...')
    
    try {
      // Initialize error handler with Obsidian Notice integration
      this.errorHandler = new ErrorHandler({
        showUserNotifications: true,
        logToConsole: true,
        collectErrors: false,
        notificationCallback: (message: string, severity: ErrorSeverity) => {
          new Notice(message, severity === ErrorSeverity.Critical ? 10000 : 5000)
        }
      })
      console.log('[OpenCode Obsidian] Error handler initialized')
      
      // Initialize hook registry first
      this.hookRegistry = new HookRegistry(this.errorHandler)
      console.log('[OpenCode Obsidian] Hook registry initialized')
      
      // Initialize agent resolver
      this.agentResolver = new AgentResolver()
      console.log('[OpenCode Obsidian] Agent resolver initialized')
      
      await this.loadSettings()
      
      // Disable hooks as specified in settings
      if (this.settings.disabledHooks) {
        for (const hookId of this.settings.disabledHooks) {
          this.hookRegistry.disableHook(hookId)
        }
        console.log(`[OpenCode Obsidian] Disabled hooks: ${this.settings.disabledHooks.join(', ')}`)
      }
      
      // Migrate old settings format if needed
      this.migrateSettings()
      
      // Initialize config loader (only if vault is available)
      try {
        if (this.app && this.app.vault) {
          this.configLoader = new ConfigLoader(this.app.vault)
          
          // Load TUI features (compatible providers from .opencode/config.json)
          // Wrap in try-catch to prevent plugin load failure
          try {
            await this.loadTUIFeatures()
          } catch (error) {
            this.errorHandler.handleError(error, {
              module: 'OpenCodeObsidianPlugin',
              function: 'onload.loadTUIFeatures',
              operation: 'Loading TUI features'
            }, ErrorSeverity.Warning)
            // Continue loading plugin even if TUI features fail to load
          }
        } else {
          this.errorHandler.handleError(
            new Error('Vault not available'),
            { module: 'OpenCodeObsidianPlugin', function: 'onload', operation: 'Config loader initialization' },
            ErrorSeverity.Warning
          )
        }
      } catch (error) {
        this.errorHandler.handleError(error, {
          module: 'OpenCodeObsidianPlugin',
          function: 'onload',
          operation: 'Initializing config loader'
        }, ErrorSeverity.Warning)
        // Continue loading plugin even if config loader fails
        this.configLoader = null
      }
      
      console.log('[OpenCode Obsidian] Settings loaded:', {
        providerID: this.settings.providerID,
        agent: this.settings.agent,
        model: this.settings.model,
        availableProviders: Object.keys(this.settings.apiKeys).filter(key => this.settings.apiKeys[key as keyof typeof this.settings.apiKeys]),
        compatibleProvidersCount: this.settings.compatibleProviders?.length || 0
      })
      
      // Initialize provider manager
      this.providerManager = new ProviderManager({
        apiKeys: this.settings.apiKeys,
        compatibleProviders: (this.settings.compatibleProviders && Array.isArray(this.settings.compatibleProviders))
          ? this.settings.compatibleProviders.map(p => ({
              id: p.id,
              name: p.name,
              apiKey: p.apiKey,
              baseURL: p.baseURL,
              apiType: p.apiType,
              defaultModel: p.defaultModel
            }))
          : undefined,
        defaultModel: {
        anthropic: this.settings.model.providerID === 'anthropic' ? this.settings.model.modelID : undefined,
        openai: this.settings.model.providerID === 'openai' ? this.settings.model.modelID : undefined,
        google: this.settings.model.providerID === 'google' ? this.settings.model.modelID : undefined,
        zenmux: this.settings.model.providerID === 'zenmux' ? this.settings.model.modelID : undefined,
        // Add default models for compatible providers
        ...(this.settings.compatibleProviders && Array.isArray(this.settings.compatibleProviders)
          ? this.settings.compatibleProviders.reduce((acc, p) => {
              if (p && p.defaultModel && p.id) {
                acc[p.id] = p.defaultModel
              }
              return acc
            }, {} as Record<string, string>)
          : {})
        },
        providerOptions: this.settings.providerOptions
      }, this.errorHandler)
    
    const availableProviders = this.providerManager.getAvailableProviders()
    if (availableProviders.length === 0) {
      this.errorHandler.handleError(
        new Error('No API keys configured'),
        { module: 'OpenCodeObsidianPlugin', function: 'onload', operation: 'Provider initialization' },
        ErrorSeverity.Warning
      )
    } else {
      console.log(`[OpenCode Obsidian] Provider manager initialized with ${availableProviders.length} provider(s): ${availableProviders.join(', ')}`)
    }

    // Register the main view
    this.registerView(
      VIEW_TYPE_OPENCODE_OBSIDIAN,
      (leaf) => new OpenCodeObsidianView(leaf, this)
    )
    console.log('[OpenCode Obsidian] View registered:', VIEW_TYPE_OPENCODE_OBSIDIAN)

    // Add ribbon icon
    this.addRibbonIcon('bot', 'Open OpenCode', () => {
      this.activateView()
    })
    console.log('[OpenCode Obsidian] Ribbon icon added')

    // Add command to open view
    this.addCommand({
      id: 'open-view',
      name: 'Open chat view',
      callback: () => {
        this.activateView()
      }
    })
    console.log('[OpenCode Obsidian] Command registered: open-view')

      // Add settings tab
      this.addSettingTab(new OpenCodeObsidianSettingTab(this.app, this))
      console.log('[OpenCode Obsidian] Settings tab added')
      
      console.log('[OpenCode Obsidian] Plugin loaded successfully ✓')
    } catch (error) {
      if (this.errorHandler) {
        this.errorHandler.handleError(error, {
          module: 'OpenCodeObsidianPlugin',
          function: 'onload',
          operation: 'Plugin loading'
        }, ErrorSeverity.Critical)
      } else {
        console.error('[OpenCode Obsidian] Failed to load plugin:', error)
        new Notice('Failed to load OpenCode Obsidian plugin. Check console for details.')
      }
      throw error // Re-throw to let Obsidian handle the error
    }
  }

  onunload() {
    console.log('[OpenCode Obsidian] Plugin unloading...')
    // Embedded client doesn't need explicit disconnect
    console.log('[OpenCode Obsidian] Plugin unloaded')
  }

  async loadSettings() {
    const loadedData = await this.loadData()
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData)
    
    // Ensure apiKeys object exists
    if (!this.settings.apiKeys) {
      this.settings.apiKeys = {}
    }
    
    // Ensure providerOptions object exists
    if (!this.settings.providerOptions) {
      this.settings.providerOptions = {}
    }
    
    // Ensure compatibleProviders array exists
    if (!this.settings.compatibleProviders) {
      this.settings.compatibleProviders = []
    }
    
    // Ensure instructions array exists
    if (!this.settings.instructions) {
      this.settings.instructions = []
    }
    
    // Ensure skills array exists
    if (!this.settings.skills) {
      this.settings.skills = []
    }

    // Ensure hook configuration exists
    if (!this.settings.disabledHooks) {
      this.settings.disabledHooks = []
    }

    // Ensure context management configuration exists
    if (!this.settings.contextManagement) {
      this.settings.contextManagement = {
        preemptiveCompactionThreshold: CONTEXT_CONFIG.PREEMPTIVE_THRESHOLD,
        maxContextTokens: CONTEXT_CONFIG.MAX_TOKENS,
        enableTokenEstimation: true,
      }
    }

    // Ensure TODO management configuration exists
    if (!this.settings.todoManagement) {
      this.settings.todoManagement = {
        enabled: true,
        autoContinue: true,
        respectUserInterrupt: true,
      }
    }

    // Ensure MCP servers configuration exists
    if (!this.settings.mcpServers) {
      this.settings.mcpServers = {}
    }

    console.log('[OpenCode Obsidian] Settings loaded from storage:', loadedData)
  }

  /**
   * Migrate old settings format (single apiKey) to new format (apiKeys object)
   */
  private migrateSettings() {
    if (this.settings.apiKey && this.settings.apiKey.trim() !== '') {
      // Migrate old apiKey to apiKeys object
      if (!this.settings.apiKeys[this.settings.providerID]) {
        this.settings.apiKeys[this.settings.providerID] = this.settings.apiKey
        console.log(`[OpenCode Obsidian] Migrated API key to ${this.settings.providerID} provider`)
        
        // Save migrated settings
        this.saveSettings().then(() => {
          new Notice(`Settings migrated: API key moved to ${this.settings.providerID} provider`)
        })
      }
      
      // Clear old apiKey field
      delete this.settings.apiKey
    }
  }

  async saveSettings() {
    await this.saveData(this.settings)
  }

  /**
   * Debounced version of saveSettings for use in frequently-triggered callbacks
   * (e.g., input field onChange handlers)
   */
  debouncedSaveSettings = debounceAsync(async () => {
    await this.saveSettings()
  }, UI_CONFIG.DEBOUNCE_DELAY)

  /**
   * Load TUI features from .opencode/config.json
   * Loads compatible providers and agents
   */
  private async loadTUIFeatures() {
    if (!this.configLoader) {
      console.warn('[OpenCode Obsidian] Config loader not initialized, skipping TUI features')
      return
    }
    
    try {
      // Load compatible providers from config
      const compatibleProviders = await this.configLoader.loadCompatibleProviders(this.settings.apiKeys)
      
      if (compatibleProviders.length > 0) {
        // Initialize compatibleProviders array if it doesn't exist
        if (!this.settings.compatibleProviders) {
          this.settings.compatibleProviders = []
        }
        
        // Merge loaded providers with existing ones
        // Keep existing API keys if they're already set
        for (const loadedProvider of compatibleProviders) {
          const existingProvider = this.settings.compatibleProviders.find(p => p.id === loadedProvider.id)
          
          if (existingProvider) {
            // Update existing provider with new config, but keep existing API key if it's set
            existingProvider.name = loadedProvider.name
            existingProvider.baseURL = loadedProvider.baseURL
            existingProvider.apiType = loadedProvider.apiType
            existingProvider.defaultModel = loadedProvider.defaultModel || existingProvider.defaultModel
            
            // Only update API key if it's not already set (from settings)
            if (!existingProvider.apiKey || existingProvider.apiKey.trim() === '') {
              existingProvider.apiKey = loadedProvider.apiKey
              // Also store in apiKeys for backward compatibility
              this.settings.apiKeys[existingProvider.id] = loadedProvider.apiKey
            }
          } else {
            // Add new provider
            this.settings.compatibleProviders.push(loadedProvider)
            // Also store API key in apiKeys object if provided
            if (loadedProvider.apiKey) {
              this.settings.apiKeys[loadedProvider.id] = loadedProvider.apiKey
            }
          }
        }
        
        // Remove providers that are no longer in config (optional - might want to keep them)
        // For now, we keep them but they won't be initialized if API key is missing
        
        console.log(`[OpenCode Obsidian] Loaded ${compatibleProviders.length} compatible provider(s) from config`)
        
        // Save updated settings
        await this.saveSettings()
      } else {
        console.log('[OpenCode Obsidian] No compatible providers found in config')
      }

      // Load agents from .opencode/agent/*.md files
      const loadedAgents = await this.configLoader.loadAgents()
      
      if (loadedAgents.length > 0) {
        // Store loaded agents in settings
        this.settings.agents = loadedAgents
        // Update agent resolver
        this.agentResolver.setAgents(loadedAgents)
        console.log(`[OpenCode Obsidian] Loaded ${loadedAgents.length} agent(s) from .opencode/agent/`)
        
        // Save updated settings
        await this.saveSettings()
      } else {
        console.log('[OpenCode Obsidian] No agents found in .opencode/agent/')
        // Keep existing agents if any, or set to empty array
        if (!this.settings.agents) {
          this.settings.agents = []
        }
        // Update agent resolver with existing agents
        this.agentResolver.setAgents(this.settings.agents)
      }

      // Load skills from .opencode/skill/{skill-name}/SKILL.md files
      const loadedSkills = await this.configLoader.loadSkills()
      
      if (loadedSkills.length > 0) {
        // Store loaded skills in settings
        this.settings.skills = loadedSkills
        // Update agent resolver
        this.agentResolver.setSkills(loadedSkills)
        console.log(`[OpenCode Obsidian] Loaded ${loadedSkills.length} skill(s) from .opencode/skill/`)
        
        // Save updated settings
        await this.saveSettings()
      } else {
        console.log('[OpenCode Obsidian] No skills found in .opencode/skill/')
        // Keep existing skills if any, or set to empty array
        if (!this.settings.skills) {
          this.settings.skills = []
        }
        // Update agent resolver with existing skills
        this.agentResolver.setSkills(this.settings.skills)
      }

      // Update agent resolver with config loader
      this.agentResolver.setConfigLoader(this.configLoader)

      // Load instructions from config.json and settings
      const instructions = await this.configLoader.loadInstructions(this.settings.instructions)
      if (instructions) {
        console.log(`[OpenCode Obsidian] Loaded instructions (${instructions.length} chars)`)
      } else {
        console.log('[OpenCode Obsidian] No instructions found in config or settings')
      }
    } catch (error) {
      this.errorHandler.handleError(error, {
        module: 'OpenCodeObsidianPlugin',
        function: 'loadTUIFeatures',
        operation: 'Loading TUI features'
      }, ErrorSeverity.Error)
    }
  }

  async activateView() {
    const { workspace } = this.app

    let leaf = workspace.getLeavesOfType(VIEW_TYPE_OPENCODE_OBSIDIAN)[0]

    if (!leaf) {
      // Create new leaf in right sidebar
      const rightLeaf = workspace.getRightLeaf(false)
      if (rightLeaf) {
        await rightLeaf.setViewState({
          type: VIEW_TYPE_OPENCODE_OBSIDIAN,
          active: true
        })
        leaf = rightLeaf
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf)
    }
  }


  getActiveView(): OpenCodeObsidianView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_OPENCODE_OBSIDIAN)
    if (leaves.length > 0 && leaves[0]) {
      return leaves[0].view as OpenCodeObsidianView
    }
    return null
  }

  async sendPrompt(
    providerID: 'anthropic' | 'openai' | 'google' | 'zenmux' | string,
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
  ): Promise<AsyncGenerator<ResponseChunk>> {
    // Use settings defaults if not provided
    // Ensure model providerID matches the providerID parameter
    const defaultModel = options.model || this.settings.model
    const finalModel = defaultModel.providerID === providerID 
      ? defaultModel 
      : { providerID, modelID: this.settings.model.modelID }
    
    // Resolve agent configuration using AgentResolver
    const agentID = options.agent || this.settings.agent
    const resolvedConfig = this.agentResolver.resolveAgentConfig(
      {
        agentID,
        systemPrompt: options.system,
        model: finalModel,
        tools: options.tools
      },
      finalModel
    )
    
    const finalOptions = {
      model: resolvedConfig.model,
      agent: agentID,
      system: resolvedConfig.systemPrompt,
      tools: resolvedConfig.tools,
      ...options
    }

    return this.providerManager.sendPrompt(providerID, prompt, finalOptions)
  }
}
