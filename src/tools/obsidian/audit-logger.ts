import type { Vault, TFile } from 'obsidian'
import type { AuditLogEntry, AuditLogFilter } from './types'
import { minimatch } from 'minimatch'

/**
 * Audit logger for tool executions
 * Logs all tool calls with metadata, persists to files, and provides query interface
 */
export class AuditLogger {
  private vault: Vault
  private auditDir: string
  private inMemoryLogs: AuditLogEntry[] = []
  private maxInMemoryLogs: number = 1000
  private retentionDays: number = 30

  constructor(vault: Vault, auditDir: string = '.opencode/audit', retentionDays: number = 30) {
    this.vault = vault
    this.auditDir = auditDir
    this.retentionDays = retentionDays
  }

  /**
   * Log a tool execution
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      // Add to in-memory queue (for real-time queries)
      this.inMemoryLogs.push(entry)
      
      // Trim in-memory logs if too large
      if (this.inMemoryLogs.length > this.maxInMemoryLogs) {
        this.inMemoryLogs = this.inMemoryLogs.slice(-this.maxInMemoryLogs)
      }

      // Persist to file (JSONL format - one JSON object per line)
      await this.persistLog(entry)
    } catch (error) {
      console.error('[AuditLogger] Failed to log entry:', error)
      // Don't throw - logging failures shouldn't break tool execution
    }
  }

  /**
   * Persist a log entry to file
   */
  private async persistLog(entry: AuditLogEntry): Promise<void> {
    // Get file path for today's date
    const date = new Date(entry.timestamp)
    const dateStr = this.formatDate(date)
    const filePath = `${this.auditDir}/${dateStr}.jsonl`

    try {
      // Ensure audit directory exists
      await this.ensureAuditDir()

      // Append to file (JSONL format)
      const logLine = JSON.stringify(entry) + '\n'
      const existingFile = this.vault.getAbstractFileByPath(filePath)
      
      if (existingFile && existingFile instanceof TFile) {
        // Append to existing file
        const currentContent = await this.vault.read(existingFile)
        await this.vault.modify(existingFile, currentContent + logLine)
      } else {
        // Create new file
        await this.vault.create(filePath, logLine)
      }
    } catch (error) {
      console.error(`[AuditLogger] Failed to persist log to ${filePath}:`, error)
      throw error
    }
  }

  /**
   * Ensure audit directory exists
   */
  private async ensureAuditDir(): Promise<void> {
    try {
      // Check if directory exists
      const dir = this.vault.getAbstractFileByPath(this.auditDir)
      if (!dir) {
        // Create directory (Obsidian creates parent directories automatically)
        await this.vault.createFolder(this.auditDir)
      }
    } catch (error) {
      // Directory might already exist, or we might not have permission
      // In production, we'd want more specific error handling
      console.warn(`[AuditLogger] Could not ensure audit directory exists: ${String(error)}`)
    }
  }

  /**
   * Format date as YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  /**
   * Query audit logs with filters
   */
  async getLogs(filter?: AuditLogFilter): Promise<AuditLogEntry[]> {
    try {
      // Start with in-memory logs (fastest)
      let results = [...this.inMemoryLogs]

      // If filter requires historical data, load from files
      if (filter?.startTime || filter?.endTime || filter?.offset || filter?.limit) {
        // Load from files for date range queries
        const fileResults = await this.loadLogsFromFiles(filter)
        // Merge with in-memory logs (in-memory logs are more recent)
        results = [...fileResults, ...this.inMemoryLogs]
        // Sort by timestamp (most recent first)
        results.sort((a, b) => b.timestamp - a.timestamp)
      }

      // Apply filters
      results = this.applyFilters(results, filter)

      // Apply pagination
      if (filter?.offset || filter?.limit) {
        const offset = filter.offset || 0
        const limit = filter.limit || 100
        results = results.slice(offset, offset + limit)
      }

      return results
    } catch (error) {
      console.error('[AuditLogger] Failed to query logs:', error)
      // Return empty array on error (better than throwing)
      return []
    }
  }

  /**
   * Load logs from files based on filter
   */
  private async loadLogsFromFiles(filter?: AuditLogFilter): Promise<AuditLogEntry[]> {
    const results: AuditLogEntry[] = []
    
    // Determine date range to load
    let startDate: Date | undefined
    let endDate: Date | undefined

    if (filter?.startTime) {
      startDate = new Date(filter.startTime)
    }
    if (filter?.endTime) {
      endDate = new Date(filter.endTime)
    }

    // If no date range specified, load today's file only (for performance)
    if (!startDate && !endDate) {
      const today = new Date()
      const todayStr = this.formatDate(today)
      const filePath = `${this.auditDir}/${todayStr}.jsonl`
      const logs = await this.loadLogsFromFile(filePath)
      results.push(...logs)
      return results
    }

    // Load files for date range
    const currentDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Default: 30 days ago
    const endDateToLoad = endDate || new Date()
    
    const date = new Date(currentDate)
    while (date <= endDateToLoad) {
      const dateStr = this.formatDate(date)
      const filePath = `${this.auditDir}/${dateStr}.jsonl`
      const logs = await this.loadLogsFromFile(filePath)
      results.push(...logs)
      
      // Move to next day
      date.setDate(date.getDate() + 1)
    }

    return results
  }

  /**
   * Load logs from a single file
   */
  private async loadLogsFromFile(filePath: string): Promise<AuditLogEntry[]> {
    try {
      const file = this.vault.getAbstractFileByPath(filePath)
      if (!file || !(file instanceof TFile)) {
        return []
      }

      const content = await this.vault.read(file)
      const lines = content.split('\n').filter(line => line.trim())
      
      const logs: AuditLogEntry[] = []
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as AuditLogEntry
          logs.push(entry)
        } catch (error) {
          // Skip malformed lines
          console.warn(`[AuditLogger] Skipping malformed log line in ${filePath}:`, error)
        }
      }

      return logs
    } catch {
      // File doesn't exist or can't be read - return empty array
      return []
    }
  }

  /**
   * Apply filters to log entries
   */
  private applyFilters(entries: AuditLogEntry[], filter?: AuditLogFilter): AuditLogEntry[] {
    if (!filter) {
      return entries
    }

    return entries.filter(entry => {
      // Filter by tool name
      if (filter.toolName && entry.toolName !== filter.toolName) {
        return false
      }

      // Filter by session ID
      if (filter.sessionId && entry.sessionId !== filter.sessionId) {
        return false
      }

      // Filter by call ID
      if (filter.callId && entry.callId !== filter.callId) {
        return false
      }

      // Filter by time range
      if (filter.startTime && entry.timestamp < filter.startTime) {
        return false
      }
      if (filter.endTime && entry.timestamp > filter.endTime) {
        return false
      }

      // Filter by path pattern (glob matching)
      if (filter.pathPattern && entry.affectedPath) {
        if (!minimatch(entry.affectedPath, filter.pathPattern)) {
          return false
        }
      }

      // Filter by permission level
      if (filter.permissionLevel && entry.permissionLevel !== filter.permissionLevel) {
        return false
      }

      // Filter by error status
      if (filter.isError !== undefined && entry.isError !== filter.isError) {
        return false
      }

      // Filter by approval status
      if (filter.approved !== undefined && entry.approved !== filter.approved) {
        return false
      }

      // Filter by dry-run status
      if (filter.dryRun !== undefined && entry.dryRun !== filter.dryRun) {
        return false
      }

      return true
    })
  }

  /**
   * Clean up old log files (based on retention policy)
   */
  async cleanupOldLogs(): Promise<void> {
    try {
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays)

      // Get all audit log files
      const auditDir = this.vault.getAbstractFileByPath(this.auditDir)
      if (!auditDir) {
        return // No audit directory exists yet
      }

      // Note: Obsidian doesn't provide a direct way to list directory contents
      // We'll need to track files we create, or rely on file system access if available
      // For now, we'll just log a warning that cleanup requires manual intervention
      // In a production system, we'd maintain a manifest of log files
      console.debug(`[AuditLogger] Cleanup not implemented - requires file system access to list files`)
      console.debug(`[AuditLogger] Retention policy: keep last ${this.retentionDays} days`)
    } catch (error) {
      console.error('[AuditLogger] Failed to cleanup old logs:', error)
    }
  }

  /**
   * Get log statistics
   */
  async getStats(filter?: AuditLogFilter): Promise<{
    total: number
    byTool: Record<string, number>
    byError: { errors: number; successes: number }
    byApproval: { approved: number; rejected: number; notRequired: number }
  }> {
    const logs = await this.getLogs(filter)
    
    const stats = {
      total: logs.length,
      byTool: {} as Record<string, number>,
      byError: { errors: 0, successes: 0 },
      byApproval: { approved: 0, rejected: 0, notRequired: 0 }
    }

    for (const log of logs) {
      // Count by tool
      stats.byTool[log.toolName] = (stats.byTool[log.toolName] || 0) + 1

      // Count by error status
      if (log.isError) {
        stats.byError.errors++
      } else {
        stats.byError.successes++
      }

      // Count by approval status
      if (log.requiredApproval) {
        if (log.approved === true) {
          stats.byApproval.approved++
        } else if (log.approved === false) {
          stats.byApproval.rejected++
        }
      } else {
        stats.byApproval.notRequired++
      }
    }

    return stats
  }

  /**
   * Set retention days
   */
  setRetentionDays(days: number): void {
    this.retentionDays = days
  }

  /**
   * Get retention days
   */
  getRetentionDays(): number {
    return this.retentionDays
  }
}