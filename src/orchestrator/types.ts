/**
 * Agent Loop State Machine Types
 */

/**
 * Agent execution states
 */
export enum AgentState {
  Planning = 'planning',
  Executing = 'executing',
  Validating = 'validating',
  Retrying = 'retrying',
  Completed = 'completed',
  Cancelled = 'cancelled',
  Failed = 'failed',
}

/**
 * State transition event
 */
export interface StateTransition {
  from: AgentState
  to: AgentState
  timestamp: number
  reason?: string
}

/**
 * Step execution result
 */
export interface StepResult {
  stepId: string
  success: boolean
  output?: unknown
  error?: string
  toolCall?: {
    toolName: string
    args: unknown
    result?: unknown
  }
  verified: boolean
  verifiedAt?: number
}

/**
 * Plan execution context
 */
export interface ExecutionContext {
  sessionId: string
  state: AgentState
  plan?: TaskPlan
  currentStepIndex?: number
  stepResults: StepResult[]
  transitions: StateTransition[]
  startedAt: number
  updatedAt: number
  completedAt?: number
  retryCount: number
  maxRetries: number
}

/**
 * Task Plan (imported from task-plan.ts)
 */
export interface TaskPlan {
  id: string
  goal: string
  steps: TaskStep[]
  createdAt: number
  updatedAt: number
}

/**
 * Task Step
 */
export interface TaskStep {
  id: string
  description: string
  toolCall?: {
    toolName: string
    args: unknown
  }
  successCriteria: string
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'skipped'
  retryCount: number
  maxRetries: number
}

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
  maxRetries?: number // Default: 3
  retryDelay?: number // Default: 1000ms
  validationTimeout?: number // Default: 5000ms
  enableAutoRetry?: boolean // Default: true
}
