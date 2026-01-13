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

## SDK Client 特性清单

### ✅ 已实现的 SDK Client API

#### 1. Session 操作 API

| API 方法 | 实现状态 | SDK 符合性 | 说明 |
|---------|---------|-----------|------|
| `session.create()` | ✅ 已实现 | ✅ 符合 | 创建新会话，支持自定义标题。使用 `{ body: { title } }` 格式，符合 SDK 规范 |
| `session.get()` | ✅ 已实现 | ✅ 符合 | 获取会话信息，使用 `{ path: { id } }` 格式，符合 SDK 规范 |
| `session.prompt()` | ✅ 已实现 | ⚠️ 部分符合 | 发送消息，使用 `{ path: { id }, body: { parts: [...] } }` 格式。**注意**：仅支持文本 parts，图片 parts 未实现 |
| `session.abort()` | ✅ 已实现 | ✅ 符合 | 中止会话，使用 `{ path: { id } }` 格式，符合 SDK 规范 |

#### 2. Event 订阅 API

| API 方法 | 实现状态 | SDK 符合性 | 说明 |
|---------|---------|-----------|------|
| `event.subscribe()` | ✅ 已实现 | ✅ 符合 | 订阅服务器事件流（SSE），使用 `{ signal }` 格式，符合 SDK 规范 |
| Last-Event-ID 支持 | ⚠️ 部分实现 | ⚠️ 部分符合 | 仅在 Node.js 事件流实现中支持。SDK 事件流中未传递 Last-Event-ID（如果 SDK 支持） |

### ✅ 已实现的包装层功能

#### 1. 连接管理

- **`connect()`**: 非阻塞连接，后台启动 SSE 事件循环
- **`disconnect()`**: 断开连接，清理资源
- **`getConnectionState()`**: 获取连接状态（disconnected/connecting/connected/reconnecting）
- **`isConnected()`**: 检查是否已连接
- **自动重连机制**: 指数退避策略，可配置重试次数和延迟

**SDK 符合性**: ✅ 包装层功能，不涉及 SDK API 直接调用。

#### 2. 会话管理

- **`createSession(title?)`**: 创建会话（基于 SDK `session.create`）
- **`startSession(context?, agent?, instructions?)`**: 启动会话并发送系统消息
- **`ensureSession(sessionId)`**: 确保会话存在（本地缓存或从服务器获取）
- **`getCurrentSessionId()`**: 获取当前会话 ID
- **`abortSession(sessionId)`**: 中止会话（基于 SDK `session.abort`）
- **本地会话缓存**: Map 存储会话信息，减少服务器请求

**SDK 符合性**: ✅ 正确使用 SDK `session.create` 和 `session.get` API。

#### 3. 消息发送

- **`sendMessage(sessionId, content)`**: 核心消息发送方法（基于 SDK `session.prompt`）
- **`sendSessionMessage(sessionId, content, images?)`**: 兼容方法（图片支持待实现）

**SDK 符合性**: 
- ✅ 文本消息：正确使用 SDK `session.prompt` API，格式为 `{ parts: [{ type: "text", text: content }] }`
- ❌ 图片消息：未实现，但 SDK `session.prompt` 理论上支持 `parts` 数组中的图片类型

#### 4. 事件系统

事件回调注册：
- **`onStreamToken(callback)`**: 流式 token 回调 `(sessionId, token, done) => void`
- **`onStreamThinking(callback)`**: 思考内容回调 `(sessionId, content) => void`
- **`onError(callback)`**: 错误回调 `(error: Error) => void`
- **`onProgressUpdate(callback)`**: 进度更新回调 `(sessionId, progress) => void`
- **`onSessionEnd(callback)`**: 会话结束回调 `(sessionId, reason?) => void`

事件类型处理：
- `message.part.updated` / `message.updated` - 消息更新事件
- `session.idle` / `session.completed` - 会话空闲/完成事件
- `session.progress` - 会话进度事件
- `session.ended` / `session.aborted` - 会话结束/中止事件
- `assistant` 消息格式（备用处理）

**SDK 符合性**: ✅ 正确使用 SDK `event.subscribe` API，正确处理 SDK 事件格式并转换为包装层回调。

#### 5. Obsidian 特定适配

- **Obsidian Fetch 适配**: 基于 `requestUrl` API 的自定义 fetch 实现
- **URL 规范化**: 自动添加协议，去除尾部斜杠
- **请求超时处理**: 可配置超时时间（默认 10000ms）
- **错误增强**: 连接超时时提供友好的错误提示
- **请求选项构建**: 处理 URL 解析、headers、body 转换

**SDK 符合性**: ✅ SDK client 支持自定义 fetch 实现，这是 SDK 的标准用法。

#### 6. 配置管理

- **`getConfig()`**: 获取配置（返回副本，防止外部修改）
- **可配置项**:
  - `requestTimeoutMs`: HTTP 请求超时时间（默认 10000ms）
  - `autoReconnect`: 自动重连开关（默认 true）
  - `reconnectDelay`: 重连延迟基数（默认 1000ms，指数退避）
  - `reconnectMaxAttempts`: 最大重试次数（默认 10，0 表示无限制）
  - `forceSdkEventStream`: 强制使用 SDK 事件流（默认 false）

**SDK 符合性**: ✅ 包装层配置，不涉及 SDK API。

#### 7. 健康检查

- **`healthCheck()`**: 健康检查方法

**SDK 符合性**: ⚠️ 当前直接使用 fetch，未通过 SDK client。如果 SDK 不提供健康检查方法，使用 fetch 是合理的。

### ❌ 已知未实现的功能

#### 1. 图片支持

**状态**: ❌ 未实现（代码中有 TODO 标记）

**SDK 符合性**: ⚠️ SDK `session.prompt` API 理论上支持图片 parts，但当前实现未使用。

**当前实现**:
```typescript
// src/opencode-server/client.ts
async sendSessionMessage(sessionId: string, content: string, images?: any[]): Promise<void> {
    // TODO: Implement image support when SDK client supports it
    if (images?.length) {
        console.warn("[OpenCodeClient] Image attachments not yet supported in SDK client");
    }
    await this.sendMessage(sessionId, content); // 仅发送文本
}
```

**正确的 SDK 用法**（应该实现）:
```typescript
// SDK session.prompt 支持 parts 数组，可以包含文本和图片
await this.sdkClient.session.prompt({
    path: { id: sessionId },
    body: {
        parts: [
            { type: "text", text: content },
            // 图片 parts（如果 SDK 支持）
            ...(images?.map(img => ({ 
                type: "image", 
                // SDK Part 类型定义需要确认具体格式
                // 可能是: { data: string, mimeType: string }
                // 或: { url: string }
                // 或: { base64: string, mimeType: string }
            })) || [])
        ]
    }
});
```

**说明**: 
- SDK `session.prompt` API 接受 `parts` 数组，理论上应该支持多种 part 类型（text、image 等）
- 当前实现仅使用文本 part，图片 part 未实现
- 需要查看 SDK 的 `Part` 类型定义确认图片 part 的具体格式
- UI 层（`opencode-obsidian-view.ts`）已经实现了图片到 base64 的转换，但 client 层未使用

**实现方法**:
1. 查看 SDK `Part` 类型定义（`@opencode-ai/sdk/client`）
2. 确认图片 part 的格式（可能是 `{ type: "image", data: string, mimeType: string }` 或其他格式）
3. 在 `sendMessage` 或 `sendSessionMessage` 中构建包含图片的 parts 数组
4. 将图片数据转换为 SDK 要求的格式（base64、URL 等）

#### 2. 健康检查 SDK 集成

**状态**: ⚠️ 未使用 SDK client（如果 SDK 提供）

**当前实现**:
```typescript
async healthCheck(): Promise<boolean> {
    // 直接使用 fetch，未通过 SDK client
    const response = await this.createObsidianFetch()(
        `${this.config.url}/health`,
        { method: "GET" },
    );
    return response.ok;
}
```

**SDK 符合性**: 
- 如果 SDK 提供 `health.*` API，应该使用 SDK 方法
- 如果 SDK 不提供健康检查 API，使用 fetch 是合理的（SDK client 本身也使用 fetch）

**说明**: 
- 当前实现直接调用 `/health` 端点，符合 OpenCode Server 协议
- 如果 SDK 提供专门的健康检查方法（如 `client.health.check()`），应优先使用
- 需要查看 SDK 文档或类型定义确认是否有健康检查 API

### ⚠️ 部分实现的功能

#### 1. Last-Event-ID 支持

**状态**: ⚠️ 部分实现

**SDK 符合性**: ⚠️ Node.js 实现符合 SSE 规范，SDK 事件流实现未传递 Last-Event-ID

**当前实现**:
- ✅ Node.js 事件流：支持 Last-Event-ID header（`nodeEventStream` 方法）
- ❌ SDK 事件流：未传递 Last-Event-ID（`event.subscribe` 调用中未包含）

**说明**:
- Last-Event-ID 是 SSE 标准，用于断线重连后继续接收事件
- Node.js 实现中正确设置了 `Last-Event-ID` header
- SDK `event.subscribe` API 可能支持 Last-Event-ID 参数，但当前实现未使用

**改进方法**（如果 SDK 支持）:
```typescript
const sub = await this.sdkClient.event.subscribe({
    signal,
    lastEventId: this.lastEventId, // 如果 SDK 支持此参数
});
```

## 关键行为变更

- `connect()` **非阻塞**：启动后台 SSE 事件循环后立即返回。
- SSE 断线后自动重连，连接状态在事件流建立后切换为 `connected`。
- 连接逻辑与 `opencode-web` 一致：事件订阅在后台循环中运行。

## 实现方法

### 1. SDK Client 初始化

**SDK 符合性**: ✅ 符合 SDK 标准用法

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk/client";

// Helper 函数（对齐 opencode-web）
export function createClient(baseUrl: string, fetchImpl?: typeof fetch) {
    return createOpencodeClient({ 
        baseUrl, 
        fetch: fetchImpl  // SDK 支持自定义 fetch 实现
    });
}

// 包装类初始化
this.sdkClient = createClient(normalizedUrl, this.createObsidianFetch());
```

**说明**: 
- SDK `createOpencodeClient` 接受 `baseUrl` 和可选的 `fetch` 参数
- 使用自定义 fetch 实现是 SDK 的标准功能，用于适配不同环境（如 Obsidian）

### 2. Obsidian Fetch 适配

**SDK 符合性**: ✅ SDK 支持自定义 fetch 实现

```typescript
private createObsidianFetch(): typeof fetch {
    return async (url: RequestInfo | URL, init?: RequestInit) => {
        // 1. 构建请求选项（URL 解析、headers、body 转换）
        const options = await this.buildRequestOptions(url, init);
        
        // 2. 使用 Obsidian requestUrl API
        const request = requestUrl({ ...options });
        
        // 3. 超时处理（Promise.race）
        const response = await Promise.race([request, timeoutPromise]);
        
        // 4. 转换为标准 Response 对象（SDK 期望的格式）
        return new Response(response.text || JSON.stringify(response.json), {
            status: response.status,
            headers: new Headers(response.headers || {}),
        });
    };
}
```

**说明**: 
- SDK client 期望标准的 `fetch` API（返回 `Response` 对象）
- Obsidian 的 `requestUrl` API 返回不同的格式，需要转换为标准 `Response`
- 这是 SDK 设计支持的用法（自定义 fetch 实现）

### 3. Session 操作

#### 创建会话

**SDK 符合性**: ✅ 符合 SDK API 规范

```typescript
const response = await this.sdkClient.session.create({
    body: {
        title: title || `Session ${new Date().toISOString()}`,
    },
});

if (response.error) {
    throw new Error(`Failed to create session: ${response.error}`);
}

const session = response.data;
// SDK 返回的 session 可能在不同位置包含 id
const sessionId = session.info?.id || session.id || session.sessionID || session.sessionId;
```

**说明**: 
- SDK `session.create` 使用 `{ body: { title } }` 格式
- SDK 返回格式为 `{ data: Session, error?: string }`
- Session ID 提取逻辑复杂是因为 SDK 返回结构可能不统一（这是 SDK 的问题，不是实现问题）

#### 发送消息

**SDK 符合性**: ⚠️ 部分符合（仅文本，未实现图片）

```typescript
// 当前实现（仅文本）
const response = await this.sdkClient.session.prompt({
    path: { id: sessionId },
    body: {
        parts: [{ type: "text", text: content }],
    },
});

// 应该实现（文本 + 图片）
const response = await this.sdkClient.session.prompt({
    path: { id: sessionId },
    body: {
        parts: [
            { type: "text", text: content },
            ...(images?.map(img => ({
                type: "image",
                // 需要根据 SDK Part 类型定义确定具体格式
                data: img.data,      // base64 字符串
                mimeType: img.mimeType,
            })) || []),
        ],
    },
});
```

**说明**: 
- SDK `session.prompt` 使用 `{ path: { id }, body: { parts: [...] } }` 格式
- `parts` 数组支持多种类型（text、image 等）
- 当前实现仅使用 text part，需要扩展支持 image part

### 4. 事件流处理

#### SDK Event Stream（默认或强制模式）

**SDK 符合性**: ✅ 符合 SDK API 规范

```typescript
const sub: any = await this.sdkClient.event.subscribe({ signal });
const stream = sub?.data?.stream ?? sub?.stream;

if (!stream) {
    throw new Error("Event subscription did not include a stream");
}

for await (const event of stream) {
    this.handleSDKEvent(event);
}
```

**说明**: 
- SDK `event.subscribe` 使用 `{ signal: AbortSignal }` 格式
- 返回的订阅对象包含 `stream`（可能在 `data.stream` 或直接 `stream`）
- Stream 是 `AsyncGenerator`，使用 `for await` 遍历

#### Node.js Event Stream（优先模式）

**SDK 符合性**: ✅ 不涉及 SDK API（直接实现 SSE）

```typescript
// 使用 Node.js http/https 模块直接实现 SSE
const eventUrl = new URL("/event", `${this.config.url}/`);
const response = await http.request({
    method: "GET",
    headers: {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...(this.lastEventId ? { "Last-Event-ID": this.lastEventId } : {}),
    },
    // ...
});

// SSE 解析
for await (const chunk of response) {
    const events = parseSSE(chunk);
    for (const event of events) {
        yield JSON.parse(event.data);
    }
}
```

**说明**: 
- Node.js 实现直接使用 HTTP/HTTPS 模块，不通过 SDK
- 支持 Last-Event-ID header（SSE 标准）
- 这是 Obsidian 环境的优化（Node.js 环境可用时优先使用）

### 5. 事件转换

**SDK 符合性**: ✅ 正确处理 SDK 事件格式

```typescript
private handleSDKEvent(event: any): void {
    // SDK 事件可能在不同位置包含 sessionId
    const sessionId = 
        event.properties?.part?.sessionID ||
        event.properties?.part?.sessionId ||
        event.properties?.sessionID ||
        event.properties?.sessionId ||
        event.sessionId ||
        event.sessionID ||
        event.id;

    switch (event.type) {
        case "message.part.updated":
        case "message.updated":
            // SDK 事件格式: { type, properties: { part: { type, text, ... } } }
            const part = event.properties?.part || event.data?.part || event.part;
            if (part?.type === "text") {
                // 文本内容 → onStreamToken
                this.streamTokenCallbacks.forEach(cb => cb(sessionId, part.text || part.delta, false));
            } else if (part?.type === "reasoning" || part?.type === "thinking") {
                // reasoning 内容 → onStreamThinking
                this.streamThinkingCallbacks.forEach(cb => cb(sessionId, part.text || part.delta));
            }
            break;
            
        case "session.idle":
        case "session.completed":
            // 发送完成信号 → onStreamToken(..., done: true)
            this.streamTokenCallbacks.forEach(cb => cb(sessionId, "", true));
            break;
            
        case "session.progress":
            // 进度更新 → onProgressUpdate
            const progress = event.data?.progress || event.progress;
            this.progressUpdateCallbacks.forEach(cb => cb(sessionId, progress));
            break;
            
        case "session.ended":
        case "session.aborted":
            // 会话结束 → onSessionEnd
            const reason = event.data?.reason || event.reason || "completed";
            this.sessionEndCallbacks.forEach(cb => cb(sessionId, reason));
            break;
    }
}
```

**说明**: 
- SDK 事件格式可能不统一（sessionId 在不同位置，event 结构可能变化）
- 实现中使用多种路径尝试提取数据，这是为了兼容 SDK 的不同版本或格式变化
- 事件类型遵循 OpenCode Server 协议规范

### 6. 自动重连逻辑

**SDK 符合性**: ✅ 包装层功能，不涉及 SDK API

```typescript
private async subscribeToEvents(): Promise<void> {
    let attempt = 0;
    const maxAttempts = this.config.reconnectMaxAttempts ?? 10;
    const baseDelay = this.config.reconnectDelay ?? 1000;
    const shouldReconnect = this.config.autoReconnect ?? true;
    
    while (!signal.aborted) {
        try {
            const stream = await this.createEventStream(signal);
            this.connectionState = "connected";
            attempt = 0; // 重置计数
            
            await this.processEventStream(stream);
            
            if (!shouldReconnect || signal.aborted) break;
        } catch (error) {
            if (signal.aborted || !shouldReconnect) throw error;
            
            attempt = Math.min(attempt + 1, maxAttempts);
            if (maxAttempts !== 0 && attempt >= maxAttempts) throw error;
            
            const delay = Math.min(baseDelay * 2 ** attempt, 30000); // 指数退避，最大 30s
            await this.sleep(delay);
        }
    }
}
```

**说明**: 
- 这是包装层的重连逻辑，不涉及 SDK API
- 使用指数退避策略，符合最佳实践
- SDK `event.subscribe` 本身不提供重连，需要包装层实现

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

## 特性完整性检查

### ✅ 核心功能（必须实现）

| 功能 | 状态 | SDK API | SDK 符合性 | 说明 |
|------|------|---------|-----------|------|
| 会话创建 | ✅ | `session.create` | ✅ 符合 | 正确使用 SDK API |
| 会话查询 | ✅ | `session.get` | ✅ 符合 | 正确使用 SDK API |
| 消息发送 | ✅ | `session.prompt` | ⚠️ 部分符合 | 仅文本，图片未实现 |
| 会话中止 | ✅ | `session.abort` | ✅ 符合 | 正确使用 SDK API |
| 事件订阅 | ✅ | `event.subscribe` | ✅ 符合 | 正确使用 SDK API |
| 连接管理 | ✅ | - | ✅ N/A | 包装层功能 |
| 自动重连 | ✅ | - | ✅ N/A | 包装层功能 |
| 错误处理 | ✅ | - | ✅ N/A | 包装层功能 |

### ⚠️ 增强功能（建议实现）

| 功能 | 状态 | SDK API | SDK 符合性 | 优先级 | 实现方法 |
|------|------|---------|-----------|--------|---------|
| 图片支持 | ❌ | `session.prompt` (parts) | ⚠️ SDK 支持但未使用 | 中 | 需要在 parts 数组中添加 image part，格式需查看 SDK Part 类型定义 |
| Last-Event-ID (SDK 流) | ❌ | `event.subscribe` (options) | ❓ 待确认 SDK 是否支持 | 低 | 如果 SDK 支持 lastEventId 参数，应在 subscribe 调用中传递 |
| 健康检查 (SDK) | ⚠️ | 可能为 `health.*` | ❓ 待确认 SDK 是否提供 | 低 | 如果 SDK 提供健康检查方法，应使用 SDK 方法 |

### ❓ 其他可能的 SDK API（待确认）

以下 API 如果 SDK 提供，可能需要考虑：

- `session.list()` - 列出所有会话
- `session.delete()` - 删除会话
- `session.update()` - 更新会话配置
- `agent.*` - Agent 管理 API
- `tool.*` - 工具管理 API
- `provider.*` - Provider 管理 API

**注意**: 这些 API 是否存在于 SDK 中需要查看 SDK 文档或类型定义确认。

## 迁移提示

- 插件用户无需改动。
- 插件内部仍可继续使用 `OpenCodeServerClient`。
- 若需要直接调用 SDK API，请使用 `createClient`。

## 测试

```bash
pnpm vitest run src/opencode-server/client.test.ts
```

## 已知问题和改进方向

### 1. 图片支持

**问题**: 图片消息功能未实现，但 SDK 理论上支持

**当前状态**: 
- UI 层已实现图片到 base64 的转换（`opencode-obsidian-view.ts`）
- Client 层未使用图片数据，仅发送文本

**改进方法**:
1. 查看 SDK `Part` 类型定义（`@opencode-ai/sdk/client`），确认图片 part 格式
2. 在 `sendMessage` 方法中构建包含图片的 parts 数组
3. 将 UI 层提供的图片数据转换为 SDK 要求的格式

**SDK 符合性**: SDK `session.prompt` API 支持 `parts` 数组，应该可以支持图片，需要确认具体格式后实现。

### 2. 健康检查

**问题**: 健康检查直接使用 fetch，未通过 SDK client

**当前状态**: 
- 直接调用 `/health` 端点
- 注释说"Use SDK client"，但实际未使用

**改进方法**:
- 如果 SDK 提供健康检查方法（如 `client.health.check()`），应使用 SDK 方法
- 如果 SDK 不提供，当前实现是合理的（使用 fetch 调用标准端点）

**SDK 符合性**: 如果 SDK 不提供健康检查 API，使用 fetch 是合理的。需要确认 SDK 是否提供。

### 3. Last-Event-ID 一致性

**问题**: Last-Event-ID 仅在 Node.js 事件流中支持

**当前状态**: 
- Node.js 实现：支持 Last-Event-ID header
- SDK 事件流：未传递 Last-Event-ID

**改进方法**:
- 查看 SDK `event.subscribe` API 是否支持 `lastEventId` 参数
- 如果支持，在 SDK 事件流实现中也传递 Last-Event-ID

**SDK 符合性**: 需要确认 SDK 是否支持 Last-Event-ID 参数。如果支持但未使用，需要改进。

### 4. Session ID 提取逻辑

**问题**: Session ID 提取逻辑过于复杂，存在多层类型断言

**当前状态**: 
- 从多个可能的位置尝试提取 sessionId
- 代码注释说"SDK 返回结构可能不统一"

**改进方法**:
- 这是 SDK 返回格式不统一导致的问题
- 如果可能，向 SDK 维护者反馈，要求统一的返回格式
- 或者封装为辅助函数，简化代码

**SDK 符合性**: 这是 SDK 的问题（返回格式不统一），不是实现的问题。实现中使用多种路径提取是合理的兼容性处理。

## SDK 符合性总结

### ✅ 完全符合 SDK 要求

- SDK Client 初始化（使用 `createOpencodeClient`）
- 自定义 Fetch 实现（SDK 支持的标准用法）
- Session 创建、查询、中止（正确使用 SDK API）
- Event 订阅（正确使用 SDK API）
- 事件流处理（正确使用 SDK AsyncGenerator）
- 包装层功能（连接管理、自动重连、错误处理）

### ⚠️ 部分符合或待改进

- 消息发送：仅文本，图片未实现（SDK 支持但未使用）
- Last-Event-ID：SDK 事件流中未使用（需要确认 SDK 是否支持）
- 健康检查：未使用 SDK（需要确认 SDK 是否提供健康检查 API）

### ❓ 需要确认

- SDK 是否提供健康检查 API
- SDK `Part` 类型中图片 part 的具体格式
- SDK `event.subscribe` 是否支持 `lastEventId` 参数
- SDK 是否有其他 API（session.list, agent.*, tool.*, provider.* 等）

## 参考资源

- `@opencode-ai/sdk/client` - OpenCode SDK Client
- `docs/ARCHITECTURE.md` - 架构文档
- `src/opencode-server/client.ts` - 实现代码
- `src/opencode-server/types.ts` - 类型定义（重导出 SDK 类型）
