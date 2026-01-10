import { z } from 'zod'
import { ObsidianToolExecutor, PermissionPendingError } from './tool-executor'
import { OBSIDIAN_TOOLS, type ObsidianToolDefinition } from './types'
import { PermissionModal, type PermissionRequest } from './permission-modal'
import type { App } from 'obsidian'
import type {
  ObsidianSearchVaultInput,
  ObsidianReadNoteInput,
  ObsidianListNotesInput,
  ObsidianCreateNoteInput,
  ObsidianUpdateNoteInput,
  ObsidianGetNoteMetadataInput
} from './types'

/**
 * Tool registry for Obsidian tools
 * Registers tools, routes tool calls, and validates input/output
 */
export class ObsidianToolRegistry {
  private tools: Map<string, ObsidianToolDefinition> = new Map()
  private executor: ObsidianToolExecutor
  private app: App | null = null

  constructor(executor: ObsidianToolExecutor, app?: App) {
    this.executor = executor
    this.app = app || null
    // Register all built-in tools
    this.registerBuiltInTools()
  }

  /**
   * Set the Obsidian App instance (needed for PermissionModal)
   */
  setApp(app: App): void {
    this.app = app
  }

  /**
   * Register all built-in Obsidian tools
   */
  private registerBuiltInTools(): void {
    for (const tool of OBSIDIAN_TOOLS) {
      this.registerTool(tool)
    }
  }

  /**
   * Register a tool definition
   */
  registerTool(toolDef: ObsidianToolDefinition): void {
    this.tools.set(toolDef.name, toolDef)
  }

  /**
   * Get a tool definition by name
   */
  getTool(name: string): ObsidianToolDefinition | undefined {
    return this.tools.get(name)
  }

  /**
   * List all registered tools
   */
  listTools(): ObsidianToolDefinition[] {
    return Array.from(this.tools.values())
  }

  /**
   * Execute a tool call
   */
  async execute(
    toolName: string,
    args: unknown,
    sessionId?: string,
    callId?: string,
    approved: boolean = false
  ): Promise<unknown> {
    // Find tool definition
    const toolDef = this.tools.get(toolName)
    if (!toolDef) {
      throw new Error(`Tool not found: ${toolName}`)
    }

    // Validate input using Zod schema
    let validatedInput: unknown
    try {
      validatedInput = toolDef.inputSchema.parse(args)
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.issues || []
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        throw new Error(`Invalid input for ${toolName}: ${issues.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`).join(', ')}`)
      }
      throw error
    }

    // Execute tool based on name
    let result: unknown
    try {
      switch (toolName) {
        case 'obsidian.search_vault':
          result = await this.executor.searchVault(validatedInput as ObsidianSearchVaultInput, sessionId, callId)
          break
        case 'obsidian.read_note':
          result = await this.executor.readNote(validatedInput as ObsidianReadNoteInput, sessionId, callId)
          break
        case 'obsidian.list_notes':
          result = await this.executor.listNotes(validatedInput as ObsidianListNotesInput, sessionId, callId)
          break
        case 'obsidian.get_note_metadata':
          result = await this.executor.getNoteMetadata(validatedInput as ObsidianGetNoteMetadataInput, sessionId, callId)
          break
        case 'obsidian.create_note':
          result = await this.executor.createNote(validatedInput as ObsidianCreateNoteInput, sessionId, callId, approved)
          break
        case 'obsidian.update_note':
          result = await this.executor.updateNote(validatedInput as ObsidianUpdateNoteInput, sessionId, callId, approved)
          break
        default:
          throw new Error(`Tool execution not implemented: ${toolName}`)
      }
    } catch (error) {
      // Re-throw PermissionPendingError as-is (needs user approval)
      if (error instanceof PermissionPendingError) {
        throw error
      }
      // Wrap other errors
      throw new Error(`Tool execution failed for ${toolName}: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Validate output using Zod schema
    try {
      const validatedOutput = toolDef.outputSchema.parse(result)
      return validatedOutput
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.issues || []
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        throw new Error(`Invalid output from ${toolName}: ${issues.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`).join(', ')}`)
      }
      throw error
    }
  }

  /**
   * Check if a tool requires approval for a given operation
   */
  requiresApproval(toolName: string): boolean {
    const toolDef = this.tools.get(toolName)
    if (!toolDef) {
      return false
    }

    // Write operations always require approval
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    return toolDef.permission !== 'read-only'
  }

  /**
   * Get tool permission level
   */
  getToolPermission(toolName: string): string | undefined {
    const toolDef = this.tools.get(toolName)
    return toolDef?.permission
  }

  /**
   * Request permission for a tool call using PermissionModal
   * Returns a promise that resolves when user approves or rejects
   */
  async requestPermission(
    request: PermissionRequest
  ): Promise<boolean> {
    if (!this.app) {
      throw new Error('App instance is required for permission requests. Call setApp() first.')
    }

    return new Promise<boolean>((resolve) => {
      const modal = new PermissionModal(this.app!, request, (allowed: boolean) => {
        resolve(allowed)
      })
      modal.open()
    })
  }

  /**
   * Execute a tool call with automatic permission handling
   * If permission is required, shows PermissionModal and waits for user response
   */
  async executeWithPermissionHandling(
    toolName: string,
    args: unknown,
    sessionId?: string,
    callId?: string
  ): Promise<unknown> {
    // First attempt execution (may throw PermissionPendingError)
    try {
      return await this.execute(toolName, args, sessionId, callId, false)
    } catch (error) {
      // If permission is pending, request it from user
      if (error instanceof PermissionPendingError) {
        // Execute with dry-run first to get preview
        const toolDef = this.tools.get(toolName)
        if (!toolDef) {
          throw error
        }

        // For update_note, try to get preview by executing with dryRun=true
        let preview: PermissionRequest['preview'] | undefined
        if (toolName === 'obsidian.update_note') {
          try {
            // Create a modified args with dryRun=true to get preview
            const modifiedArgs = { ...args as Record<string, unknown>, dryRun: true }
            const previewResult = await this.execute(toolName, modifiedArgs, sessionId, callId, false)
            
            if (previewResult.preview) {
              const updateArgs = args as ObsidianUpdateNoteInput
              preview = {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                originalContent: previewResult.preview.originalContent,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                newContent: previewResult.preview.newContent,
                mode: updateArgs.mode,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                addedLines: previewResult.preview.addedLines,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                removedLines: previewResult.preview.removedLines
              }
            }
          } catch {
            // If preview fails, continue without preview
          }
        }

        // Request permission from user
        const permissionRequest: PermissionRequest = {
          sessionId: sessionId || '',
          callId: callId || '',
          toolName,
          args,
          preview
        }

        const approved = await this.requestPermission(permissionRequest)
        
        if (!approved) {
          throw new Error(`Permission denied for ${toolName}`)
        }

        // User approved, execute again with approved=true
        return await this.execute(toolName, args, sessionId, callId, true)
      }
      
      // Re-throw other errors
      throw error
    }
  }

  /**
   * Convert tool definitions to JSON Schema format (for OpenCode Server registration)
   */
  toJSONSchema(toolName: string): object | undefined {
    const toolDef = this.tools.get(toolName)
    if (!toolDef) {
      return undefined
    }

    // Convert Zod schema to JSON Schema
    // Note: This is a simplified conversion - a full implementation would properly convert Zod schemas
    // For now, we'll return a basic structure
    return {
      name: toolDef.name,
      description: toolDef.description,
      inputSchema: this.zodToJSONSchema(toolDef.inputSchema),
      outputSchema: this.zodToJSONSchema(toolDef.outputSchema),
      permission: toolDef.permission
    }
  }

  /**
   * Convert Zod schema to JSON Schema (simplified implementation)
   * Note: A full implementation would properly traverse the Zod schema
   */
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  private zodToJSONSchema(schema: z.ZodSchema): object {
    // This is a simplified implementation - a full implementation would properly convert Zod schemas
    // For now, we'll return a placeholder structure
    // In production, you'd use a library like zod-to-json-schema
    return {
      type: 'object',
      properties: {},
      required: []
    }
  }

  /**
   * List all tools in JSON Schema format (for OpenCode Server registration)
   */
  listToolsAsJSONSchema(): Array<{
    name: string
    description: string
    inputSchema: object
    outputSchema: object
    permission: string
  }> {
    return this.listTools().map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: this.zodToJSONSchema(tool.inputSchema),
      outputSchema: this.zodToJSONSchema(tool.outputSchema),
      permission: tool.permission
    }))
  }
}