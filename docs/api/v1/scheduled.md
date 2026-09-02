# Scheduled API v1

Scheduled 是 BFF 的业务模块：BFF 持有面向 Web 的任务定义、权限、幂等回执和投影；任务执行事实不在
Scheduler 中生成。`kokoro-scheduler` 只负责通用 `ScheduleJob` 的触发、lease、retry、misfire 和
internal command dispatch。

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

## Live boundary

当前 `/v1/scheduled-tasks` 没有可直接替代 BFF 任务定义的 Scheduler CRUD upstream。live 模式在
Scheduler command adapter 完成前必须返回可观测的 `503 scheduler_command_not_configured`，不能把
`SCHEDULER_JOBS_JSON` 当成用户任务数据库，也不能把 Scheduler 的内部配置 API 暴露给浏览器。

当 command adapter 就绪后，流程固定为：

```text
BFF scheduled-task definition
  -> Scheduler ScheduleJob registration/dispatch
  -> BFF-owned internal command receipt
  -> BFF task execution projection
```

`KOKORO_SCHEDULER_BASE_URL` 只表示 Scheduler internal command endpoint；它不改变任务定义的 owner。
