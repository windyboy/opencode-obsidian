import { App, PluginSettingTab, Setting, Notice } from 'obsidian'
import type OpenCodeObsidianPlugin from './main'
import { ModelSelectorModal } from './model-selector'


export class OpenCodeObsidianSettingTab extends PluginSettingTab {
  plugin: OpenCodeObsidianPlugin
  private modelSetting: Setting | null = null
  private modelCache: Map<string, Array<{ id: string; name?: string }>> = new Map()

  constructor(app: App, plugin: OpenCodeObsidianPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()

    containerEl.createEl('h2', { text: 'OpenCode Obsidian Settings' })

    // API Keys section
    containerEl.createEl('h3', { text: 'API Keys' })
    containerEl.createEl('p', { 
      text: 'Configure API keys for each provider. You can configure multiple providers and switch between them per conversation.',
      cls: 'setting-item-description'
    })

    // Anthropic API Key
    new Setting(containerEl)
      .setName('Anthropic (Claude) API Key')
      .setDesc('Your Anthropic API key (stored securely)')
      .addText(text => {
        text.setPlaceholder('sk-ant-...')
          .setValue(this.plugin.settings.apiKeys.anthropic || '')
        text.inputEl.type = 'password'
        text.onChange(async (value: string) => {
          this.plugin.settings.apiKeys.anthropic = value
          await this.plugin.saveSettings()
          // Update provider manager
          this.plugin.providerManager.updateProviderApiKey('anthropic', value, 
            this.plugin.settings.model.providerID === 'anthropic' ? this.plugin.settings.model.modelID : undefined)
          new Notice('Anthropic API key updated')
        })
      })

    // OpenAI API Key
    new Setting(containerEl)
      .setName('OpenAI (GPT) API Key')
      .setDesc('Your OpenAI API key (stored securely)')
      .addText(text => {
        text.setPlaceholder('sk-...')
          .setValue(this.plugin.settings.apiKeys.openai || '')
        text.inputEl.type = 'password'
        text.onChange(async (value: string) => {
          this.plugin.settings.apiKeys.openai = value
          await this.plugin.saveSettings()
          // Update provider manager
          this.plugin.providerManager.updateProviderApiKey('openai', value,
            this.plugin.settings.model.providerID === 'openai' ? this.plugin.settings.model.modelID : undefined)
          new Notice('OpenAI API key updated')
        })
      })

    // Google API Key
    new Setting(containerEl)
      .setName('Google (Gemini) API Key')
      .setDesc('Your Google API key (stored securely)')
      .addText(text => {
        text.setPlaceholder('AIza...')
          .setValue(this.plugin.settings.apiKeys.google || '')
        text.inputEl.type = 'password'
        text.onChange(async (value: string) => {
          this.plugin.settings.apiKeys.google = value
          await this.plugin.saveSettings()
          // Update provider manager
          this.plugin.providerManager.updateProviderApiKey('google', value,
            this.plugin.settings.model.providerID === 'google' ? this.plugin.settings.model.modelID : undefined)
          new Notice('Google API key updated')
        })
      })

    // ZenMux API Key
    new Setting(containerEl)
      .setName('ZenMux API Key')
      .setDesc('Your ZenMux API key (stored securely). Format: sk-ai-v1-xxx')
      .addText(text => {
        text.setPlaceholder('sk-ai-v1-...')
          .setValue(this.plugin.settings.apiKeys.zenmux || '')
        text.inputEl.type = 'password'
        text.onChange(async (value: string) => {
          this.plugin.settings.apiKeys.zenmux = value
          await this.plugin.saveSettings()
          // Update provider manager with full config to include baseURL
          this.plugin.providerManager.updateConfig({
            apiKeys: this.plugin.settings.apiKeys,
            defaultModel: {
              anthropic: this.plugin.settings.model.providerID === 'anthropic' ? this.plugin.settings.model.modelID : undefined,
              openai: this.plugin.settings.model.providerID === 'openai' ? this.plugin.settings.model.modelID : undefined,
              google: this.plugin.settings.model.providerID === 'google' ? this.plugin.settings.model.modelID : undefined,
              zenmux: this.plugin.settings.model.providerID === 'zenmux' ? this.plugin.settings.model.modelID : undefined
            },
            providerOptions: this.plugin.settings.providerOptions
          })
          // Clear cache and refresh model list if ZenMux is the current provider
          if (this.plugin.settings.providerID === 'zenmux') {
            this.modelCache.delete('zenmux')
            await this.updateModelSetting()
          }
          new Notice('ZenMux API key updated')
        })
      })

    // ZenMux BaseURL Configuration
    new Setting(containerEl)
      .setName('ZenMux API Base URL')
      .setDesc('Custom API endpoint for ZenMux (optional). Default: https://zenmux.ai/api/v1')
      .addText(text => {
        text.setPlaceholder('https://zenmux.ai/api/v1')
          .setValue(this.plugin.settings.providerOptions?.zenmux?.baseURL || '')
        text.onChange(async (value: string) => {
          // Initialize providerOptions if not exists
          if (!this.plugin.settings.providerOptions) {
            this.plugin.settings.providerOptions = {}
          }
          if (!this.plugin.settings.providerOptions.zenmux) {
            this.plugin.settings.providerOptions.zenmux = {}
          }
          
          // Set baseURL if value is not empty, otherwise remove it to use default
          if (value.trim()) {
            this.plugin.settings.providerOptions.zenmux.baseURL = value.trim()
          } else {
            delete this.plugin.settings.providerOptions.zenmux.baseURL
          }
          
          await this.plugin.saveSettings()
          
          // Update provider manager with new config
          this.plugin.providerManager.updateConfig({
            apiKeys: this.plugin.settings.apiKeys,
            defaultModel: {
              anthropic: this.plugin.settings.model.providerID === 'anthropic' ? this.plugin.settings.model.modelID : undefined,
              openai: this.plugin.settings.model.providerID === 'openai' ? this.plugin.settings.model.modelID : undefined,
              google: this.plugin.settings.model.providerID === 'google' ? this.plugin.settings.model.modelID : undefined,
              zenmux: this.plugin.settings.model.providerID === 'zenmux' ? this.plugin.settings.model.modelID : undefined
            },
            providerOptions: this.plugin.settings.providerOptions
          })
          new Notice('ZenMux baseURL updated')
        })
      })

    // Agent setting
    new Setting(containerEl)
      .setName('Default Agent')
      .setDesc('The default agent to use for conversations')
      .addDropdown(dropdown => dropdown
        .addOption('assistant', 'Assistant')
        .addOption('bootstrap', 'Bootstrap')
        .addOption('thinking-partner', 'Thinking Partner')
        .addOption('research-assistant', 'Research Assistant')
        .addOption('read-only', 'Read Only')
        .setValue(this.plugin.settings.agent)
        .onChange(async (value) => {
          this.plugin.settings.agent = value
          await this.plugin.saveSettings()
        })
      )

    // Default Provider setting
    containerEl.createEl('h3', { text: 'Default Settings' })
    
    new Setting(containerEl)
      .setName('Default AI Provider')
      .setDesc('The default provider to use for new conversations')
      .addDropdown(dropdown => dropdown
        .addOption('anthropic', 'Anthropic (Claude)')
        .addOption('openai', 'OpenAI (GPT)')
        .addOption('google', 'Google (Gemini)')
        .addOption('zenmux', 'ZenMux')
        .setValue(this.plugin.settings.providerID)
        .onChange(async (value) => {
          const oldProviderID = this.plugin.settings.providerID
          this.plugin.settings.providerID = value as 'anthropic' | 'openai' | 'google' | 'zenmux'
          
          // If model provider doesn't match new provider, set to default model
          if (this.plugin.settings.model.providerID !== value) {
            const defaultModel = this.getDefaultModelForProvider(value)
            this.plugin.settings.model.modelID = defaultModel
            this.plugin.settings.model.providerID = value
          }
          
          await this.plugin.saveSettings()
          
          // Update model setting UI
          await this.updateModelSetting()
          
          // Update provider manager
          await this.updateProviderManagerModel(value, this.plugin.settings.model.modelID)
          
          new Notice('Default provider updated')
        })
      )

    // Model ID setting with dropdown
    this.createModelSetting(containerEl).catch(error => {
      console.error('[Settings] Failed to create model setting:', error)
      new Notice('Failed to load models. Using fallback list.')
    })

    // Add refresh models button
    new Setting(containerEl)
      .setName('Refresh Models')
      .setDesc('Fetch the latest available models from the API')
      .addButton(button => button
        .setButtonText('Refresh')
        .setCta()
        .onClick(async () => {
          // Clear cache for current provider
          this.modelCache.delete(this.plugin.settings.providerID)
          // Update the setting
          await this.updateModelSetting()
          new Notice('Models refreshed')
        })
      )

    // Client status section
    containerEl.createEl('h3', { text: 'Client Status' })
    
    const statusContainer = containerEl.createDiv('opencode-obsidian-status-container')
    this.displayClientStatus(statusContainer)

    // Refresh status button
    new Setting(statusContainer)
      .addButton(button => button
        .setButtonText('Refresh Status')
        .onClick(() => {
          this.displayClientStatus(statusContainer)
        })
      )
  }

  /**
   * Get default model ID for a provider
   */
  private getDefaultModelForProvider(providerID: string): string {
    switch (providerID) {
      case 'anthropic':
        return 'claude-3-5-sonnet-20241022'
      case 'openai':
        return 'gpt-4o'
      case 'google':
        return 'gemini-pro'
      case 'zenmux':
        return 'x-ai/grok-code-fast-1'
      default:
        return 'claude-3-5-sonnet-20241022'
    }
  }

  /**
   * Update ProviderManager with current model settings
   */
  private async updateProviderManagerModel(providerID: string, modelID: string) {
    this.plugin.providerManager.updateConfig({
      apiKeys: this.plugin.settings.apiKeys,
      defaultModel: {
        anthropic: providerID === 'anthropic' ? modelID : undefined,
        openai: providerID === 'openai' ? modelID : undefined,
        google: providerID === 'google' ? modelID : undefined,
        zenmux: providerID === 'zenmux' ? modelID : undefined
      },
      providerOptions: this.plugin.settings.providerOptions
    })
  }

  private async displayClientStatus(container: HTMLElement) {
    // Clear previous status
    const existingStatus = container.querySelector('.opencode-obsidian-client-status')
    if (existingStatus) {
      existingStatus.remove()
    }

    const statusEl = container.createDiv('opencode-obsidian-client-status')
    
    try {
      const availableProviders = this.plugin.providerManager.getAvailableProviders()
      
      if (availableProviders.length === 0) {
        statusEl.createEl('p', {
          text: '❌ No providers configured. Please configure at least one API key.',
          cls: 'opencode-obsidian-status-bad'
        })
        return
      }

      statusEl.createEl('p', {
        text: `✅ ${availableProviders.length} provider(s) available: ${availableProviders.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')}`,
        cls: 'opencode-obsidian-status-good'
      })

      // Show status for each available provider
      for (const providerID of availableProviders) {
        const client = this.plugin.providerManager.getClient(providerID)
        if (client) {
          const providerStatus = statusEl.createDiv('opencode-obsidian-provider-status')
          providerStatus.createEl('p', {
            text: `${providerID.charAt(0).toUpperCase() + providerID.slice(1)}: ✅ Connected`,
            cls: 'opencode-obsidian-status-info'
          })
        }
      }

      statusEl.createEl('p', {
        text: `Default Provider: ${this.plugin.settings.providerID.charAt(0).toUpperCase() + this.plugin.settings.providerID.slice(1)}`,
        cls: 'opencode-obsidian-status-info'
      })
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      statusEl.createEl('p', {
        text: `❌ Status check failed: ${errorMessage}`,
        cls: 'opencode-obsidian-status-bad'
      })
    }
  }

  private async createModelSetting(containerEl: HTMLElement) {
    const providerID = this.plugin.settings.providerID
    const currentModelID = this.plugin.settings.model.modelID || this.getDefaultModelForProvider(providerID)
    const defaultModel = this.getDefaultModelForProvider(providerID)

    // Primary Model Input - This is the source of truth
    this.modelSetting = new Setting(containerEl)
      .setName('Default Model ID')
      .setDesc('The model ID to use for new conversations')
    
    const inputContainer = this.modelSetting.controlEl.createDiv('opencode-obsidian-model-input-container')
    inputContainer.style.display = 'flex'
    inputContainer.style.gap = '8px'
    
    const modelInput = inputContainer.createEl('input', {
      type: 'text',
      placeholder: `Enter model ID (e.g., ${defaultModel})`,
      cls: 'opencode-obsidian-model-input',
      value: currentModelID
    })
    modelInput.style.flex = '1'
    modelInput.style.padding = '4px 8px'
    modelInput.style.fontFamily = 'var(--font-monospace)'
    modelInput.style.fontSize = '12px'
    modelInput.style.border = '1px solid var(--background-modifier-border)'
    modelInput.style.borderRadius = '4px'
    modelInput.style.background = 'var(--background-primary)'
    modelInput.style.color = 'var(--text-normal)'

    // Select Model Button
    const selectBtn = inputContainer.createEl('button', {
      text: 'Select Model',
      cls: 'opencode-obsidian-model-select-btn'
    })
    selectBtn.onclick = () => {
      new ModelSelectorModal(this.app, this.plugin, async (model) => {
        modelInput.value = model.modelID
        this.plugin.settings.model.modelID = model.modelID
        this.plugin.settings.model.providerID = model.providerID
        await this.plugin.saveSettings()
        await this.updateProviderManagerModel(model.providerID, model.modelID)
        // Trigger input event to update UI
        modelInput.dispatchEvent(new Event('input'))
      }).open()
    }

    // Handle model input changes with debouncing
    let saveTimeout: NodeJS.Timeout | null = null
    modelInput.oninput = async () => {
      const modelID = modelInput.value.trim()
      if (modelID) {
        // Debounce saves
        if (saveTimeout) clearTimeout(saveTimeout)
        saveTimeout = setTimeout(async () => {
          this.plugin.settings.model.modelID = modelID
          this.plugin.settings.model.providerID = providerID
          await this.plugin.saveSettings()
          await this.updateProviderManagerModel(providerID, modelID)
        }, 500)
      }
    }
  }


  private async updateModelSetting() {
    // Find the container (parent of the setting)
    if (!this.modelSetting) return
    const containerEl = this.modelSetting.settingEl.parentElement
    if (!containerEl) return
    
    // Clear cache for this provider to force refresh
    this.modelCache.delete(this.plugin.settings.providerID)
    
    // Remove old settings
    const modelSettingEl = this.modelSetting.settingEl
    modelSettingEl.remove()
    this.modelSetting = null
    
    // Recreate with new provider's models
    await this.createModelSetting(containerEl)
    
    // Update provider manager
    const currentModelID = this.plugin.settings.model.modelID || this.getDefaultModelForProvider(this.plugin.settings.providerID)
    await this.updateProviderManagerModel(this.plugin.settings.providerID, currentModelID)
  }
}
