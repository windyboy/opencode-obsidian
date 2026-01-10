import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ObsidianToolRegistry } from '../../src/tools/obsidian/tool-registry'
import { ObsidianToolExecutor, PermissionPendingError } from '../../src/tools/obsidian/tool-executor'
import { PermissionManager } from '../../src/tools/obsidian/permission-manager'
import { AuditLogger } from '../../src/tools/obsidian/audit-logger'
import { ToolPermission } from '../../src/tools/obsidian/types'
import type { Vault, App, MetadataCache, TFile, TFolder, TAbstractFile } from 'obsidian'

// Type definitions for test results
type UpdateNoteResult = {
  path: string
  updated: boolean
  mode: string
  preview?: {
    originalContent?: string
    newContent?: string
    addedLines?: number
    removedLines?: number
  }
}

/**
 * Integration tests for OpenCode Server tool execution
 * Tests the complete tool execution flow including permission checks and audit logging
 */

// Mock Obsidian Vault
const createMockVault = (files: Record<string, { content: string; size?: number }>): Vault => {
  const mockFiles: Map<string, TAbstractFile> = new Map()
  const fileContents: Map<string, string> = new Map()
  
  for (const [path, data] of Object.entries(files)) {
    const mockFile = {
      path,
      name: path.split('/').pop() || path,
      basename: path.split('/').pop()?.replace(/\.[^.]+$/, '') || path,
      extension: path.split('.').pop() || '',
      stat: {
        size: data.size || data.content.length,
        ctime: Date.now(),
        mtime: Date.now()
      },
      parent: null
    // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast
    } as unknown as TFile
    mockFiles.set(path, mockFile as TAbstractFile)
    fileContents.set(path, data.content)
  }

  const vaultMock = {
    getAbstractFileByPath: vi.fn((path: string) => {
      return mockFiles.get(path) || null
    }),
    read: vi.fn(async (file: TFile) => {
      return fileContents.get(file.path) || ''
    }),
    modify: vi.fn(async (file: TFile, content: string) => {
      fileContents.set(file.path, content)
    }),
    create: vi.fn(async (path: string, content: string) => {
      const mockFile = {
        path,
        name: path.split('/').pop() || path,
        basename: path.split('/').pop()?.replace(/\.[^.]+$/, '') || path,
        extension: path.split('.').pop() || '',
        stat: {
          size: content.length,
          ctime: Date.now(),
          mtime: Date.now()
        },
        parent: null
      // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast
      } as unknown as TFile
      mockFiles.set(path, mockFile as TAbstractFile)
      fileContents.set(path, content)
    }),
    createFolder: vi.fn(async (path: string) => {
      const mockFolder = {
        path,
        name: path.split('/').pop() || path,
        children: [],
        parent: null
      // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast
      } as unknown as TFolder
      mockFiles.set(path, mockFolder as TAbstractFile)
    }),
    getMarkdownFiles: vi.fn(() => {
      return Array.from(mockFiles.values()).filter(f => {
        const file = f as unknown
        return file && file.extension === 'md'
      }) as TFile[]
    }),
    adapter: {
      exists: vi.fn(() => Promise.resolve(true)),
      mkdir: vi.fn(() => Promise.resolve()),
      stat: vi.fn(() => Promise.resolve({ type: 'folder' }))
    }
  } as unknown as Vault

  return vaultMock
}

// Mock Obsidian App
const createMockApp = (): App => {
  return {
    vault: {} as Vault,
    metadataCache: {
      getFileCache: vi.fn(() => ({
        frontmatter: {},
        tags: [],
        links: []
      })),
      getBacklinksForFile: vi.fn(() => ({
        data: {}
      }))
    } as unknown as MetadataCache
  } as unknown as App
}

describe('OpenCode Server Tool Integration', () => {
  let mockVault: Vault
  let mockApp: App
  let permissionManager: PermissionManager
  let auditLogger: AuditLogger
  let toolExecutor: ObsidianToolExecutor
  let toolRegistry: ObsidianToolRegistry

  beforeEach(() => {
    mockVault = createMockVault({
      'test/note.md': { content: '# Test Note\n\nOriginal content here.\n\nLine 3' },
      'test/empty.md': { content: '' },
      'test/multi-line.md': { 
        content: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5' 
      }
    })
    mockApp = createMockApp()
    mockApp.vault = mockVault
    
    permissionManager = new PermissionManager(mockVault, ToolPermission.ScopedWrite, {
      allowedPaths: ['test/**'],
      // eslint-disable-next-line obsidianmd/hardcoded-config-path
      deniedPaths: ['.obsidian/**'],
      maxFileSize: 10485760, // 10MB
      allowedExtensions: ['.md', '.txt']
    })
    
    // Create AuditLogger with mock vault that supports audit directory operations
    const auditVault = createMockVault({
      // eslint-disable-next-line obsidianmd/hardcoded-config-path
      '.obsidian/opencode-audit': { content: '' }
    })
    // eslint-disable-next-line obsidianmd/hardcoded-config-path
    auditLogger = new AuditLogger(auditVault, '.obsidian/opencode-audit')
    
    toolExecutor = new ObsidianToolExecutor(
      mockVault,
      mockApp,
      mockApp.metadataCache,
      permissionManager,
      auditLogger
    )
    toolRegistry = new ObsidianToolRegistry(toolExecutor)
  })

  describe('update_note tool - replace mode', () => {
    it('should replace entire content when mode is replace (dry-run)', async () => {
      const input = {
        path: 'test/note.md',
        content: '# Updated Note\n\nNew content here.',
        mode: 'replace' as const,
        dryRun: true
      }

      const result = await toolRegistry.execute(
        'obsidian.update_note',
        input,
        'test-session',
        'test-call'
      )

      type UpdateResult = {
        path: string
        updated: boolean
        mode: string
        preview?: {
          originalContent?: string
          newContent?: string
          addedLines?: number
          removedLines?: number
        }
      }
      const typedResult = result as UpdateResult
      expect(typedResult.path).toBe('test/note.md')
      expect(typedResult.updated).toBe(false) // dry-run
      expect(typedResult.mode).toBe('replace')
      expect(typedResult.preview).toBeDefined()
      expect(typedResult.preview?.originalContent).toContain('Original content')
      expect(typedResult.preview?.newContent).toContain('New content here')
      expect(typedResult.preview?.addedLines).toBeGreaterThan(0)
      expect(typedResult.preview?.removedLines).toBeGreaterThan(0)
    })

    it('should actually replace content when dryRun is false and approved', async () => {
      const input = {
        path: 'test/note.md',
        content: '# Replaced Note\n\nThis is the new content.',
        mode: 'replace' as const,
        dryRun: false
      }

      const result = await toolRegistry.execute(
        'obsidian.update_note',
        input,
        'test-session',
        'test-call',
        true // approved
      )

      const typedResult = result as UpdateNoteResult
      expect(typedResult.updated).toBe(true)
      expect(typedResult.mode).toBe('replace')

      // Verify file was actually modified
      const abstractFile = mockVault.getAbstractFileByPath('test/note.md')
      if (!(abstractFile instanceof TFile)) {
        throw new Error('Expected TFile')
      }
      const file = abstractFile
      const content = await mockVault.read(file)
      expect(content).toContain('This is the new content')
      expect(content).not.toContain('Original content')
    })
  })

  describe('update_note tool - append mode', () => {
    it('should append content to end of file (dry-run)', async () => {
      const input = {
        path: 'test/note.md',
        content: '\n\n## Appended Section\n\nThis is appended content.',
        mode: 'append' as const,
        dryRun: true
      }

      const result = await toolRegistry.execute(
        'obsidian.update_note',
        input,
        'test-session',
        'test-call'
      )

      const typedResult = result as UpdateNoteResult
      expect(typedResult.path).toBe('test/note.md')
      expect(typedResult.updated).toBe(false)
      expect(typedResult.mode).toBe('append')
      expect(typedResult.preview?.newContent).toContain('Original content')
      expect(typedResult.preview?.newContent).toContain('Appended Section')
      expect(typedResult.preview?.addedLines).toBeGreaterThan(0)
    })

    it('should actually append content when approved', async () => {
      const input = {
        path: 'test/note.md',
        content: '\n\n## Final Section\n\nLast paragraph.',
        mode: 'append' as const,
        dryRun: false
      }

      const result = await toolRegistry.execute(
        'obsidian.update_note',
        input,
        'test-session',
        'test-call',
        true // approved
      )

      const typedResult = result as UpdateNoteResult
      expect(typedResult.updated).toBe(true)

      const abstractFile = mockVault.getAbstractFileByPath('test/note.md')
      if (!(abstractFile instanceof TFile)) {
        throw new Error('Expected TFile')
      }
      const file = abstractFile
      const content = await mockVault.read(file)
      expect(content).toContain('Original content')
      expect(content).toContain('Final Section')
      expect(content).toContain('Last paragraph')
    })
  })

  describe('update_note tool - prepend mode', () => {
    it('should prepend content to beginning of file (dry-run)', async () => {
      const input = {
        path: 'test/note.md',
        content: '# Prepend Section\n\nThis goes first.\n\n---\n\n',
        mode: 'prepend' as const,
        dryRun: true
      }

      const result = await toolRegistry.execute(
        'obsidian.update_note',
        input,
        'test-session',
        'test-call'
      )

      const typedResult = result as UpdateNoteResult
      expect(typedResult.path).toBe('test/note.md')
      expect(typedResult.mode).toBe('prepend')
      const newContent = typedResult.preview?.newContent || ''
      expect(newContent).toContain('Prepend Section')
      expect(newContent).toContain('Original content')
      expect(newContent.indexOf('Prepend Section')).toBeLessThan(
        newContent.indexOf('Original content') || 0
      )
    })

    it('should actually prepend content when approved', async () => {
      const input = {
        path: 'test/note.md',
        content: '# Header\n\nFirst content.\n\n---\n\n',
        mode: 'prepend' as const,
        dryRun: false
      }

      const result = await toolRegistry.execute(
        'obsidian.update_note',
        input,
        'test-session',
        'test-call',
        true
      )

      const typedResult = result as UpdateNoteResult
      expect(typedResult.updated).toBe(true)

      const abstractFile = mockVault.getAbstractFileByPath('test/note.md')
      if (!(abstractFile instanceof TFile)) {
        throw new Error('Expected TFile')
      }
      const file = abstractFile
      const content = await mockVault.read(file)
      expect(content).toContain('Header')
      expect(content).toContain('Original content')
      expect(content.indexOf('Header')).toBeLessThan(content.indexOf('Original content'))
    })
  })

  describe('update_note tool - insert mode with insertAt', () => {
    it('should insert content at specified line number (dry-run)', async () => {
      const input = {
        path: 'test/multi-line.md',
        content: 'Inserted Line A\nInserted Line B',
        mode: 'insert' as const,
        insertAt: 3, // Insert after line 2 (0-indexed: after index 2)
        dryRun: true
      }

      const result = await toolRegistry.execute(
        'obsidian.update_note',
        input,
        'test-session',
        'test-call'
      )

      const typedResult = result as UpdateNoteResult
      expect(typedResult.path).toBe('test/multi-line.md')
      expect(typedResult.mode).toBe('insert')
      const newContent = typedResult.preview?.newContent || ''
      expect(newContent).toContain('Inserted Line A')
      expect(newContent).toContain('Line 3')
      
      // Verify insertion order
      const lines = newContent.split('\n')
      const line2Index = lines.indexOf('Line 2')
      const insertedIndex = lines.indexOf('Inserted Line A')
      const line3Index = lines.indexOf('Line 3')
      expect(insertedIndex).toBeGreaterThan(line2Index)
      expect(insertedIndex).toBeLessThan(line3Index)
    })

    it('should actually insert content when approved', async () => {
      const input = {
        path: 'test/multi-line.md',
        content: 'NEW LINE 1\nNEW LINE 2',
        mode: 'insert' as const,
        insertAt: 2, // Insert at line 2 (1-based, so after first line)
        dryRun: false
      }

      const result = await toolRegistry.execute(
        'obsidian.update_note',
        input,
        'test-session',
        'test-call',
        true
      )

      const typedResult = result as UpdateNoteResult
      expect(typedResult.updated).toBe(true)

      const abstractFile = mockVault.getAbstractFileByPath('test/multi-line.md')
      if (!(abstractFile instanceof TFile)) {
        throw new Error('Expected TFile')
      }
      const file = abstractFile
      const content = await mockVault.read(file)
      const lines = content.split('\n')
      expect(lines).toContain('NEW LINE 1')
      expect(lines).toContain('NEW LINE 2')
    })
  })

  describe('update_note tool - insert mode with insertMarker', () => {
    beforeEach(async () => {
      // Create a file with a marker
      await mockVault.create('test/marked.md', 'Line 1\n<!-- INSERT HERE -->\nLine 3\nLine 4')
    })

    it('should insert content after marker (dry-run)', async () => {
      const input = {
        path: 'test/marked.md',
        content: 'Inserted Content Line 1\nInserted Content Line 2',
        mode: 'insert' as const,
        insertMarker: '<!-- INSERT HERE -->',
        dryRun: true
      }

      const result = await toolRegistry.execute(
        'obsidian.update_note',
        input,
        'test-session',
        'test-call'
      )

      const typedResult = result as UpdateNoteResult
      expect(typedResult.mode).toBe('insert')
      const newContent = typedResult.preview?.newContent || ''
      expect(newContent).toContain('<!-- INSERT HERE -->')
      expect(newContent).toContain('Inserted Content Line 1')
      expect(newContent).toContain('Line 3')
      
      // Verify order: marker should come before inserted content, which comes before Line 3
      const markerIndex = newContent.indexOf('<!-- INSERT HERE -->')
      const insertedIndex = newContent.indexOf('Inserted Content Line 1')
      const line3Index = newContent.indexOf('Line 3')
      expect(insertedIndex).toBeGreaterThan(markerIndex)
      expect(insertedIndex).toBeLessThan(line3Index)
    })

    it('should actually insert content after marker when approved', async () => {
      const input = {
        path: 'test/marked.md',
        content: 'INSERTED',
        mode: 'insert' as const,
        insertMarker: '<!-- INSERT HERE -->',
        dryRun: false
      }

      const result = await toolRegistry.execute(
        'obsidian.update_note',
        input,
        'test-session',
        'test-call',
        true
      )

      const typedResult = result as UpdateNoteResult
      expect(typedResult.updated).toBe(true)

      const abstractFile = mockVault.getAbstractFileByPath('test/marked.md')
      if (!(abstractFile instanceof TFile)) {
        throw new Error('Expected TFile')
      }
      const file = abstractFile
      const content = await mockVault.read(file)
      expect(content).toContain('INSERTED')
      expect(content).toContain('<!-- INSERT HERE -->')
    })

    it('should throw error if marker not found', async () => {
      const input = {
        path: 'test/marked.md',
        content: 'Content',
        mode: 'insert' as const,
        insertMarker: '<!-- NONEXISTENT -->',
        dryRun: false
      }

      await expect(
        toolRegistry.execute('obsidian.update_note', input, 'test-session', 'test-call', true)
      ).rejects.toThrow('Marker')
    })
  })

  describe('update_note tool - permission approval flow', () => {
    it('should throw PermissionPendingError when approval required but not given', async () => {
      const input = {
        path: 'test/note.md',
        content: 'New content',
        mode: 'replace' as const,
        dryRun: false
      }

      // PermissionManager requires approval for write operations
      // When not approved, should throw PermissionPendingError
      await expect(
        toolRegistry.execute('obsidian.update_note', input, 'test-session', 'test-call', false)
      ).rejects.toThrow(PermissionPendingError)
    })

    it('should succeed when approval is given', async () => {
      const input = {
        path: 'test/note.md',
        content: 'Approved content',
        mode: 'replace' as const,
        dryRun: false
      }

      const result = await toolRegistry.execute(
        'obsidian.update_note',
        input,
        'test-session',
        'test-call',
        true // approved
      )

      expect(result.updated).toBe(true)
    })
  })

  describe('update_note tool - error handling', () => {
    it('should throw error if insertAt or insertMarker missing in insert mode', async () => {
      const input = {
        path: 'test/note.md',
        content: 'Content',
        mode: 'insert' as const,
        dryRun: false
      }

      await expect(
        toolRegistry.execute('obsidian.update_note', input, 'test-session', 'test-call', true)
      ).rejects.toThrow('insertAt or insertMarker is required')
    })

    it('should throw error for invalid mode', async () => {
      const input = {
        path: 'test/note.md',
        content: 'Content',
        mode: 'invalid' as unknown,
        dryRun: false
      }

      // This should be caught by Zod schema validation
      await expect(
        toolRegistry.execute('obsidian.update_note', input, 'test-session', 'test-call', true)
      ).rejects.toThrow()
    })
  })

  describe('update_note tool - create file if not exists', () => {
    it('should create file if it does not exist (replace mode)', async () => {
      const input = {
        path: 'test/new-file.md',
        content: '# New File\n\nContent here.',
        mode: 'replace' as const,
        dryRun: false
      }

      const result = await toolRegistry.execute(
        'obsidian.update_note',
        input,
        'test-session',
        'test-call',
        true
      )

      const typedResult = result as UpdateNoteResult
      expect(typedResult.updated).toBe(true)

      const abstractFile = mockVault.getAbstractFileByPath('test/new-file.md')
      if (!(abstractFile instanceof TFile)) {
        throw new Error('Expected TFile')
      }
      const file = abstractFile
      expect(file).not.toBeNull()
      const content = await mockVault.read(file)
      expect(content).toContain('New File')
    })
  })
})
