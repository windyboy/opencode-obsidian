# OpenCode Server Client

## 概述

`OpenCodeServerClient` 是 OpenCode Obsidian 插件与 OpenCode Server 通信的核心客户端。它基于 `@opencode-ai/sdk/client` SDK，提供了 Obsidian 环境下的适配和封装。

## 架构

```
┌─────────────────────────────────┐
│   OpenCodeServerClient         │
│   (Obsidian Wrapper)            │
├─────────────────────────────────┤
│  - Session Management          │
│  - Message Sending             │
│  - Event Handling              │
│  - Connection Management       │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│   @opencode-ai/sdk/client      │
│   (Official SDK)                │
├─────────────────────────────────┤
│  - HTTP API Calls              │
│  - SSE Event Stream            │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│   Obsidian requestUrl API       │
│   (Custom Fetch Implementation) │
└─────────────────────────────────┘
```

## 核心功能

### 1. 连接管理

```typescript
// 连接到 OpenCode Server（非阻塞）
await client.connect();

// 断开连接
await client.disconnect();

// 获取连接状态
const state = client.getConnectionState(); // "disconnected" | "connecting" | "connected" | "reconnecting"

// 检查是否已连接
const isConnected = client.isConnected();
```

**特性**：
- `connect()` 是非阻塞的，后台启动 SSE 事件循环
- 自动重连机制（指数退避策略）
- 可配置重连参数（延迟、最大尝试次数）

### 2. 会话管理

```typescript
// 创建新会话
const sessionId = await client.createSession("Session Title");

// 启动会话（带上下文）
const sessionId = await client.startSession(
  context,      // SessionContext
  agent,        // string
  instructions  // string[]
);

// 确保会话存在（本地缓存或从服务器获取）
const exists = await client.ensureSession(sessionId);

// 中止会话
await client.abortSession(sessionId);

// 获取当前会话 ID
const currentId = client.getCurrentSessionId();
```

**会话缓存**：
- 本地维护会话 Map，减少服务器请求
- 自动从服务器获取缺失的会话信息

### 3. 消息发送

```typescript
// 发送消息（核心方法）
await client.sendMessage(sessionId, "Hello, world!");

// 发送会话消息（兼容方法，支持图片）
await client.sendSessionMessage(sessionId, "Hello", images);
```

**特性**：
- 支持文本消息
- 图片支持待实现（TODO）
- 流式响应通过 SSE 事件接收

### 4. 事件处理

```typescript
// 注册流式 token 回调
client.onStreamToken((sessionId, token, done) => {
  // token: 流式文本内容
  // done: 是否完成
});

// 注册思考内容回调
client.onStreamThinking((sessionId, content) => {
  // content: 思考/推理内容
});

// 注册错误回调
client.onError((error) => {
  // error: Error 对象
});

// 注册进度更新回调
client.onProgressUpdate((sessionId, progress) => {
  // progress: ProgressUpdate 对象
});

// 注册会话结束回调
client.onSessionEnd((sessionId, reason) => {
  // reason: 结束原因（可选）
});
```

**支持的事件类型**：
- `message.part.updated` / `message.updated` - 消息更新
- `session.idle` / `session.completed` - 会话完成
- `session.progress` - 进度更新
- `session.ended` / `session.aborted` - 会话结束

### 5. 健康检查

```typescript
// 检查服务器健康状态
const isHealthy = await client.healthCheck();
```

## 配置

```typescript
interface OpenCodeServerConfig {
  url: string;                    // 服务器 URL（必需）
  requestTimeoutMs?: number;       // 请求超时（默认 10000ms）
  autoReconnect?: boolean;         // 自动重连（默认 true）
  reconnectDelay?: number;         // 重连延迟基数（默认 1000ms）
  reconnectMaxAttempts?: number;   // 最大重试次数（默认 10，0 = 无限制）
  forceSdkEventStream?: boolean;   // 强制使用 SDK 事件流（默认 false）
}
```

## Obsidian 适配

### 自定义 Fetch 实现

客户端使用 Obsidian 的 `requestUrl` API 实现自定义 fetch，以适配 Obsidian 环境：

- URL 规范化（自动添加协议，去除尾部斜杠）
- 请求超时处理（可配置）
- 错误增强（连接超时时提供友好提示）
- JSON 解析错误处理（健康检查端点可能返回 HTML）

### 事件流实现

支持两种事件流实现方式：

1. **Node.js 事件流**（优先，如果可用）
   - 直接使用 Node.js `http`/`https` 模块
   - 支持 Last-Event-ID header
   - 更好的性能和稳定性

2. **SDK 事件流**（备用或强制模式）
   - 使用 SDK 的 `event.subscribe` API
   - 通过 `forceSdkEventStream` 配置强制使用

## SDK API 使用

客户端正确使用 SDK 的以下 API：

- `session.create({ body: { title } })` - 创建会话
- `session.get({ path: { id } })` - 获取会话
- `session.prompt({ path: { id }, body: { parts: [...] } })` - 发送消息
- `session.abort({ path: { id } })` - 中止会话
- `event.subscribe({ signal })` - 订阅事件流

## 错误处理

所有错误通过 `ErrorHandler` 统一处理：

- 连接错误：增强错误消息，提供修复建议
- JSON 解析错误：健康检查端点特殊处理
- 超时错误：提供友好的连接提示
- 其他错误：记录详细上下文信息

## 使用示例

```typescript
import { OpenCodeServerClient } from "./opencode-server/client";
import { ErrorHandler } from "./utils/error-handler";

// 初始化
const errorHandler = new ErrorHandler({...});
const client = new OpenCodeServerClient(
  {
    url: "http://127.0.0.1:4096",
    requestTimeoutMs: 10000,
    autoReconnect: true,
  },
  errorHandler
);

// 连接
await client.connect();

// 注册事件回调
client.onStreamToken((sessionId, token, done) => {
  console.log(`Session ${sessionId}: ${token}`);
  if (done) {
    console.log("Stream completed");
  }
});

// 启动会话
const sessionId = await client.startSession(
  { currentNote: "My Note.md" },
  "assistant",
  ["Be helpful", "Be concise"]
);

// 发送消息
await client.sendMessage(sessionId, "Hello!");

// 断开连接
await client.disconnect();
```

## 已知限制

1. **图片支持**：`sendSessionMessage` 的图片参数尚未实现
2. **Last-Event-ID**：仅在 Node.js 事件流中支持，SDK 事件流中未传递

## 相关文件

- `src/opencode-server/client.ts` - 客户端实现
- `src/opencode-server/types.ts` - 类型定义
- `src/opencode-server/client.test.ts` - 单元测试
