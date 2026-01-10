import { minimatch } from 'minimatch'
import type { Vault } from 'obsidian'
import { ToolPermission } from './types'
import type { PermissionScope, PermissionValidationResult, OperationType } from './permission-types'
import { DEFAULT_PERMISSION_CONFIGS } from './permission-types'

/**
 * Permission manager for Obsidian tools
 * Validates file operations based on permission level and scope
 */
export class PermissionManager {
  private vault: Vault
  private permissionLevel: ToolPermission
  private scope: PermissionScope

  constructor(
    vault: Vault,
    permissionLevel: ToolPermission = ToolPermission.ReadOnly,
    scope?: PermissionScope
  ) {
    this.vault = vault
    this.permissionLevel = permissionLevel
    // Merge with default scope for this permission level
    this.scope = this.mergeScopeWithDefaults(scope || {} as PermissionScope, permissionLevel)
  }

  /**
   * Merge user-provided scope with default scope for permission level
   */
  private mergeScopeWithDefaults(userScope: PermissionScope, level: ToolPermission): PermissionScope {
    const defaultScope = DEFAULT_PERMISSION_CONFIGS[level]
    
    const merged: PermissionScope = {
      allowedPaths: userScope.allowedPaths ?? defaultScope.allowedPaths ?? undefined,
      deniedPaths: [...(defaultScope.deniedPaths || []), ...(userScope.deniedPaths || [])],
      maxFileSize: userScope.maxFileSize ?? defaultScope.maxFileSize ?? undefined,
      allowedExtensions: userScope.allowedExtensions ?? defaultScope.allowedExtensions ?? undefined
    }
    return merged
  }

  /**
   * Update permission level
   */
  setPermissionLevel(level: ToolPermission): void {
    this.permissionLevel = level
    // Re-merge scope with new defaults
    this.scope = this.mergeScopeWithDefaults(this.scope, level)
  }

  /**
   * Update permission scope
   */
  setScope(scope: PermissionScope): void {
    this.scope = this.mergeScopeWithDefaults(scope, this.permissionLevel)
  }

  /**
   * Check if a path can be read
   */
  async canRead(path: string): Promise<PermissionValidationResult> {
    return this.validatePath(path, 'read')
  }

  /**
   * Check if a path can be written to
   */
  async canWrite(path: string): Promise<PermissionValidationResult> {
    if (this.permissionLevel === ToolPermission.ReadOnly) {
      return {
        allowed: false,
        reason: 'Permission level is read-only. Write operations are not allowed.',
        secrets: false
      }
    }
    return this.validatePath(path, 'write')
  }

  /**
   * Check if a new file can be created at a path
   */
  async canCreate(path: string): Promise<PermissionValidationResult> {
    if (this.permissionLevel === ToolPermission.ReadOnly) {
      return {
        allowed: false,
        reason: 'Permission level is read-only. Create operations are not allowed.',
        secrets: false
      }
    }
    return this.validatePath(path, 'create')
  }

  /**
   * Check if a path can be modified
   */
  async canModify(path: string): Promise<PermissionValidationResult> {
    if (this.permissionLevel === ToolPermission.ReadOnly) {
      return {
        allowed: false,
        reason: 'Permission level is read-only. Modify operations are not allowed.',
        secrets: false
      }
    }
    return this.validatePath(path, 'modify')
  }

  /**
   * Check if a path can be deleted
   */
  async canDelete(path: string): Promise<PermissionValidationResult> {
    if (this.permissionLevel === ToolPermission.ReadOnly) {
      return {
        allowed: false,
        reason: 'Permission level is read-only. Delete operations are not allowed.',
        secrets: false
      }
    }
    // Delete operations are only allowed with full-write permission
    if (this.permissionLevel !== ToolPermission.FullWrite) {
      return {
        allowed: false,
        reason: 'Delete operations require full-write permission level.',
        secrets: false
      }
    }
    return this.validatePath(path, 'delete')
  }

  /**
   * Validate a path against the permission scope
   */
  async validatePath(path: string, operation: OperationType): Promise<PermissionValidationResult> {
    // Normalize path (remove leading/trailing slashes, handle relative paths)
    const normalizedPath = this.normalizePath(path)

    // Check denied paths first (highest priority)
    if (this.scope.deniedPaths && this.scope.deniedPaths.length > 0) {
      for (const deniedPattern of this.scope.deniedPaths) {
        if (minimatch(normalizedPath, deniedPattern)) {
          return {
            allowed: false,
            reason: `Path '${normalizedPath}' matches denied pattern '${deniedPattern}'`,
            secrets: false
          }
        }
      }
    }

    // Check allowed paths (if specified, path must match at least one)
    if (this.scope.allowedPaths && this.scope.allowedPaths.length > 0) {
      const matchesAnyAllowed = this.scope.allowedPaths.some(pattern =>
        minimatch(normalizedPath, pattern)
      )
      if (!matchesAnyAllowed) {
        return {
          allowed: false,
          reason: `Path '${normalizedPath}' does not match any allowed pattern`,
          secrets: false
        }
      }
    }

    // Check file extension (if specified)
    if (this.scope.allowedExtensions && this.scope.allowedExtensions.length > 0) {
      const pathLower = normalizedPath.toLowerCase()
      const matchesExtension = this.scope.allowedExtensions.some(ext => {
        const extLower = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
        return pathLower.endsWith(extLower)
      })
      if (!matchesExtension) {
        return {
          allowed: false,
          reason: `File extension is not in allowed list: ${this.scope.allowedExtensions.join(', ')}`,
          secrets: false
        }
      }
    }

    // Check file size (only for read/modify operations on existing files)
    if ((operation === 'read' || operation === 'modify') && this.scope.maxFileSize) {
      try {
        // Check if file exists
        const file = this.vault.getAbstractFileByPath(normalizedPath)
        if (file && 'stat' in file) {
          const stat = (file as { stat: { size: number } }).stat
          if (stat.size > this.scope.maxFileSize) {
            return {
              allowed: false,
              reason: `File size (${stat.size} bytes) exceeds maximum allowed size (${this.scope.maxFileSize} bytes)`,
              secrets: false
            }
          }
        }
      } catch (error) {
        // For read/modify, if we can't access the file, return error
        return {
          allowed: false,
          reason: `Cannot access file '${normalizedPath}': ${error instanceof Error ? error.message : 'Unknown error'}`,
          secrets: false
        }
      }
    }

    // All checks passed
    return { allowed: true, secrets: false }
  }

  /**
   * Normalize a path for matching
   * - Remove leading/trailing slashes
   * - Convert to forward slashes
   * - Handle relative paths
   */
  private normalizePath(path: string): string {
    return path
      .replace(/\\/g, '/')  // Convert backslashes to forward slashes
      .replace(/^\/+/, '')  // Remove leading slashes
      .replace(/\/+$/, '')  // Remove trailing slashes
  }

  /**
   * Get current permission level
   */
  getPermissionLevel(): ToolPermission {
    return this.permissionLevel
  }

  /**
   * Get current permission scope
   */
  getScope(): PermissionScope {
    return { ...this.scope }  // Return a copy to prevent external modifications
  }

  /**
   * Check if a tool call requires user approval
   * Write operations always require approval (even with full-write permission)
   */
  requiresApproval(toolName: string, operation: OperationType): boolean {
    // Read-only operations never require approval
    if (operation === 'read') {
      return false
    }

    // All write operations require approval (safety measure)
    return ['write', 'create', 'modify', 'delete'].includes(operation)
  }
}