# kokoro-bff 当前实现

状态：2026-09-21
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
- Capability consumer 设计已冻结：accepted owner commit
  `7f89a267d745cbb9870f52d6edb23dec1a3c469b` 的 HTTP OpenAPI `2.0.0` 已作为 immutable vendor input 固定，
  dependency manifest 当前为 `design-frozen`。这只是实现前设计门，不表示 edge 已激活或 generated client 已存在。

### 当前运行时与持久化

- `/v1/*` 校验 `web-bff` 服务身份、共享 secret、namespace、principal 和 request id；浏览器不应直连 BFF。
- Live Project、instruction revision、project skill、project task、ScheduledTask 与 mutation receipt 使用本仓
  PostgreSQL repository。Redis 当前用于 readiness/ping 和 Project cache invalidation，不是事实源。
- Live Conversation、Message、Share 使用本仓 `bff_conversation`、`bff_message`、`bff_share` PostgreSQL repository；
  所有读写带 tenant predicate，删除保留 tombstone，share 撤销/过期后保留记录并只暴露 active/unexpired share。
- Chat session list/detail/message history/title/delete/share routes 不再读取 Agent history。Message create 在一个 BFF
  PostgreSQL 事务中同时写入 completed user message、pending assistant message、`bff_agent_dispatch_outbox` 与预注册的
  AG-UI expected run；HTTP 在本地事务提交后返回 `202`，后台 dispatcher 再通过窄 Agent client 投递。Agent 仍只拥有
  Run/control/source execution events。
- ScheduledTask aggregate 的 `nextRunAt`/`expiresAt` 在 application/domain 内是有效的 UTC `Date`；HTTP/JSON 与
  Scheduler command 使用 RFC 3339 UTC 字符串，`time` + IANA `timezone` 保留本地周期规则。数据库事实使用
  `TIMESTAMPTZ(3)`。
- Live mutation 仅在 BFF business store 已配置时使用 PostgreSQL receipt；没有 business store 的非 BFF owner
  mutation 仍使用进程内 Map。因此“所有 Live mutation 均持久幂等”不是当前事实。
- 当前 receipt scope 是 `namespace + method + canonical path + Idempotency-Key`；fingerprint 覆盖规范化 body，
  但尚未覆盖 query 与 selected headers。
- 独立 `AgUiProjectorRunner` 通过窄 Agent source reader 主动读取 execution source facts；公开 SSE 请求不再访问
  Agent source，只读取本仓 PostgreSQL：
  `bff_agui_source_event` 去重 source identity，`bff_agui_event` 保存完整 AG-UI frame，`bff_agui_stream` 保存
  source high-watermark、projection state、version fence 与下一 public sequence。HTTP 只从该 ledger 输出 replay/live
  frame。
- 每个 public frame 有独立 cursor；一个 source fact 展开为 START+CONTENT 等多个 frame 时，可以从任一 frame 后
  strictly-after 恢复。Repository 查询均携带 tenant + session；不存在于当前 tenant 的 session 先返回与普通缺失资源
  相同的 `404 session_not_found`，当前 session 内未知 cursor 返回 `400 invalid_event_cursor`。
- 投影事务以 stream row lock + version fence 串行化并发写；source event id 与 source sequence 都有唯一约束，digest
  冲突 fail closed。未映射的 Agent event 也登记 source identity 并推进 source high-watermark，避免重复轮询遮蔽缺口。
- Redis 对 AG-UI 只执行 ephemeral `PUBLISH`；发布失败不回滚已提交 ledger，也没有 Redis replay key/stream。终态 ledger
  可在 Agent disabled/unavailable 及 BFF 重启后独立 replay。
- `bff_agui_stream` 同时保存 consumer subject、next poll、lease owner/token/fence、连续失败计数、错误与最后完成时间；
  `expected_run_id` 是最新接纳的 run fence，`latest_run_id` 只记录最近投影的 source run。多个实例使用
  `FOR UPDATE SKIP LOCKED` 领取 scope，lease eligibility/deadline 由 PostgreSQL 时钟计算，worker 只用 monotonic clock
  消耗数据库返回的剩余预算；不同 expected run 的注册会递增 version/fence 并撤销旧 lease，旧 worker或新 lease 补投的
  旧 run 都无法提交 terminal 或覆盖 settlement。message/tool state
  以 run identity 隔离，任一终态只清理所属 run。source read 在
  lease deadline 内使用显式 attempt budget；timeout/connection/429/5xx 等瞬时错误跨 claim 执行 capped exponential
  backoff + jitter，并在配置上限内尊重 `Retry-After`；成功后清零失败计数。契约、identity、source gap 预算耗尽、
  401/403、410、非法 4xx 或过大响应进入可诊断 blocked 状态。
- 后台 GC 使用 `latest_run_start_sequence` 作为安全边界，只删除该边界之前且超过 retention 的旧 run frame，保留
  从最新 `RUN_STARTED` 到当前 head 的完整 run slice；没有可靠边界或 suffix 包含找不到同 run `RUN_STARTED` 的交错
  frame 时跳过该 stream。回收前先把 frame cursor 写入
  `bff_agui_cursor_tombstone`，再推进 retention floor。tombstone 窗口内重连返回 `410 event_cursor_expired`；窗口
  结束后按未知 cursor 处理。
- ScheduledTask create/update/delete/retry 先在同一 PostgreSQL 本地事务写入 task revision 与
  `bff_scheduled_task_outbox` command；事务提交后由 bounded dispatcher 在事务外调用 Scheduler。command 保留
  `tenant_id`、`actor_id`、`request_id`、`idempotency_key` 和版本化 task snapshot，并以 `SKIP LOCKED`、lease token、
  fence、指数退避、重试上限和 `pending/leased/retryable/succeeded/failed` 状态恢复。Scheduler dispatch receipt 仍使用
  稳定 occurrence idempotency key。
- Chat → Agent dispatcher 使用稳定 run/message/idempotency identity、`FOR UPDATE SKIP LOCKED`、lease token/fence、
  有界 attempt 与指数退避执行 at-least-once 投递。BFF 或 Agent 重启不会丢失已接纳命令；过期 lease 可重新领取，旧
  worker 和跨 tenant settlement 都不能覆盖当前结果。明确永久失败会把 provisional assistant message 标记为 failed。
- Agent 自有 wire protocol 不在本切片改写；若其事件边界使用 epoch milliseconds，BFF 将其视为 wire encoding，AG-UI
  projection 的内部时间仍在边界解析为 UTC instant。
- 缺失 BFF store、非法请求/响应和未接写操作会返回稳定错误；ScheduledTask 在 Scheduler 缺失时仍可提交本地
  fact+outbox，外部 command 保持 retryable，不伪造 Scheduler 已成功。
- 当前 runtime 仍使用 Capability legacy `/bff/*` 路径和 public `q` 查询，尚未消费本次冻结的 owner artifact；
  `EDGE-BFF-CAPABILITY` 因此保持 broken。W0B-4 在同一切片生成 narrow client、只接受 canonical `query`、让 `q`
  返回 400，并删除 legacy path、fallback 与 alias。

## 未完成缺口

### P0：运行时正确性

1. **Chat assistant message reconciliation 尚未实现。** Agent dispatch outbox 已闭合 admission 与投递恢复，但成功接纳
   Run 后，Agent source event 尚未 durable 回写 `bff_message` 的 streaming/completed 内容；provisional assistant message
   会保持 pending，直到下一切片建立 event → Message reconciliation。当前不能把 AG-UI ledger 等同于 Message fact。
2. **事务型 outbox 仍按 owner/切片分阶段。** ScheduledTask → Scheduler 与 Chat → Agent 的 bounded outbox 已实现并有
   真实 PG integration；Project side effect，以及 mutation receipt claim 与 aggregate/outbox 的统一事务仍未完成。两条
   外部投递均是 at-least-once，依靠稳定 command identity 与带 fence 的条件 settlement 收敛。
3. **幂等摘要与事务边界不完整。** query、selected headers 未进入 fingerprint；receipt 与业务事实/出站命令
   没有统一事务和 fencing。
4. **AG-UI 跨版本重投影与备份恢复演练仍未完成。** 主动 consumer、lease/fence、retention floor、frame GC、cursor
   tombstone 与 expired-cursor 错误已经实现；尚缺 projection version 升级策略、生产 PG restore 演练和长时故障注入。
5. **Capability consumer 尚未实现。** owner tuple、vendored OpenAPI、generator config、HTTP-only 边界与无数据 owner/
   schema 变更已经冻结；generated outputs、facade、runtime route、public OpenAPI/operation baseline 与 drift command 属于
   W0B-4。本任务没有修改 `src/**`、package/lock 或 canonical database schema。

### P1：架构与工程门禁

- `src/application/agui/` 已形成 projection use case、source/consumer ports 与独立 runner；具体 Agent client、PostgreSQL
  ledger 和 consumer/GC 实现位于 `src/infrastructure/`，启动装配位于 `src/bootstrap/`。
- Mock、fixture 与 route test doubles 只在 `test/`，不编入生产产物。
- TypeScript strict、`exactOptionalPropertyTypes`、`noImplicitReturns`、`noUnusedLocals`、`noUnusedParameters` 与
  `useUnknownInCatchVariables` 均已启用。
- canonical schema 中所有瞬时点已统一使用 `TIMESTAMPTZ(3)` 与 `CURRENT_TIMESTAMP(3)`；部分既有 constraint/index
  命名，以及 receipt/outbox retention 仍待后续切片处理。
- `ProjectInstructionRevision` 当前仍暴露 `updatedAt`、`actorName` 和 Unix milliseconds；这是已知 wire-naming/
  UTC 违例，需与 runtime mapper、Web consumer 和 OpenAPI 同一切片删除，不能只改文档伪造 snake_case。
- CI 尚未提供真实 PostgreSQL/Redis service gate、fresh-schema 安装、固定 SHA actions 与完整供应链扫描。
- Docker base digest、HEALTHCHECK、SBOM/provenance/signature/vulnerability scan 尚未在本阶段处理。
- `.env.example` 已固定共享本地 PostgreSQL 端口与 Redis logical DB 8；CI 的隔离 service 端口由 workflow 显式覆盖。

## 本阶段闭环边界

本阶段闭环 BFF-owned Conversation/Message/Share、Chat → Agent transactional outbox、独立 durable AG-UI source
consumer、lease/fence、retention/GC 与 expired cursor。它不拥有 Agent Run，也不扩展到 assistant message reconciliation、
完整 IAM permission enforcement、projection 跨版本重建或生产 telemetry。

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
