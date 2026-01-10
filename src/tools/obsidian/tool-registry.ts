import { z } from 'zod'
import { ObsidianToolExecutor, PermissionPendingError } from './tool-executor'
import { OBSIDIAN_TOOLS, type ObsidianToolDefinition, ToolPermission } from './types'
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
import type { MCPManager } from '../../mcp/mcp-manager'
import type { MCPTool } from '../../mcp/types'

/**
 * Tool registry for Obsidian tools
 * Registers tools, routes tool calls, and validates input/output
 */
export class ObsidianToolRegistry {
  private tools: Map<string, ObsidianToolDefinition> = new Map()
  private mcpTools: Map<string, string> = new Map() // toolName -> mcpToolName mapping
  private executor: ObsidianToolExecutor
  private app: App | null = null
  private mcpManager: MCPManager | null = null

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
   * Set the MCP Manager instance (needed for MCP tool execution)
   */
  setMCPManager(mcpManager: MCPManager): void {
    this.mcpManager = mcpManager
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
   * Register MCP tools from MCP Manager
   * Converts MCP tools to ObsidianToolDefinition format with read-only permission by default
   */
  registerMCPTools(mcpTools: MCPTool[]): void {
    if (!this.mcpManager) {
      console.warn('[ObsidianToolRegistry] MCP Manager not set, cannot register MCP tools')
      return
    }

    for (const mcpTool of mcpTools) {
      // Convert MCP tool schema to Zod schema (simplified - using z.any() for now)
      // In production, you'd convert JSON Schema to Zod schema
      const zodInputSchema = this.jsonSchemaToZod(mcpTool.inputSchema)
      const zodOutputSchema = z.unknown() // MCP tools output is unknown by default

      const toolDef: ObsidianToolDefinition = {
        name: `mcp.${mcpTool.serverName || 'unknown'}.${mcpTool.name}`,
        description: mcpTool.description,
        permission: ToolPermission.ReadOnly, // MCP tools default to read-only for safety
        inputSchema: zodInputSchema,
        outputSchema: zodOutputSchema,
      }

      this.tools.set(toolDef.name, toolDef)
      this.mcpTools.set(toolDef.name, mcpTool.name) // Map registered name to MCP tool name
      
      console.debug(`[ObsidianToolRegistry] Registered MCP tool: ${toolDef.name}`)
    }
  }

  /**
   * Convert JSON Schema to Zod schema (simplified implementation)
   * Note: A full implementation would properly traverse the JSON Schema
   */
  private jsonSchemaToZod(schema: { type?: string; properties?: Record<string, unknown>; required?: string[]; [key: string]: unknown }): z.ZodType {
    // Simplified conversion - in production, use a library like json-schema-to-zod
    // For now, return z.record() as a safe default
    if (schema.type === 'object' && schema.properties) {
      const shape: Record<string, z.ZodType> = {}
      for (const [key, prop] of Object.entries(schema.properties)) {
        const propSchema = prop as { type?: string; [key: string]: unknown }
        if (propSchema.type === 'string') {
          shape[key] = z.string()
        } else if (propSchema.type === 'number' || propSchema.type === 'integer') {
          shape[key] = z.number()
        } else if (propSchema.type === 'boolean') {
          shape[key] = z.boolean()
        } else if (propSchema.type === 'array') {
          shape[key] = z.array(z.unknown())
        } else {
          shape[key] = z.unknown()
        }
      }
      return z.object(shape).partial() // Make all fields optional for safety
    }
    return z.record(z.string(), z.unknown())
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

    // Check if this is an MCP tool
    let result: unknown
    const mcpToolName = this.mcpTools.get(toolName)
    if (mcpToolName && this.mcpManager) {
      // Execute MCP tool
      try {
        const mcpResult = await this.mcpManager.callTool(mcpToolName, validatedInput as Record<string, unknown>)
        
        // Convert MCP result format to expected format
        // MCP tools return { content: Array<{ type, text, ... }> }
        if (mcpResult.content && mcpResult.content.length > 0) {
          // Extract text content from MCP result
          const textContent = mcpResult.content
            .filter(item => item.type === 'text' && item.text)
            .map(item => item.text)
            .join('\n')
          
          result = {
            success: !mcpResult.isError,
            content: textContent || '',
            raw: mcpResult,
          }
        } else {
          result = {
            success: !mcpResult.isError,
            content: '',
            raw: mcpResult,
          }
        }
      } catch (error) {
        throw new Error(`MCP tool execution failed for ${toolName}: ${error instanceof Error ? error.message : String(error)}`)
      }
    } else {
      // Execute Obsidian tool based on name
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
            const previewResult = await this.execute(toolName, modifiedArgs, sessionId, callId, false) as { preview?: { originalContent?: string; newContent?: string; addedLines?: number; removedLines?: number } }
            
            if (previewResult?.preview) {
              const updateArgs = args as ObsidianUpdateNoteInput
              preview = {
                originalContent: previewResult.preview.originalContent ?? '',
                newContent: previewResult.preview.newContent ?? '',
                mode: updateArgs.mode,
                addedLines: previewResult.preview.addedLines,
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
  private zodToJSONSchema(schema: z.ZodType): object {
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