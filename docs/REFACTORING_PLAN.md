# OpenCode Obsidian 重构计划
## 基于代码审核报告的修正方案

**文档版本**: 1.0
**创建日期**: 2026-01-19
**基于**: CODE_REVIEW_AUDIT.md

---

## 概述

本文档提供了基于代码审核报告的详细重构计划。计划按优先级分为三个阶段：

- **阶段 1 (高优先级)**: 测试覆盖和代码重复消除
- **阶段 2 (中优先级)**: 代码结构优化
- **阶段 3 (低优先级)**: 代码风格和文档完善

**预计总工作量**: 约 3-4 周
**建议执行顺序**: 按阶段顺序执行，每个阶段完成后进行验收

---

## 阶段 1: 高优先级修正 (Week 1-2)

### 任务 1.1: 添加 ConnectionHandler 测试

**优先级**: 🔴 高
**预计工作量**: 3-4 天
**负责模块**: `src/client/connection-handler.ts`

#### 问题描述

ConnectionHandler (411 行) 是客户端连接管理的核心模块，但目前没有单元测试。该模块负责：
- 连接生命周期管理
- 重连逻辑
- 健康检查
- 状态管理

缺少测试会导致重构时引入 bug 的风险。

#### 修正目标

为 ConnectionHandler 添加完整的单元测试，覆盖率达到 80%+。

#### 具体步骤

**步骤 1: 创建测试文件**
```bash
touch src/client/connection-handler.test.ts
```

**步骤 2: 设置测试环境**
```typescript
// src/client/connection-handler.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConnectionHandler } from './connection-handler';
import { ErrorHandler } from '../utils/error-handler';

describe('ConnectionHandler', () => {
    let handler: ConnectionHandler;
    let mockErrorHandler: ErrorHandler;
    let mockConfig: OpenCodeServerConfig;

    beforeEach(() => {
        mockErrorHandler = {
            handleError: vi.fn()
        } as any;

        mockConfig = {
            url: 'http://localhost:4096',
            requestTimeoutMs: 10000
        };

        handler = new ConnectionHandler(mockConfig, mockErrorHandler);
    });
});
```

**步骤 3: 编写核心测试用例**

测试用例清单：
- [ ] 连接成功场景
- [ ] 连接失败场景
- [ ] 重连逻辑（最大重试次数）
- [ ] 健康检查成功/失败
- [ ] 状态转换（disconnected → connecting → connected）
- [ ] 断开连接清理
- [ ] 错误处理和日志记录

**步骤 4: 运行测试并修复**
```bash
bun vitest run src/client/connection-handler.test.ts
```

#### 预期结果

- ✅ 测试文件创建完成
- ✅ 测试覆盖率 ≥ 80%
- ✅ 所有测试通过
- ✅ 关键路径都有测试覆盖

#### 验收标准

```bash
# 运行测试
bun vitest run src/client/connection-handler.test.ts

# 检查覆盖率
bun vitest run --coverage src/client/connection-handler.ts

# 预期结果:
# - 测试通过率: 100%
# - 代码覆盖率: ≥ 80%
# - 分支覆盖率: ≥ 70%
```

---

### 任务 1.2: 添加 StreamHandler 测试

**优先级**: 🔴 高
**预计工作量**: 3-4 天
**负责模块**: `src/client/stream-handler.ts`

#### 问题描述

StreamHandler (538 行) 负责 SSE 事件流处理，是实时通信的核心，但目前没有测试。

#### 修正目标

为 StreamHandler 添加完整的单元测试，覆盖率达到 80%+。

#### 具体步骤

**步骤 1: 创建测试文件**
```bash
touch src/client/stream-handler.test.ts
```

**步骤 2: Mock SSE 事件流**
```typescript
// src/client/stream-handler.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StreamHandler } from './stream-handler';

describe('StreamHandler', () => {
    let handler: StreamHandler;

    // Mock SSE event generator
    async function* mockEventStream(events: any[]) {
        for (const event of events) {
            yield event;
        }
    }

    beforeEach(() => {
        handler = new StreamHandler(mockSessionOps, mockErrorHandler);
    });
});
```

**步骤 3: 编写核心测试用例**

测试用例清单：
- [ ] stream.token 事件处理
- [ ] stream.thinking 事件处理
- [ ] progress.update 事件处理
- [ ] permission.request 事件处理
- [ ] session.end 事件处理
- [ ] 事件回调触发
- [ ] 错误事件处理
- [ ] 格式错误的事件处理（验证逻辑）

**步骤 4: 测试事件总线集成**
```typescript
it('should emit events to event bus', async () => {
    const mockEventBus = {
        emitStreamToken: vi.fn(),
        emitStreamThinking: vi.fn()
    };

    handler.setEventBus(mockEventBus);

    // 模拟事件流
    await handler.processEventStream(mockEventStream([
        { type: 'stream.token', data: { token: 'hello' } }
    ]));

    expect(mockEventBus.emitStreamToken).toHaveBeenCalledWith({
        sessionId: expect.any(String),
        token: 'hello',
        done: false
    });
});
```

#### 预期结果

- ✅ 测试文件创建完成
- ✅ 测试覆盖率 ≥ 80%
- ✅ 所有事件类型都有测试
- ✅ 事件总线集成测试通过

#### 验收标准

```bash
bun vitest run src/client/stream-handler.test.ts
# 预期: 测试通过率 100%, 覆盖率 ≥ 80%
```

---

### 任务 1.3: 提取 RetryHelper 工具类

**优先级**: 🔴 高
**预计工作量**: 2-3 天
**影响模块**: `src/views/services/session-manager.ts`, `src/client/session-operations.ts`

#### 问题描述

SessionManager 中存在 6 个 WithRetry 方法，代码重复严重：
- `listSessionsWithRetry()`
- `createSessionWithRetry()`
- `loadSessionMessagesWithRetry()`
- `updateSessionTitleWithRetry()`
- `deleteSessionWithRetry()`
- `forkSessionWithRetry()`

每个方法都包含相同的重试逻辑模式。

#### 修正目标

1. 创建通用的 RetryHelper 工具类
2. 消除 SessionManager 中的 WithRetry 方法重复
3. 统一项目中的重试逻辑

#### 具体步骤

**步骤 1: 创建 RetryHelper 工具类**

```typescript
// src/utils/retry-helper.ts
export interface RetryConfig {
    maxAttempts: number;
    delayMs: number;
    backoffMultiplier: number;
    retryableErrors?: (error: Error) => boolean;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxAttempts: 3,
    delayMs: 1000,
    backoffMultiplier: 2,
};

export class RetryHelper {
    /**
     * 执行操作并在失败时重试
     * @param operation 要执行的异步操作
     * @param config 重试配置
     * @returns 操作结果
     * @throws 最后一次失败的错误
     */
    static async withRetry<T>(
        operation: () => Promise<T>,
        config: Partial<RetryConfig> = {}
    ): Promise<T> {
        const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
        let lastError: Error | null = null;
        let delay = finalConfig.delayMs;

        for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                // 检查是否应该重试
                const shouldRetry = finalConfig.retryableErrors
                    ? finalConfig.retryableErrors(lastError)
                    : true;

                if (!shouldRetry || attempt === finalConfig.maxAttempts) {
                    throw lastError;
                }

                // 等待后重试
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= finalConfig.backoffMultiplier;
            }
        }

        throw lastError!;
    }
}
```

**步骤 2: 创建测试文件**

```typescript
// src/utils/retry-helper.test.ts
import { describe, it, expect, vi } from 'vitest';
import { RetryHelper } from './retry-helper';

describe('RetryHelper', () => {
    it('should succeed on first attempt', async () => {
        const operation = vi.fn().mockResolvedValue('success');
        const result = await RetryHelper.withRetry(operation);

        expect(result).toBe('success');
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and succeed', async () => {
        const operation = vi.fn()
            .mockRejectedValueOnce(new Error('fail'))
            .mockResolvedValueOnce('success');

        const result = await RetryHelper.withRetry(operation, { maxAttempts: 2 });

        expect(result).toBe('success');
        expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should throw after max attempts', async () => {
        const operation = vi.fn().mockRejectedValue(new Error('fail'));

        await expect(
            RetryHelper.withRetry(operation, { maxAttempts: 3 })
        ).rejects.toThrow('fail');

        expect(operation).toHaveBeenCalledTimes(3);
    });
});
```

**步骤 3: 重构 SessionManager**

```typescript
// src/views/services/session-manager.ts
import { RetryHelper } from '../../utils/retry-helper';

export class SessionManager {
    // 删除所有 WithRetry 方法，直接在调用处使用 RetryHelper

    async listSessions(forceRefresh: boolean = false): Promise<SessionListItem[]> {
        return RetryHelper.withRetry(
            () => this.doListSessions(forceRefresh),
            { maxAttempts: 3, delayMs: 1000 }
        );
    }

    async createSession(title?: string): Promise<string> {
        return RetryHelper.withRetry(
            () => this.doCreateSession(title),
            { maxAttempts: 3, delayMs: 1000 }
        );
    }

    // 其他方法类似...
}
```

**步骤 4: 更新调用方**

检查所有调用 WithRetry 方法的地方，更新为直接调用方法（因为重试逻辑已内置）。

#### 预期结果

- ✅ RetryHelper 工具类创建完成
- ✅ 测试覆盖率 100%
- ✅ SessionManager 代码减少约 60 行
- ✅ 重试逻辑统一且可配置

#### 验收标准

```bash
# 运行 RetryHelper 测试
bun vitest run src/utils/retry-helper.test.ts

# 运行 SessionManager 测试（确保重构后仍然通过）
bun vitest run src/views/services/session-manager.test.ts

# 检查代码行数减少
wc -l src/views/services/session-manager.ts
# 预期: 从 643 行减少到约 580 行

# 运行完整测试套件
bun vitest run
```

---

## 阶段 2: 中优先级修正 (Week 3)

### 任务 2.1: 重构 Main.ts 初始化逻辑

**优先级**: 🟡 中
**预计工作量**: 2-3 天
**负责模块**: `src/main.ts`

#### 问题描述

`onload()` 方法过长（243 行），承担过多职责：
1. 初始化错误处理器
2. 加载和迁移设置
3. 初始化工具系统
4. 初始化服务器
5. 初始化客户端
6. 初始化 TodoManager
7. 注册视图和命令
8. 服务器状态检查

#### 修正目标

将 `onload()` 拆分为多个独立方法，每个方法负责一个初始化阶段。

#### 具体步骤

**步骤 1: 创建初始化方法**

```typescript
// src/main.ts
export default class OpenCodeObsidianPlugin extends Plugin {
    async onload() {
        console.debug("[OpenCode Obsidian] Plugin loading...");

        try {
            await this.initializeCore();
            await this.initializeToolSystem();
            await this.initializeServerAndClient();
            await this.initializeTodoManager();
            this.registerUIComponents();
            await this.finalizeSetup();

            console.debug("[OpenCode Obsidian] Plugin loaded successfully ✓");
        } catch (error) {
            this.handleLoadError(error);
            throw error;
        }
    }

    /**
     * 初始化核心组件（错误处理器、设置）
     */
    private async initializeCore(): Promise<void> {
        // 初始化错误处理器
        this.errorHandler = new ErrorHandler({
            showUserNotifications: true,
            logToConsole: true,
            collectErrors: false,
            notificationCallback: (message: string, severity: ErrorSeverity) => {
                new Notice(message, severity === ErrorSeverity.Critical ? 10000 : 5000);
            },
        });
        console.debug("[OpenCode Obsidian] Error handler initialized");

        // 加载设置
        await this.loadSettings();
        this.migrateSettings();

        console.debug("[OpenCode Obsidian] Settings loaded:", {
            agent: this.settings.agent,
            opencodeServer: this.settings.opencodeServer?.url || "not configured",
            useEmbeddedServer: this.settings.opencodeServer?.useEmbeddedServer,
        });
    }

    /**
     * 初始化工具执行系统（权限管理、审计日志、工具注册）
     */
    private async initializeToolSystem(): Promise<void> {
        if (!this.app || !this.app.vault) {
            throw new Error("Obsidian app or vault not available");
        }

        this.permissionManager = new PermissionManager(
            this.app.vault,
            getPermissionLevel(this.settings.toolPermission),
            toPermissionScope(this.settings.permissionScope),
        );

        const auditLogger = new AuditLogger(this.app.vault);
        const toolExecutor = new ObsidianToolExecutor(
            this.app.vault,
            this.app,
            this.app.metadataCache,
            this.permissionManager,
            auditLogger,
        );

        this.toolRegistry = new ObsidianToolRegistry(toolExecutor, this.app);
        console.debug("[OpenCode Obsidian] Tool system initialized");
    }

    /**
     * 初始化服务器和客户端
     */
    private async initializeServerAndClient(): Promise<void> {
        const opencodeServer = this.settings.opencodeServer;
        if (!opencodeServer) {
            console.debug("[OpenCode Obsidian] No server configuration, skipping");
            return;
        }

        // 初始化服务器（如果使用内嵌服务器）
        try {
            this.serverManager = await ServerManager.initializeFromConfig(
                opencodeServer,
                this.errorHandler,
                (event) => this.handleServerStateChange(event),
                undefined
            );
        } catch (error) {
            this.errorHandler.handleError(
                error,
                {
                    module: "OpenCodeObsidianPlugin",
                    function: "initializeServerAndClient",
                    operation: "Server initialization",
                },
                ErrorSeverity.Warning,
            );
        }

        // 初始化客户端
        await this.initializeClient();
    }

    /**
     * 初始化 OpenCode 客户端
     */
    private async initializeClient(): Promise<void> {
        const opencodeServer = this.settings.opencodeServer;
        if (!opencodeServer) return;

        const useEmbeddedServer = opencodeServer.useEmbeddedServer;
        const hasServerUrl = opencodeServer.url;
        const embeddedServerReady = useEmbeddedServer &&
            this.serverManager &&
            this.serverManager.getState() === "running";
        const externalServerConfigured = !useEmbeddedServer && hasServerUrl;

        if ((embeddedServerReady || externalServerConfigured) && hasServerUrl) {
            const clientSetup = await initializeClient(
                opencodeServer,
                this.errorHandler,
                this.sessionEventBus,
                this.permissionManager,
                new AuditLogger(this.app.vault),
                this.app,
                async (agents: Agent[]) => {
                    const agentsChanged = JSON.stringify(this.settings.agents) !==
                        JSON.stringify(agents);
                    if (agentsChanged) {
                        this.settings.agents = agents;
                        await this.saveSettings();
                    }
                },
                () => this.getDefaultAgents()
            );

            if (clientSetup) {
                this.opencodeClient = clientSetup.client;
                this.connectionManager = clientSetup.connectionManager;
                this.permissionCoordinator = clientSetup.permissionCoordinator;
            }
        }
    }

    /**
     * 初始化 TodoManager
     */
    private async initializeTodoManager(): Promise<void> {
        try {
            this.todoManager = new TodoManager({}, this.errorHandler);
            console.debug("[OpenCode Obsidian] Todo Manager initialized");
        } catch (error) {
            this.errorHandler.handleError(
                error,
                { module: "OpenCodeObsidianPlugin", function: "initializeTodoManager" },
                ErrorSeverity.Warning
            );
        }
    }

    /**
     * 注册 UI 组件（视图、命令、设置）
     */
    private registerUIComponents(): void {
        // 注册视图
        this.registerView(
            VIEW_TYPE_OPENCODE_OBSIDIAN,
            (leaf) => new OpenCodeObsidianView(leaf, this),
        );

        // 添加 ribbon 图标
        this.addRibbonIcon("bot", "Open opencode", () => {
            void this.activateView();
        });

        // 注册命令
        this.registerCommands();

        // 添加设置标签
        this.addSettingTab(new OpenCodeObsidianSettingTab(this.app, this));

        console.debug("[OpenCode Obsidian] UI components registered");
    }

    /**
     * 注册所有命令
     */
    private registerCommands(): void {
        // Open view
        this.addCommand({
            id: "open-view",
            name: "Open chat view",
            callback: () => void this.activateView(),
        });

        // New conversation
        this.addCommand({
            id: "new-conversation",
            name: "New conversation",
            hotkeys: [{ modifiers: ["Mod"], key: "n" }],
            callback: () => {
                const view = this.getActiveView();
                if (view) {
                    void view.createNewConversation();
                } else {
                    new Notice("Please open the chat view first");
                }
            },
        });

        // Search files
        this.addCommand({
            id: "open-search-panel",
            name: "Search files",
            hotkeys: [{ modifiers: ["Mod"], key: "f" }],
            callback: () => {
                const view = this.getActiveView();
                if (view) {
                    view.openSearchPanel();
                } else {
                    new Notice("Please open the chat view first");
                }
            },
        });

        // Todo list
        this.addCommand({
            id: "open-todo-list",
            name: "Open Todo List",
            hotkeys: [{ modifiers: ["Mod"], key: "t" }],
            callback: () => {
                const view = this.getActiveView();
                if (view) {
                    if (typeof (view as any).showTodoList === 'function') {
                        (view as any).showTodoList();
                    } else {
                        new Notice("Todo list functionality not available in this view");
                    }
                } else {
                    new Notice("Please open the chat view first");
                }
            },
        });
    }

    /**
     * 完成设置（服务器状态检查）
     */
    private async finalizeSetup(): Promise<void> {
        await this.checkServerStatusAndPrompt();
    }

    /**
     * 处理加载错误
     */
    private handleLoadError(error: unknown): void {
        if (this.errorHandler) {
            this.errorHandler.handleError(
                error,
                {
                    module: "OpenCodeObsidianPlugin",
                    function: "onload",
                    operation: "Plugin loading",
                },
                ErrorSeverity.Critical,
            );
        } else {
            console.error("[OpenCode Obsidian] Failed to load plugin:", error);
            new Notice(
                "Failed to load OpenCode Obsidian plugin. Check console for details.",
            );
        }
    }
}
```

#### 预期结果

- ✅ `onload()` 方法从 243 行减少到约 20 行
- ✅ 每个初始化阶段都有独立方法
- ✅ 代码可读性显著提高
- ✅ 易于单独测试每个初始化阶段

#### 验收标准

```bash
# 检查 onload() 方法行数
grep -n "async onload()" src/main.ts
# 预期: onload() 方法约 20 行

# 运行测试确保功能不变
bun vitest run src/main.test.ts

# 手动测试插件加载
# 1. 重新加载 Obsidian
# 2. 检查插件是否正常加载
# 3. 检查所有功能是否正常工作
```

---

### 任务 2.2: 优化错误处理包装方法

**优先级**: 🟡 中
**预计工作量**: 1-2 天
**影响模块**: `src/utils/error-handler.ts`, `src/client/session-operations.ts`

#### 问题描述

多个模块中存在重复的错误处理模式：
- `SessionOperations.handleOperationError()`
- `SessionOperations.handleSdkError()`
- 其他模块中的类似模式

#### 修正目标

在 ErrorHandler 中添加高级包装方法，减少重复代码。

#### 具体步骤

**步骤 1: 扩展 ErrorHandler**

```typescript
// src/utils/error-handler.ts
export class ErrorHandler {
    // ... 现有方法 ...

    /**
     * 包装异步操作，自动处理错误
     * @param operation 要执行的操作
     * @param context 错误上下文
     * @param severity 错误严重性
     * @returns 操作结果
     */
    async wrapOperation<T>(
        operation: () => Promise<T>,
        context: ErrorContext,
        severity: ErrorSeverity = ErrorSeverity.Error
    ): Promise<T> {
        try {
            return await operation();
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.handleError(err, context, severity);
            throw err;
        }
    }

    /**
     * 包装 SDK 操作，提供友好的错误消息
     * @param operation SDK 操作
     * @param context 错误上下文
     * @param friendlyMessage 用户友好的错误消息
     * @returns 操作结果
     */
    async wrapSdkOperation<T>(
        operation: () => Promise<T>,
        context: ErrorContext,
        friendlyMessage?: string
    ): Promise<T> {
        try {
            return await operation();
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));

            // 如果提供了友好消息，创建增强的错误
            if (friendlyMessage) {
                const enhancedError = new Error(friendlyMessage);
                enhancedError.cause = err;
                this.handleError(enhancedError, context, ErrorSeverity.Error);
                throw enhancedError;
            }

            this.handleError(err, context, ErrorSeverity.Error);
            throw err;
        }
    }
}
```

**步骤 2: 重构 SessionOperations**

```typescript
// src/client/session-operations.ts
export class SessionOperations {
    // 删除 handleOperationError 和 handleSdkError 方法

    async createSession(title?: string): Promise<string> {
        return this.errorHandler.wrapSdkOperation(
            async () => {
                const response = await this.sdkClient.session.create({
                    body: { title }
                });
                const sessionId = this.extractSessionId(response.data);
                if (!sessionId) {
                    throw new Error("Failed to extract session ID from response");
                }
                this.sessions.set(sessionId, response.data);
                this.currentSessionId = sessionId;
                return sessionId;
            },
            {
                module: "SessionOperations",
                function: "createSession",
                operation: "Creating session",
                metadata: { title, serverUrl: this.serverUrl }
            }
        );
    }

    // 其他方法类似重构...
}
```

#### 预期结果

- ✅ ErrorHandler 提供统一的包装方法
- ✅ SessionOperations 代码减少约 40 行
- ✅ 错误处理逻辑统一

#### 验收标准

```bash
# 运行测试
bun vitest run src/utils/error-handler.test.ts
bun vitest run src/client/session-operations.test.ts

# 检查代码行数
wc -l src/client/session-operations.ts
# 预期: 从 953 行减少到约 910 行
```

---

### 任务 2.3: 完善文档

**优先级**: 🟡 中
**预计工作量**: 2 天
**影响范围**: 多个模块

#### 问题描述

部分模块缺少 CLAUDE.md 文档：
- `src/tools/` - 无 CLAUDE.md
- `src/views/CLAUDE.md` - 内容为空
- `src/utils/` - 无 CLAUDE.md

#### 修正目标

为所有主要模块添加完整的 CLAUDE.md 文档。

#### 具体步骤

**步骤 1: 创建 tools 模块文档**

```bash
touch src/tools/CLAUDE.md
```

内容应包括：
- 工具系统概述
- 权限管理机制
- 审计日志系统
- 工具注册和执行流程
- 常见问题和调试

**步骤 2: 完善 views 模块文档**

编辑 `src/views/CLAUDE.md`，添加：
- View 组件架构
- 服务层设计（SessionManager, ConversationManager, MessageSender）
- UI 组件说明
- 事件处理流程

**步骤 3: 创建 utils 模块文档**

```bash
touch src/utils/CLAUDE.md
```

内容应包括：
- 工具函数说明
- ErrorHandler 使用指南
- 数据处理辅助函数
- 常量定义

#### 预期结果

- ✅ 所有主要模块都有 CLAUDE.md
- ✅ 文档内容完整且准确
- ✅ 新开发者可以快速理解模块功能

#### 验收标准

```bash
# 检查文档存在性
ls -la src/tools/CLAUDE.md
ls -la src/views/CLAUDE.md
ls -la src/utils/CLAUDE.md

# 检查文档内容（至少 100 行）
wc -l src/tools/CLAUDE.md
wc -l src/views/CLAUDE.md
wc -l src/utils/CLAUDE.md
```

---

## 阶段 3: 低优先级修正 (Week 4)

### 任务 3.1: 修正 ServerManager 日志使用

**优先级**: 🟢 低
**预计工作量**: 0.5 天
**负责模块**: `src/embedded-server/ServerManager.ts`

#### 问题描述

ServerManager 使用 ErrorHandler 记录 Info 级别的日志，语义不正确。

#### 修正目标

使用 `console.debug` 替代 ErrorHandler 记录普通信息。

#### 具体步骤

**步骤 1: 替换日志调用**

```typescript
// src/embedded-server/ServerManager.ts

// 修改前:
this.errorHandler.handleError(
    new Error(`ServerManager initialized with config: ${JSON.stringify(config)}`),
    { module: "ServerManager", function: "constructor" },
    ErrorSeverity.Info
);

// 修改后:
console.debug(`[ServerManager] Initialized with config:`, config);
```

**步骤 2: 更新所有 Info 级别的日志**

查找并替换所有使用 ErrorHandler 记录 Info 级别的地方。

#### 预期结果

- ✅ 所有普通日志使用 console.debug
- ✅ ErrorHandler 只用于错误处理
- ✅ 语义更加清晰

#### 验收标准

```bash
# 检查是否还有 ErrorSeverity.Info 的使用
grep -r "ErrorSeverity.Info" src/embedded-server/

# 预期: 无结果

# 运行测试
bun vitest run src/embedded-server/ServerManager.test.ts
```

---

### 任务 3.2: 添加类型索引文件

**优先级**: 🟢 低
**预计工作量**: 0.5 天
**影响范围**: 类型系统

#### 问题描述

类型定义分散在多个文件中，查找不便。

#### 修正目标

创建类型索引文件，方便类型查找和导入。

#### 具体步骤

**步骤 1: 创建类型索引**

```typescript
// src/types/index.ts
/**
 * 类型索引文件
 * 重新导出所有公共类型，方便导入
 */

// 全局类型
export * from '../types';

// 客户端类型
export * from '../client/types';

// 工具类型
export * from '../tools/obsidian/types';

// Todo 类型
export * from '../todo/types';

// 服务器类型
export * from '../embedded-server/types';

// 会话事件类型
export type {
    StreamTokenEvent,
    StreamThinkingEvent,
    ProgressUpdateEvent,
    SessionEndEvent,
    PermissionRequestEvent,
    ErrorEvent
} from '../session/session-event-bus';
```

**步骤 2: 更新导入语句（可选）**

可以逐步将分散的导入语句更新为从索引导入：

```typescript
// 修改前:
import { SessionListItem } from '../types';
import { OpenCodeServerConfig } from '../client/types';

// 修改后:
import { SessionListItem, OpenCodeServerConfig } from '../types/index';
```

#### 预期结果

- ✅ 类型索引文件创建完成
- ✅ 所有公共类型都可以从索引导入
- ✅ 类型查找更加方便

#### 验收标准

```bash
# 检查索引文件
cat src/types/index.ts

# 确保可以正常编译
bun run check
```

---

## 实施时间表

### Week 1: 阶段 1 - 测试覆盖 (第1周)

| 任务 | 工作量 | 负责人 | 状态 |
|------|--------|--------|------|
| 1.1 添加 ConnectionHandler 测试 | 3-4天 | TBD | ⏳ 待开始 |
| 1.2 添加 StreamHandler 测试 | 3-4天 | TBD | ⏳ 待开始 |

### Week 2: 阶段 1 - 代码重复消除 (第2周)

| 任务 | 工作量 | 负责人 | 状态 |
|------|--------|--------|------|
| 1.3 提取 RetryHelper 工具类 | 2-3天 | TBD | ⏳ 待开始 |

### Week 3: 阶段 2 - 代码结构优化 (第3周)

| 任务 | 工作量 | 负责人 | 状态 |
|------|--------|--------|------|
| 2.1 重构 Main.ts 初始化 | 2-3天 | TBD | ⏳ 待开始 |
| 2.2 优化错误处理 | 1-2天 | TBD | ⏳ 待开始 |
| 2.3 完善文档 | 2天 | TBD | ⏳ 待开始 |

### Week 4: 阶段 3 - 代码风格完善 (第4周)

| 任务 | 工作量 | 负责人 | 状态 |
|------|--------|--------|------|
| 3.1 修正 ServerManager 日志 | 0.5天 | TBD | ⏳ 待开始 |
| 3.2 添加类型索引 | 0.5天 | TBD | ⏳ 待开始 |

---

## 风险评估

### 高风险项

1. **测试覆盖添加** (任务 1.1, 1.2)
   - **风险**: 可能发现现有代码的 bug
   - **缓解**: 先修复 bug，再继续重构

2. **Main.ts 重构** (任务 2.1)
   - **风险**: 可能影响插件加载流程
   - **缓解**: 充分的手动测试，保留回滚方案

### 中风险项

3. **RetryHelper 提取** (任务 1.3)
   - **风险**: 可能改变重试行为
   - **缓解**: 详细的单元测试，对比重构前后行为

### 低风险项

4. **错误处理优化** (任务 2.2)
   - **风险**: 低，主要是代码重构
   - **缓解**: 测试覆盖

5. **文档完善** (任务 2.3)
   - **风险**: 无技术风险
   - **缓解**: 代码审查

6. **日志修正** (任务 3.1)
   - **风险**: 极低
   - **缓解**: 简单验证

---

## 成功标准

### 代码质量指标

- ✅ 测试覆盖率 ≥ 70%
- ✅ 核心模块测试覆盖率 ≥ 80%
- ✅ 所有测试通过
- ✅ 无 ESLint 错误

### 代码行数指标

- ✅ SessionManager: 643 → 580 行 (-10%)
- ✅ SessionOperations: 953 → 910 行 (-5%)
- ✅ Main.ts onload(): 243 → 20 行 (-92%)

### 文档完整性

- ✅ 所有主要模块都有 CLAUDE.md
- ✅ 文档内容完整且准确
- ✅ 代码注释充分

### 功能验证

- ✅ 所有现有功能正常工作
- ✅ 插件加载成功
- ✅ 无回归 bug

---

## 总结

本重构计划基于代码审核报告，针对项目中的关键问题提供了详细的修正方案。计划分为三个阶段，预计 3-4 周完成。

**关键改进**:
1. 补充核心模块测试（ConnectionHandler, StreamHandler）
2. 消除代码重复（RetryHelper, 错误处理）
3. 优化代码结构（Main.ts 初始化）
4. 完善文档覆盖

**预期收益**:
- 测试覆盖率从 ~40% 提升到 70%+
- 代码重复减少约 100 行
- 代码可读性显著提高
- 文档完整性达到 100%

**建议执行顺序**: 严格按照优先级执行，高优先级任务完成后再进行中低优先级任务。

---

**文档版本**: 1.0
**创建日期**: 2026-01-19
**最后更新**: 2026-01-19

