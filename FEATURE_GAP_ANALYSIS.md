# OpenCode Obsidian Plugin - 功能缺失分析

**分析日期**: 2026-01-16  
**分析对象**: OpenCode Obsidian Plugin vs OpenCode Server 官方 API  
**参考文档**: https://dev.opencode.ai/docs/server/

---

## 执行摘要

当前插件实现了基础的会话管理和消息发送功能，但**缺失了大量 OpenCode Server 提供的高级功能**。主要缺失的功能包括：

- ❌ 会话管理高级功能（fork、share、diff、revert、summarize）
- ❌ 文件搜索和符号查找
- ❌ 项目和路径管理
- ❌ 配置管理
- ❌ Provider 管理
- ❌ 权限请求响应
- ❌ Shell 命令执行
- ❌ LSP/Formatter/MCP 状态查询
- ❌ Agent 列表获取

---

## 详细功能对比

### ✅ 已实现的功能

#### 1. 基础连接管理
- ✅ `healthCheck()` - 健康检查
- ✅ `connect()` / `disconnect()` - 连接管理
- ✅ 事件流订阅（SSE）

#### 2. 会话基础操作
- ✅ `createSession()` - 创建会话
- ✅ `ensureSession()` - 确保会话存在
- ✅ `sendMessage()` - 发送消息
- ✅ `sendSessionCommand()` - 发送命令
- ✅ `abortSession()` - 中止会话

#### 3. 命令管理
- ✅ `listCommands()` - 列出可用命令（带缓存）

---

## ❌ 缺失的功能

### 1. 会话管理高级功能 (Critical)

#### 缺失的 API:

**会话列表和查询**:
```typescript
// ❌ 未实现
GET /session - 列出所有会话
GET /session/:id - 获取会话详情
GET /session/:id/children - 获取子会话
GET /session/status - 获取所有会话状态
```

**会话操作**:
```typescript
// ❌ 未实现
DELETE /session/:id - 删除会话
PATCH /session/:id - 更新会话属性（如标题）
POST /session/:id/fork - Fork 会话到某个消息点
POST /session/:id/share - 分享会话
DELETE /session/:id/share - 取消分享
```

**会话高级功能**:
```typescript
// ❌ 未实现
GET /session/:id/diff - 获取会话的文件差异
POST /session/:id/summarize - 总结会话内容
POST /session/:id/revert - 回退到某个消息
POST /session/:id/unrevert - 恢复回退的消息
POST /session/:id/init - 分析应用并创建 AGENTS.md
GET /session/:id/todo - 获取待办事项列表
```

**影响**: 用户无法管理多个会话、无法查看历史会话、无法 fork 或分享会话。

---

### 2. 消息管理功能 (High)

#### 缺失的 API:

```typescript
// ❌ 未实现
GET /session/:id/message - 列出会话中的所有消息
GET /session/:id/message/:messageID - 获取消息详情
POST /session/:id/prompt_async - 异步发送消息（不等待响应）
POST /session/:id/shell - 运行 shell 命令
```

**影响**: 
- 无法查看历史消息列表
- 无法异步发送消息（对于长时间运行的任务）
- 无法执行 shell 命令

---

### 3. 文件和符号搜索 (High)

#### 缺失的 API:

```typescript
// ❌ 未实现
GET /find?pattern=<pat> - 在文件中搜索文本
GET /find/file?query=<q> - 按名称查找文件和目录
GET /find/symbol?query=<q> - 查找工作区符号
GET /file?path=<path> - 列出文件和目录
GET /file/content?path=<p> - 读取文件
GET /file/status - 获取跟踪文件的状态
```

**影响**: 
- 无法在 OpenCode 中搜索文件内容
- 无法查找符号（函数、类等）
- 无法通过 OpenCode 读取文件（只能通过 Obsidian 工具）

**注意**: 当前插件通过 Obsidian 工具提供了部分文件操作功能，但这些是通过工具系统而非直接 API 调用。

---

### 4. 项目和路径管理 (Medium)

#### 缺失的 API:

```typescript
// ❌ 未实现
GET /project - 列出所有项目
GET /project/current - 获取当前项目
GET /path - 获取当前路径
GET /vcs - 获取 VCS 信息
```

**影响**: 
- 无法获取项目信息
- 无法获取版本控制信息
- 无法切换项目

---

### 5. 配置管理 (Medium)

#### 缺失的 API:

```typescript
// ❌ 未实现
GET /config - 获取配置信息
PATCH /config - 更新配置
GET /config/providers - 列出 providers 和默认模型
```

**影响**: 
- 无法动态获取或更新 OpenCode 配置
- 无法查询可用的 providers

---

### 6. Provider 管理 (Medium)

#### 缺失的 API:

```typescript
// ❌ 未实现
GET /provider - 列出所有 providers
GET /provider/auth - 获取 provider 认证方法
POST /provider/{id}/oauth/authorize - OAuth 授权
POST /provider/{id}/oauth/callback - OAuth 回调
PUT /auth/:id - 设置认证凭据
```

**影响**: 
- 无法在插件中管理 AI provider 认证
- 无法切换或配置 providers

---

### 7. 权限管理 (High)

#### 缺失的 API:

```typescript
// ❌ 未实现
POST /session/:id/permissions/:permissionID - 响应权限请求
```

**当前实现**: 插件有自己的权限系统（`PermissionManager`），但不与 OpenCode Server 的权限系统集成。

**影响**: 
- OpenCode Server 请求的权限无法通过插件响应
- 两套权限系统可能产生冲突

---

### 8. LSP/Formatter/MCP 状态 (Low)

#### 缺失的 API:

```typescript
// ❌ 未实现
GET /lsp - 获取 LSP 服务器状态
GET /formatter - 获取格式化器状态
GET /mcp - 获取 MCP 服务器状态
POST /mcp - 动态添加 MCP 服务器
```

**影响**: 
- 无法查询 LSP 状态
- 无法管理 MCP 服务器

---

### 9. Agent 管理 (Medium)

#### 缺失的 API:

```typescript
// ❌ 未实现
GET /agent - 列出所有可用的 agents
```

**当前实现**: 插件在设置中硬编码了 agent 选择，但不从服务器动态获取。

**影响**: 
- 无法动态获取可用的 agents
- 新增的 agents 需要手动更新插件

---

### 10. 工具管理 (Experimental, Low)

#### 缺失的 API:

```typescript
// ❌ 未实现
GET /experimental/tool/ids - 列出所有工具 ID
GET /experimental/tool?provider=<p>&model=<m> - 列出工具及其 JSON schemas
```

**影响**: 
- 无法查询 OpenCode 支持的工具
- 无法动态获取工具 schemas

---

### 11. TUI 控制 (Low Priority)

#### 缺失的 API:

```typescript
// ❌ 未实现
POST /tui/append-prompt - 追加文本到提示
POST /tui/open-help - 打开帮助对话框
POST /tui/open-sessions - 打开会话选择器
POST /tui/open-themes - 打开主题选择器
POST /tui/open-models - 打开模型选择器
POST /tui/submit-prompt - 提交当前提示
POST /tui/clear-prompt - 清除提示
POST /tui/execute-command - 执行命令
POST /tui/show-toast - 显示 toast 通知
GET /tui/control/next - 等待下一个控制请求
POST /tui/control/response - 响应控制请求
```

**影响**: 
- 无法控制 OpenCode TUI（如果同时运行）
- 无法与 TUI 交互

---

### 12. 实例管理 (Low)

#### 缺失的 API:

```typescript
// ❌ 未实现
POST /instance/dispose - 释放当前实例
```

**影响**: 
- 无法主动释放服务器实例

---

### 13. 日志记录 (Low)

#### 缺失的 API:

```typescript
// ❌ 未实现
POST /log - 写入日志条目
```

**影响**: 
- 无法向 OpenCode Server 发送日志

---

## 功能实现优先级建议

### 🔴 Critical Priority (立即实现)

1. **会话列表和管理**
   - `GET /session` - 列出所有会话
   - `GET /session/:id` - 获取会话详情
   - `DELETE /session/:id` - 删除会话
   - `PATCH /session/:id` - 更新会话标题
   
   **原因**: 用户需要管理多个会话，当前只能创建新会话但无法查看或管理历史会话。

2. **消息历史查询**
   - `GET /session/:id/message` - 列出会话消息
   
   **原因**: 用户需要查看完整的对话历史，当前只能看到当前会话的实时消息。

3. **权限请求响应**
   - `POST /session/:id/permissions/:permissionID` - 响应权限请求
   
   **原因**: 需要与 OpenCode Server 的权限系统集成，避免两套权限系统冲突。

---

### 🟡 High Priority (短期实现)

4. **会话高级操作**
   - `POST /session/:id/fork` - Fork 会话
   - `POST /session/:id/revert` - 回退消息
   - `POST /session/:id/unrevert` - 恢复回退
   - `GET /session/:id/diff` - 查看文件差异
   
   **原因**: 这些是高级用户常用的功能，可以提升用户体验。

5. **文件搜索**
   - `GET /find?pattern=<pat>` - 搜索文本
   - `GET /find/file?query=<q>` - 查找文件
   - `GET /find/symbol?query=<q>` - 查找符号
   
   **原因**: 虽然有 Obsidian 工具，但直接 API 调用更高效。

6. **Agent 动态获取**
   - `GET /agent` - 列出可用 agents
   
   **原因**: 避免硬编码 agent 列表，支持动态扩展。

---

### 🟢 Medium Priority (中期实现)

7. **会话分享**
   - `POST /session/:id/share` - 分享会话
   - `DELETE /session/:id/share` - 取消分享
   
   **原因**: 协作功能，但不是核心需求。

8. **会话总结**
   - `POST /session/:id/summarize` - 总结会话
   
   **原因**: 有用但不紧急的功能。

9. **项目和路径信息**
   - `GET /project` - 列出项目
   - `GET /project/current` - 当前项目
   - `GET /path` - 当前路径
   - `GET /vcs` - VCS 信息
   
   **原因**: 提供更多上下文信息。

10. **配置管理**
    - `GET /config` - 获取配置
    - `PATCH /config` - 更新配置
    - `GET /config/providers` - 列出 providers
    
    **原因**: 动态配置管理。

---

### 🔵 Low Priority (长期考虑)

11. **Provider 管理**
    - Provider 认证和 OAuth 流程
    
    **原因**: 复杂度高，可以通过 OpenCode CLI 管理。

12. **LSP/Formatter/MCP 状态**
    - 查询和管理各种服务器状态
    
    **原因**: 高级功能，用户需求不高。

13. **TUI 控制**
    - 控制 OpenCode TUI
    
    **原因**: Obsidian 插件不需要控制 TUI。

14. **Shell 命令执行**
    - `POST /session/:id/shell` - 运行 shell 命令
    
    **原因**: 安全风险高，需要谨慎实现。

---

## 架构建议

### 1. SDK 客户端扩展

当前 `OpenCodeServerClient` 类只实现了部分 API。建议：

```typescript
// 扩展客户端以支持更多 API
export class OpenCodeServerClient {
  // 现有方法...
  
  // 新增：会话管理
  async listSessions(): Promise<Session[]>
  async getSession(sessionId: string): Promise<Session>
  async deleteSession(sessionId: string): Promise<boolean>
  async updateSession(sessionId: string, updates: { title?: string }): Promise<Session>
  async forkSession(sessionId: string, messageId?: string): Promise<Session>
  async shareSession(sessionId: string): Promise<Session>
  async unshareSession(sessionId: string): Promise<Session>
  async getSessionDiff(sessionId: string, messageId?: string): Promise<FileDiff[]>
  async summarizeSession(sessionId: string, provider: string, model: string): Promise<boolean>
  async revertMessage(sessionId: string, messageId: string, partId?: string): Promise<boolean>
  async unrevertMessages(sessionId: string): Promise<boolean>
  
  // 新增：消息管理
  async listMessages(sessionId: string, limit?: number): Promise<Message[]>
  async getMessage(sessionId: string, messageId: string): Promise<Message>
  async sendMessageAsync(sessionId: string, content: string): Promise<void>
  
  // 新增：文件搜索
  async searchText(pattern: string): Promise<SearchResult[]>
  async findFiles(query: string): Promise<string[]>
  async findSymbols(query: string): Promise<Symbol[]>
  
  // 新增：项目和路径
  async listProjects(): Promise<Project[]>
  async getCurrentProject(): Promise<Project>
  async getCurrentPath(): Promise<Path>
  async getVcsInfo(): Promise<VcsInfo>
  
  // 新增：配置
  async getConfig(): Promise<Config>
  async updateConfig(updates: Partial<Config>): Promise<Config>
  async listProviders(): Promise<ProviderList>
  
  // 新增：Agent
  async listAgents(): Promise<Agent[]>
  
  // 新增：权限
  async respondToPermission(
    sessionId: string, 
    permissionId: string, 
    response: boolean, 
    remember?: boolean
  ): Promise<boolean>
}
```

### 2. UI 增强

需要添加以下 UI 组件：

1. **会话列表视图**
   - 显示所有会话
   - 支持切换、删除、重命名会话
   - 显示会话状态和最后更新时间

2. **消息历史视图**
   - 显示完整的消息历史
   - 支持滚动加载
   - 支持消息回退和恢复

3. **文件搜索面板**
   - 集成文件和符号搜索
   - 显示搜索结果
   - 支持跳转到文件

4. **会话操作菜单**
   - Fork 会话
   - 分享会话
   - 查看 diff
   - 总结会话

### 3. 权限系统集成

当前插件有独立的权限系统（`PermissionManager`），需要：

1. 监听 OpenCode Server 的权限请求事件
2. 通过 UI 提示用户批准/拒绝
3. 调用 `POST /session/:id/permissions/:permissionID` 响应

### 4. 事件处理增强

当前事件处理只支持基础的流式响应，需要添加：

1. 权限请求事件处理
2. 会话状态变更事件
3. 文件变更事件
4. 错误事件

---

## 与官方 SDK 的对比

### 官方 SDK (@opencode-ai/sdk)

根据文档，官方 SDK 提供了完整的 API 封装：

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk/client";

const client = createOpencodeClient({
  baseUrl: "http://localhost:4096"
});

// 官方 SDK 支持的 API
await client.session.list()
await client.session.get({ path: { id } })
await client.session.create({ body: { title } })
await client.session.delete({ path: { id } })
await client.session.fork({ path: { id }, body: { messageID } })
await client.session.share({ path: { id } })
await client.session.messages({ path: { id } })
await client.session.prompt({ path: { id }, body: { parts } })
await client.find.text({ query: { pattern } })
await client.find.files({ query: { query } })
await client.find.symbols({ query: { query } })
// ... 更多 API
```

### 当前插件实现

当前插件使用了官方 SDK，但只调用了很少的 API：

```typescript
// 当前使用的 SDK API
this.sdkClient.session.create({ body: { title } })
this.sdkClient.session.get({ path: { id } })
this.sdkClient.session.prompt({ path: { id }, body: { parts } })
this.sdkClient.session.command({ path: { id }, body: { command, arguments } })
this.sdkClient.session.abort({ path: { id } })
this.sdkClient.command.list()
```

**建议**: 直接使用官方 SDK 的完整 API，而不是重新封装。

---

## 实现路线图

### Phase 1: 核心功能补全 (2-3 周)

1. **会话管理**
   - 实现会话列表 UI
   - 添加会话切换、删除、重命名功能
   - 集成 `session.list()`, `session.get()`, `session.delete()`, `session.update()`

2. **消息历史**
   - 实现消息历史加载
   - 集成 `session.messages()`

3. **权限集成**
   - 监听权限请求事件
   - 实现权限响应 UI
   - 集成 `postSessionByIdPermissionsByPermissionId()`

### Phase 2: 高级功能 (3-4 周)

4. **会话高级操作**
   - Fork 会话 UI
   - 消息回退/恢复 UI
   - Diff 查看器
   - 集成 `session.fork()`, `session.revert()`, `session.unrevert()`

5. **文件搜索**
   - 文件搜索面板
   - 符号搜索
   - 集成 `find.text()`, `find.files()`, `find.symbols()`

6. **Agent 动态加载**
   - 从服务器获取 agent 列表
   - 集成 `app.agents()`

### Phase 3: 增强功能 (4-6 周)

7. **会话分享和总结**
   - 分享功能 UI
   - 总结功能
   - 集成 `session.share()`, `session.summarize()`

8. **项目和配置管理**
   - 项目信息显示
   - 配置管理 UI
   - 集成 `project.*`, `config.*`

### Phase 4: 完善和优化 (持续)

9. **性能优化**
   - 实现缓存策略
   - 优化事件处理
   - 减少不必要的 API 调用

10. **用户体验**
    - 改进错误提示
    - 添加加载状态
    - 优化 UI 交互

---

## 总结

当前 OpenCode Obsidian 插件实现了基础的聊天功能，但**缺失了大量高级功能**。主要问题：

1. **会话管理不完整**: 无法列出、切换、删除历史会话
2. **消息历史缺失**: 无法查看完整的对话历史
3. **权限系统未集成**: 两套权限系统可能冲突
4. **文件搜索缺失**: 无法通过 OpenCode 搜索文件和符号
5. **Agent 硬编码**: 无法动态获取可用的 agents
6. **高级功能缺失**: Fork、分享、diff、总结等功能都未实现

**建议优先实现**:
1. 会话列表和管理（Critical）
2. 消息历史查询（Critical）
3. 权限系统集成（Critical）
4. 会话高级操作（High）
5. 文件搜索（High）

这些功能的实现将大大提升插件的可用性和用户体验。

---

**分析完成**: 2026-01-16  
**分析者**: Kiro AI Assistant  
**参考文档**: 
- https://dev.opencode.ai/docs/server/
- https://dev.opencode.ai/docs/sdk
- 当前代码库
