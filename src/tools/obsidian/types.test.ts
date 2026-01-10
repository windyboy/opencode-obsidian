import { describe, it, expect } from 'vitest'
import {
  ToolPermission,
  ObsidianSearchVaultSchema,
  ObsidianReadNoteSchema,
  ObsidianListNotesSchema,
  ObsidianCreateNoteSchema,
  ObsidianUpdateNoteSchema,
  ObsidianGetNoteMetadataSchema,
  OBSIDIAN_TOOLS
} from './types'

describe('Obsidian Tool Types', () => {
  describe('ToolPermission', () => {
    it('should have correct enum values', () => {
      expect(ToolPermission.ReadOnly).toBe('read-only')
      expect(ToolPermission.ScopedWrite).toBe('scoped-write')
      expect(ToolPermission.FullWrite).toBe('full-write')
    })
  })

  describe('ObsidianSearchVaultSchema', () => {
    it('should validate correct input', () => {
      const input = {
        query: 'test query',
        limit: 10,
        includeContent: true
      }
      const result = ObsidianSearchVaultSchema.parse(input)
      expect(result.query).toBe('test query')
      expect(result.limit).toBe(10)
      expect(result.includeContent).toBe(true)
    })

    it('should apply default values', () => {
      const input = { query: 'test' }
      const result = ObsidianSearchVaultSchema.parse(input)
      expect(result.limit).toBe(20)
      expect(result.includeContent).toBe(false)
    })

    it('should reject invalid input', () => {
      expect(() => ObsidianSearchVaultSchema.parse({})).toThrow()
      expect(() => ObsidianSearchVaultSchema.parse({ query: 123 })).toThrow()
      expect(() => ObsidianSearchVaultSchema.parse({ query: 'test', limit: -1 })).toThrow()
    })
  })

  describe('ObsidianReadNoteSchema', () => {
    it('should validate correct input', () => {
      const input = { path: 'test/note.md' }
      const result = ObsidianReadNoteSchema.parse(input)
      expect(result.path).toBe('test/note.md')
    })

    it('should reject invalid input', () => {
      expect(() => ObsidianReadNoteSchema.parse({})).toThrow()
      expect(() => ObsidianReadNoteSchema.parse({ path: 123 })).toThrow()
    })
  })

  describe('ObsidianListNotesSchema', () => {
    it('should validate correct input', () => {
      const input = {
        folder: 'test',
        recursive: false,
        includeFolders: true
      }
      const result = ObsidianListNotesSchema.parse(input)
      expect(result.folder).toBe('test')
      expect(result.recursive).toBe(false)
      expect(result.includeFolders).toBe(true)
    })

    it('should apply default values', () => {
      const input = {}
      const result = ObsidianListNotesSchema.parse(input)
      expect(result.folder).toBe('')
      expect(result.recursive).toBe(true)
      expect(result.includeFolders).toBe(false)
    })

    it('should reject invalid input', () => {
      expect(() => ObsidianListNotesSchema.parse({ folder: 123 })).toThrow()
      expect(() => ObsidianListNotesSchema.parse({ recursive: 'yes' })).toThrow()
    })
  })

  describe('ObsidianCreateNoteSchema', () => {
    it('should validate correct input', () => {
      const input = {
        path: 'test/note.md',
        content: 'Note content',
        overwrite: true
      }
      const result = ObsidianCreateNoteSchema.parse(input)
      expect(result.path).toBe('test/note.md')
      expect(result.content).toBe('Note content')
      expect(result.overwrite).toBe(true)
    })

    it('should apply default values', () => {
      const input = {
        path: 'test/note.md',
        content: 'Note content'
      }
      const result = ObsidianCreateNoteSchema.parse(input)
      expect(result.overwrite).toBe(false)
    })

    it('should reject invalid input', () => {
      expect(() => ObsidianCreateNoteSchema.parse({})).toThrow()
      expect(() => ObsidianCreateNoteSchema.parse({ path: 'test', content: 123 })).toThrow()
    })
  })

  describe('ObsidianUpdateNoteSchema', () => {
    it('should validate correct input for replace mode', () => {
      const input = {
        path: 'test/note.md',
        content: 'New content',
        mode: 'replace' as const,
        dryRun: false
      }
      const result = ObsidianUpdateNoteSchema.parse(input)
      expect(result.path).toBe('test/note.md')
      expect(result.content).toBe('New content')
      expect(result.mode).toBe('replace')
      expect(result.dryRun).toBe(false)
    })

    it('should validate correct input for append mode', () => {
      const input = {
        path: 'test/note.md',
        content: 'Appended content',
        mode: 'append' as const
      }
      const result = ObsidianUpdateNoteSchema.parse(input)
      expect(result.mode).toBe('append')
      expect(result.dryRun).toBe(true) // default
    })

    it('should validate correct input for prepend mode', () => {
      const input = {
        path: 'test/note.md',
        content: 'Prepended content',
        mode: 'prepend' as const
      }
      const result = ObsidianUpdateNoteSchema.parse(input)
      expect(result.mode).toBe('prepend')
    })

    it('should validate correct input for insert mode with insertAt', () => {
      const input = {
        path: 'test/note.md',
        content: 'Inserted content',
        mode: 'insert' as const,
        insertAt: 5
      }
      const result = ObsidianUpdateNoteSchema.parse(input)
      expect(result.mode).toBe('insert')
      expect(result.insertAt).toBe(5)
    })

    it('should validate correct input for insert mode with insertMarker', () => {
      const input = {
        path: 'test/note.md',
        content: 'Inserted content',
        mode: 'insert' as const,
        insertMarker: '<!-- INSERT HERE -->'
      }
      const result = ObsidianUpdateNoteSchema.parse(input)
      expect(result.mode).toBe('insert')
      expect(result.insertMarker).toBe('<!-- INSERT HERE -->')
    })

    it('should apply default values', () => {
      const input = {
        path: 'test/note.md',
        content: 'Content',
        mode: 'replace' as const
      }
      const result = ObsidianUpdateNoteSchema.parse(input)
      expect(result.dryRun).toBe(true)
    })

    it('should reject invalid input', () => {
      expect(() => ObsidianUpdateNoteSchema.parse({})).toThrow()
      expect(() => ObsidianUpdateNoteSchema.parse({ path: 'test', content: 123 })).toThrow()
      expect(() => ObsidianUpdateNoteSchema.parse({ path: 'test', content: 'content', mode: 'invalid' })).toThrow()
      expect(() => ObsidianUpdateNoteSchema.parse({ path: 'test', content: 'content', mode: 'insert' })).not.toThrow() // insertAt/insertMarker is optional in schema, validation happens in executor
    })
  })

  describe('ObsidianGetNoteMetadataSchema', () => {
    it('should validate correct input', () => {
      const input = {
        path: 'test/note.md',
        includeLinks: true,
        includeTags: false,
        includeProperties: true
      }
      const result = ObsidianGetNoteMetadataSchema.parse(input)
      expect(result.path).toBe('test/note.md')
      expect(result.includeLinks).toBe(true)
      expect(result.includeTags).toBe(false)
      expect(result.includeProperties).toBe(true)
    })

    it('should apply default values', () => {
      const input = { path: 'test/note.md' }
      const result = ObsidianGetNoteMetadataSchema.parse(input)
      expect(result.includeLinks).toBe(true)
      expect(result.includeTags).toBe(true)
      expect(result.includeProperties).toBe(true)
    })

    it('should reject invalid input', () => {
      expect(() => ObsidianGetNoteMetadataSchema.parse({})).toThrow()
      expect(() => ObsidianGetNoteMetadataSchema.parse({ path: 123 })).toThrow()
    })
  })

  describe('OBSIDIAN_TOOLS', () => {
    it('should contain all 6 core tools', () => {
      expect(OBSIDIAN_TOOLS).toHaveLength(6)
      const toolNames = OBSIDIAN_TOOLS.map(t => t.name)
      expect(toolNames).toContain('obsidian.search_vault')
      expect(toolNames).toContain('obsidian.read_note')
      expect(toolNames).toContain('obsidian.list_notes')
      expect(toolNames).toContain('obsidian.create_note')
      expect(toolNames).toContain('obsidian.update_note')
      expect(toolNames).toContain('obsidian.get_note_metadata')
    })

    it('should have correct permission levels', () => {
      const readOnlyTools = OBSIDIAN_TOOLS.filter(t => t.permission === ToolPermission.ReadOnly)
      const writeTools = OBSIDIAN_TOOLS.filter(t => t.permission !== ToolPermission.ReadOnly)
      
      expect(readOnlyTools.length).toBeGreaterThan(0)
      expect(writeTools.length).toBeGreaterThan(0)
      
      // Read-only tools
      expect(readOnlyTools.map(t => t.name)).toContain('obsidian.search_vault')
      expect(readOnlyTools.map(t => t.name)).toContain('obsidian.read_note')
      expect(readOnlyTools.map(t => t.name)).toContain('obsidian.list_notes')
      expect(readOnlyTools.map(t => t.name)).toContain('obsidian.get_note_metadata')
      
      // Write tools (scoped-write)
      expect(writeTools.map(t => t.name)).toContain('obsidian.create_note')
      expect(writeTools.map(t => t.name)).toContain('obsidian.update_note')
    })

    it('should have input and output schemas for each tool', () => {
      for (const tool of OBSIDIAN_TOOLS) {
        expect(tool.inputSchema).toBeDefined()
        expect(tool.outputSchema).toBeDefined()
        expect(typeof tool.description).toBe('string')
        expect(tool.description.length).toBeGreaterThan(0)
      }
    })

    it('should have unique tool names', () => {
      const toolNames = OBSIDIAN_TOOLS.map(t => t.name)
      const uniqueNames = new Set(toolNames)
      expect(uniqueNames.size).toBe(toolNames.length)
    })
  })
})