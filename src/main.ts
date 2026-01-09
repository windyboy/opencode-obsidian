import { Plugin, WorkspaceLeaf, Notice } from 'obsidian'
import { type ResponseChunk } from './embedded-ai-client'
import { ProviderManager } from './provider-manager'
import { OpenCodeObsidianView, VIEW_TYPE_OPENCODE_OBSIDIAN } from './opencode-obsidian-view'
import { OpenCodeObsidianSettingTab } from './settings'
import type { OpenCodeObsidianSettings } from './types'

const DEFAULT_SETTINGS: OpenCodeObsidianSettings = {
  apiKeys: {},
  providerID: 'anthropic',
  agent: 'assistant',
  model: {
    providerID: 'anthropic',
    modelID: 'claude-3-5-sonnet-20241022'
  }
}

export default class OpenCodeObsidianPlugin extends Plugin {
  settings: OpenCodeObsidianSettings
  providerManager: ProviderManager

  async onload() {
    console.log('[OpenCode Obsidian] Plugin loading...')
    
    await this.loadSettings()
    
    // Migrate old settings format if needed
    this.migrateSettings()
    
    console.log('[OpenCode Obsidian] Settings loaded:', {
      providerID: this.settings.providerID,
      agent: this.settings.agent,
      model: this.settings.model,
      availableProviders: Object.keys(this.settings.apiKeys).filter(key => this.settings.apiKeys[key as keyof typeof this.settings.apiKeys])
    })
    
    // Initialize provider manager
    this.providerManager = new ProviderManager({
      apiKeys: this.settings.apiKeys,
      defaultModel: {
        anthropic: this.settings.model.providerID === 'anthropic' ? this.settings.model.modelID : undefined,
        openai: this.settings.model.providerID === 'openai' ? this.settings.model.modelID : undefined,
        google: this.settings.model.providerID === 'google' ? this.settings.model.modelID : undefined,
        zenmux: this.settings.model.providerID === 'zenmux' ? this.settings.model.modelID : undefined
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
    providerID: 'anthropic' | 'openai' | 'google' | 'zenmux',
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
    
    const finalOptions = {
      model: finalModel,
      agent: options.agent || this.settings.agent,
      system: options.system || options.agent || this.settings.agent,
      ...options
    }

    return this.providerManager.sendPrompt(providerID, prompt, finalOptions)
  }
}
