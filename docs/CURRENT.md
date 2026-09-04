# kokoro-bff 当前实现

状态：2026-09-04
适用范围：当前分支代码、`database/schema.sql` 与 `contract/openapi/v1/openapi.yaml`。历史报告不作当前证据。

## 已实现事实

### 契约治理

- `kokoro-bff` 是唯一 public HTTP Product API owner；canonical OpenAPI 位于
  `contract/openapi/v1/openapi.yaml`。
- 当前 OpenAPI 有 63 个 operation；每个 operation 都声明 owner、visibility、stability、idempotency 和
  permission 元数据。
- `pnpm contract:check` 执行 Redocly、metadata 检查和冻结 v1 path/method/operationId surface 检查。
- AG-UI 是 BFF 对 Web 暴露的 Agent 事件 wire protocol；BFF 使用 `@ag-ui/core` schema 校验输出帧。
- `Last-Event-ID` 是 BFF 为每个持久化 public frame 分配的 `agui_*` opaque cursor；Agent source sequence 不再是
  public resume cursor。

### 当前运行时与持久化

- `/v1/*` 校验 `web-bff` 服务身份、共享 secret、namespace、principal 和 request id；浏览器不应直连 BFF。
- Live Project、instruction revision、project skill、project task、ScheduledTask 与 mutation receipt 使用本仓
  PostgreSQL repository。Redis 当前用于 readiness/ping 和 Project cache invalidation，不是事实源。
- Live mutation 仅在 BFF business store 已配置时使用 PostgreSQL receipt；没有 business store 的非 BFF owner
  mutation 仍使用进程内 Map。因此“所有 Live mutation 均持久幂等”不是当前事实。
- 当前 receipt scope 是 `namespace + method + canonical path + Idempotency-Key`；fingerprint 覆盖规范化 body，
  但尚未覆盖 query 与 selected headers。
- Chat Live 路径仍通过 Agent HTTP ingress 读取 execution source facts，但 public event 先写入本仓 PostgreSQL：
  `bff_agui_source_event` 去重 source identity，`bff_agui_event` 保存完整 AG-UI frame，`bff_agui_stream` 保存
  source high-watermark、projection state、version fence 与下一 public sequence。HTTP 只从该 ledger 输出 replay/live
  frame。
- 每个 public frame 有独立 cursor；一个 source fact 展开为 START+CONTENT 等多个 frame 时，可以从任一 frame 后
  strictly-after 恢复。Repository 查询均携带 tenant + session；其他 tenant/session 的有效格式 cursor 返回
  `invalid_event_cursor`。
- 投影事务以 stream row lock + version fence 串行化并发写；source event id 与 source sequence 都有唯一约束，digest
  冲突 fail closed。未映射的 Agent event 也登记 source identity 并推进 source high-watermark，避免重复轮询遮蔽缺口。
- Redis 对 AG-UI 只执行 ephemeral `PUBLISH`；发布失败不回滚已提交 ledger，也没有 Redis replay key/stream。终态 ledger
  可在 Agent disabled/unavailable 及 BFF 重启后独立 replay。
- Scheduler 变更当前采用同步注册/替换/删除，加启动时 best-effort reconciliation；dispatch receipt 使用稳定
  occurrence idempotency key。
- 缺失上游、非法响应和未接写操作会返回稳定错误，不静默降级到 Live 成功。

## 未完成缺口

### P0：运行时正确性

1. **Conversation / Message / Share 的 BFF 事实 ownership 尚未实现。** 当前 Live session/message 数据来自
   Agent；BFF 只拥有公开投影契约，尚未拥有这些产品事实表与 repository。
2. **事务型 outbox 尚未实现。** Project/ScheduledTask 写入、Scheduler 注册和 Agent dispatch 不在一个本地事务
   与 outbox 状态机中；同步失败依靠 `failed` 标记、重试或启动 reconciliation 收敛。
3. **幂等摘要与事务边界不完整。** query、selected headers 未进入 fingerprint；receipt 与业务事实/出站命令
   没有统一事务和 fencing。
4. **AG-UI retention/GC 与主动摄取仍未完成。** 当前 ledger 不删除，因此尚无 cursor-expired 状态、安全 GC 水位或
   retention worker；source ingestion 由 session detail/event stream 请求驱动，而不是独立 durable consumer。若某个
   source event 在首次摄取前已从 Agent history 消失，BFF 无法从 Redis 恢复它。

### P1：架构与工程门禁

- `src/application/agui/` 已形成 projection use case 与 port；`src/domain/`、`src/config/`、`src/bootstrap/` 尚未形成，
  `src/http/` 与 `src/contracts/` 仍是当前物理结构。
- `MockBffStore`、Mori mock 与 mock routes 仍位于生产 `src/` 并编入产物。
- TypeScript 已显式启用 `useUnknownInCatchVariables`；`exactOptionalPropertyTypes`、`noImplicitReturns`、
  `noUnusedLocals`、`noUnusedParameters` 仍因现有源码错误未启用。
- 新增 AG-UI 表已使用 `TIMESTAMPTZ(3)` 与命名 constraint；既有六张表的时间精度、constraint/index 命名，以及
  outbox/retention 仍待后续切片处理。
- `ProjectInstructionRevision` 当前仍暴露 `updatedAt`、`actorName` 和 Unix milliseconds；这是已知 wire-naming/
  UTC 违例，需与 runtime mapper、Web consumer 和 OpenAPI 同一切片删除，不能只改文档伪造 snake_case。
- CI 尚未提供真实 PostgreSQL/Redis service gate、fresh-schema 安装、固定 SHA actions 与完整供应链扫描。
- Docker base digest、HEALTHCHECK、SBOM/provenance/signature/vulnerability scan 尚未在本阶段处理。
- 独立 `.env.example` 尚未固定共享 Redis DB 8；现有 local/prod/test 模板需要后续收敛。

## 本阶段闭环边界

Phase 2 仅闭环 durable public AG-UI projection 的 schema、投影事务、opaque cursor、HTTP replay/live 接线、真实
PostgreSQL/Redis integration 与对应 contract。它不把 Conversation/Message/Share、outbox、GC、主动 event consumer、
完整 IAM permission enforcement 或生产 telemetry 标记为完成。

## 当前证据命令

```bash
pnpm lint
pnpm typecheck
pnpm contract:check
pnpm test:architecture
pnpm test
pnpm build
```

真实基础设施证据必须另外提供：

```bash
KOKORO_BFF_POSTGRES_URL=POSTGRES_URL pnpm db:apply-schema
KOKORO_TEST_POSTGRES_URL=POSTGRES_URL \
KOKORO_TEST_REDIS_URL=redis://127.0.0.1:56380/8 \
pnpm test:integration
```

未提供 PostgreSQL/Redis fixture 时，后两项状态是“未执行”，不是“通过”。验收状态见
[`ACCEPTANCE.md`](./ACCEPTANCE.md)。
