import type { Vault } from 'obsidian'
import type { EmbeddedSession } from '../embedded-ai-client'

export interface StoredSession extends EmbeddedSession {
  savedAt: number
  version: string
}

export class SessionStorage {
  private vault: Vault
  private storagePath: string = '.opencode/sessions'

  constructor(vault: Vault, storagePath?: string) {
    this.vault = vault
    if (storagePath) {
      this.storagePath = storagePath
    }
  }

  /**
   * Save a session to disk
   */
  async saveSession(session: EmbeddedSession): Promise<void> {
    try {
      // Ensure directory exists
      await this.ensureDirectoryExists()

      // Create stored session with metadata
      const storedSession: StoredSession = {
        ...session,
        savedAt: Date.now(),
        version: '1.0',
      }

      // Save as JSON file
      const fileName = `${session.id}.json`
      const filePath = `${this.storagePath}/${fileName}`
      
      await this.vault.adapter.write(
        filePath,
        JSON.stringify(storedSession, null, 2)
      )

      // Session saved
    } catch (error) {
      console.error(`[SessionStorage] Failed to save session ${session.id}:`, error)
      throw error
    }
  }

  /**
   * Load a session from disk
   */
  async loadSession(sessionId: string): Promise<StoredSession | null> {
    try {
      const fileName = `${sessionId}.json`
      const filePath = `${this.storagePath}/${fileName}`

      if (!(await this.vault.adapter.exists(filePath))) {
        return null
      }

      const content = await this.vault.adapter.read(filePath)
      const storedSession: StoredSession = JSON.parse(content)

      // Session loaded
      return storedSession
    } catch (error) {
      console.error(`[SessionStorage] Failed to load session ${sessionId}:`, error)
      return null
    }
  }

  /**
   * List all saved sessions
   */
  async listSessions(): Promise<StoredSession[]> {
    try {
      if (!(await this.vault.adapter.exists(this.storagePath))) {
        return []
      }

      const files = await this.vault.adapter.list(this.storagePath)
      const sessions: StoredSession[] = []

      for (const file of files.files || []) {
        if (file.endsWith('.json')) {
          const sessionId = file.replace(`${this.storagePath}/`, '').replace('.json', '')
          const session = await this.loadSession(sessionId)
          if (session) {
            sessions.push(session)
          }
        }
      }

      // Sort by updatedAt descending (most recent first)
      sessions.sort((a, b) => b.updatedAt - a.updatedAt)

      return sessions
    } catch (error) {
      console.error('[SessionStorage] Failed to list sessions:', error)
      return []
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const fileName = `${sessionId}.json`
      const filePath = `${this.storagePath}/${fileName}`

      if (!(await this.vault.adapter.exists(filePath))) {
        return false
      }

      await this.vault.adapter.remove(filePath)
      // Session deleted
      return true
    } catch (error) {
      console.error(`[SessionStorage] Failed to delete session ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Delete all sessions older than specified timestamp
   */
  async deleteOldSessions(olderThan: number): Promise<number> {
    try {
      const sessions = await this.listSessions()
      let deletedCount = 0

      for (const session of sessions) {
        if (session.updatedAt < olderThan) {
          const deleted = await this.deleteSession(session.id)
          if (deleted) {
            deletedCount++
          }
        }
      }

      // Old sessions deleted
      return deletedCount
    } catch (error) {
      console.error('[SessionStorage] Failed to delete old sessions:', error)
      return 0
    }
  }

  /**
   * Ensure the storage directory exists
   */
  private async ensureDirectoryExists(): Promise<void> {
    if (!(await this.vault.adapter.exists(this.storagePath))) {
      await this.vault.adapter.mkdir(this.storagePath)
    }
  }
}
