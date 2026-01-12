# HTTP Client Alignment - OpenCode Web

## 概述

本次调整将 Obsidian 插件的 OpenCode 客户端与 `opencode-web` 的模式对齐：使用 SDK 客户端作为基础，再提供 Obsidian 专用的包装层，并将 SSE 事件循环放到后台执行，避免阻塞 UI 初始化。

## 目标

1. **对齐架构**：与 `opencode-web` 相同的 SDK client 创建方式
2. **兼容 Obsidian**：保留 `requestUrl` 适配与错误处理
3. **稳定连接**：SSE 事件流后台运行 + 自动重连
4. **简化结构**：单文件实现，避免重复封装

## 当前实现结构

```
src/opencode-server/client.ts
├── createClient(baseUrl, fetch?)
│   └── SDK 客户端创建（与 opencode-web 对齐）
└── OpenCodeServerClient
    ├── Obsidian requestUrl 适配
    ├── 会话/消息封装
    ├── SSE 事件循环（后台运行）
    └── 连接状态管理（connected / reconnecting）
```

## 关键行为变更

- `connect()` **非阻塞**：启动后台 SSE 事件循环后立即返回。
- SSE 断线后自动重连，连接状态在事件流建立后切换为 `connected`。
- 连接逻辑与 `opencode-web` 一致：事件订阅在后台循环中运行。

## 主要文件

- `src/opencode-server/client.ts`：SDK helper + Obsidian wrapper + SSE 处理
- `src/opencode-server/types.ts`：SDK 类型重导出（含 `OpenCodeClient`）
- `src/opencode-server/client.test.ts`：核心事件处理测试

## API 对比

### SDK 风格 API（对齐 opencode-web）

```typescript
import { createClient } from "./opencode-server/client";

const client = createClient("http://127.0.0.1:4096");
const { data: session } = await client.session.create({ body: {} });
await client.session.prompt({
	path: { id: session.id },
	body: { parts: [{ type: "text", text: "Hello" }] },
});
```

### Obsidian 包装层（插件内部）

```typescript
const client = new OpenCodeServerClient(config, errorHandler);
await client.connect(); // 非阻塞
const sessionId = await client.startSession(context, agent, instructions);
await client.sendSessionMessage(sessionId, "Hello", images);

client.onStreamToken((sessionId, token, done) => {});
client.onStreamThinking((sessionId, content) => {});
```

## 迁移提示

- 插件用户无需改动。
- 插件内部仍可继续使用 `OpenCodeServerClient`。
- 若需要直接调用 SDK API，请使用 `createClient`。

## 测试

```bash
pnpm vitest run src/opencode-server/client.test.ts
```
