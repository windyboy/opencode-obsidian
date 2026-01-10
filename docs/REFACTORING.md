# OpenCode Obsidian 重构文档

> 基于 oh-my-opencode 标准的架构升级方案

**版本**: 1.0  
**日期**: 2024-12  
**基准**: [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode)

---

## 执行摘要

### 重构目标

将 `opencode-obsidian` 从"Agent Harness 骨架"升级为"真正可执行的 Agent 系统",实现:
1. **Agent Loop 状态机** - 计划 → 执行 → 校验 → 重试的完整循环
2. **Context 按需检索** - 主动获取上下文,而非被动压缩
3. **任务编排器** - TODO Manager 升级为支持多步任务执行的编排器
4. **MCP 集成完成** - 移除 placeholder,实现完整的 MCP 工具支持
5. **配置安全增强** - Provider baseURL 验证与 SSRF 防护

### 当前状态

- ✅ Tool Runtime 已完整实现（通过 OpenCode Server 协议闭环）
- ✅ 权限管理、审计日志已完成
- ❌ Agent Loop 状态机缺失
- ❌ Context 检索策略缺失（仅有被动压缩）
- ❌ TODO Manager 仅为数据存储（缺少编排能力）
- ❌ MCP 集成是 placeholder
- ❌ Provider baseURL 未验证（SSRF 风险）

### 预期收益

- **真正的 Agent**: "直到任务完成为止"的执行能力
- **性能优化**: Context 按需检索,减少不必要的 token 消耗
- **可观测性**: 任务进度跟踪、可中止、回滚能力
- **安全性**: 完善的 SSRF 防护

---

## 重构任务

### 任务 1: Agent Loop 状态机实现

**优先级**: P0  
**工作量**: 2-3 周

**目标**: 实现完整的 Agent 执行循环,支持计划生成、步骤执行、结果校验、自动重试

**实施步骤**:

1. **创建 Orchestrator 模块**
   - 新建 `src/orchestrator/agent-orchestrator.ts`
   - 实现 `runTurn(input: string, sessionId: string)` 方法
   - 集成到 `src/main.ts`

2. **实现状态机**
   - 定义状态: `Planning` → `Executing` → `Validating` → `Retrying` → `Completed/Cancelled/Failed`
   - 实现状态转换逻辑
   - 保存状态到 session storage

3. **结构化计划解析**
   - 从 LLM 输出提取结构化计划（steps + success criteria）
   - 存储为 `TaskPlan` 结构
   - 支持计划的序列化和反序列化

4. **步骤执行与校验**
   - 每步必须调用工具或给出可验证产物
   - 自动校验步骤结果是否符合 success criteria
   - 失败步骤自动重试（最多 N 次）

5. **集成测试**
   - Agent Loop 状态机转换测试
   - 计划解析测试
   - 重试机制测试

**文件变更**:
- 新建: `src/orchestrator/agent-orchestrator.ts`
- 新建: `src/orchestrator/types.ts`
- 新建: `src/orchestrator/task-plan.ts`
- 修改: `src/main.ts` (集成 Orchestrator)
- 新建: `tests/integration/agent-loop.test.ts`

**验收标准**:
- [ ] `AgentOrchestrator.runTurn()` 可正常工作
- [ ] 状态机转换逻辑正确
- [ ] 结构化计划可解析
- [ ] 自动重试机制工作正常
- [ ] 单元测试覆盖率 > 80%

---

### 任务 2: Context 检索策略实现

**优先级**: P1  
**工作量**: 2 周

**目标**: 实现按需上下文检索,优化 token 使用

**实施步骤**:

1. **实现检索策略接口**
   - 新建 `src/context/retrieval-strategy.ts`
   - 定义 `retrieveContext(query: string)` 方法
   - 通过 `vault.search` 主动拉取相关上下文

2. **优先级排序策略**
   - 当前 note（用户正在编辑） - 优先级 1
   - 最近 N 条对话（会话上下文） - 优先级 2
   - 任务 plan（结构化计划） - 优先级 3
   - 检索片段（通过 search 获取） - 优先级 4
   - 长期记忆摘要（压缩后的历史） - 优先级 5

3. **预算分配算法**
   - 根据优先级分配 token 预算
   - 智能截断策略（优先保留高优先级内容）
   - 新建 `src/context/context-budget-allocator.ts`

4. **压缩结果可追溯性**
   - 修改 `CompactedMessage` 接口,添加 `originalMessageIds: string[]`
   - 修改 `SmartCompactionStrategy.compact()`,记录原始消息 ID
   - 支持从压缩结果链接回原始消息

5. **集成到 Context Manager**
   - 修改 `ContextManager` 使用检索策略
   - 在 `runTurn()` 中调用检索策略

**文件变更**:
- 新建: `src/context/retrieval-strategy.ts`
- 新建: `src/context/context-budget-allocator.ts`
- 修改: `src/context/compaction-manager.ts` (增强可追溯性)
- 修改: `src/context/context-manager.ts` (集成检索策略)
- 新建: `tests/unit/retrieval-strategy.test.ts`

**验收标准**:
- [ ] 可按需检索上下文（通过 vault.search）
- [ ] 优先级排序正确
- [ ] 预算分配合理（高优先级内容优先保留）
- [ ] 压缩结果可追溯（originalMessageIds 存在）
- [ ] 检索延迟 < 100ms

---

### 任务 3: TODO Manager → 任务编排器升级

**优先级**: P1  
**工作量**: 1-2 周

**目标**: 将 TODO Manager 升级为支持多步任务执行的编排器

**实施步骤**:

1. **扩展 TODO 类型系统**
   - 修改 `src/todo/types.ts`,添加 `TaskPlan`, `TaskStep`, `TaskStatus` 类型
   - `TaskStep` 包含: `id`, `description`, `toolCall?`, `successCriteria`, `status`
   - `TaskPlan` 包含: `id`, `goal`, `steps`, `status`, `createdAt`, `updatedAt`

2. **实现任务编排器**
   - 修改 `src/todo/todo-manager.ts`,添加任务编排能力
   - 实现 `createPlan(goal: string)` - 从 LLM 输出解析结构化计划
   - 实现 `executeStep(step: TaskStep)` - 执行单个步骤
   - 实现 `validateStep(step: TaskStep, result: StepResult)` - 校验步骤结果
   - 实现 `retryStep(step: TaskStep)` - 重试失败步骤

3. **进度跟踪**
   - 实现任务进度计算（completedSteps / totalSteps）
   - 保存进度到 session storage
   - 支持查询任务状态

4. **可中止与回滚**
   - 实现 `interruptTask(taskId: string)` - 用户可随时中止任务
   - 实现检查点机制（每步完成后创建检查点）
   - 实现 `rollbackToCheckpoint(taskId: string, checkpointId: string)` - 回滚到指定检查点

5. **UI 集成**
   - 修改 `src/opencode-obsidian-view.ts`,添加任务进度显示
   - 显示进度条、当前步骤、可中止按钮
   - 任务日志查看界面

**文件变更**:
- 修改: `src/todo/types.ts` (添加 TaskPlan, TaskStep 类型)
- 修改: `src/todo/todo-manager.ts` (升级为任务编排器)
- 修改: `src/opencode-obsidian-view.ts` (UI 集成)
- 新建: `tests/integration/task-orchestrator.test.ts`

**验收标准**:
- [ ] 可解析结构化计划（steps + success criteria）
- [ ] 任务进度跟踪准确
- [ ] 用户可中止任务
- [ ] 可回滚到检查点
- [ ] UI 显示进度条和可中止按钮

---

### 任务 4: MCP 集成完成

**优先级**: P1  
**工作量**: 1-2 周

**目标**: 移除 placeholder,实现完整的 MCP 工具支持

**实施步骤**:

1. **实现 MCP 服务器初始化**
   - 修改 `src/mcp/mcp-manager.ts`,实现 `initialize()` 方法
   - 启动 MCP 服务器进程（stdio transport）
   - 实现 initialize/initialized 握手
   - 列出可用工具和资源

2. **实现工具调用**
   - 实现 `callTool(name: string, args: Record<string, unknown>)` 方法
   - 发送 `tools/call` 请求到相应的 MCP 服务器
   - 处理工具执行结果

3. **实现资源管理**
   - 实现 `listResources()` - 列出所有服务器资源
   - 实现 `getResource(uri: string)` - 获取资源内容
   - 发送 `resources/list` 和 `resources/read` 请求

4. **集成到 Tool Registry**
   - 修改 `src/tools/obsidian/tool-registry.ts`,支持动态注册 MCP 工具
   - 在 `ObsidianToolRegistry` 中注册来自 MCP 的工具
   - 统一权限管理（MCP 工具默认 read-only）

5. **实现关闭逻辑**
   - 实现 `shutdown()` 方法
   - 发送 shutdown 通知到所有服务器
   - 关闭所有连接

**文件变更**:
- 修改: `src/mcp/mcp-manager.ts` (完整实现)
- 修改: `src/mcp/types.ts` (完善类型定义)
- 修改: `src/tools/obsidian/tool-registry.ts` (支持动态注册)
- 新建: `tests/integration/mcp-manager.test.ts`

**验收标准**:
- [ ] MCP 服务器可正常初始化
- [ ] 工具调用工作正常
- [ ] 资源列表/检索可用
- [ ] 工具动态注册到 Tool Registry
- [ ] 关闭逻辑正确

---

### 任务 5: 配置安全增强

**优先级**: P2  
**工作量**: 1 周

**目标**: 防止 SSRF 攻击,增强配置安全性

**实施步骤**:

1. **Provider baseURL 验证**
   - 修改 `src/config-loader.ts`,在 `loadCompatibleProviders()` 中添加 baseURL 验证
   - 仅允许 `https://` 协议（不允许 `http://`）
   - 禁止 localhost/127.0.0.1/内网段（192.168.x.x, 10.x.x.x, 172.16-31.x.x）
   - 允许用户通过配置覆盖（高级选项,明确风险提示）

2. **YAML 解析安全模式**
   - 检查 `config-loader.ts` 中 YAML 解析代码
   - 确保使用 `js-yaml` 的 `safeLoad()` 或 `load()` 时设置 `safe: true`
   - 防止锚点/别名导致的 DoS

3. **添加安全测试**
   - 新建 `tests/security/config-loader.test.ts`
   - 测试 SSRF 防护（各种恶意 baseURL）
   - 测试路径遍历防护
   - 测试 YAML 注入防护

**文件变更**:
- 修改: `src/config-loader.ts` (添加 baseURL 验证)
- 修改: `src/utils/validators.ts` (添加 baseURL 验证函数)
- 新建: `tests/security/config-loader.test.ts`

**验收标准**:
- [ ] baseURL 验证通过（仅允许 https + 非内网）
- [ ] YAML 解析使用安全模式
- [ ] 所有安全测试通过
- [ ] 恶意输入被正确拒绝

---

## 实施计划

### 阶段 1: 核心功能（Week 1-4）

**Week 1-2**: Agent Loop 状态机实现
- 完成任务 1 的所有步骤
- 集成到现有系统

**Week 3**: Context 检索策略实现
- 完成任务 2 的所有步骤

**Week 4**: 任务编排器升级
- 完成任务 3 的核心功能（暂不包含 UI）

### 阶段 2: 扩展功能（Week 5-6）

**Week 5**: MCP 集成完成
- 完成任务 4 的所有步骤

**Week 6**: 配置安全增强 + UI 集成
- 完成任务 5
- 完成任务 3 的 UI 集成
- 端到端测试

### 阶段 3: 测试与优化（Week 7-8）

**Week 7**: 集成测试与修复
- 编写集成测试
- 修复发现的问题

**Week 8**: 性能优化与文档
- 性能测试与优化
- 更新文档
- 代码审查

---

## 验收标准

### 功能验收

- [ ] Agent Loop 状态机完整实现,状态转换正确
- [ ] Context 检索策略可用,优先级排序正确
- [ ] 任务编排器可正常工作,支持多步任务执行
- [ ] MCP 集成完成,工具调用工作正常
- [ ] 配置安全增强完成,所有安全测试通过

### 性能验收

- [ ] Context 检索延迟 < 100ms
- [ ] Agent Loop 单轮延迟 < 2s（不含 LLM 调用）
- [ ] 任务进度跟踪无性能影响
- [ ] 内存使用增长 < 20%

### 质量验收

- [ ] 单元测试覆盖率 > 80%
- [ ] 集成测试覆盖率 > 70%
- [ ] 所有安全测试通过
- [ ] 代码审查通过
- [ ] 无回归问题

---

## 风险评估

### 高风险项

1. **Agent Loop 复杂度**
   - **风险**: 状态机可能过于复杂,难以维护
   - **缓解**: 使用清晰的状态机库（如 XState）,充分单元测试

2. **Context 检索性能**
   - **风险**: vault.search 可能耗时过长
   - **缓解**: 实现检索缓存,设置超时机制

### 中风险项

1. **MCP 协议兼容性**
   - **风险**: MCP 协议可能变化,或实现不完整
   - **缓解**: 参考 MCP 官方文档,先实现基本功能,逐步扩展

2. **向后兼容性**
   - **风险**: 重构可能破坏现有功能
   - **缓解**: 充分测试现有功能,确保无回归

---

## 文件清单

### 需要新建的文件

```
src/orchestrator/
  - agent-orchestrator.ts
  - types.ts
  - task-plan.ts

src/context/
  - retrieval-strategy.ts
  - context-budget-allocator.ts

tests/integration/
  - agent-loop.test.ts
  - task-orchestrator.test.ts
  - mcp-manager.test.ts

tests/unit/
  - retrieval-strategy.test.ts

tests/security/
  - config-loader.test.ts
```

### 需要修改的文件

```
src/main.ts                          # 集成 Orchestrator
src/todo/types.ts                    # 添加 TaskPlan, TaskStep 类型
src/todo/todo-manager.ts             # 升级为任务编排器
src/context/compaction-manager.ts    # 增强可追溯性
src/context/context-manager.ts       # 集成检索策略
src/config-loader.ts                 # 添加 baseURL 验证
src/mcp/mcp-manager.ts               # 完整实现 MCP 集成
src/tools/obsidian/tool-registry.ts  # 支持动态注册
src/opencode-obsidian-view.ts        # UI 集成任务进度
src/utils/validators.ts              # 添加 baseURL 验证函数
```

---

## 附录

### 参考资源

- [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) - 参考架构
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io) - MCP 协议文档
- [XState](https://xstate.js.org) - 状态机库（可选）

### 术语表

- **Agent Loop**: Agent 执行循环,包括计划-执行-校验-重试
- **Context 检索**: 根据当前需要,主动从 Vault 中检索相关上下文
- **任务编排器**: 管理多步任务执行的系统,包括计划生成、步骤执行、进度跟踪等
- **MCP**: Model Context Protocol,标准化的工具和资源协议

---

**文档维护**: 本文档应在每个任务完成后更新,反映实际进度与变更。
