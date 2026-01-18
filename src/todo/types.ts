/**
 * 待办事项优先级
 */
export type TodoPriority = "low" | "medium" | "high";

/**
 * 待办事项状态
 */
export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

/**
 * 待办事项分类
 */
export interface TodoCategory {
  id: string;
  name: string;
  color?: string;
  createdAt: number;
}

/**
 * 待办事项数据模型
 */
export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  priority: TodoPriority;
  status: TodoStatus;
  categoryId?: string;
  dueDate?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

/**
 * 待办事项列表配置
 */
export interface TodoListConfig {
  autoSave?: boolean;
  defaultPriority?: TodoPriority;
  defaultStatus?: TodoStatus;
  showCompleted?: boolean;
}

/**
 * 待办事项状态变化事件
 */
export interface TodoStateChangeEvent {
  type: "created" | "updated" | "deleted" | "status_changed" | "priority_changed" | "category_changed";
  item: TodoItem;
  previousState?: Partial<TodoItem>;
  timestamp: number;
}

/**
 * 待办事项列表状态
 */
export type TodoListState = "idle" | "loading" | "saving" | "error";

/**
 * 待办事项列表错误信息
 */
export interface TodoError {
  message: string;
  code?: string;
  originalError?: unknown;
}

/**
 * 待办事项列表状态变化事件
 */
export interface TodoListStateChangeEvent {
  state: TodoListState;
  error?: TodoError;
  timestamp: number;
}
