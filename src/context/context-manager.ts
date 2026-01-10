import { TokenEstimator } from './token-estimator'
import { CONTEXT_CONFIG } from '../utils/constants'
import type { IRetrievalStrategy, RetrievedContext } from './retrieval-strategy'
import { ContextPriority } from './retrieval-strategy'
import { ContextBudgetAllocator, type BudgetAllocationResult } from './context-budget-allocator'
import { VaultRetrievalStrategy } from './retrieval-strategy'
import type { Vault, App } from 'obsidian'

export interface ContextUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  contextWindow: number
  percentage: number
  estimatedInputTokens?: number
  estimatedContextTokens?: number
}

export interface ContextManagerConfig {
  maxContextTokens?: number // Default: 50000
  preemptiveCompactionThreshold?: number // Default: 0.85 (85%)
  enableTokenEstimation?: boolean // Default: true
  retrievalStrategy?: IRetrievalStrategy // Optional retrieval strategy
  budgetAllocator?: ContextBudgetAllocator // Optional budget allocator
  maxRetrievalResults?: number // Default: 10
  maxRetrievalTokens?: number // Default: 2000
}

export interface RetrievedContextWithPriority {
  context: RetrievedContext
  priority: ContextPriority
}

export interface ContextRetrievalResult {
  contexts: RetrievedContext[]
  totalTokens: number
  retrievalTime: number
  allocationResult?: BudgetAllocationResult
}

export class ContextManager {
  private tokenEstimator: TokenEstimator
  private config: Required<Omit<ContextManagerConfig, 'retrievalStrategy' | 'budgetAllocator'>> & {
    retrievalStrategy?: IRetrievalStrategy
    budgetAllocator?: ContextBudgetAllocator
  }
  private currentUsage: ContextUsage | null = null
  private retrievalStrategy?: IRetrievalStrategy
  private budgetAllocator?: ContextBudgetAllocator

  constructor(config: ContextManagerConfig = {}, app?: App, vault?: Vault) {
    this.tokenEstimator = new TokenEstimator()
    this.config = {
      maxContextTokens: config.maxContextTokens ?? CONTEXT_CONFIG.MAX_TOKENS,
      preemptiveCompactionThreshold: config.preemptiveCompactionThreshold ?? CONTEXT_CONFIG.PREEMPTIVE_THRESHOLD,
      enableTokenEstimation: config.enableTokenEstimation ?? true,
      maxRetrievalResults: config.maxRetrievalResults ?? 10,
      maxRetrievalTokens: config.maxRetrievalTokens ?? 2000,
      retrievalStrategy: config.retrievalStrategy,
      budgetAllocator: config.budgetAllocator,
    }

    // Initialize retrieval strategy if not provided and vault is available
    if (!this.config.retrievalStrategy && vault) {
      this.retrievalStrategy = new VaultRetrievalStrategy(
        vault,
        this.config.maxRetrievalResults,
        this.config.maxRetrievalTokens
      )
    } else {
      this.retrievalStrategy = this.config.retrievalStrategy
    }

    // Initialize budget allocator if not provided
    if (!this.config.budgetAllocator) {
      this.budgetAllocator = new ContextBudgetAllocator({
        totalBudget: this.config.maxRetrievalTokens,
      })
    } else {
      this.budgetAllocator = this.config.budgetAllocator
    }
  }

  /**
   * Update context usage from API response
   */
  updateUsage(usage: {
    inputTokens?: number
    outputTokens?: number
    contextTokens?: number
    contextWindow?: number
  }): void {
    const inputTokens = usage.inputTokens ?? usage.contextTokens ?? 0
    const outputTokens = usage.outputTokens ?? 0
    const totalTokens = inputTokens + outputTokens
    const contextWindow = usage.contextWindow ?? this.config.maxContextTokens
    const percentage = contextWindow > 0 ? totalTokens / contextWindow : 0

    this.currentUsage = {
      inputTokens,
      outputTokens,
      totalTokens,
      contextWindow,
      percentage,
    }
  }

  /**
   * Estimate context tokens from messages
   */
  estimateContextTokens(
    messages: Array<{
      role: 'user' | 'assistant' | 'system'
      content: string | Array<{ type: string; text?: string; [key: string]: unknown }>
    }>,
    systemPrompt?: string
  ): number {
    if (!this.config.enableTokenEstimation) {
      return 0
    }

    let total = 0

    // Estimate system prompt
    if (systemPrompt) {
      total += this.tokenEstimator.estimateSystemTokens(systemPrompt)
    }

    // Estimate messages
    total += this.tokenEstimator.estimateMessageTokens(messages)

    return total
  }

  /**
   * Get current usage
   */
  getUsage(): ContextUsage | null {
    return this.currentUsage
  }

  /**
   * Check if context is approaching limit
   */
  shouldTriggerPreemptiveCompaction(): boolean {
    if (!this.currentUsage) {
      return false
    }

    const threshold = this.config.preemptiveCompactionThreshold
    return this.currentUsage.percentage >= threshold
  }

  /**
   * Check if context is full
   */
  isContextFull(): boolean {
    if (!this.currentUsage) {
      return false
    }

    // Consider full at 95% to leave some buffer
    return this.currentUsage.percentage >= CONTEXT_CONFIG.FULL_THRESHOLD
  }

  /**
   * Get percentage of context used
   */
  getUsagePercentage(): number {
    return this.currentUsage?.percentage ?? 0
  }

  /**
   * Get estimated remaining tokens
   */
  getRemainingTokens(): number {
    if (!this.currentUsage) {
      return this.config.maxContextTokens
    }

    return Math.max(0, this.currentUsage.contextWindow - this.currentUsage.totalTokens)
  }

  /**
   * Reset usage tracking
   */
  reset(): void {
    this.currentUsage = null
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ContextManagerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    }
  }

  /**
   * Get configuration
   */
  getConfig(): Required<Omit<ContextManagerConfig, 'retrievalStrategy' | 'budgetAllocator'>> {
    return {
      maxContextTokens: this.config.maxContextTokens,
      preemptiveCompactionThreshold: this.config.preemptiveCompactionThreshold,
      enableTokenEstimation: this.config.enableTokenEstimation,
      maxRetrievalResults: this.config.maxRetrievalResults,
      maxRetrievalTokens: this.config.maxRetrievalTokens,
    }
  }

  /**
   * Retrieve context based on query
   * Uses retrieval strategy and budget allocator to fetch and prioritize context
   */
  async retrieveContext(
    query: string,
    options?: {
      maxResults?: number
      maxTokens?: number
      priorities?: RetrievedContextWithPriority[]
      currentNotePath?: string
      recentMessages?: Array<{ role: string; content: string }>
      taskPlan?: unknown
    }
  ): Promise<ContextRetrievalResult> {
    if (!this.retrievalStrategy) {
      // No retrieval strategy available, return empty result
      return {
        contexts: [],
        totalTokens: 0,
        retrievalTime: 0,
      }
    }

    const startTime = Date.now()
    const maxResults = options?.maxResults ?? this.config.maxRetrievalResults
    const maxTokens = options?.maxTokens ?? this.config.maxRetrievalTokens

    try {
      // Retrieve contexts using strategy
      const retrievalResult = await this.retrievalStrategy.retrieveContext(query, maxResults, maxTokens)

      // Combine retrieved contexts with provided priorities
      const contextsWithPriority: RetrievedContextWithPriority[] = []

      // Add current note if provided (highest priority)
      if (options?.currentNotePath) {
        contextsWithPriority.push({
          context: {
            content: `Current note: ${options.currentNotePath}`,
            source: options.currentNotePath,
            relevance: 1.0,
          },
          priority: ContextPriority.CurrentNote,
        })
      }

      // Add recent messages if provided (priority 2)
      if (options?.recentMessages && options.recentMessages.length > 0) {
        const recentContent = options.recentMessages
          .slice(-5) // Last 5 messages
          .map((msg) => `${msg.role}: ${msg.content}`)
          .join('\n\n')
        contextsWithPriority.push({
          context: {
            content: recentContent,
            source: 'recent-conversation',
            relevance: 0.9,
          },
          priority: ContextPriority.RecentConversation,
        })
      }

      // Add task plan if provided (priority 3)
      if (options?.taskPlan) {
        contextsWithPriority.push({
          context: {
            content: JSON.stringify(options.taskPlan, null, 2),
            source: 'task-plan',
            relevance: 0.8,
          },
          priority: ContextPriority.TaskPlan,
        })
      }

      // Add retrieved search results (priority 4)
      for (const context of retrievalResult.contexts) {
        contextsWithPriority.push({
          context,
          priority: ContextPriority.SearchResults,
        })
      }

      // Allocate budget using budget allocator
      let allocationResult: BudgetAllocationResult | undefined
      if (this.budgetAllocator) {
        allocationResult = this.budgetAllocator.allocate(contextsWithPriority, maxTokens)
        
        // Return allocated contexts (sorted by priority)
        const allocatedContexts = allocationResult.allocated
          .sort((a, b) => a.priority - b.priority)
          .map((item) => {
            // Truncate if needed
            if (item.truncated && item.allocatedTokens < this.estimateTokens(item.context.content)) {
              return {
                ...item.context,
                content: this.budgetAllocator!.truncateToFit(item.context.content, item.allocatedTokens),
              }
            }
            return item.context
          })

        return {
          contexts: allocatedContexts,
          totalTokens: allocationResult.totalAllocated,
          retrievalTime: Date.now() - startTime,
          allocationResult,
        }
      }

      // If no budget allocator, return all contexts (limited by maxTokens)
      let totalTokens = 0
      const limitedContexts: RetrievedContext[] = []
      for (const item of contextsWithPriority) {
        const tokens = this.estimateTokens(item.context.content)
        if (totalTokens + tokens > maxTokens) {
          // Truncate last context if needed
          const remainingTokens = maxTokens - totalTokens
          if (remainingTokens > 100) {
            const truncatedContent = this.truncateContent(item.context.content, remainingTokens)
            limitedContexts.push({
              ...item.context,
              content: truncatedContent,
            })
            totalTokens += remainingTokens
          }
          break
        }
        limitedContexts.push(item.context)
        totalTokens += tokens
      }

      return {
        contexts: limitedContexts,
        totalTokens,
        retrievalTime: Date.now() - startTime,
      }
    } catch (error) {
      console.error('[ContextManager] Error retrieving context:', error)
      return {
        contexts: [],
        totalTokens: 0,
        retrievalTime: Date.now() - startTime,
      }
    }
  }

  /**
   * Estimate token count for text
   */
  private estimateTokens(text: string): number {
    return this.tokenEstimator.estimateTokens(text)
  }

  /**
   * Truncate content to fit token budget
   */
  private truncateContent(content: string, maxTokens: number): string {
    const maxChars = maxTokens * 4 // ~4 chars per token
    if (content.length <= maxChars) {
      return content
    }

    // Try to truncate at sentence boundary
    const truncated = content.substring(0, maxChars)
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
   * Set retrieval strategy
   */
  setRetrievalStrategy(strategy: IRetrievalStrategy): void {
    this.retrievalStrategy = strategy
  }

  /**
   * Set budget allocator
   */
  setBudgetAllocator(allocator: ContextBudgetAllocator): void {
    this.budgetAllocator = allocator
  }
}
