import { ToolPermission } from './types'

/**
 * Permission scope configuration
 * Defines what operations are allowed on which paths
 */
export interface PermissionScope {
  /** 
   * Allowed path patterns (glob patterns)
   * If specified, only paths matching these patterns are allowed
   * Example: ['notes/**', 'docs/*.md']
   */
  allowedPaths?: string[]
  
  /** 
   * Denied path patterns (glob patterns)
   * Paths matching these patterns are always denied, even if they match allowedPaths
   * Example: ['**/private/**', 'secrets/*']
   */
  deniedPaths?: string[]
  
  /** 
   * Maximum file size in bytes
   * Files larger than this size cannot be read or written
   * Example: 10485760 (10MB)
   */
  maxFileSize?: number
  
  /** 
   * Allowed file extensions
   * Only files with these extensions can be accessed
   * If not specified, all extensions are allowed (subject to deniedPaths)
   * Example: ['.md', '.txt', '.json']
   */
  allowedExtensions?: string[]
}

/**
 * Permission validation result
 * Returned by permission checks to indicate whether an operation is allowed
 */
export interface PermissionValidationResult {
  /** Whether the operation is allowed */
  allowed: boolean
  
  /** 
   * Reason why the operation was denied (if allowed is false)
   * Example: "Path 'secrets/api-key.md' matches denied pattern '**/secrets/**'"
   */
  reason?: string
}

/**
 * Operation type for permission checks
 */
export type OperationType = 'read' | 'write' | 'create' | 'modify' | 'delete'

/**
 * Permission level configuration
 * Maps tool permission levels to actual permission scopes
 */
export interface PermissionLevelConfig {
  /** Permission level (read-only, scoped-write, full-write) */
  level: ToolPermission
  
  /** Scope restrictions for this permission level */
  scope: PermissionScope
}

/**
 * Default permission configurations
 */
export const DEFAULT_PERMISSION_CONFIGS: Record<ToolPermission, PermissionScope> = {
  [ToolPermission.ReadOnly]: {
    // Read-only: no restrictions on reading
    allowedPaths: undefined,
    deniedPaths: undefined,
    maxFileSize: undefined,
    allowedExtensions: undefined
  },
  [ToolPermission.ScopedWrite]: {
    // Scoped-write: default to allowing most paths but deny common system paths
    // Note: '.obsidian' is Obsidian's default config directory name. Users can configure a different name,
    // but this glob pattern is a reasonable default for denying access to the config directory.
    allowedPaths: undefined,
    deniedPaths: [
      // eslint-disable-next-line obsidianmd/hardcoded-config-path
      '**/.obsidian/**',
      '**/.git/**',
      '**/node_modules/**',
      '**/.opencode/**' // Deny writing to OpenCode config directory
    ],
    maxFileSize: 10485760, // 10MB default limit
    allowedExtensions: ['.md', '.txt', '.json', '.yaml', '.yml', '.toml']
  },
  [ToolPermission.FullWrite]: {
    // Full-write: minimal restrictions, only deny critical system paths
    // Note: '.obsidian' is Obsidian's default config directory name. These are critical config files
    // that should be protected even in full-write mode.
    allowedPaths: undefined,
    deniedPaths: [
      // eslint-disable-next-line obsidianmd/hardcoded-config-path
      '**/.obsidian/workspace.json',
      // eslint-disable-next-line obsidianmd/hardcoded-config-path
      '**/.obsidian/hotkeys.json',
      // eslint-disable-next-line obsidianmd/hardcoded-config-path
      '**/.obsidian/appearance.json'
    ],
    maxFileSize: undefined, // No size limit
    allowedExtensions: undefined // All extensions allowed
  }
}