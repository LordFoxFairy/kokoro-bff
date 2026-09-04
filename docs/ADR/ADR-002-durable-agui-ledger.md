# ADR-002：Durable AG-UI ledger 与 opaque cursor

- 状态：Accepted；Phase 2 核心路径已实现
- 日期：2026-09-04
- Owner：kokoro-bff

## Context

Agent 拥有 Run 与执行事件，但 Web 消费的是 BFF public AG-UI。直接把 Agent source sequence 作为 SSE id 会把内部
retention/ordering 泄漏为公开契约，而且一个 source fact 展开成 START+CONTENT 两帧时，两帧共用 id；连接在 START
后断开会把 CONTENT 误判为已确认。内存 projection state 也会在 BFF 重启后重复 START 或依赖 Agent 完整历史。

Redis stream 能加速通知，但 trim、flush、failover 和 consumer state 都不应决定公开历史。公开 replay 需要一个由 BFF
拥有、可事务提交、tenant scoped 且可审计的 durable truth。

## Decision

1. PostgreSQL 是 BFF public AG-UI event/replay 的唯一 durable truth；canonical DDL 只在 `database/schema.sql`。
2. `bff_agui_stream` 以 tenant + session 为主键，保存 source high-watermark、projection state、version fence 与下一
   public sequence；摄取事务锁定该 row。
3. `bff_agui_source_event` 持久化稳定 source owner/id/sequence/digest。未知但有效的 source kind 也登记，以免同一事实
   无限重取；identity 或 sequence 冲突 fail closed。
4. `bff_agui_event` 每行保存一个完整 AG-UI frame、source mapping、frame index、单调内部 public sequence 与独立随机
   `agui_*` cursor。全部 source frames 与 stream state 在一个事务提交，提交前不发送。
5. cursor 只定位位置，不授予权限。所有 lookup/replay 同时要求受信 tenant 与 path session；foreign tenant session
   与普通缺失资源一致，当前 session 的 unknown cursor 返回 `400 invalid_event_cursor`，已回收 cursor 返回 410。
6. Redis 只对 hash-scoped channel 执行 best-effort `PUBLISH`。没有 AG-UI Redis key/stream，publish 失败不回滚事实，
   replay 不读取 Redis。
7. 独立 projector 以 PostgreSQL consumer lease/token/fence 领取 scope，再按持久化 source watermark 拉取 Agent 并提交；
   HTTP 只 drain PostgreSQL。已提交终态可在 BFF 重启和 Agent disabled/unavailable 时独立 replay。
8. GC 只回收最新 `RUN_STARTED` 对应 public sequence 之前且超过 retention 的 frame，保留从该边界到当前 head 的
   完整 run slice；没有可靠 run boundary，或 suffix 中存在找不到同 run `RUN_STARTED` 的交错 frame 时跳过该 stream。
   删除旧 frame 前写入有界 tombstone 并推进 retention
   floor，使客户端明确区分 expired cursor。

## Consequences

- 一个 source fact 展开多 frame 后可从任意已确认 frame strictly-after 恢复；opaque token 稳定但客户端无法构造。
- 并发 stream 会在 row lock/version fence 上收敛，重复 source 不产生第二组 frame。
- 数据库会保存公开文本/tool result 等 payload，访问控制、备份与未来 retention 必须按用户内容处理。
- Redis notification 丢失只影响唤醒延迟，不影响历史正确性；公开 HTTP 使用 bounded ledger polling，不接触 Agent source。
- source ingestion 由后台 durable consumer 承担；Agent source retention 仍必须覆盖 projector 的最大恢复窗口。

## Rejected

- **继续使用 Agent numeric sequence：** 多 frame 共用 id，会丢失中间 frame，并把内部排序暴露给 public client。
- **Redis stream 作为 replay truth：** trim/flush 和运行时配置会使公开历史与 cursor 不可恢复。
- **只保存最终 AG-UI payload，不保存 source identity/state：** 无法安全去重、处理零 frame source 或跨重启维持 lifecycle。
- **cursor 内编码 tenant/session/sequence：** 增加客户端依赖与信息泄漏；随机 token + scoped lookup 更窄。

## Follow-up

- 为 projection schema 版本变化定义 re-projection 策略并完成 PG backup/restore 演练；
- 增加 projection lag/contention metrics、结构化日志与 SLO 告警；
- 将 Agent event 与 BFF assistant Message 生命周期做 durable reconciliation。
