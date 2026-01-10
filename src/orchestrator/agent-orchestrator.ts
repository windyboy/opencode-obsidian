/**
 * Agent Orchestrator
 * Manages Agent Loop state machine: Planning → Executing → Validating → Retrying → Completed
 */

import type { App, Vault } from 'obsidian'
import { AgentState, type ExecutionContext, type StepResult, type StateTransition, type TaskPlan, type TaskStep, type OrchestratorConfig } from './types'
import { SessionStorage, type Session } from '../session/session-storage'
import { OpenCodeServerClient } from '../opencode-server/client'
import type { ErrorHandler } from '../utils/error-handler'
import { ErrorSeverity } from '../utils/error-handler'
import type { ContextManager } from '../context/context-manager'

/**
 * Agent Orchestrator
 * Coordinates the agent execution loop with state machine
 */
export class AgentOrchestrator {
  private storage: SessionStorage
  private config: Required<OrchestratorConfig>
  private contexts: Map<string, ExecutionContext> = new Map()
  private cancelledSessions: Set<string> = new Set()

  constructor(
    private vault: Vault,
    private app: App,
    private opencodeClient: OpenCodeServerClient | null,
    private errorHandler: ErrorHandler,
    private contextManager?: ContextManager,
    config?: OrchestratorConfig
  ) {
    this.storage = new SessionStorage(vault)
    this.config = {
      maxRetries: config?.maxRetries ?? 3,
      retryDelay: config?.retryDelay ?? 1000,
      validationTimeout: config?.validationTimeout ?? 5000,
      enableAutoRetry: config?.enableAutoRetry ?? true,
    }
  }

  /**
   * Run a single turn of agent execution
   * This is the main entry point for the orchestrator
   */
  async runTurn(input: string, sessionId: string): Promise<void> {
    // Get or create execution context
    let context = this.contexts.get(sessionId)
    if (!context) {
      context = await this.loadContext(sessionId) ?? this.createContext(sessionId)
      this.contexts.set(sessionId, context)
    }

    // Check if session is cancelled
    if (this.cancelledSessions.has(sessionId)) {
      await this.transitionState(context, AgentState.Cancelled, 'Session cancelled by user')
      return
    }

    try {
      // State machine loop
      while (context.state !== AgentState.Completed && 
             context.state !== AgentState.Cancelled && 
             context.state !== AgentState.Failed) {
        
        switch (context.state) {
          case AgentState.Planning:
            await this.handlePlanning(context, input)
            break
          case AgentState.Executing:
            await this.handleExecuting(context)
            break
          case AgentState.Validating:
            await this.handleValidating(context)
            break
          case AgentState.Retrying:
            await this.handleRetrying(context)
            break
          default:
            // Unexpected state, transition to failed
            await this.transitionState(context, AgentState.Failed, 'Unexpected state')
            break
        }

        // Save context after each state transition
        await this.saveContext(context)
      }

      // Final save
      await this.saveContext(context)
    } catch (error) {
      this.errorHandler.handleError(error instanceof Error ? error : new Error(String(error)), {
        module: 'AgentOrchestrator',
        function: 'runTurn',
        operation: 'Agent execution',
        metadata: { sessionId, state: context.state }
      }, ErrorSeverity.Error)

      await this.transitionState(context, AgentState.Failed, error instanceof Error ? error.message : String(error))
      await this.saveContext(context)
    }
  }

  /**
   * Handle Planning state
   * Generate structured plan from LLM output
   */
  private async handlePlanning(context: ExecutionContext, input: string): Promise<void> {
    if (!this.opencodeClient) {
      throw new Error('OpenCode Server client not initialized')
    }

    // Retrieve relevant context before planning
    if (this.contextManager) {
      try {
        const activeFile = this.app.workspace.getActiveFile()
        const currentNotePath = activeFile?.path

        // Retrieve context using retrieval strategy
        const retrievalResult = await this.contextManager.retrieveContext(input, {
          maxResults: 10,
          maxTokens: 2000,
          currentNotePath,
        })

        // Use retrieved context to enhance planning
        if (retrievalResult.contexts.length > 0) {
          const contextSummary = retrievalResult.contexts
            .map((ctx) => `[${ctx.source}]: ${ctx.content.substring(0, 200)}...`)
            .join('\n\n')
          input = `${input}\n\nRelevant context:\n${contextSummary}`
        }
      } catch (error) {
        // Log error but continue with planning
        this.errorHandler.handleError(error instanceof Error ? error : new Error(String(error)), {
          module: 'AgentOrchestrator',
          function: 'handlePlanning',
          operation: 'Context retrieval',
          metadata: { sessionId: context.sessionId }
        }, ErrorSeverity.Warning)
      }
    }

    // Send message to OpenCode Server to generate plan
    // The server will respond with a structured plan
    await this.opencodeClient.sendSessionMessage(context.sessionId, `Generate a structured plan for: ${input}`)

    // Wait for response from server
    // In a real implementation, we would parse the LLM response
    // For now, we'll create a simple plan structure
    const plan: TaskPlan = {
      id: `plan_${Date.now()}`,
      goal: input,
      steps: [
        {
          id: `step_${Date.now()}`,
          description: input,
          successCriteria: 'Task completed successfully',
          status: 'pending',
          retryCount: 0,
          maxRetries: this.config.maxRetries,
        }
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    // Try to parse structured plan from server response
    // This would be done by listening to stream.token callbacks
    // For now, we use the simple plan above

    context.plan = plan
    await this.transitionState(context, AgentState.Executing, 'Plan generated')
  }

  /**
   * Handle Executing state
   * Execute the current step
   */
  private async handleExecuting(context: ExecutionContext): Promise<void> {
    if (!context.plan || context.plan.steps.length === 0) {
      await this.transitionState(context, AgentState.Completed, 'No steps to execute')
      return
    }

    const currentStepIndex = context.currentStepIndex ?? 0
    const step = context.plan.steps[currentStepIndex]

    if (!step || step.status === 'completed') {
      // All steps completed
      await this.transitionState(context, AgentState.Completed, 'All steps completed')
      return
    }

    // Update step status
    step.status = 'in-progress'
    context.currentStepIndex = currentStepIndex
    context.updatedAt = Date.now()

    // Retrieve relevant context for step execution
    if (this.contextManager && step.description) {
      try {
        const activeFile = this.app.workspace.getActiveFile()
        const currentNotePath = activeFile?.path

        // Retrieve context using retrieval strategy for step-specific context
        const retrievalResult = await this.contextManager.retrieveContext(step.description, {
          maxResults: 5,
          maxTokens: 1000,
          currentNotePath,
          taskPlan: context.plan,
        })

        // Use retrieved context to enhance step execution
        if (retrievalResult.contexts.length > 0 && this.opencodeClient) {
          const contextSummary = retrievalResult.contexts
            .map((ctx) => `[${ctx.source}]: ${ctx.content.substring(0, 150)}...`)
            .join('\n')
          await this.opencodeClient.sendSessionMessage(
            context.sessionId,
            `Executing step: ${step.description}\n\nRelevant context:\n${contextSummary}`
          )
        }
      } catch (error) {
        // Log error but continue with execution
        this.errorHandler.handleError(error instanceof Error ? error : new Error(String(error)), {
          module: 'AgentOrchestrator',
          function: 'handleExecuting',
          operation: 'Context retrieval for step',
          metadata: { sessionId: context.sessionId, stepId: step.id }
        }, ErrorSeverity.Warning)
      }
    }

    // Execute step
    const result: StepResult = {
      stepId: step.id,
      success: false,
      verified: false,
    }

    try {
      // If step has tool call, execute it through OpenCode Server
      if (step.toolCall && this.opencodeClient) {
        // Tool calls are handled by OpenCode Server via WebSocket
        // We mark the step as requiring tool execution
        result.toolCall = step.toolCall
        // The actual execution will happen when the server sends tool.call message
        // For now, we'll proceed to validation
      }

      // Mark step as completed (success will be determined in validation)
      step.status = 'completed'
      result.success = true

      // Store result
      context.stepResults.push(result)

      // Transition to validation
      await this.transitionState(context, AgentState.Validating, 'Step executed')
    } catch (error) {
      result.success = false
      result.error = error instanceof Error ? error.message : String(error)
      context.stepResults.push(result)

      // Mark step as failed
      step.status = 'failed'
      step.retryCount++

      // Check if we should retry
      if (step.retryCount < step.maxRetries && this.config.enableAutoRetry) {
        await this.transitionState(context, AgentState.Retrying, `Step failed, will retry (${step.retryCount}/${step.maxRetries})`)
      } else {
        await this.transitionState(context, AgentState.Failed, `Step failed after ${step.retryCount} retries`)
      }
    }
  }

  /**
   * Handle Validating state
   * Validate step results against success criteria
   */
  private async handleValidating(context: ExecutionContext): Promise<void> {
    const currentStepIndex = context.currentStepIndex ?? 0
    const step = context.plan?.steps[currentStepIndex]
    const result = context.stepResults[context.stepResults.length - 1]

    if (!step || !result) {
      await this.transitionState(context, AgentState.Failed, 'No step or result to validate')
      return
    }

    // Validate result against success criteria
    // For now, we check if the step was successful
    const isValid = this.validateStepResult(step, result)

    if (isValid) {
      result.verified = true
      result.verifiedAt = Date.now()

      // Move to next step or complete
      const nextStepIndex = currentStepIndex + 1
      if (nextStepIndex < (context.plan?.steps.length ?? 0)) {
        context.currentStepIndex = nextStepIndex
        await this.transitionState(context, AgentState.Executing, 'Validation passed, moving to next step')
      } else {
        await this.transitionState(context, AgentState.Completed, 'All steps validated and completed')
      }
    } else {
      // Validation failed, check if we should retry
      step.retryCount++
      if (step.retryCount < step.maxRetries && this.config.enableAutoRetry) {
        step.status = 'pending'
        await this.transitionState(context, AgentState.Retrying, `Validation failed, will retry (${step.retryCount}/${step.maxRetries})`)
      } else {
        step.status = 'failed'
        await this.transitionState(context, AgentState.Failed, `Validation failed after ${step.retryCount} retries`)
      }
    }
  }

  /**
   * Handle Retrying state
   * Retry failed step after delay
   */
  private async handleRetrying(context: ExecutionContext): Promise<void> {
    // Wait for retry delay
    await new Promise(resolve => setTimeout(resolve, this.config.retryDelay))

    // Reset step state
    const currentStepIndex = context.currentStepIndex ?? 0
    const step = context.plan?.steps[currentStepIndex]
    if (step) {
      step.status = 'pending'
      // Remove last result (failed one)
      context.stepResults.pop()
    }

    // Transition back to executing
    await this.transitionState(context, AgentState.Executing, 'Retrying step')
  }

  /**
   * Validate step result against success criteria
   */
  private validateStepResult(step: TaskStep, result: StepResult): boolean {
    // Basic validation: check if step executed successfully
    if (!result.success) {
      return false
    }

    // Check success criteria (simplified)
    // In a real implementation, this would use LLM to validate or use more sophisticated logic
    const criteria = step.successCriteria.toLowerCase()

    // Simple keyword-based validation
    if (criteria.includes('completed') || criteria.includes('success')) {
      return result.success
    }

    // If criteria mentions specific output, check if it exists
    if (criteria.includes('output') && !result.output) {
      return false
    }

    // Default: accept if step was successful
    return result.success
  }

  /**
   * Transition to a new state
   */
  private async transitionState(context: ExecutionContext, newState: AgentState, reason?: string): Promise<void> {
    const oldState = context.state
    context.state = newState
    context.updatedAt = Date.now()

    // Record transition
    const transition: StateTransition = {
      from: oldState,
      to: newState,
      timestamp: Date.now(),
      reason,
    }
    context.transitions.push(transition)

    // Handle state-specific logic
    if (newState === AgentState.Completed || newState === AgentState.Failed || newState === AgentState.Cancelled) {
      context.completedAt = Date.now()
    }

    console.debug(`[AgentOrchestrator] State transition: ${oldState} → ${newState}${reason ? ` (${reason})` : ''}`)
  }

  /**
   * Create a new execution context
   */
  private createContext(sessionId: string): ExecutionContext {
    return {
      sessionId,
      state: AgentState.Planning,
      stepResults: [],
      transitions: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
      retryCount: 0,
      maxRetries: this.config.maxRetries,
    }
  }

  /**
   * Load execution context from storage
   */
  private async loadContext(sessionId: string): Promise<ExecutionContext | null> {
    try {
      const stored = await this.storage.loadSession(sessionId)
      if (!stored) {
        return null
      }

      // Try to load full context from extended storage
      // Store ExecutionContext in a separate file for full state persistence
      const contextPath = `.opencode/orchestrator/${sessionId}.json`
      try {
        if (await this.vault.adapter.exists(contextPath)) {
          const content = await this.vault.adapter.read(contextPath)
          const context = JSON.parse(content) as ExecutionContext
          
          // Ensure all required fields are present
          if (context.sessionId && context.state && context.stepResults && context.transitions) {
            return context
          }
        }
      } catch (error) {
        // If extended context file doesn't exist or is corrupted, create new context
        console.warn('[AgentOrchestrator] Failed to load extended context, creating new one:', error)
      }

      return null
    } catch (error) {
      this.errorHandler.handleError(error instanceof Error ? error : new Error(String(error)), {
        module: 'AgentOrchestrator',
        function: 'loadContext',
        operation: 'Loading execution context'
      }, ErrorSeverity.Warning)
      return null
    }
  }

  /**
   * Save execution context to storage
   */
  private async saveContext(context: ExecutionContext): Promise<void> {
    try {
      // Save basic session info
      const session: Session = {
        id: context.sessionId,
        createdAt: context.startedAt,
        updatedAt: context.updatedAt,
      }

      await this.storage.saveSession(session)

      // Save full ExecutionContext to extended storage
      // Ensure directory exists
      const orchestratorDir = '.opencode/orchestrator'
      if (!(await this.vault.adapter.exists(orchestratorDir))) {
        await this.vault.adapter.mkdir(orchestratorDir)
      }

      // Save context to JSON file
      const contextPath = `${orchestratorDir}/${context.sessionId}.json`
      await this.vault.adapter.write(
        contextPath,
        JSON.stringify(context, null, 2)
      )
    } catch (error) {
      this.errorHandler.handleError(error instanceof Error ? error : new Error(String(error)), {
        module: 'AgentOrchestrator',
        function: 'saveContext',
        operation: 'Saving execution context'
      }, ErrorSeverity.Warning)
    }
  }

  /**
   * Cancel a running session
   */
  async cancelSession(sessionId: string): Promise<void> {
    this.cancelledSessions.add(sessionId)
    
    const context = this.contexts.get(sessionId)
    if (context) {
      await this.transitionState(context, AgentState.Cancelled, 'Cancelled by user')
      await this.saveContext(context)
    }

    // Also interrupt the OpenCode Server session
    if (this.opencodeClient) {
      await this.opencodeClient.interruptSession(sessionId)
    }
  }

  /**
   * Get execution context for a session
   */
  getContext(sessionId: string): ExecutionContext | undefined {
    return this.contexts.get(sessionId)
  }

  /**
   * List all active contexts
   */
  listContexts(): ExecutionContext[] {
    return Array.from(this.contexts.values())
  }

  /**
   * Clear context for a session
   */
  clearContext(sessionId: string): void {
    this.contexts.delete(sessionId)
    this.cancelledSessions.delete(sessionId)
  }
}
