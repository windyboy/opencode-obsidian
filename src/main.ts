import { Plugin, WorkspaceLeaf, Notice } from 'obsidian'
import { type ResponseChunk } from './embedded-ai-client'
import { ProviderManager } from './provider-manager'
import { OpenCodeObsidianView, VIEW_TYPE_OPENCODE_OBSIDIAN } from './opencode-obsidian-view'
import { OpenCodeObsidianSettingTab } from './settings'
import type { OpenCodeObsidianSettings } from './types'
import { ConfigLoader } from './config-loader'

const DEFAULT_SETTINGS: OpenCodeObsidianSettings = {
  apiKeys: {},
  providerID: 'anthropic',
  agent: 'assistant',
  model: {
    providerID: 'anthropic',
    modelID: 'claude-3-5-sonnet-20241022'
  },
  instructions: []
}

export default class OpenCodeObsidianPlugin extends Plugin {
  settings: OpenCodeObsidianSettings
  providerManager: ProviderManager
  configLoader: ConfigLoader | null = null

  async onload() {
    console.log('[OpenCode Obsidian] Plugin loading...')
    
    try {
      await this.loadSettings()
      
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
            console.error('[OpenCode Obsidian] Error loading TUI features (non-fatal):', error)
            // Continue loading plugin even if TUI features fail to load
          }
        } else {
          console.warn('[OpenCode Obsidian] Vault not available, skipping config loader initialization')
        }
      } catch (error) {
        console.error('[OpenCode Obsidian] Error initializing config loader (non-fatal):', error)
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
      })
    
    const availableProviders = this.providerManager.getAvailableProviders()
    if (availableProviders.length === 0) {
      console.warn('[OpenCode Obsidian] No API keys configured')
      new Notice('Please configure at least one API key in settings')
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
      console.error('[OpenCode Obsidian] Failed to load plugin:', error)
      new Notice('Failed to load OpenCode Obsidian plugin. Check console for details.')
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
        console.log(`[OpenCode Obsidian] Loaded ${loadedAgents.length} agent(s) from .opencode/agent/`)
        
        // Save updated settings
        await this.saveSettings()
      } else {
        console.log('[OpenCode Obsidian] No agents found in .opencode/agent/')
        // Keep existing agents if any, or set to empty array
        if (!this.settings.agents) {
          this.settings.agents = []
        }
      }

      // Load skills from .opencode/skill/{skill-name}/SKILL.md files
      const loadedSkills = await this.configLoader.loadSkills()
      
      if (loadedSkills.length > 0) {
        // Store loaded skills in settings
        this.settings.skills = loadedSkills
        console.log(`[OpenCode Obsidian] Loaded ${loadedSkills.length} skill(s) from .opencode/skill/`)
        
        // Save updated settings
        await this.saveSettings()
      } else {
        console.log('[OpenCode Obsidian] No skills found in .opencode/skill/')
        // Keep existing skills if any, or set to empty array
        if (!this.settings.skills) {
          this.settings.skills = []
        }
      }

      // Load instructions from config.json and settings
      const instructions = await this.configLoader.loadInstructions(this.settings.instructions)
      if (instructions) {
        console.log(`[OpenCode Obsidian] Loaded instructions (${instructions.length} chars)`)
      } else {
        console.log('[OpenCode Obsidian] No instructions found in config or settings')
      }
    } catch (error) {
      console.error('[OpenCode Obsidian] Error loading TUI features:', error)
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
    
    // Look up agent by ID if provided
    const agentID = options.agent || this.settings.agent
    let systemPrompt = options.system
    let agentModel = finalModel
    let agentTools = options.tools
    
    // Check if agent exists in loaded agents
    if (this.settings.agents && this.settings.agents.length > 0) {
      const agent = this.settings.agents.find(a => a.id === agentID)
      
      if (agent) {
        // Use agent's system prompt
        systemPrompt = agent.systemPrompt
        
        // Override model if agent has specific model
        if (agent.model) {
          agentModel = agent.model
        }
        
        // Apply agent's tools configuration (merge with options.tools if provided)
        if (agent.tools) {
          agentTools = { ...agent.tools, ...(options.tools || {}) }
        }
        
        // Merge referenced skills into system prompt
        if (agent.skills && agent.skills.length > 0 && this.settings.skills) {
          const skillContents: string[] = []
          for (const skillId of agent.skills) {
            const skill = this.settings.skills.find(s => s.id === skillId)
            if (skill && skill.content) {
              skillContents.push(`\n\n---\n# Skill: ${skill.name}\n---\n\n${skill.content}`)
            } else {
              console.warn(`[OpenCode Obsidian] Skill "${skillId}" referenced by agent "${agentID}" not found`)
            }
          }
          if (skillContents.length > 0) {
            systemPrompt = systemPrompt + skillContents.join('')
          }
        }
      } else {
        // Agent not found in loaded agents, fallback to default behavior
        // Use agent ID as system prompt (legacy behavior)
        if (!systemPrompt) {
          systemPrompt = agentID
        }
      }
    } else {
      // No agents loaded, use legacy behavior
      if (!systemPrompt) {
        systemPrompt = agentID
      }
    }
    
    // Merge instructions into system prompt if available
    if (this.configLoader) {
      const instructions = this.configLoader.getCachedInstructions()
      if (instructions && instructions.trim()) {
        // Append instructions to system prompt
        // Instructions are already formatted with separators in loadInstructions()
        systemPrompt = systemPrompt 
          ? `${systemPrompt}\n\n${instructions}`
          : instructions
      }
    }
    
    const finalOptions = {
      model: agentModel,
      agent: agentID,
      system: systemPrompt,
      tools: agentTools,
      ...options
    }

    return this.providerManager.sendPrompt(providerID, prompt, finalOptions)
  }
}
