# Scheduled API v1

Scheduled 负责定时任务投影与变更；任务执行事实仍由对应业务服务或 worker 负责。

## 资源模型

```json
{
  "id": "scheduled_contract_review",
  "project_id": "project_kokoro",
  "title": "Review the API contract",
  "prompt": "Review the current business API contract.",
  "frequency": "daily",
  "time": "09:00",
  "timezone": "UTC",
  "next_run_at": "2026-01-02T09:00:00.000Z",
  "auto_approve": false,
  "enabled": true,
  "status": "active"
}
```

## GET `/v1/scheduled-tasks`
## GET `/v1/scheduled-tasks/:id`

返回投影。

## POST `/v1/scheduled-tasks`
## PATCH `/v1/scheduled-tasks/:id`
## DELETE `/v1/scheduled-tasks/:id`
## POST `/v1/scheduled-tasks/:id/retry`

都必须携带 `Idempotency-Key`。

### Response `200`

```json
{ "data": { "task": {} }, "meta": { "request_id": "req_scheduled_1" } }
```

## POST `/v1/projects/:projectId/scheduled-tasks`

项目级创建，BFF 强制使用路径中的 `projectId`。

## Errors

- `scheduled_task_not_found`
- `idempotency_key_required`
- `idempotency_conflict`

## Live upstream

Scheduled live 模式走 `KOKORO_SCHEDULED_BASE_URL`。
