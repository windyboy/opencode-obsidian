# Session 流程验证清单

## 1. 创建 Session (createSession)

### ✅ 验证点

1. **SDK API 调用格式**
   - ✅ 使用 `session.create({ body: { title } })` 格式
   - ✅ title 有默认值：`Session ${new Date().toISOString()}`

2. **响应验证**
   - ✅ 检查 `response.error`，如果有错误则抛出异常
   - ✅ 检查 `response.data` 存在，如果不存在则抛出异常

3. **SessionId 提取**
   - ✅ 使用 `extractSessionId` 方法从多个可能位置提取
   - ✅ 检查 sessionId 不为 null，如果为 null 则抛出异常

4. **状态管理**
   - ✅ 存储 session 到 `this.sessions` Map
   - ✅ 设置 `this.currentSessionId`

5. **错误处理**
   - ✅ 捕获异常并调用 `errorHandler.handleError`
   - ✅ 区分连接错误和其他错误（使用 `isEnhancedError`）

## 2. 启动 Session (startSession)

### ✅ 验证点

1. **Session 创建**
   - ✅ 调用 `createSession(title)` 创建 session
   - ✅ title 包含 context 信息（如果有）

2. **系统消息处理**
   - ✅ 检查是否有 context/agent/instructions
   - ✅ 如果有，调用 `buildSystemMessage` 构建系统消息
   - ✅ 如果系统消息不为空，通过 `sendMessage` 发送

3. **错误处理**
   - ✅ 捕获异常并调用 `errorHandler.handleError`
   - ✅ 区分连接错误和其他错误

## 3. 发送消息 (sendMessage)

### ✅ 验证点

1. **Session 验证**
   - ✅ 检查本地缓存 `this.sessions.get(sessionId)`
   - ✅ 如果不存在，调用 `session.get({ path: { id: sessionId } })`
   - ✅ 验证 `session.get` 响应：检查 `response.error` 和 `response.data`
   - ✅ 如果验证失败，抛出异常
   - ✅ 将获取的 session 存储到本地缓存

2. **消息发送**
   - ✅ 调用 `session.prompt({ path: { id: sessionId }, body: { parts: [...] } })`
   - ✅ parts 格式：`[{ type: "text", text: content }]`

3. **响应验证**
   - ✅ 检查 `response.error`，如果有错误则抛出异常

4. **错误处理**
   - ✅ 捕获异常并调用 `errorHandler.handleError`
   - ✅ 记录详细的错误信息（sessionId, contentLength）

## 4. 确保 Session 存在 (ensureSession)

### ✅ 验证点

1. **本地缓存检查**
   - ✅ 检查 `this.sessions.has(sessionId)`
   - ✅ 如果存在，直接返回 true

2. **从服务器获取**
   - ✅ 调用 `session.get({ path: { id: sessionId } })`
   - ✅ 验证响应：检查 `response.error` 和 `response.data`
   - ✅ 如果验证失败，返回 false（不抛出异常）

3. **状态管理**
   - ✅ 将获取的 session 存储到本地缓存

4. **错误处理**
   - ✅ 捕获异常并调用 `errorHandler.handleError`
   - ✅ 返回 false（不抛出异常，因为这是验证方法）

## 5. SessionId 提取 (extractSessionId)

### ✅ 验证点

1. **多位置提取**
   - ✅ 尝试从 `session.info` 提取
   - ✅ 如果不存在，使用 `session` 本身
   - ✅ 尝试多个可能的字段名：`id`, `sessionID`, `sessionId`

2. **返回值**
   - ✅ 如果找到，返回 sessionId 字符串
   - ✅ 如果未找到，返回 null

## 6. 系统消息构建 (buildSystemMessage)

### ✅ 验证点

1. **参数处理**
   - ✅ 处理 agent 参数
   - ✅ 处理 instructions 数组
   - ✅ 处理 context 对象（currentNote, selection, links, tags）

2. **消息格式**
   - ✅ 格式：`Agent: ${agent}\nInstructions: ${instructions.join(", ")}\nContext: ...`
   - ✅ 如果没有任何内容，返回 null

## 潜在问题检查

### ⚠️ 已修复的问题

1. **createSession 缺少 data 验证**
   - ✅ 已添加 `if (!response.data)` 检查

### ✅ 已验证正确的点

1. **所有 SDK API 调用格式**
   - ✅ `session.create({ body: { title } })`
   - ✅ `session.get({ path: { id } })`
   - ✅ `session.prompt({ path: { id }, body: { parts: [...] } })`

2. **所有响应验证**
   - ✅ 检查 `response.error`
   - ✅ 检查 `response.data`（在需要的地方）

3. **所有状态管理**
   - ✅ Session 存储到 Map
   - ✅ currentSessionId 设置

4. **所有错误处理**
   - ✅ 捕获异常
   - ✅ 调用 errorHandler
   - ✅ 区分错误类型

## 待运行时验证的点

以下点需要通过运行时日志验证：

1. **SDK 实际返回格式**
   - session.create 返回的 data 结构
   - session.get 返回的 data 结构
   - session.prompt 返回的 data 结构（如果有）

2. **SessionId 提取**
   - SDK 实际返回的 sessionId 位置
   - extractSessionId 是否能正确提取

3. **系统消息发送**
   - 系统消息是否成功发送
   - 服务器是否正确处理系统消息
