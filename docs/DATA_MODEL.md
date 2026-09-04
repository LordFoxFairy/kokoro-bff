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
| `bff_scheduled_task` | ScheduledTask definition | task id；tenant 列表 | 保存 owner、IANA timezone 字符串、UTC next_run_at |
| `bff_idempotency_receipt` | mutation receipt | scope PK | pending/terminal status 与 JSON response |

所有当前 repository 查询都必须显式携带 tenant id；跨 owner reference 是 opaque id，不做跨数据库 JOIN。

## 当前不存在的目标事实

**当前 schema 没有 AG-UI ledger 表。** 因而没有 BFF-owned public event cursor、source-to-public mapping、replay
retention 或 GC watermark。

**当前 schema 没有 outbox 表。** Project/ScheduledTask mutation 与 Scheduler/Agent side effect 尚未通过本地事务型
outbox 提交。

当前也没有 BFF-owned Conversation、Message、Share、durable command receipt resource、version/ETag 或 delivery
projection 表。Live Chat history 仍从 Agent HTTP ingress 读取；这不等于 BFF 已经拥有 Chat 产品事实。

## 时间、约束与命名

目标时间类型是 `TIMESTAMPTZ(3)` + `CURRENT_TIMESTAMP(3)`，API 为 RFC 3339 UTC。当前 schema 使用
`TIMESTAMPTZ`/`CURRENT_TIMESTAMP`，毫秒精度尚未显式固定。部分 index 和 CHECK constraint 尚未按
`ix_`/`uq_`/`ck_` 命名；这是已记录 schema 治理缺口，本阶段未修改数据库。

`NULL` 当前用于可选 instruction/project/expiry 等语义。Event/ledger 一旦落地应 append-only，不机械添加
`updated_at`；同一毫秒顺序使用 public sequence 作为第二排序键。

## Redis

BFF 本地逻辑库固定为 Redis DB 8。当前代码只执行 readiness `PING` 与 Project cache invalidation；Redis 不保存
canonical Project/ScheduledTask/receipt，也不是公开 AG-UI replay 事实源。未来 stream/queue/lease 只能作为协调，
丢失后必须可从 PostgreSQL 恢复。

## 安装与 drift

只在空数据库安装当前 schema：

```bash
KOKORO_BFF_POSTGRES_URL=POSTGRES_URL pnpm db:apply-schema
```

`CREATE TABLE IF NOT EXISTS` 便于本地重复安装，但不修复 drift。发布验收需要 fresh database 安装、schema naming /
无外键/UTC 检查和真实 repository integration；生产升级策略在 V1 clean-slate 阶段尚未定义为历史 migration 链。

## Retention 缺口

当前 schema 未声明 receipt TTL/归档任务、Project 删除语义、ScheduledTask tombstone、Chat/AG-UI retention 或 outbox
清理策略。增加任何清理前必须先在 contract、SLO、runbook 与真实恢复测试中定义安全水位。
