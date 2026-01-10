/**
 * Context Budget Allocator
 * Allocates token budget based on priority levels
 */

import type { RetrievedContext } from './retrieval-strategy'
import { ContextPriority } from './retrieval-strategy'

/**
 * Budget allocation configuration
 */
export interface BudgetAllocatorConfig {
  totalBudget: number // Total token budget
  priorityWeights: Record<ContextPriority, number> // Weight for each priority level
  minBudgetPerItem: number // Minimum budget per context item
}

/**
 * Allocated context item
 */
export interface AllocatedContext {
  context: RetrievedContext
  allocatedTokens: number
  priority: ContextPriority
  truncated: boolean
}

/**
 * Budget allocation result
 */
export interface BudgetAllocationResult {
  allocated: AllocatedContext[]
  totalAllocated: number
  remainingBudget: number
  truncatedCount: number
}

/**
 * Context Budget Allocator
 * Intelligently allocates token budget based on priority levels
 */
export class ContextBudgetAllocator {
  private config: Required<BudgetAllocatorConfig>

  constructor(config?: Partial<BudgetAllocatorConfig>) {
    this.config = {
      totalBudget: config?.totalBudget ?? 5000,
      priorityWeights: config?.priorityWeights ?? {
        [ContextPriority.CurrentNote]: 0.4, // 40% for current note
        [ContextPriority.RecentConversation]: 0.25, // 25% for recent conversation
        [ContextPriority.TaskPlan]: 0.15, // 15% for task plan
        [ContextPriority.SearchResults]: 0.15, // 15% for search results
        [ContextPriority.LongTermMemory]: 0.05, // 5% for long-term memory
      },
      minBudgetPerItem: config?.minBudgetPerItem ?? 100,
    }
  }

  /**
   * Allocate budget to contexts based on priority
   */
  allocate(
    contexts: Array<{ context: RetrievedContext; priority: ContextPriority }>,
    totalBudget?: number
  ): BudgetAllocationResult {
    const budget = totalBudget ?? this.config.totalBudget
    const allocated: AllocatedContext[] = []
    let remainingBudget = budget
    let truncatedCount = 0

    // Group contexts by priority
    const contextsByPriority = new Map<ContextPriority, typeof contexts>()
    for (const item of contexts) {
      const existing = contextsByPriority.get(item.priority) || []
      existing.push(item)
      contextsByPriority.set(item.priority, existing)
    }

    // Allocate budget by priority (in order)
    const priorityOrder = [
      ContextPriority.CurrentNote,
      ContextPriority.RecentConversation,
      ContextPriority.TaskPlan,
      ContextPriority.SearchResults,
      ContextPriority.LongTermMemory,
    ]

    for (const priority of priorityOrder) {
      const items = contextsByPriority.get(priority) || []
      if (items.length === 0 || remainingBudget <= 0) {
        continue
      }

      // Calculate budget for this priority level
      const priorityWeight = this.config.priorityWeights[priority]
      const priorityBudget = Math.floor(budget * priorityWeight)

      // Allocate budget to items in this priority group
      const allocatedForPriority = this.allocateToItems(
        items,
        Math.min(priorityBudget, remainingBudget)
      )

      for (const allocatedItem of allocatedForPriority) {
        allocated.push(allocatedItem)
        remainingBudget -= allocatedItem.allocatedTokens
        if (allocatedItem.truncated) {
          truncatedCount++
        }
      }
    }

    // If there's remaining budget and we have more contexts, distribute evenly
    if (remainingBudget > 0) {
      const unallocated = contexts.filter(
        item => !allocated.find(a => a.context.source === item.context.source)
      )

      if (unallocated.length > 0) {
        const perItem = Math.floor(remainingBudget / unallocated.length)
        for (const item of unallocated) {
          if (remainingBudget <= 0) break

          const tokens = this.estimateTokens(item.context.content)
          const allocatedTokens = Math.min(tokens, perItem, remainingBudget)
          const truncated = allocatedTokens < tokens

          allocated.push({
            context: item.context,
            allocatedTokens,
            priority: item.priority,
            truncated,
          })

          remainingBudget -= allocatedTokens
          if (truncated) {
            truncatedCount++
          }
        }
      }
    }

    // Sort by priority (lower number = higher priority)
    allocated.sort((a, b) => a.priority - b.priority)

    return {
      allocated,
      totalAllocated: budget - remainingBudget,
      remainingBudget,
      truncatedCount,
    }
  }

  /**
   * Allocate budget to items within a priority group
   */
  private allocateToItems(
    items: Array<{ context: RetrievedContext; priority: ContextPriority }>,
    budget: number
  ): AllocatedContext[] {
    const allocated: AllocatedContext[] = []
    let remainingBudget = budget

    // Sort by relevance (descending)
    const sorted = [...items].sort((a, b) => b.context.relevance - a.context.relevance)

    // Distribute budget based on relevance and content size
    for (const item of sorted) {
      if (remainingBudget <= 0) {
        break
      }

      const tokens = this.estimateTokens(item.context.content)
      const relevance = item.context.relevance

      // Allocate based on relevance and remaining budget
      // Higher relevance items get more budget, but we ensure minimum budget per item
      const baseAllocation = Math.max(
        this.config.minBudgetPerItem,
        Math.floor(remainingBudget * relevance)
      )
      const allocatedTokens = Math.min(tokens, baseAllocation, remainingBudget)
      const truncated = allocatedTokens < tokens

      allocated.push({
        context: item.context,
        allocatedTokens,
        priority: item.priority,
        truncated,
      })

      remainingBudget -= allocatedTokens
    }

    return allocated
  }

  /**
   * Truncate context content to fit token budget
   */
  truncateToFit(content: string, maxTokens: number): string {
    const tokens = this.estimateTokens(content)
    if (tokens <= maxTokens) {
      return content
    }

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
   * Estimate token count for text
   * Simple estimation: ~4 characters per token
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BudgetAllocatorConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): Required<BudgetAllocatorConfig> {
    return { ...this.config }
  }
}
