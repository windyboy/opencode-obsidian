import type { Vault } from 'obsidian'
import { SessionStorage, type StoredSession } from './session-storage'
import type { EmbeddedSession } from '../embedded-ai-client'
import { SESSION_CONFIG } from '../utils/constants'

export interface SessionManagerConfig {
  autoSave?: boolean // Default: true
  autoSaveInterval?: number // Default: 30000 (30 seconds)
  maxStoredSessions?: number // Default: 50
  cleanupOldSessions?: boolean // Default: true
  sessionTTL?: number // Default: 7 days in milliseconds
}

export class SessionManager {
  private storage: SessionStorage
  private config: Required<SessionManagerConfig>
  private autoSaveInterval: ReturnType<typeof setInterval> | null = null
  private pendingSessions: Set<string> = new Set()
  private lastSaved: Map<string, number> = new Map()

  constructor(vault: Vault, config: SessionManagerConfig = {}) {
    this.storage = new SessionStorage(vault)
    this.config = {
      autoSave: config.autoSave ?? true,
      autoSaveInterval: config.autoSaveInterval ?? SESSION_CONFIG.AUTO_SAVE_INTERVAL,
      maxStoredSessions: config.maxStoredSessions ?? SESSION_CONFIG.MAX_SESSIONS,
      cleanupOldSessions: config.cleanupOldSessions ?? true,
      sessionTTL: config.sessionTTL ?? SESSION_CONFIG.DEFAULT_TTL,
    }

    if (this.config.autoSave) {
      this.startAutoSave()
    }

    if (this.config.cleanupOldSessions) {
      void this.cleanupOldSessions()
    }
  }

  /**
   * Save a session (immediate)
   */
  async saveSession(session: EmbeddedSession): Promise<void> {
    try {
      await this.storage.saveSession(session)
      this.lastSaved.set(session.id, Date.now())
      this.pendingSessions.delete(session.id)
    } catch (error) {
      console.error(`[SessionManager] Failed to save session ${session.id}:`, error)
      // Mark as pending for retry
      this.pendingSessions.add(session.id)
    }
  }

  /**
   * Schedule a session for auto-save
   */
  scheduleSave(sessionId: string): void {
    if (!this.config.autoSave) {
      return
    }

    this.pendingSessions.add(sessionId)
    
    // If auto-save is running, it will pick this up
    // Otherwise, we could trigger immediate save if enough time has passed
    const lastSaved = this.lastSaved.get(sessionId) || 0
    const timeSinceLastSave = Date.now() - lastSaved
    
    // If more than minimum interval since last save, save immediately
    if (timeSinceLastSave > SESSION_CONFIG.MIN_SAVE_INTERVAL) {
      // This will be handled by the next auto-save cycle
      // or we could trigger it here, but we need the session object
    }
  }

  /**
   * Load a session from storage
   */
  async loadSession(sessionId: string): Promise<StoredSession | null> {
    return this.storage.loadSession(sessionId)
  }

  /**
   * List all stored sessions
   */
  async listSessions(): Promise<StoredSession[]> {
    return this.storage.listSessions()
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const result = await this.storage.deleteSession(sessionId)
    this.lastSaved.delete(sessionId)
    this.pendingSessions.delete(sessionId)
    return result
  }

  /**
   * Get recently saved sessions
   */
  async getRecentSessions(limit: number = 10): Promise<StoredSession[]> {
    const sessions = await this.listSessions()
    return sessions.slice(0, limit)
  }

  /**
   * Start auto-save interval
   */
  private startAutoSave(): void {
    if (this.autoSaveInterval) {
      return
    }

    this.autoSaveInterval = setInterval(() => {
      // Auto-save is triggered externally via scheduleSave
      // We just ensure the interval is running
      // Actual save happens when sessions are marked as pending
    }, this.config.autoSaveInterval)

      // Auto-save started
  }

  /**
   * Stop auto-save interval
   */
  stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval)
      this.autoSaveInterval = null
      // Auto-save stopped
    }
  }

  /**
   * Cleanup old sessions
   */
  private async cleanupOldSessions(): Promise<void> {
    try {
      const cutoffTime = Date.now() - this.config.sessionTTL
      await this.storage.deleteOldSessions(cutoffTime)

      // Also limit total number of sessions
      const sessions = await this.listSessions()
      if (sessions.length > this.config.maxStoredSessions) {
        const toDelete = sessions.slice(this.config.maxStoredSessions)
        for (const session of toDelete) {
          await this.deleteSession(session.id)
        }
      }
    } catch (error) {
      console.error('[SessionManager] Failed to cleanup old sessions:', error)
    }
  }

  /**
   * Get pending sessions (for external save operations)
   */
  getPendingSessions(): string[] {
    return Array.from(this.pendingSessions)
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SessionManagerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    }

    // Restart auto-save if needed
    if (this.config.autoSave && !this.autoSaveInterval) {
      this.startAutoSave()
    } else if (!this.config.autoSave && this.autoSaveInterval) {
      this.stopAutoSave()
    }
  }

  /**
   * Cleanup on shutdown
   */
  async shutdown(): Promise<void> {
    this.stopAutoSave()
    
    // Save any pending sessions (if we have access to them)
    // This would require external coordination
      // Shutdown complete
  }
}
