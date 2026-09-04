# kokoro-bff data model

## Owner 与 canonical schema

[`../database/schema.sql`](../database/schema.sql) 是本仓唯一 canonical PostgreSQL schema。BFF 不保存 migration 链，
不使用外键，不允许其他仓库直接读取这些表。关系由 tenant-scoped Repository/Application 校验和 reconciliation
维护。

## 当前表

| 表 | Owner fact | 关键键/查询 | 当前备注 |
| --- | --- | --- | --- |
| `bff_project` | Project projection | `project_id`; tenant + slug 唯一 | 保存 name/description/instruction |
| `bff_project_instruction_revision` | instruction revision | tenant + project + updated_at | `current` 由应用维护 |
| `bff_project_skill` | project skill state | tenant + project + skill PK | 布尔 enabled 投影 |
| `bff_project_task` | project task projection | task id；tenant + project 排序 | status 有有限 CHECK |
| `bff_scheduled_task` | ScheduledTask definition | task id；tenant 列表；revision | 保存 owner、IANA timezone + local time rule、UTC `next_run_at` |
| `bff_scheduled_task_outbox` | ScheduledTask → Scheduler command | outbox id；`tenant_id + task_id + command_type + idempotency_key` 唯一；ready/task index | bounded register/replace/delete queue；保存版本化 payload、lineage、lease/fence、attempt/error/terminal state |
| `bff_idempotency_receipt` | mutation receipt | scope PK | pending/terminal status 与 JSON response |
| `bff_conversation` | Conversation 产品事实 | `conversation_id`；tenant + updated_at 稳定列表排序 | active/deleted tombstone；删除不物理清除，保留至 retention cleanup |
| `bff_message` | Message 产品事实 | `message_id`；tenant + conversation + message_seq 唯一 | role/status CHECK；`run_id` 是 Agent opaque reference，不做跨仓关系约束 |
| `bff_share` | Share 产品事实 | `share_id`；tenant + conversation active partial unique | revoked/expired rows retained；public lookup 只接受未撤销且未过期记录 |
| `bff_agui_stream` | tenant/session public projection + consumer state | `(tenant_id, session_id)` PK | projection version/source watermark；`expected_run_id` 是最新接纳的 run fence，`latest_run_id` 是最近投影的 source run；latest run start retention boundary；subject、due time、lease token/fence、persistent failure count、blocked/error state |
| `bff_agui_source_event` | 已摄取 Agent source identity | tenant/session/owner/event PK；source sequence 唯一 | 保存 SHA-256 digest；包括零 public frame 的未知 source kind |
| `bff_agui_event` | append-only public AG-UI frame | tenant/session/public sequence PK；cursor 全局唯一；source frame 唯一 | 完整 JSON payload 与 opaque cursor |
| `bff_agui_cursor_tombstone` | 已回收 public cursor 的有界诊断事实 | tenant/session/cursor PK；expiry index | 在 tombstone 窗口内区分 expired 与未知/foreign cursor |

所有当前 repository 查询都必须显式携带 tenant id；跨 owner reference 是 opaque id，不做跨数据库 JOIN。

### AG-UI 不变量

1. `(tenant_id, session_id)` 是 sequence allocator、projection state 与查询的最小 scope；只凭 session id 或 cursor 不读取。
2. `public_sequence` 从 1 单调递增，事务持有 stream row lock 并校验 `version`；它只在服务端排序，不进入 public wire。
3. 每个 frame 的 `cursor` 是持久化随机 `agui_*` token。全局唯一约束防碰撞，tenant/session predicate 防止 token 成为
   authority。
4. 同一 source event 的全部 frames、source identity、projection state 和 high-watermark 在一个 PostgreSQL 事务提交。
5. `(source_owner, source_event_id)` 与 `(source_owner, source_sequence)` 在 tenant/session scope 内分别唯一；identity
   重用或 digest 冲突 fail closed，不覆盖历史 payload。
6. 一个 source event 可以产生 0、1 或多个 public frame。0 frame 仍登记并推进 source watermark；多个 frame 各有
   cursor，保证中间断线后的 strictly-after replay 无损。
7. 表之间不设外键；同一事务与 repository 不变量维护映射完整性。
8. consumer 使用 `FOR UPDATE SKIP LOCKED` 领取 scope，claim 递增 `consumer_fence`；projection commit 与 settlement
   同时匹配 owner/token/fence/未过期 lease，旧 worker 不得推进 watermark。`consumer_failure_count` 在 retryable/blocked
   settlement 时递增、成功 poll 时清零，为跨 worker 的 capped exponential backoff 提供持久依据。lease 到期与 deadline
   由 PostgreSQL 时钟判断；claim 返回数据库计算的剩余 lease budget，进程内只用 monotonic clock 消耗该预算，worker
   wall clock 不参与 lease 有效性判断。注册不同 `expected_run_id` 会递增 version/fence、撤销旧 lease并清除旧
   terminal；`latest_run_id` 仅记录最近投影的 source run，只有 expected run 的终态可以关闭 public stream。持久化
   message/tool projection key 带 run identity，终态只清理所属 run。
9. GC 保留从最新 `RUN_STARTED` 到当前 head 的完整 run slice，只删除 `latest_run_start_sequence` 之前且超过
   retention 的旧 run frame；没有可靠 run boundary，或 suffix 中存在找不到同 run `RUN_STARTED` 的交错 frame 时跳过
   该 stream。旧 frame 删除前先写 cursor tombstone，再推进
   `retention_floor_sequence`。已知被回收 cursor 在 tombstone retention 内返回 `410 event_cursor_expired`，tombstone
   到期后不泄漏历史 scope。

### ScheduledTask 与 bounded outbox 不变量

1. `bff_scheduled_task` 的 `tenant_id` 是每个 public read/write 的必需范围；`time` 是本地 wall-clock rule，`timezone`
   必须是 IANA 名称，`next_run_at`/`expires_at` 是 UTC instant，数据库精度固定为 `TIMESTAMPTZ(3)`。
2. 每次 create/update/delete/retry 在一个本地 PostgreSQL 事务内同时写 task fact（含递增 `revision`）和一个明确的
   Scheduler command；删除先写 delete command，再删除 fact。没有跨仓 FK/数据库 JOIN。
3. outbox 只属于 ScheduledTask，不是万能队列。`command_type` 仅允许 `scheduler.register|replace|delete`；同一
   `(tenant_id, task_id, command_type, idempotency_key)` 只允许一个业务 command，payload 的 command、task、revision
   和 lineage 必须与列一致。
4. payload 在 JSONB 中使用 `snake_case` RFC 3339 UTC 字符串；进入 domain/application/adapter 后转换为 UTC `Date`。
   Agent 自有 event 的 epoch-millisecond 编码属于另一个 wire boundary，本切片不重定义它。
5. dispatcher 只在 `pending`、到期 `retryable` 或 lease 已过期时 claim；`FOR UPDATE SKIP LOCKED` 分配
   `lease_owner`、`lease_token` 和递增 `fence`。settlement 必须匹配三者，防止旧 worker 覆盖新 lease。
6. `2xx -> succeeded`；明确瞬时错误进入 `retryable` 并指数退避；永久错误或超过 attempt budget 进入 `failed`。外部
   Scheduler 投递是 at-least-once，使用稳定 command idempotency key。

## 当前不存在的目标事实

Project side effect、Agent Run outbox、mutation receipt claim 与 ScheduledTask fact/outbox 的统一事务、outbox retention
和后台业务 reconciliation 尚未完成；这些不属于本切片。ScheduledTask → Scheduler bounded outbox 与 AG-UI source
consumer/GC 已是当前 schema 事实。

当前没有独立 Chat assistant reconciliation worker、durable command receipt resource、version/ETag 或 delivery
projection 表。Conversation、Message、Share 已由 BFF PostgreSQL 拥有；Agent HTTP ingress 负责 launch/control，独立
projector 的窄 source reader 只读取 execution events，不作为 Chat 产品事实读取源。

### Chat 产品事实不变量

1. 所有 Conversation/Message/Share repository 查询都带 `tenant_id`；跨 tenant 的 id、cursor、project_ref 和 share
   不返回有效事实。
2. Message append 与 Conversation lock 在同一事务中执行，锁顺序固定为 Conversation → message sequence allocation →
   Message insert → Conversation updated_at；没有数据库级跨仓关系约束。
3. Conversation delete 先更新 active row 为 deleted tombstone，再在同一事务撤销 active shares；Message rows 保留用于
   retention/audit cleanup，公开列表与详情只看 active conversation。
4. Share 的 partial unique index 只限制 `revoked_at IS NULL`。创建 share 时在持有 Conversation lock 的事务中先将已过期且
   未撤销的 share 标记 revoked，再创建 replacement，因此过期 share 不会阻塞新 share；retention job 后续清理历史 rows。
5. Conversation 与 Message 列表使用 `(updated_at, id)` / `(created_at, message_seq, message_id)` 稳定排序，cursor 是带前缀的
   base64url opaque token；时间在 application/domain 使用 UTC `Date`，数据库使用 `TIMESTAMPTZ(3)`。

## 时间、约束与命名

所有数据库瞬时点统一使用 `TIMESTAMPTZ(3)` + `CURRENT_TIMESTAMP(3)`，API 为 RFC 3339 UTC。AG-UI 与 ScheduledTask/outbox
表使用毫秒精度和 `pk_`/`uq_`/`ck_` constraint 名；部分既有 index/CHECK 尚未按 Root 规范命名。这是剩余 schema 治理
缺口，不把时间精度合规扩大为其它命名重构。

`NULL` 当前用于可选 instruction/project/expiry 等语义。Event/ledger 一旦落地应 append-only，不机械添加
`updated_at`；同一毫秒顺序使用 public sequence 作为第二排序键。

## Redis

BFF 本地逻辑库固定为 Redis DB 8。当前代码执行 readiness `PING`、Project cache invalidation 与 AG-UI projection
更新 `PUBLISH`。AG-UI 不写 Redis key/stream；publish 是可丢失提示，失败不回滚 PostgreSQL。Redis 不保存 canonical
Project/ScheduledTask/receipt/outbox，也不是公开 AG-UI replay 事实源；丢失后 ScheduledTask dispatcher 从 PostgreSQL
继续 claim，AG-UI replay 仍从 PostgreSQL 恢复。

## 安装与 drift

只在空数据库安装当前 schema：

```bash
KOKORO_BFF_POSTGRES_URL=POSTGRES_URL pnpm db:apply-schema
```

`CREATE TABLE IF NOT EXISTS` 便于本地重复安装，但不修复 drift。发布验收需要 fresh database 安装、schema naming /
无外键/UTC 检查和真实 repository integration；生产升级策略在 V1 clean-slate 阶段尚未定义为历史 migration 链。

## Retention 状态与缺口

AG-UI frame retention、最新 run boundary 保护、retention floor 与 cursor tombstone 已由后台 GC 实现，并有真实
PostgreSQL integration 覆盖。source identity rows 当前作为投影审计事实长期保留，不与 frame 同步删除。仍未声明 receipt TTL/归档、
Project 删除清理、ScheduledTask tombstone、ScheduledTask outbox 归档和 source identity 的最终保留周期；这些策略必须先
进入 contract/SLO/runbook 与恢复测试，不能用临时 SQL 直接清表。
