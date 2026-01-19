# OpenCode Obsidian 实施问题列表

> **生成日期**: 2026-01-19
> **基于文档**: `process-management-audit-report.md`
> **状态**: 待处理

---

## 问题概览

| 问题ID | 模块 | 优先级 | 严重程度 | 状态 | 预计工作量 |
|--------|------|--------|---------|------|-----------|
| ISS-001 | 测试 | P0 | 高 | 🔴 未开始 | 2-3小时 |
| ISS-002 | ServerManager | P0 | 中 | 🔴 未开始 | 1-2小时 |
| ISS-003 | ConnectionManager | P0 | 中 | 🔴 未开始 | 1-2小时 |
| ISS-004 | ServerManager | P1 | 中 | 🟡 可选 | 3-4小时 |
| ISS-005 | ServerManager | P2 | 低 | 🟢 可选 | 2-3小时 |
| ISS-006 | 文档 | P0 | 低 | 🔴 未开始 | 1-2小时 |

**总计**: 6 个问题  
- 🔴 高优先级: 4 个  
- 🟡 中优先级: 1 个  
- 🟢 低优先级: 1 个

---

## 问题详情

### ISS-001: ServerManager 自动重启测试缺失

**模块**: 测试  
**优先级**: P0 (高)  
**严重程度度**: 高  
**状态**: 🔴 未开始  
**预计工作量**: 2-3 小时

#### 问题描述

ServerManager 自动重启机制已完全实现，但缺少对应的单元测试。这是一个核心功能，需要确保其在各种场景下正确工作。

#### 影响范围

- 自动重启逻辑可靠性
- 指数退避机制验证
- 最大重试次数限制测试
- 进程崩溃恢复能力

#### 缺失的测试用例

1. **进程崩溃自动重启测试**
   - 模拟进程退出事件
   - 验证自动重启被触发
   - 验证重启计数器递增

2. **指数退避延迟测试**
   - 验证第1次重启延迟: 1000ms
   - 验证第2次重启延迟: 2000ms
   - 验证第3次重启延迟: 4000ms

3. **最大重试次数测试**
   - 验证达到最大重试次数(3次)后停止重启
   - 验证状态转换为 error
   - 验证错误代码为 MAX_RESTART_ATTEMPTS

4. **正常停止不重启测试**
   - 验证手动调用 stop() 后不触发自动重启
   - 验证状态保持为 stopped

5. **启动阶段失败不重启测试**
   - 验证启动阶段进程退出不触发自动重启
   - 验证早期退出码被正确记录

6. **重启成功重置计数器测试**
   - 验证重启成功后计数器归零
   - 验证状态转换为 running

#### 相关文件

- `src/embedded-server/ServerManager.ts` (第 31-33, 170-237 行)
- `src/embedded-server/ServerManager.test.ts`

#### 实现建议

```typescript
// src/embedded-server/ServerManager.test.ts

describe("ServerManager - Auto Restart", () => {
    describe("process crash handling", () => {
        it("should auto-restart on process crash", async () => {
            // Arrange
            const mockProcess = createMockProcess();
            mockKillSpy.mockClear();
            
            // Act
            await serverManager.start();
            mockProcess.emit('exit', 1, null);
            await vi.advanceTimersByTimeAsync(1000);
            
            // Assert
            expect(serverManager.getState()).toBe('running');
            expect(spawn).toHaveBeenCalled(); // 验证重启
        });

        it("should not restart when manually stopped", async () => {
            // Arrange
            const mockProcess = createMockProcess();
            
            // Act
            await serverManager.start();
            serverManager.stop();
            mockProcess.emit('exit', 1, null);
            
            // Assert
            expect(serverManager.getState()).toBe('stopped');
        });
    });

    describe("exponential backoff", () => {
        it("should use 1s delay for first restart", async () => {
            // 测试第一次重启延迟为 1000ms
        });

        it("should use 2s delay for second restart", async () => {
            // 测试第二次重启延迟为 2000ms
        });

        it("should use 4s delay for third restart", async () => {
            // 测试第三次重启延迟为 4000ms
        });

        it("should not exceed 4s maximum delay", async () => {
            // 测试最大延迟不超过 4000ms
        });
    });

    describe("max restart attempts", () => {
        it("should stop after 3 failed restart attempts", async () => {
            // 测试达到最大重试次数后停止
        });

        it("should set error state with MAX_RESTART_ATTEMPTS code", async () => {
            // 测试错误状态和错误代码
        });

        it("should not attempt restart after max attempts", async () => {
            // 测试超过最大次数后不再尝试
        });
    });

    describe("counter reset", () => {
        it("should reset restart counter on successful start", async () => {
            // 测试成功重启后计数器归零
        });
    });
});
```

#### 验收标准

- ✅ 所有测试用例通过
- ✅ 测试覆盖率 > 90% (针对自动重启相关代码)
- ✅ 无测试中的 TODO 或 skip 标记
- ✅ 测试运行时间 < 30 秒

#### 依赖项

- 无

#### 阻塞问题

- 无

---

### ISS-002: ServerManager 健康检查测试缺失

**模块**: ServerManager  
**优先级**: P0 (高)  
**严重程度度**: 中  
**状态**: 🔴 未开始  
**预计工作量**: 1-2 小时

#### 问题描述

增强健康检查功能已完全实现，包括多端点检查 (/health 和 /sessions)，但缺少对应的单元测试。

#### 影响范围

- 健康检查逻辑可靠性
- 多端点验证正确性
- 超时控制验证
- 错误处理验证

#### 缺失的测试用例

1. **基础健康检查成功测试**
   - 验证 /health 端点返回 200 时健康检查通过
   - 验证返回结果包含 checkedEndpoints

2. **多端点检查测试**
   - 验证同时检查 /health 和 /sessions 端点
   - 验证 checkedEndpoints 包含两个端点

3. **单端点失败测试**
   - 验证 /health 端点失败时健康检查失败
   - 验证错误信息正确

4. **多端点失败测试**
   - 验证 /sessions 端点失败时整体健康检查失败
   - 验证失败时仍返回 checkedEndpoints

5. **超时测试**
   - 验证请求超时后健康检查失败
   - 验证超时时间为 2 秒

6. **双 API 支持测试**
   - 验证 useRequestUrl=true 时使用 Obsidian API
   - 验证 useRequestUrl=false 时使用标准 fetch

#### 相关文件

- `src/utils/health-check.ts`
- `src/embedded-server/ServerManager.ts` (第 142-145 行)
- `src/client/types.ts` (第 75-87 行)

#### 实现建议

```typescript
// src/embedded-server/ServerManager.test.ts

describe("ServerManager - Health Check", () => {
    describe("basic health check", () => {
        it("should pass when /health returns 200", async () => {
            // Arrange
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
            });
            
            // Act
            const result = await serverManager.checkServerHealth();
            
            // Assert
            expect(result.isHealthy).toBe(true);
            expect(result.statusCode).toBe(200);
        });
    });

    describe("multi-endpoint check", () => {
        it("should check both /health and /sessions endpoints", async () => {
            // 测试多端点检查
        });

        it("should include both endpoints in checkedEndpoints", async () => {
            // 测试 checkedEndpoints 包含两个端点
        });
    });

    describe("failure handling", () => {
        it("should fail when /health endpoint fails", async () => {
            // 测试 /health 端点失败
        });

        it("should fail when /sessions endpoint fails", async () => {
            // 测试 /sessions 端点失败
        });

        it("should include error message in result", async () => {
            // 测试错误信息
        });
    });

    describe("timeout", () => {
        it("should timeout after 2 seconds", async () => {
            // 测试超时
        });
    });
});
```

#### 验收标准

- ✅ 所有测试用例通过
- ✅ 测试覆盖率 > 85% (针对健康检查相关代码)
- ✅ 验证双 API 支持的正确性

#### 依赖项

- 无

#### 阻塞问题

- 无

---

### ISS-003: ConnectionManager 连接质量测试缺失

**模块**: ConnectionManager  
**优先级**: P0 (高)  
**严重程度度**: 中  
**状态**: 🔴 未开始  
**预计工作量**: 1-2 小时

#### 问题描述

连接质量监控功能已完全实现，包括延迟测量、重连计数、连接时长等，但缺少对应的单元测试。

#### 影响范围

- 连接质量指标准确性
- 延迟测量可靠性
- 重连计数正确性
- 连接时长计算准确性

#### 缺失的测试用例

1. **连接时长计算测试**
   - 验证连接后 connectedDuration 正确增长
   - 验证断开连接后时长停止增长
   - 验证时长以秒为单位

2. **延迟测量测试**
   - 验证成功测量延迟时返回正数
   - 验证测量失败时返回 -1
   - 验证延迟值更新到质量指标
   - 验证 lastPingTime 更新

3. **重连计数测试**
   - 验证重连事件触发时计数器递增
   - 验证多次重连时计数器正确累加

4. **质量指标初始化测试**
   - 验证初始状态所有指标为 0
   - 验证指标结构符合接口定义

5. **诊断信息集成测试**
   - 验证 getDiagnostics() 包含 qualityMetrics
   - 验证质量指标实时更新

#### 相关文件

- `src/session/connection-manager.ts` (第 19-20, 37-43, 69-88 行)
- `src/client/types.ts` (第 89-100 行)
- `src/session/connection-manager.test.ts`

#### 实现建议

```typescript
// src/session/connection-manager.test.ts

describe("ConnectionManager - Quality Metrics", () => {
    describe("connection duration", () => {
        it("should calculate connected duration in seconds", async () => {
            // Arrange
            vi.useFakeTimers();
            
            // Act
            await manager.connect();
            vi.advanceTimersByTime(5000);
            
            // Assert
            const metrics = manager.getQualityMetrics();
            expect(metrics.connectedDuration).toBeGreaterThanOrEqual(5);
        });

        it("should stop counting after disconnect", async () => {
            // 测试断开后时长停止增长
        });
    });

    describe("latency measurement", () => {
        it("should measure latency on health check success", async () => {
            // Arrange
            mockHealthCheck.mockResolvedValue(undefined);
            
            // Act
            const latency = await manager.measureLatency();
            
            // Assert
            expect(latency).toBeGreaterThan(0);
            expect(manager.getQualityMetrics().latency).toBe(latency);
        });

        it("should return -1 on health check failure", async () => {
            // 测试失败时返回 -1
        });

        it("should update lastPingTime", async () => {
            // 测试 lastPingTime 更新
        });
    });

    describe("reconnect count", () => {
        it("should increment on reconnect attempt", async () => {
            // 测试重连计数递增
        });

        it("should accumulate on multiple reconnects", async () => {
            // 测试多次重连计数累加
        });
    });

    describe("metrics initialization", () => {
        it("should initialize all metrics to zero", () => {
            // 测试初始值
        });
    });

    describe("diagnostics integration", () => {
        it("should include qualityMetrics in diagnostics", () => {
            // 测试诊断信息包含质量指标
        });

        it("should update metrics in real-time", async () => {
            // 测试实时更新
        });
    });
});
```

#### 验收标准

- ✅ 所有测试用例通过
- ✅ 测试覆盖率 > 85% (针对连接质量相关代码)
- ✅ 验证指标计算的准确性

#### 依赖项

- 无

#### 阻塞问题

- 无

---

### ISS-004: ServerManager 基础资源监控未实施

**模块**: ServerManager  
**优先级**: P1 (中)  
**严重程度度**: 中  
**状态**: 🟡 可选  
**预计工作量**: 3-4 小时

#### 问题描述

基础资源监控功能在计划中定义但未实施。该功能可以监控进程的 CPU、内存使用情况，用于诊断性能问题。

#### 影响范围

- 问题诊断能力
- 性能监控
- 资源使用情况追踪

#### 需要实现的功能

1. **ProcessMetrics 接口定义**
   ```typescript
   interface ProcessMetrics {
       cpu: number;        // CPU 使用率 (%)
       memory: number;     // 内存使用 (MB)
       uptime: number;     // 运行时长 (秒)
       timestamp: number;  // 采集时间戳
   }
   ```

2. **指标采集方法**
   - 使用 Node.js `process.cpuUsage()` 和 `process.memoryUsage()`
   - 每 30 秒采集一次
   - 静默失败，不影响主流程

3. **定时采集控制**
   - 在 `start()` 时启动采集
   - 在 `stop()` 时停止采集
   - 使用 `setInterval` 和 `clearInterval`

4. **内存警告**
   - 内存超过 500MB 时记录警告
   - 通过 ErrorHandler 记录

5. **公共 API**
   - `getMetrics()`: 获取当前指标
   - 私有字段避免外部修改

#### 相关文件

- `src/embedded-server/ServerManager.ts`
- `src/embedded-server/types.ts` (添加 ProcessMetrics 类型)

#### 实现建议

```typescript
// src/embedded-server/types.ts

export interface ProcessMetrics {
    cpu: number;
    memory: number;
    uptime: number;
    timestamp: number;
}

// src/embedded-server/ServerManager.ts

class ServerManager {
    private metrics: ProcessMetrics | null = null;
    private metricsInterval: ReturnType<typeof setInterval> | null = null;

    private startMetricsCollection(): void {
        this.metricsInterval = setInterval(() => {
            void this.collectMetrics();
        }, 30000); // 30 seconds
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
            const usage = process.cpuUsage();
            const memUsage = process.memoryUsage();

            this.metrics = {
                cpu: (usage.user + usage.system) / 1000000,
                memory: memUsage.rss / 1024 / 1024,
                uptime: process.uptime(),
                timestamp: Date.now()
            };

            if (this.metrics.memory > 500) {
                this.errorHandler.handleError(
                    new Error(`High memory usage: ${this.metrics.memory.toFixed(2)} MB`),
                    { module: "ServerManager", function: "collectMetrics" },
                    ErrorSeverity.Warning
                );
            }
        } catch (error) {
            // Silent failure
        }
    }

    getMetrics(): ProcessMetrics | null {
        return this.metrics ? { ...this.metrics } : null;
    }

    async start(): Promise<boolean> {
        // ... existing code
        if (ready) {
            this.setState("running", null);
            this.restartAttempts = 0;
            this.startMetricsCollection(); // 添加
            return true;
        }
        // ...
    }

    stop(): void {
        this.stopMetricsCollection(); // 添加
        // ... existing code
    }
}
```

#### 验收标准

- ✅ ProcessMetrics 类型定义完整
- ✅ 指标采集每 30 秒执行一次
- ✅ 启动时开始采集，停止时停止采集
- ✅ 内存超过 500MB 时记录警告
- ✅ `getMetrics()` 返回指标副本
- ✅ 错误静默处理，不影响主流程

#### 依赖项

- 无

#### 阻塞问题

- 无

#### 备注

- 这是 P1 中优先级功能，可根据实际需求决定是否实施
- 符合"保持简洁"原则，对桌面插件来说是可选功能

---

### ISS-005: ServerManager 结构化日志未实施

**模块**: ServerManager  
**优先级**: P2 (低)  
**严重程度度**: 低  
**状态**: 🟢 可选  
**预计工作量**: 2-3 小时

#### 问题描述

结构化日志功能在计划中定义为可选功能 (P2)，用于将服务器输出保存到文件，便于问题排查。目前未实施。

#### 影响范围

- 问题排查便利性
- 日志持久化
- 调试效率

#### 需要实现的功能

1. **日志文件管理**
   - 日志文件路径: `.opencode/logs/server-YYYY-MM-DD.log`
   - 自动创建日志目录
   - 使用追加模式写入

2. **日志格式**
   ```
   [2026-01-19T10:30:45.123Z] [INFO] Server started
   [2026-01-19T10:30:45.456Z] [ERROR] Connection failed
   ```

3. **配置选项**
   - `enableLogging`: 是否启用日志 (默认 false)
   - 避免磁盘占用

4. **日志级别**
   - INFO
   - WARNING
   - ERROR

5. **流管理**
   - 使用 `fs.createWriteStream`
   - 在停止时正确关闭流

#### 相关文件

- `src/embedded-server/ServerManager.ts`
- `src/embedded-server/types.ts` (添加 enableLogging 配置)

#### 实现建议

```typescript
// src/embedded-server/types.ts

export interface ServerManagerConfig {
    // ... existing config
    enableLogging?: boolean;  // 默认 false
}

// src/embedded-server/ServerManager.ts

import * as fs from "fs";
import * as path from "path";

class ServerManager {
    private logFilePath: string | null = null;
    private logStream: fs.WriteStream | null = null;

    private initializeLogging(): void {
        if (!this.config.enableLogging) {
            return;
        }

        const logDir = path.join(
            this.config.workingDirectory,
            ".opencode",
            "logs"
        );
        
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

    async start(): Promise<boolean> {
        this.initializeLogging(); // 添加
        // ... existing code
        if (ready) {
            this.writeLog("INFO", "Server started successfully");
            return true;
        }
        // ...
    }

    stop(): void {
        this.writeLog("INFO", "Server stopped");
        this.closeLogging(); // 添加
        // ... existing code
    }

    private handleProcessExit(code: number | null, signal: string | null): void {
        this.writeLog("INFO", `Process exited: code=${code}, signal=${signal}`);
        // ... existing code
    }
}
```

#### 验收标准

- ✅ 日志文件正确创建在 `.opencode/logs/` 目录
- ✅ 日志文件名包含日期
- ✅ 日志格式符合 `[timestamp] [level] message`
- ✅ 启用日志时正确写入，禁用时不写入
- ✅ 停止时正确关闭文件流

#### 依赖项

- 无

#### 阻塞问题

- 无

#### 备注

- 这是 P2 低优先级功能，明确标记为可选
- ErrorHandler 已提供日志功能，此功能用于持久化
- 需要注意磁盘占用，建议默认禁用

---

### ISS-006: 功能文档更新缺失

**模块**: 文档  
**优先级**: P0 (高)  
**严重程度度**: 低  
**状态**: 🔴 未开始  
**预计工作量**: 1-2 小时

#### 问题描述

进程管理重构后的新功能 (自动重启、增强健康检查、连接质量监控) 已实现，但文档未更新，用户不知道如何使用这些新功能。

#### 影响范围

- 用户体验
- 功能可发现性
- 问题排查效率

#### 需要更新的文档

1. **README.md**
   - 添加新功能说明
   - 更新架构描述
   - 添加自动重启配置说明

2. **src/embedded-server/CLAUDE.md**
   - 更新 ServerManager 功能列表
   - 添加自动重启机制说明
   - 添加健康检查说明

3. **docs/architecture/ARCHITECTURE.md**
   - 更新组件职责
   - 添加进程管理流程说明

4. **CLAUDE.md**
   - 更新关键文件位置
   - 添加新功能的使用示例

#### 需要添加的内容

1. **自动重启机制**
   - 功能说明
   - 配置选项 (autoRestart, maxRestartAttempts)
   - 重启策略说明 (指数退避)
   - 示例代码

2. **增强健康检查**
   - 多端点检查说明
   - 健康检查配置
   - 故障排查指南

3. **连接质量监控**
   - 质量指标说明
   - 如何获取指标
   - 指标含义解释

#### 相关文件

- `README.md`
- `src/embedded-server/CLAUDE.md`
- `docs/architecture/ARCHITECTURE.md`
- `CLAUDE.md`

#### 实现建议

```markdown
## README.md 新增内容

### 自动重启机制

OpenCode Obsidian 插件实现了服务器进程自动重启机制，当进程意外崩溃时会自动尝试恢复。

#### 配置选项

```typescript
const config = {
    autoRestart: true,              // 启用自动重启 (默认: true)
    maxRestartAttempts: 3           // 最大重试次数 (默认: 3)
};
```

#### 重启策略

- **指数退避**: 重启延迟为 1s, 2s, 4s
- **最大重试**: 达到最大次数后停止并进入 error 状态
- **智能判断**: 正常停止不会触发自动重启

### 增强健康检查

健康检查现在验证多个端点以确认服务器功能完整性。

#### 检查端点

- `/health` - 基础健康检查
- `/sessions` - 会话管理端点 (可选)

#### 健康检查结果

```typescript
{
    isHealthy: true,
    statusCode: 200,
    checkedEndpoints: ["/health", "/sessions"]
}
```

### 连接质量监控

ConnectionManager 现在提供连接质量指标。

#### 获取质量指标

```typescript
const metrics = connectionManager.getQualityMetrics();
console.log(`Latency: ${metrics.latency}ms`);
console.log(`Reconnects: ${metrics.reconnectCount}`);
console.log(`Duration: ${metrics.connectedDuration}s`);
```

#### 测量延迟

```typescript
const latency = await connectionManager.measureLatency();
console.log(`Current latency: ${latency}ms`);
```
```

#### 验收标准

- ✅ README.md 包含所有新功能说明
- ✅ 提供配置示例
- ✅ 提供代码使用示例
- ✅ 更新架构文档
- ✅ 更新关键文件位置文档

#### 依赖项

- ISS-001, ISS-002, ISS-003 (建议先完成测试再更新文档)

#### 阻塞问题

- 无

---

## 优先级排序

### P0 - 高优先级 (必须完成)

1. **ISS-001**: ServerManager 自动重启测试缺失 (2-3小时)
2. **ISS-002**: ServerManager 健康检查测试缺失 (1-2小时)
3. **ISS-003**: ConnectionManager 连接质量测试缺失 (1-2小时)
4. **ISS-006**: 功能文档更新缺失 (1-2小时)

**P0 总计**: 5-9 小时

### P1 - 中优先级 (建议完成)

1. **ISS-004**: ServerManager 基础资源监控未实施 (3-4小时)

**P1 总计**: 3-4 小时

### P2 - 低优先级 (可选)

1. **ISS-005**: ServerManager 结构化日志未实施 (2-3小时)

**P2 总计**: 2-3 小时

---

## 实施路线图

### 阶段 1: 测试完善 (Week 1)

**目标**: 补充所有核心功能的单元测试

**任务**:
1. ISS-001: ServerManager 自动重启测试 (2-3h)
2. ISS-002: ServerManager 健康检查测试 (1-2h)
3. ISS-003: ConnectionManager 连接质量测试 (1-2h)

**验收**:
- 所有测试通过
- 测试覆盖率 > 80%
- 无测试中的 skip 标记

### 阶段 2: 文档更新 (Week 1)

**目标**: 更新文档以反映新功能

**任务**:
1. ISS-006: 功能文档更新 (1-2h)

**验收**:
- README.md 包含新功能说明
- 提供配置和使用示例
- 架构文档更新

### 阶段 3: 可选功能 (Week 2)

**目标**: 实施可选的增强功能

**任务**:
1. ISS-004: 基础资源监控 (3-4h, 可选)
2. ISS-005: 结构化日志 (2-3h, 可选)

**验收**:
- 功能按计划实施
- 通过单元测试
- 更新相关文档

---

## 风险评估

### 实施风险

| 问题ID | 风险 | 可能性 | 影响 | 缓解措施 |
|--------|------|--------|------|---------|
| ISS-001 | 测试难以编写 | 低 | 中 | 参考现有测试模式，使用 mock |
| ISS-002 | Mock 复杂度高 | 低 | 低 | 简化测试场景，关注核心逻辑 |
| ISS-003 | 异步测试不稳定 | 低 | 中 | 使用 vi.advanceTimersByTimeAsync |
| ISS-004 | 影响 CPU 性能 | 低 | 低 | 30秒间隔，静默失败 |
| ISS-005 | 磁盘占用 | 中 | 低 | 默认禁用，文档说明 |
| ISS-006 | 文档不准确 | 中 | 低 | 代码审查时验证 |

### 依赖风险

- **测试依赖**: ISS-006 依赖 ISS-001, ISS-002, ISS-003
- **无其他依赖**: 各问题相对独立

---

## 成功标准

### 整体目标

完成所有 P0 高优先级问题，确保代码质量和用户体验。

### 具体指标

- ✅ 测试覆盖率 > 80%
- ✅ 所有 P0 测试通过
- ✅ 文档完整准确
- ✅ 无未处理的 TODO 或 skip
- ✅ 代码审查通过

### 质量标准

- 代码符合项目规范
- 测试覆盖核心逻辑
- 文档清晰易懂
- 无引入新问题

---

## 资源分配

### 人力估计

| 阶段 | 任务 | P0 | P1 | P2 | 总计 |
|------|------|----|----|----|------|
| 阶段 1 | 测试完善 | 5-9h | 0h | 0h | 5-9h |
| 阶段 2 | 文档更新 | 1-2h | 0h | 0h | 1-2h |
| 阶段 3 | 可选功能 | 0h | 3-4h | 2-3h | 5-7h |
| **总计** | | **6-11h** | **3-4h** | **2-3h** | **11-18h** |

### 时间线

- **Week 1**: 阶段 1 + 阶段 2 (6-11 小时)
- **Week 2**: 阶段 3 可选 (5-7 小时)

---

## 附录

### 问题状态图例

- 🔴 **未开始**: 尚未开始实施
- 🟡 **进行中**: 正在实施中
- 🟢 **已完成**: 已完成实施
- ⚪ **已阻塞**: 被其他问题阻塞

### 优先级图例

- **P0**: 高优先级，必须完成
- **P1**: P1 中优先级，建议完成
- **P2**: 低优先级，可选

### 严重程度图例

- **高**: 严重影响功能或稳定性
- **中**: 影响功能或用户体验
- **低**: 轻微影响，可延后处理

### 相关文档

- `process-management-audit-report.md` - 审计报告
- `docs/process-management-refactor-plan.md` - 重构计划
- `CLAUDE.md` - 项目指南

---

**文档生成时间**: 2026-01-19  
**生成工具**: Droid (AI Assistant)  
**下次更新**: 完成问题后更新状态
