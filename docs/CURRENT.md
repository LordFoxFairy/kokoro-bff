# kokoro-bff 当前实现

状态：2026-09-23
适用范围：当前分支代码、`database/schema.sql` 与 `contract/openapi/v1/openapi.yaml`。历史报告不作当前证据。

W1C-Team-R2 本仓源码已在 main `fd74202e69e4d40beaef9d3f9ab9b871365589a8` 发布：IAM owner `68aa0da259df1f1ea9030936b8d5a46acba8c6ab` 的内部 OpenAPI `0.3.0` 已替换旧 `0.2.0` vendor，生成链精确增加当前租户 members/invitations/roles 三 GET，旧 vendor 已删除；BFF public 三 GET、只读 Team 客户端与六项假 IAM HTTP 回归也已提交。IAM test-owned Web OIDC client 后续在 `c0f6068731b8a506cd2d3554e72719aa7327f2be` 注册三个 Team 只读 scope；本仓 relay policy 来源跟进该 commit，IAM allowlist 与原生快照 digest 未变。真实 IAM HTTP、Web Team 消费、Root gitlink/库存尚未验，不能称 Team 跨仓闭环。

## 已实现事实

### W1C-DB-BFF：固定 PostgreSQL owner schema（待 Root 验收）

- `KOKORO_BFF_POSTGRES_URL` 必须含唯一 `schema=kokoro_bff`；config/installer/runtime Pool 拒绝旧 public 或其他 owner URL，
  实际连接固定 `search_path=kokoro_bff`；readiness 还校验 `current_schema()` 与关键 BFF 表，空 owner schema 或缺表不报告就绪。
  SQL-first `database/schema.sql` 不变。
- 安装器在 owner-scoped advisory lock 和事务内只检查/创建 `kokoro_bff`，以 schema 依赖 catalog 覆盖 table/type/function/collation 等对象；其他 schema 已有表允许，目标非空、重复安装、
  SQL 失败均 fail closed。临时数据库真实测试覆盖 rollback/共存/重试拒绝，运行时独立临时库实测
  `current_schema()=kokoro_bff`、`public` 表数 0、BFF 表数 16；测试自建数据库已清理。
- `schema:check` 仍仅静态检查 canonical SQL，完整 persisted catalog drift 未覆盖；此项不冒称完成。

### W1C-1 本次源码切片：browser-private IAM relay

- 本次源码切片在普通 `/v1` IAM admission 之外，新增由 Web service secret 准入的精确 `/iam` 原生协议 relay；
  runtime 不签发 token、不开 IAM internal API、不读写 BFF SQL/Redis、不过 Product envelope。BFF 本地门已运行，
  仍待 Root gitlink 来源门与真实正向 OAuth 组合验收，因此不表示完整登录已可用。
- 单一 TS 准入事实源为 `src/http/routes/iam-protocol-relay.policy.ts`；`contract/iam-relay-policy.json` 由
  `pnpm contract:generate:iam-relay` 确定性派生，`pnpm contract:check:iam-relay` 拒绝生成 artifact 漂移。
  IAM 私有来源不复制入 BFF；其 digest 与 allowlist 子集留 Root 固定 gitlink commit blob 组合机器门验证。公开 Product OpenAPI
  未改，Web consumer 仍待本仓 SHA/contract digest 冻结后串行实施。
- 精确 endpoint/method、Web origin、server-only Basic/Bearer、issuer cookie、signed interaction redirect、response
  header 与 timeout/cancellation 规则见 `docs/API_CONTRACT.md` 的 W1C-1 节。入站慢 body 与上游共用单一截止，
  超限 response header/body 会取消上游真实 socket；本仓 HTTP 测试覆盖入站超时/取消/header/body cap。
  IAM 本地 fixture 中登录与 issuer Session 原生 HTTP 已通过聚焦测试；Code+PKCE/consent/logout 成功链以及
  完整 Web Auth.js RP、Product Session 和跨仓登录仍待 W1C-1 后续联调及 W1C-2/3。

### 契约治理

- `kokoro-bff` 是唯一 public HTTP Product API owner；canonical OpenAPI 位于
  `contract/openapi/v1/openapi.yaml`。
- 当前 OpenAPI 有 66 个 operation；每个 operation 都声明 owner、visibility、stability、idempotency 和
  permission 元数据。
- `pnpm contract:check` 执行 Redocly、metadata 检查和冻结 v1 path/method/operationId surface 检查。
- AG-UI 是 BFF 对 Web 暴露的 Agent 事件 wire protocol；BFF 使用 `@ag-ui/core` schema 校验输出帧。
- `Last-Event-ID` 是 BFF 为每个持久化 public frame 分配的 `agui_*` opaque cursor；Agent source sequence 不再是
  public resume cursor。
- BFF runtime 的 Capability generated consumer、facade 与四条 canonical route 已实现：accepted owner commit
  `7f89a267d745cbb9870f52d6edb23dec1a3c469b` 的 HTTP OpenAPI `2.0.0` 已作为 immutable vendor input 固定；
  manifest 状态为 `generated`，exact 16-file client、facade、canonical owner routes 与 generation drift gate 已激活。
  固定的 generator `0.99.0` 产物通过生成流水线内固定命中数的 `exactOptionalPropertyTypes` compatibility normalization，
  禁止 TypeScript suppression 或手改产物；drift gate 连续生成两次并验证 byte-identical。升级到原生兼容的固定 generator 版本且
  regeneration、drift、typecheck、build 全通过后删除该 normalization。
  Root `EDGE-BFF-CAPABILITY` 仍为 broken，待 W0B-5 real smoke 与 W0B-6 integration 闭环后才可标记 active；本仓实现完成
  不代表跨仓 edge 已激活。
- IAM session admission 已固定消费 IAM commit `259a66e6a569889c030734f380e99685d8b9e21c` 的完整 OpenAPI `0.2.0`，
  再由 generator scope 过滤出 `POST /internal/v1/session-authorizations/verify` 及引用 schema。manifest 固定 owner digest、
  Node `22.22.2`、pnpm `11.25.0`、generator `0.99.0`、Zod `4.5.4`、lockfile 与 16 个生成文件 digest；drift gate 做
  allowlist、两次 byte-identical generation 与 strict response normalization 检查。

### Library / Storage degraded boundary

- `GET /v1/library` 在 service-envelope admission 后固定返回 `503 storage_integration_unavailable`；未认证请求仍返回
  `403 service_auth_failed`。BFF 不调用旧 `/internal/bff/library`，也不打开 Storage 连接。
- public OpenAPI 保留 path、method、`listLibrary` operationId 与 metadata，删除不可达 200 以及孤立的
  `LibraryResponse`/`LibraryItem` schema。当前响应不是 Library success contract。
- `EDGE-BFF-STORAGE` 保持 `broken`；W2 success 与 edge activation 仍依赖以下五项：
  1. Storage default-deny caller × operation × scope；
  2. Capability scope mapping 与拒绝规则；
  3. Agent trusted Run/ExecutionIdentity scope；
  4. Library per-kind 或 BFF composite pagination。

### 当前运行时与持久化

- 普通 `/v1/*` 先校验 `web-bff` 服务身份与共享 secret，再要求唯一 Bearer 并在线调用 IAM；业务 context 的
  namespace/userId 只来自严格验证后的 IAM `tenant_id`/`user_id`。legacy identity headers 不参与身份建立。
- IAM request 无 body/query/redirect/retry/cache，受统一 5 秒与 1 MiB 上限、caller cancellation、合法 request-id 与
  `Cache-Control: no-store` 约束。401/403/429/503 使用稳定 BFF error code；Bearer 不进入日志、receipt、store 或业务 owner。
- Share 和 runtime manifest 只使用 service envelope，不要求或使用用户 Bearer；额外 Authorization header 被忽略。Scheduler
  callback 继续使用独立 Scheduler bearer。production 未配置 IAM origin 时 readiness 与普通用户请求 fail closed。
- Live Project、instruction revision、project skill、project task、ScheduledTask 与 mutation receipt 使用本仓
  PostgreSQL repository。Project 与 ScheduledTask 用户路径均以 IAM admission 的 tenant + subject 为 scope；Project slug 在 owner scope 唯一，
  子事实由父 Project predicate/lock 保护，ScheduledTask 引用 Project 在 task+outbox 事务内重验。Project Redis 列表 cache 与 invalidate 已删除；
  Redis 当前用于 readiness/ping 与 AG-UI 通知，不是业务事实源。
- Live Conversation、Message、Share 使用本仓 `bff_conversation`、`bff_message`、`bff_share` PostgreSQL repository；
  所有私有读写带 tenant + owner predicate；非空 `project_ref` 还必须匹配同 scope Project。资源 gate 在通用 receipt 与 Agent I/O 前执行，
  mutation repository/事务再次校验。删除保留 tombstone，share 撤销/过期后保留记录并只暴露 active/unexpired share。
- Chat session list/detail/message history/title/delete/share routes 不再读取 Agent history。Message create 在一个 BFF
  PostgreSQL 事务中同时写入 completed user message、pending assistant message、`bff_agent_dispatch_outbox` 与预注册的
  AG-UI expected run；HTTP 在本地事务提交后返回 `202`，后台 dispatcher 再通过窄 Agent client 投递。Agent 仍只拥有
  Run/control/source execution events。
- ScheduledTask aggregate 的 `nextRunAt`/`expiresAt` 在 application/domain 内是有效的 UTC `Date`；HTTP/JSON 与
  Scheduler command 使用 RFC 3339 UTC 字符串，`time` + IANA `timezone` 保留本地周期规则。数据库事实使用
  `TIMESTAMPTZ(3)`。
- Live mutation 仅在 BFF business store 已配置时使用 PostgreSQL receipt；没有 business store 的非 BFF owner
  mutation 仍使用进程内 Map。因此“所有 Live mutation 均持久幂等”不是当前事实。
- 当前 receipt scope 是 `namespace + actor + method + canonical path + Idempotency-Key`；fingerprint 覆盖规范化 body，
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
- ScheduledTask create/update/delete/retry 以 tenant + subject scope 先在同一 PostgreSQL 本地事务写入 task revision 与
  `bff_scheduled_task_outbox` command；事务提交后由 bounded dispatcher 在事务外调用 Scheduler。command 保留
  `tenant_id`、`actor_id`、`request_id`、`idempotency_key` 和版本化 task snapshot；稳定 task id 绑定 tenant、subject、path、key，并以 `SKIP LOCKED`、lease token、
  fence、指数退避、重试上限和 `pending/leased/retryable/succeeded/failed` 状态恢复。Scheduler dispatch receipt 仍使用
  旧 compact occurrence idempotency key；与 pinned Scheduler producer 尚未闭环。
- Chat → Agent dispatcher 使用稳定 run/message/idempotency identity、`FOR UPDATE SKIP LOCKED`、lease token/fence、
  有界 attempt 与指数退避执行 at-least-once 投递。BFF 或 Agent 重启不会丢失已接纳命令；过期 lease 可重新领取，旧
  worker 和跨 tenant settlement 都不能覆盖当前结果。明确永久失败会把 provisional assistant message 标记为 failed。
- Agent 自有 wire protocol 不在本切片改写；若其事件边界使用 epoch milliseconds，BFF 将其视为 wire encoding，AG-UI
  projection 的内部时间仍在边界解析为 UTC instant。
- 缺失 BFF store、非法请求/响应和未接写操作会返回稳定错误；ScheduledTask 在 Scheduler 缺失时仍可提交本地
  fact+outbox，外部 command 保持 retryable，不伪造 Scheduler 已成功。
- 当前 runtime 通过唯一 Capability facade 调用四个 canonical owner GET；Skills 只接受 `query,tags,scope_kind,limit,cursor`，
  MCP 只接受 `provider_key,limit,cursor`。旧路径、搜索 alias、handwritten compatibility fallback 均已删除；未知或非法
  query 在出站 I/O 前返回 400。5 秒 timeout、1 MiB response cap、单次尝试、generated success/error 校验与稳定 502/503
  映射已经由 focused test 锁定。

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
KOKORO_BFF_POSTGRES_URL='POSTGRES_URL?schema=kokoro_bff' pnpm db:apply-schema
KOKORO_TEST_POSTGRES_URL='POSTGRES_URL?schema=kokoro_bff' \
KOKORO_TEST_REDIS_URL=redis://127.0.0.1:56380/8 \
pnpm test:integration
```

未提供 PostgreSQL/Redis fixture 时，后两项状态是“未执行”，不是“通过”。验收状态见
[`ACCEPTANCE.md`](./ACCEPTANCE.md)。

## Scheduler W0B-9 BFF 实现

Scheduler manifest 状态为 `generated`，固定 owner commit
`92bf9e7e6724c591bab4b7fa27f08d694b59a67e`、version `1.0.0`、SHA-256
`6ec2f6d5d71efa60b92bba1eb2dd0c81b7439734e2bc4450caa221e952e24183`。16 个 generated 文件由
`contract:check:scheduler` 在临时目录连续生成两次，校验 exact allow-list、byte-identical 与 manifest digest。

BFF ScheduledTask outbox 已改用 generated create/replace/delete control client 与 canonical Schedule 路径、header、稳定错误码；
daily/weekly cron 从本地 wall time 与 IANA timezone 映射。dispatch receiver 先通过 generated webhook Zod 校验 exact header/body，
再校验 trusted header tenant 与 body tenant 完全一致，并使用 RFC3339Nano canonical occurrence、递归 canonical JSON semantic digest。
generated 校验只决定接纳，不用其 transform 后对象建立摘要；receipt 使用已验证的原始 parsed JSON 全部 own keys，递归拒绝非有限数字。
opaque key 不 trim，只进入独立协议 scope。control client 对 response body 逐块计数，超过 hard cap 立即 cancel/abort，不先缓冲整包。

专用 Scheduler receipt repository 复用现有 `bff_idempotency_receipt` 与连接池：digest 首次绑定后不可替换，60 秒数据库时钟 lease、
claim token CAS、不可变首授权 launch snapshot、425 active pending、409 different digest、terminal replay 与 response-unknown 恢复已实现。
claim/prepare/finalize/release 均先取得目标 row lock，再读取 `clock_timestamp()` 判断 deadline；claim/prepare 返回数据库剩余预算，
Scheduler Agent 调用以进程内 monotonic elapsed 扣除固定 settlement reserve，独立于可配置的普通 upstream timeout。
Scheduler Run identity 只依赖 trusted tenant、schedule 与 canonical occurrence；普通 Chat identity 未改变。真实 PostgreSQL integration
覆盖并发 claim、短 row-lock 等待后的完整新 lease、等待期间过期的 prepare/finalize/release fencing、tenant isolation 与 response-unknown。
真实 PostgreSQL + BFF HTTP + Agent stub integration 覆盖 Agent 接纳后 finalize 失败、关闭并重建 BFF、数据库 task 与 transport request ID
变化后按原 key 重发首次完整 snapshot/Run，以及 stale prepare 零 Agent I/O；stub 调用次数不代表真实 Agent durable Run 事实。

`EDGE-BFF-SCHEDULER` 与 `EDGE-SCHEDULER-BFF` 仍保持 broken；本仓完成只证明 BFF/PG 行为，待 W0B-10 真实 Scheduler + BFF +
Agent receipt stub smoke 与 W0B-11 Root 集成后再激活。真实 Agent admission、同 Run 参数冲突及 Agent 重启后唯一 Run 事实归
后续 Agent-owner closure（W4）；`EDGE-BFF-AGENT` 保持 broken。
