import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PermissionManager } from './permission-manager'
import { ToolPermission } from './types'
import type { Vault, TAbstractFile, TFile } from 'obsidian'

// Mock Obsidian Vault
const createMockVault = (files: Record<string, { size?: number; isFolder?: boolean }>): Vault => {
  const mockFiles: Map<string, TAbstractFile> = new Map()
  
  for (const [path, data] of Object.entries(files)) {
    const mockFile = {
      path,
      name: path.split('/').pop() || path,
      stat: {
        size: data.size || 0,
        ctime: Date.now(),
        mtime: Date.now()
      },
      parent: null
    // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast
    } as unknown as TFile
    mockFiles.set(path, mockFile as TAbstractFile)
  }

  return {
    getAbstractFileByPath: vi.fn((path: string) => {
      return mockFiles.get(path) || null
    })
  } as unknown as Vault
}

describe('PermissionManager', () => {
  let mockVault: Vault

  beforeEach(() => {
    mockVault = createMockVault({
      'test/note.md': { size: 1024 },
      'test/large.md': { size: 10485760 + 1 }, // 10MB + 1 byte (exceeds default limit)
      'secrets/api-key.md': { size: 512 },
      // eslint-disable-next-line obsidianmd/hardcoded-config-path
      '.obsidian/config.json': { size: 2048 }
    })
  })

  describe('constructor', () => {
    it('should create with default read-only permission', () => {
      const manager = new PermissionManager(mockVault)
      expect(manager.getPermissionLevel()).toBe(ToolPermission.ReadOnly)
    })

    it('should create with specified permission level', () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ScopedWrite)
      expect(manager.getPermissionLevel()).toBe(ToolPermission.ScopedWrite)
    })

    it('should merge custom scope with defaults', () => {
      const customScope = {
        allowedPaths: ['notes/**']
      }
      const manager = new PermissionManager(mockVault, ToolPermission.ScopedWrite, customScope)
      const scope = manager.getScope()
      expect(scope.allowedPaths).toEqual(['notes/**'])
      expect(scope.deniedPaths).toBeDefined()
    })
  })

  describe('canRead', () => {
    it('should allow reading with read-only permission', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ReadOnly)
      const result = await manager.canRead('test/note.md')
      expect(result.allowed).toBe(true)
    })

    it('should deny reading if path matches denied pattern', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ReadOnly, {
        deniedPaths: ['secrets/**']
      })
      const result = await manager.canRead('secrets/api-key.md')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('matches denied pattern')
    })

    it('should deny reading if path does not match allowed pattern', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ReadOnly, {
        allowedPaths: ['notes/**']
      })
      const result = await manager.canRead('test/note.md')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('does not match any allowed pattern')
    })

    it('should deny reading if file size exceeds limit', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ReadOnly, {
        maxFileSize: 10485760 // 10MB
      })
      const result = await manager.canRead('test/large.md')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('exceeds maximum allowed size')
    })

    it('should deny reading if extension is not allowed', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ReadOnly, {
        allowedExtensions: ['.txt']
      })
      const result = await manager.canRead('test/note.md')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('extension is not in allowed list')
    })
  })

  describe('canWrite', () => {
    it('should deny writing with read-only permission', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ReadOnly)
      const result = await manager.canWrite('test/note.md')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('read-only')
    })

    it('should allow writing with scoped-write permission', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ScopedWrite)
      const result = await manager.canWrite('test/note.md')
      expect(result.allowed).toBe(true)
    })

    it('should deny writing to denied paths even with write permission', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ScopedWrite, {
        // eslint-disable-next-line obsidianmd/hardcoded-config-path
        deniedPaths: ['**/.obsidian/**']
      })
      // eslint-disable-next-line obsidianmd/hardcoded-config-path
      const result = await manager.canWrite('.obsidian/config.json')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('matches denied pattern')
    })
  })

  describe('canCreate', () => {
    it('should deny creating with read-only permission', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ReadOnly)
      const result = await manager.canCreate('new/note.md')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('read-only')
    })

    it('should allow creating with scoped-write permission', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ScopedWrite)
      const result = await manager.canCreate('new/note.md')
      expect(result.allowed).toBe(true)
    })

    it('should deny creating if path matches denied pattern', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ScopedWrite, {
        deniedPaths: ['secrets/**']
      })
      const result = await manager.canCreate('secrets/new-key.md')
      expect(result.allowed).toBe(false)
    })
  })

  describe('canDelete', () => {
    it('should deny deleting with read-only permission', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ReadOnly)
      const result = await manager.canDelete('test/note.md')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('read-only')
    })

    it('should deny deleting with scoped-write permission', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ScopedWrite)
      const result = await manager.canDelete('test/note.md')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('full-write permission')
    })

    it('should allow deleting with full-write permission', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.FullWrite)
      const result = await manager.canDelete('test/note.md')
      expect(result.allowed).toBe(true)
    })
  })

  describe('validatePath', () => {
    it('should handle path normalization (backslashes, leading/trailing slashes)', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ReadOnly, {
        allowedPaths: ['test/**']
      })
      
      // Test various path formats
      expect((await manager.canRead('test/note.md')).allowed).toBe(true)
      expect((await manager.canRead('/test/note.md')).allowed).toBe(true)
      expect((await manager.canRead('test\\note.md')).allowed).toBe(true)
      expect((await manager.canRead('/test/note.md/')).allowed).toBe(true)
    })

    it('should check denied paths before allowed paths', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ReadOnly, {
        allowedPaths: ['**/*.md'],
        deniedPaths: ['secrets/**']
      })
      
      const result = await manager.canRead('secrets/api-key.md')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('denied pattern')
    })

    it('should check allowed extensions case-insensitively', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ReadOnly, {
        allowedExtensions: ['.MD', '.TXT']
      })
      
      const result = await manager.canRead('test/note.md')
      expect(result.allowed).toBe(true)
    })
  })

  describe('setPermissionLevel', () => {
    it('should update permission level', () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ReadOnly)
      manager.setPermissionLevel(ToolPermission.ScopedWrite)
      expect(manager.getPermissionLevel()).toBe(ToolPermission.ScopedWrite)
    })

    it('should re-merge scope with new defaults when permission level changes', () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ReadOnly)
      
      manager.setPermissionLevel(ToolPermission.ScopedWrite)
      const newScope = manager.getScope()
      
      // ScopedWrite should have different defaults than ReadOnly
      expect(newScope.maxFileSize).toBeDefined()
      expect(newScope.deniedPaths).toBeDefined()
    })
  })

  describe('setScope', () => {
    it('should update scope and merge with defaults', () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ScopedWrite)
      manager.setScope({
        allowedPaths: ['custom/**']
      })
      
      const scope = manager.getScope()
      expect(scope.allowedPaths).toEqual(['custom/**'])
      // Should still have defaults for other fields
      expect(scope.deniedPaths).toBeDefined()
    })
  })

  describe('requiresApproval', () => {
    it('should not require approval for read operations', () => {
      const manager = new PermissionManager(mockVault, ToolPermission.FullWrite)
      expect(manager.requiresApproval('obsidian.read_note', 'read')).toBe(false)
    })

    it('should require approval for write operations', () => {
      const manager = new PermissionManager(mockVault, ToolPermission.FullWrite)
      expect(manager.requiresApproval('obsidian.create_note', 'create')).toBe(true)
      expect(manager.requiresApproval('obsidian.update_note', 'modify')).toBe(true)
    })

    it('should require approval for delete operations', () => {
      const manager = new PermissionManager(mockVault, ToolPermission.FullWrite)
      expect(manager.requiresApproval('obsidian.delete_note', 'delete')).toBe(true)
    })
  })

  describe('default permission configs', () => {
    it('should apply default denied paths for scoped-write', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ScopedWrite)
      // Default config denies .obsidian/** paths
      // eslint-disable-next-line obsidianmd/hardcoded-config-path
      const result = await manager.canWrite('.obsidian/config.json')
      expect(result.allowed).toBe(false)
      // eslint-disable-next-line obsidianmd/hardcoded-config-path
      expect(result.reason).toContain('.obsidian')
    })

    it('should apply default file size limit for scoped-write', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ScopedWrite)
      // Default config has 10MB limit
      const result = await manager.canRead('test/large.md')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('exceeds maximum')
    })

    it('should apply default allowed extensions for scoped-write', async () => {
      const manager = new PermissionManager(mockVault, ToolPermission.ScopedWrite)
      // Default config allows .md, .txt, etc.
      const result = await manager.canRead('test/note.md')
      expect(result.allowed).toBe(true)
    })
  })
})