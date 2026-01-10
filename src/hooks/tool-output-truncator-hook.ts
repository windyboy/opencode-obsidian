import { BaseHook } from './base-hook'
import type { HookContext, HookResult } from './types'
import { HookEvent } from './types'
import { TOOL_OUTPUT_CONFIG } from '../utils/constants'

export interface TruncationConfig {
  maxLength?: number // Default: 10000 characters
  maxLines?: number // Default: 500 lines
  preserveKeyInfo?: boolean // Default: true
  toolsToTruncate?: string[] // Tools to truncate (default: all except excluded)
  toolsToExclude?: string[] // Tools to never truncate
}

export class ToolOutputTruncatorHook extends BaseHook {
  private config: Required<TruncationConfig>

  constructor(config: TruncationConfig = {}) {
    super({
      id: 'tool-output-truncator',
      name: 'Tool Output Truncator',
      description: 'Truncates excessively long tool outputs to prevent context overflow',
      events: [HookEvent.PostToolUse],
      priority: TOOL_OUTPUT_CONFIG.HOOK_PRIORITY, // Run early to truncate before other hooks
    })

    this.config = {
      maxLength: config.maxLength ?? 10000,
      maxLines: config.maxLines ?? TOOL_OUTPUT_CONFIG.DEFAULT_MAX_LINES,
      preserveKeyInfo: config.preserveKeyInfo ?? true,
      toolsToTruncate: config.toolsToTruncate ?? [],
      toolsToExclude: config.toolsToExclude ?? ['lsp', 'rename', 'code-actions'],
    }
  }

  async handler(context: HookContext): Promise<HookResult> {
    const toolName = context.toolName
    const toolOutput = context.toolOutput

    if (!toolName || !toolOutput || typeof toolOutput !== 'string') {
      return { modified: false }
    }

    // Check if tool should be excluded
    if (this.config.toolsToExclude.some(excluded => toolName.toLowerCase().includes(excluded.toLowerCase()))) {
      return { modified: false }
    }

    // Check if tool should be truncated (if specific list provided, only truncate those)
    if (this.config.toolsToTruncate.length > 0) {
      const shouldTruncate = this.config.toolsToTruncate.some(
        tool => toolName.toLowerCase().includes(tool.toLowerCase())
      )
      if (!shouldTruncate) {
        return { modified: false }
      }
    }

    // Check if truncation is needed
    const needsTruncation = 
      toolOutput.length > this.config.maxLength ||
      toolOutput.split('\n').length > this.config.maxLines

    if (!needsTruncation) {
      return { modified: false }
    }

    // Perform truncation
    const truncated = this.truncateOutput(toolOutput, toolName)

    return {
      modified: true,
      modifiedContext: {
        ...context,
        toolOutput: truncated,
      },
    }
  }

  private truncateOutput(output: string, toolName: string): string {
    const lines = output.split('\n')
    const totalLines = lines.length
    const totalLength = output.length

    // Determine if we need to truncate by lines or length
    const shouldTruncateByLines = totalLines > this.config.maxLines
    const shouldTruncateByLength = totalLength > this.config.maxLength

    if (!shouldTruncateByLines && !shouldTruncateByLength) {
      return output
    }

    let truncated = output

    // Truncate by lines if needed
    if (shouldTruncateByLines) {
      const linesToKeep = Math.floor(this.config.maxLines * 0.8) // Keep 80% of max
      
      // Try to preserve key information
      if (this.config.preserveKeyInfo) {
        truncated = this.preserveKeyInfo(output, lines, linesToKeep, toolName)
      } else {
        // Simple truncation: keep first N lines
        truncated = lines.slice(0, linesToKeep).join('\n')
      }
    }

    // Truncate by length if still too long
    if (truncated.length > this.config.maxLength) {
      const lengthToKeep = Math.floor(this.config.maxLength * 0.8) // Keep 80% of max
      
      if (this.config.preserveKeyInfo) {
        truncated = this.truncateWithKeyInfo(truncated, lengthToKeep, toolName)
      } else {
        truncated = truncated.substring(0, lengthToKeep) + '\n\n... [truncated]'
      }
    }

    // Add truncation notice
    const truncationNotice = this.getTruncationNotice(totalLength, truncated.length, totalLines, toolName)
    
    return truncated + '\n\n' + truncationNotice
  }

  private preserveKeyInfo(
    output: string,
    lines: string[],
    linesToKeep: number,
    toolName: string
  ): string {
    // Strategy: Keep first 40% and last 40% of lines, remove middle 20%
    const keepFromStart = Math.floor(linesToKeep * 0.4)
    const keepFromEnd = linesToKeep - keepFromStart

    const keyLines: string[] = []

    // Keep first lines
    keyLines.push(...lines.slice(0, keepFromStart))

    // Try to extract error messages, warnings, or key patterns from middle
    const middleLines = lines.slice(keepFromStart, lines.length - keepFromEnd)
    
    // Look for important patterns (errors, warnings, matches, etc.)
    const importantPatterns = [
      /error/i,
      /warning/i,
      /failed/i,
      /match/i,
      /found/i,
      /line \d+/i,
      /:\d+:/, // Line numbers
    ]

    const importantLines = middleLines.filter(line => 
      importantPatterns.some(pattern => pattern.test(line))
    ).slice(0, 10) // Keep up to 10 important lines

    if (importantLines.length > 0) {
      keyLines.push('\n... [important lines from middle section] ...\n')
      keyLines.push(...importantLines)
    }

    // Keep last lines
    keyLines.push('\n... [middle section truncated] ...\n')
    keyLines.push(...lines.slice(-keepFromEnd))

    return keyLines.join('\n')
  }

  private truncateWithKeyInfo(output: string, maxLength: number, toolName: string): string {
    // Try to find sentence boundaries
    // Use match instead of split to avoid lookbehind for iOS compatibility
    const sentencePattern = /[^.!?]*[.!?]+/g
    const sentences: string[] = []
    let match: RegExpExecArray | null
    while ((match = sentencePattern.exec(output)) !== null) {
      sentences.push(match[0].trim())
    }
    
    if (sentences.length <= 1) {
      // No clear sentence boundaries, just truncate
      return output.substring(0, maxLength) + '\n\n... [truncated]'
    }

    let truncated = ''
    for (const sentence of sentences) {
      if ((truncated + sentence).length > maxLength) {
        break
      }
      truncated += sentence + ' '
    }

    // Try to keep last sentence if it's not too long
    if (sentences.length > 0) {
      const lastSentence = sentences[sentences.length - 1]
      if (lastSentence && lastSentence.length < 200 && (truncated + lastSentence).length <= maxLength * 1.1) {
        truncated += '\n\n... [middle section truncated] ...\n\n' + lastSentence
      }
    }

    return truncated.trim() || output.substring(0, maxLength)
  }

  private getTruncationNotice(
    originalLength: number,
    truncatedLength: number,
    originalLines: number,
    toolName: string
  ): string {
    const lengthReduction = ((1 - truncatedLength / originalLength) * 100).toFixed(1)
    const linesReduction = originalLines > 0 
      ? ((1 - truncatedLength / originalLength) * originalLines).toFixed(0)
      : '0'

    return `[Tool Output Truncated: ${toolName}]
Original: ${originalLength} characters, ${originalLines} lines
Truncated: ${truncatedLength} characters (~${lengthReduction}% reduction, ~${linesReduction} lines removed)
Key information preserved. Full output may be available in tool logs.`
  }

  /**
   * Update truncation configuration
   */
  updateConfig(config: Partial<TruncationConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    }
  }
}
