import { App, PluginSettingTab, Setting, Notice } from 'obsidian'
import type OpenCodeObsidianPlugin from './main'

export class OpenCodeObsidianSettingTab extends PluginSettingTab {
  plugin: OpenCodeObsidianPlugin

  constructor(app: App, plugin: OpenCodeObsidianPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()

    

    // OpenCode Server Configuration section
    // eslint-disable-next-line obsidianmd/ui/sentence-case
    new Setting(containerEl).setName("OpenCode server").setHeading()
    containerEl.createEl('p', { 
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      text: 'Configure connection to OpenCode server. Providers and API keys are managed on the server side.',
      cls: 'setting-item-description'
    })

    // OpenCode Server URL
    new Setting(containerEl)
      .setName('Server URL')
      .setDesc('WebSocket URL for OpenCode server (e.g., ws://localhost:4096).')
      .addText(text => {
        text.setPlaceholder('Ws://localhost:4096')
          .setValue(this.plugin.settings.opencodeServer?.url || '')
        text.onChange(async (value: string) => {
          if (!this.plugin.settings.opencodeServer) {
            this.plugin.settings.opencodeServer = {
              url: value.trim(),
              autoReconnect: true,
              reconnectDelay: 3000,
              reconnectMaxAttempts: 10
            }
          } else {
            this.plugin.settings.opencodeServer.url = value.trim()
          }
          await this.plugin.debouncedSaveSettings()
        })
      })

    // OpenCode Server Token (optional)
    new Setting(containerEl)
      .setName('Authentication token (optional)')
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc('Optional authentication token for OpenCode server.')
      .addText(text => {
        text.setPlaceholder('Enter token')
          .setValue(this.plugin.settings.opencodeServer?.token || '')
        text.inputEl.type = 'password'
        text.onChange(async (value: string) => {
          if (!this.plugin.settings.opencodeServer) {
            this.plugin.settings.opencodeServer = {
              url: 'ws://localhost:4096',
              autoReconnect: true,
              reconnectDelay: 3000,
              reconnectMaxAttempts: 10
            }
          }
          this.plugin.settings.opencodeServer.token = value.trim() || undefined
          await this.plugin.debouncedSaveSettings()
        })
      })

    // Instructions/Rules section
    new Setting(containerEl).setName("Instructions / rules").setHeading()
    containerEl.createEl('p', {
      text: 'Configure instruction files or glob patterns to be merged into system prompts. Instructions from .opencode/config.json are automatically included.',
      cls: 'setting-item-description'
    })

    // Instructions list container
    const instructionsContainer = containerEl.createDiv('opencode-obsidian-instructions-container')
    
    // Display current instructions
    this.displayInstructionsList(instructionsContainer)

    // Add new instruction input
    const addInstructionSetting = new Setting(instructionsContainer)
      .setName('Add instruction')
      .setDesc('Enter a file path or glob pattern (e.g., ".opencode/rules.md" or "docs/**/*.md").')
      .addText(text => {
        text.setPlaceholder('.opencode/rules.md or **/*.md')
        // eslint-disable-next-line obsidianmd/no-static-styles-assignment
        text.inputEl.style.width = '100%'
      })
      .addButton(button => {
        button.setButtonText('Add')
        button.setCta()
        button.onClick(async () => {
          const input = addInstructionSetting.controlEl.querySelector('input') as HTMLInputElement
          const value = input?.value.trim()
          if (value) {
            // Initialize instructions array if needed
            if (!this.plugin.settings.instructions) {
              this.plugin.settings.instructions = []
            }
            
            // Add if not already present
            if (!this.plugin.settings.instructions.includes(value)) {
              this.plugin.settings.instructions.push(value)
              await this.plugin.saveSettings()
              
              // Reload instructions
              if (this.plugin.configLoader) {
                await this.plugin.configLoader.loadInstructions(this.plugin.settings.instructions)
                // Clear cache to force reload
                this.plugin.configLoader.clearInstructionCache()
                await this.plugin.configLoader.loadInstructions(this.plugin.settings.instructions)
              }
              
              // Refresh UI
              this.displayInstructionsList(instructionsContainer)
              input.value = ''
              new Notice('Instruction added')
            } else {
              new Notice('Instruction already exists')
            }
          }
        })
      })

    // Agent setting
    const agentSetting = new Setting(containerEl)
      .setName('Default agent')
      .setDesc('The default agent to use for conversations.')
    
    // Build agent dropdown dynamically
    agentSetting.addDropdown(dropdown => {
      // Default agents (fallback if no custom agents loaded)
      const defaultAgents: Array<{ id: string; name: string }> = [
        { id: 'assistant', name: 'Assistant' },
        { id: 'bootstrap', name: 'Bootstrap' },
        { id: 'thinking-partner', name: 'Thinking Partner' },
        { id: 'research-assistant', name: 'Research Assistant' },
        { id: 'read-only', name: 'Read Only' }
      ]
      
      // Get loaded agents (filter out hidden ones)
      const loadedAgents = this.plugin.settings.agents?.filter(a => !a.hidden) || []
      
      // Use loaded agents if available, otherwise use defaults
      const agentsToShow = loadedAgents.length > 0 ? loadedAgents : defaultAgents
      
      // Add agents to dropdown
      agentsToShow.forEach(agent => {
        let displayName = agent.name
        if ('description' in agent && agent.description) {
          const desc = typeof agent.description === 'string' 
            ? agent.description 
            : JSON.stringify(agent.description)
          displayName = `${agent.name} - ${desc}`
        }
        dropdown.addOption(agent.id, displayName)
      })
      
      // Set current value (ensure it exists in options)
      const currentValue = this.plugin.settings.agent
      if (agentsToShow.some(a => a.id === currentValue)) {
        dropdown.setValue(currentValue)
      } else if (agentsToShow.length > 0 && agentsToShow[0]) {
        // If current agent not found, use first available
        dropdown.setValue(agentsToShow[0].id)
        this.plugin.settings.agent = agentsToShow[0].id
        void this.plugin.saveSettings()
      }
      
      dropdown.onChange(async (value) => {
        this.plugin.settings.agent = value
        // Use debounced save for dropdown changes
        await this.plugin.debouncedSaveSettings()
      })
    })
    
    // Add info message if agents are loaded from .opencode/agent/
    if (this.plugin.settings.agents && this.plugin.settings.agents.length > 0) {
      agentSetting.setDesc(
        `The default agent to use for conversations. ${this.plugin.settings.agents.length} agent(s) loaded from .opencode/agent/ directory.`
      )
    }

    // TODO: Provider and model selection should be handled by OpenCode Server
    // Providers and models are managed server-side, not in the plugin

    // TODO: Connection status should be displayed from OpenCode Server client

    // Hook Configuration section
    new Setting(containerEl).setName("Hook configuration").setHeading()
    containerEl.createEl('p', {
      text: 'Configure hooks that intercept and modify AI interactions. Disable hooks to prevent automatic behaviors.',
      cls: 'setting-item-description'
    })

    // Disabled hooks
    new Setting(containerEl)
      .setName('Disabled hooks')
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc('Comma-separated list of hook IDs to disable (e.g., "tool-output-truncator, preemptive-compaction").')
      .addText(text => {
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        text.setPlaceholder('tool-output-truncator, preemptive-compaction')
          .setValue((this.plugin.settings.disabledHooks || []).join(', '))
        // eslint-disable-next-line obsidianmd/no-static-styles-assignment
        text.inputEl.style.width = '100%'
        text.onChange(async (value: string) => {
          const hooks = value.split(',').map(h => h.trim()).filter(h => h.length > 0)
          this.plugin.settings.disabledHooks = hooks.length > 0 ? hooks : undefined
          await this.plugin.saveSettings()
          
          // Update hook registry
          if (this.plugin.hookRegistry) {
            // Re-enable all hooks first
            const allHooks = this.plugin.hookRegistry.getAllHooks()
            for (const hook of allHooks) {
              this.plugin.hookRegistry.enableHook(hook.id)
            }
            // Then disable specified hooks
            for (const hookId of hooks) {
              this.plugin.hookRegistry.disableHook(hookId)
            }
          }
          
          new Notice('Hook configuration updated')
        })
      })

    // Context Management section
    new Setting(containerEl).setName("Context management").setHeading()
    containerEl.createEl('p', {
      text: 'Configure how context window is managed to prevent token limit overflow.',
      cls: 'setting-item-description'
    })

    // Preemptive compaction threshold
    new Setting(containerEl)
      .setName('Preemptive compaction threshold')
      .setDesc('Trigger compression when context usage reaches this percentage (default: 85%).')
      .addSlider(slider => {
        slider
          .setLimits(50, 95, 5)
          .setValue((this.plugin.settings.contextManagement?.preemptiveCompactionThreshold ?? 0.85) * 100)
          .setDynamicTooltip()
          .onChange(async (value: number) => {
            if (!this.plugin.settings.contextManagement) {
              this.plugin.settings.contextManagement = {}
            }
            this.plugin.settings.contextManagement.preemptiveCompactionThreshold = value / 100
            await this.plugin.saveSettings()
          })
      })

    // Max context tokens
    new Setting(containerEl)
      .setName('Max context tokens')
      .setDesc('Maximum context window size in tokens (default: 50000).')
      .addText(text => {
        text.setPlaceholder('50000')
          .setValue(String(this.plugin.settings.contextManagement?.maxContextTokens ?? 50000))
        text.inputEl.type = 'number'
        text.onChange(async (value: string) => {
          const numValue = parseInt(value, 10)
          if (!isNaN(numValue) && numValue > 0) {
            if (!this.plugin.settings.contextManagement) {
              this.plugin.settings.contextManagement = {}
            }
            this.plugin.settings.contextManagement.maxContextTokens = numValue
            await this.plugin.saveSettings()
          }
        })
      })

    // Enable token estimation
    new Setting(containerEl)
      .setName('Enable token estimation')
      .setDesc('Estimate token usage for context management (recommended).')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.contextManagement?.enableTokenEstimation ?? true)
        toggle.onChange(async (value: boolean) => {
          if (!this.plugin.settings.contextManagement) {
            this.plugin.settings.contextManagement = {}
          }
          this.plugin.settings.contextManagement.enableTokenEstimation = value
          await this.plugin.saveSettings()
        })
      })

    // TODO Management section
    new Setting(containerEl).setName("Todo management").setHeading()
    containerEl.createEl('p', {
      text: 'Configure automatic todo tracking and continuation.',
      cls: 'setting-item-description'
    })

    // Enable TODO management
    new Setting(containerEl)
      .setName('Enable todo management')
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc('Automatically extract and track TODOs from conversations.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.todoManagement?.enabled ?? true)
        toggle.onChange(async (value: boolean) => {
          if (!this.plugin.settings.todoManagement) {
            this.plugin.settings.todoManagement = {}
          }
          this.plugin.settings.todoManagement.enabled = value
          await this.plugin.saveSettings()
        })
      })

    // Auto-continue TODOs
    new Setting(containerEl)
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setName('Auto-continue TODOs')
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc('Automatically prompt agent to continue unfinished TODOs when it stops.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.todoManagement?.autoContinue ?? true)
        toggle.onChange(async (value: boolean) => {
          if (!this.plugin.settings.todoManagement) {
            this.plugin.settings.todoManagement = {}
          }
          this.plugin.settings.todoManagement.autoContinue = value
          await this.plugin.saveSettings()
        })
      })

    // Respect user interrupt
    new Setting(containerEl)
      .setName('Respect user interrupt')
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc('Do not auto-continue TODOs if user manually stopped the conversation.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.todoManagement?.respectUserInterrupt ?? true)
        toggle.onChange(async (value: boolean) => {
          if (!this.plugin.settings.todoManagement) {
            this.plugin.settings.todoManagement = {}
          }
          this.plugin.settings.todoManagement.respectUserInterrupt = value
          await this.plugin.saveSettings()
        })
      })

    // MCP Configuration section
    new Setting(containerEl).setName("Mcp servers").setHeading()
    containerEl.createEl('p', {
      text: 'Configure model context protocol servers for enhanced tool capabilities. Mcp integration is experimental.',
      cls: 'setting-item-description'
    })

    containerEl.createEl('p', {
      text: 'Note: full mcp integration is a placeholder and will be implemented in a future update.',
      cls: 'setting-item-description',
      attr: { style: 'color: var(--text-muted); font-style: italic;' }
    })
  }

  // TODO: Provider and model management methods removed
  // These are now handled by OpenCode Server

  /**
   * Display the list of instructions with remove buttons
   */
  private displayInstructionsList(container: HTMLElement) {
    // Remove existing list if any
    const existingList = container.querySelector('.opencode-obsidian-instructions-list')
    if (existingList) {
      existingList.remove()
    }

    const instructions = this.plugin.settings.instructions || []
    
    if (instructions.length === 0) {
      const emptyMsg = container.createDiv('opencode-obsidian-instructions-list')
      emptyMsg.createEl('p', {
        text: 'No custom instructions configured. Instructions from .opencode/config.json will be used if available.',
        cls: 'setting-item-description'
      })
      return
    }

    const listContainer = container.createDiv('opencode-obsidian-instructions-list')
    
    instructions.forEach((instruction, index) => {
      new Setting(listContainer)
        .setName(instruction)
        .setDesc('File path or glob pattern')
        .addButton(button => {
          button.setButtonText('Remove')
          button.setWarning()
          button.onClick(async () => {
            // Remove from array
            this.plugin.settings.instructions = this.plugin.settings.instructions?.filter((_, i) => i !== index) || []
            await this.plugin.saveSettings()
            
            // Reload instructions
            if (this.plugin.configLoader) {
              this.plugin.configLoader.clearInstructionCache()
              await this.plugin.configLoader.loadInstructions(this.plugin.settings.instructions)
            }
            
            // Refresh UI
            this.displayInstructionsList(container)
            new Notice('Instruction removed')
          })
        })
    })

    // Add reload button
    new Setting(listContainer)
      .setName('Reload instructions')
      .setDesc('Reload all instruction files from disk (clears cache)')
      .addButton(button => {
        button.setButtonText('Reload')
        button.setCta()
        button.onClick(async () => {
          if (this.plugin.configLoader) {
            this.plugin.configLoader.clearInstructionCache()
            await this.plugin.configLoader.loadInstructions(this.plugin.settings.instructions)
            new Notice('Instructions reloaded')
          }
        })
      })
  }
}
