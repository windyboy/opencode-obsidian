export enum HookEvent {
  PrePrompt = 'pre-prompt',
  PostPrompt = 'post-prompt',
  PreToolUse = 'pre-tool-use',
  PostToolUse = 'post-tool-use',
  OnStop = 'on-stop',
  OnError = 'on-error',
  OnSessionInit = 'on-session-init',
  OnMessageAdded = 'on-message-added',
  OnContextFull = 'on-context-full'
}

export interface HookContext {
  sessionId?: string
  message?: string
  toolName?: string
  toolOutput?: string
  toolInput?: unknown
  error?: Error
  messages?: Array<{
    role: 'user' | 'assistant' | 'system'
    content: string | Array<{ type: string; text?: string; [key: string]: unknown }>
  }>
  [key: string]: unknown
}

export interface HookResult {
  modified?: boolean
  modifiedContext?: HookContext
  shouldCancel?: boolean
  [key: string]: unknown
}

export type HookHandler = (context: HookContext) => HookResult | Promise<HookResult>

export interface Hook {
  id: string
  name: string
  description?: string
  events: HookEvent[]
  handler: HookHandler
  priority?: number // Lower numbers run first (default: 100)
  enabled?: boolean
}
