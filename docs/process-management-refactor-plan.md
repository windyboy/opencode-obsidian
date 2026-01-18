# OpenCode Obsidian 插件进程管理改进计划

> **文档状态**: 已更新 (2026-01-18)
> **适用范围**: 个人桌面插件项目
> **改进目标**: 提升稳定性和可维护性，避免过度设计

---

## 1. 当前状态分析

### 1.1 实际架构概述

OpenCode Obsidian 是一个 **Obsidian 桌面插件**，采用事件驱动的模块化架构：

```
Plugin (main.ts)
├── OpenCodeServerClient (src/client/client.ts)
│   ├── ConnectionHandler (src/client/connection-handler.ts)
│   ├── StreamHandler (src/client/stream-handler.ts)
│   └── SessionOperations (src/client/session-operations.ts)
├── SessionEventBus (src/session/session-event-bus.ts)
├── ConnectionManager (src/session/connection-manager.ts)
├── ServerManager (src/embedded-server/ServerManager.ts)
└── Tool System
    ├── ToolRegistry (src/tools/obsidian/tool-registry.ts)
    ├── ToolExecutor (src/tools/obsidian/tool-executor.ts)
    ├── PermissionManager (src/tools/obsidian/permission-manager.ts)
    └── AuditLogger (src/tools/obsidian/audit-logger.ts)
```

**关键特性**:
- 基于 `@opencode-ai/sdk/client` 官方 SDK
- 事件驱动架构 (SessionEventBus 解耦组件)
- HTTP + SSE 实时通信
- 三级权限模型 (read-only, scoped-write, full-write)
- 统一错误处理 (ErrorHandler)

### 1.2 ServerManager 现状

**代码位置**: `src/embedded-server/ServerManager.ts`

**核心功能**:
- ✅ 启动/停止内嵌 OpenCode 服务器进程
- ✅ 进程状态管理 (stopped, starting, running, error)
- ✅ 基础健康检查 (HTTP `/health` 端点)
- ✅ 进程错误捕获和日志记录
- ✅ 优雅关闭 (SIGTERM → SIGKILL)

**已实现的优点**:
1. **状态机清晰**: 4 种状态转换明确
2. **错误处理完善**: 通过 ErrorHandler 统一处理
3. **启动前检查**: 避免重复启动已运行的服务器
4. **超时保护**: 5 秒启动超时，2 秒强制关闭超时
5. **进程监控**: 捕获 stdout/stderr/exit/error 事件

**当前限制**:
1. ❌ **无自动重启**: 进程崩溃后需手动重启
2. ❌ **健康检查简单**: 仅检查 HTTP 200，未验证功能完整性
3. ❌ **无资源监控**: 不监控 CPU/内存使用情况
4. ❌ **日志分散**: 通过 ErrorHandler 记录，缺乏结构化日志文件
5. ❌ **配置固定**: 启动参数不够灵活

### 1.3 ConnectionManager 现状

**代码位置**: `src/session/connection-manager.ts`

**核心功能**:
- ✅ 连接状态监控 (disconnected, connecting, connected, reconnecting)
- ✅ 连接诊断信息 (state, lastError, lastReconnectAttempt)
- ✅ 事件监听和通知 (onDiagnosticsChange)
- ✅ 连接重试机制 (retry 方法)
- ✅ 等待连接建立 (ensureConnected 带超时)

**职责边界清晰**:
- ConnectionManager: 连接诊断和状态监控
- SessionOperations: 会话 CRUD 操作
- ConnectionHandler: 连接生命周期管理
- StreamHandler: SSE 事件流处理

**当前限制**:
1. ⚠️ **重连策略简单**: 依赖 OpenCodeServerClient 的自动重连
2. ⚠️ **无连接质量指标**: 不监控延迟、丢包率等
3. ⚠️ **诊断信息有限**: 缺少连接时长、重连次数统计

---

## 2. 改进目标与原则

### 2.1 核心目标

1. **提升稳定性**: 实现自动恢复机制，减少用户手动干预
2. **增强可观测性**: 提供更详细的进程和连接监控信息
3. **保持简洁**: 避免过度设计，适合个人桌面插件规模
4. **向后兼容**: 不破坏现有 API 和功能

### 2.2 设计原则

**✅ 应该做的**:
- 自动重启崩溃的进程
- 增强健康检查（验证关键端点）
- 收集基础资源指标（CPU、内存）
- 结构化日志输出到文件
- 连接质量监控

**❌ 不应该做的**:
- ~~连接池管理~~（单用户无需连接池）
- ~~负载均衡~~（单实例无需负载均衡）
- ~~动态扩缩容~~（桌面应用资源固定）
- ~~分布式会话持久化~~（本地存储足够）
- ~~引入 gRPC/Prometheus/Redis~~（增加复杂度）

---

## 3. 具体改进方案

### 3.1 ServerManager 改进

#### 3.1.1 自动重启机制

**目标**: 进程崩溃后自动重启，减少服务中断时间

**实现要点**:

```typescript
// 在 ServerManager 中添加
private restartAttempts: number = 0;
private maxRestartAttempts: number = 3;
private autoRestartEnabled: boolean = true;

private handleProcessExit(code: number | null, signal: string | null): void {
    this.process = null;

    // 记录退出信息
    this.errorHandler.handleError(
        new Error(`Process exited: code=${code}, signal=${signal}`),
        { module: "ServerManager", function: "handleProcessExit" },
        ErrorSeverity.Info
    );

    // 如果是正常停止，不重启
    if (this.state === "stopped") {
        return;
    }

    // 如果启动阶段失败，记录退出码
    if (this.state === "starting" && code !== null && code !== 0) {
        this.earlyExitCode = code;
        return;
    }

    // 运行中崩溃，尝试自动重启
    if (this.state === "running" && this.autoRestartEnabled) {
        this.attemptAutoRestart();
    } else {
        this.setState("stopped", null);
    }
}

private attemptAutoRestart(): void {
    if (this.restartAttempts >= this.maxRestartAttempts) {
        this.errorHandler.handleError(
            new Error(`Max restart attempts (${this.maxRestartAttempts}) reached`),
            { module: "ServerManager", function: "attemptAutoRestart" },
            ErrorSeverity.Error
        );
        this.setState("error", {
            message: "Server crashed and failed to restart",
            code: "MAX_RESTART_ATTEMPTS"
        });
        return;
    }

    this.restartAttempts++;
    const delay = this.calculateBackoffDelay(this.restartAttempts);

    this.errorHandler.handleError(
        new Error(`Auto-restarting in ${delay}ms (attempt ${this.restartAttempts}/${this.maxRestartAttempts})`),
        { module: "ServerManager", function: "attemptAutoRestart" },
        ErrorSeverity.Warning
    );

    setTimeout(() => {
        void this.start();
    }, delay);
}

private calculateBackoffDelay(attempt: number): number {
    // 指数退避: 1s, 2s, 4s
    return Math.min(1000 * Math.pow(2, attempt - 1), 4000);
}
```

**配置选项**:
```typescript
interface ServerManagerConfig {
    // ... 现有配置
    autoRestart?: boolean;           // 默认 true
    maxRestartAttempts?: number;     // 默认 3
}
```

**重启成功后重置计数器**:
```typescript
async start(): Promise<boolean> {
    // ... 现有启动逻辑

    if (ready) {
        this.setState("running", null);
        this.restartAttempts = 0;  // 重置重启计数
        return true;
    }
    // ...
}
```

#### 3.1.2 增强健康检查

**目标**: 验证服务器功能完整性，不仅仅是 HTTP 200

**实现要点**:

```typescript
async checkServerHealth(): Promise<HealthCheckResult> {
    try {
        // 1. 基础健康检查
        const healthResponse = await fetch(`${this.getUrl()}/health`, {
            method: "GET",
            signal: AbortSignal.timeout(2000),
        });

        if (!healthResponse.ok) {
            return {
                isHealthy: false,
                statusCode: healthResponse.status,
                error: `Health endpoint returned ${healthResponse.status}`
            };
        }

        // 2. 验证关键端点（可选，避免过度检查）
        const sessionsResponse = await fetch(`${this.getUrl()}/sessions`, {
            method: "GET",
            signal: AbortSignal.timeout(2000),
        });

        if (!sessionsResponse.ok) {
            return {
                isHealthy: false,
                statusCode: sessionsResponse.status,
                error: "Sessions endpoint not responding"
            };
        }

        return {
            isHealthy: true,
            statusCode: 200,
            checkedEndpoints: ["/health", "/sessions"]
        };

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
            isHealthy: false,
            error: errorMsg
        };
    }
}
```

**更新类型定义**:
```typescript
interface HealthCheckResult {
    isHealthy: boolean;
    statusCode?: number;
    error?: string;
    checkedEndpoints?: string[];  // 新增
}
```

#### 3.1.3 基础资源监控

**目标**: 监控进程 CPU 和内存使用，用于诊断问题

**实现要点**:

```typescript
interface ProcessMetrics {
    cpu: number;        // CPU 使用率 (%)
    memory: number;     // 内存使用 (MB)
    uptime: number;     // 运行时长 (秒)
    timestamp: number;  // 采集时间戳
}

class ServerManager {
    private metrics: ProcessMetrics | null = null;
    private metricsInterval: ReturnType<typeof setInterval> | null = null;

    private startMetricsCollection(): void {
        // 每 30 秒采集一次（避免过度消耗资源）
        this.metricsInterval = setInterval(() => {
            void this.collectMetrics();
        }, 30000);
    }

    private stopMetricsCollection(): void {
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
            this.metricsInterval = null;
        }
        this.metrics = null;
    }

    private async collectMetrics(): Promise<void> {
        if (!this.process || !this.process.pid) {
            return;
        }

        try {
            // 使用 Node.js 内置 API
            const usage = process.cpuUsage();
            const memUsage = process.memoryUsage();

            this.metrics = {
                cpu: (usage.user + usage.system) / 1000000, // 转换为秒
                memory: memUsage.rss / 1024 / 1024,         // 转换为 MB
                uptime: process.uptime(),
                timestamp: Date.now()
            };

            // 记录到日志（仅在异常时）
            if (this.metrics.memory > 500) {  // 超过 500MB 警告
                this.errorHandler.handleError(
                    new Error(`High memory usage: ${this.metrics.memory.toFixed(2)} MB`),
                    { module: "ServerManager", function: "collectMetrics" },
                    ErrorSeverity.Warning
                );
            }
        } catch (error) {
            // 静默失败，不影响主流程
        }
    }

    getMetrics(): ProcessMetrics | null {
        return this.metrics;
    }
}
```

**在启动/停止时管理采集**:
```typescript
async start(): Promise<boolean> {
    // ... 启动逻辑
    if (ready) {
        this.setState("running", null);
        this.startMetricsCollection();  // 开始采集
        return true;
    }
    // ...
}

stop(): void {
    this.stopMetricsCollection();  // 停止采集
    // ... 停止逻辑
}
```

#### 3.1.4 结构化日志（可选）

**目标**: 将服务器输出保存到文件，便于问题排查

**实现要点**:

```typescript
import * as fs from "fs";
import * as path from "path";

class ServerManager {
    private logFilePath: string | null = null;
    private logStream: fs.WriteStream | null = null;

    private initializeLogging(): void {
        if (!this.config.enableLogging) {
            return;
        }

        // 日志文件路径: .opencode/logs/server-YYYY-MM-DD.log
        const logDir = path.join(this.config.workingDirectory, ".opencode", "logs");
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const date = new Date().toISOString().split("T")[0];
        this.logFilePath = path.join(logDir, `server-${date}.log`);
        this.logStream = fs.createWriteStream(this.logFilePath, { flags: "a" });
    }

    private closeLogging(): void {
        if (this.logStream) {
            this.logStream.end();
            this.logStream = null;
        }
    }

    private writeLog(level: string, message: string): void {
        if (!this.logStream) {
            return;
        }

        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] [${level}] ${message}\n`;
        this.logStream.write(logLine);
    }
}
```

**配置选项**:
```typescript
interface ServerManagerConfig {
    // ... 现有配置
    enableLogging?: boolean;  // 默认 false（避免磁盘占用）
}
```

**注意**: 这是可选功能，默认关闭以避免增加复杂度。

---

### 3.2 ConnectionManager 改进

#### 3.2.1 连接质量监控

**目标**: 监控连接延迟和稳定性

**实现要点**:

```typescript
interface ConnectionQualityMetrics {
    latency: number;           // 平均延迟 (ms)
    reconnectCount: number;    // 重连次数
    connectedDuration: number; // 已连接时长 (秒)
    lastPingTime: number;      // 最后一次 ping 时间戳
}

class ConnectionManager {
    private qualityMetrics: ConnectionQualityMetrics = {
        latency: 0,
        reconnectCount: 0,
        connectedDuration: 0,
        lastPingTime: 0
    };
    private connectionStartTime: number | null = null;

    constructor(client: OpenCodeServerClient, errorHandler: ErrorHandler) {
        // ... 现有构造函数

        // 监听重连事件
        this.client.onReconnectAttempt((info) => {
            this.qualityMetrics.reconnectCount++;
            this.lastReconnectAttempt = info;
            this.notify();
        });

        // 监听连接状态变化
        this.client.onConnectionStateChange((state) => {
            if (state === "connected") {
                this.connectionStartTime = Date.now();
            } else if (state === "disconnected") {
                this.connectionStartTime = null;
            }
        });
    }

    getQualityMetrics(): ConnectionQualityMetrics {
        // 更新连接时长
        if (this.connectionStartTime && this.state === "connected") {
            this.qualityMetrics.connectedDuration =
                Math.floor((Date.now() - this.connectionStartTime) / 1000);
        }
        return { ...this.qualityMetrics };
    }

    async measureLatency(): Promise<number> {
        const start = Date.now();
        try {
            await this.client.healthCheck();
            const latency = Date.now() - start;
            this.qualityMetrics.latency = latency;
            this.qualityMetrics.lastPingTime = Date.now();
            return latency;
        } catch (error) {
            return -1; // 表示失败
        }
    }
}
```

**更新诊断信息**:
```typescript
interface ConnectionDiagnostics {
    state: ConnectionState;
    lastError: Error | null;
    lastReconnectAttempt: ReconnectAttemptInfo | null;
    qualityMetrics?: ConnectionQualityMetrics;  // 新增
}
```

---

## 4. 实施计划

### 4.1 优先级划分

**P0 - 高优先级（核心稳定性）**:
1. ServerManager 自动重启机制
2. 增强健康检查

**P1 - 中优先级（可观测性）**:
3. 基础资源监控
4. ConnectionManager 连接质量监控

**P2 - 低优先级（可选）**:
5. 结构化日志文件

### 4.2 实施步骤

#### 阶段 1: ServerManager 自动重启（P0）

**任务**:
1. 添加重启计数器和配置选项
2. 实现 `handleProcessExit` 方法
3. 实现 `attemptAutoRestart` 和指数退避
4. 更新 `start()` 方法重置计数器
5. 编写单元测试

**验收标准**:
- 进程崩溃后自动重启
- 最多重试 3 次
- 指数退避延迟 (1s, 2s, 4s)
- 重启成功后重置计数器
- 达到最大重试次数后进入 error 状态

#### 阶段 2: 增强健康检查（P0）

**任务**:
1. 更新 `checkServerHealth` 方法
2. 添加 `/sessions` 端点检查
3. 更新 `HealthCheckResult` 类型
4. 编写单元测试

**验收标准**:
- 检查 `/health` 和 `/sessions` 端点
- 返回检查的端点列表
- 超时时间 2 秒
- 任一端点失败则健康检查失败

#### 阶段 3: 基础资源监控（P1）

**任务**:
1. 添加 `ProcessMetrics` 类型定义
2. 实现 `collectMetrics` 方法
3. 实现 `startMetricsCollection` 和 `stopMetricsCollection`
4. 在 `start()` 和 `stop()` 中调用
5. 添加 `getMetrics()` 公共方法
6. 编写单元测试

**验收标准**:
- 每 30 秒采集一次指标
- 监控 CPU、内存、运行时长
- 内存超过 500MB 时记录警告
- 进程停止时停止采集

#### 阶段 4: 连接质量监控（P1）

**任务**:
1. 添加 `ConnectionQualityMetrics` 类型定义
2. 在 ConnectionManager 中添加质量指标字段
3. 实现 `getQualityMetrics()` 方法
4. 实现 `measureLatency()` 方法
5. 监听重连事件更新计数
6. 更新 `ConnectionDiagnostics` 类型
7. 编写单元测试

**验收标准**:
- 记录连接延迟
- 统计重连次数
- 计算已连接时长
- 提供延迟测量方法

---

## 5. 测试策略

### 5.1 单元测试

**ServerManager 测试**:
```typescript
describe("ServerManager - Auto Restart", () => {
    it("should auto-restart on process crash", async () => {
        // 模拟进程崩溃
        // 验证自动重启被触发
    });

    it("should use exponential backoff", async () => {
        // 验证延迟时间: 1s, 2s, 4s
    });

    it("should stop after max attempts", async () => {
        // 验证达到最大重试次数后进入 error 状态
    });

    it("should reset counter on successful start", async () => {
        // 验证重启成功后计数器归零
    });
});

describe("ServerManager - Health Check", () => {
    it("should check multiple endpoints", async () => {
        // 验证检查 /health 和 /sessions
    });

    it("should fail if any endpoint fails", async () => {
        // 验证任一端点失败则整体失败
    });
});
```

**ConnectionManager 测试**:
```typescript
describe("ConnectionManager - Quality Metrics", () => {
    it("should track reconnect count", () => {
        // 验证重连次数统计
    });

    it("should calculate connected duration", () => {
        // 验证连接时长计算
    });

    it("should measure latency", async () => {
        // 验证延迟测量
    });
});
```

### 5.2 集成测试

**场景 1: 进程崩溃恢复**
1. 启动 ServerManager
2. 模拟进程崩溃（kill 进程）
3. 验证自动重启
4. 验证服务恢复正常

**场景 2: 健康检查失败**
1. 启动 ServerManager
2. 停止服务器但保持进程运行
3. 验证健康检查失败
4. 验证状态转换正确

---

## 6. 风险评估与规避

### 6.1 技术风险

| 风险 | 影响 | 概率 | 规避措施 |
|------|------|------|----------|
| 自动重启导致资源耗尽 | 系统崩溃 | 低 | 限制最大重试次数（3次），指数退避延迟 |
| 健康检查增加网络开销 | 性能下降 | 低 | 仅在启动和重启时检查，不定期轮询 |
| 资源监控增加 CPU 开销 | 性能下降 | 低 | 30秒采集间隔，静默失败不影响主流程 |
| 进程监控失败 | 功能缺失 | 低 | 使用 try-catch 包裹，失败不影响核心功能 |

### 6.2 实施风险

| 风险 | 影响 | 概率 | 规避措施 |
|------|------|------|----------|
| 破坏现有功能 | 功能回归 | 中 | 完整的单元测试和集成测试 |
| 增加代码复杂度 | 维护困难 | 低 | 保持简洁设计，避免过度抽象 |
| 配置不当导致问题 | 用户体验差 | 低 | 提供合理的默认值，文档说明配置项 |

---

## 7. 验收标准

### 7.1 功能验收

**ServerManager**:
- ✅ 进程崩溃后自动重启（最多3次）
- ✅ 健康检查验证 `/health` 和 `/sessions` 端点
- ✅ 资源监控收集 CPU、内存、运行时长
- ✅ 配置选项支持启用/禁用自动重启

**ConnectionManager**:
- ✅ 连接质量指标包含延迟、重连次数、连接时长
- ✅ 提供延迟测量方法
- ✅ 诊断信息包含质量指标

### 7.2 性能验收

- ✅ 自动重启延迟不超过 4 秒（最大退避时间）
- ✅ 健康检查超时 2 秒
- ✅ 资源监控开销 < 1% CPU
- ✅ 延迟测量不影响正常连接

### 7.3 可维护性验收

- ✅ 代码覆盖率 > 80%
- ✅ 所有公共方法有 JSDoc 注释
- ✅ 类型定义完整（TypeScript strict mode）
- ✅ 错误处理统一使用 ErrorHandler

---

## 8. 不做的事情（明确排除）

为了保持项目简洁和适合桌面插件规模，以下功能**明确不实施**：

### 8.1 分布式系统特性

❌ **连接池管理**
- 理由：单用户桌面应用，只需一个连接
- 替代：现有的单连接管理已足够

❌ **负载均衡**
- 理由：单实例部署，无需负载均衡
- 替代：无需替代

❌ **动态扩缩容**
- 理由：桌面应用资源固定，无需动态调整
- 替代：无需替代

❌ **分布式会话持久化（Redis）**
- 理由：本地存储足够，无需外部依赖
- 替代：使用 Obsidian 本地存储

### 8.2 企业级监控

❌ **Prometheus 集成**
- 理由：过度复杂，增加依赖
- 替代：简单的内存指标收集

❌ **Grafana 仪表盘**
- 理由：桌面应用无需可视化监控
- 替代：通过 UI 显示基础指标

❌ **分布式追踪（Jaeger/Zipkin）**
- 理由：单实例无需分布式追踪
- 替代：ErrorHandler 的结构化日志

### 8.3 复杂通信协议

❌ **gRPC 替换 HTTP+SSE**
- 理由：HTTP+SSE 已满足需求，gRPC 增加复杂度
- 替代：保持现有 HTTP+SSE

❌ **WebSocket 替换 SSE**
- 理由：SSE 单向流已足够，WebSocket 双向通信非必需
- 替代：保持现有 SSE

### 8.4 高级日志系统

❌ **Winston/Bunyan 日志框架**
- 理由：增加依赖，ErrorHandler 已足够
- 替代：可选的简单文件日志（P2）

❌ **日志聚合（ELK Stack）**
- 理由：桌面应用无需日志聚合
- 替代：本地日志文件

---

## 9. 总结

### 9.1 改进重点

本改进计划聚焦于**实用性和稳定性**，避免过度设计：

1. **自动重启机制**：核心稳定性改进，减少用户手动干预
2. **增强健康检查**：验证服务完整性，提前发现问题
3. **基础监控**：提供诊断信息，便于问题排查
4. **保持简洁**：不引入不必要的依赖和复杂度

### 9.2 与原计划的差异

**原计划问题**：
- 过度设计（连接池、负载均衡、动态扩缩容）
- 不适合桌面插件（gRPC、Prometheus、Redis）
- 架构描述过时（缺少 EventBus、专门处理器）

**新计划优势**：
- 符合实际架构（基于当前代码）
- 适合项目规模（个人桌面插件）
- 可实施性强（无需外部依赖）
- 向后兼容（不破坏现有 API）

### 9.3 预期效果

实施本计划后，预期达到：

- **稳定性提升**：进程崩溃自动恢复，减少 90% 手动重启
- **可观测性增强**：提供详细的进程和连接指标
- **维护性改善**：问题排查更容易，日志更完整
- **用户体验优化**：服务中断时间减少，透明恢复

### 9.4 后续演进

本计划完成后，可考虑的后续改进（非必需）：

1. **UI 集成**：在设置页面显示进程和连接状态
2. **通知优化**：进程重启时显示用户通知
3. **配置增强**：允许用户自定义重启策略
4. **诊断工具**：提供诊断命令导出日志和指标

---

## 附录：参考文档

- **当前架构**: `docs/architecture/ARCHITECTURE.md`
- **项目指南**: `CLAUDE.md`
- **客户端文档**: `src/client/CLAUDE.md`
- **会话管理**: `src/session/CLAUDE.md`
- **ServerManager 实现**: `src/embedded-server/ServerManager.ts`
- **ConnectionManager 实现**: `src/session/connection-manager.ts`
