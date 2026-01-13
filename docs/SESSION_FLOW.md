# Session 流程梳理

## 整体流程概览

### 1. 创建 Session (Create Session)

**调用链**:
```
View.sendMessage()
  └─> OpenCodeServerClient.startSession(context, agent, instructions)
      └─> OpenCodeServerClient.createSession(title)
          └─> SDK: session.create({ body: { title } })
              └─> 返回: { data: Session, error?: string }
                  └─> 提取 sessionId
                      └─> 存储到 this.sessions Map
                      └─> 设置 this.currentSessionId
```

**关键代码位置**:
- `src/opencode-obsidian-view.ts:1190` - View调用startSession
- `src/opencode-server/client.ts:527` - startSession实现
- `src/opencode-server/client.ts:476` - createSession实现
- `src/opencode-server/client.ts:478` - SDK session.create调用

**数据流**:
1. View传入: `context`, `agent`, `instructions`
2. startSession构建title: `Session (${context.currentNote})`
3. createSession调用SDK: `session.create({ body: { title } })`
4. SDK返回: `{ data: Session, error?: string }`
5. 提取sessionId: `session.info?.id || session.id || session.sessionID || session.sessionId`
6. 存储session到Map: `this.sessions.set(sessionId, sessionInfo)`
7. 如果有context/agent/instructions，构建systemMessage并调用sendMessage发送

### 2. 获取 Session (Get Session)

**调用链**:
```
OpenCodeServerClient.sendMessage(sessionId, content)
  └─> 检查本地缓存: this.sessions.get(sessionId)
      └─> 如果不存在，调用: SDK session.get({ path: { id: sessionId } })
          └─> 返回: { data: Session, error?: string }
              └─> 存储到本地缓存
```

**关键代码位置**:
- `src/opencode-server/client.ts:576` - sendMessage实现
- `src/opencode-server/client.ts:578-588` - 本地缓存检查和获取逻辑
- `src/opencode-server/client.ts:388` - ensureSession实现（类似逻辑）

**数据流**:
1. 检查本地缓存: `this.sessions.get(sessionId)`
2. 如果不存在，调用SDK: `session.get({ path: { id: sessionId } })`
3. SDK返回: `{ data: Session, error?: string }`
4. 验证返回: `if (response.error || !response.data) throw error`
5. 存储到本地: `this.sessions.set(sessionId, response.data)`

### 3. Session Prompt (发送消息)

**调用链**:
```
View.sendMessage(content)
  └─> OpenCodeServerClient.sendSessionMessage(sessionId, content, images?)
      └─> OpenCodeServerClient.sendMessage(sessionId, content)
          └─> 确保session存在（本地缓存或获取）
          └─> SDK: session.prompt({ path: { id: sessionId }, body: { parts: [...] } })
              └─> 返回: { data?: any, error?: string }
```

**关键代码位置**:
- `src/opencode-obsidian-view.ts:1239` - View调用sendSessionMessage
- `src/opencode-server/client.ts:627` - sendSessionMessage实现
- `src/opencode-server/client.ts:576` - sendMessage实现
- `src/opencode-server/client.ts:593` - SDK session.prompt调用

**数据流**:
1. 确保session存在（本地缓存或从服务器获取）
2. 调用SDK: `session.prompt({ path: { id: sessionId }, body: { parts: [{ type: "text", text: content }] } })`
3. SDK返回: `{ data?: any, error?: string }`
4. 检查错误: `if (response.error) throw new Error(...)`

### 4. 系统消息发送（在startSession中）

**调用链**:
```
OpenCodeServerClient.startSession(context, agent, instructions)
  └─> createSession(title) // 创建session
  └─> buildSystemMessage(context, agent, instructions) // 构建系统消息
  └─> sendMessage(sessionId, systemMessage) // 发送系统消息
      └─> session.prompt(...) // 通过prompt发送
```

**关键代码位置**:
- `src/opencode-server/client.ts:541-551` - startSession中的系统消息逻辑
- `src/opencode-server/client.ts:756` - buildSystemMessage实现

**数据流**:
1. 创建session后，如果有context/agent/instructions
2. 构建systemMessage: `Agent: ${agent}\nInstructions: ${instructions.join(", ")}\nContext: ...`
3. 调用sendMessage发送系统消息
4. sendMessage内部调用session.prompt发送

## 潜在问题点

### 问题1: session.prompt的格式
- **当前实现**: `{ path: { id: sessionId }, body: { parts: [{ type: "text", text: content }] } }`
- **可能问题**: SDK可能期望不同的格式，或者需要额外的参数（如agent、instructions）

### 问题2: session.create返回的sessionId提取
- **当前实现**: 从多个可能的位置提取 `session.info?.id || session.id || session.sessionID || session.sessionId`
- **可能问题**: SDK返回的格式可能不匹配，导致sessionId为null

### 问题3: 系统消息的发送时机
- **当前实现**: 在startSession中，创建session后立即发送系统消息
- **可能问题**: 系统消息应该通过session.prompt发送，但可能需要不同的格式或参数

### 问题4: session.get的调用
- **当前实现**: 在sendMessage中，如果本地没有session，调用session.get获取
- **可能问题**: session.get返回的格式可能与预期不符

## 需要验证的关键点

1. **SDK session.create返回的实际格式**
2. **SDK session.prompt期望的完整参数格式**
3. **SDK session.get返回的实际格式**
4. **系统消息是否应该通过session.prompt发送，还是通过其他API**
