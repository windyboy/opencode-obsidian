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

    // 主标题
    containerEl.createEl('h2', { text: 'OpenCode Obsidian Settings' })
    containerEl.createEl('p', {
      text: 'Configure your OpenCode Obsidian plugin settings. Changes are saved automatically.',
      cls: 'setting-item-description'
    })

    // 第一部分：OpenCode Server 配置
    this.renderServerConfiguration(containerEl)

    // 第二部分：Agent 配置
    this.renderAgentConfiguration(containerEl)

    // 第三部分：工具权限配置
    this.renderToolPermissions(containerEl)

    // 第四部分：高级配置（可折叠）
    this.renderAdvancedSettings(containerEl)
  }

  /**
   * 渲染 OpenCode Server 配置部分
   */
  private renderServerConfiguration(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('OpenCode Server').setHeading()

    containerEl.createEl('p', {
      text: 'Configure connection to OpenCode server. Providers and API keys are managed on the server side.',
      cls: 'setting-item-description'
    })

    // Server URL
    new Setting(containerEl)
      .setName('Server URL')
      .setDesc('WebSocket URL for OpenCode server (e.g., ws://localhost:4096 or wss://opencode.example.com)')
      .addText(text => {
        text.setPlaceholder('ws://localhost:4096')
          .setValue(this.plugin.settings.opencodeServer?.url || '')
          .inputEl.classList.add('opencode-setting-url')
        text.onChange(async (value: string) => {
          const trimmedValue = value.trim()
          if (!this.plugin.settings.opencodeServer) {
            this.plugin.settings.opencodeServer = {
              url: trimmedValue,
              autoReconnect: true,
              reconnectDelay: 3000,
              reconnectMaxAttempts: 10
            }
          } else {
            this.plugin.settings.opencodeServer.url = trimmedValue
          }
          
          // 验证 URL 格式
          if (trimmedValue && !this.isValidWebSocketUrl(trimmedValue)) {
            text.inputEl.classList.add('mod-invalid')
          } else {
            text.inputEl.classList.remove('mod-invalid')
          }
          
          await this.plugin.debouncedSaveSettings()
        })
      })
      .addButton(button => {
        button.setButtonText('Test Connection')
          .setTooltip('Test connection to OpenCode server')
          .onClick(async () => {
            button.setDisabled(true)
            button.setButtonText('Testing...')
            
            try {
              // 这里可以添加连接测试逻辑
              await new Promise(resolve => setTimeout(resolve, 1000))
              new Notice('Connection test feature coming soon')
            } catch (error) {
              new Notice(`Connection failed: ${error}`)
            } finally {
              button.setDisabled(false)
              button.setButtonText('Test Connection')
            }
          })
      })

    // Authentication Token (可选)
    new Setting(containerEl)
      .setName('Authentication token')
      .setDesc('Optional authentication token for OpenCode server. Leave empty if not required.')
      .addText(text => {
        text.setPlaceholder('Enter token (optional)')
          .setValue(this.plugin.settings.opencodeServer?.token || '')
          .inputEl.type = 'password'
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
  }

  /**
   * 渲染 Agent 配置部分
   */
  private renderAgentConfiguration(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Agent Configuration').setHeading()

    containerEl.createEl('p', {
      text: 'Select the default agent to use for conversations. Custom agents can be loaded from .opencode/agent/ directory.',
      cls: 'setting-item-description'
    })

    const agentSetting = new Setting(containerEl)
      .setName('Default agent')
      .setDesc(this.getAgentDescription())

    agentSetting.addDropdown(dropdown => {
      const defaultAgents: Array<{ id: string; name: string }> = [
        { id: 'assistant', name: 'Assistant' },
        { id: 'bootstrap', name: 'Bootstrap' },
        { id: 'thinking-partner', name: 'Thinking Partner' },
        { id: 'research-assistant', name: 'Research Assistant' },
        { id: 'read-only', name: 'Read Only' }
      ]

      const loadedAgents = this.plugin.settings.agents?.filter(a => !a.hidden) || []
      const agentsToShow = loadedAgents.length > 0 ? loadedAgents : defaultAgents

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

      const currentValue = this.plugin.settings.agent
      if (agentsToShow.some(a => a.id === currentValue)) {
        dropdown.setValue(currentValue)
      } else if (agentsToShow.length > 0 && agentsToShow[0]) {
        dropdown.setValue(agentsToShow[0].id)
        this.plugin.settings.agent = agentsToShow[0].id
        void this.plugin.saveSettings()
      }

      dropdown.onChange(async (value) => {
        this.plugin.settings.agent = value
        await this.plugin.debouncedSaveSettings()
        agentSetting.setDesc(this.getAgentDescription())
      })
    })
  }

  /**
   * 渲染工具权限配置部分
   */
  private renderToolPermissions(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Tool Permissions').setHeading()

    containerEl.createEl('p', {
      text: 'Configure tool execution permissions for safety. Scoped write allows fine-grained control over file operations.',
      cls: 'setting-item-description'
    })

    // 权限级别选择
    const permissionLevelSetting = new Setting(containerEl)
      .setName('Permission level')
      .setDesc(this.getPermissionLevelDescription())

    permissionLevelSetting.addDropdown(dropdown => {
      dropdown
        .addOption('read-only', 'Read-only (safest)')
        .addOption('scoped-write', 'Scoped write (recommended)')
        .addOption('full-write', 'Full write (advanced)')
        .setValue(this.plugin.settings.toolPermission || 'read-only')
        .onChange(async (value) => {
          this.plugin.settings.toolPermission = value as 'read-only' | 'scoped-write' | 'full-write'
          await this.plugin.saveSettings()
          permissionLevelSetting.setDesc(this.getPermissionLevelDescription())
          
          // 如果切换到 read-only，清除权限作用域配置
          if (value === 'read-only') {
            this.plugin.settings.permissionScope = undefined
          } else if (value === 'scoped-write' && !this.plugin.settings.permissionScope) {
            // 为 scoped-write 初始化默认配置
            this.plugin.settings.permissionScope = {
              allowedPaths: undefined,
              deniedPaths: ['**/.obsidian/**', '**/.git/**', '**/node_modules/**'],
              maxFileSize: 10485760, // 10MB
              allowedExtensions: ['.md', '.txt', '.json', '.yaml', '.yml']
            }
          }
          
          // 重新渲染以更新权限作用域 UI 的可见性
          this.display()
          new Notice('Tool permission level updated')
        })
    })

    // 权限作用域配置（仅在 scoped-write 或 full-write 时显示）
    const showScopeSettings = this.plugin.settings.toolPermission === 'scoped-write' || 
                              this.plugin.settings.toolPermission === 'full-write'

    if (showScopeSettings) {
      this.renderPermissionScope(containerEl)
    }
  }

  /**
   * 渲染权限作用域详细配置
   */
  private renderPermissionScope(containerEl: HTMLElement): void {
    const scope = this.plugin.settings.permissionScope || {}

    // 允许的路径模式
    const allowedPathsSetting = new Setting(containerEl)
      .setName('Allowed paths')
      .setDesc('Glob patterns for allowed paths (e.g., notes/**, docs/*.md). Leave empty to allow all paths (subject to denied paths). One pattern per line.')

    // 创建 textarea 用于多行输入
    const allowedPathsTextarea = allowedPathsSetting.controlEl.createEl('textarea', {
      cls: 'opencode-setting-textarea',
      attr: {
        placeholder: 'notes/**\ndocs/*.md',
        rows: '3'
      }
    })
    allowedPathsTextarea.style.width = '100%'
    allowedPathsTextarea.value = scope.allowedPaths?.join('\n') || ''
    allowedPathsTextarea.onchange = async () => {
      if (!this.plugin.settings.permissionScope) {
        this.plugin.settings.permissionScope = {}
      }
      const paths = allowedPathsTextarea.value.split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0)
      this.plugin.settings.permissionScope!.allowedPaths = paths.length > 0 ? paths : undefined
      await this.plugin.debouncedSaveSettings()
    }

    // 拒绝的路径模式
    const deniedPathsSetting = new Setting(containerEl)
      .setName('Denied paths')
      .setDesc('Glob patterns for denied paths (checked first, always denied). Example: **/.obsidian/**, **/.git/**. One pattern per line.')

    const deniedPathsTextarea = deniedPathsSetting.controlEl.createEl('textarea', {
      cls: 'opencode-setting-textarea',
      attr: {
        placeholder: '**/.obsidian/**\n**/.git/**\n**/node_modules/**',
        rows: '3'
      }
    })
    deniedPathsTextarea.style.width = '100%'
    deniedPathsTextarea.value = scope.deniedPaths?.join('\n') || ''
    deniedPathsTextarea.onchange = async () => {
      if (!this.plugin.settings.permissionScope) {
        this.plugin.settings.permissionScope = {}
      }
      const paths = deniedPathsTextarea.value.split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0)
      this.plugin.settings.permissionScope!.deniedPaths = paths.length > 0 ? paths : undefined
      await this.plugin.debouncedSaveSettings()
    }

    // 最大文件大小
    const maxFileSizeSetting = new Setting(containerEl)
      .setName('Maximum file size')
      .setDesc('Maximum file size in bytes (e.g., 10485760 for 10MB). Leave empty for no limit.')

    maxFileSizeSetting.addText(text => {
      const currentValue = scope.maxFileSize
      text.setPlaceholder('10485760 (10MB)')
        .setValue(currentValue ? currentValue.toString() : '')
      text.inputEl.type = 'number'
      text.inputEl.min = '1'
      text.onChange(async (value: string) => {
        if (!this.plugin.settings.permissionScope) {
          this.plugin.settings.permissionScope = {}
        }
        const numValue = parseInt(value.trim(), 10)
        this.plugin.settings.permissionScope!.maxFileSize = 
          value.trim() && !isNaN(numValue) && numValue > 0 ? numValue : undefined
        await this.plugin.debouncedSaveSettings()
      })
    })

    // 添加帮助按钮
    maxFileSizeSetting.addExtraButton(button => {
      button.setIcon('help')
        .setTooltip('Common sizes: 1024 (1KB), 1048576 (1MB), 10485760 (10MB), 104857600 (100MB)')
        .onClick(() => {
          new Notice('1KB=1024, 1MB=1048576, 10MB=10485760, 100MB=104857600')
        })
    })

    // 允许的文件扩展名
    const allowedExtensionsSetting = new Setting(containerEl)
      .setName('Allowed file extensions')
      .setDesc('Comma-separated list of allowed file extensions (e.g., .md, .txt, .json). Leave empty to allow all extensions.')

    allowedExtensionsSetting.addText(text => {
      text.setPlaceholder('.md, .txt, .json, .yaml')
        .setValue(scope.allowedExtensions?.join(', ') || '')
      text.onChange(async (value: string) => {
        if (!this.plugin.settings.permissionScope) {
          this.plugin.settings.permissionScope = {}
        }
        const extensions = value.split(',')
          .map(e => e.trim())
          .filter(e => e.length > 0)
          .map(e => e.startsWith('.') ? e : `.${e}`)
        this.plugin.settings.permissionScope!.allowedExtensions = extensions.length > 0 ? extensions : undefined
        await this.plugin.debouncedSaveSettings()
      })
    })

    // 添加重置按钮
    allowedExtensionsSetting.addExtraButton(button => {
      button.setIcon('reset')
        .setTooltip('Reset to default')
        .onClick(() => {
          if (this.plugin.settings.permissionScope) {
            this.plugin.settings.permissionScope.allowedExtensions = undefined
            this.display()
            void this.plugin.saveSettings()
          }
        })
    })
  }

  /**
   * 渲染高级设置部分（可折叠）
   */
  private renderAdvancedSettings(containerEl: HTMLElement): void {
    const advancedSection = containerEl.createDiv('opencode-settings-advanced')
    
    const header = advancedSection.createDiv('opencode-settings-advanced-header')
    header.createEl('h3', { text: 'Advanced Settings' })
    
    const toggleButton = header.createEl('button', {
      text: 'Show',
      cls: 'mod-cta'
    })

    const content = advancedSection.createDiv('opencode-settings-advanced-content')
    content.style.display = 'none'

    toggleButton.onclick = () => {
      const isVisible = content.style.display !== 'none'
      content.style.display = isVisible ? 'none' : 'block'
      toggleButton.textContent = isVisible ? 'Show' : 'Hide'
    }

    // 重连配置
    this.renderReconnectionSettings(content)

    // 重置配置按钮
    new Setting(content)
      .setName('Reset to defaults')
      .setDesc('Reset all settings to default values. This cannot be undone.')
      .addButton(button => {
        button.setButtonText('Reset')
          .setWarning()
          .onClick(() => {
            // 这里可以添加确认对话框
            new Notice('Reset functionality coming soon')
          })
      })
  }

  /**
   * 渲染重连设置
   */
  private renderReconnectionSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Reconnection Settings').setHeading()

    containerEl.createEl('p', {
      text: 'Configure automatic reconnection behavior when connection to OpenCode server is lost.',
      cls: 'setting-item-description'
    })

    // 自动重连开关
    new Setting(containerEl)
      .setName('Auto reconnect')
      .setDesc('Automatically attempt to reconnect when connection is lost')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.opencodeServer?.autoReconnect ?? true)
          .onChange(async (value) => {
            if (!this.plugin.settings.opencodeServer) {
              this.plugin.settings.opencodeServer = {
                url: 'ws://localhost:4096',
                autoReconnect: value,
                reconnectDelay: 3000,
                reconnectMaxAttempts: 10
              }
            } else {
              this.plugin.settings.opencodeServer.autoReconnect = value
            }
            await this.plugin.saveSettings()
          })
      })

    // 重连延迟
    new Setting(containerEl)
      .setName('Reconnect delay')
      .setDesc('Delay between reconnection attempts in milliseconds (default: 3000ms, with exponential backoff)')
      .addText(text => {
        const delay = this.plugin.settings.opencodeServer?.reconnectDelay ?? 3000
        text.setPlaceholder('3000')
          .setValue(delay.toString())
        text.inputEl.type = 'number'
        text.inputEl.min = '1000'
        text.onChange(async (value: string) => {
          if (!this.plugin.settings.opencodeServer) {
            this.plugin.settings.opencodeServer = {
              url: 'ws://localhost:4096',
              autoReconnect: true,
              reconnectDelay: 3000,
              reconnectMaxAttempts: 10
            }
          }
          const numValue = parseInt(value.trim(), 10)
          this.plugin.settings.opencodeServer.reconnectDelay = 
            !isNaN(numValue) && numValue >= 1000 ? numValue : 3000
          await this.plugin.debouncedSaveSettings()
        })
      })

    // 最大重连次数
    new Setting(containerEl)
      .setName('Max reconnect attempts')
      .setDesc('Maximum number of reconnection attempts (0 = unlimited, default: 10)')
      .addText(text => {
        const maxAttempts = this.plugin.settings.opencodeServer?.reconnectMaxAttempts ?? 10
        text.setPlaceholder('10')
          .setValue(maxAttempts === 0 ? '0' : maxAttempts.toString())
        text.inputEl.type = 'number'
        text.inputEl.min = '0'
        text.onChange(async (value: string) => {
          if (!this.plugin.settings.opencodeServer) {
            this.plugin.settings.opencodeServer = {
              url: 'ws://localhost:4096',
              autoReconnect: true,
              reconnectDelay: 3000,
              reconnectMaxAttempts: 10
            }
          }
          const trimmed = value.trim()
          const numValue = trimmed === '0' ? 0 : parseInt(trimmed, 10)
          this.plugin.settings.opencodeServer.reconnectMaxAttempts = 
            !isNaN(numValue) && numValue >= 0 ? numValue : 10
          await this.plugin.debouncedSaveSettings()
        })
      })
  }

  /**
   * 辅助方法：验证 WebSocket URL 格式
   */
  private isValidWebSocketUrl(url: string): boolean {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'ws:' || parsed.protocol === 'wss:'
    } catch {
      return false
    }
  }

  /**
   * 获取 Agent 描述文本
   */
  private getAgentDescription(): string {
    const agentCount = this.plugin.settings.agents?.filter(a => !a.hidden).length || 0
    if (agentCount > 0) {
      return `The default agent to use for conversations. ${agentCount} custom agent(s) loaded from .opencode/agent/ directory.`
    }
    return 'The default agent to use for conversations. Create custom agents in .opencode/agent/ directory.'
  }

  /**
   * 获取权限级别描述文本
   */
  private getPermissionLevelDescription(): string {
    const level = this.plugin.settings.toolPermission || 'read-only'
    switch (level) {
      case 'read-only':
        return 'Tools can only read files. No write, create, modify, or delete operations are allowed. (Safest option)'
      case 'scoped-write':
        return 'Tools can write to files within specified paths. Configure allowed/denied paths, file size limits, and extensions below. (Recommended)'
      case 'full-write':
        return 'Tools can write to all files (with minimal safety restrictions). Use with caution. (Advanced users only)'
      default:
        return 'Control what tools can do.'
    }
  }
}
