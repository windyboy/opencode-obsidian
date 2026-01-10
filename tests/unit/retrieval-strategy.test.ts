/**
 * Unit tests for retrieval strategy
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { VaultRetrievalStrategy } from '../../src/context/retrieval-strategy'
import { ContextManager } from '../../src/context/context-manager'
import type { Vault, App } from 'obsidian'
import { TFile } from 'obsidian'

// Mock Obsidian Vault
class MockVault {
  private files: Map<string, TFile> = new Map()
  public adapter: {
    read: (path: string) => Promise<string>
  }

  constructor() {
    // Add some mock files
    this.files.set('test1.md', {
      path: 'test1.md',
      basename: 'test1',
      extension: 'md',
      name: 'test1.md',
      stat: {
        size: 100,
        ctime: Date.now(),
        mtime: Date.now(),
      },
      parent: null,
      vault: this as unknown as Vault,
    // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast
    } as TFile)

    this.files.set('test2.md', {
      path: 'test2.md',
      basename: 'test2',
      extension: 'md',
      name: 'test2.md',
      stat: {
        size: 200,
        ctime: Date.now(),
        mtime: Date.now(),
      },
      parent: null,
      vault: this as unknown as Vault,
    // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast
    } as TFile)

    // Mock adapter
    this.adapter = {
      read: async (path: string) => {
        if (path === 'test1.md') {
          return 'Test content 1: This is a test file about testing.'
        }
        if (path === 'test2.md') {
          return 'Test content 2: This is another test file about testing.'
        }
        throw new Error(`File not found: ${path}`)
      },
    }
  }

  getMarkdownFiles(): TFile[] {
    return Array.from(this.files.values())
  }
}

// Mock App
const mockApp = {
  workspace: {
    getActiveFile: vi.fn(() => ({
      path: 'test1.md',
      basename: 'test1',
      extension: 'md',
      name: 'test1.md',
    })),
  },
} as unknown as App

describe('VaultRetrievalStrategy', () => {
  let strategy: VaultRetrievalStrategy
  let mockVault: MockVault

  beforeEach(() => {
    mockVault = new MockVault()
    strategy = new VaultRetrievalStrategy(
      mockVault as unknown as Vault,
      10, // maxResults
      2000 // maxTokens
    )
  })

  it('should retrieve context from vault', async () => {
    const result = await strategy.retrieveContext('test', 5, 500)

    expect(result).toBeDefined()
    expect(result.contexts).toBeInstanceOf(Array)
    expect(result.totalTokens).toBeGreaterThanOrEqual(0)
    expect(result.retrievalTime).toBeGreaterThanOrEqual(0)
  })

  it('should limit results by maxResults', async () => {
    const result = await strategy.retrieveContext('test', 1, 500)

    expect(result.contexts.length).toBeLessThanOrEqual(1)
  })

  it('should limit tokens by maxTokens', async () => {
    const result = await strategy.retrieveContext('test', 10, 100)

    expect(result.totalTokens).toBeLessThanOrEqual(150) // Allow some margin for estimation
  })

  it('should cache retrieval results', async () => {
    const result1 = await strategy.retrieveContext('test', 5, 500)
    const result2 = await strategy.retrieveContext('test', 5, 500)

    // Should return cached result (same reference or same content)
    expect(result2.retrievalTime).toBeLessThanOrEqual(result1.retrievalTime)
  })

  it('should clear cache', () => {
    strategy.clearCache()
    // No assertion needed, just verify no error is thrown
  })
})

describe('ContextManager - Retrieval Integration', () => {
  let contextManager: ContextManager
  let mockVault: MockVault

  beforeEach(() => {
    mockVault = new MockVault()
    contextManager = new ContextManager(
      {
        maxContextTokens: 5000,
        preemptiveCompactionThreshold: 0.85,
        enableTokenEstimation: true,
        maxRetrievalResults: 10,
        maxRetrievalTokens: 2000,
      },
      mockApp,
      mockVault as unknown as Vault
    )
  })

  it('should retrieve context with query', async () => {
    const result = await contextManager.retrieveContext('test query', {
      maxResults: 5,
      maxTokens: 1000,
    })

    expect(result).toBeDefined()
    expect(result.contexts).toBeInstanceOf(Array)
    expect(result.totalTokens).toBeGreaterThanOrEqual(0)
    expect(result.retrievalTime).toBeGreaterThanOrEqual(0)
  })

  it('should include current note when provided', async () => {
    const result = await contextManager.retrieveContext('test query', {
      maxResults: 5,
      maxTokens: 1000,
      currentNotePath: 'test1.md',
    })

    expect(result.contexts.length).toBeGreaterThan(0)
    const currentNoteContext = result.contexts.find((ctx) => ctx.source === 'test1.md')
    expect(currentNoteContext).toBeDefined()
  })

  it('should include recent messages when provided', async () => {
    const result = await contextManager.retrieveContext('test query', {
      maxResults: 5,
      maxTokens: 1000,
      recentMessages: [
        { role: 'user', content: 'Previous message 1' },
        { role: 'assistant', content: 'Previous response 1' },
      ],
    })

    expect(result.contexts.length).toBeGreaterThan(0)
    const recentContext = result.contexts.find((ctx) => ctx.source === 'recent-conversation')
    expect(recentContext).toBeDefined()
  })

  it('should include task plan when provided', async () => {
    const taskPlan = {
      id: 'plan1',
      goal: 'Test goal',
      steps: [{ id: 'step1', description: 'Test step' }],
    }

    const result = await contextManager.retrieveContext('test query', {
      maxResults: 5,
      maxTokens: 1000,
      taskPlan,
    })

    expect(result.contexts.length).toBeGreaterThan(0)
    const planContext = result.contexts.find((ctx) => ctx.source === 'task-plan')
    expect(planContext).toBeDefined()
  })

  it('should respect token budget', async () => {
    const result = await contextManager.retrieveContext('test query', {
      maxResults: 10,
      maxTokens: 500, // Small budget
    })

    expect(result.totalTokens).toBeLessThanOrEqual(600) // Allow some margin
  })

  it('should handle errors gracefully', async () => {
    // Create a context manager without vault (should handle gracefully)
    const contextManagerWithoutVault = new ContextManager({
      maxContextTokens: 5000,
      preemptiveCompactionThreshold: 0.85,
      enableTokenEstimation: true,
    })

    const result = await contextManagerWithoutVault.retrieveContext('test query', {
      maxResults: 5,
      maxTokens: 1000,
    })

    // Should return empty result or handle error gracefully
    expect(result).toBeDefined()
    expect(result.contexts).toBeInstanceOf(Array)
  })
})
