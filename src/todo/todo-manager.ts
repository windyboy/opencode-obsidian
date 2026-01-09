import type { Vault } from 'obsidian'
import { TodoExtractor } from './todo-extractor'
import type { Todo, TodoStatus } from './types'

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
      todo => todo.status === ('pending' as const) || todo.status === ('in-progress' as const)
    )
  }

  /**
   * Get completed TODOs for a session
   */
  getCompletedTodos(sessionId?: string): Todo[] {
    return this.getTodosForSession(sessionId).filter(
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
      const todosArray: Todo[] = JSON.parse(content)

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
}
