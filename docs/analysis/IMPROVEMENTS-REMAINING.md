# 尚未完成的问题清单（后续改进）

本文档记录在完成当前 P0（单会话串行化、SSE 重连策略、权限预览拒绝直显）之后，项目里仍然存在/暂缓的改进点，便于后续按优先级继续推进。

## P0（已完成）

- **只能一个会话在跑**：同一时间只允许一个 in-flight 的 prompt（避免并发请求/并发流式刷新导致状态错乱）。
- **重连策略**：SSE 断开后采用指数退避 + 抖动（jitter）重连，并在达到最大次数后进入 `error` 状态（避免无限重连）。
- **直接显示拒绝**：工具执行在生成预览阶段若权限不足，直接拒绝并返回错误，不再弹确认框/展示被“裁剪”的预览内容。

## P1（建议尽快补齐）

- **连接状态与诊断可视化**：UI 层目前没有完整展示 `connected / reconnecting / error` 的原因、重连次数、下次重连延迟、最后一次错误等诊断信息（可以基于 `onReconnectAttempt` / `lastConnectionError` 补齐）。
- **设置项暴露与可配置化**：已经存在 `reconnectDelay`、`reconnectMaxAttempts` 等配置字段（`src/types.ts`），但设置面板未完整暴露或缺少解释/校验（建议加到 Settings，并在 UI 文案中说明默认值与含义）。
- **Settings 连接测试的错误处理一致性**：`src/settings.ts` 中仍有 `console.error`（建议统一走 `ErrorHandler`，并给用户更友好的错误提示）。
- **Audit logger 的错误路径一致性**：`src/tools/obsidian/audit-logger.ts` 仍使用 `console.error` 打印（建议统一到 `ErrorHandler` 或明确其“最后兜底”定位，避免日志重复/噪音）。

## P2（功能缺口 / 与上游能力相关）

- **OpenCode 协议的“chunk”处理未完善**：`src/opencode-obsidian-view.ts` 存在 `handleResponseChunk` 的 TODO，目前更多依赖事件流转；如果 OpenCode Server 协议包含更细粒度的增量事件（text/thinking/tool_use/tool_result），需要补齐解析与渲染规则。
- **会话标题同步到服务器**：本地对话重命名不会同步到 OpenCode Server（`src/opencode-obsidian-view.ts` 有 TODO），需要服务端 API 支持后再实现。
- **自动生成对话标题**：当前仅有本地占位逻辑（`src/opencode-obsidian-view.ts` 有 TODO），若希望由模型生成需依赖服务端能力/接口。
- **Provider/Model 选择**：UI 中保留了与“由服务端管理 provider/model”相关的 TODO；如果后端支持 per-session 选择，需要明确协议并实现。

## 暂缓（按当前约束不做）

- **Auth**：当前按“本地登录/本地使用”暂不做认证与权限体系（未来如要远程访问服务器再补齐）。
- **图片消息的端到端支持**：UI 侧已能选择/保存图片并准备 attachment，但 `src/opencode-server/client.ts` 明确标注“SDK client 暂不支持图片”并忽略发送（等上游 SDK/协议明确后再实现）。

