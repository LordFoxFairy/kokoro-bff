# kokoro-bff 技术设计

## 1. Owner 与系统位置

```text
Browser
  -> kokoro same-origin /api/* adapter
  -> kokoro-bff public /v1 Product API
  -> IAM / System / Model / Billing / Capability / Storage owner APIs
  -> kokoro-agent run ingress, control and execution history
  -> kokoro-scheduler generic job and occurrence dispatch
```

BFF 是公开 Product API 的唯一 owner；其他仓库只发布自己的 internal-owner contract。BFF 不跨库 JOIN，
不读取 Agent 或 owner Redis，也不复制上游 Domain Model。

**AG-UI 是 Web ↔ BFF 唯一 Agent 网络协议。** Vercel AI SDK 的 `UIMessage` 属于 Web 内部 view adapter，
不得成为第二套网络 envelope 或 resumable stream。

## 2. 当前物理实现

| 区域 | 当前职责 | 已知偏差 |
| --- | --- | --- |
| `src/main.ts` | server composition、通用 auth/body/idempotency 管线、route dispatch | 仍直接装配生产 mock |
| `src/http/routes/` | resource route handlers | 尚未迁入标准 `interfaces/http/` |
| `src/application/` | project/scheduled use case、AG-UI projection/fence、ports、input mapper | 尚无明确 Domain aggregate 层 |
| `src/infrastructure/postgres/` | BFF-owned repository、durable AG-UI ledger、ScheduledTask outbox、Redis cache/notification | mutation receipt 与业务写仍未共享事务 |
| `src/infrastructure/clients/` | Agent、Scheduler、Mori 窄 adapter；其他 owner 仍集中于 owner route | client 目录尚未对每个 owner 全部分拆 |
| `src/interfaces/http/agui/` | 已持久化 AG-UI payload → schema-valid SSE frame | 完整 OpenAPI runtime validator 尚未形成 |
| `src/contracts/` | 当前手写 Web-facing types/envelope | 尚未由 canonical OpenAPI 生成且未与 Domain 类型彻底分离 |

目标依赖方向是 `interfaces -> application -> domain`，concrete infrastructure 实现 Domain/Application port，
bootstrap 只负责装配。缺少目录时视为待重构，不创建空目录冒充完成。

## 3. 请求与身份管线

1. Web server 解封 session，并向 BFF 发送 `x-kokoro-service: web-bff`、内部 secret、namespace、principal。
2. BFF 校验服务 envelope，生成或沿用 request id；常规业务身份只从受信 header 建立。
3. System runtime manifest 使用服务器配置的 `KOKORO_TENANT_ID` 与 `KOKORO_DOMAIN`；System 自己校验 Site/Host
   binding。
4. BFF 为 owner adapter 构造 allowlisted query/body 和服务身份；浏览器的 Authorization、Host、X-Domain、
   X-Forwarded-* 不作为 owner authority。
5. 响应在边界映射为 snake_case `{data, meta}` 或 `{error, meta}`。

当前 BFF 不执行完整 IAM admission；它信任持有共享 secret 的 Web adapter 提供 namespace/principal。将 IAM
admission 固定在 BFF 还是 Web 的职责需要后续 contract-first 决策与实现，当前文档不声称已经接入 IAM。

## 4. 幂等状态机

```text
missing key -> 400 idempotency_key_required
new scope   -> pending receipt -> execute -> terminal receipt
same digest + pending -> 409 idempotency_in_progress
same digest + terminal -> replay status/body
different digest -> 409 idempotency_conflict
5xx -> release pending claim so caller may retry
```

Live 且 business store 已配置时 receipt 位于 `bff_idempotency_receipt`；否则当前实现使用进程内 Map。pending claim
60 秒后可被回收。当前 digest 只规范化 body，scope 包含 namespace/method/path/key；query、selected headers、
业务写事务与 fencing 尚未覆盖。

## 5. Project 与 ScheduledTask

Project 与 ScheduledTask 是 BFF-owned facts。当前 repository 对每个查询显式携带 tenant id，关系完整性由
Application/Repository 管理，不使用数据库外键。

ScheduledTask 当前流程：

```text
validate input
  -> derive trusted tenant/actor/request/idempotency lineage
  -> BEGIN
  -> tenant-scoped project/task lock and task revision write
  -> write versioned Scheduler command to bff_scheduled_task_outbox
  -> COMMIT (fact and command are one local transaction)
  -> dispatcher claims with SKIP LOCKED + lease_token + fence
  -> call Scheduler outside the database transaction
  -> conditional succeeded/retryable/failed settlement
```

Outbox 不是通用跨域队列；每行只表示一个 `scheduler.register|replace|delete` command，payload 带 schema version、
task revision 和完整 tenant/actor/request/idempotency lineage。相同 `(tenant_id, task_id, command_type,
idempotency_key)` 只产生一个业务 command；同一 task 的较新 command 要等较早 pending/retryable/leased command
结束后再 claim。删除先在同一事务写 delete command，再删除 BFF fact，因此 Scheduler job 的外部删除可在进程崩溃后恢复。

Dispatcher 的 HTTP 投递是 at-least-once：lease 过期可被其他 worker 重新 claim，settlement 必须匹配 owner、token 和
fence；2xx 终结为 `succeeded`，明确的瞬时错误进入指数退避 `retryable`，超过 attempt budget 或永久 4xx 进入 `failed`。
Scheduler 注册的 409/404 只按稳定 job identity 做 register/replace reconciliation。mutation receipt 目前仍由外层
idempotency repository 单独 claim/commit，尚未与 task/outbox 合并为一个 receipt 事务。

## 6. Chat 与 AG-UI

当前 Live event 流：

```text
GET events
  -> resolve Last-Event-ID against (tenant, session) in PostgreSQL
  -> replay existing bff_agui_event rows strictly after public_sequence
  -> fetch Agent source events after bff_agui_stream.source_high_watermark
  -> validate source tenant/session shape
  -> BEGIN + lock stream row + verify version fence
  -> register source identity/digest + project all AG-UI frames + advance state/high-watermark
  -> COMMIT
  -> best-effort Redis PUBLISH notification
  -> read committed PostgreSQL rows -> @ag-ui/core validation -> SSE
```

`bff_agui_stream` 以 `(tenant_id, session_id)` 为 scope，保存 source high-watermark、下一内部 public sequence、持久化
projection state 与乐观 version；事务同时持有 row lock。`bff_agui_source_event` 以 source event id 为主键，并对
source sequence 建第二个唯一约束；相同 identity 的不同 digest/sequence 触发稳定失败。`bff_agui_event` 为每个 AG-UI
frame 保存完整 JSON payload、source mapping、frame index、单调内部 sequence 与独立随机 `agui_*` cursor。

客户端只把 SSE `id` 原样作为 `Last-Event-ID`；cursor 不编码 authority。Repository 先用 tenant + session + cursor
解析内部位置，再按 tenant + session + public sequence 查询，因此跨 tenant/session cursor 与不存在的 cursor 都返回
`400 invalid_event_cursor`，且不泄漏原 owner。一个 source fact 的多 frame 在同一事务提交，但每帧有独立 cursor；连接
恰好在 START 后断开时会从 CONTENT 继续，不会把 source sequence 当作已完成整个 projection。

PostgreSQL 是 public replay 的唯一 durable truth。Redis 只 `PUBLISH` hash-scoped 更新提示，不存 event、cursor 或
high-watermark；通知失败不回滚事实。当前 HTTP 请求自己轮询 Agent 并查询 PostgreSQL，尚未消费 Redis 通知来降低延迟。
终态 ledger 在 Agent unavailable/disabled 和 BFF 重启后仍可独立 replay；非终态且无法接触 Agent 时只能返回已持久化
部分并明确结束，或在尚未开始 SSE 时返回 503。

Agent 自有 event wire 的时间编码由 Agent contract 决定（当前 client boundary 保留其 epoch-millisecond 形状）；BFF
在 projection adapter 边界解析为 UTC instant，BFF domain/application/数据库事实不把 epoch 数字当作时间。该约定不
改动 Agent Run 或 Agent outbox。

Conversation、Message、Share 的产品事实最终归 BFF；Agent 只拥有 Run、checkpoint、lease、tool journal、执行事件、
HITL 与 evidence。当前 Live session/message history 仍来自 Agent，是明确缺口。AG-UI ledger 当前无 retention/GC 和
cursor-expired 水位；source ingestion 仍由公开读取驱动，不是独立 durable consumer。

## 7. 出站与失败归一

出站 HTTP 使用整体 timeout、响应大小上限、request id、Forwarded 与服务凭据。当前 transport 不自动重试；调用方
只在具备稳定幂等 identity 时重试。缺配置、不可达、HTTP error 与 schema mismatch 分别映射为稳定错误，且不返回
provider body、SQL 或 stack。

## 8. 启动与关闭

- Mock 是本地确定性 fixture，不需要 PostgreSQL/Redis；它不是生产完成证据。
- Live BFF-owned 路由要求 PostgreSQL + Redis；`/readyz` 检查可用性。AG-UI committed replay 只读取 PostgreSQL，
  但 Redis 不可用仍会使整体 readiness 失败。
- 监听后启动 ScheduledTask bounded outbox dispatcher；它不扫描或重建已成功 command，只 claim pending/retryable/expired
  lease rows。
- graceful shutdown 先停止 dispatcher 并等待当前 bounded cycle，再关闭 repository；尚无完整 request drain 或 termination
  budget。
