# Projects API v1

Projects 是业务工作区的容器。一个 Project 可以提供共享 instruction，并关联任务、资源、技能和排程。Project 的 SQL 由 Projects 业务服务负责；BFF 只返回投影和编排请求。

## 资源模型

```json
{
  "id": "project_kokoro",
  "name": "Kokoro",
  "slug": "kokoro",
  "description": "Kokoro product workspace",
  "instruction": "Keep implementation notes scoped to this project.",
  "created_at": "2026-01-01T00:00:00.000Z",
  "updated_at": "2026-01-01T00:00:00.000Z"
}
```

字段约束：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 稳定资源 ID；客户端不得根据名称生成 |
| `name` | string | 展示名称；创建时必填 |
| `slug` | string | URL/展示辅助字段，由服务端生成 |
| `description` | string | 可为空的说明 |
| `instruction` | string | 项目级默认指令；应用于该项目下的新任务 |
| `created_at` | string | ISO 8601 UTC |
| `updated_at` | string | ISO 8601 UTC |

## GET `/v1/projects`

返回当前 namespace 可见的项目列表。

### Request

```http
GET /v1/projects
x-kokoro-service: web-bff
x-kokoro-namespace: ns_demo
x-kokoro-user-id: user_demo
```

### Response `200`

```json
{
  "data": {
    "projects": [
      {
        "id": "project_kokoro",
        "name": "Kokoro",
        "slug": "kokoro",
        "description": "Kokoro product workspace",
        "instruction": "Keep implementation notes scoped to this project.",
        "created_at": "2026-01-01T00:00:00.000Z",
        "updated_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  },
  "meta": { "request_id": "req_projects_1" }
}
```

当前 v1 Mock 不分页。真实数据量增加前必须先补 `limit`, `cursor` 和 `has_more`，不能在不同 upstream 中使用不同分页语义。

## POST `/v1/projects`

创建项目。该请求会产生业务状态，必须幂等。

### Request

```http
POST /v1/projects
Content-Type: application/json
Idempotency-Key: project-create-001

{
  "name": "Design system",
  "description": "Shared business UI"
}
```

字段约束：

- `name`：必填、非空字符串。
- `description`：可选字符串；缺省按空字符串处理。
- `instruction`：当前 BFF Mock 的创建入口暂不接收；统一通过项目 PATCH 设置，避免创建和更新出现两套规则。

### Response `200`

```json
{
  "data": {
    "project": {
      "id": "project_2",
      "name": "Design system",
      "slug": "design-system",
      "description": "Shared business UI",
      "created_at": "2026-09-01T10:00:00.000Z",
      "updated_at": "2026-09-01T10:00:00.000Z"
    }
  },
  "meta": { "request_id": "req_projects_create_1" }
}
```

### Errors

| HTTP | code | 条件 |
| --- | --- | --- |
| 400 | `idempotency_key_required` | 缺少幂等键 |
| 400 | `invalid_project` | `name` 缺失或为空 |
| 409 | `idempotency_conflict` | 同一 key 对应不同请求语义 |

## GET `/v1/projects/:projectId`

返回项目详情。`:projectId` 可以使用 Project ID；兼容 slug 时由业务服务负责解析，Web 不应依赖两者都可用。

### Response `200`

```json
{
  "data": {
    "project": {
      "id": "project_kokoro",
      "name": "Kokoro",
      "slug": "kokoro",
      "description": "Kokoro product workspace",
      "instruction": "Keep implementation notes scoped to this project.",
      "created_at": "2026-01-01T00:00:00.000Z",
      "updated_at": "2026-01-01T00:00:00.000Z"
    }
  },
  "meta": { "request_id": "req_project_detail_1" }
}
```

## PATCH `/v1/projects/:projectId`

更新项目 instruction。instruction 是项目级共享行为，不是 Web 本地状态。

### Request

```http
PATCH /v1/projects/project_kokoro
Content-Type: application/json
Idempotency-Key: project-instruction-001

{
  "instruction": "Keep all implementation notes scoped to this project."
}
```

### Response `200`

```json
{
  "data": {
    "project": {
      "id": "project_kokoro",
      "instruction": "Keep all implementation notes scoped to this project.",
      "updated_at": "2026-09-01T10:05:00.000Z"
    }
  },
  "meta": { "request_id": "req_project_instruction_1" }
}
```

### Errors

| HTTP | code | 条件 |
| --- | --- | --- |
| 400 | `idempotency_key_required` | 缺少幂等键 |
| 400 | `invalid_project_instruction` | `instruction` 不是字符串 |
| 404 | `project_not_found` | 项目不存在或不可见 |

## GET `/v1/projects/:projectId/instruction-revisions`

返回 instruction 的历史版本，用于设置页回显、审计和回滚准备。

### Response `200`

```json
{
  "data": {
    "items": [
      {
        "id": "project-instruction-2",
        "instruction": "Keep all implementation notes scoped to this project.",
        "updatedAt": 1767261900000,
        "actorName": "You",
        "current": true
      }
    ]
  },
  "meta": { "request_id": "req_project_instruction_history_1" }
}
```

`updatedAt` 是当前 Web 兼容字段，后续 v1 资源统一化时应增加 ISO 字段而不删除旧字段。

## GET `/v1/projects/:projectId/tasks`

返回项目关联的任务投影。Task 的执行事实、消息和 SSE 不属于 BFF；Chat/run 仍由 Session 所有。

### Response `200`

```json
{
  "data": {
    "tasks": [
      {
        "id": "task_contract",
        "project_id": "project_kokoro",
        "title": "Review business API contract",
        "status": "in_progress",
        "updated_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  },
  "meta": { "request_id": "req_project_tasks_1" }
}
```

## POST `/v1/projects/:projectId/resources`

上传项目资源的 BFF 预留入口，当前 Mock 只验证项目存在并返回成功投影。请求体为 `multipart/form-data`，必须幂等。

```http
POST /v1/projects/project_kokoro/resources
Idempotency-Key: project-resource-001
Content-Type: multipart/form-data; boundary=...
```

当前 Mock response：

```json
{
  "data": { "ok": true },
  "meta": { "request_id": "req_project_resource_1" }
}
```

Live upstream 接入前需要补齐文件大小、内容类型、资源 ID、病毒扫描状态和异步处理状态，不能把当前 `ok` 视为最终资源模型。

## PATCH `/v1/projects/:projectId/skills/:skill`

更新项目级技能开关。

### Request

```http
PATCH /v1/projects/project_kokoro/skills/skill-builder
Content-Type: application/json
Idempotency-Key: project-skill-001

{ "enabled": false }
```

### Response `200`

```json
{
  "data": {
    "skill": {
      "project_id": "project_kokoro",
      "name": "skill-builder",
      "enabled": false
    }
  },
  "meta": { "request_id": "req_project_skill_1" }
}
```

## POST `/v1/projects/:projectId/scheduled-tasks`

创建属于项目的排程任务。BFF 会强制使用 URL 中的 `projectId`，忽略请求体中的其他 `project_id`，避免跨项目写入。

### Request

```http
POST /v1/projects/project_kokoro/scheduled-tasks
Content-Type: application/json
Idempotency-Key: project-schedule-001

{
  "title": "Review the API contract",
  "prompt": "Review the current business API contract.",
  "frequency": "daily",
  "time": "09:00",
  "timezone": "UTC",
  "auto_approve": false,
  "enabled": true
}
```

### Response `200`

```json
{
  "data": {
    "task": {
      "id": "scheduled_2",
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
  },
  "meta": { "request_id": "req_project_schedule_1" }
}
```

## Mock 验收

```bash
KOKORO_BFF_MODE=mock \
KOKORO_BFF_SHARED_SECRET=local-web-bff-secret \
KOKORO_DOMAIN=dev.kokoro.localhost \
KOKORO_BFF_PORT=4300 \
pnpm dev
```

所有需要写入的请求都必须带服务端 headers 和 `Idempotency-Key`。BFF 自测位于 `test/bff.test.ts`，Web 适配测试位于 Web 子仓库的 `tests/system/bff-business-routing.test.ts`。
