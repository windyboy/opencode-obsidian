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

    // Instructions/Rules section - removed, managed by OpenCode Server

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

    // Tool Permission section
    new Setting(containerEl).setName("Tool permissions").setHeading()
    containerEl.createEl('p', {
      text: 'Configure tool execution permissions for safety.',
      cls: 'setting-item-description'
    })

    // Tool permission level
    new Setting(containerEl)
      .setName('Tool permission level')
      .setDesc('Control what tools can do: read-only (safest), scoped-write (selected paths), or full-write (all files).')
      .addDropdown(dropdown => {
        dropdown
          .addOption('read-only', 'Read-only (safest)')
          .addOption('scoped-write', 'Scoped write')
          .addOption('full-write', 'Full write')
          .setValue(this.plugin.settings.toolPermission || 'read-only')
          .onChange(async (value) => {
            this.plugin.settings.toolPermission = value as 'read-only' | 'scoped-write' | 'full-write'
            await this.plugin.saveSettings()
            new Notice('Tool permission updated')
          })
      })
  }

}
