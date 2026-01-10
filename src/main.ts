import { Plugin, Notice } from 'obsidian'
import { OpenCodeObsidianView, VIEW_TYPE_OPENCODE_OBSIDIAN } from './opencode-obsidian-view'
import { OpenCodeObsidianSettingTab } from './settings'
import type { OpenCodeObsidianSettings } from './types'
import { ConfigLoader } from './config-loader'
import { HookRegistry } from './hooks/hook-registry'
import { CONTEXT_CONFIG, UI_CONFIG } from './utils/constants'
import { AgentResolver } from './agent/agent-resolver'
import { ErrorHandler, ErrorSeverity } from './utils/error-handler'
import { debounceAsync } from './utils/debounce-throttle'

const DEFAULT_SETTINGS: OpenCodeObsidianSettings = {
  agent: 'assistant',
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
  // OpenCode Server configuration (required)
  opencodeServer: {
    url: 'ws://localhost:4096',
    autoReconnect: true,
    reconnectDelay: 3000,
    reconnectMaxAttempts: 10
  },
  // Tool permission level (default: read-only for safety)
  toolPermission: 'read-only',
  // Permission scope (default: no restrictions for read-only)
  permissionScope: undefined,
}

export default class OpenCodeObsidianPlugin extends Plugin {
  settings: OpenCodeObsidianSettings
  configLoader: ConfigLoader | null = null
  hookRegistry: HookRegistry
  agentResolver: AgentResolver
  errorHandler: ErrorHandler

  async onload() {
    console.debug('[OpenCode Obsidian] Plugin loading...')
    
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
      console.debug('[OpenCode Obsidian] Error handler initialized')
      
      // Initialize hook registry first
      this.hookRegistry = new HookRegistry(this.errorHandler)
      console.debug('[OpenCode Obsidian] Hook registry initialized')
      
      // Initialize agent resolver
      this.agentResolver = new AgentResolver()
      console.debug('[OpenCode Obsidian] Agent resolver initialized')
      
      await this.loadSettings()
      
      // Disable hooks as specified in settings
      if (this.settings.disabledHooks) {
        for (const hookId of this.settings.disabledHooks) {
          this.hookRegistry.disableHook(hookId)
        }
        console.debug(`[OpenCode Obsidian] Disabled hooks: ${this.settings.disabledHooks.join(', ')}`)
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
      
      console.debug('[OpenCode Obsidian] Settings loaded:', {
        agent: this.settings.agent,
        opencodeServer: this.settings.opencodeServer?.url || 'not configured'
      })

    // Register the main view
    this.registerView(
      VIEW_TYPE_OPENCODE_OBSIDIAN,
      (leaf) => new OpenCodeObsidianView(leaf, this)
    )
    console.debug('[OpenCode Obsidian] View registered:', VIEW_TYPE_OPENCODE_OBSIDIAN)

    // Add ribbon icon
    this.addRibbonIcon('bot', 'Open opencode', () => {
      void this.activateView()
    })
    console.debug('[OpenCode Obsidian] Ribbon icon added')

    // Add command to open view
    this.addCommand({
      id: 'open-view',
      name: 'Open chat view',
      callback: () => {
        void this.activateView()
      }
    })
    console.debug('[OpenCode Obsidian] Command registered: open-view')

      // Add settings tab
      this.addSettingTab(new OpenCodeObsidianSettingTab(this.app, this))
      console.debug('[OpenCode Obsidian] Settings tab added')
      
      console.debug('[OpenCode Obsidian] Plugin loaded successfully ✓')
    } catch (error) {
      if (this.errorHandler) {
        this.errorHandler.handleError(error, {
          module: 'OpenCodeObsidianPlugin',
          function: 'onload',
          operation: 'Plugin loading'
        }, ErrorSeverity.Critical)
      } else {
        console.error('[OpenCode Obsidian] Failed to load plugin:', error)
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        new Notice('Failed to load OpenCode Obsidian plugin. Check console for details.')
      }
      throw error // Re-throw to let Obsidian handle the error
    }
  }

  onunload() {
    console.debug('[OpenCode Obsidian] Plugin unloading...')
    console.debug('[OpenCode Obsidian] Plugin unloaded')
  }

  async loadSettings() {
    const loadedData = await this.loadData() as Partial<OpenCodeObsidianSettings> | null
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData ?? {})
    
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

    // Ensure OpenCode Server configuration exists
    if (!this.settings.opencodeServer) {
      this.settings.opencodeServer = {
        url: 'ws://localhost:4096',
        autoReconnect: true,
        reconnectDelay: 3000,
        reconnectMaxAttempts: 10
      }
    }

    console.debug('[OpenCode Obsidian] Settings loaded from storage:', loadedData)
  }

  /**
   * Migrate old settings format to new format
   * - Initializes OpenCode Server and permission settings with defaults if not present
   */
  private migrateSettings() {
    let needsSave = false

    // Initialize OpenCode Server configuration with defaults if not present
    if (!this.settings.opencodeServer) {
      this.settings.opencodeServer = {
        url: 'ws://localhost:4096',
        autoReconnect: true,
        reconnectDelay: 3000,
        reconnectMaxAttempts: 10
      }
      needsSave = true
      console.debug('[OpenCode Obsidian] Initialized OpenCode Server configuration with defaults')
    }

    // Initialize tool permission level if not present (default: read-only)
    if (!this.settings.toolPermission) {
      this.settings.toolPermission = 'read-only'
      needsSave = true
      console.debug('[OpenCode Obsidian] Initialized tool permission: read-only (default)')
    }

    // Initialize permission scope if toolPermission is set but scope is not
    if (this.settings.toolPermission && !this.settings.permissionScope) {
      // Permission scope defaults are applied at runtime based on permission level
      // We don't need to set defaults here - they're handled by PermissionManager
      console.debug('[OpenCode Obsidian] Permission scope will use defaults based on permission level')
    }

    // Save migrated settings if needed
    if (needsSave) {
      void this.saveSettings()
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
      // TODO: Compatible providers are now managed by OpenCode Server
      // No need to load providers from config in the plugin

      // Load agents from .opencode/agent/*.md files
      const loadedAgents = await this.configLoader.loadAgents()
      
      if (loadedAgents.length > 0) {
        // Store loaded agents in settings
        this.settings.agents = loadedAgents
        // Update agent resolver
        this.agentResolver.setAgents(loadedAgents)
        console.debug(`[OpenCode Obsidian] Loaded ${loadedAgents.length} agent(s) from .opencode/agent/`)
        
        // Save updated settings
        await this.saveSettings()
      } else {
        console.debug('[OpenCode Obsidian] No agents found in .opencode/agent/')
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
        console.debug(`[OpenCode Obsidian] Loaded ${loadedSkills.length} skill(s) from .opencode/skill/`)
        
        // Save updated settings
        await this.saveSettings()
      } else {
        console.debug('[OpenCode Obsidian] No skills found in .opencode/skill/')
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
        console.debug(`[OpenCode Obsidian] Loaded instructions (${instructions.length} chars)`)
      } else {
        console.debug('[OpenCode Obsidian] No instructions found in config or settings')
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
      void workspace.revealLeaf(leaf)
    }
  }


  getActiveView(): OpenCodeObsidianView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_OPENCODE_OBSIDIAN)
    if (leaves.length > 0 && leaves[0]) {
      return leaves[0].view as OpenCodeObsidianView
    }
    return null
  }

  // TODO: Implement OpenCode Server client for sendPrompt
  // This method should connect to OpenCode Server via WebSocket and send prompts
  // For now, this is a placeholder that will be implemented with OpenCode Server client
}
