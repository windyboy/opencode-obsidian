import type { App, Vault, MetadataCache, TAbstractFile, TFile, TFolder } from 'obsidian'
import { PermissionManager } from './permission-manager'
import { AuditLogger } from './audit-logger'
// ToolPermission imported but not used directly

/**
 * Type guard to check if abstract file is a TFile
 */
function isTFile(file: TAbstractFile | null): file is TFile {
  return file !== null && 'extension' in file && typeof (file as unknown).extension === 'string'
}

/**
 * Type guard to check if abstract file is a TFolder
 */
function isTFolder(file: TAbstractFile | null): file is TFolder {
  return file !== null && !('extension' in file) && 'children' in file
}
import type {
  ObsidianSearchVaultInput,
  ObsidianSearchVaultOutput,
  ObsidianReadNoteInput,
  ObsidianReadNoteOutput,
  ObsidianListNotesInput,
  ObsidianListNotesOutput,
  ObsidianCreateNoteInput,
  ObsidianCreateNoteOutput,
  ObsidianUpdateNoteInput,
  ObsidianUpdateNoteOutput,
  ObsidianGetNoteMetadataInput,
  ObsidianGetNoteMetadataOutput,
  AuditLogEntry
} from './types'

/**
 * Error thrown when permission is pending (needs user approval)
 */
export class PermissionPendingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermissionPendingError'
  }
}

/**
 * Tool executor for Obsidian vault operations
 * Executes tool calls with permission checks and audit logging
 */
export class ObsidianToolExecutor {
  private vault: Vault
  private app: App
  private metadataCache: MetadataCache
  private permissionManager: PermissionManager
  private auditLogger: AuditLogger

  constructor(
    vault: Vault,
    app: App,
    metadataCache: MetadataCache,
    permissionManager: PermissionManager,
    auditLogger: AuditLogger
  ) {
    this.vault = vault
    this.app = app
    this.metadataCache = metadataCache
    this.permissionManager = permissionManager
    this.auditLogger = auditLogger
  }

  /**
   * Generate a unique ID for audit log entries
   */
  private generateLogId(): string {
    return `log_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
  }

  /**
   * Get backlinks for a file (files that link to this file)
   */
  private getBacklinks(file: TFile): string[] {
    // Get all files that link to this file
    const allFiles = this.vault.getMarkdownFiles()
    const backlinks: string[] = []
    
    for (const otherFile of allFiles) {
      const otherCache = this.metadataCache.getFileCache(otherFile)
      if (otherCache?.links) {
        // Check if this file is linked to by otherFile
        const isLinked = otherCache.links.some(link => {
          // Normalize paths for comparison
          const normalizedLink = link.link.replace(/^\.\//, '')
          const normalizedTarget = file.path.replace(/^\.\//, '')
          return normalizedLink === normalizedTarget || 
                 normalizedLink === file.basename ||
                 normalizedLink === file.path
        })
        
        if (isLinked) {
          backlinks.push(otherFile.path)
        }
      }
    }
    
    return Array.from(new Set(backlinks))
  }

  /**
   * Create an audit log entry
   */
  private async createAuditLog(
    toolName: string,
    sessionId: string | undefined,
    callId: string,
    input: unknown,
    output?: unknown,
    error?: Error,
    startTime: number,
    operation: 'read' | 'write' | 'create' | 'modify',
    affectedPath?: string,
    approved?: boolean,
    dryRun?: boolean
  ): Promise<void> {
    const duration = Date.now() - startTime
    const permissionLevel = this.permissionManager.getPermissionLevel()
    const requiresApproval = operation !== 'read' && this.permissionManager.requiresApproval(toolName, operation)

    const logEntry: AuditLogEntry = {
      id: this.generateLogId(),
      timestamp: startTime,
      toolName,
      sessionId,
      callId,
      input,
      output: output !== undefined ? output : undefined,
      isError: !!error,
      error: error?.message,
      permissionLevel,
      requiredApproval: requiresApproval,
      approved: requiresApproval ? approved : undefined,
      dryRun: dryRun || false,
      affectedPath,
      duration
    }

    await this.auditLogger.log(logEntry)
  }

  /**
   * Search vault for notes matching query
   */
  async searchVault(
    input: ObsidianSearchVaultInput,
    sessionId?: string,
    callId?: string
  ): Promise<ObsidianSearchVaultOutput> {
    const startTime = Date.now()
    const effectiveCallId = callId || `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    
    try {
      // Get all markdown files
      const allFiles = this.vault.getMarkdownFiles()
      const queryLower = input.query.toLowerCase()
      
      // Filter and rank results
      const results: Array<{ path: string; title: string; content?: string; matchCount: number }> = []
      
      for (const file of allFiles) {
        // Check path and filename match
        const pathMatch = file.path.toLowerCase().includes(queryLower) || 
                         file.basename.toLowerCase().includes(queryLower)
        
        if (pathMatch) {
          // Read content if needed for content search or snippets
          let content: string | undefined
          let matchCount = 0
          
          if (input.includeContent || !pathMatch) {
            try {
              const fileContent = await this.vault.read(file)
              const contentMatch = fileContent.toLowerCase().includes(queryLower)
              
              if (contentMatch || pathMatch) {
                content = input.includeContent ? fileContent : undefined
                // Count matches in content
                const regex = new RegExp(queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
                const matches = fileContent.match(regex)
                matchCount = matches ? matches.length : (pathMatch ? 1 : 0)
                
                // Extract snippet if needed
                if (input.includeContent && content) {
                  const firstMatch = fileContent.toLowerCase().indexOf(queryLower)
                  if (firstMatch >= 0) {
                    const start = Math.max(0, firstMatch - 50)
                    const end = Math.min(content.length, firstMatch + queryLower.length + 50)
                    content = `...${content.substring(start, end)}...`
                  }
                }
              }
            } catch {
              // Skip files that can't be read
              continue
            }
          } else if (pathMatch) {
            matchCount = 1
          }
          
          if (matchCount > 0) {
            results.push({
              path: file.path,
              title: file.basename,
              content,
              matchCount
            })
          }
        }
      }
      
      // Sort by match count (descending) and limit results
      results.sort((a, b) => b.matchCount - a.matchCount)
      const limitedResults = results.slice(0, input.limit || 20)
      
      const output: ObsidianSearchVaultOutput = {
        results: limitedResults,
        totalMatches: results.length
      }

      await this.createAuditLog(
        'obsidian.search_vault',
        sessionId,
        effectiveCallId,
        input,
        output,
        undefined,
        startTime,
        'read'
      )

      return output
    } catch (error) {
      await this.createAuditLog(
        'obsidian.search_vault',
        sessionId,
        effectiveCallId,
        input,
        undefined,
        error instanceof Error ? error : new Error(String(error)),
        startTime,
        'read'
      )
      throw error
    }
  }

  /**
   * Read a note file
   */
  async readNote(
    input: ObsidianReadNoteInput,
    sessionId?: string,
    callId?: string
  ): Promise<ObsidianReadNoteOutput> {
    const startTime = Date.now()
    const effectiveCallId = callId || `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    
    try {
      // Check read permission
      const permission = await this.permissionManager.canRead(input.path)
      if (!permission.allowed) {
        const error = new Error(`Permission denied: ${permission.reason}`)
        await this.createAuditLog(
          'obsidian.read_note',
          sessionId,
          effectiveCallId,
          input,
          undefined,
          error,
          startTime,
          'read',
          input.path
        )
        throw error
      }

      const file = this.vault.getAbstractFileByPath(input.path)
      
      if (!isTFile(file)) {
        const output: ObsidianReadNoteOutput = {
          path: input.path,
          content: '',
          exists: false
        }
        
        await this.createAuditLog(
          'obsidian.read_note',
          sessionId,
          effectiveCallId,
          input,
          output,
          undefined,
          startTime,
          'read',
          input.path
        )
        
        return output
      }

      const content = await this.vault.read(file)
      
      const output: ObsidianReadNoteOutput = {
        path: input.path,
        content,
        exists: true
      }

      await this.createAuditLog(
        'obsidian.read_note',
        sessionId,
        effectiveCallId,
        input,
        output,
        undefined,
        startTime,
        'read',
        input.path
      )

      return output
    } catch (error) {
      await this.createAuditLog(
        'obsidian.read_note',
        sessionId,
        effectiveCallId,
        input,
        undefined,
        error instanceof Error ? error : new Error(String(error)),
        startTime,
        'read',
        input.path
      )
      throw error
    }
  }

  /**
   * List notes in a folder
   */
  async listNotes(
    input: ObsidianListNotesInput,
    sessionId?: string,
    callId?: string
  ): Promise<ObsidianListNotesOutput> {
    const startTime = Date.now()
    const effectiveCallId = callId || `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    
    try {
      const folderPath = input.folder || ''
      const folder = folderPath ? this.vault.getAbstractFileByPath(folderPath) : null
      
      if (folderPath && !isTFolder(folder)) {
        // Folder doesn't exist - return empty results
        const output: ObsidianListNotesOutput = {
          files: [],
          totalCount: 0
        }
        
        await this.createAuditLog(
          'obsidian.list_notes',
          sessionId,
          effectiveCallId,
          input,
          output,
          undefined,
          startTime,
          'read'
        )
        
        return output
      }

      const files: Array<{ path: string; isFolder?: boolean; size?: number; modified?: number }> = []
      
      const collectFiles = (folder: TFolder | null, recursive: boolean) => {
        const targetFolder = folder || this.vault.getRoot()
        
        for (const child of targetFolder.children) {
          if (isTFile(child)) {
            // Check read permission
            // For listing, we just check if we can access the path (not strict permission check)
            files.push({
              path: child.path,
              size: child.stat.size,
              modified: child.stat.mtime
            })
          } else if (isTFolder(child) && input.includeFolders) {
            files.push({
              path: child.path,
              isFolder: true
            })
            
            if (recursive) {
              collectFiles(child, recursive)
            }
          } else if (isTFolder(child) && recursive) {
            // Don't include folder but recurse into it
            collectFiles(child, recursive)
          }
        }
      }

      // folder is guaranteed to be TFolder | null after the check above
      const targetFolder: TFolder | null = folder && isTFolder(folder) ? folder : null
      collectFiles(targetFolder, input.recursive ?? true)

      const output: ObsidianListNotesOutput = {
        files,
        totalCount: files.length
      }

      await this.createAuditLog(
        'obsidian.list_notes',
        sessionId,
        effectiveCallId,
        input,
        output,
        undefined,
        startTime,
        'read'
      )

      return output
    } catch (error) {
      await this.createAuditLog(
        'obsidian.list_notes',
        sessionId,
        effectiveCallId,
        input,
        undefined,
        error instanceof Error ? error : new Error(String(error)),
        startTime,
        'read'
      )
      throw error
    }
  }

  /**
   * Get note metadata (frontmatter, tags, links, statistics)
   */
  async getNoteMetadata(
    input: ObsidianGetNoteMetadataInput,
    sessionId?: string,
    callId?: string
  ): Promise<ObsidianGetNoteMetadataOutput> {
    const startTime = Date.now()
    const effectiveCallId = callId || `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    
    try {
      const file = this.vault.getAbstractFileByPath(input.path)
      
      if (!isTFile(file)) {
        const output: ObsidianGetNoteMetadataOutput = {
          path: input.path,
          exists: false
        }
        
        await this.createAuditLog(
          'obsidian.get_note_metadata',
          sessionId,
          effectiveCallId,
          input,
          output,
          undefined,
          startTime,
          'read',
          input.path
        )
        
        return output
      }

      const cache = this.metadataCache.getFileCache(file)
      const content = await this.vault.read(file)

      // Parse frontmatter (if included)
      let frontmatter: Record<string, unknown> | undefined
      if (input.includeProperties && cache?.frontmatter) {
        frontmatter = cache.frontmatter
      }

      // Get tags (if included)
      const tags: string[] | undefined = input.includeTags && cache?.tags
        ? cache.tags.map(tag => tag.tag)
        : undefined

      // Get links (if included)
      const links: { outlinks: string[]; backlinks: string[]; unresolvedLinks?: string[] } | undefined = input.includeLinks
        ? {
            outlinks: cache?.links ? Array.from(new Set(cache.links.map(l => l.link))) : [],
            backlinks: this.getBacklinks(file),
            unresolvedLinks: cache?.links ? cache.links.filter(l => !l.resolved).map(l => l.link) : []
          }
        : undefined

      // Calculate statistics
      const stats = {
        wordCount: content.split(/\s+/).filter(w => w.length > 0).length,
        lineCount: content.split('\n').length,
        characterCount: content.length
      }

      // Get title (from frontmatter or first heading or filename)
      let title: string | undefined
      if (frontmatter?.title && typeof frontmatter.title === 'string') {
        title = frontmatter.title
      } else {
        // Try to find first heading
        const headingMatch = content.match(/^#+\s+(.+)$/m)
        if (headingMatch) {
          title = headingMatch[1].trim()
        } else {
          title = file.basename
        }
      }

      const output: ObsidianGetNoteMetadataOutput = {
        path: input.path,
        exists: true,
        title,
        frontmatter: input.includeProperties ? frontmatter : undefined,
        tags,
        links,
        stats
      }

      await this.createAuditLog(
        'obsidian.get_note_metadata',
        sessionId,
        effectiveCallId,
        input,
        output,
        undefined,
        startTime,
        'read',
        input.path
      )

      return output
    } catch (error) {
      await this.createAuditLog(
        'obsidian.get_note_metadata',
        sessionId,
        effectiveCallId,
        input,
        undefined,
        error instanceof Error ? error : new Error(String(error)),
        startTime,
        'read',
        input.path
      )
      throw error
    }
  }

  /**
   * Create a new note
   */
  async createNote(
    input: ObsidianCreateNoteInput,
    sessionId?: string,
    callId?: string,
    approved: boolean = false
  ): Promise<ObsidianCreateNoteOutput> {
    const startTime = Date.now()
    const effectiveCallId = callId || `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    
    try {
      // Check create permission
      const permission = await this.permissionManager.canCreate(input.path)
      if (!permission.allowed) {
        const error = new Error(`Permission denied: ${permission.reason}`)
        await this.createAuditLog(
          'obsidian.create_note',
          sessionId,
          effectiveCallId,
          input,
          undefined,
          error,
          startTime,
          'create',
          input.path,
          false
        )
        throw error
      }

      // Check if approval is required
      if (this.permissionManager.requiresApproval('obsidian.create_note', 'create') && !approved) {
        throw new PermissionPendingError('User approval required for create operation')
      }

      // Check if file exists
      const existingFile = this.vault.getAbstractFileByPath(input.path)
      const existed = isTFile(existingFile)

      if (existed && !input.overwrite) {
        const error = new Error(`File already exists: ${input.path}. Use overwrite=true to replace it.`)
        await this.createAuditLog(
          'obsidian.create_note',
          sessionId,
          effectiveCallId,
          input,
          undefined,
          error,
          startTime,
          'create',
          input.path,
          false
        )
        throw error
      }

      // Create or overwrite file
      if (existed && isTFile(existingFile)) {
        await this.vault.modify(existingFile, input.content)
      } else {
        // Ensure parent directory exists
        const pathParts = input.path.split('/')
        if (pathParts.length > 1) {
          const parentPath = pathParts.slice(0, -1).join('/')
          const parentFolder = this.vault.getAbstractFileByPath(parentPath)
          if (!isTFolder(parentFolder)) {
            await this.vault.createFolder(parentPath)
          }
        }
        await this.vault.create(input.path, input.content)
      }

      const output: ObsidianCreateNoteOutput = {
        path: input.path,
        created: true,
        existed
      }

      await this.createAuditLog(
        'obsidian.create_note',
        sessionId,
        effectiveCallId,
        input,
        output,
        undefined,
        startTime,
        'create',
        input.path,
        approved,
        false
      )

      return output
    } catch (error) {
      // Don't log audit if it's a PermissionPendingError (user needs to approve)
      if (error instanceof PermissionPendingError) {
        throw error
      }
      
      await this.createAuditLog(
        'obsidian.create_note',
        sessionId,
        effectiveCallId,
        input,
        undefined,
        error instanceof Error ? error : new Error(String(error)),
        startTime,
        'create',
        input.path,
        approved,
        false
      )
      throw error
    }
  }

  /**
   * Update a note file with new content
   */
  async updateNote(
    input: ObsidianUpdateNoteInput,
    sessionId?: string,
    callId?: string,
    approved: boolean = false
  ): Promise<ObsidianUpdateNoteOutput> {
    const startTime = Date.now()
    const effectiveCallId = callId || `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    
    try {
      // Check modify permission
      const permission = await this.permissionManager.canModify(input.path)
      if (!permission.allowed) {
        const error = new Error(`Permission denied: ${permission.reason}`)
        await this.createAuditLog(
          'obsidian.update_note',
          sessionId,
          effectiveCallId,
          input,
          undefined,
          error,
          startTime,
          'modify',
          input.path,
          false,
          input.dryRun ?? true
        )
        throw error
      }

      // Read current file (if exists)
      const file = this.vault.getAbstractFileByPath(input.path)
      const originalContent = isTFile(file) ? await this.vault.read(file) : ''

      // Calculate new content based on mode
      let newContent: string
      let addedLines = 0
      let removedLines = 0

      switch (input.mode) {
        case 'replace':
          newContent = input.content
          if (originalContent) {
            removedLines = originalContent.split('\n').length
          }
          addedLines = newContent.split('\n').length
          break

        case 'append':
          newContent = originalContent + (originalContent && !originalContent.endsWith('\n') ? '\n' : '') + input.content
          addedLines = input.content.split('\n').length
          break

        case 'prepend':
          newContent = input.content + (input.content && !input.content.endsWith('\n') ? '\n' : '') + originalContent
          addedLines = input.content.split('\n').length
          break

        case 'insert': {
          // Validate insert parameters
          if (!input.insertAt && !input.insertMarker) {
            throw new Error('insertAt or insertMarker is required for insert mode')
          }

          const originalLines = originalContent.split('\n')
          let insertIndex: number

          if (input.insertAt !== undefined) {
            // Insert at line number (1-based, convert to 0-based)
            insertIndex = Math.max(0, Math.min(originalLines.length, input.insertAt - 1))
          } else if (input.insertMarker) {
            // Insert after marker
            const markerIndex = originalLines.findIndex(line => line.includes(input.insertMarker!))
            if (markerIndex === -1) {
              throw new Error(`Marker "${input.insertMarker}" not found in file`)
            }
            insertIndex = markerIndex + 1
          } else {
            throw new Error('insertAt or insertMarker is required for insert mode')
          }

          // Insert content at the specified position
          const insertLines = input.content.split('\n')
          originalLines.splice(insertIndex, 0, ...insertLines)
          newContent = originalLines.join('\n')
          addedLines = insertLines.length
          break
        }

        default:
          throw new Error(`Unknown update mode: ${String(input.mode)}`)
      }

      // Calculate statistics for preview
      if (originalContent) {
        const originalLineCount = originalContent.split('\n').length
        const newLineCount = newContent.split('\n').length
        if (input.mode === 'replace') {
          removedLines = originalLineCount
          addedLines = newLineCount
        } else {
          addedLines = newLineCount - originalLineCount
        }
      } else {
        addedLines = newContent.split('\n').length
      }

      const preview = {
        originalContent: originalContent || undefined,
        newContent,
        addedLines,
        removedLines: input.mode === 'replace' && originalContent ? removedLines : undefined
      }

      // If dry-run, return preview only
      if (input.dryRun ?? true) {
        const output: ObsidianUpdateNoteOutput = {
          path: input.path,
          updated: false,
          mode: input.mode,
          preview
        }

        await this.createAuditLog(
          'obsidian.update_note',
          sessionId,
          effectiveCallId,
          input,
          output,
          undefined,
          startTime,
          'modify',
          input.path,
          false,
          true
        )

        return output
      }

      // Check if approval is required for actual write
      if (this.permissionManager.requiresApproval('obsidian.update_note', 'modify') && !approved) {
        throw new PermissionPendingError('User approval required for update note operation')
      }

      // Apply the update
      if (isTFile(file)) {
        await this.vault.modify(file, newContent)
      } else {
        // File doesn't exist, create it
        const pathParts = input.path.split('/')
        if (pathParts.length > 1) {
          const parentPath = pathParts.slice(0, -1).join('/')
          const parentFolder = this.vault.getAbstractFileByPath(parentPath)
          if (!isTFolder(parentFolder)) {
            await this.vault.createFolder(parentPath)
          }
        }
        await this.vault.create(input.path, newContent)
      }

      const output: ObsidianUpdateNoteOutput = {
        path: input.path,
        updated: true,
        mode: input.mode,
        preview
      }

      await this.createAuditLog(
        'obsidian.update_note',
        sessionId,
        effectiveCallId,
        input,
        output,
        undefined,
        startTime,
        'modify',
        input.path,
        approved,
        false
      )

      return output
    } catch (error) {
      // Don't log audit if it's a PermissionPendingError
      if (error instanceof PermissionPendingError) {
        throw error
      }
      
      await this.createAuditLog(
        'obsidian.update_note',
        sessionId,
        effectiveCallId,
        input,
        undefined,
        error instanceof Error ? error : new Error(String(error)),
        startTime,
        'modify',
        input.path,
        approved,
        input.dryRun ?? true
      )
      throw error
    }
  }
}