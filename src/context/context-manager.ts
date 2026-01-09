import { TokenEstimator } from './token-estimator'
import { CONTEXT_CONFIG } from '../utils/constants'

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
}

export class ContextManager {
  private tokenEstimator: TokenEstimator
  private config: Required<ContextManagerConfig>
  private currentUsage: ContextUsage | null = null

  constructor(config: ContextManagerConfig = {}) {
    this.tokenEstimator = new TokenEstimator()
    this.config = {
      maxContextTokens: config.maxContextTokens ?? CONTEXT_CONFIG.MAX_TOKENS,
      preemptiveCompactionThreshold: config.preemptiveCompactionThreshold ?? CONTEXT_CONFIG.PREEMPTIVE_THRESHOLD,
      enableTokenEstimation: config.enableTokenEstimation ?? true,
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
  getConfig(): Required<ContextManagerConfig> {
    return { ...this.config }
  }
}
