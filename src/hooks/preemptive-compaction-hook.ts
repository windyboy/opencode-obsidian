import { BaseHook } from './base-hook'
import type { HookContext, HookResult } from './types'
import { HookEvent } from './types'
import { CompactionManager } from '../context/compaction-manager'

export class PreemptiveCompactionHook extends BaseHook {
  private compactionManager: CompactionManager

  constructor(compactionManager: CompactionManager) {
    super({
      id: 'preemptive-compaction',
      name: 'Preemptive Compaction',
      description: 'Automatically compacts context when approaching token limit',
      events: [HookEvent.PrePrompt, HookEvent.OnContextFull],
      priority: 10, // Run early
    })

    this.compactionManager = compactionManager
  }

  async handler(context: HookContext): Promise<HookResult> {
    const messages = context.messages

    if (!messages || messages.length === 0) {
      return { modified: false }
    }

    // Check and compact
    const result = await this.compactionManager.checkAndCompact(
      messages,
      typeof context.systemPrompt === 'string' ? context.systemPrompt : undefined
    )

    if (!result.shouldCompact) {
      return { modified: false }
    }

    // Return compacted messages
    return {
      modified: true,
      modifiedContext: {
        ...context,
        messages: result.compacted,
        compactionSummary: result.summary,
      },
    }
  }
}
