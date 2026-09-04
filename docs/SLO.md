# kokoro-bff SLO

状态：目标定义；当前没有足够生产 telemetry，以下数字不是实测结果或已达成承诺。

## 服务边界

SLI 只统计 BFF public Product API 和 AG-UI stream admission。上游 owner 的 SLO 独立，但 BFF 端到端 SLI 必须把 owner
依赖导致的用户可见失败计入，不能从分母删除。

## 目标

| SLI | 计算 | 28 天目标 |
| --- | --- | --- |
| Product API availability | 非预期 5xx 之外的合格请求 / 合格请求 | 99.9% |
| Read latency | 非 streaming GET 从接收到完整响应 | p95 < 500 ms，p99 < 1.5 s |
| Mutation admission latency | 收到完整 body 到 receipt response | p95 < 750 ms，p99 < 2 s |
| AG-UI reconnect success | 有效 BFF opaque cursor 在 10 s 内从 PostgreSQL 恢复首个 frame 或明确终态 | 99.9% |
| AG-UI projection integrity | committed source identity 对应 frame 无 gap、重复或跨 tenant/session 可见 | 100% |
| Idempotent replay correctness | 同 scope/digest 返回同 status/body 且无第二副作用 | 100% |
| Tenant isolation | 跨 tenant 数据泄漏事件 | 0 |
| Scheduled occurrence uniqueness | 同 task/occurrence 启动不超过一个 Run | 100% |

## Error budget

99.9% availability 的 28 天预算约为 40.3 分钟。任何 tenant isolation、重复计费、重复 Run 或不可恢复 ledger corruption
事件直接冻结相关发布，不以剩余 availability budget 抵扣。

## 告警目标

- 5 分钟窗口 5xx > 2% 或 30 分钟窗口 > 0.5%；
- PG/Redis readiness 连续 3 次失败；
- owner timeout、response-too-large 或 schema mismatch 急升；
- pending receipt 超过 60 秒或同 scope conflict 急升；
- Scheduler failed/reconcile backlog 非零持续 10 分钟；
- AG-UI reconnect failure、source identity conflict、cursor gap 或 duplicate public cursor 任一出现；
- cross-tenant negative canary 任一失败。

## 当前可观测性缺口

当前真实 integration 证明功能不变量，不等于 SLO 达标。实现尚未提供完整 Prometheus metrics、distributed trace、
structured operation log、AG-UI source-to-public lag、stream version contention、Redis notification loss、outbox backlog、
receipt age histogram 或 automated SLO report。因此本文件只能定义目标。上线前必须记录 query、label cardinality、
采样与告警路由，并用真实流量/故障注入形成基线。

## Runbook

告警的处置入口是 [`RUNBOOK.md`](./RUNBOOK.md)。SLO 变更必须与 owner SLO、容量测试、timeout budget 和 error-budget
政策一起评审。
