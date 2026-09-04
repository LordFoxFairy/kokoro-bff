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
- `scheduled_task_not_active` (`409`): disabled, paused, or failed tasks never launch an Agent run.
- `scheduled_task_expired` (`410`): an expired task never launches an Agent run.
- `idempotency_key_required`
- `idempotency_conflict`
- `idempotency_in_progress`

## 一致性与异步投递

ScheduledTask 的 create/update/delete/retry 在 BFF PostgreSQL 的一个本地事务内提交业务 fact（含 revision）和
对应的 Scheduler command。command 写入 `bff_scheduled_task_outbox` 后，HTTP mutation 即可返回本地已提交的 task；
它不等待 Scheduler 网络调用，也不会把 Scheduler 暂时不可达伪装成同步失败。

提交后的 command 由 BFF 内置 bounded dispatcher 异步 claim。dispatcher 使用 `SKIP LOCKED`、lease owner/token/fence、
按 task 的 FIFO、稳定 command identity 和有上限的指数退避；进程重启时只恢复 pending/retryable 或已过期 lease 的
command。Scheduler 投递是 at-least-once，Scheduler adapter 对 register/replace 的 409/404 按稳定 job name
重试收敛；永久失败最终标记 outbox `failed`，BFF task fact 仍保留并可通过 `retry` 产生新 revision command。

`listRecords` 若被调用，仅是内部 recovery/diagnostics 的全量扫描，不是 public HTTP 列表路径，也不参与 dispatcher
的正常 claim。

## Live boundary

live 模式在 `KOKORO_BFF_POSTGRES_URL` + `KOKORO_BFF_REDIS_URL` 配置后由 BFF 持有任务事实，并通过
`KOKORO_SCHEDULER_BASE_URL` 注册通用 `ScheduleJob`。Scheduler 只负责触发，不持有业务定义；触发时
回调 `KOKORO_SCHEDULER_TARGET_URL`，由 BFF 校验 Scheduler 服务凭据、读取任务事实并向 Agent 发起
幂等 Run。任务创建、更新、删除和 retry 以 BFF 本地 fact+outbox 事务成功作为 Web 成功条件；Scheduler 注册/替换/
删除在提交后异步完成，状态可从内部 outbox 观测。

流程固定为：

```text
BFF scheduled-task definition
  -> Scheduler ScheduleJob registration/dispatch
  -> authenticated BFF internal command receipt
  -> Agent Run admission
```

Scheduler 回调 BFF 的内部 command 必须携带以下受信元数据：

```http
Authorization: Bearer <KOKORO_SCHEDULER_SERVICE_TOKEN>
X-Kokoro-Scheduler-Job: kokoro.scheduled.<task_id>
X-Kokoro-Scheduler-Occurrence: <YYYYMMDDTHHMMSSZ>
X-Request-Id: <delivery-request-id>
Idempotency-Key: schedule:<job-name>:<occurrence>
```

BFF 严格校验 `task_id`、job name、UTC occurrence 和幂等键的一致性；同一 occurrence 的重试必须
复用相同的 `X-Kokoro-Scheduler-Occurrence` 与 `Idempotency-Key`，仅允许更换 delivery request id。

启动后 BFF 直接启动 outbox dispatcher。它不通过全量 task 扫描同步重建 Scheduler，而是恢复数据库中尚未完成或
lease 已过期的 durable command；这使 fact 与 command 在进程崩溃后仍可继续投递。

`KOKORO_SCHEDULER_BASE_URL` 只表示 Scheduler internal command endpoint；它不改变任务定义的 owner。
注册和回调使用 `Authorization: Bearer KOKORO_SCHEDULER_SERVICE_TOKEN`。`next_run_at` 是 v1 UTC 调度
基准，原始 `timezone` 随 command body 保存；后续 Scheduler 支持 location 后再升级为时区感知 cron。
