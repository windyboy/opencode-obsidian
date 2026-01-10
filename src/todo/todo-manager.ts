import type { Vault } from 'obsidian'
import { TodoExtractor } from './todo-extractor'
import type { Todo, TodoStatus, TaskPlan, TaskStep, StepResult, TaskStatus, TaskProgress, TaskCheckpoint } from './types'
import { TaskStatus as TaskStatusEnum } from './types'

export interface TodoManagerConfig {
  autoSave?: boolean // Default: true
  storagePath?: string // Default: '.opencode/todos'
}

export class TodoManager {
  private extractor: TodoExtractor
  private vault: Vault
  private config: Required<TodoManagerConfig>
  private todos: Map<string, Todo> = new Map() // sessionId -> Todo[]
  private todosBySession: Map<string, Todo[]> = new Map()
  private taskPlans: Map<string, TaskPlan> = new Map() // planId -> TaskPlan
  private plansBySession: Map<string, TaskPlan[]> = new Map() // sessionId -> TaskPlan[]
  private stepResults: Map<string, StepResult[]> = new Map() // stepId -> StepResult[]
  private checkpoints: Map<string, TaskCheckpoint[]> = new Map() // planId -> TaskCheckpoint[]
  private interruptedTasks: Set<string> = new Set() // planId -> interrupted

  constructor(vault: Vault, config: TodoManagerConfig = {}) {
    this.extractor = new TodoExtractor()
    this.vault = vault
    this.config = {
      autoSave: config.autoSave ?? true,
      storagePath: config.storagePath ?? '.opencode/todos',
    }

    // Load todos from disk
    this.loadTodos().catch(error => {
      console.error('[TodoManager] Failed to load todos:', error)
    })

    // Load task plans from disk
    this.loadTaskPlans().catch(error => {
      console.error('[TodoManager] Failed to load task plans:', error)
    })

    // Load checkpoints from disk
    this.loadCheckpoints().catch(error => {
      console.error('[TodoManager] Failed to load checkpoints:', error)
    })
  }

  /**
   * Extract TODOs from text and add to manager
   */
  extractAndAddTodos(
    text: string,
    sessionId?: string,
    messageId?: string
  ): { todos: Todo[]; added: Todo[]; completed: Todo[] } {
    const sessionTodos = this.getTodosForSession(sessionId)
    const result = this.extractor.updateTodos(sessionTodos, text, sessionId, messageId)

    // Update stored TODOs
    for (const todo of result.todos) {
      this.todos.set(todo.id, todo)
    }

    // Update session mapping
    if (sessionId) {
      this.todosBySession.set(sessionId, result.todos.filter(t => !t.sessionId || t.sessionId === sessionId))
    }

    // Auto-save if enabled
    if (this.config.autoSave) {
      this.saveTodos().catch(error => {
        console.error('[TodoManager] Failed to save todos:', error)
      })
    }

    return result
  }

  /**
   * Get all TODOs for a session
   */
  getTodosForSession(sessionId?: string): Todo[] {
    if (!sessionId) {
      // Return all TODOs
      return Array.from(this.todos.values())
    }

    const sessionTodos = this.todosBySession.get(sessionId) || []
    
    // Also get any TODOs stored by ID that belong to this session
    const storedTodos = Array.from(this.todos.values()).filter(
      todo => todo.sessionId === sessionId
    )

    // Merge and deduplicate
    const allTodos = [...sessionTodos, ...storedTodos]
    const uniqueTodos = new Map<string, Todo>()
    for (const todo of allTodos) {
      if (!uniqueTodos.has(todo.id)) {
        uniqueTodos.set(todo.id, todo)
      }
    }

    return Array.from(uniqueTodos.values())
  }

  /**
   * Get pending TODOs for a session
   */
  getPendingTodos(sessionId?: string): Todo[] {
    return this.getTodosForSession(sessionId).filter(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      todo => todo.status === ('pending' as const) || todo.status === ('in-progress' as const)
    )
  }

  /**
   * Get completed TODOs for a session
   */
  getCompletedTodos(sessionId?: string): Todo[] {
    return this.getTodosForSession(sessionId).filter(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      todo => todo.status === ('completed' as const)
    )
  }

  /**
   * Update TODO status
   */
  updateTodoStatus(todoId: string, status: TodoStatus): boolean {
    const todo = this.todos.get(todoId)
    if (!todo) {
      return false
    }

    todo.status = status
    todo.updatedAt = Date.now()

    if (status === ('completed' as TodoStatus)) {
      todo.completedAt = Date.now()
    } else if (status === ('cancelled' as TodoStatus)) {
      todo.cancelledAt = Date.now()
    }

    // Update session mapping
    if (todo.sessionId) {
      const sessionTodos = this.getTodosForSession(todo.sessionId)
      const index = sessionTodos.findIndex(t => t.id === todoId)
      if (index !== -1) {
        sessionTodos[index] = todo
        this.todosBySession.set(todo.sessionId, sessionTodos)
      }
    }

    // Auto-save if enabled
    if (this.config.autoSave) {
      this.saveTodos().catch(error => {
        console.error('[TodoManager] Failed to save todos:', error)
      })
    }

    return true
  }

  /**
   * Delete a TODO
   */
  deleteTodo(todoId: string): boolean {
    const todo = this.todos.get(todoId)
    if (!todo) {
      return false
    }

    this.todos.delete(todoId)

    // Update session mapping
    if (todo.sessionId) {
      const sessionTodos = this.getTodosForSession(todo.sessionId)
      const filtered = sessionTodos.filter(t => t.id !== todoId)
      if (filtered.length === 0) {
        this.todosBySession.delete(todo.sessionId)
      } else {
        this.todosBySession.set(todo.sessionId, filtered)
      }
    }

    // Auto-save if enabled
    if (this.config.autoSave) {
      this.saveTodos().catch(error => {
        console.error('[TodoManager] Failed to save todos:', error)
      })
    }

    return true
  }

  /**
   * Get all TODOs
   */
  getAllTodos(): Todo[] {
    return Array.from(this.todos.values())
  }

  /**
   * Clear TODOs for a session
   */
  clearSessionTodos(sessionId: string): void {
    const sessionTodos = this.getTodosForSession(sessionId)
    for (const todo of sessionTodos) {
      this.todos.delete(todo.id)
    }
    this.todosBySession.delete(sessionId)

    if (this.config.autoSave) {
      this.saveTodos().catch(error => {
        console.error('[TodoManager] Failed to save todos:', error)
      })
    }
  }

  /**
   * Save TODOs to disk
   */
  private async saveTodos(): Promise<void> {
    try {
      // Ensure directory exists
      if (!(await this.vault.adapter.exists(this.config.storagePath))) {
        await this.vault.adapter.mkdir(this.config.storagePath)
      }

      // Save as JSON
      const todosArray = Array.from(this.todos.values())
      const filePath = `${this.config.storagePath}/todos.json`

      await this.vault.adapter.write(
        filePath,
        JSON.stringify(todosArray, null, 2)
      )

      // TODOs saved
    } catch (error) {
      console.error('[TodoManager] Failed to save todos:', error)
      throw error
    }
  }

  /**
   * Load TODOs from disk
   */
  private async loadTodos(): Promise<void> {
    try {
      const filePath = `${this.config.storagePath}/todos.json`

      if (!(await this.vault.adapter.exists(filePath))) {
        // No saved todos found
        return
      }

      const content = await this.vault.adapter.read(filePath)
      const todosArray: Todo[] = JSON.parse(content) as Todo[]

      // Load into memory
      for (const todo of todosArray) {
        this.todos.set(todo.id, todo)

        // Update session mapping
        if (todo.sessionId) {
          const sessionTodos = this.todosBySession.get(todo.sessionId) || []
          sessionTodos.push(todo)
          this.todosBySession.set(todo.sessionId, sessionTodos)
        }
      }

      // TODOs loaded
    } catch (error) {
      console.error('[TodoManager] Failed to load todos:', error)
      throw error
    }
  }

  /**
   * Create a task plan from goal
   * This parses structured plan from LLM output or creates a simple plan
   */
  createPlan(goal: string, sessionId?: string, llmOutput?: string): TaskPlan {
    const planId = `plan_${Date.now()}_${Math.random().toString(36).substring(7)}`
    const now = Date.now()

    // Try to parse structured plan from LLM output if provided
    let steps: TaskStep[] = []
    if (llmOutput) {
      steps = this.parsePlanFromLLMOutput(llmOutput)
    }

    // If no steps were parsed, create a simple plan
    if (steps.length === 0) {
      steps = [{
        id: `step_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        description: goal,
        successCriteria: 'Task completed successfully',
        status: TaskStatusEnum.Pending,
        retryCount: 0,
        maxRetries: 3,
        createdAt: now,
        updatedAt: now,
      }]
    }

    const plan: TaskPlan = {
      id: planId,
      goal,
      steps,
      status: TaskStatusEnum.Pending,
      createdAt: now,
      updatedAt: now,
      metadata: {
        sessionId,
      },
    }

    // Store plan
    this.taskPlans.set(planId, plan)

    // Update session mapping
    if (sessionId) {
      const sessionPlans = this.plansBySession.get(sessionId) || []
      sessionPlans.push(plan)
      this.plansBySession.set(sessionId, sessionPlans)
    }

    // Auto-save if enabled
    if (this.config.autoSave) {
      this.saveTaskPlans().catch(error => {
        console.error('[TodoManager] Failed to save task plans:', error)
      })
    }

    return plan
  }

  /**
   * Execute a single step
   * This marks the step as in-progress and prepares it for execution
   * Automatically creates a checkpoint before execution for rollback capability
   */
  async executeStep(step: TaskStep, planId: string, autoCheckpoint: boolean = true): Promise<StepResult> {
    // Check if task is interrupted
    if (this.isTaskInterrupted(planId)) {
      throw new Error(`Task ${planId} has been interrupted`)
    }

    // Create checkpoint before execution (for rollback capability)
    if (autoCheckpoint) {
      this.createCheckpoint(planId, `Before executing step: ${step.description}`, {
        triggeredBy: 'system',
        reason: 'auto-checkpoint-before-step-execution',
      })
    }

    // Update step status
    step.status = TaskStatusEnum.InProgress
    step.updatedAt = Date.now()

    // Create step result
    const result: StepResult = {
      stepId: step.id,
      success: false,
      verified: false,
      executedAt: Date.now(),
    }

    // Store step result
    const stepResults = this.stepResults.get(step.id) || []
    stepResults.push(result)
    this.stepResults.set(step.id, stepResults)

    // Update plan
    const plan = this.taskPlans.get(planId)
    if (plan) {
      plan.updatedAt = Date.now()
      this.taskPlans.set(planId, plan)
    }

    // Auto-save if enabled
    if (this.config.autoSave) {
      await this.saveTaskPlans().catch(error => {
        console.error('[TodoManager] Failed to save task plans:', error)
      })
    }

    return result
  }

  /**
   * Validate step result against success criteria
   */
  validateStep(step: TaskStep, result: StepResult): boolean {
    // Update result with validation status
    result.verifiedAt = Date.now()

    // Basic validation: check if step has output or tool call result
    let isValid = false

    if (result.success) {
      // If step has output, consider it valid
      if (result.output !== undefined && result.output !== null) {
        isValid = true
      }

      // If step has tool call with result, consider it valid
      if (result.toolCall && result.toolCall.result !== undefined && result.toolCall.result !== null) {
        isValid = true
      }

      // Check success criteria if provided
      if (step.successCriteria) {
        // For now, we just check if the step was successful
        // In a real implementation, we would parse and evaluate the success criteria
        isValid = result.success
      }
    }

    result.verified = isValid

    // Update step status based on validation
    if (isValid) {
      step.status = TaskStatusEnum.Completed
      step.completedAt = Date.now()
    } else {
      step.status = TaskStatusEnum.Failed
      step.failedAt = Date.now()
      if (result.error) {
        step.error = result.error
      }
    }

    step.updatedAt = Date.now()

    // Update step result
    const stepResults = this.stepResults.get(step.id) || []
    const lastResult = stepResults[stepResults.length - 1]
    if (lastResult) {
      Object.assign(lastResult, result)
    }

    // Find plan for this step and update progress
    for (const [planId, plan] of this.taskPlans.entries()) {
      if (plan.steps.some(s => s.id === step.id)) {
        this.updateTaskProgress(planId)
        break
      }
    }

    // Auto-save if enabled
    if (this.config.autoSave) {
      this.saveTaskPlans().catch(error => {
        console.error('[TodoManager] Failed to save task plans:', error)
      })
    }

    return isValid
  }

  /**
   * Retry a failed step
   */
  retryStep(step: TaskStep, planId: string): boolean {
    // Check if we can retry
    if (step.retryCount >= step.maxRetries) {
      return false
    }

    // Increment retry count
    step.retryCount++
    step.status = TaskStatusEnum.Pending
    step.error = undefined
    step.failedAt = undefined
    step.updatedAt = Date.now()

    // Update plan
    const plan = this.taskPlans.get(planId)
    if (plan) {
      plan.updatedAt = Date.now()
      this.taskPlans.set(planId, plan)
    }

    // Auto-save if enabled
    if (this.config.autoSave) {
      this.saveTaskPlans().catch(error => {
        console.error('[TodoManager] Failed to save task plans:', error)
      })
    }

    return true
  }

  /**
   * Get task plan by ID
   */
  getTaskPlan(planId: string): TaskPlan | undefined {
    return this.taskPlans.get(planId)
  }

  /**
   * Get all task plans for a session
   */
  getTaskPlansForSession(sessionId: string): TaskPlan[] {
    return this.plansBySession.get(sessionId) || []
  }

  /**
   * Get task progress for a plan
   */
  getTaskProgress(planId: string): TaskProgress | undefined {
    const plan = this.taskPlans.get(planId)
    if (!plan) {
      return undefined
    }

    const totalSteps = plan.steps.length
    const completedSteps = plan.steps.filter(s => s.status === TaskStatusEnum.Completed).length
    const failedSteps = plan.steps.filter(s => s.status === TaskStatusEnum.Failed).length
    const skippedSteps = plan.steps.filter(s => s.status === TaskStatusEnum.Skipped).length
    const currentStepIndex = plan.steps.findIndex(s => s.status === TaskStatusEnum.InProgress)

    const progress = totalSteps > 0 ? completedSteps / totalSteps : 0

    // Calculate estimated time remaining based on average step time
    // This is a simple estimation - in a real implementation, we would track actual step durations
    let estimatedTimeRemaining: number | undefined
    if (currentStepIndex >= 0 && completedSteps > 0) {
      // Estimate based on average completion time
      // For now, we use a simple heuristic: 30 seconds per step
      const remainingSteps = totalSteps - completedSteps - skippedSteps - failedSteps
      estimatedTimeRemaining = remainingSteps * 30000 // 30 seconds per step
    }

    return {
      planId,
      totalSteps,
      completedSteps,
      failedSteps,
      skippedSteps,
      currentStepIndex: currentStepIndex >= 0 ? currentStepIndex : undefined,
      progress,
      estimatedTimeRemaining,
    }
  }

  /**
   * Get task status for a plan
   */
  getTaskStatus(planId: string): TaskStatus | undefined {
    const plan = this.taskPlans.get(planId)
    if (!plan) {
      return undefined
    }

    return plan.status
  }

  /**
   * Update task progress (called after step execution/validation)
   */
  updateTaskProgress(planId: string): void {
    const plan = this.taskPlans.get(planId)
    if (!plan) {
      return
    }

    // Update plan status based on step statuses
    const allCompleted = plan.steps.every(s => 
      s.status === TaskStatusEnum.Completed || s.status === TaskStatusEnum.Skipped
    )
    const anyFailed = plan.steps.some(s => s.status === TaskStatusEnum.Failed && s.retryCount >= s.maxRetries)
    const anyInProgress = plan.steps.some(s => s.status === TaskStatusEnum.InProgress)

    if (allCompleted) {
      plan.status = TaskStatusEnum.Completed
      plan.completedAt = Date.now()
    } else if (anyFailed && !anyInProgress) {
      plan.status = TaskStatusEnum.Failed
      plan.failedAt = Date.now()
    } else if (anyInProgress) {
      plan.status = TaskStatusEnum.InProgress
    } else {
      plan.status = TaskStatusEnum.Pending
    }

    plan.updatedAt = Date.now()

    // Auto-save if enabled
    if (this.config.autoSave) {
      this.saveTaskPlans().catch(error => {
        console.error('[TodoManager] Failed to save task plans:', error)
      })
    }
  }

  /**
   * Parse structured plan from LLM output
   * This is a simple parser - in a real implementation, we would use a more sophisticated parser
   */
  private parsePlanFromLLMOutput(output: string): TaskStep[] {
    const steps: TaskStep[] = []
    const lines = output.split('\n')
    const now = Date.now()

    // Try to find step patterns in the output
    // Patterns: "1. Step description", "- Step description", "* Step description", etc.
    for (let i = 0; i < lines.length; i++) {
      const currentLine = lines[i]
      if (!currentLine) continue
      const line = currentLine.trim()
      if (!line) continue

      // Match step patterns
      const stepMatch = line.match(/^(?:\d+\.|[-*+]|\d+\))\s*(.+)$/)
      if (stepMatch && stepMatch[1]) {
        const description = stepMatch[1].trim()
        
        // Try to find success criteria in next lines
        let successCriteria = 'Task completed successfully'
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          const nextLineRaw = lines[j]
          if (!nextLineRaw) continue
          const nextLine = nextLineRaw.trim().toLowerCase()
          if (nextLine.includes('success') || nextLine.includes('criteria') || nextLine.includes('complete')) {
            successCriteria = nextLineRaw.trim()
            break
          }
        }

        steps.push({
          id: `step_${now}_${i}_${Math.random().toString(36).substring(7)}`,
          description,
          successCriteria,
          status: TaskStatusEnum.Pending,
          retryCount: 0,
          maxRetries: 3,
          createdAt: now,
          updatedAt: now,
        })
      }
    }

    return steps
  }

  /**
   * Save task plans to disk
   * Also saves progress information and interrupted tasks
   */
  private async saveTaskPlans(): Promise<void> {
    try {
      // Ensure directory exists
      if (!(await this.vault.adapter.exists(this.config.storagePath))) {
        await this.vault.adapter.mkdir(this.config.storagePath)
      }

      // Save task plans as JSON
      const plansArray = Array.from(this.taskPlans.values())
      const plansFilePath = `${this.config.storagePath}/task-plans.json`
      await this.vault.adapter.write(
        plansFilePath,
        JSON.stringify(plansArray, null, 2)
      )

      // Save progress information
      const progressData: Record<string, TaskProgress> = {}
      for (const planId of this.taskPlans.keys()) {
        const progress = this.getTaskProgress(planId)
        if (progress) {
          progressData[planId] = progress
        }
      }
      const progressFilePath = `${this.config.storagePath}/task-progress.json`
      await this.vault.adapter.write(
        progressFilePath,
        JSON.stringify(progressData, null, 2)
      )

      // Save step results
      const stepResultsData: Record<string, StepResult[]> = {}
      for (const [stepId, results] of this.stepResults.entries()) {
        stepResultsData[stepId] = results
      }
      const stepResultsFilePath = `${this.config.storagePath}/step-results.json`
      await this.vault.adapter.write(
        stepResultsFilePath,
        JSON.stringify(stepResultsData, null, 2)
      )

      // Save interrupted tasks
      const interruptedFilePath = `${this.config.storagePath}/interrupted-tasks.json`
      await this.vault.adapter.write(
        interruptedFilePath,
        JSON.stringify(Array.from(this.interruptedTasks), null, 2)
      )
    } catch (error) {
      console.error('[TodoManager] Failed to save task plans:', error)
      throw error
    }
  }

  /**
   * Load task plans from disk
   * Also loads progress information
   */
  private async loadTaskPlans(): Promise<void> {
    try {
      const plansFilePath = `${this.config.storagePath}/task-plans.json`
      if (await this.vault.adapter.exists(plansFilePath)) {
        const content = await this.vault.adapter.read(plansFilePath)
        const plansArray: TaskPlan[] = JSON.parse(content) as TaskPlan[]

        // Load plans into memory
        for (const plan of plansArray) {
          this.taskPlans.set(plan.id, plan)

          // Update session mapping
          if (plan.metadata?.sessionId) {
            const sessionPlans = this.plansBySession.get(plan.metadata.sessionId) || []
            sessionPlans.push(plan)
            this.plansBySession.set(plan.metadata.sessionId, sessionPlans)
          }
        }
      }

      // Load step results if available
      const stepResultsFilePath = `${this.config.storagePath}/step-results.json`
      if (await this.vault.adapter.exists(stepResultsFilePath)) {
        const content = await this.vault.adapter.read(stepResultsFilePath)
        const stepResultsData: Record<string, StepResult[]> = JSON.parse(content) as Record<string, StepResult[]>
        
        for (const [stepId, results] of Object.entries(stepResultsData)) {
          this.stepResults.set(stepId, results)
        }
      }
    } catch (error) {
      console.error('[TodoManager] Failed to load task plans:', error)
      throw error
    }
  }

  /**
   * Interrupt a task (user can cancel anytime)
   */
  interruptTask(planId: string, reason?: string): boolean {
    const plan = this.taskPlans.get(planId)
    if (!plan) {
      return false
    }

    // Mark task as interrupted
    this.interruptedTasks.add(planId)

    // Update plan status
    plan.status = TaskStatusEnum.Cancelled
    plan.cancelledAt = Date.now()
    plan.updatedAt = Date.now()
    if (reason) {
      plan.error = `Task interrupted: ${reason}`
    }

    // Cancel all in-progress steps
    for (const step of plan.steps) {
      if (step.status === TaskStatusEnum.InProgress) {
        step.status = TaskStatusEnum.Cancelled
        step.updatedAt = Date.now()
        step.error = `Step cancelled due to task interruption`
      }
    }

    // Auto-save if enabled
    if (this.config.autoSave) {
      this.saveTaskPlans().catch(error => {
        console.error('[TodoManager] Failed to save task plans:', error)
      })
    }

    return true
  }

  /**
   * Create a checkpoint for a task plan
   * This saves the current state of the plan and all step results
   */
  createCheckpoint(
    planId: string,
    description?: string,
    metadata?: {
      reason?: string
      triggeredBy?: 'user' | 'system' | 'error'
      [key: string]: unknown
    }
  ): TaskCheckpoint | null {
    const plan = this.taskPlans.get(planId)
    if (!plan) {
      return null
    }

    // Create deep copy of plan
    const planSnapshot: TaskPlan = JSON.parse(JSON.stringify(plan)) as TaskPlan

    // Create deep copy of step results for this plan
    const stepResultsSnapshot = new Map<string, StepResult[]>()
    for (const step of plan.steps) {
      const results = this.stepResults.get(step.id)
      if (results && results.length > 0) {
        stepResultsSnapshot.set(step.id, JSON.parse(JSON.stringify(results)) as StepResult[])
      }
    }

    // Create checkpoint
    const checkpointId = `checkpoint_${Date.now()}_${Math.random().toString(36).substring(7)}`
    const checkpoint: TaskCheckpoint = {
      id: checkpointId,
      planId,
      createdAt: Date.now(),
      description,
      planSnapshot,
      stepResults: stepResultsSnapshot,
      currentStepIndex: plan.steps.findIndex(s => s.status === TaskStatusEnum.InProgress),
      metadata: {
        ...metadata,
        triggeredBy: metadata?.triggeredBy ?? 'system',
      },
    }

    // Store checkpoint
    const planCheckpoints = this.checkpoints.get(planId) || []
    planCheckpoints.push(checkpoint)
    this.checkpoints.set(planId, planCheckpoints)

    // Auto-save if enabled
    if (this.config.autoSave) {
      this.saveCheckpoints().catch(error => {
        console.error('[TodoManager] Failed to save checkpoints:', error)
      })
    }

    return checkpoint
  }

  /**
   * Rollback to a specific checkpoint
   * This restores the plan and step results to the checkpoint state
   */
  rollbackToCheckpoint(planId: string, checkpointId: string): boolean {
    const planCheckpoints = this.checkpoints.get(planId)
    if (!planCheckpoints || planCheckpoints.length === 0) {
      return false
    }

    // Find checkpoint
    const checkpointIndex = planCheckpoints.findIndex(cp => cp.id === checkpointId)
    if (checkpointIndex < 0) {
      return false
    }

    const checkpoint = planCheckpoints[checkpointIndex]
    if (!checkpoint) {
      return false
    }

    // Restore plan from checkpoint
    const restoredPlan: TaskPlan = JSON.parse(JSON.stringify(checkpoint.planSnapshot)) as TaskPlan
    this.taskPlans.set(planId, restoredPlan)

    // Restore step results from checkpoint
    for (const [stepId, results] of checkpoint.stepResults.entries()) {
      this.stepResults.set(stepId, JSON.parse(JSON.stringify(Array.from(results))) as StepResult[])
    }

    // Remove checkpoints created after this one
    if (checkpointIndex < planCheckpoints.length - 1) {
      planCheckpoints.splice(checkpointIndex + 1)
      this.checkpoints.set(planId, planCheckpoints)
    }

    // Remove interrupted flag if present
    this.interruptedTasks.delete(planId)

    // Auto-save if enabled
    if (this.config.autoSave) {
      Promise.all([
        this.saveTaskPlans(),
        this.saveCheckpoints(),
      ]).catch(error => {
        console.error('[TodoManager] Failed to save after rollback:', error)
      })
    }

    return true
  }

  /**
   * Get all checkpoints for a plan
   */
  getCheckpoints(planId: string): TaskCheckpoint[] {
    return this.checkpoints.get(planId) || []
  }

  /**
   * Get latest checkpoint for a plan
   */
  getLatestCheckpoint(planId: string): TaskCheckpoint | null {
    const planCheckpoints = this.checkpoints.get(planId)
    if (!planCheckpoints || planCheckpoints.length === 0) {
      return null
    }

    // Return the most recent checkpoint (last in array)
    const latest = planCheckpoints[planCheckpoints.length - 1]
    return latest ?? null
  }

  /**
   * Check if a task is interrupted
   */
  isTaskInterrupted(planId: string): boolean {
    return this.interruptedTasks.has(planId)
  }

  /**
   * Get step results for a specific step
   */
  getStepResults(stepId: string): StepResult[] {
    return this.stepResults.get(stepId) || []
  }

  /**
   * Save checkpoints to disk
   */
  private async saveCheckpoints(): Promise<void> {
    try {
      // Ensure directory exists
      if (!(await this.vault.adapter.exists(this.config.storagePath))) {
        await this.vault.adapter.mkdir(this.config.storagePath)
      }

      // Convert Map to serializable format
      const checkpointsData: Record<string, Array<Omit<TaskCheckpoint, 'stepResults'> & { stepResults: Record<string, StepResult[]> }>> = {}
      for (const [planId, checkpoints] of this.checkpoints.entries()) {
        // Convert stepResults Map to serializable format
        const serializedCheckpoints = checkpoints.map(cp => ({
          id: cp.id,
          planId: cp.planId,
          createdAt: cp.createdAt,
          description: cp.description,
          planSnapshot: cp.planSnapshot,
          stepResults: Object.fromEntries(cp.stepResults.entries()),
          currentStepIndex: cp.currentStepIndex,
          metadata: cp.metadata,
        }))
        checkpointsData[planId] = serializedCheckpoints
      }

      const checkpointsFilePath = `${this.config.storagePath}/checkpoints.json`
      await this.vault.adapter.write(
        checkpointsFilePath,
        JSON.stringify(checkpointsData, null, 2)
      )
    } catch (error) {
      console.error('[TodoManager] Failed to save checkpoints:', error)
      throw error
    }
  }

  /**
   * Load checkpoints from disk
   */
  private async loadCheckpoints(): Promise<void> {
    try {
      const checkpointsFilePath = `${this.config.storagePath}/checkpoints.json`
      if (!(await this.vault.adapter.exists(checkpointsFilePath))) {
        return
      }

      const content = await this.vault.adapter.read(checkpointsFilePath)
      const checkpointsData: Record<string, Array<Omit<TaskCheckpoint, 'stepResults'> & { stepResults: Record<string, StepResult[]> }>> = JSON.parse(content) as Record<string, Array<Omit<TaskCheckpoint, 'stepResults'> & { stepResults: Record<string, StepResult[]> }>>

      // Restore checkpoints
      for (const [planId, checkpoints] of Object.entries(checkpointsData)) {
        const restoredCheckpoints: TaskCheckpoint[] = checkpoints.map(cp => ({
          ...cp,
          stepResults: new Map(Object.entries(cp.stepResults)),
        })) as TaskCheckpoint[]
        this.checkpoints.set(planId, restoredCheckpoints)
      }

      // Load interrupted tasks if available
      const interruptedFilePath = `${this.config.storagePath}/interrupted-tasks.json`
      if (await this.vault.adapter.exists(interruptedFilePath)) {
        const content = await this.vault.adapter.read(interruptedFilePath)
        const interruptedTasks: string[] = JSON.parse(content) as string[]
        this.interruptedTasks = new Set(interruptedTasks)
      }
    } catch (error) {
      console.error('[TodoManager] Failed to load checkpoints:', error)
      throw error
    }
  }
}
