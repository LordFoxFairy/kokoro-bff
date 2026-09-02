# Chat v1

## 目标

Chat BFF 承接 Web v1 的会话、消息、SSE、run control 与分享投影；durable execution facts 由 Agent 写入 PostgreSQL，Redis 只承担 streams、queue、lease、wakeup 与短缓存。阶段 1 只依赖 PostgreSQL + Redis，且不引入 MySQL/Mongo。

## Live owner

Live 模式下 Chat 只通过 `KOKORO_AGENT_BASE_URL` 调用 Agent 的 HTTP ingress，不读 Agent
数据库，也不回退到 Mock。BFF 的映射固定为：

| Web BFF v1 | Agent v1 ingress |
|---|---|
| `POST /v1/sessions/{id}/messages` | `POST /v1/runs` |
| `POST /v1/sessions/{id}/runs/{runId}/control` | `POST /v1/runs/{runId}/control` |
| `GET /v1/sessions/{id}/events` | `GET /v1/sessions/{id}/events`，`Last-Event-ID` → `after_seq` |
| `GET /v1/sessions/{id}` | Agent messages + replay 的并行投影 |

BFF 为 Agent 注入受信的 `ExecutionIdentity` headers（tenant/subject/actor/assertion），浏览器的
`X-Domain`、`X-Forwarded-*` 和 tenant 字段不会转发。消息的 `run_id`/`user_message_id` 由
namespace、session 和 `Idempotency-Key` 的 SHA-256 稳定派生，进程重启后仍能命中 Agent 的
run admission；`assistant_message_id` 是稳定 provisional id，最终 assistant message id 以
Agent 的 chat projection 事件为准。

Session list 在 v1 由 BFF 对本进程已提交的 session index 做投影；该 index 不是事实源，生产部署
应在下一切片增加 Agent 的 identity-scoped session index/read RPC。未由 Agent ingress 暴露的
rename/delete/share 操作会返回 `503 chat_projection_not_configured`，不会静默写入 BFF 内存。

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

返回：

```json
{
  "data": {
    "sessions": [
      { "session_id": "session_kokoro", "title": "Review business API contract", "updated_at": "2026-01-01T00:00:00.000Z" }
    ]
  },
  "meta": { "request_id": "req_01J..." }
}
```

## 会话快照

`GET /v1/sessions/{id}` 和 `GET /v1/shared/{shareId}`

返回：

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
    "active_run": { "run_id": "run_1", "status": "running" },
    "pending_pauses": [],
    "files": [],
    "deliveries": [],
    "event_watermark": 2
  },
  "meta": { "request_id": "req_01J..." }
}
```

## 消息

`POST /v1/sessions/{id}/messages`

```json
{
  "data": {
    "run_id": "run_1",
    "user_message_id": "message_1",
    "assistant_message_id": "message_2"
  },
  "meta": { "request_id": "req_01J..." }
}
```

## 事件流

`GET /v1/sessions/{id}/events`

返回 `text/event-stream`，每帧 `data:` 必须是 `parseSessionEvent` 可通过的 JSON。

Agent chat projection 的 `run.started`、`assistant.delta`、`assistant.completed`、`activity`、
`interaction`、`delivery`、`run.completed`、`run.failed` 分别投影到 Web 的
`run.created`、消息/工具/子代理/成果/终态事件。活动参数默认被 Agent 脱敏为 `{}`；原始参数只
留在 Agent 执行事实中。

## Control / Rename / Delete / Share

- `POST /v1/sessions/{id}/runs/{runId}/control` → `{ "data": { "ok": true } }`
- `PATCH /v1/sessions/{id}/title` → `{ "data": { "ok": true } }`
- `DELETE /v1/sessions/{id}` → `{ "data": { "status": "deleted" } }`
- `POST /v1/sessions/{id}/share` → `{ "data": { "share_id": "shr_..." } }`

## 隔离

`scope` / `project_ref` 查询参数可用于只看指定 namespace / project；不匹配时返回空列表或 404。
