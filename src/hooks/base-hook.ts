import type { Hook, HookContext, HookResult, HookEvent } from './types'

export abstract class BaseHook implements Hook {
  id: string
  name: string
  description?: string
  events: HookEvent[]
  priority: number = 100
  enabled: boolean = true

  constructor(config: {
    id: string
    name: string
    description?: string
    events: HookEvent[]
    priority?: number
    enabled?: boolean
  }) {
    this.id = config.id
    this.name = config.name
    this.description = config.description
    this.events = config.events
    this.priority = config.priority ?? 100
    this.enabled = config.enabled ?? true
  }

  abstract handler(context: HookContext): HookResult | Promise<HookResult>

  /**
   * Enable this hook
   */
  enable(): void {
    this.enabled = true
  }

  /**
   * Disable this hook
   */
  disable(): void {
    this.enabled = false
  }
}
