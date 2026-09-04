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

当前 Live event 流分成后台投影与公开读取两条单向路径：

```text
AgUiProjectorRunner (process lifecycle)
  -> seed/register eligible BFF Conversation scope
  -> claim (tenant, session) with SKIP LOCKED + lease token + monotonic fence
  -> fetch Agent source events after bff_agui_stream.source_high_watermark
  -> validate owner contract, tenant/session identity, sequence and snapshot watermark
  -> BEGIN + lock stream row + verify version and consumer fence
  -> register source identity/digest + project all AG-UI frames + advance state/high-watermark
  -> COMMIT
  -> settle progress/retry/blocked + best-effort Redis PUBLISH

GET events
  -> verify BFF-owned Conversation in trusted tenant scope
  -> resolve Last-Event-ID against (tenant, session) in PostgreSQL
  -> read committed rows strictly after public_sequence
  -> @ag-ui/core validation -> SSE
```

`bff_agui_stream` 以 `(tenant_id, session_id)` 为 scope，保存 source high-watermark、下一内部 public sequence、持久化
projection state 与乐观 version；事务同时持有 row lock。`bff_agui_source_event` 以 source event id 为主键，并对
source sequence 建第二个唯一约束；相同 identity 的不同 digest/sequence 触发稳定失败。`bff_agui_event` 为每个 AG-UI
frame 保存完整 JSON payload、source mapping、frame index、单调内部 sequence 与独立随机 `agui_*` cursor。

客户端只把 SSE `id` 原样作为 `Last-Event-ID`；cursor 不编码 authority。Repository 先用 tenant + session + cursor
解析内部位置，再按 tenant + session + public sequence 查询。跨 tenant 请求先按 Conversation owner 边界返回与普通缺失
一致的 `404 session_not_found`；当前 session 内格式错误或未知 cursor 返回 `400 invalid_event_cursor`。一个 source fact
的多 frame 在同一事务提交，但每帧有独立 cursor；连接
恰好在 START 后断开时会从 CONTENT 继续，不会把 source sequence 当作已完成整个 projection。

PostgreSQL 是 public replay 的唯一 durable truth。Redis 只 `PUBLISH` hash-scoped 更新提示，不存 event、cursor 或
high-watermark；通知失败不回滚事实。后台 runner 与 HTTP 生命周期独立，公开连接只以 bounded ledger polling 等待新
commit，不会变成第二个 Agent consumer。终态 ledger 在 Agent unavailable/disabled 和 BFF 重启后仍可独立 replay；
非终态且 projector 未配置时 fail closed。

consumer 状态与 stream 同 row：subject、next poll、lease owner/token/until、递增 fence、连续失败计数、最后错误和最后
完成时间均持久化。`expected_run_id` 表示最新接纳的 run，`latest_run_id` 只表示最近投影的 source run；旧 run 可以补投
历史 frame，但只有 expected run 的终态可以关闭 public stream。claim 的到期判断和 deadline 由 PostgreSQL 时钟计算，
并把剩余 lease budget 返回给 worker；runner 与 source client 在进程内使用 monotonic clock 消耗该预算，wall clock 只用于
日志/协议时间。注册不同 expected run 时，同一事务递增 stream version/fence、撤销旧 lease并清除旧 terminal；旧 worker
即使晚到也无法通过 commit/settlement 条件。projection state 以 run identity 隔离，某个 run 的终态只清理该 run 的
message/tool 状态。每次 source read 受 attempt budget 和 lease
deadline 共同限制，并为事务 settlement 预留时间；瞬时失败跨 claim 使用持久计数驱动 capped exponential backoff +
jitter，并在配置上限内尊重 `Retry-After`，成功 poll 清零。source gap 耗尽内部连续性预算、不符合 contract、重复
identity、永久 HTTP/容量错误把 scope 置为 blocked，避免静默跳过。
stream 持久化最新 `RUN_STARTED` 的 public sequence；GC 仅删除该边界
之前且早于 retention cutoff 的旧 run frame，并完整保留从边界到当前 head 的 run slice。没有可靠边界，或保留 suffix
中存在找不到同 run `RUN_STARTED` 的交错 frame 时跳过回收。
删除前写入有界 cursor tombstone，并推进 retention floor。tombstone 存续时返回 `410 event_cursor_expired`。

Agent 自有 event wire 的时间编码由 Agent contract 决定（当前 client boundary 保留其 epoch-millisecond 形状）；BFF
在 projection adapter 边界解析为 UTC instant，BFF domain/application/数据库事实不把 epoch 数字当作时间。该约定不
改动 Agent Run 或 Agent outbox。

Conversation、Message、Share 的产品事实由 BFF PostgreSQL canonical tables 与 ChatApplicationService 持有；Agent 只
拥有 Run、checkpoint、lease、tool journal、执行事件、HITL 与 evidence。Live session list/detail/message history/title/
delete/share routes 只读取 BFF facts；Message create 在 BFF 事务中追加 user message 后调用窄 Agent launch client。AG-UI
ledger 仍独立保存 Agent execution projection；assistant message reconciliation 与 Agent launch outbox 属于后续切片。

## 7. 出站与失败归一

出站 HTTP 使用整体 timeout、响应大小上限、request id、Forwarded 与服务凭据。当前 transport 不自动重试；调用方
只在具备稳定幂等 identity 时重试。缺配置、不可达、HTTP error 与 schema mismatch 分别映射为稳定错误，且不返回
provider body、SQL 或 stack。

## 8. 启动与关闭

- Mock 是本地确定性 fixture，不需要 PostgreSQL/Redis；它不是生产完成证据。
- Live BFF-owned 路由要求 PostgreSQL + Redis；`/readyz` 检查可用性。AG-UI committed replay 只读取 PostgreSQL，
  但 Redis 不可用仍会使整体 readiness 失败。
- 监听后启动 AG-UI projector 与 ScheduledTask bounded outbox dispatcher；两者只 claim due/eligible/expired-lease rows。
- graceful shutdown 先停止 projector 与 dispatcher、等待当前 bounded cycle 并释放仍持有的 lease，再关闭 repository；
  尚无完整 HTTP request drain 或 termination budget。
