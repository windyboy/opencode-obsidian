# HTTP Client Refactor - OpenCode Web Integration

## 概述

本次重构将 Obsidian 插件的 HTTP client 实现改为与 opencode-web 项目保持一致的架构，同时保持与 Obsidian 平台的兼容性。

## 重构目标

1. **统一架构**：与 opencode-web 使用相同的客户端架构思想
2. **保持兼容性**：维持现有的 API 接口，确保无缝迁移
3. **提升可维护性**：使用更标准化的实现方式
4. **类型安全**：改进类型定义和错误处理

## 架构变更

### 之前的实现

```
OpenCodeServerClient (自定义实现)
├── 手动 HTTP 请求处理
├── 原生 EventSource SSE 处理
├── 自定义连接管理
└── Obsidian requestUrl 集成
```

### 新的实现

```
OpenCodeClientAdapter (兼容性层)
├── OpenCodeSDKClient (SDK 风格实现)
│   ├── 标准化 HTTP API
│   ├── 事件处理抽象
│   └── Obsidian requestUrl 适配
├── 向后兼容接口
└── 统一错误处理
```

## 新增文件

### 1. `src/opencode-server/sdk-client.ts`

-   **作用**：核心 SDK 风格的客户端实现
-   **特点**：
    -   使用 Obsidian 的 `requestUrl` API
    -   标准化的 HTTP 方法（health, createSession, sendPrompt 等）
    -   事件驱动的 SSE 处理
    -   完整的类型定义

### 2. `src/opencode-server/sdk-types.ts`

-   **作用**：类型定义和接口
-   **特点**：
    -   重导出 SDK 类型
    -   Obsidian 特定的扩展类型
    -   事件类型定义

### 3. `src/opencode-server/client-adapter.ts`

-   **作用**：向后兼容性适配器
-   **特点**：
    -   保持原有的 API 接口
    -   内部使用新的 SDK 客户端
    -   事件回调转换

### 4. `src/opencode-server/sdk-client.test.ts`

-   **作用**：单元测试
-   **特点**：
    -   测试核心功能
    -   Mock Obsidian API
    -   验证类型安全

## API 对比

### opencode-web 风格 API

```typescript
// 健康检查
const health = await client.health();

// 创建会话
const session = await client.createSession({ title: "My Session" });

// 发送消息
await client.sendPrompt(sessionId, {
	parts: [{ type: "text", text: "Hello" }],
});

// 事件订阅
await client.subscribeToEvents({
	onPartUpdate: (data) => console.log(data),
	onError: (error) => console.error(error),
});
```

### 保持的向后兼容 API

```typescript
// 原有接口保持不变
await client.connect();
await client.startSession(context, agentId, sessionId);
await client.sendSessionMessage(sessionId, message, images);
await client.interruptSession(sessionId);

// 原有回调保持不变
client.onStreamToken((sessionId, token, done) => {});
client.onError((error) => {});
```

## 主要改进

### 1. 类型安全

-   完整的 TypeScript 类型定义
-   严格的接口约束
-   更好的 IDE 支持

### 2. 错误处理

-   统一的错误处理机制
-   更详细的错误信息
-   优雅的降级处理

### 3. 可测试性

-   模块化设计
-   依赖注入
-   完整的单元测试

### 4. 可维护性

-   清晰的职责分离
-   标准化的 API 设计
-   更好的代码组织

## 迁移指南

### 对于插件用户

-   **无需任何更改**：所有现有功能保持不变
-   **性能提升**：更高效的网络处理
-   **更好的错误提示**：改进的错误信息

### 对于开发者

-   **新功能开发**：推荐使用新的 SDK 风格 API
-   **现有代码**：可以继续使用，无需修改
-   **测试**：新增的单元测试提供更好的代码质量保证

## 配置变更

### package.json

```json
{
	"dependencies": {
		"@opencode-ai/sdk": "latest"
		// ... 其他依赖保持不变
	}
}
```

### 主要文件更新

-   `src/main.ts`：更新客户端初始化
-   `src/settings.ts`：改进连接测试（使用健康检查）

## 测试验证

### 类型检查

```bash
pnpm check  # ✅ 通过
```

### 代码规范

```bash
pnpm lint   # ✅ 通过
```

### 单元测试

```bash
pnpm vitest run src/opencode-server/sdk-client.test.ts
```

## 未来计划

1. **完全迁移**：逐步将所有代码迁移到新的 SDK 风格 API
2. **移除旧代码**：在确保稳定后移除旧的实现
3. **功能增强**：利用新架构添加更多功能
4. **性能优化**：进一步优化网络和事件处理

## 总结

本次重构成功地将 Obsidian 插件的 HTTP client 实现与 opencode-web 项目保持一致，同时：

-   ✅ **保持了完全的向后兼容性**
-   ✅ **改进了代码质量和可维护性**
-   ✅ **增强了类型安全**
-   ✅ **提供了更好的测试覆盖**
-   ✅ **遵循了项目的编码规范**

这为未来的功能开发和维护奠定了坚实的基础。
