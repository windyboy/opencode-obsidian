# 内嵌 OpenCode 服务器实现方案

## 1. 项目背景

### 1.1 现状分析

当前 OpenCode Obsidian 插件采用客户端-服务器架构，需要用户手动启动外部 OpenCode 服务器。这种方式存在以下痛点：

- **用户体验不佳**：用户需要额外的步骤来安装和启动 OpenCode CLI
- **配置复杂**：用户需要手动配置服务器 URL 和端口
- **启动门槛高**：对非技术用户不够友好
- **集成度有限**：外部服务器无法直接感知 Obsidian 工作区环境

### 1.2 问题陈述

如何在不影响现有功能的前提下，提供一种更便捷的方式让用户使用 OpenCode 功能？

### 1.3 项目目标

- 实现插件自启动的内嵌 OpenCode 服务器
- 保持与现有外部服务器架构的兼容性
- 提升用户体验，降低使用门槛
- 确保方案的可行性、简洁性和可维护性

## 2. 功能需求

### 2.1 核心功能

| 功能点 | 描述 | 优先级 |
|--------|------|--------|
| 内嵌服务器自动启动 | 插件加载时自动启动 OpenCode 服务器 | P0 |
| 服务器生命周期管理 | 自动处理服务器的启动、停止和重启 | P0 |
| 配置选项 | 提供内嵌服务器相关配置界面 | P1 |
| 兼容性支持 | 保持与外部服务器的兼容性 | P0 |
| 错误处理 | 优雅处理服务器启动和运行错误 | P0 |

### 2.2 非功能性需求

| 需求 | 描述 |
|------|------|
| 性能 | 服务器启动时间 < 15 秒 |
| 资源消耗 | 内存占用 < 200MB，CPU 使用率 < 20% |
| 可维护性 | 代码模块化，便于维护和扩展 |
| 安全性 | 配置适当的安全措施，防止未授权访问 |

## 3. 技术架构

### 3.1 系统架构图

```
┌────────────────────────────────────────────────────────────┐
│                        Obsidian App                        │
├────────────────────────────────────────────────────────────┤
│                  OpenCode Obsidian Plugin                  │
├─────────────────────────┬──────────────────────────────────┤
│   ServerManager (new)   │  Existing Plugin Components      │
├─────────────────────────┼──────────────────────────────────┤
│ ┌─────────────────────┐ │ ┌──────────────────────────────┐ │
│ │  Process Management │ │ │     OpenCodeServerClient     │ │
│ └─────────────────────┘ │ └──────────────────────────────┘ │
│ ┌─────────────────────┐ │ ┌──────────────────────────────┐ │
│ │   Health Checking   │ │ │      ConnectionManager       │ │
│ └─────────────────────┘ │ └──────────────────────────────┘ │
│ ┌─────────────────────┐ │ ┌──────────────────────────────┐ │
│ │     Error Handling  │ │ │      SessionEventBus         │ │
│ └─────────────────────┘ │ └──────────────────────────────┘ │
└─────────────────────────┴──────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────┐
│                  OpenCode Server Process                   │
│ (spawned by ServerManager, either embedded or external)    │
└────────────────────────────────────────────────────────────┘
```

### 3.2 核心组件职责

#### 3.2.1 ServerManager

- **职责**：管理内嵌 OpenCode 服务器的生命周期
- **核心功能**：
  - 服务器进程的启动和停止
  - 服务器健康状态监控
  - 错误处理和恢复
  - 配置管理

#### 3.2.2 现有组件集成

- **OpenCodeServerClient**：与内嵌服务器通信
- **ConnectionManager**：管理连接状态
- **SessionEventBus**：处理服务器事件

### 3.3 技术栈

| 技术/框架 | 用途 | 版本 |
|-----------|------|------|
| TypeScript | 主要开发语言 | 5.8+ |
| Node.js | 运行时环境 | 16+ |
| Obsidian API | 插件开发 | 最新 |
| @opencode-ai/sdk | OpenCode SDK | 最新 |
| Child Process | 进程管理 | Node.js 内置 |

## 4. 实现方案

### 4.1 核心实现步骤

#### 4.1.1 类型定义扩展

在 `src/types.ts` 中扩展 `OpenCodeServerConfig` 接口：

```typescript
export interface OpenCodeObsidianSettings {
  // 现有配置...
  opencodeServer?: {
    url: string;
    useEmbeddedServer?: boolean;
    opencodePath?: string;
    embeddedServerPort?: number;
    // 现有配置...
  };
}
```

#### 4.1.2 ServerManager 实现

创建 `src/server/ServerManager.ts`：

```typescript
export class ServerManager {
  private process: ChildProcess | null = null;
  private state: ServerState = "stopped";
  private lastError: string | null = null;
  
  constructor(config: ServerManagerConfig, errorHandler: ErrorHandler, onStateChange: (state: ServerState) => void) {
    // 初始化...
  }
  
  async start(): Promise<boolean> {
    // 服务器启动逻辑...
  }
  
  stop(): void {
    // 服务器停止逻辑...
  }
  
  private async checkServerHealth(): Promise<boolean> {
    // 健康检查逻辑...
  }
}
```

#### 4.1.3 插件集成

在 `src/main.ts` 中集成 ServerManager：

```typescript
export default class OpenCodeObsidianPlugin extends Plugin {
  private serverManager: ServerManager | null = null;
  
  async onload() {
    // 现有初始化...
    if (this.settings.opencodeServer?.useEmbeddedServer) {
      await this.initializeEmbeddedServer();
    } else if (this.settings.opencodeServer?.url) {
      await this.initializeExternalServer();
    }
  }
  
  private async initializeEmbeddedServer(): Promise<void> {
    // 内嵌服务器初始化逻辑...
  }
  
  private async initializeExternalServer(): Promise<void> {
    // 外部服务器初始化逻辑...
  }
}
```

#### 4.1.4 设置界面

在 `src/settings.ts` 中添加内嵌服务器配置选项：

```typescript
new Setting(containerEl)
  .setName("Use embedded server")
  .setDesc("Start an embedded OpenCode Server automatically")
  .addToggle((toggle) => {
    toggle
      .setValue(this.plugin.settings.opencodeServer?.useEmbeddedServer || false)
      .onChange(async (value) => {
        // 配置更新逻辑...
      });
  });
```

### 4.2 关键算法与流程

#### 4.2.1 服务器启动流程

```
start()
├── 检查服务器状态
├── 如果已运行或正在启动，返回
├── 设置状态为 "starting"
├── 检查服务器是否已在指定端口运行
├── 如果未运行，使用 spawn 启动 OpenCode CLI
├── 配置 CORS 和其他参数
├── 等待服务器启动（最多 15 秒）
├── 执行健康检查
├── 如果健康检查通过，设置状态为 "running"
├── 否则，停止服务器并设置错误状态
└── 返回启动结果
```

#### 4.2.2 健康检查算法

```
checkServerHealth()
├── 发送 GET 请求到 /health 端点
├── 设置 2 秒超时
├── 如果响应状态码为 200，返回 true
├── 否则，返回 false
```

### 4.3 配置管理

| 配置项 | 类型 | 默认值 | 描述 |
|--------|------|--------|------|
| useEmbeddedServer | boolean | false | 是否启用内嵌服务器 |
| opencodePath | string | "opencode" | OpenCode CLI 路径 |
| embeddedServerPort | number | 4096 | 内嵌服务器端口 |
| startupTimeout | number | 15000 | 服务器启动超时时间 |

## 5. 开发计划

### 5.1 开发阶段划分

| 阶段 | 时间 | 任务 |
|------|------|------|
| 阶段 1 | 1 天 | 需求分析与文档编写 |
| 阶段 2 | 2 天 | 核心组件开发（ServerManager） |
| 阶段 3 | 1 天 | 插件集成与配置管理 |
| 阶段 4 | 1 天 | 设置界面开发 |
| 阶段 5 | 1 天 | 测试与调试 |
| 阶段 6 | 0.5 天 | 文档完善与审查 |

### 5.2 里程碑

| 里程碑 | 完成标准 |
|--------|----------|
| 核心组件完成 | ServerManager 类实现并通过单元测试 |
| 插件集成完成 | 内嵌服务器能随插件自动启动和停止 |
| 界面完成 | 设置界面能正确配置内嵌服务器 |
| 功能验证 | 内嵌服务器能正常提供 OpenCode 功能 |
| 文档完成 | 项目文档完整并通过审查 |

## 6. 测试计划

### 6.1 单元测试

- ServerManager 类的核心方法测试
- 健康检查算法测试
- 错误处理逻辑测试

### 6.2 集成测试

- 插件与内嵌服务器的集成测试
- 配置变更的实时应用测试
- 服务器生命周期管理测试

### 6.3 功能测试

- 内嵌服务器自动启动功能
- 外部服务器兼容性测试
- 错误场景处理测试

### 6.4 性能测试

- 服务器启动时间测试
- 内存和 CPU 占用测试

## 7. 风险评估与应对策略

| 风险 | 影响 | 应对策略 |
|------|------|----------|
| OpenCode CLI 未安装 | 内嵌服务器无法启动 | 提供清晰的错误提示，引导用户安装 |
| 端口冲突 | 服务器启动失败 | 实现端口自动检测和选择功能 |
| 资源消耗过高 | 影响 Obsidian 性能 | 优化服务器配置，限制资源使用 |
| 启动超时 | 用户体验下降 | 提供超时提示，允许用户手动重试 |

## 8. 文档审查

### 8.1 可行性评估

- **技术可行性**：基于 Node.js 的 Child Process API 和现有的 OpenCode CLI，技术方案可行
- **资源约束**：实现工作量约 5.5 人天，适合个人小型插件项目
- **依赖情况**：主要依赖 OpenCode CLI，用户需要自行安装

### 8.2 简洁性评估

- **代码复杂度**：采用模块化设计，核心逻辑清晰简洁
- **配置复杂度**：用户只需切换开关并选择端口，配置简单
- **维护成本**：代码结构清晰，便于后续维护和扩展

### 8.3 可维护性评估

- **代码结构**：遵循单一职责原则，模块划分合理
- **错误处理**：完善的错误处理机制，便于问题定位
- **日志记录**：详细的日志记录，便于调试和监控

### 8.4 完整性评估

- **功能覆盖**：覆盖了内嵌服务器的核心功能
- **文档内容**：包含了项目的各个方面，内容完整
- **测试计划**：测试覆盖了主要功能和场景

### 8.5 逻辑连贯性评估

- **架构设计**：架构清晰，组件间关系明确
- **实现流程**：流程设计合理，逻辑连贯
- **文档结构**：结构清晰，章节之间过渡自然

### 8.6 技术合理性评估

- **技术选型**：技术栈选择合理，符合 Obsidian 插件开发规范
- **算法设计**：健康检查和启动流程设计合理
- **安全考虑**：配置了适当的 CORS 策略，确保安全访问

## 9. 结论与建议

### 9.1 结论

本方案是一个可行、简洁且可维护的内嵌 OpenCode 服务器实现方案，符合个人小型插件项目的开发需求与资源约束。方案保持了与现有外部服务器架构的兼容性，同时提供了更便捷的用户体验。

### 9.2 建议

1. **分阶段实施**：按照开发计划分阶段实施，确保每个阶段的质量
2. **充分测试**：在不同环境下进行测试，确保兼容性和稳定性
3. **用户引导**：提供清晰的用户引导和错误提示
4. **文档完善**：持续完善项目文档，便于后续维护
5. **性能优化**：在保证功能的前提下，进一步优化性能

### 9.3 后续展望

- 实现端口自动检测和选择功能
- 提供服务器状态监控界面
- 支持服务器配置的高级选项
- 实现服务器日志查看功能

---

**文档版本**：1.0
**文档日期**：2026-01-18
**文档作者**：[Your Name]
**审查状态**：初稿完成，待审查