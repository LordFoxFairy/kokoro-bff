# Chat v1

## 目标

Chat BFF 承接 Web v1 的会话、消息、SSE、run control 与分享投影；durable execution facts 由 Agent 写入 PostgreSQL，Redis 只承担 streams、queue、lease、wakeup 与短缓存。阶段 1 只依赖 PostgreSQL + Redis，且不引入 MySQL/Mongo。

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

## Control / Rename / Delete / Share

- `POST /v1/sessions/{id}/runs/{runId}/control` → `{ "data": { "ok": true } }`
- `PATCH /v1/sessions/{id}/title` → `{ "data": { "ok": true } }`
- `DELETE /v1/sessions/{id}` → `{ "data": { "status": "deleted" } }`
- `POST /v1/sessions/{id}/share` → `{ "data": { "share_id": "shr_..." } }`

## 隔离

`scope` / `project_ref` 查询参数可用于只看指定 namespace / project；不匹配时返回空列表或 404。
