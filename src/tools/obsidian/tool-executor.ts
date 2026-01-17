import type { App, Vault, MetadataCache, TAbstractFile, TFile, TFolder } from 'obsidian'
import { TFile as TFileClass } from 'obsidian'
import { PermissionManager } from './permission-manager'
import { AuditLogger } from './audit-logger'
import { VaultReader } from './vault-reader'

/**
 * Type guard to check if abstract file is a TFile
 */
function isTFile(file: TAbstractFile | null): file is TFile {
	return file !== null && file instanceof TFileClass
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
import type { PermissionRequest } from './permission-modal'

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
	private reader: VaultReader

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
		this.reader = new VaultReader(vault, app, metadataCache, permissionManager, auditLogger)
	}

	/**
	 * Generate a unique ID for audit log entries
	 */
	private generateLogId(): string {
		return `log_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
	}

	/**
	 * Create an audit log entry
	 */
	private async createAuditLog(
		toolName: string,
		sessionId: string | undefined,
		callId: string,
		input: unknown,
		startTime: number,
		operation: 'read' | 'write' | 'create' | 'modify',
		output?: unknown,
		error?: Error,
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
	 * Execute a tool with automatic audit logging
	 * This helper method reduces code duplication by handling the common audit logging pattern
	 */
	private async executeWithAuditLog<T>(
		toolName: string,
		sessionId: string | undefined,
		callId: string,
		input: unknown,
		operation: 'read' | 'write' | 'create' | 'modify',
		affectedPath: string | undefined,
		approved: boolean = false,
		dryRun: boolean = false,
		executeFn: () => Promise<T>
	): Promise<T> {
		const startTime = Date.now()
		
		try {
			const result = await executeFn()
			
			await this.createAuditLog(
				toolName,
				sessionId,
				callId,
				input,
				startTime,
				operation,
				result,
				undefined,
				affectedPath,
				approved,
				dryRun
			)
			
			return result
		} catch (error) {
			await this.createAuditLog(
				toolName,
				sessionId,
				callId,
				input,
				startTime,
				operation,
				undefined,
				error instanceof Error ? error : new Error(String(error)),
				affectedPath,
				approved,
				dryRun
			)
			
			throw error
		}
	}

	/**
	 * Search vault for notes matching query
	 */
	async searchVault(
		input: ObsidianSearchVaultInput,
		sessionId?: string,
		callId?: string
	): Promise<ObsidianSearchVaultOutput> {
		return this.reader.searchVault(input, sessionId, callId)
	}

	/**
	 * Read a note file
	 */
	async readNote(
		input: ObsidianReadNoteInput,
		sessionId?: string,
		callId?: string
	): Promise<ObsidianReadNoteOutput> {
		return this.reader.readNote(input, sessionId, callId)
	}

	/**
	 * List notes in a folder
	 */
	async listNotes(
		input: ObsidianListNotesInput,
		sessionId?: string,
		callId?: string
	): Promise<ObsidianListNotesOutput> {
		return this.reader.listNotes(input, sessionId, callId)
	}

	/**
	 * Get note metadata (frontmatter, tags, links, statistics)
	 */
	async getNoteMetadata(
		input: ObsidianGetNoteMetadataInput,
		sessionId?: string,
		callId?: string
	): Promise<ObsidianGetNoteMetadataOutput> {
		return this.reader.getNoteMetadata(input, sessionId, callId)
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
		const effectiveCallId = callId || `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
		
		return this.executeWithAuditLog(
			'obsidian.create_note',
			sessionId,
			effectiveCallId,
			input,
			'create',
			input.path,
			approved,
			false,
			async () => {
				// Check create permission
				const permission = await this.permissionManager.canCreate(input.path)
				if (!permission.allowed) {
					throw new Error(`Permission denied: ${permission.reason}`)
				}

				// Check if approval is required
				if (this.permissionManager.requiresApproval('obsidian.create_note', 'create') && !approved) {
					throw new PermissionPendingError('User approval required for create operation')
				}

				// Check if file exists
				const existingFile = this.vault.getAbstractFileByPath(input.path)
				const existed = isTFile(existingFile)

				if (existed && !input.overwrite) {
					throw new Error(`File already exists: ${input.path}. Use overwrite=true to replace it.`)
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

				return {
					path: input.path,
					created: true,
					existed
				}
			}
		)
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
					startTime,
					'modify',
					undefined,
					error,
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
					startTime,
					'modify',
					output,
					undefined,
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
				startTime,
				'modify',
				output,
				undefined,
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
				startTime,
				'modify',
				undefined,
				error instanceof Error ? error : new Error(String(error)),
				input.path,
				approved,
				input.dryRun ?? true
			)
			throw error
		}
	}

	/**
	 * Generate preview for tool operation (for permission modal)
	 * This method should be called before requesting permission to show user what will happen
	 * It checks permissions and generates a preview with unified audit logging
	 */
	async generatePreview(
		toolName: string,
		args: unknown,
		sessionId?: string,
		callId?: string
	): Promise<PermissionRequest['preview'] | undefined> {
		// Delegate read operation previews to VaultReader
		if (toolName === 'obsidian.read_note') {
			const preview = await this.reader.generatePreview(toolName, args, sessionId, callId)
			return preview ? {
				originalContent: preview.originalContent,
				newContent: preview.originalContent || '',
				mode: 'read'
			} : undefined
		}

		const startTime = Date.now()
		const effectiveCallId = callId || `preview_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
		
		// For update_note, generate preview by reading file and calculating changes
		if (toolName === 'obsidian.update_note') {
			const updateArgs = args as { path: string; content: string; mode: string }
			
			// Check read permission first (required for preview)
			try {
				const permissionResult = await this.permissionManager.canRead(updateArgs.path)
				
				if (!permissionResult.allowed) {
					// Permission denied - log audit and return restricted preview
					await this.createAuditLog(
						toolName,
						sessionId,
						effectiveCallId,
						args,
						startTime,
						'read',
						undefined,
						new Error(`Permission denied for preview: ${permissionResult.reason}`),
						updateArgs.path,
						false,
						true // Preview is always a dry run
					)

					throw new Error(`Permission denied: ${permissionResult.reason}`)
				}
			} catch (error) {
				// Permission check failed - log and deny preview.
				await this.createAuditLog(
					toolName,
					sessionId,
					effectiveCallId,
					args,
					startTime,
					'read',
					undefined,
					error instanceof Error ? error : new Error(String(error)),
					updateArgs.path,
					false,
					true
				)
				throw error
			}
			
			// Permission allowed - read file and generate preview
			try {
				let originalContent: string | undefined
				const file = this.vault.getAbstractFileByPath(updateArgs.path)
				
				if (isTFile(file)) {
					originalContent = await this.vault.read(file)
				}
				
				// Calculate new content based on mode
				let newContent = updateArgs.content
				if (originalContent !== undefined) {
					if (updateArgs.mode === 'append') {
						newContent = originalContent + (originalContent && !originalContent.endsWith('\n') ? '\n' : '') + updateArgs.content
					} else if (updateArgs.mode === 'prepend') {
						newContent = updateArgs.content + (updateArgs.content && !updateArgs.content.endsWith('\n') ? '\n' : '') + originalContent
					} else if (updateArgs.mode === 'replace') {
						newContent = updateArgs.content
					} else if (updateArgs.mode === 'insert') {
						// For insert mode, we'd need the insertAt/insertMarker, which is complex
						// For now, just use the new content
						newContent = updateArgs.content
					}
				}

				// Calculate line differences
				const originalLines = originalContent ? originalContent.split('\n').length : 0
				const newLines = newContent.split('\n').length
				const addedLines = newLines > originalLines ? newLines - originalLines : 0
				const removedLines = newLines < originalLines ? originalLines - newLines : 0

				// Log successful preview generation
				await this.createAuditLog(
					toolName,
					sessionId,
					effectiveCallId,
					args,
					startTime,
					'read',
					{ preview: { originalContent, newContent, mode: updateArgs.mode, addedLines, removedLines } },
					undefined,
					updateArgs.path,
					undefined,
					true // Preview is always a dry run
				)

				return {
					originalContent,
					newContent,
					mode: updateArgs.mode,
					addedLines,
					removedLines
				}
			} catch (error) {
				// File read failed - log and return restricted preview
				await this.createAuditLog(
					toolName,
					sessionId,
					effectiveCallId,
					args,
					startTime,
					'read',
					undefined,
					error instanceof Error ? error : new Error(String(error)),
					updateArgs.path,
					false,
					true
				)
				console.warn('[ObsidianToolExecutor] Failed to generate preview:', error)
				return {
					originalContent: undefined,
					newContent: updateArgs.content,
					mode: updateArgs.mode
				}
			}
		}

		// For other tools, return undefined (no preview available)
		return undefined
	}
}
