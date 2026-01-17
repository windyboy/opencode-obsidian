import type { App, Vault, MetadataCache, TAbstractFile, TFile, TFolder } from 'obsidian'
import { TFile as TFileClass } from 'obsidian'
import { PermissionManager } from './permission-manager'
import { AuditLogger } from './audit-logger'
import type {
	ObsidianSearchVaultInput,
	ObsidianSearchVaultOutput,
	ObsidianReadNoteInput,
	ObsidianReadNoteOutput,
	ObsidianListNotesInput,
	ObsidianListNotesOutput,
	ObsidianGetNoteMetadataInput,
	ObsidianGetNoteMetadataOutput,
	AuditLogEntry
} from './types'

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

/**
 * Vault reader for read-only Obsidian vault operations
 * Handles search, read, list, and metadata operations with permission checks and audit logging
 */
export class VaultReader {
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

	private generateLogId(): string {
		return `log_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
	}

	private getBacklinks(file: TFile): string[] {
		const allFiles = this.vault.getMarkdownFiles()
		const backlinks: string[] = []
		
		for (const otherFile of allFiles) {
			const otherCache = this.metadataCache.getFileCache(otherFile)
			if (otherCache?.links) {
				const isLinked = otherCache.links.some(link => {
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

	private async createAuditLog(
		toolName: string,
		sessionId: string | undefined,
		callId: string,
		input: unknown,
		startTime: number,
		operation: 'read',
		output?: unknown,
		error?: Error,
		affectedPath?: string
	): Promise<void> {
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
			permissionLevel: this.permissionManager.getPermissionLevel(),
			requiredApproval: false,
			approved: undefined,
			dryRun: false,
			affectedPath,
			duration: Date.now() - startTime
		}

		await this.auditLogger.log(logEntry)
	}

	private async executeWithAuditLog<T>(
		toolName: string,
		sessionId: string | undefined,
		callId: string,
		input: unknown,
		affectedPath: string | undefined,
		executeFn: () => Promise<T>
	): Promise<T> {
		const startTime = Date.now()
		
		try {
			const result = await executeFn()
			await this.createAuditLog(toolName, sessionId, callId, input, startTime, 'read', result, undefined, affectedPath)
			return result
		} catch (error) {
			await this.createAuditLog(
				toolName,
				sessionId,
				callId,
				input,
				startTime,
				'read',
				undefined,
				error instanceof Error ? error : new Error(String(error)),
				affectedPath
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
		const effectiveCallId = callId || `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
		
		return this.executeWithAuditLog(
			'obsidian.search_vault',
			sessionId,
			effectiveCallId,
			input,
			undefined, // No specific affected path for search
			async () => {
				const allFiles = this.vault.getMarkdownFiles()
				const queryLower = input.query.toLowerCase()
				const results: Array<{ path: string; title: string; content?: string; matchCount: number }> = []
				
				for (const file of allFiles) {
					const pathMatch = file.path.toLowerCase().includes(queryLower) || 
													 file.basename.toLowerCase().includes(queryLower)
					
					if (pathMatch) {
						let content: string | undefined
						let matchCount = 0
						
						if (input.includeContent || !pathMatch) {
							try {
								const fileContent = await this.vault.read(file)
								const contentMatch = fileContent.toLowerCase().includes(queryLower)
								
								if (contentMatch || pathMatch) {
									content = input.includeContent ? fileContent : undefined
									const regex = new RegExp(queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
									const matches = fileContent.match(regex)
									matchCount = matches ? matches.length : (pathMatch ? 1 : 0)
									
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
								continue
							}
						} else if (pathMatch) {
							matchCount = 1
						}
						
						if (matchCount > 0) {
							results.push({ path: file.path, title: file.basename, content, matchCount })
						}
					}
				}
				
				results.sort((a, b) => b.matchCount - a.matchCount)
				const limitedResults = results.slice(0, input.limit || 20)
				
				return { results: limitedResults, totalMatches: results.length }
			}
		)
	}

	/**
	 * Read a note file
	 */
	async readNote(
		input: ObsidianReadNoteInput,
		sessionId?: string,
		callId?: string
	): Promise<ObsidianReadNoteOutput> {
		const effectiveCallId = callId || `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
		
		return this.executeWithAuditLog(
			'obsidian.read_note',
			sessionId,
			effectiveCallId,
			input,
			input.path,
			async () => {
				const permission = await this.permissionManager.canRead(input.path)
				if (!permission.allowed) {
					throw new Error(`Permission denied: ${permission.reason}`)
				}

				const file = this.vault.getAbstractFileByPath(input.path)
				
				if (!isTFile(file)) {
					return { path: input.path, content: '', exists: false }
				}

				const content = await this.vault.read(file)
				return { path: input.path, content, exists: true }
			}
		)
	}

	/**
	 * List notes in a folder
	 */
	async listNotes(
		input: ObsidianListNotesInput,
		sessionId?: string,
		callId?: string
	): Promise<ObsidianListNotesOutput> {
		const effectiveCallId = callId || `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
		
		return this.executeWithAuditLog(
			'obsidian.list_notes',
			sessionId,
			effectiveCallId,
			input,
			undefined, // No specific affected path for listing
			async () => {
				const folderPath = input.folder || ''
				const folder = folderPath ? this.vault.getAbstractFileByPath(folderPath) : null
				
				if (folderPath && !isTFolder(folder)) {
					return { files: [], totalCount: 0 }
				}

				const files: Array<{ path: string; isFolder?: boolean; size?: number; modified?: number }> = []
				
				const collectFiles = (folder: TFolder | null, recursive: boolean) => {
					const targetFolder = folder || this.vault.getRoot()
					
					for (const child of targetFolder.children) {
						if (isTFile(child)) {
							files.push({ path: child.path, size: child.stat.size, modified: child.stat.mtime })
						} else if (isTFolder(child) && input.includeFolders) {
							files.push({ path: child.path, isFolder: true })
							if (recursive) {
								collectFiles(child, recursive)
							}
						} else if (isTFolder(child) && recursive) {
							collectFiles(child, recursive)
						}
					}
				}

				const targetFolder: TFolder | null = folder && isTFolder(folder) ? folder : null
				collectFiles(targetFolder, input.recursive ?? true)

				return { files, totalCount: files.length }
			}
		)
	}

	/**
	 * Get note metadata (frontmatter, tags, links, statistics)
	 */
	async getNoteMetadata(
		input: ObsidianGetNoteMetadataInput,
		sessionId?: string,
		callId?: string
	): Promise<ObsidianGetNoteMetadataOutput> {
		const effectiveCallId = callId || `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
		
		return this.executeWithAuditLog(
			'obsidian.get_note_metadata',
			sessionId,
			effectiveCallId,
			input,
			input.path,
			async () => {
				const file = this.vault.getAbstractFileByPath(input.path)
				
				if (!isTFile(file)) {
					return { path: input.path, exists: false }
				}

				const cache = this.metadataCache.getFileCache(file)
				const content = await this.vault.read(file)

				let frontmatter: Record<string, unknown> | undefined
				if (input.includeProperties && cache?.frontmatter) {
					frontmatter = cache.frontmatter
				}

				const tags: string[] | undefined = input.includeTags && cache?.tags
					? cache.tags.map(tag => tag.tag)
					: undefined

				const links: { outlinks: string[]; backlinks: string[]; unresolvedLinks?: string[] } | undefined = input.includeLinks
					? {
							outlinks: cache?.links ? Array.from(new Set(cache.links.map(l => l.link))) : [],
							backlinks: this.getBacklinks(file),
							unresolvedLinks: cache?.links ? cache.links
								.map(l => l.link)
								.filter(linkPath => !this.vault.getAbstractFileByPath(linkPath)) : []
						}
					: undefined

				const stats = {
					wordCount: content.split(/\s+/).filter(w => w.length > 0).length,
					lineCount: content.split('\n').length,
					characterCount: content.length
				}

				let title: string | undefined
				if (frontmatter?.title && typeof frontmatter.title === 'string') {
					title = frontmatter.title
				} else {
					const headingMatch = content.match(/^#+\s+(.+)$/m)
					title = headingMatch?.[1]?.trim() || file.basename
				}

				return {
					path: input.path,
					exists: true,
					title,
					frontmatter: input.includeProperties ? frontmatter : undefined,
					tags,
					links,
					stats
				}
			}
		)
	}

	/**
	 * Generate preview for read operations (for permission modal)
	 */
	async generatePreview(
		toolName: string,
		args: unknown,
		sessionId?: string,
		callId?: string
	): Promise<{ originalContent?: string; path: string } | undefined> {
		const startTime = Date.now()
		const effectiveCallId = callId || `preview_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
		
		if (toolName === 'obsidian.read_note') {
			const readArgs = args as { path: string }
			
			try {
				const permissionResult = await this.permissionManager.canRead(readArgs.path)
				
				if (!permissionResult.allowed) {
					await this.createAuditLog(
						toolName, sessionId, effectiveCallId, args, startTime, 'read',
						undefined, new Error(`Permission denied for preview: ${permissionResult.reason}`), readArgs.path
					)
					throw new Error(`Permission denied: ${permissionResult.reason}`)
				}
			} catch (error) {
				await this.createAuditLog(
					toolName, sessionId, effectiveCallId, args, startTime, 'read',
					undefined, error instanceof Error ? error : new Error(String(error)), readArgs.path
				)
				throw error
			}
			
			try {
				let originalContent: string | undefined
				const file = this.vault.getAbstractFileByPath(readArgs.path)
				
				if (isTFile(file)) {
					originalContent = await this.vault.read(file)
				}

				await this.createAuditLog(
					toolName, sessionId, effectiveCallId, args, startTime, 'read',
					{ preview: { originalContent, path: readArgs.path } }, undefined, readArgs.path
				)

				return { originalContent, path: readArgs.path }
			} catch (error) {
				await this.createAuditLog(
					toolName, sessionId, effectiveCallId, args, startTime, 'read',
					undefined, error instanceof Error ? error : new Error(String(error)), readArgs.path
				)
				console.warn('[VaultReader] Failed to generate preview:', error)
				return { originalContent: undefined, path: readArgs.path }
			}
		}

		return undefined
	}
}
