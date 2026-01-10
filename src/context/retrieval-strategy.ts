/**
 * Context Retrieval Strategy
 * Provides on-demand context retrieval from vault using search
 */

import type { Vault, TFile } from 'obsidian'

/**
 * Retrieved context item
 */
export interface RetrievedContext {
  content: string
  source: string // File path or source identifier
  relevance: number // Relevance score (0-1)
  metadata?: {
    title?: string
    tags?: string[]
    created?: number
    modified?: number
  }
}

/**
 * Context retrieval priority levels
 */
export enum ContextPriority {
  CurrentNote = 1, // User's currently editing note
  RecentConversation = 2, // Recent N conversation messages
  TaskPlan = 3, // Structured task plan
  SearchResults = 4, // Results from vault search
  LongTermMemory = 5, // Compressed historical context
}

/**
 * Context retrieval result
 */
export interface RetrievalResult {
  contexts: RetrievedContext[]
  totalTokens: number // Estimated token count
  retrievalTime: number // Time taken in milliseconds
}

/**
 * Context retrieval strategy interface
 */
export interface IRetrievalStrategy {
  /**
   * Retrieve context based on query
   * @param query - Search query or description of needed context
   * @param maxResults - Maximum number of results to return
   * @param maxTokens - Maximum token budget for retrieved context
   * @returns Retrieved context items
   */
  retrieveContext(
    query: string,
    maxResults?: number,
    maxTokens?: number
  ): Promise<RetrievalResult>
}

/**
 * Vault-based retrieval strategy
 * Retrieves context by searching the Obsidian vault
 */
export class VaultRetrievalStrategy implements IRetrievalStrategy {
  private cache: Map<string, { result: RetrievalResult; timestamp: number }> = new Map()
  private cacheTTL: number = 60000 // 1 minute cache TTL

  constructor(
    private vault: Vault,
    private maxResults: number = 10,
    private maxTokens: number = 2000
  ) {}

  async retrieveContext(
    query: string,
    maxResults: number = this.maxResults,
    maxTokens: number = this.maxTokens
  ): Promise<RetrievalResult> {
    const startTime = Date.now()

    // Check cache first
    const cacheKey = `${query}:${maxResults}:${maxTokens}`
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.result
    }

    try {
      // Search vault for relevant files
      const searchResults = await this.searchVault(query, maxResults)
      
      // Retrieve content from matching files
      const contexts: RetrievedContext[] = []
      let totalTokens = 0

      for (const file of searchResults) {
        if (totalTokens >= maxTokens) {
          break
        }

        try {
          const content = await this.vault.adapter.read(file.path)
          const tokens = this.estimateTokens(content)
          
          // Skip if adding this file would exceed token budget
          if (totalTokens + tokens > maxTokens) {
            // Try to include partial content
            const remainingTokens = maxTokens - totalTokens
            if (remainingTokens > 100) { // Only include if we have meaningful space
              const partialContent = this.truncateToTokens(content, remainingTokens)
              contexts.push({
                content: partialContent,
                source: file.path,
                relevance: 0.8, // Default relevance for partial matches
                metadata: {
                  title: file.basename,
                },
              })
              totalTokens += this.estimateTokens(partialContent)
            }
            break
          }

          contexts.push({
            content,
            source: file.path,
            relevance: 0.9, // High relevance for exact matches
            metadata: {
              title: file.basename,
            },
          })

          totalTokens += tokens
        } catch (error) {
          console.warn(`[VaultRetrievalStrategy] Failed to read file ${file.path}:`, error)
          // Continue with next file
        }
      }

      const result: RetrievalResult = {
        contexts,
        totalTokens,
        retrievalTime: Date.now() - startTime,
      }

      // Cache result
      this.cache.set(cacheKey, { result, timestamp: Date.now() })
      
      // Clean old cache entries
      this.cleanCache()

      return result
    } catch (error) {
      console.error('[VaultRetrievalStrategy] Error retrieving context:', error)
      return {
        contexts: [],
        totalTokens: 0,
        retrievalTime: Date.now() - startTime,
      }
    }
  }

  /**
   * Search vault for files matching query
   */
  private async searchVault(query: string, maxResults: number): Promise<TFile[]> {
    try {
      // Use Obsidian's search API
      // Note: This is a simplified implementation
      // In a real implementation, we would use vault.getMarkdownFiles() and filter
      const allFiles = this.vault.getMarkdownFiles()
      
      // Simple text matching (case-insensitive)
      const queryLower = query.toLowerCase()
      const matches: Array<{ file: TFile; score: number }> = []

      for (const file of allFiles) {
        let score = 0
        const nameLower = file.basename.toLowerCase()
        const pathLower = file.path.toLowerCase()

        // Score based on name match
        if (nameLower.includes(queryLower)) {
          score += 10
        }
        if (pathLower.includes(queryLower)) {
          score += 5
        }

        // Score based on path depth (shallow files get higher score)
        const depth = file.path.split('/').length - 1
        score += Math.max(0, 10 - depth)

        if (score > 0) {
          matches.push({ file, score })
        }
      }

      // Sort by score (descending) and return top results
      matches.sort((a, b) => b.score - a.score)
      return matches.slice(0, maxResults).map(m => m.file)
    } catch (error) {
      console.error('[VaultRetrievalStrategy] Error searching vault:', error)
      return []
    }
  }

  /**
   * Estimate token count for text
   * Simple estimation: ~4 characters per token
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  /**
   * Truncate text to fit within token budget
   */
  private truncateToTokens(text: string, maxTokens: number): string {
    const maxChars = maxTokens * 4
    if (text.length <= maxChars) {
      return text
    }

    // Truncate at sentence boundary if possible
    const truncated = text.substring(0, maxChars)
    const lastSentenceEnd = Math.max(
      truncated.lastIndexOf('. '),
      truncated.lastIndexOf('.\n'),
      truncated.lastIndexOf('。')
    )

    if (lastSentenceEnd > maxChars * 0.8) {
      return truncated.substring(0, lastSentenceEnd + 1)
    }

    return truncated + '...'
  }

  /**
   * Clean old cache entries
   */
  private cleanCache(): void {
    const now = Date.now()
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheTTL * 2) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Update configuration
   */
  updateConfig(config: { maxResults?: number; maxTokens?: number; cacheTTL?: number }): void {
    if (config.maxResults !== undefined) {
      this.maxResults = config.maxResults
    }
    if (config.maxTokens !== undefined) {
      this.maxTokens = config.maxTokens
    }
    if (config.cacheTTL !== undefined) {
      this.cacheTTL = config.cacheTTL
    }
  }
}
