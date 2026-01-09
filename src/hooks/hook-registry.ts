import type { Hook, HookContext, HookEvent } from './types'
import { ErrorHandler, ErrorSeverity } from '../utils/error-handler'

export class HookRegistry {
  private hooks: Map<string, Hook> = new Map()
  private eventHandlers: Map<HookEvent, Hook[]> = new Map()
  private errorHandler: ErrorHandler

  constructor(errorHandler?: ErrorHandler) {
    this.errorHandler = errorHandler || new ErrorHandler()
  }

  /**
   * Register a hook
   */
  register(hook: Hook): void {
    if (!hook.enabled) {
      return
    }

    // Validate hook
    if (!hook.id || !hook.name || !hook.events || hook.events.length === 0) {
      this.errorHandler.handleError(
        new Error(`Invalid hook registration: missing required fields`),
        {
          module: 'HookRegistry',
          function: 'register',
          operation: 'Validating hook',
          metadata: { hookId: hook.id }
        },
        ErrorSeverity.Warning
      )
      return
    }

    // Store hook
    this.hooks.set(hook.id, hook)

    // Register for each event
    for (const event of hook.events) {
      if (!this.eventHandlers.has(event)) {
        this.eventHandlers.set(event, [])
      }
      const handlers = this.eventHandlers.get(event)!
      
      // Insert hook in priority order
      const insertIndex = handlers.findIndex(h => (h.priority ?? 100) > (hook.priority ?? 100))
      if (insertIndex === -1) {
        handlers.push(hook)
      } else {
        handlers.splice(insertIndex, 0, hook)
      }
    }

    // Hook registered
  }

  /**
   * Unregister a hook
   */
  unregister(hookId: string): void {
    const hook = this.hooks.get(hookId)
    if (!hook) {
      return
    }

    // Remove from hooks map
    this.hooks.delete(hookId)

    // Remove from event handlers
    for (const event of hook.events) {
      const handlers = this.eventHandlers.get(event)
      if (handlers) {
        const index = handlers.findIndex(h => h.id === hookId)
        if (index !== -1) {
          handlers.splice(index, 1)
        }
      }
    }

    // Hook unregistered
  }

  /**
   * Enable a hook
   */
  enableHook(hookId: string): void {
    const hook = this.hooks.get(hookId)
    if (hook) {
      hook.enabled = true
      // Re-register to update event handlers
      this.unregister(hookId)
      this.register(hook)
    }
  }

  /**
   * Disable a hook
   */
  disableHook(hookId: string): void {
    const hook = this.hooks.get(hookId)
    if (hook) {
      hook.enabled = false
      this.unregister(hookId)
    }
  }

  /**
   * Execute hooks for a specific event
   */
  async execute(event: HookEvent, context: HookContext): Promise<HookContext> {
    const handlers = this.eventHandlers.get(event) || []
    
    if (handlers.length === 0) {
      return context
    }

    let modifiedContext = { ...context }

    for (const hook of handlers) {
      if (!hook.enabled) {
        continue
      }

      try {
        const result = await hook.handler(modifiedContext)
        
        if (result.shouldCancel) {
          // Hook cancelled execution
          return modifiedContext
        }

        if (result.modified && result.modifiedContext) {
          modifiedContext = { ...modifiedContext, ...result.modifiedContext }
        } else if (result.modifiedContext) {
          // Merge even if modified flag not set
          modifiedContext = { ...modifiedContext, ...result.modifiedContext }
        }
      } catch (error) {
        this.errorHandler.handleError(error, {
          module: 'HookRegistry',
          function: 'execute',
          operation: `Executing hook: ${hook.id}`,
          metadata: { hookId: hook.id, hookName: hook.name, event }
        }, ErrorSeverity.Error)
        // Continue with other hooks
      }
    }

    return modifiedContext
  }

  /**
   * Get all registered hooks
   */
  getAllHooks(): Hook[] {
    return Array.from(this.hooks.values())
  }

  /**
   * Get hooks for a specific event
   */
  getHooksForEvent(event: HookEvent): Hook[] {
    return this.eventHandlers.get(event) || []
  }

  /**
   * Check if a hook is registered
   */
  hasHook(hookId: string): boolean {
    return this.hooks.has(hookId)
  }

  /**
   * Clear all hooks
   */
  clear(): void {
    this.hooks.clear()
    this.eventHandlers.clear()
  }
}
