import { ContextManager } from './context-manager'
import { CONTEXT_CONFIG } from '../utils/constants'

export interface CompactedMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  originalCount: number
  compactedAt: number
  originalMessageIds: string[] // Track original message IDs for traceability
}

export interface CompactionStrategy {
  /**
   * Compact messages to reduce token usage
   * Returns compacted messages and summary
   */
  compact(
    messages: Array<{
      role: 'user' | 'assistant' | 'system'
      content: string | Array<{ type: string; text?: string; [key: string]: unknown }>
      id?: string // Optional message ID for traceability
    }>,
    targetReduction: number // Target percentage reduction (0-1)
  ): {
    compacted: CompactedMessage[]
    summary: string
    originalTokenCount: number
    compactedTokenCount: number
  }
}

export class SmartCompactionStrategy implements CompactionStrategy {
  compact(
    messages: Array<{
      role: 'user' | 'assistant' | 'system'
      content: string | Array<{ type: string; text?: string; [key: string]: unknown }>
      id?: string
    }>,
    targetReduction: number = 0.3 // Default: reduce by 30%
  ): {
    compacted: CompactedMessage[]
    summary: string
    originalTokenCount: number
    compactedTokenCount: number
  } {
    if (messages.length === 0) {
      return {
        compacted: [],
        summary: '',
        originalTokenCount: 0,
        compactedTokenCount: 0,
      }
    }

    // Never compact system messages or the last few messages
    const systemMessages: typeof messages = []
    const recentMessages: typeof messages = []
    const oldMessages: typeof messages = []

    // Separate messages
    const keepRecentCount = 3 // Always keep last 3 messages
    const splitIndex = Math.max(0, messages.length - keepRecentCount)

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (!msg) continue
      
      if (msg.role === 'system') {
        systemMessages.push(msg)
      } else if (i >= splitIndex) {
        recentMessages.push(msg)
      } else {
        oldMessages.push(msg)
      }
    }

    // Compact old messages
    const compactedOld: CompactedMessage[] = []
    let oldSummary = ''

    if (oldMessages.length > 0) {
      // Group old messages by role and create summaries
      const userMessages = oldMessages.filter(m => m.role === 'user')
      const assistantMessages = oldMessages.filter(m => m.role === 'assistant')

      // Summarize user messages
      if (userMessages.length > 0) {
        const userSummary = this.summarizeMessages(userMessages, 'user')
        const userMessageIds = userMessages.map((m, idx) => m.id || `user-${idx}-${Date.now()}`)
        oldSummary += `User messages (${userMessages.length}): ${userSummary}\n\n`
      compactedOld.push({
        role: 'user' as const,
        content: userSummary,
        originalCount: userMessages.length,
        compactedAt: Date.now(),
        originalMessageIds: userMessageIds,
      })
      }

      // Summarize assistant messages
      if (assistantMessages.length > 0) {
        const assistantSummary = this.summarizeMessages(assistantMessages, 'assistant')
        const assistantMessageIds = assistantMessages.map((m, idx) => m.id || `assistant-${idx}-${Date.now()}`)
        oldSummary += `Assistant responses (${assistantMessages.length}): ${assistantSummary}\n\n`
      compactedOld.push({
        role: 'assistant' as const,
        content: assistantSummary,
        originalCount: assistantMessages.length,
        compactedAt: Date.now(),
        originalMessageIds: assistantMessageIds,
      })
      }
    }

    // Combine: system + compacted old + recent
    const compacted: CompactedMessage[] = [
      ...systemMessages.map((msg, idx) => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        originalCount: 1,
        compactedAt: Date.now(),
        originalMessageIds: [msg.id || `system-${idx}-${Date.now()}`],
      })),
      ...compactedOld,
      ...recentMessages.map((msg, idx) => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        originalCount: 1,
        compactedAt: Date.now(),
        originalMessageIds: [msg.id || `${msg.role}-${idx}-${Date.now()}`],
      })),
    ]

    // Estimate token counts (rough)
    const originalTokenCount = this.estimateTokens(messages)
    const compactedTokenCount = this.estimateTokensFromCompacted(compacted)

    const summary = `[Context Compacted]\n\n${oldSummary}[Recent conversation (last ${recentMessages.length} messages) preserved in full]`

    return {
      compacted,
      summary,
      originalTokenCount,
      compactedTokenCount,
    }
  }

  /**
   * Summarize a group of messages
   */
  private summarizeMessages(
    messages: Array<{
      role: 'user' | 'assistant' | 'system'
      content: string | Array<{ type: string; text?: string; [key: string]: unknown }>
      id?: string
    }>,
    role: 'user' | 'assistant'
  ): string {
    const contents = messages
      .map(msg => typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content))
      .filter(c => c.trim().length > 0)

    if (contents.length === 0) {
      return 'No content'
    }

    // Simple summarization: take key points from each message
    const summaries: string[] = []

    for (const content of contents) {
      // Extract first sentence or first 100 chars
      const firstSentence = content.split(/[.!?]/)[0]?.trim()
      if (firstSentence && firstSentence.length > 0) {
        const preview = firstSentence.length > 100 
          ? firstSentence.substring(0, 100) + '...'
          : firstSentence
        summaries.push(preview)
      } else {
        // No sentence breaks, take first 100 chars
        summaries.push(content.substring(0, 100) + (content.length > 100 ? '...' : ''))
      }
    }

    // Combine summaries
    if (summaries.length === 1) {
      return summaries[0] ?? 'No content'
    } else if (summaries.length <= 3) {
      return summaries.join(' | ') || 'No content'
    } else {
      return summaries.slice(0, 2).join(' | ') + ` ... and ${summaries.length - 2} more messages`
    }
  }

  /**
   * Estimate tokens for messages (rough)
   */
  private estimateTokens(
    messages: Array<{
      role: 'user' | 'assistant' | 'system'
      content: string | Array<{ type: string; text?: string; [key: string]: unknown }>
    }>
  ): number {
    let total = 0
    for (const msg of messages) {
      const content = typeof msg.content === 'string' 
        ? msg.content 
        : JSON.stringify(msg.content)
      total += Math.ceil(content.length / 4) // ~4 chars per token
    }
    return total
  }

  /**
   * Estimate tokens for compacted messages
   */
  private estimateTokensFromCompacted(compacted: CompactedMessage[]): number {
    let total = 0
    for (const msg of compacted) {
      total += Math.ceil(msg.content.length / 4)
    }
    return total
  }
}

export class CompactionManager {
  private contextManager: ContextManager
  private strategy: CompactionStrategy

  constructor(contextManager: ContextManager, strategy?: CompactionStrategy) {
    this.contextManager = contextManager
    this.strategy = strategy || new SmartCompactionStrategy()
  }

  /**
   * Check if compaction is needed and perform it
   */
  async checkAndCompact(
    messages: Array<{
      role: 'user' | 'assistant' | 'system'
      content: string | Array<{ type: string; text?: string; [key: string]: unknown }>
    }>,
    systemPrompt?: string
  ): Promise<{
    compacted: CompactedMessage[]
    summary: string
    shouldCompact: boolean
  }> {
    // Estimate current usage
    const estimatedTokens = this.contextManager.estimateContextTokens(messages, systemPrompt)

    // Check if we should trigger compaction
    const shouldCompact = this.contextManager.shouldTriggerPreemptiveCompaction() ||
      (estimatedTokens > 0 && estimatedTokens / this.contextManager.getConfig().maxContextTokens >= CONTEXT_CONFIG.PREEMPTIVE_THRESHOLD)

    if (!shouldCompact) {
      return {
        compacted: messages.map((msg, idx) => ({
          role: msg.role,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          originalCount: 1,
          compactedAt: Date.now(),
          originalMessageIds: [(msg as { id?: string }).id || `${msg.role}-${idx}-${Date.now()}`],
        })),
        summary: '',
        shouldCompact: false,
      }
    }

    // Perform compaction
    const targetReduction = 0.3 // Reduce by 30%
    const result = this.strategy.compact(messages, targetReduction)

    // Compaction performed

    return {
      compacted: result.compacted,
      summary: result.summary,
      shouldCompact: true,
    }
  }
}
