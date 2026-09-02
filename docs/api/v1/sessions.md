# Chat v1

## 目标

Chat BFF 承接 Web v1 的会话、消息、SSE、run control 与分享投影；durable execution facts 由 Agent 写入 PostgreSQL，Redis 只承担 streams、queue、lease、wakeup 与短缓存。阶段 1 只依赖 PostgreSQL + Redis，且不引入 MySQL/Mongo。

契约的异步形态参考 Manus API 的“提交 → receipt → 游标事件读取”生命周期：提交接口只确认 admission，不等待模型完成；客户端通过事件游标恢复进度并按终态事件停止轮询。Kokoro 保留自己的 `/v1` 路径、snake_case 字段和统一 `{data, meta}` / `{error, meta}` envelope。

## Live owner

Live 模式下 Chat 只通过 `KOKORO_AGENT_BASE_URL` 调用 Agent 的 HTTP ingress，不读 Agent 数据库，也不回退到 Mock。BFF 的映射固定为：

| Web BFF v1 | Agent v1 ingress |
|---|---|
| `POST /v1/sessions/{id}/messages` | `POST /v1/runs` |
| `POST /v1/sessions/{id}/runs/{runId}/control` | `POST /v1/runs/{runId}/control` |
| `GET /v1/sessions/{id}/events` | `GET /v1/sessions/{id}/events`，`Last-Event-ID` → `after_seq` |
| `GET /v1/sessions/{id}` | Agent messages + replay 的并行投影 |

BFF 为 Agent 注入受信的 `ExecutionIdentity` headers（tenant/subject/actor/assertion），浏览器的 `X-Domain`、`X-Forwarded-*` 和 tenant 字段不会转发。消息的 `run_id`/`user_message_id` 由 namespace、session 和 `Idempotency-Key` 的 SHA-256 稳定派生，进程重启后仍能命中 Agent 的 run admission；`assistant_message_id` 是稳定 provisional id，最终 assistant message id 以 Agent 的 chat projection 事件为准。

Session list 在 v1 由 Agent 持久化并按 trusted execution identity 查询；BFF 只转发 `project_ref`、`limit`、`cursor` 并投影稳定的 Web summary，不维护进程内 session index。`next_cursor` 是不透明值，客户端只能原样回传，不能解码或自行拼接。Agent 的 session metadata 是列表事实源，不能由浏览器提交的 namespace 或 user 字段覆盖。

## 统一 envelope、request id 与错误

每个 JSON 成功响应都带服务端生成或透传的 `meta.request_id`：

```json
{
  "data": {},
  "meta": { "request_id": "req_01JASYNC000000000000000000" }
}
```

错误响应保持相同 request id：

```json
{
  "error": {
    "code": "session_not_found",
    "message": "Session was not found"
  },
  "meta": { "request_id": "req_01JASYNC000000000000000000" }
}
```

常见 Chat 错误码：`invalid_json`、`invalid_message`、`invalid_run_control`、`idempotency_key_required`、`idempotency_conflict`、`idempotency_in_progress`、`session_not_found`、`run_not_found`、`agent_not_configured`、`chat_projection_not_configured`、`upstream_unreachable`。

除读取和事件流外，消息、control、rename、delete、share 均必须带 `Idempotency-Key`。相同 namespace、方法、规范化路径和 key 的重试返回同一 receipt；相同 key 但请求体不同返回 `409 idempotency_conflict`；原请求仍在处理时返回 `409 idempotency_in_progress`。

## 鉴权

常规会话接口：

- `x-kokoro-service: web-bff`
- `x-kokoro-internal-secret`
- `x-kokoro-namespace`
- `x-kokoro-principal-id`

共享快照：

- `x-kokoro-service: web-bff`
- `x-kokoro-internal-secret`
- 不需要 namespace/user id

## 会话列表

`GET /v1/sessions`

可选查询参数：`project_ref`、`limit`（1..100）、`cursor`。列表按 `updated_at` 倒序返回，并按 Agent identity 隔离。

```json
{
  "data": {
    "sessions": [
      {
        "session_id": "session_kokoro",
        "title": "Review business API contract",
        "updated_at": "2026-01-01T00:00:00.000Z"
      }
    ],
    "next_cursor": null
  },
  "meta": { "request_id": "req_01JASYNC000000000000000000" }
}
```

当存在下一页时，`data.next_cursor` 为不透明字符串；最后一页为 `null` 或省略该可选字段。

## 会话快照

`GET /v1/sessions/{id}` 和 `GET /v1/shared/{shareId}` 返回当前投影水位：

```json
{
  "data": {
    "session": {
      "session_id": "session_kokoro",
      "title": "Review business API contract",
      "owner_id": "ns_test",
      "created_at": "2026-01-01T00:00:00.000Z",
      "updated_at": "2026-01-01T00:00:00.000Z"
    },
    "messages": [],
    "active_run": { "run_id": "run_01JASYNC", "status": "running" },
    "pending_pauses": [],
    "files": [],
    "deliveries": [],
    "event_watermark": 4
  },
  "meta": { "request_id": "req_01JASYNC000000000000000000" }
}
```

## 消息 admission 与 receipt

`POST /v1/sessions/{id}/messages` 必须带 `Idempotency-Key`，请求体为：

```json
{
  "content": "Review the latest project changes.",
  "model": "default",
  "project_ref": "project_kokoro"
}
```

服务端立即返回 `202 Accepted` 和稳定 receipt，不代表 run 已完成：

```json
{
  "data": {
    "run_id": "run_01JASYNC",
    "user_message_id": "msg_01JUSER",
    "assistant_message_id": "msg_01JASSISTANT"
  },
  "meta": { "request_id": "req_01JASYNC000000000000000000" }
}
```

## 事件流与 cursor

`GET /v1/sessions/{id}/events`

客户端使用 `Last-Event-ID` 传递最近确认的非负事件序列；BFF 严格返回其后的事件。每个事件帧的 `id` 是恢复 cursor，`data` 是 JSON 的 `ChatEvent` 投影：

```text
id: 4
event: run.completed
data: {"event_id":"event_4","seq":4,"session_id":"session_kokoro","run_id":"run_01JASYNC","kind":"run.completed","timestamp":"2026-01-01T00:00:04.000Z","payload":{"status":"completed"}}
```

BFF 先从 Agent replay，再以相同 cursor 轮询增量事件；空闲期间发送 SSE comment keep-alive，收到 `run.completed` 或 `run.failed` 后关闭。客户端断开会停止轮询，不会将连接生命周期绑定到一次性的上游 HTTP 响应。收到事件后应先持久化最后一个合法 `id`，再处理业务 payload。

Agent chat projection 的 `run.started`、`assistant.delta`、`assistant.completed`、`activity`、`interaction`、`delivery`、`run.completed`、`run.failed` 分别投影到 Web 的 `run.created`、消息/工具/子代理/成果/终态事件。活动参数默认被 Agent 脱敏为 `{}`；原始参数只留在 Agent 执行事实中。

## Run control receipt

`POST /v1/sessions/{id}/runs/{runId}/control` 必须带 `Idempotency-Key`。请求使用带 discriminator 的 union：
公共 BFF body 只提交 `kind` 以及该 union 对应的字段；BFF 从路径取得 session，再向 Agent
transport 注入 `session_id`。

```json
{
  "kind": "run.cancel"
}
```

恢复等待中的交互时：

```json
{
  "kind": "run.resume",
  "decisions": [{ "type": "approve", "tool_id": "tool_01J" }]
}
```

control 成功返回稳定 receipt（`202 Accepted`）：

```json
{
  "data": {
    "run_id": "run_01JASYNC",
    "command_id": "command_01J",
    "request_digest": "sha256:abc123",
    "status": "pending",
    "replayed": false
  },
  "meta": { "request_id": "req_01JASYNC000000000000000000" }
}
```

`Idempotency-Key` 是 control 的 `command_id`，必须在重试时原样复用。`run.steer` 还可使用
`message_id` + `content` 提交新的用户指令。非法 union、缺少 `session_id`/`decisions` 或空 steer
内容返回 `400 invalid_run_control`。

## Rename / Delete / Share

- `PATCH /v1/sessions/{id}/title`：请求 `{ "title": "Contract review" }`，成功返回 `{ "data": { "ok": true }, "meta": { "request_id": "..." } }`。
- `DELETE /v1/sessions/{id}`：成功返回 `{ "data": { "status": "deleted" }, "meta": { "request_id": "..." } }`。
- `POST /v1/sessions/{id}/share`：成功返回 `{ "data": { "share_id": "shr_01JSHARE" }, "meta": { "request_id": "..." } }`。
- `DELETE /v1/sessions/{id}/share`：成功返回同形状的 share receipt。

Agent ingress 尚未暴露 live rename/delete/share 时，BFF 返回 `503 chat_projection_not_configured`，不会静默写入本地 Mock 状态。

## 隔离

`project_ref` 查询参数可用于只看指定项目；不匹配时返回空列表或 404。namespace 和 subject 只从 BFF 认证上下文派生，不能通过查询参数覆盖。废弃的 `/v1/connectors`、`/v1/preferences`、`/v1/cloud-computers` 和 `/v1/integrations` 兼容路径不属于 v1 surface，返回 `404 bff_route_not_found`。
