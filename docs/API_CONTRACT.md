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

`pnpm contract:check` 对全部 operation 执行门禁。metadata 表示协议策略，不证明对应 Live adapter、数据库事实或 SLO
已经完成；实现状态看 [`CURRENT.md`](./CURRENT.md)。

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

外部 JSON 的目标规则是 `snake_case`，瞬时点使用 RFC 3339 UTC 毫秒精度。当前已知例外是
`ProjectInstructionRevision.updatedAt/actorName` 及其 Unix milliseconds；runtime mapper、consumer 与 contract 尚未在
本阶段改动，因此不能声称全 surface 已收敛。错误 `code` 可编程且稳定；message 不暴露 SQL、stack、credential 或
provider 原文。

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
AI SDK data stream。当前 cursor 沿用 Agent source sequence，事件即时投影；BFF-owned durable ledger/public cursor 尚未
实现。详见 [`api/v1/agui-chat.md`](./api/v1/agui-chat.md) 与 [`TECHNICAL_DESIGN.md`](./TECHNICAL_DESIGN.md)。

## 资源文档

资源路径、请求、响应和示例从 [`api/README.md`](./api/README.md) 进入。OpenAPI 与资源文档冲突时以 canonical
OpenAPI 为字段事实源，以 `CURRENT.md` 判断运行时是否已接线。
