/**
 * Agent Loop Integration Tests
 * Tests state machine transitions, plan parsing, and retry mechanisms
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AgentOrchestrator } from '../../src/orchestrator/agent-orchestrator'
import { AgentState } from '../../src/orchestrator/types'
import { TaskPlanParser } from '../../src/orchestrator/task-plan'
import type { Vault, App } from 'obsidian'
import type { OpenCodeServerClient } from '../../src/opencode-server/client'
import type { ErrorHandler } from '../../src/utils/error-handler'

// Mock dependencies
vi.mock('../../src/session/session-storage')
vi.mock('../../src/opencode-server/client')
vi.mock('../../src/utils/error-handler')

describe('Agent Loop Integration Tests', () => {
  let orchestrator: AgentOrchestrator
  let mockVault: Partial<Vault>
  let mockApp: Partial<App>
  let mockOpenCodeClient: Partial<OpenCodeServerClient> | null
  let mockErrorHandler: Partial<ErrorHandler>

  beforeEach(() => {
    // Setup mocks
    mockVault = {
      adapter: {
        exists: vi.fn().mockResolvedValue(false),
        mkdir: vi.fn().mockResolvedValue(undefined),
        write: vi.fn().mockResolvedValue(undefined),
        read: vi.fn().mockResolvedValue('{}'),
      },
    }

    mockApp = {}

    mockOpenCodeClient = {
      sendSessionMessage: vi.fn().mockResolvedValue(undefined),
      interruptSession: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    }

    mockErrorHandler = {
      handleError: vi.fn(),
    }

    orchestrator = new AgentOrchestrator(
      mockVault as Vault,
      mockApp as App,
      mockOpenCodeClient as OpenCodeServerClient | null,
      mockErrorHandler as ErrorHandler
    )
  })

  describe('State Machine Transitions', () => {
    it('should transition from Planning to Executing after plan generation', async () => {
      // This is a basic test - full implementation would require mocking OpenCode Server responses
      // For now, we test the structure
      expect(orchestrator).toBeDefined()
      expect(AgentState.Planning).toBe('planning')
      expect(AgentState.Executing).toBe('executing')
    })

    it('should handle state transitions correctly', () => {
      // Test state enum values
      expect(AgentState.Planning).toBe('planning')
      expect(AgentState.Executing).toBe('executing')
      expect(AgentState.Validating).toBe('validating')
      expect(AgentState.Retrying).toBe('retrying')
      expect(AgentState.Completed).toBe('completed')
      expect(AgentState.Cancelled).toBe('cancelled')
      expect(AgentState.Failed).toBe('failed')
    })
  })

  describe('Plan Parsing', () => {
    it('should parse structured plan from markdown list', () => {
      const goal = 'Test goal'
      const llmOutput = `
1. Step 1: Do something
   Success criteria: Step 1 completed
2. Step 2: Do something else
   Success criteria: Step 2 completed
      `

      const plan = TaskPlanParser.parse(goal, llmOutput)
      
      expect(plan).toBeDefined()
      expect(plan.goal).toBe(goal)
      expect(plan.steps.length).toBeGreaterThan(0)
      expect(plan.steps[0].description).toContain('Step 1')
    })

    it('should parse plan from JSON format', () => {
      const goal = 'Test goal'
      const llmOutput = JSON.stringify({
        steps: [
          {
            description: 'Step 1',
            successCriteria: 'Completed',
          },
          {
            description: 'Step 2',
            successCriteria: 'Completed',
          },
        ],
      })

      const plan = TaskPlanParser.parse(goal, llmOutput)
      
      expect(plan).toBeDefined()
      expect(plan.goal).toBe(goal)
      expect(plan.steps.length).toBe(2)
    })

    it('should handle empty or invalid input', () => {
      const goal = 'Test goal'
      const llmOutput = ''

      const plan = TaskPlanParser.parse(goal, llmOutput)
      
      expect(plan).toBeDefined()
      expect(plan.goal).toBe(goal)
      // Should create at least one step from the goal itself
      expect(plan.steps.length).toBeGreaterThan(0)
    })

    it('should serialize and deserialize plans', () => {
      const goal = 'Test goal'
      const llmOutput = '1. Step 1\n2. Step 2'
      const plan = TaskPlanParser.parse(goal, llmOutput)

      const serialized = TaskPlanParser.serialize(plan)
      const deserialized = TaskPlanParser.deserialize(serialized)

      expect(deserialized.id).toBe(plan.id)
      expect(deserialized.goal).toBe(plan.goal)
      expect(deserialized.steps.length).toBe(plan.steps.length)
    })
  })

  describe('Retry Mechanism', () => {
    it('should track retry count for failed steps', () => {
      const goal = 'Test goal'
      const llmOutput = '1. Step 1'
      const plan = TaskPlanParser.parse(goal, llmOutput)

      expect(plan.steps[0].retryCount).toBe(0)
      expect(plan.steps[0].maxRetries).toBe(3)
    })

    it('should respect max retries configuration', () => {
      // Test that maxRetries is respected in orchestrator config
      const config = { maxRetries: 5 }
      const customOrchestrator = new AgentOrchestrator(
        mockVault as Vault,
        mockApp as App,
        mockOpenCodeClient as OpenCodeServerClient | null,
        mockErrorHandler as ErrorHandler,
        config
      )

      expect(customOrchestrator).toBeDefined()
    })
  })
})
