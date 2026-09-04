# ADR-001：Public Product API 与 AG-UI projection ownership

- 状态：Accepted
- 日期：2026-09-03
- Owner：kokoro-bff

## Context

Kokoro 有 Web、BFF、Agent 和多个业务 owner。若 Web 直接消费每个 owner 或 Agent 私有事件，公开协议会随内部服务
变化；若 Root 复制 OpenAPI，则出现多份可编辑事实源；若 AG-UI、legacy SessionEvent 和 Vercel data stream 同时成为
网络协议，cursor/replay owner 将不唯一。

Agent 必须拥有 Run、checkpoint、lease、tool journal、执行事件、HITL 与 evidence，但 Conversation、Message、Share
是产品事实。Web 需要稳定、可重放且不泄漏 Agent/provider 内部字段的 Product API。

## Decision

1. `kokoro-bff` 是唯一 public HTTP Product API owner；canonical schema 只在本仓
   `contract/openapi/v1/openapi.yaml`。
2. Browser 只调用 `kokoro` same-origin adapter，再由 adapter 调用 BFF。其他服务只发布 internal-owner contract。
3. AG-UI 是 Web 与 BFF 之间唯一 Agent 网络事件协议。Vercel AI SDK 只在 Web 内部把 AG-UI 映射为 UI state。
4. BFF 最终拥有 Conversation、Message、Share 和 durable public AG-UI projection；Agent 仍拥有执行事实。
5. durable projection 使用 PostgreSQL append-only ledger、单调 public cursor、明确 retention/GC；Redis 只协调。
6. mutation 的本地事实、receipt 与 outbox 必须在同一 PostgreSQL 事务写入，跨服务 side effect 由 durable dispatcher
   投递和 reconciliation。
7. Root 只 catalog 固定版本、source commit 与 digest，不保存可编辑 contract 镜像。

## Consequences

- Web 不需要理解 Agent 私有 event，owner 路由和 provider 字段。
- BFF 承担公开兼容、权限、幂等、cursor、retention 和 replay SLO。
- 一个内部 fact 可以映射为多个 AG-UI frame；全部 frame 在一个事务提交，每个 frame 有独立 cursor，因此中间断线
  不丢后续 frame。
- owner contract 先变更并发布，BFF 再更新 client/projection；跨仓数据库 JOIN 被禁止。
- 实现成本包括 Chat product tables、AG-UI ledger、outbox、dispatcher、GC 与故障恢复测试。

## Implementation status

已实现：canonical BFF OpenAPI、operation governance、Agent HTTP ingress adapter、PostgreSQL durable AG-UI source/public
ledger、逐 frame opaque cursor、tenant/session-scoped replay、projection state/version fence、Redis publish-only notification，
以及条件性 PostgreSQL idempotency receipt。

尚未实现：BFF Conversation/Message/Share tables、transactional outbox、完整 mutation digest/fencing、AG-UI
retention/GC、后台主动摄取和完整 PG restore/fault suite。Accepted 表示方向已裁决，不表示这些项目已上线；当前事实以
[`../CURRENT.md`](../CURRENT.md) 为准。
