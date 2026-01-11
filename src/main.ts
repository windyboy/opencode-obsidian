import { Plugin, Notice } from 'obsidian'
import { OpenCodeObsidianView, VIEW_TYPE_OPENCODE_OBSIDIAN } from './opencode-obsidian-view'
import { OpenCodeObsidianSettingTab } from './settings'
import type { OpenCodeObsidianSettings } from './types'
import { UI_CONFIG } from './utils/constants'
import { ErrorHandler, ErrorSeverity } from './utils/error-handler'
import { debounceAsync } from './utils/debounce-throttle'
import { OpenCodeServerClient } from './opencode-server/client'
import { ObsidianToolRegistry } from './tools/obsidian/tool-registry'
import { ObsidianToolExecutor } from './tools/obsidian/tool-executor'
import { PermissionManager } from './tools/obsidian/permission-manager'
import { AuditLogger } from './tools/obsidian/audit-logger'
import { ToolPermission } from './tools/obsidian/types'
import type { PermissionScope } from './tools/obsidian/permission-types'

/**
 * Maps string permission level settings to ToolPermission enum values
 */
const PERMISSION_LEVEL_MAP: Record<string, ToolPermission> = {
  'read-only': ToolPermission.ReadOnly,
  'scoped-write': ToolPermission.ScopedWrite,
  'full-write': ToolPermission.FullWrite
}

/**
 * Convert string permission level to ToolPermission enum
 */
function getPermissionLevel(level: string | undefined): ToolPermission {
  return PERMISSION_LEVEL_MAP[level || 'read-only'] ?? ToolPermission.ReadOnly
}

/**
 * Convert settings permission scope to PermissionScope type
 * Returns undefined if no scope is configured
 */
function toPermissionScope(scope: OpenCodeObsidianSettings['permissionScope']): PermissionScope | undefined {
  if (!scope) return undefined
  return {
    allowedPaths: scope.allowedPaths,
    deniedPaths: scope.deniedPaths,
    maxFileSize: scope.maxFileSize,
    allowedExtensions: scope.allowedExtensions
  } as PermissionScope
}

/**
 * Default OpenCode Server configuration
 */
const DEFAULT_SERVER_CONFIG = {
  url: 'ws://localhost:4096',
  autoReconnect: true,
  reconnectDelay: 3000,
  reconnectMaxAttempts: 10
} as const

const DEFAULT_SETTINGS: OpenCodeObsidianSettings = {
  agent: 'assistant',
  instructions: [],
  opencodeServer: { ...DEFAULT_SERVER_CONFIG },
  toolPermission: 'read-only',
  permissionScope: undefined,
}

export default class OpenCodeObsidianPlugin extends Plugin {
  settings: OpenCodeObsidianSettings
  errorHandler: ErrorHandler
  opencodeClient: OpenCodeServerClient | null = null
  toolRegistry: ObsidianToolRegistry | null = null
  permissionManager: PermissionManager | null = null

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
      
      await this.loadSettings()
      
      // Migrate old settings format if needed
      this.migrateSettings()
      
      console.debug('[OpenCode Obsidian] Settings loaded:', {
        agent: this.settings.agent,
        opencodeServer: this.settings.opencodeServer?.url || 'not configured'
      })

      // Initialize tool execution layer
      try {
        if (this.app && this.app.vault) {
          this.permissionManager = new PermissionManager(
            this.app.vault,
            getPermissionLevel(this.settings.toolPermission),
            toPermissionScope(this.settings.permissionScope)
          )
          
          const auditLogger = new AuditLogger(this.app.vault)
          
          const toolExecutor = new ObsidianToolExecutor(
            this.app.vault,
            this.app,
            this.app.metadataCache,
            this.permissionManager,
            auditLogger
          )
          
          this.toolRegistry = new ObsidianToolRegistry(toolExecutor, this.app)
          
          // Initialize OpenCode Server client
          if (this.settings.opencodeServer?.url) {
            this.opencodeClient = new OpenCodeServerClient(
              this.toolRegistry,
              this.app,
              this.errorHandler,
              this.settings.opencodeServer,
              this.permissionManager || undefined
            )
            
            console.debug('[OpenCode Obsidian] OpenCode Server client initialized')
          } else {
            console.warn('[OpenCode Obsidian] OpenCode Server URL not configured')
          }
        }
      } catch (error) {
        this.errorHandler.handleError(error, {
          module: 'OpenCodeObsidianPlugin',
          function: 'onload',
          operation: 'Initializing tool execution layer'
        }, ErrorSeverity.Warning)
        // Continue loading plugin even if tool execution layer fails
      }

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

  onunload(): void {
    console.debug('[OpenCode Obsidian] Plugin unloading...')
    
    // Disconnect from OpenCode Server
    if (this.opencodeClient) {
      void this.opencodeClient.disconnect().then(() => {
        this.opencodeClient = null
      })
    }
    
    console.debug('[OpenCode Obsidian] Plugin unloaded')
  }

  async loadSettings() {
    const loadedData = await this.loadData() as Partial<OpenCodeObsidianSettings> | null
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData ?? {})

    // Ensure OpenCode Server configuration exists
    if (!this.settings.opencodeServer) {
      this.settings.opencodeServer = { ...DEFAULT_SERVER_CONFIG }
    }

    console.debug('[OpenCode Obsidian] Settings loaded from storage:', loadedData)
  }

  /**
   * Migrate old settings format to new format
   */
  private migrateSettings(): void {
    let needsSave = false

    // Initialize OpenCode Server configuration with defaults if not present
    if (!this.settings.opencodeServer) {
      this.settings.opencodeServer = { ...DEFAULT_SERVER_CONFIG }
      needsSave = true
      console.debug('[OpenCode Obsidian] Initialized OpenCode Server configuration with defaults')
    }

    // Initialize tool permission level if not present (default: read-only)
    if (!this.settings.toolPermission) {
      this.settings.toolPermission = 'read-only'
      needsSave = true
      console.debug('[OpenCode Obsidian] Initialized tool permission: read-only (default)')
    }

    if (needsSave) {
      void this.saveSettings()
    }
  }

  async saveSettings() {
    // Update PermissionManager configuration (if initialized)
    if (this.permissionManager) {
      this.permissionManager.setPermissionLevel(getPermissionLevel(this.settings.toolPermission))
      this.permissionManager.setScope(toPermissionScope(this.settings.permissionScope) ?? {} as PermissionScope)
    }

    await this.saveData(this.settings)
  }

  /**
   * Debounced version of saveSettings for use in frequently-triggered callbacks
   * (e.g., input field onChange handlers)
   */
  debouncedSaveSettings = debounceAsync(async () => {
    await this.saveSettings()
  }, UI_CONFIG.DEBOUNCE_DELAY)


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

}
