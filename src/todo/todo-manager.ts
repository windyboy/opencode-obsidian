import { TodoItem, TodoListConfig, TodoStateChangeEvent, TodoListState, TodoListStateChangeEvent, TodoPriority, TodoStatus, TodoCategory, TodoError } from './types';
import { ErrorHandler, ErrorSeverity } from '../utils/error-handler';

/**
 * 待办事项管理器
 */
export class TodoManager {
  private items: TodoItem[] = [];
  private categories: TodoCategory[] = [];
  private state: TodoListState = 'idle';
  private config: TodoListConfig;
  private errorHandler: ErrorHandler;
  private itemListeners: Array<(event: TodoStateChangeEvent) => void> = [];
  private stateListeners: Array<(event: TodoListStateChangeEvent) => void> = [];

  constructor(
    config: TodoListConfig = {},
    errorHandler: ErrorHandler
  ) {
    this.config = {
      autoSave: true,
      defaultPriority: 'medium',
      defaultStatus: 'pending',
      showCompleted: true,
      ...config
    };
    this.errorHandler = errorHandler;

    this.errorHandler.handleError(
      new Error(`TodoManager initialized with config: ${JSON.stringify(this.config)}`),
      { module: 'TodoManager', function: 'constructor' },
      ErrorSeverity.Info
    );
  }

  /**
   * 设置待办事项列表状态
   */
  private setState(newState: TodoListState, error?: TodoError): void {
    const oldState = this.state;
    this.state = newState;

    if (oldState !== newState) {
      this.notifyStateChange({ state: newState, error, timestamp: Date.now() });
    }
  }

  /**
   * 通知待办事项状态变化
   */
  private notifyItemChange(event: TodoStateChangeEvent): void {
    this.errorHandler.handleError(
      new Error(`Todo state changed: ${event.type} - ${event.item.id}`),
      { module: 'TodoManager', function: 'notifyItemChange' },
      ErrorSeverity.Info
    );

    for (const listener of this.itemListeners) {
      try {
        listener(event);
      } catch (error) {
        this.errorHandler.handleError(
          error,
          { module: 'TodoManager', function: 'notifyItemChange.listener' },
          ErrorSeverity.Warning
        );
      }
    }
  }

  /**
   * 通知待办事项列表状态变化
   */
  private notifyStateChange(event: TodoListStateChangeEvent): void {
    this.errorHandler.handleError(
      new Error(`Todo list state changed: ${event.state}`),
      { module: 'TodoManager', function: 'notifyStateChange' },
      ErrorSeverity.Info
    );

    for (const listener of this.stateListeners) {
      try {
        listener(event);
      } catch (error) {
        this.errorHandler.handleError(
          error,
          { module: 'TodoManager', function: 'notifyStateChange.listener' },
          ErrorSeverity.Warning
        );
      }
    }
  }

  /**
   * 创建待办事项
   */
  createTodo(
    data: Omit<TodoItem, 'id' | 'createdAt' | 'updatedAt'>
  ): TodoItem {
    this.setState('saving');

    try {
      const newTodo: TodoItem = {
        id: `todo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        priority: data.priority ?? this.config.defaultPriority,
        status: data.status ?? this.config.defaultStatus,
        title: data.title,
        description: data.description,
        categoryId: data.categoryId,
        dueDate: data.dueDate
      };

      this.items.push(newTodo);

      this.notifyItemChange({
        type: 'created',
        item: newTodo,
        timestamp: Date.now()
      });

      this.setState('idle');
      return newTodo;
    } catch (error) {
      this.setState('error', {
        message: 'Failed to create todo',
        originalError: error
      });
      throw error;
    }
  }

  /**
   * 获取待办事项列表
   */
  getTodos(options?: {
    status?: TodoStatus;
    priority?: TodoPriority;
    categoryId?: string;
    showCompleted?: boolean;
  }): TodoItem[] {
    let filtered = [...this.items];

    if (options) {
      if (options.status) {
        filtered = filtered.filter(item => item.status === options.status);
      }

      if (options.priority) {
        filtered = filtered.filter(item => item.priority === options.priority);
      }

      if (options.categoryId) {
        filtered = filtered.filter(item => item.categoryId === options.categoryId);
      }

      if (options.showCompleted === false) {
        filtered = filtered.filter(item => item.status !== 'completed');
      } else if (options.showCompleted === undefined && !this.config.showCompleted) {
        filtered = filtered.filter(item => item.status !== 'completed');
      }
    }

    // 按优先级和创建时间排序
    return filtered.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.createdAt - a.createdAt;
    });
  }

  /**
   * 获取单个待办事项
   */
  getTodoById(id: string): TodoItem | undefined {
    return this.items.find(item => item.id === id);
  }

  /**
   * 更新待办事项
   */
  updateTodo(
    id: string,
    updates: Partial<Omit<TodoItem, 'id' | 'createdAt' | 'updatedAt'>>
  ): TodoItem | undefined {
    this.setState('saving');

    try {
      const index = this.items.findIndex(item => item.id === id);
      if (index === -1) {
        this.setState('idle');
        return undefined;
      }

      const item = this.items[index];
      if (!item) {
        this.setState('idle');
        return undefined;
      }

      const previousState = { ...item };
      const updatedItem: TodoItem = {
        ...item,
        ...updates,
        updatedAt: Date.now(),
        id: item.id,
        createdAt: item.createdAt,
        title: updates.title ?? item.title,
        status: updates.status ?? item.status,
        priority: updates.priority ?? item.priority,
        description: updates.description ?? item.description,
        categoryId: updates.categoryId ?? item.categoryId,
        dueDate: updates.dueDate ?? item.dueDate
      };

      // 如果状态变为completed，记录完成时间
      if (updates.status === 'completed' && item.status !== 'completed') {
        updatedItem.completedAt = Date.now();
      }

      // 如果状态从completed变为其他，清除完成时间
      if (updates.status !== undefined && updates.status !== 'completed' && item.status === 'completed') {
        updatedItem.completedAt = undefined;
      }

      this.items[index] = updatedItem;

      // 确定事件类型
      let eventType: TodoStateChangeEvent['type'] = 'updated';
      if (updates.status !== undefined && updates.status !== item.status) {
        eventType = 'status_changed';
      } else if (updates.priority !== undefined && updates.priority !== item.priority) {
        eventType = 'priority_changed';
      } else if (updates.categoryId !== undefined && updates.categoryId !== item.categoryId) {
        eventType = 'category_changed';
      }

      this.notifyItemChange({
        type: eventType,
        item: updatedItem,
        previousState,
        timestamp: Date.now()
      });

      this.setState('idle');
      return updatedItem;
    } catch (error) {
      this.setState('error', {
        message: 'Failed to update todo',
        originalError: error
      });
      throw error;
    }
  }

  /**
   * 删除待办事项
   */
  deleteTodo(id: string): boolean {
    this.setState('saving');

    try {
      const index = this.items.findIndex(item => item.id === id);
      if (index === -1) {
        this.setState('idle');
        return false;
      }

      const item = this.items[index];
      this.items.splice(index, 1);

      this.notifyItemChange({
        type: 'deleted',
        item: item as TodoItem,
        timestamp: Date.now()
      });

      this.setState('idle');
      return true;
    } catch (error) {
      this.setState('error', {
        message: 'Failed to delete todo',
        originalError: error
      });
      throw error;
    }
  }

  /**
   * 标记待办事项为完成
   */
  completeTodo(id: string): TodoItem | undefined {
    return this.updateTodo(id, { status: 'completed' });
  }

  /**
   * 标记待办事项为进行中
   */
  startTodo(id: string): TodoItem | undefined {
    return this.updateTodo(id, { status: 'in_progress' });
  }

  /**
   * 取消待办事项
   */
  cancelTodo(id: string): TodoItem | undefined {
    return this.updateTodo(id, { status: 'cancelled' });
  }

  /**
   * 更新待办事项优先级
   */
  updateTodoPriority(id: string, priority: TodoPriority): TodoItem | undefined {
    return this.updateTodo(id, { priority });
  }

  /**
   * 更新待办事项分类
   */
  updateTodoCategory(id: string, categoryId?: string): TodoItem | undefined {
    return this.updateTodo(id, { categoryId });
  }

  /**
   * 创建分类
   */
  createCategory(name: string, color?: string): TodoCategory {
    this.setState('saving');

    try {
      const category: TodoCategory = {
        id: `category-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name,
        color,
        createdAt: Date.now()
      };

      this.categories.push(category);
      this.setState('idle');
      return category;
    } catch (error) {
      this.setState('error', {
        message: 'Failed to create category',
        originalError: error
      });
      throw error;
    }
  }

  /**
   * 获取所有分类
   */
  getCategories(): TodoCategory[] {
    return [...this.categories].sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * 获取分类
   */
  getCategoryById(id: string): TodoCategory | undefined {
    return this.categories.find(category => category.id === id);
  }

  /**
   * 更新分类
   */
  updateCategory(id: string, updates: Partial<Omit<TodoCategory, 'id' | 'createdAt'>>): TodoCategory | undefined {
    this.setState('saving');

    try {
      const index = this.categories.findIndex(category => category.id === id);
      if (index === -1) {
        this.setState('idle');
        return undefined;
      }

      const originalCategory = this.categories[index];
      if (!originalCategory) {
        this.setState('idle');
        return undefined;
      }

      const updatedCategory: TodoCategory = {
        ...originalCategory,
        ...updates,
        id: originalCategory.id,
        createdAt: originalCategory.createdAt,
        name: updates.name ?? originalCategory.name,
        color: updates.color ?? originalCategory.color
      };
      this.categories[index] = updatedCategory;
      this.setState('idle');
      return updatedCategory;
    } catch (error) {
      this.setState('error', {
        message: 'Failed to update category',
        originalError: error
      });
      throw error;
    }
  }

  /**
   * 删除分类
   */
  deleteCategory(id: string): boolean {
    this.setState('saving');

    try {
      const index = this.categories.findIndex(category => category.id === id);
      if (index === -1) {
        this.setState('idle');
        return false;
      }

      this.categories.splice(index, 1);

      // 清除该分类下的所有待办事项的分类ID
      for (const item of this.items) {
        if (item.categoryId === id) {
          this.updateTodo(item.id, { categoryId: undefined });
        }
      }

      this.setState('idle');
      return true;
    } catch (error) {
      this.setState('error', {
        message: 'Failed to delete category',
        originalError: error
      });
      throw error;
    }
  }

  /**
   * 注册待办事项变化监听器
   */
  onTodoChange(listener: (event: TodoStateChangeEvent) => void): () => void {
    this.itemListeners.push(listener);
    return () => {
      this.itemListeners = this.itemListeners.filter(l => l !== listener);
    };
  }

  /**
   * 注册待办事项列表状态变化监听器
   */
  onStateChange(listener: (event: TodoListStateChangeEvent) => void): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter(l => l !== listener);
    };
  }

  /**
   * 获取待办事项列表状态
   */
  getState(): TodoListState {
    return this.state;
  }

  /**
   * 清空所有待办事项
   */
  clearAllTodos(options?: {
    status?: TodoStatus;
    keepCompleted?: boolean;
  }): number {
    this.setState('saving');

    try {
      let count = 0;

      if (options) {
        if (options.status) {
          count = this.items.filter(item => item.status === options.status).length;
          this.items = this.items.filter(item => item.status !== options.status);
        } else if (options.keepCompleted) {
          count = this.items.filter(item => item.status !== 'completed').length;
          this.items = this.items.filter(item => item.status === 'completed');
        }
      } else {
        count = this.items.length;
        this.items = [];
      }

      this.setState('idle');
      return count;
    } catch (error) {
      this.setState('error', {
        message: 'Failed to clear todos',
        originalError: error
      });
      throw error;
    }
  }
}