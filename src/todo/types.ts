export enum TodoStatus {
  Pending = 'pending',
  InProgress = 'in-progress',
  Completed = 'completed',
  Cancelled = 'cancelled',
}

/**
 * Task status for task orchestration
 * Different from TodoStatus as it represents orchestrated task execution status
 */
export enum TaskStatus {
  Pending = 'pending',
  InProgress = 'in-progress',
  Completed = 'completed',
  Failed = 'failed',
  Skipped = 'skipped',
  Cancelled = 'cancelled',
}

export interface Todo {
  id: string
  text: string
  status: TodoStatus
  createdAt: number
  updatedAt: number
  completedAt?: number
  cancelledAt?: number
  sessionId?: string
  messageId?: string
  metadata?: {
    priority?: 'low' | 'medium' | 'high'
    tags?: string[]
    [key: string]: unknown
  }
}

export interface TodoExtractionResult {
  todos: Todo[]
  extractedAt: number
  source: string
}

/**
 * Task Step for task orchestration
 * Represents a single step in a task plan
 */
export interface TaskStep {
  id: string
  description: string
  toolCall?: {
    toolName: string
    args: unknown
  }
  successCriteria: string
  status: TaskStatus
  retryCount: number
  maxRetries: number
  createdAt?: number
  updatedAt?: number
  completedAt?: number
  failedAt?: number
  error?: string
  output?: unknown
}

/**
 * Task Plan for task orchestration
 * Represents a structured plan with multiple steps
 */
export interface TaskPlan {
  id: string
  goal: string
  steps: TaskStep[]
  status: TaskStatus
  createdAt: number
  updatedAt: number
  completedAt?: number
  cancelledAt?: number
  failedAt?: number
  error?: string
  metadata?: {
    sessionId?: string
    messageId?: string
    priority?: 'low' | 'medium' | 'high'
    tags?: string[]
    [key: string]: unknown
  }
}

/**
 * Task progress information
 */
export interface TaskProgress {
  planId: string
  totalSteps: number
  completedSteps: number
  failedSteps: number
  skippedSteps: number
  currentStepIndex?: number
  progress: number // 0-1
  estimatedTimeRemaining?: number // in milliseconds
}

/**
 * Step execution result
 * Used to track the result of executing a single step
 */
export interface StepResult {
  stepId: string
  success: boolean
  verified: boolean
  output?: unknown
  error?: string
  toolCall?: {
    toolName: string
    args: unknown
    result?: unknown
  }
  verifiedAt?: number
  executedAt?: number
}

/**
 * Task checkpoint for rollback functionality
 * Stores a snapshot of task state at a specific point in time
 */
export interface TaskCheckpoint {
  id: string
  planId: string
  createdAt: number
  description?: string
  planSnapshot: TaskPlan // Deep copy of plan at checkpoint time
  stepResults: Map<string, StepResult[]> // stepId -> StepResult[]
  currentStepIndex?: number
  metadata?: {
    reason?: string
    triggeredBy?: 'user' | 'system' | 'error'
    [key: string]: unknown
  }
}
