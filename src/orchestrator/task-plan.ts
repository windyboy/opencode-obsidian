/**
 * Task Plan Parser and Serializer
 * Handles parsing structured plans from LLM output and serialization
 */

import type { TaskPlan, TaskStep } from './types'

/**
 * Parse structured plan from LLM output
 * Expected format:
 * - Markdown list with steps
 * - Each step has description and success criteria
 * - Steps may contain tool calls
 */
export class TaskPlanParser {
  /**
   * Parse plan from LLM text output
   */
  static parse(goal: string, llmOutput: string): TaskPlan {
    const plan: TaskPlan = {
      id: this.generatePlanId(),
      goal,
      steps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    // Try to extract structured plan from LLM output
    // Look for markdown list format or JSON-like structure
    const steps = this.extractSteps(llmOutput)
    
    plan.steps = steps
    plan.updatedAt = Date.now()

    return plan
  }

  /**
   * Extract steps from LLM output
   * Supports multiple formats:
   * - Markdown numbered list
   * - Markdown bullet list with descriptions
   * - JSON structure
   */
  private static extractSteps(output: string): TaskStep[] {
    const steps: TaskStep[] = []

    // Try JSON format first
    const jsonMatch = output.match(/\{[\s\S]*"steps"[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { steps?: Array<{ description: string; successCriteria?: string; toolCall?: { toolName: string; args: unknown } }> }
        if (parsed.steps && Array.isArray(parsed.steps)) {
          return parsed.steps.map((step, index) => this.createStep(step.description, step.successCriteria || '', step.toolCall, index))
        }
      } catch {
        // JSON parsing failed, try other formats
      }
    }

    // Try markdown numbered list format:
    // 1. Step description
    //    Success criteria: ...
    //    Tool: toolName(args)
    const numberedListRegex = /(\d+)\.\s+([^\n]+)(?:\n\s+Success criteria:\s+([^\n]+))?(?:\n\s+Tool:\s+([^\n]+))?/g
    let match: RegExpExecArray | null
    while ((match = numberedListRegex.exec(output)) !== null) {
      const [, , description, successCriteria, toolCallStr] = match
      if (description) {
        const toolCall = toolCallStr ? this.parseToolCall(toolCallStr) : undefined
        steps.push(this.createStep(description.trim(), successCriteria?.trim() || '', toolCall, steps.length))
      }
    }

    // Try markdown bullet list format if numbered list didn't work
    if (steps.length === 0) {
      const bulletListRegex = /[-*]\s+([^\n]+)(?:\n\s+Success criteria:\s+([^\n]+))?(?:\n\s+Tool:\s+([^\n]+))?/g
      while ((match = bulletListRegex.exec(output)) !== null) {
        const [, description, successCriteria, toolCallStr] = match
        if (description) {
          const toolCall = toolCallStr ? this.parseToolCall(toolCallStr) : undefined
          steps.push(this.createStep(description.trim(), successCriteria?.trim() || '', toolCall, steps.length))
        }
      }
    }

    // If no structured format found, treat entire output as a single step
    if (steps.length === 0) {
      steps.push(this.createStep(output.trim(), 'Task completed successfully', undefined, 0))
    }

    return steps
  }

  /**
   * Create a TaskStep from components
   */
  private static createStep(
    description: string,
    successCriteria: string,
    toolCall?: { toolName: string; args: unknown },
    index?: number
  ): TaskStep {
    return {
      id: this.generateStepId(index),
      description,
      toolCall,
      successCriteria,
      status: 'pending',
      retryCount: 0,
      maxRetries: 3,
    }
  }

  /**
   * Parse tool call from string
   * Format: toolName(arg1=value1, arg2=value2) or toolName({"key": "value"})
   */
  private static parseToolCall(toolCallStr: string): { toolName: string; args: unknown } | undefined {
    try {
      // Try JSON format first
      const jsonMatch = toolCallStr.match(/(\w+)\s*\(\s*(\{[\s\S]*\})\s*\)/)
      if (jsonMatch && jsonMatch[1] && jsonMatch[2]) {
        const toolName = jsonMatch[1]
        const argsStr = jsonMatch[2]
        const args: unknown = JSON.parse(argsStr)
        return { toolName, args }
      }

      // Try key-value format: toolName(key1=value1, key2=value2)
      const kvMatch = toolCallStr.match(/(\w+)\s*\((.*)\)/)
      if (kvMatch && kvMatch[1] && kvMatch[2]) {
        const toolName = kvMatch[1]
        const paramsStr = kvMatch[2]
        const args: Record<string, unknown> = {}
        const params = paramsStr.split(',').map(p => p.trim())
        for (const param of params) {
          const [key, ...valueParts] = param.split('=')
          if (key && valueParts.length > 0) {
            const value = valueParts.join('=').trim()
            // Try to parse as number, boolean, or string
            args[key.trim()] = this.parseValue(value)
          }
        }
        return { toolName, args }
      }

      // Fallback: just tool name
      const nameMatch = toolCallStr.match(/(\w+)/)
      if (nameMatch && nameMatch[1]) {
        return { toolName: nameMatch[1], args: {} }
      }
    } catch (error) {
      console.warn('[TaskPlanParser] Failed to parse tool call:', toolCallStr, error)
    }

    return undefined
  }

  /**
   * Parse value from string (number, boolean, or string)
   */
  private static parseValue(value: string): unknown {
    // Remove quotes if present
    const trimmed = value.replace(/^["']|["']$/g, '')

    // Try boolean
    if (trimmed === 'true') return true
    if (trimmed === 'false') return false

    // Try number
    const num = Number(trimmed)
    if (!isNaN(num) && trimmed !== '') return num

    // Return as string
    return trimmed
  }

  /**
   * Generate unique plan ID
   */
  private static generatePlanId(): string {
    return `plan_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * Generate unique step ID
   */
  private static generateStepId(index?: number): string {
    return `step_${Date.now()}_${index ?? Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * Serialize plan to JSON
   */
  static serialize(plan: TaskPlan): string {
    return JSON.stringify(plan, null, 2)
  }

  /**
   * Deserialize plan from JSON
   */
  static deserialize(json: string): TaskPlan {
    return JSON.parse(json) as TaskPlan
  }
}
