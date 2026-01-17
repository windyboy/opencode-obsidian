# OpenCode Obsidian Plugin - 功能缺失分析（修正版）

**分析日期**: 2026-01-17  
**分析对象**: OpenCode Obsidian Plugin vs OpenCode Server 官方 API  
**参考文档**: https://dev.opencode.ai/docs/server/  
**分析方法**: 代码库全面审查 + SDK API 对比

---

## 执行摘要

经过对代码库的全面审查，发现**原 FEATURE_GAP_ANALYSIS.md 存在重大错误**，将 8 个已实现功能错误标记为缺失。修正后的分析显示：

- ✅ **已实现**: 核心会话管理、消息历史、回退恢复、差异查看等功能
- ❌ **实际缺失**: 9 个核心功能（而非原文档的 18+）
- 🎯 **关键缺失**: 会话 Fork、权限系统集成、文件搜索

---

## ✅ 已实现的功能（原文档错误标记为缺失）

### 1. 会话列表和管理 ✅

**实现状态**: 完全实现  
**代码位置**: `src/opencode-server/client.ts`

- ✅ `GET /session` → `listSessions()` (lines 1009-1056)
- ✅ `GET /session/:id` → `ensureSession()` (lines 496-523)
- ✅ `DELETE /session/:id` → `deleteSession()` (lines 1168-1221)
- ✅ `PATCH /session/:id` → `updateSessionTitle()` (lines 1122-1163)

**集成状态**: 
- `SessionManager` 提供缓存和错误处理 (lines 142-191)
- `ConversationSync` 自动同步服务器会话 (lines 131-198)
- UI 支持会话切换、删除、重命名

### 2. 消息历史查询 ✅

**实现状态**: 完全实现  
**代码位置**: `src/opencode-server/client.ts`

- ✅ `GET /session/:id/message` → `getSessionMessages()` (lines 1061-1117)

**集成状态**:
- `ConversationManager.loadSessionMessages()` 自动加载历史 (lines 388-428)
- 支持切换会话时自动加载消息历史

### 3. 会话回退和恢复 ✅

**实现状态**: 完全实现  
**代码位置**: `src/opencode-server/client.ts`

- ✅ `POST /session/:id/revert` → `revertSession()` (lines 1227-1262)
- ✅ `POST /session/:id/unrevert` → `unrevertSession()` (lines 1267-1301)

**UI 集成**: 
- `revertToMessage()` 方法在视图中可用 (line 437)
- `unrevertSession()` 方法已实现 (line 474)
- 消息列表组件支持回退操作 (lines 117-118)

### 4. 会话差异查看 ✅

**实现状态**: 完全实现  
**代码位置**: `src/opencode-server/client.ts` + UI

- ✅ `GET /session/:id/diff` → `getSessionDiff()` (lines 1307-1359)
- ✅ `DiffViewerModal` 组件完整实现 (`src/views/modals/diff-viewer-modal.ts`)
- ✅ `viewSessionDiff()` 在视图中集成 (lines 817-851)
- ✅ 会话上下文菜单包含"View changes"选项 (lines 284-293)

### 5. 其他已实现的基础功能 ✅

- ✅ `createSession()` - 创建会话
- ✅ `sendMessage()` - 发送消息
- ✅ `sendSessionCommand()` - 发送命令
- ✅ `abortSession()` - 中止会话
- ✅ `listCommands()` - 列出命令（带缓存）
- ✅ `healthCheck()` - 健康检查
- ✅ 事件流订阅 (SSE)

---

## ❌ 实际缺失的功能（按优先级排序）

### 🔴 Critical Priority (0.9-1.0)

#### 1. 会话 Fork 功能 - 评分: 0.95

**事实依据**:
- ❌ 代码中未找到 `forkSession()` 方法
- ❌ `sdkClient.session.fork()` 未被调用
- ❌ `.kiro/specs/session-management-enhancement/tasks.md` 标记为未完成 (line 293)

**API**: `POST /session/:id/fork`

**影响**:
- 无法从某个消息点创建新分支会话
- 无法探索不同的对话路径
- 这是 OpenCode 的核心功能之一

**修正方案**:

```typescript
// 在 OpenCodeServerClient 中添加 (src/opencode-server/client.ts)
/**
 * Fork a session from a specific message point
 */
async forkSession(sessionId: string, messageId?: string): Promise<string> {
  try {
    const response = await this.sdkClient.session.fork({
      path: { id: sessionId },
      body: messageId ? { messageID: messageId } : {},
    });

    if (response.error) {
      throw new Error(`Failed to fork session: ${response.error}`);
    }

    if (!response.data) {
      throw new Error("OpenCode Server session.fork returned no data.");
    }

    const forkedSession = response.data;
    const forkedSessionId = this.extractSessionId(forkedSession);
    if (!forkedSessionId) {
      throw new Error("Forked session did not include an id.");
    }

    this.sessions.set(forkedSessionId, forkedSession);
    return forkedSessionId;
  } catch (error) {
    const statusCode = getErrorStatusCode(error);
    let err: Error;

    if (statusCode === 404 || statusCode === 500) {
      err = this.createHttpError(statusCode, "forking session", sessionId);
    } else {
      err = error instanceof Error ? error : new Error(String(error));
    }

    this.errorHandler.handleError(
      err,
      {
        module: "OpenCodeClient",
        function: "forkSession",
        operation: "Forking session",
        metadata: { sessionId, messageId, statusCode },
      },
      ErrorSeverity.Error,
    );
    throw err;
  }
}
```

**UI 集成**:
- 在消息上下文菜单中添加"Fork from here"选项
- 在会话菜单中添加"Fork session"选项
- Fork 后自动切换到新会话

---

#### 2. 权限请求系统集成 - 评分: 0.92

**事实依据**:
- ✅ 插件有独立的 `PermissionManager` (`src/tools/obsidian/permission-manager.ts`)
- ❌ 未找到 `POST /session/:id/permissions/:permissionID` API 调用
- ❌ 未找到 SSE 事件中权限请求的处理逻辑
- ⚠️ `docs/ARCHITECTURE.md` 明确指出这是已知问题 (lines 448-449)

**API**: `POST /session/:id/permissions/:permissionID`

**影响**:
- OpenCode Server 请求的权限无法通过插件响应
- 两套权限系统可能产生冲突
- 用户需要在两个地方管理权限

**当前架构问题**:
- 插件权限系统处理 Obsidian 工具调用
- OpenCode Server 可能有自己的权限请求机制
- 两者未集成，可能导致权限状态不一致

**修正方案**:

```typescript
// 1. 在 OpenCodeServerClient 中添加响应方法
async respondToPermission(
  sessionId: string,
  permissionId: string,
  approved: boolean,
  remember?: boolean,
): Promise<void> {
  try {
    const response = await this.sdkClient.session.permissions.respond({
      path: { id: sessionId, permissionID: permissionId },
      body: { approved, remember },
    });

    if (response.error) {
      throw new Error(`Failed to respond to permission: ${response.error}`);
    }
  } catch (error) {
    const statusCode = getErrorStatusCode(error);
    let err: Error;

    if (statusCode === 404 || statusCode === 500) {
      err = this.createHttpError(statusCode, "responding to permission", sessionId);
    } else {
      err = error instanceof Error ? error : new Error(String(error));
    }

    this.errorHandler.handleError(
      err,
      {
        module: "OpenCodeClient",
        function: "respondToPermission",
        operation: "Responding to permission request",
        metadata: { sessionId, permissionId, approved, statusCode },
      },
      ErrorSeverity.Error,
    );
    throw err;
  }
}

// 2. 在 handleSDKEvent 中添加权限请求事件处理
private handlePermissionRequest(event: any, sessionId: string): void {
  const permissionId = event.properties?.permissionID || event.permissionID;
  const toolName = event.properties?.toolName || event.toolName;
  const args = event.properties?.args || event.args;
  const description = event.properties?.description || event.description;

  // 触发权限请求回调
  // 需要添加 onPermissionRequest 回调机制
}
```

**UI 集成**:
- 监听 SSE 事件中的 `permission.request` 类型
- 显示权限请求模态框（重用 `PermissionModal`）
- 用户批准/拒绝后调用 `respondToPermission()`

---

### 🟡 High Priority (0.75-0.89)

#### 3. 文件和符号搜索 - 评分: 0.85

**事实依据**:
- ✅ 插件有 `obsidian.search_vault` 工具，但只搜索 Obsidian vault (`src/tools/obsidian/tool-executor.ts`, lines 206-291)
- ❌ 未找到 `find.text()`, `find.files()`, `find.symbols()` API 调用
- ❌ 无法搜索项目文件（非 vault 文件）

**APIs**: 
- `GET /find?pattern=<pat>` - 搜索文本
- `GET /find/file?query=<q>` - 查找文件
- `GET /find/symbol?query=<q>` - 查找符号

**影响**:
- AI 无法搜索项目代码文件
- 无法查找函数、类等符号定义
- 搜索范围限制在 Obsidian vault

**修正方案**:

```typescript
// 在 OpenCodeServerClient 中添加 (src/opencode-server/client.ts)

/**
 * Search for text in project files
 */
async searchText(pattern: string, limit?: number): Promise<SearchResult[]> {
  try {
    const response = await this.sdkClient.find.text({
      query: { pattern, ...(limit ? { limit } : {}) },
    });

    if (response.error) {
      throw new Error(`Failed to search text: ${response.error}`);
    }

    if (!response.data) {
      throw new Error("OpenCode Server find.text returned no data.");
    }

    return response.data.results || [];
  } catch (error) {
    const statusCode = getErrorStatusCode(error);
    let err: Error;

    if (statusCode === 404 || statusCode === 500) {
      err = this.createHttpError(statusCode, "searching text");
    } else {
      err = error instanceof Error ? error : new Error(String(error));
    }

    this.errorHandler.handleError(
      err,
      {
        module: "OpenCodeClient",
        function: "searchText",
        operation: "Searching text in files",
        metadata: { pattern, statusCode },
      },
      ErrorSeverity.Warning,
    );
    throw err;
  }
}

/**
 * Find files by name query
 */
async findFiles(query: string): Promise<string[]> {
  try {
    const response = await this.sdkClient.find.files({
      query: { query },
    });

    if (response.error) {
      throw new Error(`Failed to find files: ${response.error}`);
    }

    return response.data.files || [];
  } catch (error) {
    this.errorHandler.handleError(
      error,
      {
        module: "OpenCodeClient",
        function: "findFiles",
        operation: "Finding files",
        metadata: { query },
      },
      ErrorSeverity.Warning,
    );
    throw error;
  }
}

/**
 * Find symbols (functions, classes, etc.) in codebase
 */
async findSymbols(query: string): Promise<Symbol[]> {
  try {
    const response = await this.sdkClient.find.symbols({
      query: { query },
    });

    if (response.error) {
      throw new Error(`Failed to find symbols: ${response.error}`);
    }

    return response.data.symbols || [];
  } catch (error) {
    this.errorHandler.handleError(
      error,
      {
        module: "OpenCodeClient",
        function: "findSymbols",
        operation: "Finding symbols",
        metadata: { query },
      },
      ErrorSeverity.Warning,
    );
    throw error;
  }
}
```

**UI 集成**:
- 添加文件搜索面板组件
- 支持在输入框中快捷搜索（如 `/search pattern`）
- 显示搜索结果并可跳转到文件

---

#### 4. Agent 动态列表 - 评分: 0.80

**事实依据**:
- ❌ `settings.ts` 中硬编码了 agent 列表
- ❌ 未找到 `app.agents()` 或 `listAgents()` 方法调用
- ❌ 新增 agent 需要更新插件代码

**API**: `GET /agent`

**影响**:
- 无法使用服务器端新增的 agents
- 维护成本高
- 用户体验不佳（看不到所有可用 agents）

**修正方案**:

```typescript
// 在 OpenCodeServerClient 中添加 (src/opencode-server/client.ts)

/**
 * List all available agents from the server
 */
async listAgents(): Promise<Agent[]> {
  try {
    const response = await this.sdkClient.app.agents();

    if (response.error) {
      throw new Error(`Failed to list agents: ${response.error}`);
    }

    if (!response.data) {
      throw new Error("OpenCode Server app.agents returned no data.");
    }

    return response.data.agents || [];
  } catch (error) {
    this.errorHandler.handleError(
      error,
      {
        module: "OpenCodeClient",
        function: "listAgents",
        operation: "Listing agents",
      },
      ErrorSeverity.Warning,
    );
    // Return empty array on error to allow fallback to hardcoded list
    return [];
  }
}
```

**设置页面集成** (`src/settings.ts`):
- 插件加载时从服务器获取 agent 列表
- 设置页面添加"刷新 Agents"按钮
- 如果服务器不可用，回退到硬编码列表
- 在 agent 选择下拉框中显示所有可用 agents

---

#### 5. 会话分享功能 - 评分: 0.78

**事实依据**:
- ❌ 未找到 `session.share()` 或 `session.unshare()` 调用

**APIs**: 
- `POST /session/:id/share` - 分享会话
- `DELETE /session/:id/share` - 取消分享

**影响**:
- 无法生成分享链接
- 无法与他人协作查看会话

**修正方案**:

```typescript
// 在 OpenCodeServerClient 中添加 (src/opencode-server/client.ts)

/**
 * Share a session to generate a shareable URL
 */
async shareSession(sessionId: string): Promise<{ shareUrl: string }> {
  try {
    const response = await this.sdkClient.session.share({
      path: { id: sessionId },
    });

    if (response.error) {
      throw new Error(`Failed to share session: ${response.error}`);
    }

    if (!response.data || !response.data.shareUrl) {
      throw new Error("OpenCode Server session.share did not return a share URL.");
    }

    return { shareUrl: response.data.shareUrl };
  } catch (error) {
    const statusCode = getErrorStatusCode(error);
    let err: Error;

    if (statusCode === 404 || statusCode === 500) {
      err = this.createHttpError(statusCode, "sharing session", sessionId);
    } else {
      err = error instanceof Error ? error : new Error(String(error));
    }

    this.errorHandler.handleError(
      err,
      {
        module: "OpenCodeClient",
        function: "shareSession",
        operation: "Sharing session",
        metadata: { sessionId, statusCode },
      },
      ErrorSeverity.Error,
    );
    throw err;
  }
}

/**
 * Unshare a session to revoke share access
 */
async unshareSession(sessionId: string): Promise<void> {
  try {
    const response = await this.sdkClient.session.unshare({
      path: { id: sessionId },
    });

    if (response.error) {
      throw new Error(`Failed to unshare session: ${response.error}`);
    }
  } catch (error) {
    const statusCode = getErrorStatusCode(error);
    let err: Error;

    if (statusCode === 404 || statusCode === 500) {
      err = this.createHttpError(statusCode, "unsharing session", sessionId);
    } else {
      err = error instanceof Error ? error : new Error(String(error));
    }

    this.errorHandler.handleError(
      err,
      {
        module: "OpenCodeClient",
        function: "unshareSession",
        operation: "Unsharing session",
        metadata: { sessionId, statusCode },
      },
      ErrorSeverity.Error,
    );
    throw err;
  }
}
```

**UI 集成**:
- 在会话上下文菜单中添加"Share session"选项
- 显示分享链接模态框，支持复制链接
- 已分享的会话显示分享图标
- 支持取消分享

---

### 🟢 Medium Priority (0.60-0.74)

#### 6. 会话总结功能 - 评分: 0.70

**事实依据**:
- ❌ 未找到 `session.summarize()` 调用

**API**: `POST /session/:id/summarize`

**影响**:
- 无法自动生成会话摘要
- 长对话难以快速回顾

**修正方案**:

```typescript
/**
 * Summarize a session using specified provider and model
 */
async summarizeSession(
  sessionId: string,
  provider: string,
  model: string,
): Promise<string> {
  try {
    const response = await this.sdkClient.session.summarize({
      path: { id: sessionId },
      body: { provider, model },
    });

    if (response.error) {
      throw new Error(`Failed to summarize session: ${response.error}`);
    }

    if (!response.data || !response.data.summary) {
      throw new Error("OpenCode Server session.summarize did not return a summary.");
    }

    return response.data.summary;
  } catch (error) {
    this.errorHandler.handleError(
      error,
      {
        module: "OpenCodeClient",
        function: "summarizeSession",
        operation: "Summarizing session",
        metadata: { sessionId, provider, model },
      },
      ErrorSeverity.Warning,
    );
    throw error;
  }
}
```

---

#### 7. 项目和路径信息 - 评分: 0.65

**事实依据**:
- ❌ 未找到 `project.*` 或 `path.*` API 调用

**APIs**: 
- `GET /project` - 列出所有项目
- `GET /project/current` - 获取当前项目
- `GET /path` - 获取当前路径
- `GET /vcs` - 获取 VCS 信息

**影响**:
- AI 缺少项目结构信息
- 文件路径可能不准确
- 无法获取版本控制上下文

**修正方案**:

```typescript
/**
 * Get current project information
 */
async getCurrentProject(): Promise<Project> {
  try {
    const response = await this.sdkClient.project.current();

    if (response.error) {
      throw new Error(`Failed to get current project: ${response.error}`);
    }

    return response.data;
  } catch (error) {
    this.errorHandler.handleError(
      error,
      {
        module: "OpenCodeClient",
        function: "getCurrentProject",
        operation: "Getting current project",
      },
      ErrorSeverity.Warning,
    );
    throw error;
  }
}

/**
 * Get current working path
 */
async getCurrentPath(): Promise<string> {
  try {
    const response = await this.sdkClient.path.get();

    if (response.error) {
      throw new Error(`Failed to get current path: ${response.error}`);
    }

    return response.data.path;
  } catch (error) {
    this.errorHandler.handleError(
      error,
      {
        module: "OpenCodeClient",
        function: "getCurrentPath",
        operation: "Getting current path",
      },
      ErrorSeverity.Warning,
    );
    throw error;
  }
}
```

---

#### 8. 配置动态管理 - 评分: 0.63

**事实依据**:
- ❌ 未找到 `config.*` API 调用

**APIs**: 
- `GET /config` - 获取配置
- `PATCH /config` - 更新配置
- `GET /config/providers` - 列出 providers

**影响**:
- 无法查询服务器配置
- 无法动态更新配置
- 无法查看可用的 providers

**修正方案**:

```typescript
/**
 * Get server configuration
 */
async getConfig(): Promise<Config> {
  try {
    const response = await this.sdkClient.config.get();

    if (response.error) {
      throw new Error(`Failed to get config: ${response.error}`);
    }

    return response.data;
  } catch (error) {
    this.errorHandler.handleError(
      error,
      {
        module: "OpenCodeClient",
        function: "getConfig",
        operation: "Getting configuration",
      },
      ErrorSeverity.Warning,
    );
    throw error;
  }
}

/**
 * List available providers
 */
async listProviders(): Promise<Provider[]> {
  try {
    const response = await this.sdkClient.config.providers();

    if (response.error) {
      throw new Error(`Failed to list providers: ${response.error}`);
    }

    return response.data.providers || [];
  } catch (error) {
    this.errorHandler.handleError(
      error,
      {
        module: "OpenCodeClient",
        function: "listProviders",
        operation: "Listing providers",
      },
      ErrorSeverity.Warning,
    );
    return [];
  }
}
```

---

#### 9. 异步消息发送 - 评分: 0.62

**事实依据**:
- ✅ 只有同步的 `sendMessage()` 方法
- ❌ 未找到 `prompt_async` API 调用

**API**: `POST /session/:id/prompt_async`

**影响**:
- 长时间运行的任务会阻塞 UI
- 无法后台执行长任务

**修正方案**:

```typescript
/**
 * Send message asynchronously (don't wait for response)
 * Results will be delivered via SSE events
 */
async sendMessageAsync(sessionId: string, content: string): Promise<void> {
  try {
    const response = await this.sdkClient.session.promptAsync({
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text: content }],
      },
    });

    if (response.error) {
      throw new Error(`Failed to send async message: ${response.error}`);
    }

    // Don't wait for response - results come via SSE
  } catch (error) {
    this.errorHandler.handleError(
      error,
      {
        module: "OpenCodeClient",
        function: "sendMessageAsync",
        operation: "Sending async message",
        metadata: { sessionId, contentLength: content.length },
      },
      ErrorSeverity.Error,
    );
    throw error;
  }
}
```

---

### 🔵 Low Priority (0.40-0.59)

#### 10. Shell 命令执行 - 评分: 0.55

**API**: `POST /session/:id/shell`

**影响**: 安全风险高，需要谨慎实现

**建议**: 仅在用户明确启用时提供，默认禁用

---

#### 11. Provider OAuth 管理 - 评分: 0.50

**影响**: 复杂度高，建议通过 OpenCode CLI 管理

---

#### 12. LSP/Formatter/MCP 状态 - 评分: 0.45

**APIs**: 
- `GET /lsp` - 获取 LSP 服务器状态
- `GET /formatter` - 获取格式化器状态
- `GET /mcp` - 获取 MCP 服务器状态

**影响**: 高级功能，用户需求不高

---

## 总结对比

### 原文档错误

**FEATURE_GAP_ANALYSIS.md** 将以下已实现功能错误标记为缺失：

1. ❌ 会话列表 (`listSessions`) - **实际已实现**
2. ❌ 会话详情 (`ensureSession`) - **实际已实现**
3. ❌ 删除会话 (`deleteSession`) - **实际已实现**
4. ❌ 更新会话标题 (`updateSessionTitle`) - **实际已实现**
5. ❌ 消息历史 (`getSessionMessages`) - **实际已实现**
6. ❌ 会话回退 (`revertSession`) - **实际已实现**
7. ❌ 会话恢复 (`unrevertSession`) - **实际已实现**
8. ❌ 会话差异 (`getSessionDiff`) - **实际已实现**

### 实际缺失功能统计

- **Critical Priority**: 2 个功能
- **High Priority**: 3 个功能
- **Medium Priority**: 4 个功能
- **Low Priority**: 3 个功能
- **总计**: 12 个功能（而非原文档的 18+）

---

## 修正后的优先级路线图

### Phase 1: Critical (1-2周)

**目标**: 实现核心缺失功能

1. ✅ 会话 Fork 功能 (0.95)
   - 实现 `forkSession()` API 方法
   - 添加 UI 集成（消息菜单、会话菜单）
   - 测试 fork 创建独立会话

2. ✅ 权限请求系统集成 (0.92)
   - 添加 `respondToPermission()` 方法
   - 监听 SSE 权限请求事件
   - 集成插件权限系统与服务器权限系统

### Phase 2: High Priority (2-3周)

**目标**: 增强搜索和配置能力

3. ✅ 文件和符号搜索 (0.85)
   - 实现 `searchText()`, `findFiles()`, `findSymbols()`
   - 添加文件搜索面板 UI
   - 支持快捷搜索命令

4. ✅ Agent 动态列表 (0.80)
   - 实现 `listAgents()` 方法
   - 设置页面动态加载 agents
   - 添加刷新按钮

5. ✅ 会话分享功能 (0.78)
   - 实现 `shareSession()` 和 `unshareSession()`
   - 添加分享链接 UI
   - 支持复制和取消分享

### Phase 3: Medium Priority (3-4周)

**目标**: 完善辅助功能

6. ✅ 会话总结功能 (0.70)
7. ✅ 项目和路径信息 (0.65)
8. ✅ 配置动态管理 (0.63)
9. ✅ 异步消息发送 (0.62)

### Phase 4: Low Priority (按需实现)

10. Shell 命令执行 (0.55)
11. Provider OAuth 管理 (0.50)
12. LSP/Formatter/MCP 状态 (0.45)

---

## 实现建议

### 1. 代码结构

所有新的 API 方法应遵循现有模式：
- 统一的错误处理（使用 `getErrorStatusCode` 和 `createHttpError`）
- 错误日志记录（使用 `ErrorHandler`）
- 类型安全（使用 TypeScript 类型）
- 一致的命名约定

### 2. UI 集成模式

- **会话操作**: 添加到 `ConversationSelectorComponent` 的上下文菜单
- **消息操作**: 添加到 `MessageListComponent` 的消息菜单
- **设置**: 添加到 `SettingsTab` 组件
- **模态框**: 创建独立的 Modal 组件（参考 `DiffViewerModal`）

### 3. 测试策略

- 为每个新 API 方法添加单元测试（参考 `session-methods.test.ts`）
- 测试错误处理（404, 500, 网络错误）
- 测试 UI 集成（用户交互流程）

---

## 附录：SDK API 使用情况

### 当前已使用的 SDK API

```typescript
// Session Management
this.sdkClient.session.create({ body: { title } })
this.sdkClient.session.get({ path: { id } })
this.sdkClient.session.list()
this.sdkClient.session.update({ path: { id }, body: { title } })
this.sdkClient.session.delete({ path: { id } })
this.sdkClient.session.prompt({ path: { id }, body: { parts } })
this.sdkClient.session.command({ path: { id }, body: { command, arguments } })
this.sdkClient.session.abort({ path: { id } })
this.sdkClient.session.messages({ path: { id } })
this.sdkClient.session.revert({ path: { id }, body: { messageID } })
this.sdkClient.session.unrevert({ path: { id } })
this.sdkClient.session.diff({ path: { id } })

// Commands
this.sdkClient.command.list()

// Events
this.sdkClient.event.subscribe({ signal })
```

### 待使用的 SDK API

```typescript
// Session Management (Missing)
this.sdkClient.session.fork({ path: { id }, body: { messageID } })
this.sdkClient.session.share({ path: { id } })
this.sdkClient.session.unshare({ path: { id } })
this.sdkClient.session.summarize({ path: { id }, body: { provider, model } })
this.sdkClient.session.permissions.respond({ path: { id, permissionID }, body: { approved, remember } })
this.sdkClient.session.promptAsync({ path: { id }, body: { parts } })

// File & Symbol Search (Missing)
this.sdkClient.find.text({ query: { pattern } })
this.sdkClient.find.files({ query: { query } })
this.sdkClient.find.symbols({ query: { query } })

// Project & Path (Missing)
this.sdkClient.project.current()
this.sdkClient.path.get()

// Configuration (Missing)
this.sdkClient.config.get()
this.sdkClient.config.providers()

// App (Missing)
this.sdkClient.app.agents()
```

---

**分析完成**: 2026-01-17  
**分析者**: AI Code Reviewer  
**验证方法**: 代码库全面审查 + API 对比  
**准确性**: 基于实际代码实现验证
