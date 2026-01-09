import { BaseHook } from './base-hook'
import type { HookContext, HookResult } from './types'
import { HookEvent } from './types'
import type { TodoManager } from '../todo/todo-manager'

export interface TodoContinuationConfig {
  enabled?: boolean // Default: true
  respectUserInterrupt?: boolean // Default: true
  continuationPrompt?: string // Custom continuation prompt
}

export class TodoContinuationHook extends BaseHook {
  private todoManager: TodoManager
  private config: Required<TodoContinuationConfig>

  constructor(todoManager: TodoManager, config: TodoContinuationConfig = {}) {
    super({
      id: 'todo-continuation',
      name: 'TODO Continuation Enforcer',
      description: 'Automatically continues unfinished TODOs when agent stops',
      events: [HookEvent.OnStop],
      priority: 20, // Run after other stop hooks
    })

    this.todoManager = todoManager
    this.config = {
      enabled: config.enabled ?? true,
      respectUserInterrupt: config.respectUserInterrupt ?? true,
      continuationPrompt: config.continuationPrompt || 
        'You stopped, but there are still unfinished TODO items. Please continue and complete them:\n\n{INCOMPLETE_TODOS}\n\nContinue from where you left off and finish the remaining tasks.',
    }
  }

  async handler(context: HookContext): Promise<HookResult> {
    if (!this.config.enabled) {
      return { modified: false }
    }

    const sessionId = context.sessionId

    if (!sessionId) {
      return { modified: false }
    }

    // Check if there are incomplete TODOs
    const pendingTodos = this.todoManager.getPendingTodos(sessionId)

    if (pendingTodos.length === 0) {
      return { modified: false }
    }

    // Check if this was a user interrupt
    if (this.config.respectUserInterrupt && context.isUserInterrupt) {
      // User interrupt detected, skipping continuation
      return { modified: false }
    }

    // Build continuation prompt
    const todoList = pendingTodos
      .map((todo, index) => `${index + 1}. [${todo.status}] ${todo.text}`)
      .join('\n')

    const continuationPrompt = this.config.continuationPrompt.replace(
      '{INCOMPLETE_TODOS}',
      todoList
    )

    // Inject continuation prompt

    return {
      modified: true,
      modifiedContext: {
        ...context,
        continuationPrompt,
        shouldContinue: true,
        incompleteTodosCount: pendingTodos.length,
      },
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TodoContinuationConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    }
  }
}
