/**
 * Token estimator - approximates token counts for text
 * Uses a simple character-based estimation (roughly 4 characters per token for English)
 * This is a fallback when exact tokenization is not available
 */
export class TokenEstimator {
  /**
   * Estimate token count for text
   * Rough approximation: ~4 chars per token for English text
   */
  estimateTokens(text: string): number {
    if (!text || text.length === 0) {
      return 0
    }

    // Simple character-based estimation
    // Average is roughly 4 characters per token for English
    // Account for whitespace and special characters
    const charCount = text.length
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length
    
    // Use the average of character-based and word-based estimation
    const charBased = Math.ceil(charCount / 4)
    const wordBased = Math.ceil(wordCount * 1.3) // ~1.3 tokens per word average
    
    return Math.ceil((charBased + wordBased) / 2)
  }

  /**
   * Estimate tokens for a message array
   */
  estimateMessageTokens(messages: Array<{
    role: 'user' | 'assistant' | 'system'
    content: string | Array<{ type: string; text?: string; [key: string]: unknown }>
  }>): number {
    let total = 0
    
    for (const msg of messages) {
      // Add role token (e.g., "assistant:", "user:")
      total += 5
      
      // Estimate content tokens
      if (typeof msg.content === 'string') {
        total += this.estimateTokens(msg.content)
      } else if (Array.isArray(msg.content)) {
        for (const item of msg.content) {
          if (item.type === 'text' && item.text) {
            total += this.estimateTokens(item.text)
          }
          // Add overhead for non-text content
          total += 10
        }
      }
      
      // Add message structure overhead
      total += 5
    }
    
    return total
  }

  /**
   * Estimate tokens for system prompt
   */
  estimateSystemTokens(systemPrompt: string): number {
    if (!systemPrompt) {
      return 0
    }
    
    // System prompt has overhead for formatting
    return this.estimateTokens(systemPrompt) + 20
  }
}
