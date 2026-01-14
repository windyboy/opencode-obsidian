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
 * Format Zod validation errors into a readable string
 */
function formatZodErrors(error: z.ZodError): string {
  const issues = error.issues || []
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  return issues.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`).join(', ')
}

/**
 * Tool registry for Obsidian tools
 * Registers tools, routes tool calls, and validates input/output
 */
export class ObsidianToolRegistry {
  private tools: Map<string, ObsidianToolDefinition> = new Map()
  private executor: ObsidianToolExecutor
  private app: App | null = null

  /** Tool name to executor method mapping */
  private readonly toolExecutors: Record<string, (input: unknown, sessionId?: string, callId?: string, approved?: boolean) => Promise<unknown>>

  constructor(executor: ObsidianToolExecutor, app?: App) {
    this.executor = executor
    this.app = app || null

    // Initialize tool executor dispatch map
    this.toolExecutors = {
      'obsidian.search_vault': (input, sessionId, callId) =>
        this.executor.searchVault(input as ObsidianSearchVaultInput, sessionId, callId),
      'obsidian.read_note': (input, sessionId, callId) =>
        this.executor.readNote(input as ObsidianReadNoteInput, sessionId, callId),
      'obsidian.list_notes': (input, sessionId, callId) =>
        this.executor.listNotes(input as ObsidianListNotesInput, sessionId, callId),
      'obsidian.get_note_metadata': (input, sessionId, callId) =>
        this.executor.getNoteMetadata(input as ObsidianGetNoteMetadataInput, sessionId, callId),
      'obsidian.create_note': (input, sessionId, callId, approved) =>
        this.executor.createNote(input as ObsidianCreateNoteInput, sessionId, callId, approved),
      'obsidian.update_note': (input, sessionId, callId, approved) =>
        this.executor.updateNote(input as ObsidianUpdateNoteInput, sessionId, callId, approved)
    }

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
        throw new Error(`Invalid input for ${toolName}: ${formatZodErrors(error)}`)
      }
      throw error
    }

    // Execute tool using dispatch map
    const executor = this.toolExecutors[toolName]
    if (!executor) {
      throw new Error(`Tool execution not implemented: ${toolName}`)
    }

    const result = await executor(validatedInput, sessionId, callId, approved)

    // Validate output using Zod schema
    try {
      return toolDef.outputSchema.parse(result)
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Invalid output from ${toolName}: ${formatZodErrors(error)}`)
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

        // Generate preview (permission-checked) before requesting approval.
        // If preview generation is denied by scope, fail fast and do not show modal.
        const preview = await this.generatePreview(toolName, args, sessionId, callId)

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

    return {
      name: toolDef.name,
      description: toolDef.description,
      inputSchema: { type: 'object', properties: {}, required: [] },
      outputSchema: { type: 'object', properties: {}, required: [] },
      permission: toolDef.permission
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
    const schemaPlaceholder = { type: 'object', properties: {}, required: [] }
    return this.listTools().map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: schemaPlaceholder,
      outputSchema: schemaPlaceholder,
      permission: tool.permission
    }))
  }

  /**
   * Generate preview for tool operation (unified permission check and audit logging)
   * Delegates to ObsidianToolExecutor
   */
  async generatePreview(
    toolName: string,
    args: unknown,
    sessionId?: string,
    callId?: string
  ): Promise<PermissionRequest['preview'] | undefined> {
    return this.executor.generatePreview(toolName, args, sessionId, callId)
  }
}
