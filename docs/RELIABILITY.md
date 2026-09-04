# kokoro-bff reliability

## 当前可靠性机制

- 所有响应关联 request id；owner response 可沿用同一 id。
- 出站 HTTP 有整体 timeout 与最大响应字节数；不可达、HTTP error 和 contract mismatch 使用稳定错误归一。
- mutation 使用 pending/terminal receipt，支持 replay、conflict 和 in-progress 判定；5xx 释放 pending claim以允许重试。
- PostgreSQL pending receipt 60 秒后可回收，防止进程崩溃永久占用 key。
- ScheduledTask 使用稳定 job name/occurrence key；启动时 best-effort 重新注册 active task。
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

**当前不具备事务型 outbox。** ScheduledTask create/update 先写 BFF fact，再同步 Scheduler；失败后标记 task failed。
Delete 先删除 Scheduler job，再删除 BFF fact。进程在两个步骤间崩溃会产生短暂或持久 divergence，当前依赖 retry 与
startup reconciliation，而不是 durable dispatcher/fencing。

目标路径是：同一 PostgreSQL 事务写 aggregate、receipt claim 与 outbox；dispatcher 使用稳定 command identity、退避、
jitter、lease/fencing 投递；owner receipt 与 BFF outbox 状态 reconciliation 后完成公开 receipt。

## AG-UI replay

当前 public event 与 replay 的唯一 durable truth 是 BFF PostgreSQL ledger。HTTP 先重放已提交 rows，再按持久化 source
high-watermark 从 Agent 获取新 source facts；投影事务提交后才发送。`Last-Event-ID` 是逐 frame `agui_*` token，内部
public sequence 单调且不暴露。终态已持久化时，BFF 重启或 Agent disabled/unavailable 不影响 replay。

真实 PostgreSQL/Redis integration 已验证：strictly-after、一个 source fact 展开多 frame 后从中间恢复、并发重复
摄取、source identity 冲突、projection state 跨重启、tenant/session foreign cursor 拒绝、BFF 重启后 replay，以及
Redis 不存在 AG-UI 持久键。Redis publish 可丢失且失败不回滚 ledger。

尚未闭环：retention/GC safety watermark、cursor-expired 稳定错误、后台主动摄取、跨版本 re-projection、PG backup
restore 与长时间 fault injection。当前读取驱动 ingestion；source fact 在首次摄取前从 Agent history 消失时仍可能形成
不可恢复缺口。

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
| Scheduler 注册失败 | task 标记 failed | `retry` 或重启 reconciliation |
| Agent 不可用 | 新 Chat/dispatch fail closed；终态 AG-UI ledger 可独立 replay | 同 key 重试；公开历史从 PG 读取 |
| BFF 在同步 side effect 中间崩溃 | 可能 divergence | 当前靠 owner state + 启动 reconcile；outbox 待实现 |
| cursor 格式错误、未知或跨 scope | 400 `invalid_event_cursor` | 使用该 tenant/session 最后确认的 SSE id |
| cursor 早于未来保留水位 | 当前不清理，因此尚无此状态 | retention/cursor-expired policy 待实现 |

## 关闭与降级缺口

当前 server close 会关闭 PG/Redis client，但没有完整的 request drain、dispatcher drain、termination deadline、circuit
breaker 或 bulkhead。Mock 仅用于本地契约 fixture，绝不作为 Live 降级路径。
