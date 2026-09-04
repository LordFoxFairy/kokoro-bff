# kokoro-bff reliability

## 当前可靠性机制

Chat Message create 先在一个 PostgreSQL 事务中提交 user/assistant Message facts、Agent dispatch command 与 expected-run
consumer registration；HTTP 只确认本地 durable admission。Agent launch 在事务外由 bounded dispatcher 执行，因此
Agent 短暂不可达不会丢失命令或把本地提交伪装为失败。AG-UI projection 仍是独立的 BFF ledger。

- 所有响应关联 request id；owner response 可沿用同一 id。
- 出站 HTTP 有整体 timeout 与最大响应字节数；不可达、HTTP error 和 contract mismatch 使用稳定错误归一。
- mutation 使用 pending/terminal receipt，支持 replay、conflict 和 in-progress 判定；5xx 释放 pending claim以允许重试。
- PostgreSQL pending receipt 60 秒后可回收，防止进程崩溃永久占用 key。
- ScheduledTask mutation 在一个 PostgreSQL 事务内提交 task fact 与 `bff_scheduled_task_outbox` command；稳定的
  `(tenant_id, task_id, command_type, idempotency_key)` identity 防止重复 command。
- Chat mutation 在同一事务提交两条 Message、`bff_agent_dispatch_outbox` 与 expected-run fence；稳定的
  `(tenant_id, conversation_id, idempotency_key)` identity 防止重复 admission。
- BFF 监听后启动两条 bounded outbox dispatcher；它们用 `FOR UPDATE SKIP LOCKED`、lease owner/token/fence、指数退避
  和 attempt budget 交付 Scheduler/Agent，并在停止时等待当前 cycle 完成。启动恢复只回收 pending/retryable 或已过期
  lease，不扫描 aggregate 后同步重建外部状态。
- Live 配置/上游缺失时 fail closed，不回退到 Mock 成功。
- AG-UI source identity、projection state、全部展开 frame 与 source high-watermark 在同一 PostgreSQL 事务提交；公开
  SSE 只读取 committed ledger。
- tenant/session stream row lock + version fence 串行化并发摄取；event id、source sequence 和 source frame 唯一约束
  阻止重复 public frame。
- 每个 public frame 有独立 opaque cursor；从 START frame 后恢复会继续 CONTENT，而不是跳过整个 source event。

## 幂等限制

Live 且 BFF business store 配置时 receipt 持久化；其他路径可能只使用进程内 Map。当前 fingerprint 不含 query 与
selected headers，receipt 写入也未与业务 fact 或 side effect 置于同一数据库事务。调用者只能在保持相同
Idempotency-Key 和完整请求语义时重试。

## Outbox 与跨服务一致性

ScheduledTask 与 Chat bounded outbox 均已实现。ScheduledTask create/update/retry 在同一事务写入 revision 与 Scheduler
register/replace command；delete 在删除 fact 前同一事务写入 delete command。Chat admission 在同一事务写 user/
assistant messages、Agent launch command 和 expected-run registration。提交后才由 dispatcher 在事务外调用 owner，
因此 owner 不可达时本地事实仍已提交，command 保持 `retryable`。

每个 command 保存 tenant/actor/request/idempotency lineage 和版本化 task snapshot。claim 会递增 fence 并设置
lease；settlement 必须同时匹配 outbox id、lease owner、token 和 fence，旧 worker 在 lease 被回收后不能覆盖新 worker
的结果。2xx 进入 `succeeded`，瞬时 transport/408/425/429/5xx 进入退避，永久 4xx 或超过 attempt budget 进入
`failed`。同一 task 或 conversation 的 command 按创建序列 FIFO claim，避免旧 snapshot/run 越过较早命令。Agent
明确永久失败还会在同一 settlement 事务把对应 provisional assistant message 标记为 `failed`；成功 admission 后的
assistant 内容和终态仍等待独立 reconciliation。

目标路径是：同一 PostgreSQL 事务写 aggregate、receipt claim 与 outbox；dispatcher 使用稳定 command identity、退避、
jitter、lease/fencing 投递；owner receipt 与 BFF outbox 状态 reconciliation 后完成公开 receipt。

## AG-UI replay

当前 public event 与 replay 的唯一 durable truth 是 BFF PostgreSQL ledger。独立 projector 按持久化 source
high-watermark 从 Agent 获取新 facts，使用 lease/token/fence 提交；HTTP 只重放已提交 rows。`Last-Event-ID` 是逐 frame
`agui_*` token，内部 public sequence 单调且不暴露。终态已持久化时，BFF 重启或 Agent disabled/unavailable 不影响 replay。
SSE ledger wait 与后台 source projector 使用两组独立参数；projector 的 claim batch、page/attempt budget、lease、
settlement reserve、poll、backoff max/jitter、ledger retention、GC 和 tombstone 窗口均由显式环境变量控制。启动配置
会阻断超过 Agent page 上限、lease 不长于单次 owner timeout 加 settlement reserve、backoff base 大于 max，或
tombstone 窗口短于 ledger retention 的组合。source request timeout 会收窄到当前 lease 剩余预算，给事务 settlement
预留固定时间；跨 claim 的连续失败次数持久化并驱动 capped exponential backoff + jitter，成功 poll 后清零；合法
`Retry-After` 在 backoff maximum 内参与下一次调度。
lease eligibility 与实际 deadline 使用 PostgreSQL 时钟；claim 把数据库计算的剩余预算交给 worker，runner/source client
只使用 monotonic clock 消耗预算，settlement/release 再由数据库时钟落点。不同 `expected_run_id` 的注册会递增
version/fence 并撤销旧 lease；`latest_run_id` 只是最近投影的 source run，因此时钟偏移、迟到 worker 或新 lease 补投旧
run 都不能恢复旧 terminal。message/tool projection state 以 run identity 隔离。
持续 404/429/5xx 属于可恢复的 owner availability 故障：跨 claim 保持 capped durable retry，不因固定次数把 scope
永久冻结；`consumer_failure_count`、last error/time 和 projector snapshot 是告警信号。权限、retention、contract、容量与
continuity 等不可恢复错误立即进入 `blocked`，只能通过受控恢复重新激活。

真实 PostgreSQL/Redis integration 已验证：strictly-after、一个 source fact 展开多 frame 后从中间恢复、并发重复
摄取、source identity 冲突、projection state 跨重启及跨 run 隔离、tenant/session 隔离、consumer fencing、expected-run
stale commit 防护、worker 时钟偏移、BFF 重启后 replay、
保留 GC、expired cursor，以及 Redis 不存在 AG-UI 持久键。Redis publish 可丢失且失败不回滚 ledger。

尚未闭环：跨版本 re-projection、PG backup restore、长时间 fault injection，以及 Agent source retention 小于
projector 最大恢复时间时的跨服务数据保护策略。

## Retry 规则

| 操作 | 自动重试策略 |
| --- | --- |
| GET/HEAD owner read | 仅对明确瞬时错误、在 timeout budget 内退避；当前 transport 默认不自动重试 |
| BFF mutation | caller 复用 Idempotency-Key；禁止生成新 key 隐藏未知结果 |
| Scheduler register/replace | 409/404 可按稳定 job identity reconcile |
| Agent run/control | 只用稳定 run/command identity 重试 |
| 非幂等或未知 commit 状态 | 先查 receipt/state，不盲重放 |

## Failure matrix

| 故障 | 当前行为 | 恢复 |
| --- | --- | --- |
| PostgreSQL 不可用 | BFF-owned Live route 503；readyz 非就绪 | 恢复 DB 后重试 |
| Redis 不可用 | readyz 失败；AG-UI publish 被忽略，已提交 replay 仍在 PG | 恢复 Redis；无需重建 event history |
| owner timeout/过大响应 | 稳定 502/错误归一 | 在幂等预算内重试 |
| Scheduler 注册失败 | command 进入 `retryable`，超过 attempt budget 后进入 `failed`；本地 task fact 保留 | dispatcher 退避重试，或调用 `retry` 产生新 revision command |
| Agent 不可用 | 已配置 Agent 时新 Chat 返回本地 durable `202`；command 进入 `retryable`；终态 AG-UI ledger 可独立 replay | dispatcher 自动重试；公开历史从 PG 读取 |
| Agent source timeout/connection/404/409/423/429/5xx | 有界 attempt 后保持 active，持久失败计数并按 capped exponential backoff + jitter 重领 | 上游恢复后自动继续，watermark 不跳跃 |
| Agent source 401/403/410/非法 4xx/过大响应，或 source gap 耗尽单次连续性预算 | consumer 立即 blocked，不无限重试 | 修复服务身份、retention 或 contract 后执行受控恢复 |
| BFF 在 Scheduler/Agent 投递前或中间崩溃 | 已提交 command 保留；leased row 在 lease 到期后可重领 | 新 dispatcher recovery claim，外部以稳定 owner/idempotency identity 收敛 |
| 当前 session 的 cursor 格式错误或未知 | 400 `invalid_event_cursor` | 使用该 tenant/session 最后确认的 SSE id |
| session 不属于 trusted tenant | 404 `session_not_found` | 校验 tenant/session，不探测其他 scope |
| cursor 已被 retention GC 回收且 tombstone 仍在 | 410 `event_cursor_expired` | 重新读取 bounded session snapshot，再从当前 watermark 建立流 |
| AG-UI source contract/identity 冲突 | consumer 进入 blocked；尚未发送 SSE headers 时返回结构化 502，已开始的流直接关闭并在客户端携带最后 cursor 重连后返回结构化错误 | 冻结发布、核对 owner contract 与 source ledger，修复后执行受控重置 |

SSE comment 只用于 `keep-alive` heartbeat，不承载错误码或状态迁移。headers 已发送后发生 projector/ledger 故障时，
BFF 关闭连接而不伪造 AG-UI 业务事件；客户端保存最后确认 cursor 并重连，BFF 在能够发送普通 HTTP 响应时返回稳定
JSON error envelope。Run 业务失败必须来自 durable AG-UI `RUN_ERROR`，不得通过 comment 旁路。

## 关闭与降级缺口

当前 server close 会先停止并 drain AG-UI projector、ScheduledTask dispatcher 与 Agent dispatch dispatcher，再关闭
PG/Redis client；仍没有完整的 request drain、termination deadline、circuit breaker 或 bulkhead。Mock 仅用于本地
契约 fixture，绝不作为 Live 降级路径。
