# kokoro-bff API contract policy

## 事实源与可见性

[`../contract/openapi/v1/openapi.yaml`](../contract/openapi/v1/openapi.yaml) 是本仓唯一字段级机器事实源。
`docs/api/` 只解释资源和生命周期；Root 只发布 catalog/reference，不保存可编辑镜像。

BFF 是 Kokoro 唯一 `public` HTTP owner。Browser 仍必须经 `kokoro` same-origin adapter 调用；“public”不表示浏览器
持有服务 secret。IAM、System、Model、Billing、Capability、Storage、Agent、Scheduler 和 Music 的接口均为各 owner
自己的 internal contract，BFF 只发布重新投影后的 Product API。

## Operation metadata

每个 operation 必须声明：

| 扩展 | 当前值/格式 | 含义 |
| --- | --- | --- |
| `x-kokoro-owner` | `kokoro-bff` | 公开协议 owner |
| `x-kokoro-visibility` | `public` | Product API 可见性 |
| `x-kokoro-stability` | `stable\|beta\|experimental` | 兼容承诺；当前 v1 为 `beta` |
| `x-kokoro-idempotency` | `none\|required` | 是否要求 `Idempotency-Key` |
| `x-kokoro-permission` | 稳定 dotted identifier 或 `anonymous` | admission 权限意图 |

`pnpm contract:check` 对全部 operation 执行门禁；`node scripts/verify-openapi.ts` 另外校验字段命名、响应 envelope、
状态码、幂等参数、分页游标和 AG-UI replay 形状。metadata 表示协议策略，不证明对应 Live adapter、数据库事实或
SLO 已经完成；实现状态看 [`CURRENT.md`](./CURRENT.md)。

## 调用与鉴权

除 probes 外，请求由 Web server 发送：

```http
x-kokoro-service: web-bff
x-kokoro-internal-secret: <server secret>
x-kokoro-namespace: <trusted namespace>
x-kokoro-principal-id: <trusted principal>
x-kokoro-request-id: <optional correlation id>
```

Live 必须配置 shared secret。共享快照由 server-only adapter 调用，不携带用户 namespace；其 share token 是资源
capability，不替代服务认证。浏览器提供的 tenant、Host、X-Domain、X-Forwarded-* 或 Authorization 不作为上游
身份来源。

## Envelope 与字段

JSON 成功：

```json
{"data": {}, "meta": {"request_id": "REQUEST_ID"}}
```

JSON 错误：

```json
{"error": {"code": "stable_code", "message": "Log-safe message"}, "meta": {"request_id": "REQUEST_ID"}}
```

外部 JSON 字段统一使用 `snake_case`，瞬时点使用 RFC 3339 UTC 毫秒精度。`ProjectInstructionRevision` 的 canonical
字段是 `updated_at`（`string`、`date-time`）和 `actor_name`，对应 schema example 也使用相同字段。此契约切片只更新
BFF 的机器事实与契约门禁；runtime mapper、Web consumer 和 `docs/api/v1/projects.md` 仍由 source/documentation owner
同步，在同步完成前不把运行时 parity 当作已验证事实。错误 `code` 可编程且稳定；message 不暴露 SQL、stack、credential
或 provider 原文。

业务 JSON 成功响应统一使用 `{data, meta}`，错误响应统一使用 `{error, meta}`。`/healthz` 的 `200`、`/readyz` 的
`200/503` 是明确的 probe `HealthResponse` 例外；probe 的无效请求和业务失败仍使用 `ErrorEnvelope`。SSE 响应使用
各自的 `text/event-stream` schema，不套 JSON envelope。

## 列表、并发与版本

- 列表使用 opaque cursor、稳定排序与明确 limit；客户端只原样回传 cursor。
- 当前 mutation 并发主要由 idempotency claim 和数据库约束控制；Project/ScheduledTask 尚未公开 version/ETag。
- `/v1` 的 breaking policy 与 provenance 见 [`../contract/README.md`](../contract/README.md)。删除 path/method、重命名
  operationId、收窄 schema 或改变 permission/idempotency 语义必须进入新版本。

## 幂等：当前事实与目标

除无副作用 GitHub preview 外，POST/PATCH/DELETE 要求 `Idempotency-Key`。当前 scope 为 namespace、method、canonical
path 和 key；body 规范化后形成 fingerprint。Live 且 business store 配置时 receipt 持久化到 PostgreSQL；否则部分
非 BFF-owned Live mutation 和 Mock 使用进程内 Map。

目标摘要还需覆盖 query、selected headers 和 canonical body，并让 receipt、BFF business fact 与 outbox 在同一事务
提交。该目标尚未实现。

## AG-UI

`GET /v1/sessions/{id}/events` 的网络 payload 是 AG-UI SSE。BFF 不发布 legacy SessionEvent wire，也不发布 Vercel
AI SDK data stream。独立后台 projector 把 Live source 事件原子写入 BFF PostgreSQL ledger 后，HTTP 才能读取；每个
AG-UI frame 的 SSE `id` 都是独立
`agui_*` opaque cursor。客户端只保存并原样回传最后确认的 `id`，不得解析、构造或跨 tenant/session 复用；replay
严格从该 cursor 对应内部位置之后开始。

Agent source `seq` 只保留在 AG-UI `metadata.kokoro` 中用于诊断和投影 provenance，不是 public cursor。当前 session 内
无效格式或未知 `Last-Event-ID` 返回 `400 invalid_event_cursor`；不属于 trusted tenant 的 session 返回与普通缺失一致的
`404 session_not_found`。已知但已被 retention GC 回收的 cursor 返回 `410 event_cursor_expired`。终态已提交时，即使 Agent disabled/unavailable，
BFF 重启后仍可只从 PostgreSQL replay；Redis 不参与 cursor 解析或历史读取。`event_watermark` 是当前 public ledger head
cursor；第一帧尚未产生时为 `null`。

projector 通过 PostgreSQL lease/token/fence 独立于浏览器连接运行；后台 GC 以最新 `RUN_STARTED` 的 public sequence
作为安全回收边界，只回收该边界之前且超过 retention 的旧 run frame，并保留从边界到 head 的完整 run slice；没有
可靠边界时不回收该 stream。retention floor 与有界 cursor tombstone 同步维护。字段级定义与例子只看 canonical OpenAPI；实现、
恢复和剩余缺口见 [`TECHNICAL_DESIGN.md`](./TECHNICAL_DESIGN.md)、[`RELIABILITY.md`](./RELIABILITY.md) 与
[`CURRENT.md`](./CURRENT.md)。

## 资源文档

资源路径、请求、响应和示例从 [`api/README.md`](./api/README.md) 进入。OpenAPI 与资源文档冲突时以 canonical
OpenAPI 为字段事实源，以 `CURRENT.md` 判断运行时是否已接线。
