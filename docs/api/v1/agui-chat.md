# Chat AG-UI v1

本仓库对浏览器暴露的 Agent 事件流遵守 AG-UI 的事件模型。本页是 BFF-owned AG-UI 投影契约，Root 不保存第二份 wire source。Agent 内部保存自己的执行事实，BFF Chat 负责一次明确的 transport projection。

运行时使用 `@ag-ui/core@0.0.59` 的 `EventType` 和 `EventSchemas`，不手写另一套 AG-UI 事件枚举。

## 传输

```http
GET /v1/sessions/{session_id}/events
Accept: text/event-stream
Last-Event-ID: <source-seq>
```

每个 SSE frame 只包含一个 JSON `data`，格式与 AG-UI `EventEncoder` 一致：

```text
id: <source-seq>
data: {"type":"TEXT_MESSAGE_CONTENT", ...}

```

事件使用 camelCase 的 AG-UI 字段；`metadata.kokoro` 是本产品的 replay metadata，不改变 AG-UI 核心事件语义。

## v1 事件映射

| Agent/BFF Chat 事实 | AG-UI event | 说明 |
| --- | --- | --- |
| `run.created` | `RUN_STARTED` | `threadId=session_id`、`runId=run_id` |
| `message.delta` | `TEXT_MESSAGE_START` + `TEXT_MESSAGE_CONTENT` | 首个 segment 先发 start |
| `message.completed` | `TEXT_MESSAGE_END` | 消息边界 |
| `tool.invoked` | `TOOL_CALL_START` + `TOOL_CALL_ARGS` | 参数为 JSON string delta |
| `tool.returned` | `TOOL_CALL_END` + `TOOL_CALL_RESULT` | 结果使用 tool message 语义 |
| `run.completed` | `RUN_FINISHED` | 可选 usage 使用 AG-UI token 字段 |
| `run.failed` | `RUN_ERROR` | 稳定 `code`，不透传 provider 原文 |
| 业务扩展 | `CUSTOM` | 名称使用 `kokoro.<context>.<event>` |

Web 端先按 AG-UI schema 校验，再投影到纯 reducer 使用的 `SessionEvent`；preview fixture 仍可直接产生内部事件，因此本地开发无需启动 Agent。

一个 Agent Chat fact 可能展开为多个 AG-UI frame（例如 START + CONTENT）。`id` 和
`metadata.kokoro.seq` 保留同一个 source sequence；Web 只在该 fact 的最后一个 frame 到达
后推进 `Last-Event-ID`，因此断线发生在中间 frame 时会重放完整 fact，不会丢文本或工具参数。
