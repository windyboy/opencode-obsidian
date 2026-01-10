import { z } from 'zod'

/**
 * Tool permission levels
 */
export enum ToolPermission {
  ReadOnly = 'read-only',
  ScopedWrite = 'scoped-write',
  FullWrite = 'full-write'
}

/**
 * Schema for obsidian.search_vault tool input
 */
export const ObsidianSearchVaultSchema = z.object({
  query: z.string().describe('Search query string'),
  limit: z.number().int().positive().optional().default(20).describe('Maximum number of results to return'),
  includeContent: z.boolean().optional().default(false).describe('Whether to include content snippets in results')
})

export type ObsidianSearchVaultInput = z.infer<typeof ObsidianSearchVaultSchema>

/**
 * Schema for obsidian.search_vault tool output
 */
export const ObsidianSearchVaultOutputSchema = z.object({
  results: z.array(z.object({
    path: z.string().describe('File path'),
    title: z.string().optional().describe('File title or name'),
    content: z.string().optional().describe('Content snippet if includeContent is true'),
    matchCount: z.number().optional().describe('Number of matches found in this file')
  })),
  totalMatches: z.number().describe('Total number of matching files found')
})

export type ObsidianSearchVaultOutput = z.infer<typeof ObsidianSearchVaultOutputSchema>

/**
 * Schema for obsidian.read_note tool input
 */
export const ObsidianReadNoteSchema = z.object({
  path: z.string().describe('Path to the note file (relative to vault root)')
})

export type ObsidianReadNoteInput = z.infer<typeof ObsidianReadNoteSchema>

/**
 * Schema for obsidian.read_note tool output
 */
export const ObsidianReadNoteOutputSchema = z.object({
  path: z.string().describe('File path'),
  content: z.string().describe('File content'),
  exists: z.boolean().describe('Whether the file exists')
})

export type ObsidianReadNoteOutput = z.infer<typeof ObsidianReadNoteOutputSchema>

/**
 * Schema for obsidian.list_notes tool input
 */
export const ObsidianListNotesSchema = z.object({
  folder: z.string().optional().default('').describe('Folder path to list (empty string for vault root)'),
  recursive: z.boolean().optional().default(true).describe('Whether to list files recursively'),
  includeFolders: z.boolean().optional().default(false).describe('Whether to include folder paths in results')
})

export type ObsidianListNotesInput = z.infer<typeof ObsidianListNotesSchema>

/**
 * Schema for obsidian.list_notes tool output
 */
export const ObsidianListNotesOutputSchema = z.object({
  files: z.array(z.object({
    path: z.string().describe('File or folder path'),
    isFolder: z.boolean().optional().describe('Whether this is a folder (only if includeFolders is true)'),
    size: z.number().optional().describe('File size in bytes'),
    modified: z.number().optional().describe('Last modification timestamp (milliseconds since epoch)')
  })),
  totalCount: z.number().describe('Total number of items found')
})

export type ObsidianListNotesOutput = z.infer<typeof ObsidianListNotesOutputSchema>

/**
 * Schema for obsidian.create_note tool input
 */
export const ObsidianCreateNoteSchema = z.object({
  path: z.string().describe('Path where the note should be created (relative to vault root)'),
  content: z.string().describe('Content to write to the note'),
  overwrite: z.boolean().optional().default(false).describe('Whether to overwrite if file already exists')
})

export type ObsidianCreateNoteInput = z.infer<typeof ObsidianCreateNoteSchema>

/**
 * Schema for obsidian.create_note tool output
 */
export const ObsidianCreateNoteOutputSchema = z.object({
  path: z.string().describe('File path that was created'),
  created: z.boolean().describe('Whether the file was actually created (false if dryRun or permission denied)'),
  existed: z.boolean().optional().describe('Whether the file already existed before this operation')
})

export type ObsidianCreateNoteOutput = z.infer<typeof ObsidianCreateNoteOutputSchema>

/**
 * Schema for obsidian.update_note tool input
 */
export const ObsidianUpdateNoteSchema = z.object({
  path: z.string().describe('Path to the note file'),
  content: z.string().describe('Content to update with'),
  mode: z.enum(['replace', 'append', 'prepend', 'insert']).describe('Update mode'),
  insertAt: z.number().optional().describe('Line number to insert at (required for insert mode)'),
  insertMarker: z.string().optional().describe('Marker string to insert after (alternative to insertAt)'),
  dryRun: z.boolean().optional().default(true).describe('Whether to preview changes without applying them')
})

export type ObsidianUpdateNoteInput = z.infer<typeof ObsidianUpdateNoteSchema>

/**
 * Schema for obsidian.update_note tool output
 */
export const ObsidianUpdateNoteOutputSchema = z.object({
  path: z.string().describe('File path that was updated'),
  updated: z.boolean().describe('Whether the file was actually updated (false if dryRun or permission denied)'),
  mode: z.string().describe('Update mode that was used'),
  preview: z.object({
    originalContent: z.string().optional().describe('Original file content'),
    newContent: z.string().describe('Content after update'),
    addedLines: z.number().optional().describe('Number of lines added'),
    removedLines: z.number().optional().describe('Number of lines removed')
  }).optional().describe('Preview of changes (always included if dryRun=true)')
})

export type ObsidianUpdateNoteOutput = z.infer<typeof ObsidianUpdateNoteOutputSchema>

/**
 * Schema for obsidian.get_note_metadata tool input
 */
export const ObsidianGetNoteMetadataSchema = z.object({
  path: z.string().describe('Path to the note file'),
  includeLinks: z.boolean().optional().default(true).describe('Whether to include link relationships'),
  includeTags: z.boolean().optional().default(true).describe('Whether to include tags'),
  includeProperties: z.boolean().optional().default(true).describe('Whether to include frontmatter properties')
})

export type ObsidianGetNoteMetadataInput = z.infer<typeof ObsidianGetNoteMetadataSchema>

/**
 * Schema for obsidian.get_note_metadata tool output
 */
export const ObsidianGetNoteMetadataOutputSchema = z.object({
  path: z.string().describe('File path'),
  exists: z.boolean().describe('Whether the file exists'),
  title: z.string().optional().describe('Note title (from frontmatter or first heading)'),
  frontmatter: z.record(z.string(), z.unknown()).optional().describe('Frontmatter properties'),
  tags: z.array(z.string()).optional().describe('Tags found in the note'),
  links: z.object({
    outlinks: z.array(z.string()).describe('Outgoing links (files this note links to)'),
    backlinks: z.array(z.string()).describe('Incoming links (files that link to this note)'),
    unresolvedLinks: z.array(z.string()).optional().describe('Unresolved link references')
  }).optional().describe('Link relationships'),
  stats: z.object({
    wordCount: z.number().optional().describe('Word count'),
    lineCount: z.number().optional().describe('Line count'),
    characterCount: z.number().optional().describe('Character count')
  }).optional().describe('File statistics')
})

export type ObsidianGetNoteMetadataOutput = z.infer<typeof ObsidianGetNoteMetadataOutputSchema>

/**
 * Tool definition with name, permission level, and schemas
 */
export interface ObsidianToolDefinition {
  name: string
  description: string
  permission: ToolPermission
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  inputSchema: z.ZodSchema
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  outputSchema: z.ZodSchema
}

/**
 * All Obsidian tool definitions
 */
export const OBSIDIAN_TOOLS: ObsidianToolDefinition[] = [
  {
    name: 'obsidian.search_vault',
    description: 'Search for notes in the vault by query string',
    permission: ToolPermission.ReadOnly,
    inputSchema: ObsidianSearchVaultSchema,
    outputSchema: ObsidianSearchVaultOutputSchema
  },
  {
    name: 'obsidian.read_note',
    description: 'Read the content of a note file',
    permission: ToolPermission.ReadOnly,
    inputSchema: ObsidianReadNoteSchema,
    outputSchema: ObsidianReadNoteOutputSchema
  },
  {
    name: 'obsidian.list_notes',
    description: 'List notes in a folder (recursively by default)',
    permission: ToolPermission.ReadOnly,
    inputSchema: ObsidianListNotesSchema,
    outputSchema: ObsidianListNotesOutputSchema
  },
  {
    name: 'obsidian.create_note',
    description: 'Create a new note file with the specified content',
    permission: ToolPermission.ScopedWrite,
    inputSchema: ObsidianCreateNoteSchema,
    outputSchema: ObsidianCreateNoteOutputSchema
  },
  {
    name: 'obsidian.update_note',
    description: 'Update a note file with new content (supports replace, append, prepend, insert modes)',
    permission: ToolPermission.ScopedWrite,
    inputSchema: ObsidianUpdateNoteSchema,
    outputSchema: ObsidianUpdateNoteOutputSchema
  },
  {
    name: 'obsidian.get_note_metadata',
    description: 'Get metadata about a note including frontmatter, tags, links, and statistics',
    permission: ToolPermission.ReadOnly,
    inputSchema: ObsidianGetNoteMetadataSchema,
    outputSchema: ObsidianGetNoteMetadataOutputSchema
  }
]

/**
 * Audit log entry for tool execution
 */
export interface AuditLogEntry {
  /** Unique identifier for this log entry */
  id: string
  /** Timestamp when the tool was called (milliseconds since epoch) */
  timestamp: number
  /** Tool name that was executed */
  toolName: string
  /** Session ID that initiated the tool call */
  sessionId?: string
  /** Tool call ID (correlation ID) */
  callId: string
  /** Tool input parameters */
  input: unknown
  /** Tool output result */
  output?: unknown
  /** Whether the tool execution resulted in an error */
  isError: boolean
  /** Error message if execution failed */
  error?: string
  /** Permission level that was checked */
  permissionLevel: ToolPermission
  /** Whether the operation required user approval */
  requiredApproval: boolean
  /** Whether the user approved the operation */
  approved?: boolean
  /** Whether this was a dry-run operation */
  dryRun: boolean
  /** Path affected by the operation (if applicable) */
  affectedPath?: string
  /** Duration of tool execution in milliseconds */
  duration?: number
}

/**
 * Filter criteria for querying audit logs
 */
export interface AuditLogFilter {
  /** Filter by tool name */
  toolName?: string
  /** Filter by session ID */
  sessionId?: string
  /** Filter by call ID */
  callId?: string
  /** Filter by time range - start timestamp (inclusive) */
  startTime?: number
  /** Filter by time range - end timestamp (inclusive) */
  endTime?: number
  /** Filter by path pattern (glob or regex) */
  pathPattern?: string
  /** Filter by permission level */
  permissionLevel?: ToolPermission
  /** Filter by error status */
  isError?: boolean
  /** Filter by approval status */
  approved?: boolean
  /** Filter by dry-run status */
  dryRun?: boolean
  /** Maximum number of results to return */
  limit?: number
  /** Offset for pagination */
  offset?: number
}