import type OpenCodeObsidianPlugin from "../main";
import { empty } from "../utils/dom-helpers";
import { TodoManager } from "./todo-manager";
import { TodoItem, TodoPriority, TodoStatus } from "./types";

export class TodoListComponent {
  constructor(
    private plugin: OpenCodeObsidianPlugin,
    private todoManager: TodoManager
  ) {}

  render(container: HTMLElement): void {
    empty(container);

    // 创建主容器
    const todoContainer = container.createDiv("opencode-obsidian-todo-container");

    // 创建头部
    const header = todoContainer.createDiv("opencode-obsidian-todo-header");
    header.createEl("h2", { text: "Todo List" });

    // 创建添加新待办事项的表单
    const addForm = todoContainer.createDiv("opencode-obsidian-todo-add-form");
    this.renderAddForm(addForm);

    // 创建筛选和排序控制
    const controls = todoContainer.createDiv("opencode-obsidian-todo-controls");
    this.renderControls(controls);

    // 创建待办事项列表
    const list = todoContainer.createDiv("opencode-obsidian-todo-list");
    this.renderTodoList(list);

    // 创建分类管理区域
    const categories = todoContainer.createDiv("opencode-obsidian-todo-categories");
    this.renderCategories(categories);

    // 监听待办事项变化，自动更新列表
    this.todoManager.onTodoChange(() => {
      this.renderTodoList(list);
    });
  }

  private renderAddForm(container: HTMLElement): void {
    const form = container.createEl("form", { cls: "opencode-obsidian-todo-form" });

    // 标题输入框
    const titleInput = form.createEl("input", {
      type: "text",
      placeholder: "Enter task title...",
      cls: "opencode-obsidian-todo-input"
    });

    // 优先级选择
    const prioritySelect = form.createEl("select", {
      cls: "opencode-obsidian-todo-select"
    });
    ["low", "medium", "high"].forEach(priority => {
      const option = prioritySelect.createEl("option", {
        value: priority,
        text: priority.charAt(0).toUpperCase() + priority.slice(1)
      });
      if (priority === "medium") {
        option.selected = true;
      }
    });

    // 分类选择
    const categorySelect = form.createEl("select", {
      cls: "opencode-obsidian-todo-select"
    });
    categorySelect.createEl("option", { value: "", text: "No category" });
    this.todoManager.getCategories().forEach(category => {
      categorySelect.createEl("option", {
        value: category.id,
        text: category.name
      });
    });

    // 提交按钮
    const submitBtn = form.createEl("button", {
      type: "submit",
      text: "Add Task",
      cls: "mod-cta opencode-obsidian-todo-button"
    });

    // 处理表单提交
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      
      const title = titleInput.value.trim();
      if (title) {
        this.todoManager.createTodo({
          title,
          priority: prioritySelect.value as TodoPriority,
          status: "pending",
          categoryId: categorySelect.value || undefined
        });
        
        // 清空输入
        titleInput.value = "";
      }
    });
  }

  private renderControls(container: HTMLElement): void {
    const filterGroup = container.createDiv("opencode-obsidian-todo-filter-group");

    // 状态筛选
    const statusFilter = filterGroup.createEl("select", {
      cls: "opencode-obsidian-todo-select",
      attr: { title: "Filter by status" }
    });
    statusFilter.createEl("option", { value: "", text: "All statuses" });
    ["pending", "in_progress", "completed", "cancelled"].forEach(status => {
      statusFilter.createEl("option", {
        value: status,
        text: status.split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
      });
    });

    // 优先级筛选
    const priorityFilter = filterGroup.createEl("select", {
      cls: "opencode-obsidian-todo-select",
      attr: { title: "Filter by priority" }
    });
    priorityFilter.createEl("option", { value: "", text: "All priorities" });
    ["low", "medium", "high"].forEach(priority => {
      priorityFilter.createEl("option", {
        value: priority,
        text: priority.charAt(0).toUpperCase() + priority.slice(1)
      });
    });

    // 显示已完成任务的开关
    const showCompletedGroup = filterGroup.createDiv("opencode-obsidian-todo-checkbox-group");
    const showCompletedCheckbox = showCompletedGroup.createEl("input", {
      type: "checkbox",
      cls: "opencode-obsidian-todo-checkbox"
    });
    showCompletedCheckbox.checked = true;
    const showCompletedLabel = showCompletedGroup.createEl("label", {
      text: "Show completed"
    });
    showCompletedLabel.insertBefore(showCompletedCheckbox, showCompletedLabel.firstChild);

    // 处理筛选变化
    const handleFilterChange = () => {
      // 更新列表显示
      const listContainer = container.parentElement?.querySelector(".opencode-obsidian-todo-list");
      if (listContainer) {
        this.renderTodoList(listContainer as HTMLElement);
      }
    };

    statusFilter.addEventListener("change", handleFilterChange);
    priorityFilter.addEventListener("change", handleFilterChange);
    showCompletedCheckbox.addEventListener("change", handleFilterChange);
  }

  private renderTodoList(container: HTMLElement): void {
    empty(container);

    // 获取当前筛选条件
    const statusFilter = container.parentElement?.querySelector(".opencode-obsidian-todo-select") as HTMLSelectElement;
    const priorityFilter = statusFilter?.nextElementSibling as HTMLSelectElement;
    const showCompletedCheckbox = container.parentElement?.querySelector(".opencode-obsidian-todo-checkbox") as HTMLInputElement;

    // 获取筛选后的待办事项
    const todos = this.todoManager.getTodos({
      status: statusFilter?.value as TodoStatus || undefined,
      priority: priorityFilter?.value as TodoPriority || undefined,
      showCompleted: showCompletedCheckbox?.checked
    });

    if (todos.length === 0) {
      const emptyMessage = container.createDiv("opencode-obsidian-todo-empty");
      emptyMessage.textContent = "No tasks found. Add a new task to get started!";
      return;
    }

    // 创建待办事项列表
    todos.forEach(todo => {
      const itemContainer = container.createDiv("opencode-obsidian-todo-item");
      itemContainer.addClass(`priority-${todo.priority}`);
      itemContainer.addClass(`status-${todo.status}`);

      // 状态切换按钮
      const statusBtn = itemContainer.createEl("button", {
        cls: "opencode-obsidian-todo-status-btn",
        text: this.getStatusIcon(todo.status),
        attr: { title: this.getStatusText(todo.status) }
      });
      statusBtn.addEventListener("click", () => {
        this.toggleTodoStatus(todo);
      });

      // 任务内容
      const content = itemContainer.createDiv("opencode-obsidian-todo-content");
      const title = content.createEl("div", {
        text: todo.title,
        cls: "opencode-obsidian-todo-title"
      });
      if (todo.description) {
        content.createEl("div", {
          text: todo.description,
          cls: "opencode-obsidian-todo-description"
        });
      }

      // 元数据
      const meta = content.createDiv("opencode-obsidian-todo-meta");
      meta.createEl("span", {
        text: todo.priority.charAt(0).toUpperCase() + todo.priority.slice(1),
        cls: `opencode-obsidian-todo-priority priority-${todo.priority}`
      });
      if (todo.categoryId) {
        const category = this.todoManager.getCategoryById(todo.categoryId);
        if (category) {
          const categorySpan = meta.createEl("span", {
            text: category.name,
            cls: "opencode-obsidian-todo-category"
          });
          if (category.color) {
            categorySpan.style.backgroundColor = category.color;
          }
        }
      }
      if (todo.dueDate) {
        const dueDate = new Date(todo.dueDate);
        meta.createEl("span", {
          text: `Due: ${dueDate.toLocaleDateString()}`,
          cls: "opencode-obsidian-todo-due-date"
        });
      }

      // 操作按钮
      const actions = itemContainer.createDiv("opencode-obsidian-todo-actions");
      
      // 编辑按钮
      const editBtn = actions.createEl("button", {
        text: "✏️",
        cls: "mod-small opencode-obsidian-todo-action-btn",
        attr: { title: "Edit" }
      });
      editBtn.addEventListener("click", () => {
        this.editTodo(todo, content);
      });

      // 删除按钮
      const deleteBtn = actions.createEl("button", {
        text: "🗑️",
        cls: "mod-small opencode-obsidian-todo-action-btn",
        attr: { title: "Delete" }
      });
      deleteBtn.addEventListener("click", () => {
        if (confirm(`Are you sure you want to delete "${todo.title}"?`)) {
          this.todoManager.deleteTodo(todo.id);
        }
      });
    });
  }

  private renderCategories(container: HTMLElement): void {
    const header = container.createEl("h3", { text: "Categories" });
    const categoryList = container.createDiv("opencode-obsidian-todo-category-list");

    // 获取所有分类
    const categories = this.todoManager.getCategories();

    categories.forEach(category => {
      const categoryItem = categoryList.createDiv("opencode-obsidian-todo-category-item");
      if (category.color) {
        const colorDot = categoryItem.createEl("span", {
          cls: "opencode-obsidian-category-color"
        });
        colorDot.style.backgroundColor = category.color;
      }
      categoryItem.createEl("span", {
        text: category.name,
        cls: "opencode-obsidian-category-name"
      });

      // 删除分类按钮
      const deleteBtn = categoryItem.createEl("button", {
        text: "×",
        cls: "mod-small opencode-obsidian-category-delete"
      });
      deleteBtn.addEventListener("click", () => {
        if (confirm(`Are you sure you want to delete category "${category.name}"?`)) {
          this.todoManager.deleteCategory(category.id);
        }
      });
    });

    // 添加新分类的表单
    const addCategoryForm = container.createEl("form", {
      cls: "opencode-obsidian-add-category-form"
    });
    const nameInput = addCategoryForm.createEl("input", {
      type: "text",
      placeholder: "New category name",
      cls: "opencode-obsidian-todo-input"
    });
    const colorInput = addCategoryForm.createEl("input", {
      type: "color",
      cls: "opencode-obsidian-category-color-input"
    });
    const addBtn = addCategoryForm.createEl("button", {
      type: "submit",
      text: "Add",
      cls: "mod-small opencode-obsidian-todo-button"
    });

    addCategoryForm.addEventListener("submit", (e: Event) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (name) {
        this.todoManager.createCategory(name, colorInput.value);
        nameInput.value = "";
        // 重新渲染分类列表
        this.renderCategories(container);
      }
    });
  }

  private toggleTodoStatus(todo: TodoItem): void {
    let newStatus: TodoStatus;
    switch (todo.status) {
      case "pending":
        newStatus = "in_progress";
        break;
      case "in_progress":
        newStatus = "completed";
        break;
      case "completed":
        newStatus = "pending";
        break;
      case "cancelled":
        newStatus = "pending";
        break;
      default:
        newStatus = "pending";
    }
    this.todoManager.updateTodo(todo.id, { status: newStatus });
  }

  private editTodo(todo: TodoItem, contentContainer: HTMLElement): void {
    // 保存原始内容
    const originalContent = contentContainer.innerHTML;

    // 创建编辑表单
    empty(contentContainer);
    const editForm = contentContainer.createEl("form", {
      cls: "opencode-obsidian-todo-edit-form"
    });

    const titleInput = editForm.createEl("input", {
      type: "text",
      value: todo.title,
      cls: "opencode-obsidian-todo-input"
    });

    const descInput = editForm.createEl("textarea", {
      value: todo.description || "",
      placeholder: "Task description",
      cls: "opencode-obsidian-todo-textarea"
    });

    const prioritySelect = editForm.createEl("select", {
      cls: "opencode-obsidian-todo-select"
    });
    ["low", "medium", "high"].forEach(priority => {
      const option = prioritySelect.createEl("option", {
        value: priority,
        text: priority.charAt(0).toUpperCase() + priority.slice(1)
      });
      if (priority === todo.priority) {
        option.selected = true;
      }
    });

    const submitBtn = editForm.createEl("button", {
      type: "submit",
      text: "Save",
      cls: "mod-small opencode-obsidian-todo-button"
    });

    const cancelBtn = editForm.createEl("button", {
      type: "button",
      text: "Cancel",
      cls: "mod-small opencode-obsidian-todo-button"
    });

    editForm.addEventListener("submit", (e) => {
      e.preventDefault();
      this.todoManager.updateTodo(todo.id, {
        title: titleInput.value.trim(),
        description: descInput.value.trim() || undefined,
        priority: prioritySelect.value as TodoPriority
      });
    });

    cancelBtn.addEventListener("click", () => {
      contentContainer.innerHTML = originalContent;
    });
  }

  private getStatusIcon(status: TodoStatus): string {
    switch (status) {
      case "pending":
        return "○";
      case "in_progress":
        return "⏳";
      case "completed":
        return "✅";
      case "cancelled":
        return "❌";
      default:
        return "○";
    }
  }

  private getStatusText(status: TodoStatus): string {
    switch (status) {
      case "pending":
        return "Mark as in progress";
      case "in_progress":
        return "Mark as completed";
      case "completed":
        return "Mark as pending";
      case "cancelled":
        return "Mark as pending";
      default:
        return "Toggle status";
    }
  }
}