# OpenCode Obsidian 结构重构计划

> **项目定位：** 个人小型项目
> **重构原则：** 保留功能、减少复杂度、避免过度工程化
> **目标：** 提升可维护性，而非追求完美架构

---

## 当前状态评估

**项目规模：**
- 源代码文件：39 个 TypeScript 文件
- 测试文件：12 个
- 总代码行数：约 8,000 行
- 核心模块：7 个

**复杂度评分：** 6/10（中等偏高）

**主要问题：**
1. ❌ `main.ts` 过于臃肿（614 行）
2. ❌ 部分模块职责不够清晰
3. ⚠️ 文件组织可以更扁平化
4. ⚠️ 过度分层导致查找困难

**优势：**
- ✅ 模块边界清晰
- ✅ 类型安全严格
- ✅ 测试覆盖良好

---

## 重构哲学：小型项目视角

### ❌ 不要做的事

1. **不要过度抽象**
   - 不需要工厂模式、策略模式等复杂设计模式
   - 不需要依赖注入容器
   - 不需要过多的接口和抽象类

2. **不要过度分层**
   - 不需要 Repository 层、Service 层、Controller 层
   - 不需要过深的目录嵌套（超过 3 层）
   - 不需要为每个功能创建单独的文件

3. **不要追求完美**
   - 不需要 100% 测试覆盖率
   - 不需要所有函数都是纯函数
   - 不需要完全消除重复代码

### ✅ 应该做的事

1. **保持简单**
   - 一个文件可以有多个相关的类/函数
   - 优先使用简单的函数而非复杂的类
   - 代码重复 2-3 次再考虑抽象

2. **扁平化组织**
   - 减少目录层级
   - 相关文件放在一起
   - 按功能而非技术分类

3. **实用主义**
   - 只在真正需要时才重构
   - 优先解决实际痛点
   - 保持代码可读性

---

## ⚠️ 关键风险提示

**在开始重构前，请务必注意以下风险：**

1. **代码行数假设可能不准确**
   - ⚠️ 本计划中的文件行数来自初步估算，实际可能显著不同
   - ⚠️ 例如：client.ts 实际约 968 行，而非估算的 200 行
   - ✅ **必须在阶段 0 完成数据验证后再执行后续阶段**

2. **saveSettings 重初始化逻辑复杂**
   - ⚠️ main.ts 的 saveSettings() 包含客户端重初始化逻辑（477-520 行）
   - ⚠️ 需要特别小心处理，避免破坏现有功能
   - ✅ **建议先提取为独立函数再重构**

3. **阶段 3 合并可能产生超大文件**
   - ⚠️ 合并 client 模块可能产生 1600+ 行的超大文件
   - ⚠️ 超过可维护性阈值（建议单文件 <800 行）
   - ✅ **必须验证合并后的实际行数，如超过 1000 行则放弃合并**

4. **依赖注入设计需优化**
   - ⚠️ 原计划中的 ClientFactory 依赖整个 Plugin 实例，耦合度高
   - ✅ **已在修正版中改为依赖注入模式**

---

## 重构方案：简化版（已修正）

### 阶段 0：快速数据验证（必须执行，优先级：最高）

**目标：** 快速验证文件行数和合并可行性，避免过度规划

**为什么需要这个阶段：**
- 初步估算的文件行数可能不准确（如 client.ts 实际 968 行 vs 估算 200 行）
- 合并后的文件大小直接影响可维护性
- 需要确认哪些合并方案可行

**任务清单：**

1. **快速统计文件行数（10分钟）**
   ```bash
   # 统计所有 TypeScript 文件行数
   find src -name "*.ts" -not -name "*.test.ts" -exec wc -l {} \; | sort -nr > file-stats.txt

   # 查看最大的文件
   head -20 file-stats.txt
   ```
   - [ ] 统计 main.ts 的实际行数
   - [ ] 统计 opencode-server/ 模块所有文件行数
   - [ ] 统计 utils/ 模块所有文件行数
   - [ ] 统计 views/components/ 和 views/modals/ 所有文件行数

2. **评估合并后的代码量（10分钟）**
   - [ ] 计算合并 client 模块后的总行数（client.ts + connection-handler.ts + stream-handler.ts）
   - [ ] 计算合并 utils 小文件后的总行数（data-helpers + dom-helpers + debounce-throttle）
   - [ ] 计算合并 views 组件后的总行数
   - [ ] 判断是否超过阈值（单文件建议 <800 行，最多 1000 行）

3. **快速决策（5分钟）**
   - [ ] 确定哪些合并方案可行（<800 行）
   - [ ] 确定哪些需要调整（800-1000 行）
   - [ ] 确定哪些放弃（>1000 行）

**输出：**
- `file-stats.txt` - 简单的文件行数列表（不需要详细文档）

**预计时间：** 1-2 小时（而非 0.5-1 天）

**完成标准：**
- ✅ 所有关键文件行数已统计
- ✅ 合并后的代码量已评估
- ✅ 已确定哪些合并方案可行

**决策点：**
- 如果合并后某文件超过 1000 行 → 放弃该合并方案
- 如果合并后某文件在 800-1000 行 → 谨慎评估，可能需要进一步拆分
- 如果合并后某文件小于 800 行 → 可以执行合并

---

### 方案 1：扁平化目录结构（参考，已废弃）

**注意：** 此方案仅供参考，实际执行请按阶段 1-3 的详细方案进行。

**当前问题：** 目录层级过深，查找文件困难

**优化方案：** 减少嵌套，按功能模块组织

```
src/
├── main.ts                          # 插件入口（简化到 300 行）
├── types.ts                         # 全局类型
├── settings.ts                      # 设置 UI
│
├── client/                          # OpenCode 客户端（合并）
│   ├── opencode-client.ts           # 主客户端（合并 client + handlers）
│   ├── session-operations.ts        # 会话操作
│   ├── connection-manager.ts        # 连接管理
│   └── types.ts
│
├── events/                          # 事件系统
│   └── event-bus.ts                 # 事件总线
│
├── tools/                           # 工具系统（扁平化）
│   ├── tool-registry.ts             # 工具注册
│   ├── tool-executor.ts             # 工具执行
│   ├── permissions.ts               # 权限管理（合并 3 个文件）
│   ├── permission-modal.ts          # 权限 UI
│   ├── audit-logger.ts              # 审计日志
│   └── types.ts
│
├── views/                           # UI 层（简化）
│   ├── chat-view.ts                 # 主视图
│   ├── components.ts                # 所有组件（合并）
│   ├── modals.ts                    # 所有模态框（合并）
│   ├── session-manager.ts           # 会话管理
│   ├── conversation-manager.ts      # 对话管理
│   └── message-sender.ts            # 消息发送
│
├── server/                          # 内嵌服务器
│   ├── server-manager.ts
│   └── types.ts
│
└── utils/                           # 工具函数
    ├── error-handler.ts
    ├── constants.ts
    └── helpers.ts                   # 合并所有 helper 文件
```

**变化说明：**
- 📉 目录从 7 个减少到 6 个
- 📉 文件从 39 个减少到 23 个（减少 41%）
- 📉 最大嵌套深度从 3 层减少到 2 层
- ✅ 相关功能集中在一起，更容易查找

**合并策略：**

1. **client/ 模块：** 合并 connection-handler.ts + stream-handler.ts → opencode-client.ts
   - 理由：这些文件都是客户端的内部实现，外部不需要单独引用
   - 代码量：约 400 行（可接受）

2. **tools/ 模块：** 合并 permission-manager.ts + permission-coordinator.ts + permission-types.ts → permissions.ts
   - 理由：权限相关逻辑紧密耦合，分开反而增加理解成本
   - 代码量：约 350 行（可接受）

3. **views/ 模块：** 合并所有 components/ → components.ts，所有 modals/ → modals.ts
   - 理由：小型项目不需要每个组件单独一个文件
   - 代码量：components.ts 约 400 行，modals.ts 约 200 行（可接受）

4. **utils/ 模块：** 合并 data-helpers.ts + dom-helpers.ts + debounce-throttle.ts → helpers.ts
   - 理由：工具函数分散在多个文件中，查找不便
   - 代码量：约 200 行（可接受）

---

### 方案 2：简化 main.ts（必须执行）

**当前问题：** main.ts 有 614 行，职责过多

**目标：** 减少到 300 行以内

**简化策略：**

#### 2.1 提取服务器初始化逻辑（已优化：增加回调支持）

**当前代码（main.ts 358-397 行）：**
```typescript
private async initializeServer(): Promise<void> {
    const serverConfig = this.settings.opencodeServer;
    if (!serverConfig) return;

    if (serverConfig.useEmbeddedServer) {
        // 40 行的服务器启动逻辑
        this.serverManager = new ServerManager(...);
        const started = await this.serverManager.start();
        if (started) {
            // 更新 URL
            if (!serverConfig.url) {
                serverConfig.url = this.serverManager.getUrl();
                await this.saveSettings();
            }
        }
    }
}
```

**问题：** 缺少状态变化回调和 URL 更新回调

**优化后：**
```typescript
// 在 src/server/ServerManager.ts 中添加静态方法

/**
 * 从配置初始化服务器管理器
 * @param config 服务器配置
 * @param errorHandler 错误处理器
 * @param onStateChange 状态变化回调
 * @param onUrlReady URL 就绪回调（服务器启动成功后调用）
 * @returns ServerManager 实例，如果不使用内嵌服务器则返回 null
 */
static async initializeFromConfig(
    config: ServerConfig,
    errorHandler: ErrorHandler,
    onStateChange: (event: ServerStateChangeEvent) => void,
    onUrlReady?: (url: string) => Promise<void>
): Promise<ServerManager | null> {
    // 检查是否启用内嵌服务器
    if (!config.useEmbeddedServer) {
        return null;
    }

    // 创建服务器管理器
    const manager = new ServerManager(
        {
            opencodePath: config.opencodePath || "opencode",
            port: config.embeddedServerPort || 4096,
            hostname: "127.0.0.1",
            startupTimeout: 5000,
            workingDirectory: ".",
        },
        errorHandler,
        onStateChange
    );

    // 启动服务器
    const started = await manager.start();

    // 如果启动成功且提供了 URL 回调，则调用
    if (started && onUrlReady) {
        await onUrlReady(manager.getUrl());
    }

    return started ? manager : null;
}
```

**main.ts 简化为：**
```typescript
async onload() {
    // ... 其他初始化代码 ...

    // 初始化服务器（使用静态工厂方法）
    this.serverManager = await ServerManager.initializeFromConfig(
        this.settings.opencodeServer,
        this.errorHandler,
        (event) => this.handleServerStateChange(event),
        async (url) => {
            // URL 就绪回调：更新配置
            if (!this.settings.opencodeServer.url) {
                this.settings.opencodeServer.url = url;
                await this.saveSettings();
            }
        }
    );
}
```

**优势：**
- ✅ 支持状态变化回调
- ✅ 支持 URL 就绪回调
- ✅ 封装完整的初始化逻辑
- ✅ 保持 main.ts 简洁

**减少代码：** 40 行 → 12 行

#### 2.2 提取客户端初始化逻辑（已优化：使用简单函数）

**当前代码（main.ts 181-240 行）：**
```typescript
if (this.settings.opencodeServer?.url) {
    this.opencodeClient = new OpenCodeServerClient(...);
    this.connectionManager = new ConnectionManager(...);
    this.bindClientCallbacks(this.opencodeClient);
    this.permissionCoordinator = new PermissionCoordinator(...);
    // 健康检查逻辑
    // 加载 agents 逻辑
}
```

**问题：** 初始化逻辑分散，重复代码多

**优化后（使用简单函数，避免过度抽象）：**

```typescript
// 新建 src/utils/client-initializer.ts

import { OpenCodeServerClient } from "opencode-server/client";
import { ConnectionManager } from "session/connection-manager";
import { PermissionCoordinator } from "tools/obsidian/permission-coordinator";
import type { App } from "obsidian";
import type { SessionEventBus } from "session/session-event-bus";
import type { PermissionManager } from "tools/obsidian/permission-manager";
import type { AuditLogger } from "tools/obsidian/audit-logger";
import type { ErrorHandler, ErrorSeverity } from "utils/error-handler";
import type { Agent, ServerConfig } from "types";

/**
 * 客户端初始化结果
 */
export interface ClientSetup {
    client: OpenCodeServerClient;
    connectionManager: ConnectionManager;
    permissionCoordinator: PermissionCoordinator;
}

/**
 * 初始化客户端及相关组件（简单函数，避免过度抽象）
 */
export async function initializeClient(
    config: ServerConfig,
    errorHandler: ErrorHandler,
    sessionEventBus: SessionEventBus,
    permissionManager: PermissionManager,
    auditLogger: AuditLogger,
    app: App,
    onAgentsLoaded?: (agents: Agent[]) => Promise<void>,
    getDefaultAgents?: () => Agent[]
): Promise<ClientSetup | null> {
    // 验证配置
    if (!config.url) {
        return null;
    }

    // 创建客户端
    const client = new OpenCodeServerClient(config, errorHandler);
    const connectionManager = new ConnectionManager(client, errorHandler);

    // 绑定事件回调
    bindClientCallbacks(client, sessionEventBus);

    // 创建权限协调器
    const permissionCoordinator = new PermissionCoordinator(
        client,
        sessionEventBus,
        permissionManager,
        auditLogger,
        errorHandler
    );
    permissionCoordinator.setApp(app);

    // 健康检查（不阻塞）
    performHealthCheck(client, errorHandler);

    // 加载 agents
    await loadAgents(client, errorHandler, onAgentsLoaded, getDefaultAgents);

    return { client, connectionManager, permissionCoordinator };
}

/**
 * 重新初始化客户端（用于配置变更）
 */
export async function reinitializeClient(
    oldClient: OpenCodeServerClient | null,
    config: ServerConfig,
    errorHandler: ErrorHandler,
    sessionEventBus: SessionEventBus,
    permissionManager: PermissionManager,
    auditLogger: AuditLogger,
    app: App,
    onAgentsLoaded?: (agents: Agent[]) => Promise<void>,
    getDefaultAgents?: () => Agent[]
): Promise<ClientSetup | null> {
    // 断开旧客户端
    if (oldClient) {
        await oldClient.disconnect();
    }

    // 创建新客户端
    return await initializeClient(
        config,
        errorHandler,
        sessionEventBus,
        permissionManager,
        auditLogger,
        app,
        onAgentsLoaded,
        getDefaultAgents
    );
}

// ===== 辅助函数 =====

function bindClientCallbacks(
    client: OpenCodeServerClient,
    eventBus: SessionEventBus
): void {
    client.onStreamToken((sessionId, token, done) =>
        eventBus.emitStreamToken({ sessionId, token, done })
    );
    client.onStreamThinking((sessionId, content) =>
        eventBus.emitStreamThinking({ sessionId, content })
    );
    client.onProgressUpdate((sessionId, progress) =>
        eventBus.emitProgressUpdate({ sessionId, progress })
    );
    client.onSessionEnd((sessionId, reason) =>
        eventBus.emitSessionEnd({ sessionId, reason })
    );
    client.onPermissionRequest((sessionId, requestId, operation, resourcePath, context) =>
        eventBus.emitPermissionRequest({
            sessionId,
            requestId,
            operation,
            resourcePath,
            context: context as any
        })
    );
    client.onError((error) => eventBus.emitError({ error }));
}

async function performHealthCheck(
    client: OpenCodeServerClient,
    errorHandler: ErrorHandler
): Promise<void> {
    try {
        await client.healthCheck();
    } catch (error) {
        errorHandler.handleError(error, {
            module: "ClientInitializer",
            function: "performHealthCheck",
            operation: "Health check"
        }, "warning" as ErrorSeverity);
    }
}

async function loadAgents(
    client: OpenCodeServerClient,
    errorHandler: ErrorHandler,
    onAgentsLoaded?: (agents: Agent[]) => Promise<void>,
    getDefaultAgents?: () => Agent[]
): Promise<void> {
    try {
        const agents = await client.listAgents();
        if (onAgentsLoaded) {
            await onAgentsLoaded(agents);
        }
    } catch (error) {
        // 加载失败时使用默认 agents
        if (getDefaultAgents && onAgentsLoaded) {
            await onAgentsLoaded(getDefaultAgents());
        }
        errorHandler.handleError(error, {
            module: "ClientInitializer",
            function: "loadAgents",
            operation: "Loading agents"
        }, "warning" as ErrorSeverity);
    }
}
```

**main.ts 简化为：**
```typescript
async onload() {
    // ... 其他初始化代码 ...

    // 初始化客户端（使用简单函数）
    const clientSetup = await initializeClient(
        this.settings.opencodeServer,
        this.errorHandler,
        this.sessionEventBus,
        this.permissionManager,
        auditLogger,
        this.app,
        async (agents) => {
            this.settings.agents = agents;
            await this.saveSettings();
        },
        () => this.getDefaultAgents()
    );

    if (clientSetup) {
        this.opencodeClient = clientSetup.client;
        this.connectionManager = clientSetup.connectionManager;
        this.permissionCoordinator = clientSetup.permissionCoordinator;
    }
}
```

**优势：**
- ✅ 简单：使用函数而非类，减少抽象层级
- ✅ 易读：参数列表清晰，不需要构造配置对象
- ✅ 易测试：纯函数，易于 mock
- ✅ 适合个人项目：避免过度工程化

**减少代码：** main.ts 减少约 60 行，新增文件约 150 行（而非 180 行）

#### 2.3 简化后的 main.ts 结构

```typescript
export default class OpenCodeObsidianPlugin extends Plugin {
    // 属性声明（30 行）
    settings: OpenCodeObsidianSettings;
    errorHandler: ErrorHandler;
    opencodeClient: OpenCodeServerClient | null = null;
    // ...

    // 核心生命周期（50 行）
    async onload() {
        // 1. 初始化错误处理器（10 行）
        this.errorHandler = new ErrorHandler({...});

        // 2. 加载设置（5 行）
        await this.loadSettings();
        this.migrateSettings();

        // 3. 初始化工具系统（10 行）
        this.permissionManager = new PermissionManager(...);
        this.toolRegistry = new ObsidianToolRegistry(...);

        // 4. 初始化服务器（5 行）
        this.serverManager = await ServerManager.initializeFromConfig(...);

        // 5. 初始化客户端（10 行）
        const clientSetup = await ClientFactory.create(...);
        if (clientSetup) {
            this.opencodeClient = clientSetup.client;
            this.connectionManager = clientSetup.connectionManager;
            this.permissionCoordinator = clientSetup.permissionCoordinator;
        }

        // 6. 注册视图和命令（10 行）
        this.registerView(...);
        this.addRibbonIcon(...);
        this.addCommand(...);
        this.addSettingTab(...);
    }

    onunload() {
        // 清理逻辑（20 行）
    }

    // 设置管理（80 行）
    async loadSettings() { ... }
    async saveSettings() { ... }
    private migrateSettings() { ... }

    // 视图管理（40 行）
    async activateView() { ... }
    getActiveView() { ... }

    // 辅助方法（80 行）
    private handleServerStateChange() { ... }
    private getDefaultAgents() { ... }
}
```

**最终代码量：** 约 300 行（减少 51%）

**新增文件：**
- `src/opencode-server/client-factory.ts`（约 180 行）
- `src/server/ServerManager.ts` 增强（新增 50 行静态方法）

**收益：**
- ✅ main.ts 更易读，只关注插件生命周期
- ✅ 初始化逻辑可独立测试
- ✅ 减少 main.ts 的修改频率
- ✅ 依赖注入提升可测试性

#### 2.4 重构 saveSettings 中的客户端重初始化（简化版）

**问题：** main.ts 的 `saveSettings()` 方法（457-521 行）包含客户端重初始化逻辑，与 `onload()` 中的初始化逻辑重复。

**优化方案：** 复用 reinitializeClient 函数

```typescript
async saveSettings() {
    // 更新 PermissionManager 配置
    if (this.permissionManager) {
        this.permissionManager.setPermissionLevel(
            getPermissionLevel(this.settings.toolPermission)
        );
        this.permissionManager.setScope(
            toPermissionScope(this.settings.permissionScope) ?? ({} as PermissionScope)
        );
    }

    // 检查 URL 是否变化
    const normalizeUrl = (url?: string) => url?.trim().replace(/\/+$/, "") || "";
    const oldUrl = normalizeUrl(this.opencodeClient?.getConfig()?.url);
    const newUrl = normalizeUrl(this.settings.opencodeServer?.url);
    const urlChanged = oldUrl !== newUrl && newUrl;

    await this.saveData(this.settings);

    // 如果 URL 变化，重新初始化客户端
    if (urlChanged && this.settings.opencodeServer && this.permissionManager) {
        const auditLogger = new AuditLogger(this.app.vault);

        const clientSetup = await reinitializeClient(
            this.opencodeClient,
            this.settings.opencodeServer,
            this.errorHandler,
            this.sessionEventBus,
            this.permissionManager,
            auditLogger,
            this.app,
            async (agents) => {
                this.settings.agents = agents;
                await this.saveSettings();
            },
            () => this.getDefaultAgents()
        );

        if (clientSetup) {
            this.opencodeClient = clientSetup.client;
            this.connectionManager = clientSetup.connectionManager;
            this.permissionCoordinator = clientSetup.permissionCoordinator;
        } else {
            this.opencodeClient = null;
            this.connectionManager = null;
            this.permissionCoordinator = null;
        }
    }
}
```

**优势：**
- ✅ 消除重复代码
- ✅ 复用 initializeClient 的逻辑
- ✅ 保持一致性
- ✅ 更易维护

**减少代码：** saveSettings 减少约 30 行

---

### 方案 3：合并小文件（可选）

**原则：** 只合并真正相关且经常一起修改的文件

#### 3.1 合并 client 模块的内部实现

**当前结构：**
```
opencode-server/
├── client.ts                    # 主客户端（200 行）
├── connection-handler.ts        # 连接处理（150 行）
├── stream-handler.ts            # 流处理（180 行）
└── session-operations.ts        # 会话操作（250 行）
```

**问题：**
- connection-handler 和 stream-handler 只被 client.ts 使用
- 外部代码从不直接导入这两个文件
- 分离增加了理解成本

**优化方案：**

```typescript
// client/opencode-client.ts（合并后约 530 行）

export class OpenCodeServerClient {
    private connectionHandler: ConnectionHandler;
    private streamHandler: StreamHandler;

    constructor(config: ServerConfig, errorHandler: ErrorHandler) {
        this.connectionHandler = new ConnectionHandler(this, errorHandler);
        this.streamHandler = new StreamHandler(this, errorHandler);
    }

    // 公共 API 方法
    async connect() { ... }
    async disconnect() { ... }
    async sendMessage() { ... }

    // ... 其他公共方法
}

// 内部类（不导出）
class ConnectionHandler {
    constructor(
        private client: OpenCodeServerClient,
        private errorHandler: ErrorHandler
    ) {}

    async connect() { ... }
    async disconnect() { ... }
    handleConnectionError() { ... }
}

class StreamHandler {
    constructor(
        private client: OpenCodeServerClient,
        private errorHandler: ErrorHandler
    ) {}

    handleSSEEvent(event: any) { ... }
    processStreamToken() { ... }
    processThinking() { ... }
}
```

**保留独立文件：**
```
client/
├── opencode-client.ts           # 主客户端（合并后 530 行）
├── session-operations.ts        # 会话操作（独立，250 行）
├── client-factory.ts            # 客户端工厂（新增，150 行）
└── types.ts                     # 类型定义
```

**收益：**
- ✅ 减少文件数量：4 个 → 3 个
- ✅ 相关逻辑集中，更容易理解
- ✅ 减少跨文件跳转

**风险：**
- ⚠️ 单文件变大（530 行），但仍在可接受范围
- ⚠️ 需要仔细测试确保功能不变

#### 3.2 合并 utils 模块的辅助函数

**当前结构：**
```
utils/
├── error-handler.ts             # 错误处理（200 行）
├── error-messages.ts            # 错误消息（50 行）
├── constants.ts                 # 常量（100 行）
├── data-helpers.ts              # 数据辅助（80 行）
├── dom-helpers.ts               # DOM 辅助（60 行）
└── debounce-throttle.ts         # 防抖节流（40 行）
```

**优化方案：**

```
utils/
├── error-handler.ts             # 错误处理（保持独立，200 行）
├── constants.ts                 # 常量（保持独立，100 行）
└── helpers.ts                   # 合并所有辅助函数（180 行）
```

**helpers.ts 结构：**
```typescript
// ===== Data Helpers =====
export function normalizeMessage(msg: any): Message { ... }
export function formatTimestamp(ts: number): string { ... }
export function parseServerResponse(data: any): Response { ... }

// ===== DOM Helpers =====
export function createElement(tag: string, classes?: string[]): HTMLElement { ... }
export function setIcon(el: HTMLElement, icon: string): void { ... }
export function scrollToBottom(el: HTMLElement): void { ... }

// ===== Debounce & Throttle =====
export function debounce<T extends (...args: any[]) => any>(
    fn: T,
    delay: number
): (...args: Parameters<T>) => void { ... }

export function debounceAsync<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    delay: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> { ... }

export function throttle<T extends (...args: any[]) => any>(
    fn: T,
    limit: number
): (...args: Parameters<T>) => void { ... }
```

**收益：**
- ✅ 减少文件数量：6 个 → 3 个
- ✅ 所有辅助函数在一个地方，方便查找
- ✅ 减少导入语句

#### 3.3 合并 views 模块的组件

**当前结构：**
```
views/components/
├── header.ts                    # 头部（80 行）
├── conversation-selector.ts     # 对话选择器（100 行）
├── message-list.ts              # 消息列表（120 行）
├── message-renderer.ts          # 消息渲染（150 行）
├── input-area.ts                # 输入区域（100 行）
└── search-panel.ts              # 搜索面板（120 行）
```

**问题：**
- 每个组件都很小（80-150 行）
- 组件间紧密耦合，经常一起修改
- 小型项目不需要如此细粒度的拆分

**优化方案：**

```typescript
// views/components.ts（合并后约 670 行）

// ===== Header Component =====
export class HeaderComponent {
    constructor(private containerEl: HTMLElement) {}

    render() { ... }
    updateConnectionStatus() { ... }
}

// ===== Conversation Selector =====
export class ConversationSelector {
    constructor(private containerEl: HTMLElement) {}

    render(conversations: Conversation[]) { ... }
    selectConversation(id: string) { ... }
}

// ===== Message List =====
export class MessageList {
    constructor(private containerEl: HTMLElement) {}

    render(messages: Message[]) { ... }
    appendMessage(message: Message) { ... }
    scrollToBottom() { ... }
}

// ===== Message Renderer =====
export class MessageRenderer {
    static renderMessage(message: Message): HTMLElement { ... }
    static renderMarkdown(content: string): HTMLElement { ... }
    static renderCodeBlock(code: string, lang: string): HTMLElement { ... }
}

// ===== Input Area =====
export class InputArea {
    constructor(private containerEl: HTMLElement) {}

    render() { ... }
    getValue(): string { ... }
    clear() { ... }
    focus() { ... }
}

// ===== Search Panel =====
export class SearchPanel {
    constructor(private containerEl: HTMLElement) {}

    render() { ... }
    search(query: string): void { ... }
    close() { ... }
}
```

**同样合并 modals：**

```typescript
// views/modals.ts（合并后约 300 行）

export class AttachmentModal extends Modal { ... }
export class ConfirmationModal extends Modal { ... }
export class DiffViewerModal extends Modal { ... }
```

**收益：**
- ✅ 减少文件数量：9 个 → 2 个
- ✅ 所有 UI 组件在一个地方，方便查找
- ✅ 减少导入语句
- ✅ 更容易理解组件间的关系

**风险：**
- ⚠️ components.ts 变大（670 行），但按功能分块，仍易读
- ⚠️ 多人协作时可能有冲突（但这是个人项目）

---

## 实施计划

### 阶段 1：简化 main.ts（必须执行，优先级：高）

**目标：** 简化 main.ts，提升核心可维护性

**任务清单：**

1. **创建 client-initializer.ts（简化版）**
   - [ ] 新建 `src/utils/client-initializer.ts`
   - [ ] 定义 `ClientSetup` 接口
   - [ ] 实现 `initializeClient()` 函数（使用简单函数，非类）
   - [ ] 实现 `reinitializeClient()` 函数
   - [ ] 实现辅助函数：`bindClientCallbacks()`, `performHealthCheck()`, `loadAgents()`
   - [ ] 添加简单的 JSDoc 注释

2. **增强 server-manager.ts**
   - [ ] 在 `src/server/ServerManager.ts` 中添加 `initializeFromConfig()` 静态方法
   - [ ] 支持 `onStateChange` 回调参数
   - [ ] 支持 `onUrlReady` 回调参数
   - [ ] 添加简单的 JSDoc 注释

3. **简化 main.ts**
   - [ ] 导入 `initializeClient`, `reinitializeClient` 函数
   - [ ] 使用 `ServerManager.initializeFromConfig()` 替换 `initializeServer()` 方法
   - [ ] 使用 `initializeClient()` 替换客户端初始化逻辑
   - [ ] 删除 `bindClientCallbacks()` 方法（已移到 client-initializer）
   - [ ] 删除 `initializeServer()` 方法
   - [ ] 更新 `saveSettings()` 使用 `reinitializeClient()`
   - [ ] 验证代码行数减少到 300 行以内

4. **编写核心测试（简化版）**
   - [ ] 创建 `src/utils/client-initializer.test.ts`
   - [ ] 测试 `initializeClient()` 成功场景
   - [ ] 测试 `initializeClient()` 配置无效场景（无 URL）
   - [ ] 测试 `reinitializeClient()` 断开旧客户端
   - [ ] 补充 `src/server/ServerManager.test.ts`
   - [ ] 测试 `ServerManager.initializeFromConfig()` 基本场景

5. **回归测试**
   - [ ] 运行所有现有单元测试：`bun vitest run`
   - [ ] 确保所有测试通过
   - [ ] 手动测试插件加载和客户端连接
   - [ ] 手动测试设置变更后的重初始化

**测试覆盖要求（简化版）：**

**核心测试（必须）：**
```typescript
// src/utils/client-initializer.test.ts
describe('Client Initializer', () => {
    it('should initialize client successfully', async () => {
        // 测试正常创建流程
    });

    it('should return null when config.url is empty', async () => {
        // 测试配置无效场景
    });

    it('should reinitialize client and disconnect old one', async () => {
        // 测试重初始化
    });
});

// src/server/ServerManager.test.ts（补充）
describe('ServerManager.initializeFromConfig', () => {
    it('should return null when useEmbeddedServer is false', async () => {
        // 测试不启用内嵌服务器
    });

    it('should create and start server successfully', async () => {
        // 测试成功启动
    });
});
```

**说明：** 个人项目不需要 100% 测试覆盖，只测试核心功能即可。

**预计时间：** 1 天（而非 2-3 天）

**风险：** 低 - 只是重组代码，不改变逻辑

**完成标准：**
- ✅ main.ts 减少到 300 行以内
- ✅ 所有单元测试通过
- ✅ 所有回归测试通过
- ✅ 手动测试关键功能正常
- ✅ 代码已提交到 Git

---

### 阶段 2：合并小文件（推荐执行，优先级：中）

**目标：** 只合并微小文件，减少文件数量

**原则：** 只合并真正微小且相关的文件，保留组件独立性

**任务清单：**

1. **合并 utils 微小辅助函数**
   - [ ] 创建 `src/utils/helpers.ts`
   - [ ] 迁移 `data-helpers.ts` 内容（约 80 行）
   - [ ] 迁移 `dom-helpers.ts` 内容（约 60 行）
   - [ ] 迁移 `debounce-throttle.ts` 内容（约 40 行）
   - [ ] 合并后约 180 行，可接受
   - [ ] 更新所有导入语句
   - [ ] 删除旧文件
   - [ ] 运行测试验证

2. **合并 error-messages.ts 到 error-handler.ts**
   - [ ] 将 `error-messages.ts`（约 50 行）合并到 `error-handler.ts`
   - [ ] 更新导入语句
   - [ ] 删除 `error-messages.ts`
   - [ ] 运行测试验证

3. **保留以下文件独立（不合并）**
   - ✅ `constants.ts` - 常量文件频繁修改，保持独立
   - ✅ 所有 `views/components/` 组件 - 每个组件保持独立文件
   - ✅ 所有 `views/modals/` 模态框 - 每个模态框保持独立文件
   - ✅ `opencode-server/` 模块文件 - 避免产生超大文件

**预计时间：** 半天（而非 2-3 天）

**风险：** 低 - 只合并微小文件，主要是文件移动和导入更新

---

### 阶段 3：可选执行（优先级：低，建议跳过）

**目标：** 进一步简化，但收益递减

**⚠️ 重要提示：** 根据 review 建议，此阶段收益递减明显，建议跳过

**为什么建议跳过：**
- client.ts 实际约 968 行，合并后会超过 1600 行，远超可维护性阈值
- views 组件合并后约 670 行，但保持独立更便于维护和调试
- 个人项目不需要追求极致的文件数量减少

**如果确实要执行（不推荐）：**

1. **评估合并可行性（必须先执行）**
   - [ ] 查看阶段 0 的文件统计数据（`file-stats.txt`）
   - [ ] 计算合并 client 模块后的总行数
   - [ ] 如果超过 1000 行 → **放弃合并，跳过此阶段**

**预计时间：** 1-2 天

**风险：** 高 - 可能产生超大文件，降低可维护性

**建议：** 完成阶段 1 和阶段 2 后，项目已经足够简洁，无需执行此阶段

---

## 重构前后对比（简化版）

### 文件数量对比

| 模块 | 重构前 | 阶段 1 后 | 阶段 2 后 |
|------|--------|-----------|-----------|
| main.ts | 614 行 | 300 行 | 300 行 |
| utils/ | 6 文件 | 7 文件 | 4 文件 |
| client/ | 4 文件 | 4 文件 | 4 文件 |
| views/ | 13 文件 | 13 文件 | 13 文件 |
| **总计** | **39 文件** | **40 文件** | **37 文件** |

**说明：** 阶段 3 建议跳过，因此不列入对比

### 复杂度对比

| 指标 | 重构前 | 阶段 1+2 后 |
|------|--------|-------------|
| main.ts 行数 | 614 | 300 |
| 最大文件行数 | 968 (client.ts) | 968 (client.ts) |
| utils 文件数 | 6 | 4 |
| 目录嵌套深度 | 3 层 | 3 层 |

### 预期效果

完成阶段 1 和阶段 2 后：

- ✅ main.ts 从 614 行减少到 300 行（-51%）
- ✅ utils 文件从 6 个减少到 4 个（-33%）
- ✅ 初始化逻辑可独立测试
- ✅ 代码更易维护
- ✅ 保持所有功能不变
- ✅ 总投入时间约 1.5 天（而非 4-6 天）

---

## 注意事项

### ✅ 应该做的

1. **逐步重构**
   - 一次只做一个阶段
   - 每个阶段完成后运行完整测试
   - 提交 Git commit 保存进度

2. **保持测试通过**
   - 每次修改后运行 `bun vitest run`
   - 确保所有测试通过再继续
   - 如果测试失败，立即回滚

3. **更新文档**
   - 修改 CLAUDE.md 中的文件路径
   - 更新 README.md 中的项目结构
   - 更新模块文档（如果有）

4. **使用 Git**
   - 每个阶段完成后提交
   - 使用描述性的 commit message
   - 例如：`refactor: simplify main.ts by extracting ClientFactory`

### ❌ 不应该做的

1. **不要一次性重构所有**
   - 风险太高，难以定位问题
   - 容易引入 bug

2. **不要改变功能**
   - 重构只改结构，不改行为
   - 如果发现 bug，单独修复

3. **不要过度优化**
   - 不要追求完美的架构
   - 够用就好，避免过度工程化

4. **不要忽略测试**
   - 测试是重构的安全网
   - 没有测试的代码不要重构

---

## 回滚计划

如果重构出现问题，按以下步骤回滚：

### 方案 1：Git 回滚（推荐）

```bash
# 查看提交历史
git log --oneline

# 回滚到重构前的提交
git reset --hard <commit-hash>

# 或者创建新分支保留重构尝试
git checkout -b refactor-attempt
git checkout main
```

### 方案 2：手动回滚

1. 保留重构前的代码备份
2. 如果出现问题，从备份恢复
3. 分析失败原因，调整方案

---

## 总结与建议（简化版）

### 核心建议

**对于个人小型项目，推荐执行：**

1. ✅ **阶段 0（必须）：** 快速数据验证
   - 预计 1-2 小时
   - 确认文件行数和合并可行性

2. ✅ **阶段 1（必须）：** 简化 main.ts
   - 收益最大，风险最低
   - 使用简单函数而非复杂类
   - 预计 1 天完成

3. ✅ **阶段 2（推荐）：** 合并微小文件
   - 只合并 utils 小文件
   - 保留组件独立性
   - 预计半天完成

4. ❌ **阶段 3（跳过）：** 进一步合并
   - 收益递减明显
   - 可能产生超大文件
   - 建议跳过

### 预期效果

完成阶段 1 和阶段 2 后：

- ✅ main.ts 从 614 行减少到 300 行（-51%）
- ✅ utils 文件从 6 个减少到 4 个（-33%）
- ✅ 初始化逻辑可独立测试
- ✅ 保持所有功能不变
- ✅ 总投入时间约 1.5 天（而非 4-6 天）

### 长期维护建议

1. **保持简单**
   - 优先使用简单函数而非复杂类
   - 只在文件超过 500 行时才考虑拆分

2. **避免过度工程化**
   - 不需要工厂模式、策略模式等复杂设计
   - 代码重复 2-3 次再考虑抽象

3. **文档同步**
   - 代码结构变化时，及时更新 CLAUDE.md

---

## 附录：快速参考（简化版）

### 重构检查清单

**阶段 0：快速数据验证（1-2 小时）**
- [ ] 运行命令统计文件行数
- [ ] 评估合并后的代码量
- [ ] 确定哪些合并方案可行

**阶段 1：简化 main.ts（1 天）**
- [ ] 创建 client-initializer.ts（使用简单函数）
- [ ] 增强 ServerManager
- [ ] 简化 main.ts
- [ ] 编写核心测试
- [ ] 运行测试
- [ ] 提交 Git

**阶段 2：合并微小文件（半天）**
- [ ] 合并 utils 小文件（data/dom/debounce helpers）
- [ ] 合并 error-messages 到 error-handler
- [ ] 更新导入语句
- [ ] 运行测试
- [ ] 提交 Git

**阶段 3：跳过**
- ❌ 不推荐执行，收益递减明显

### 测试命令

```bash
# 运行所有测试
bun vitest run

# 运行特定测试
bun vitest run src/client/client-factory.test.ts

# 监听模式
bun vitest

# 类型检查
bun run check

# 构建验证
bun run build
```

### Git 提交建议（简化版）

```bash
# 阶段 0
git commit -m "docs: add file statistics for refactoring"

# 阶段 1
git commit -m "refactor: extract client initializer functions to simplify main.ts"
git commit -m "refactor: enhance ServerManager with initializeFromConfig"
git commit -m "refactor: simplify main.ts to 300 lines"

# 阶段 2
git commit -m "refactor: merge utils helpers into single file"
git commit -m "refactor: merge error-messages into error-handler"
```

---

**文档版本：** 2.0（已根据 review 优化）
**创建日期：** 2026-01-18
**更新日期：** 2026-01-18
**适用项目：** OpenCode Obsidian Plugin
**项目类型：** 个人小型项目
**重构原则：** 保留功能、减少复杂度、避免过度工程化

**主要变更（v2.0）：**
- ✅ 简化阶段 0：数据验证时间从 0.5-1 天减少到 1-2 小时
- ✅ 简化阶段 1：使用简单函数而非 ClientFactory 类，时间从 2-3 天减少到 1 天
- ✅ 简化阶段 2：只合并微小文件，保留组件独立性，时间从 2-3 天减少到半天
- ✅ 简化阶段 3：建议跳过，收益递减明显
- ✅ 简化测试要求：只测试核心功能，不需要 100% 覆盖
- ✅ 总投入时间：从 4-6 天减少到 1.5 天

**参考文档：**
- `docs/analysis/refactor_review_trae.md` - 重构计划评审报告
