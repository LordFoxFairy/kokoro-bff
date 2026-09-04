# kokoro-bff reliability

## 当前可靠性机制

- 所有响应关联 request id；owner response 可沿用同一 id。
- 出站 HTTP 有整体 timeout 与最大响应字节数；不可达、HTTP error 和 contract mismatch 使用稳定错误归一。
- mutation 使用 pending/terminal receipt，支持 replay、conflict 和 in-progress 判定；5xx 释放 pending claim以允许重试。
- PostgreSQL pending receipt 60 秒后可回收，防止进程崩溃永久占用 key。
- ScheduledTask 使用稳定 job name/occurrence key；启动时 best-effort 重新注册 active task。
- Live 配置/上游缺失时 fail closed，不回退到 Mock 成功。

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

当前事件由 Agent replay 即时映射为 AG-UI；`Last-Event-ID` 是 Agent source sequence。BFF 没有 durable public ledger，
所以 BFF 无法独立保证 public cursor retention、GC、跨版本投影稳定性或 Agent history 缺失时的恢复。

目标必须验证：单调 public cursor、断线后 strictly-after replay、一个 source fact 展开多 frame 时不丢片段、BFF/Agent
重启、cursor 过期的稳定错误、retention 和 GC safety watermark。

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
| Redis 不可用 | business store readiness 失败 | 恢复 Redis；PG facts 不应丢失 |
| owner timeout/过大响应 | 稳定 502/错误归一 | 在幂等预算内重试 |
| Scheduler 注册失败 | task 标记 failed | `retry` 或重启 reconciliation |
| Agent 不可用 | Chat/dispatch fail closed | 同 key 重试或稍后读取 receipt |
| BFF 在同步 side effect 中间崩溃 | 可能 divergence | 当前靠 owner state + 启动 reconcile；outbox 待实现 |
| cursor 早于保留水位 | 尚无 BFF policy | durable ledger/稳定 cursor-expired error 待实现 |

## 关闭与降级缺口

当前 server close 会关闭 PG/Redis client，但没有完整的 request drain、dispatcher drain、termination deadline、circuit
breaker 或 bulkhead。Mock 仅用于本地契约 fixture，绝不作为 Live 降级路径。
