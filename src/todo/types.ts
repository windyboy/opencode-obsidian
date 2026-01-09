export enum TodoStatus {
  Pending = 'pending',
  InProgress = 'in-progress',
  Completed = 'completed',
  Cancelled = 'cancelled',
}

export interface Todo {
  id: string
  text: string
  status: TodoStatus
  createdAt: number
  updatedAt: number
  completedAt?: number
  cancelledAt?: number
  sessionId?: string
  messageId?: string
  metadata?: {
    priority?: 'low' | 'medium' | 'high'
    tags?: string[]
    [key: string]: unknown
  }
}

export interface TodoExtractionResult {
  todos: Todo[]
  extractedAt: number
  source: string
}
