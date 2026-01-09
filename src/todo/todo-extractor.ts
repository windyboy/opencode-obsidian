import type { Todo, TodoExtractionResult } from './types'
import { TodoStatus } from './types'

export class TodoExtractor {
  /**
   * Extract TODO items from text
   * Supports various formats:
   * - TODO: description
   * - - [ ] description (markdown checkbox)
   * - [ ] description
   * - TODO description
   * - FIXME: description
   * - XXX: description
   */
  extractTodos(text: string, sessionId?: string, messageId?: string): TodoExtractionResult {
    const todos: Todo[] = []
    const lines = text.split('\n')
    let todoIndex = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue
      const trimmed = line.trim()

      // Check for markdown checkbox format: - [ ] or [ ]
      const checkboxMatch = trimmed.match(/^(?:[-*+]|\d+\.)\s*\[([ xX])\]\s*(.+)$/)
      if (checkboxMatch && checkboxMatch[1] && checkboxMatch[2]) {
        const isChecked = checkboxMatch[1].toLowerCase() === 'x'
        const description = checkboxMatch[2].trim()

        if (description) {
          todos.push(this.createTodo(
            description,
            isChecked ? TodoStatus.Completed : TodoStatus.Pending,
            sessionId,
            messageId,
            todoIndex++
          ))
        }
        continue
      }

      // Check for TODO/FIXME/XXX patterns
      const todoMatch = trimmed.match(/(?:TODO|FIXME|XXX|HACK|NOTE|BUG):?\s*(.+)$/i)
      if (todoMatch && todoMatch[1]) {
        const description = todoMatch[1].trim()

        // Check if already completed (if line contains completed indicators)
        const isCompleted = /(?:done|completed|finished|resolved|fixed)/i.test(trimmed)
        
        todos.push(this.createTodo(
          description,
          isCompleted ? TodoStatus.Completed : TodoStatus.Pending,
          sessionId,
          messageId,
          todoIndex++
        ))
        continue
      }

      // Check for numbered/bulleted lists that might be TODOs
      const listMatch = trimmed.match(/^(?:\d+\.|\*|[-+])\s+(.+)$/)
      if (listMatch && listMatch[1]) {
        const description = listMatch[1].trim()
        
        // Heuristic: if description starts with action verbs, might be a TODO
        const actionVerbs = ['create', 'add', 'implement', 'fix', 'update', 'refactor', 'remove', 'change']
        const startsWithVerb = actionVerbs.some(verb => 
          description.toLowerCase().startsWith(verb + ' ')
        )

        if (startsWithVerb && description.length < 200) {
          todos.push(this.createTodo(
            description,
            TodoStatus.Pending,
            sessionId,
            messageId,
            todoIndex++
          ))
        }
      }
    }

    return {
      todos,
      extractedAt: Date.now(),
      source: text.substring(0, 200), // Store first 200 chars for context
    }
  }

  /**
   * Update existing TODOs from text (mark completed, add new ones)
   */
  updateTodos(
    existingTodos: Todo[],
    text: string,
    sessionId?: string,
    messageId?: string
  ): { todos: Todo[]; added: Todo[]; completed: Todo[] } {
    const extraction = this.extractTodos(text, sessionId, messageId)
    const added: Todo[] = []
    const completed: Todo[] = []
    const updatedTodos = [...existingTodos]

    // Check each extracted TODO
    for (const extractedTodo of extraction.todos) {
      // Try to find matching existing TODO
      const existingIndex = updatedTodos.findIndex(todo =>
        this.todosMatch(todo, extractedTodo)
      )

      if (existingIndex === -1) {
        // New TODO
        updatedTodos.push(extractedTodo)
        added.push(extractedTodo)
      } else {
        // Update existing TODO
        const existing = updatedTodos[existingIndex]
        if (!existing) continue
        
        // If extracted is completed but existing is not, mark as completed
        if (extractedTodo.status === TodoStatus.Completed && existing.status !== TodoStatus.Completed) {
          existing.status = TodoStatus.Completed
          existing.completedAt = Date.now()
          existing.updatedAt = Date.now()
          completed.push(existing)
        } else if (extractedTodo.status === TodoStatus.Pending && existing.status === TodoStatus.Completed) {
          // If extracted is pending but existing is completed, might be uncompletion
          // This is less common, but we'll update the text
          existing.text = extractedTodo.text
          existing.updatedAt = Date.now()
        } else {
          // Just update text if different
          if (existing.text !== extractedTodo.text) {
            existing.text = extractedTodo.text
            existing.updatedAt = Date.now()
          }
        }
      }
    }

    return {
      todos: updatedTodos,
      added,
      completed,
    }
  }

  /**
   * Check if two TODOs match (similar text)
   */
  private todosMatch(todo1: Todo, todo2: Todo): boolean {
    const text1 = todo1.text.toLowerCase().trim()
    const text2 = todo2.text.toLowerCase().trim()

    // Exact match
    if (text1 === text2) {
      return true
    }

    // Check if one is contained in the other (with some threshold)
    const similarity = this.calculateSimilarity(text1, text2)
    return similarity > 0.7 // 70% similarity threshold
  }

  /**
   * Calculate similarity between two strings (simple Jaccard similarity)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const words1 = new Set(str1.split(/\s+/))
    const words2 = new Set(str2.split(/\s+/))

    const intersection = new Set([...words1].filter(w => words2.has(w)))
    const union = new Set([...words1, ...words2])

    return intersection.size / union.size
  }

  /**
   * Create a TODO object
   */
  private createTodo(
    text: string,
    status: TodoStatus,
    sessionId?: string,
    messageId?: string,
    index: number = 0
  ): Todo {
    const now = Date.now()
    
    return {
      id: `todo_${sessionId || 'global'}_${Date.now()}_${index}`,
      text: text.trim(),
      status,
      createdAt: now,
      updatedAt: now,
      completedAt: status === TodoStatus.Completed ? now : undefined,
      sessionId,
      messageId,
    }
  }
}
