## BFF-CHAT-PAGING1：既有会话排序的分页修复（2026-10-01；源码与回归已验证）

Owner 为 BFF Conversation；复用现 PostgreSQL ChatRepository，不新增文件、目录、表、进程或契约。
当前 public canonical 是 HEAD293dfe7 的3.0.0，下方 ROLE2“待发布”属于历史阶段记录；未提交 retry 草案仍未发布。
现 listConversations 按 updated_at DESC、conversation_id ASC 排序，却用两列整体小于的 cursor 条件，导致相同毫秒漏项。
无漏项/无重复的验收限定静态可见集合；跨页更新不提供snapshot一致性。
目标仅把 continuation 条件改为 updated_at 小于位置时间，或时间相等且 conversation_id 大于位置ID；limit+1与opaque cursor保持。
采用修复现 adapter 的具名查询；淘汰新分页模块、改成ID倒序及Web过滤，因为它们改变职责或列表行为。
权限、项目存在性、tenant/subject绑定、非snapshot语义、cancel/retry/FIFO均不变。先现unit/真实PG HTTP测试RED，再源码GREEN。
验证绑定本片源码：Root自有随机临时库/现PG与Redis，固定毫秒ties、多页、末页null、过滤/删除/身份隔离；完整BFF门。

# kokoro-bff 技术设计

## BFF-CHAT-ROLE2：Message 角色声明收敛（2026-10-01；设计门，未实施）

### 当前态与目标态

当前唯一产品 Message INSERT 只产生 `user` 与 `assistant`；Agent owner contract 与 Web parser 也只有这两个角色。当前
`database/schema.sql`、domain/public TypeScript 与 canonical OpenAPI 仍额外声明 `system`，PostgreSQL row mapper 还信任
数据库字符串，因此数据库、运行时与 public contract 尚未闭合。目标 public `3.0.0` 保持 HTTP `/v1` 与 operation inventory
不变，只把 Message role 收窄为精确 `user | assistant`；不新增通知/prompt producer，不过滤、改写或伪装已有用户数据。
source publication 不等于激活 3310；当前用户数据库、旧 schema 与 rows 不作任何变更，旧三角色 CHECK 也不会被 fresh
installer 自动修复。

### 放置表

| 项 | ROLE2 结论 |
| --- | --- |
| Owner | `kokoro-bff` Chat 模块拥有 Conversation/Message public projection 与 `bff_message`，是唯一 writer；Root 负责发布编排、真实 PostgreSQL 与最终 Git。 |
| 当前事实 | 唯一 INSERT 路径只写 `user`/`assistant`；canonical SQL、`src/domain/chat/message.ts`、`src/contracts/chat.ts` 和 OpenAPI 多声明 `system`；row mapper 未独立拒绝数据库非法角色；本轮开始时四份 docs 另有未验 retry 候选，必须隔离。 |
| 目标职责 | 既有 Message 事实在 fresh schema、domain、public TypeScript 与 canonical OpenAPI 中共享精确两角色集合；公开 API 仍是现 `/v1` Chat operation，不增加 operation。 |
| 目录方案 | 采用现有 schema/domain/public contract/OpenAPI 与两项现有测试；相比新建 role 目录、通用 parser 或第二 contract，此问题只是既有声明漂移，后者会制造重复事实源和空职责。 |
| 粒度 | 后续只修改现有声明与现有测试，不新建文件、目录、模块或进程；每个文件仍承担原变化原因。 |
| 依赖 | 允许 Chat route/application → domain/public type → PostgreSQL adapter 的既有方向；禁止 Web/Agent 源码 import、第二 role 常量、generated/vendor 手改与跨 owner 数据访问。 |
| 数据/API | fresh `kokoro_bff` schema 的命名 CHECK 只接受两角色；tenant/事务/幂等/Redis/查询与 writer 不变。public 目标 `3.0.0` 同 `/v1` 是一次 pre-release corrective breaking 例外，不称兼容；正式发布后的 breaking 仍要求 `/v2`。 |
| 删除项 | 后续删除 SQL/domain/public/OpenAPI 中无 producer 的 `system` 声明；不保留 alias、fallback、过滤、`system -> assistant` 映射或 ALTER/migration 兼容链。 |
| 验证 | 先定点 OpenAPI/schema RED，再改声明 GREEN；Root 随后用同一现 PostgreSQL 实例/role、随机临时数据库和 fresh `kokoro_bff` schema 跑 apply/check，最后执行 contract、architecture、lint、typecheck、build、full test。 |

### 状态、失败恢复与阶段门

Message 本身没有新增状态；`user`/`assistant` 的既有 status、failure、run 约束保持。fresh apply 任一步失败即回滚并回收
Root 自有临时资源，不触碰当前用户 schema。已有数据库若含旧 CHECK 或历史/manual `system` rows，本片不迁移、不删除、
不查询后伪装；激活前必须由 Root 另行裁决数据生命周期。ROLE2 文档门通过后才允许现有 tests 进入 RED；真实 RED 后才允许
schema/domain/public/OpenAPI GREEN。待执行命令：`pnpm contract:check`、`pnpm test:architecture`、定点两测试、
`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test`，以及由 Root 提供随机临时库 URL 的
`pnpm db:apply-schema`/真实 PostgreSQL CHECK；当前均未作为本阶段通过证据。


## BFF-AGENT-FAILURE3：安全失败投影当前实现（2026-09-30；owner隔离集成已验，Web组合待闭环）

### 当前态、owner 与目标

本节是机器契约、Schema、测试与源码的当前实施依据；起始基线是 BFF main
`15e07fa44670bc13705ce3f6f700e73afcb72ccc`。当前实现已经删除旧 Agent HTTP 2.0 vendor 与手写七码
fallback，固定下述 Agent 3.0 owner，生成严格 failure validator，并把 Message、public snapshot、Share 与
durable AG-UI 投影接入同一安全失败事实。Root 已在隔离fixture执行真实 PostgreSQL/Redis/localhost HTTP 七文件47/47、动态Schema7/7与完整Node门；
具体冻结hash、资源回收与日志见 CURRENT。Web/真实owner/provider浏览器组合仍未验收，不能扩大该证据范围。

目标固定 Agent owner 已先发布 commit `f3be3b97dd67df69ed3c6cb88c59f3bc2db97703`、HTTP contract
`3.0.0`、OpenAPI SHA-256 `e9f0a543f74dee34212f0ea4fe366d46218268462ac54dce08e41965f34d2d2c`，
`contract/provenance.json` 文件 SHA-256 为
`d116657f65027de8bd829dc0408fd86046da0ac0a1d2934bd2a87e835c897b5f`。Agent 继续拥有失败分类；BFF
只在固定 owner `run.failed` source 的完整 `ChatFailure` 通过严格验证后，拥有并写入 Message 的安全失败快照和
durable AG-UI public projection。BFF 不保存 exception 名、message、stack、provider body 或其他 diagnostics，也不从
HTTP status、投递错误或本地异常猜一个 Agent failure。

目标 Agent `run.failed.payload_json` 必须先按 owner 的严格闭合 `ChatFailure={status:"failed",code,retryable}`
验证；验证后才丢弃 owner discriminator `status` 并投影 public safe failure。`code` 只允许
`token_budget_exceeded`、`recursion_limit_exceeded`、`assembly_failed`、`enqueue_failed`、
`dispatch_exhausted`、`contract_incompatible`、`internal_error`、`model_unavailable`、
`dependency_unavailable`、`model_access_denied`。十个 code 与 `retryable=false` 的组合全部合法；
`retryable=true` 只允许 `model_unavailable` 或 `dependency_unavailable`。缺字段、多字段、未知 code、非 boolean、
缺失/错误/null `status`、或其他八码搭配 `true` 都是完整 source page 的 contract failure，禁止 fallback。

### 失败 writer 与单一投影事务

必须保留四种当前可达的 Message `failed` writer，只有第一种携带 Agent failure：

| writer | 当前触发 | 目标 `agent_failure_code` / `agent_failure_retryable` |
| --- | --- | --- |
| verified Agent terminal | 固定 3.0 owner 的 `run.failed` | 同一 projection 事务写严格验证的二元组 |
| Agent cancellation terminal | `run.completed(status=cancelled)` | 两列都为 `NULL`；取消不是 Agent failure profile |
| BFF dispatch permanent failure | `agent-dispatch-outbox-repository.ts` 写本地 `RUN_ERROR` | 两列都为 `NULL`；BFF launch error code 不冒充 Agent code |
| Conversation delete | `chat-repository.ts` 终止 pending/streaming assistant | 两列都为 `NULL`；删除是产品生命周期动作 |

`agent-cancellation-outbox` 自身的 `failed` 是取消命令投递状态，不写 Message；不得把它映射成 Message failure。
所有 user/system、非 `failed` Message、assistant 无 `run_id`、以及上述三个非 Agent failure writer 的两列必须同时为
`NULL`。不建立独立 failure 表：安全失败与 assistant Message 同生命周期、同 ACL、同删除/保留策略，拆表会制造第二
真源与额外一致性窗口。

`AgUiAssistantUpdate` 的目标 union 必须在类型层判别来源：verified `run.failed` 使用
`{kind:"fail",failure:<完整已验证 safe profile>}`，cancel 使用独立 `{kind:"cancel"}`；不得保留
`{kind:"fail",failure?:...}` 这种 optional profile，让同一分支猜来源。projection SQL 的
`fail` 分支写 `failed` 加二元组，`cancel` 分支只写 `failed` 并显式保持两列 `NULL`；dispatch/delete 的直接
writer 同样保持 `NULL`。

内部投影表示也只有一个安全事实：`mapAgentEvent` 对 verified `run.failed` 生成的 `ChatEvent.payload.failure` 承载
`{source:"agent",code,retryable}`，可同时保留固定安全 message；`projectChatEvent` 的顶层 `code` 必须从
`payload.failure.code` 导出，`metadata.kokoro.failure` 复用同一已验证值，`projectSources` 再把同一对象放入
`{kind:"fail",failure}`。不得继续把旧 `payload.code` allowlist/fallback 当第二判据，也不得在各层复制两套 code
来源；这是 BFF 内部投影表示，不是新增网络协议。

verified `run.failed` 沿现有 `PostgresAgUiProjectionRepository.commitProjection()` 的唯一事务写入：先持有
`bff_agui_stream` row lock 并校验 version/consumer lease，再登记 Agent source identity/digest，更新由本仓
outbox 绑定的 assistant Message 的正文/status/failure，写所有 AG-UI frames，最后推进 projection state、run marker
与 source high-watermark；任一步失败全部回滚。tenant/session/expected run/consumer subject、active Conversation owner、
dispatch assistant ID、Message run/role/mutable status 的现有 predicate 不放宽。旧 run、failed dispatch、deleted
Conversation、错误 subject 或无绑定 source 不得写 failure。

Agent HTTP source reader 必须先以固定 owner OpenAPI 验证整个 `ReplayPageEnvelope`，再对页内每个 `run.failed`
的 `payload_json` 使用由 owner `ChatFailure` schema 派生的严格 validator；整页所有 event 都验证并映射成功后才调用
`ingest()`。任一 event 的完整 failure shape 非法时，本页 source identity、Message、frame、stream version 与 watermark
保持零写，runner 以现有 `source_contract_invalid` 只 block 该 `(tenant,session,subject)` consumer；同 cycle 的其他
consumer 独立继续。禁止逐 event 边验证边提交、跳过坏 event、把 unknown 降为 `internal_error`，或推进到坏页之后。

### public snapshot、Share 与实时 AG-UI

public safe shape 唯一为：

```json
{ "source": "agent", "code": "model_unavailable", "retryable": true }
```

target `ChatMessage.failure` 是 optional 且 closed；存在时必须同时满足 `role=assistant`、`status=failed`、`run_id`
非空。canonical OpenAPI 必须用 `if: {required: [failure]}` 才进入 then，并在 then 固定 assistant/failed、
`required:[run_id]` 与 `run_id.minLength:1`；不能只写 `if.properties`，也不写反向 else，所以 cancel/dispatch/delete
形成的 assistant+failed+run 不被强制带 failure。mutation tests 必须分别删除 presence required、role/status guard、run
required/minLength 并 RED。`GET /v1/sessions/{id}` 与 `GET /v1/sessions/{id}/messages` 都从 Message 两列映射同一 shape；snapshot
继续在 ACL 成功后的单连接 `REPEATABLE READ READ ONLY` 事务中读取 Conversation、Message、Delivery、AG-UI
watermark/active-run，因而 failure、正文、status 与 watermark 属于同一 committed snapshot。分页 Message query 继续用
tenant/subject/active Conversation/Project predicate。service-only Share 只有 active、未撤销、未过期且绑定同
tenant/conversation 的 capability 才可读取 Message，并明确投影同一 safe shape；Share 不返回 raw Agent payload，
不因知道 Message/run ID 获得访问资格。

AG-UI ledger GC 只回收旧 `bff_agui_event` frame 并写 cursor tombstone，不清除或从 ledger 重建
`bff_message.agent_failure_*`；因此刷新、Message list 和合法 Share 在旧 `RUN_ERROR` frame 被 GC 后仍返回 failure。
Conversation 删除仍使私有读与 Share 读不可达并撤销 active Share；保留的 Message row/failure 只服从既有
Message retention，不引入新索引、缓存或 Redis truth。

实时事件继续只使用标准 AG-UI `RUN_ERROR`，不增加 `CUSTOM`、第二 stream 或 legacy envelope。verified Agent
failure 的 `RUN_ERROR.code` 等于 safe failure `code`，`message` 使用 BFF 固定安全文本 `Agent run failed`，并在现有
`metadata.kokoro` 下增加 `failure`，其 shape 与 `ChatMessage.failure` 完全相同；不复制 raw owner payload 或
diagnostics。dispatch failure 的既有 BFF-owned `RUN_ERROR` 保持独立：不加 `metadata.kokoro.failure`，其本地 code
也不进入 Message failure。当前 `@ag-ui/core 0.0.59` 的 `BaseEvent.metadata` 与 `EventSchemas` 可承载该 metadata；
仍必须由 runtime schema test 锁定，不以类型断言替代验证。

### 来源生成、放置与删除

Agent 3.0 完整 OpenAPI 只读 vendored 到
`contract/vendor/kokoro-agent/f3be3b97dd67df69ed3c6cb88c59f3bc2db97703/openapi.json`，同一目录还必须保存
owner 已发布的只读 `provenance.json`。后者完整文件 SHA-256 固定为
`d116657f65027de8bd829dc0408fd86046da0ac0a1d2934bd2a87e835c897b5f`；manifest/generator 必须解析并断言
`http_contract.version=3.0.0`、`http_contract.path=contract/openapi/v1/openapi.json`、
`http_contract.sha256=e9f0a543f74dee34212f0ea4fe366d46218268462ac54dce08e41965f34d2d2c`，以及 failure generated
artifact 的 `source_sha256` 同为该 OpenAPI SHA，不以人工审查文字代替 published provenance。固定 commit 目录只允许
这两份 owner bytes。更新现有
`openapi-ts.agent.config.ts`、`scripts/generate-agent-http-client.mjs` 与
`contract/dependencies/agent-http.json`；同一 generator 除现有 `@hey-api/openapi-ts` 输出外，从 owner
`#/components/schemas/ChatFailure` 确定性派生单个只读
`src/generated/agent-http/failure-profile.gen.ts`。该文件是 infrastructure Agent client 的 runtime validator，
不由 domain/HTTP route 直接 import；generator 必须把它加入完整文件 allowlist、manifest digest、双次 byte-identical
生成和 committed drift 比对。generator 还必须结构化断言 owner `Failure.required=[code,retryable]`、true→两码的
`if/then`、`ChatFailure` 对 `Failure` 的引用、`status` 的 required+const `failed` 与
`unevaluatedProperties:false`；任一结构 mutant 必须令生成失败。禁止在 `projection.ts` 重写十码 Set，禁止把
`orphans:true` 拉入全部 owner schema，也禁止手改 generated 文件。

删除旧 HTTP 2.0 vendor
`contract/vendor/kokoro-agent/dd34a4800b4ce0cc61eb80dd715e528b9d4517da/openapi.json` 及 manifest/config 中
对应 consumer pin，不保留双轨或 fallback。独立 delivery event-protocol pin
`contract/vendor/kokoro-agent/486adb1539dd8a06ca90684e66f91be031aa70cf/src/kokoro_agent/protocol/events.py`
及其 aggregate `cae30a40d712bce39ef33ef2dc857af4f5b69c6afd1956fda065ec77379ae02e` 保持原字节；HTTP
3.0 repin 不得误删或改写该独立来源。

### 实施阶段记录（已完成）：两阶段允许集与 RED 验证

本阶段记录原文保留当时的授写与RED/GREEN顺序，不是当前待实施状态；最终Root门与证据以CURRENT顶部为准。

Root/独立审查放行后的**第二门只授权既有 tests 写稳定 RED**；canonical OpenAPI、Schema、vendor、manifest、
generator、generated 与 runtime 全部保持 15e bytes。精确允许集只有：`test/agent-http-wire.test.mjs`、
`test/agui-source-page.test.mjs`、
  `test/agui.test.ts`、`test/agui-projector.test.mjs`、`test/chat-service.test.ts`、
  `test/contract/openapi-contract.test.mjs`、`test/contract-governance.test.mjs`、
  `test/schema-governance.test.mjs`、`test/chat-facts.integration.mjs`、
  `test/agui-projection.integration.mjs`、`test/agui-http.integration.mjs`、`test/architecture.test.ts`。

RED 必须来自对当前行为/contract/Schema bytes 的真实断言失败：mapAgentEvent strict failure 负例、当前 RUN_ERROR 缺
safe metadata、public version/field/presence guard 目标、canonical 两列/CHECK 目标等；测试不得 import 尚不存在的
`failure-profile.gen.ts`，不得以 missing-module/编译错误代替 RED。数据库 integration test 同时写出 partial NULL
两方向的直接 insert 案例，但 tests-only RED 期间 canonical 仍无列；Root 先以字段/constraint 预期的稳定断言确认 RED，
GREEN 后才以真实 PostgreSQL 证明两个 insert 都被 CHECK 拒绝。

Root 接受 tests-only RED 后，**同一单 owner GREEN 才一次授权完整目标并在一个切片删除旧来源**：

- machine/docs/Schema：`contract/openapi/v1/openapi.yaml`、`contract/README.md`、
  `contract/vendor/kokoro-agent/dd34a4800b4ce0cc61eb80dd715e528b9d4517da/openapi.json`（删除）、
  `contract/vendor/kokoro-agent/f3be3b97dd67df69ed3c6cb88c59f3bc2db97703/{openapi.json,provenance.json}`（新增）、
  `contract/dependencies/agent-http.json`、`database/schema.sql`；`contract/README.md` 同步 public 2.0、Agent 3.0、
  provenance 与 breaking `/v1` 结论；

- generator/generated：`openapi-ts.agent.config.ts`、`scripts/generate-agent-http-client.mjs`、
  `src/generated/agent-http/**`；
- strict client/projection runtime：`src/infrastructure/clients/agent/http-wire.ts`、
  `src/infrastructure/clients/agent/projection.ts`、`src/infrastructure/clients/agent/projector-source.ts`、
  `src/application/agui/project-chat-event.ts`、`src/application/agui/project-session-events.ts`、
  `src/application/agui/ports/agui-projection-repository.ts`、
  `src/infrastructure/postgres/agui-projection-repository.ts`；
- Message/read/Share runtime：`src/domain/chat/message.ts`、`src/contracts/chat.ts`、
  `src/application/ports/chat-repository.ts`、`src/application/chat/mappers.ts`、
  `src/application/chat-service.ts`、`src/infrastructure/postgres/chat-repository-mappers.ts`、
  `src/infrastructure/postgres/chat-repository.ts`、`src/infrastructure/postgres/public-share-repository.ts`、
  `src/bootstrap/server.ts`；
- local failure writers：`src/application/agui/agent-dispatch-failure.ts`、
  `src/infrastructure/postgres/agent-dispatch-outbox-repository.ts`、
  `src/infrastructure/postgres/chat-repository.ts`。

GREEN 继续拥有并修正上述 tests；禁止提交/发布过渡态的旧新双轨 vendor、虚假 generated manifest 或只有 machine
没有 runtime 的半套组合。

若实施证明需要此清单外文件，先回报 Root 调整任务卡，不自行扩写。tests-only 稳定 RED 必须以当前 mapper/frame/
canonical bytes 覆盖 10 code × false、2 code × true 的目标接受断言，以及其余 8 code × true、unknown、缺字段、extra、
非 boolean、owner `status` 缺失/错误/null 的目标拒绝断言；还要覆盖 public version/field/presence guard、坏 event 页首/中/末
零写、RUN_ERROR safe metadata 和 canonical 两列/CHECK 预期。GREEN 最终验收在此基础上补齐 owner schema
required/if-then/ref/status/unevaluated 结构 mutants，并通过真实 generator helper 证明每个 mutant 令生成失败，而非靠
missing import。完整 RED→GREEN 矩阵要求坏 event 位于页首/中/末时
全页零写且只 block 对应 consumer；数据库 CHECK 的两 NULL/两非 NULL、角色/status/run/tuple 全矩阵；verified
failure 与 source/frame/watermark/Message 同事务回滚；snapshot RR barrier、Message list ACL、Share capability、GC 后保留；
cancel/dispatch/delete 与所有非 Agent failure 保持两列 NULL；实时与 snapshot 的 code/retryable/source 完全一致且无
raw diagnostics。`EventSchemas.parse()` 的 metadata passthrough 本身不是安全证明：测试必须断言最终持久化/序列化
`RUN_ERROR` 没有顶层 `retryable`，`metadata.kokoro.failure` 恰有 `source/code/retryable` 三键且无 owner `status`、raw
字段或 extra，code 与顶层 code 同值、message 等于固定 `Agent run failed`；删除任一上述 guard 的 mutant 必须 RED。

所有后继命令必须显式使用 `PATH=/Users/nako/.nvm/versions/node/v22.22.2/bin:$PATH`（非 login shell 或命令内
`export`）并先记录 `node --version`=`v22.22.2`；当前默认 shell 的 Node 24/engine warning 不构成 Node 22 证据。
预定验证命令为 `pnpm contract:check:agent`（两次确定生成）、`pnpm contract:check`、
`pnpm schema:check`、`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test:architecture`、
`pnpm test`、`pnpm build`，并在 Root 提供的 owner-scoped fixture 上执行 canonical fresh install、全部 7 个真实
PostgreSQL/Redis/localhost HTTP integration 文件及 rollback/RR/GC/ACL/Share 定向矩阵。初始docs-only时点没有执行这些门；
现Root已完成该源码切片完整门与隔离七文件47/47，实际日志见CURRENT。Web与真实owner/provider组合仍未验。

### 仍需后续 owner 闭环的边界

- public `info.version` 从 `1.0.0` 升为 `2.0.0` 是协调 breaking repin，但 HTTP namespace 仍为 `/v1`；Web 必须在
  BFF 发布后固定新 commit/digest，并把 snapshot/实时 failure 当一组事实，不能先放宽 schema。
- `ChatRun` 仍只服务 `active_run`；本片不从 terminal Message 合成 `active_run=failed`，不删除其现有其他声明状态，
  也不借 failure profile 补 queued/waiting/pending/files。
- Message/failure 的实际 retention、Share 产品披露确认、Web reload/断线/GC 后展示与真实 Agent 3.0 组合均要在后继
  实施及 Root 验收中给出实际证据；本片已执行隔离fixture上的localhost HTTP测试，但未启动真实owner/provider组合或重启3310。

## BFF-PERSONAL-DOC-GATE：本人 Skill 安装（2026-09-30；消费者实现中，真实组合待验）

**Owner、当前事实与目标职责。** Platform `skills/installation` 是安装、启用状态、命令 receipt 与事件的唯一 writer；BFF 只拥有 public Product HTTP 投影。当前在途消费者代码已唯一固定 Platform `6519ae9a7dba63586474d2860f6725d3165b701e` v5.0.1 aggregate `3f97b3c98fd8e7ce46e4a8ea73237ddb85e764849d2b15dd28d0a3a58a69e42f`，生成并接线 `ProductSkillInstallationService` 五方法，在唯一 public `/v1/skill-installations` surface 提供 POST+GET、`/{installation_id}` GET+DELETE 与 `/{installation_id}/enabled` PUT；旧按名称 enable/disable 路径、v4 vendor 与 fallback 已删除。Publish 只令 Skill ACTIVE，**不自动安装或启用**；安装是用户随后发起的显式命令。该代码尚待 Root 提交和真实 IAM→BFF→Platform 组合验收，产品仍未激活。

**放置与粒度。** 方案 A（采用）沿既有 `src/http/routes/` 的 Skills route、`src/infrastructure/clients/platform/` Connect adapter/projector、`src/generated/platform-connect/` 生成物与 `src/bootstrap/server.ts` 精确分派扩展，不新建一级 module；安装资源与 catalog/package 同属 Platform Skills 的 BFF projection，但以具名输入、route 和 projector 文件隔开不同变化原因。方案 B（淘汰）在 BFF 新建 installation domain/repository/table/receipt，重复 Platform owner 并制造双写。方案 C（淘汰）复用旧按 name 的 503 stub、旧 Capability facade 或做 v4/v5 fallback，会丢 canonical `installation_id`、掩盖权限语义并违反 clean-slate。当前代码片已原子替换 v4 vendor/provenance/generated 与旧安装 stub/路径，并删除旧 alias、按 name 操作和 fallback；未保留双 client。

**依赖、身份与状态。** Browser 仍经 Web same-origin adapter；BFF 每次先做 current IAM session admission，从受信结果取得 tenant/user，再以固定 BFF workload 调 Platform，并只在 RPC metadata 发送精确 `x-kokoro-subject=<current user>`；tenant/subject/target owner 不来自 public body/header，BFF 不伪造 Run 或 execution proof。Platform 从 subject 派生 PERSONAL user target，organization/project/session/global/shared 均保持关闭。POST 只接原样 canonical `source_ref`；后续读取、启停和删除只接 canonical `installation_id`，不 trim、不按 name/series 猜测。ACTIVE read 与安装/执行授权分离；install 与 true-enable 每次和 receipt replay 均由 owner fresh 检查本人 source、validated package、CLEAN/health 与 generation，disable/remove 可在 source/package 不健康时收敛权限。状态安全投影精确为九个 snake_case 字段：`installation_id`、`source_ref`、`series_id`、`revision`、`installed`、`enabled`、`installed_at`、`updated_at`、`removed_at`；`revision` 按正 uint64 十进制字符串、三个时间按 UTC RFC3339 `Z` 映射，presence 原样保留，禁止 JSON number 精度损失或填造 null/default。owner 没有 `removed` 字段；移除态只能由 `installed=false`、`enabled=false`、`removed_at` present 表达。

**命令、事务与恢复。** POST、PUT、DELETE 使用单个 Idempotency-Key；BFF 从 operation、受信 tenant/user、canonical source/installation、enabled presence/value 与 key 稳定产生 owner command identity，并严格按 `product-personal-installation/1.0.0` 的三份独立 command digest/profile/vector 投影。BFF 不建立 receipt、安装事务、outbox、SQL 或 Redis cache；Platform receipt/CAS/outbox 是唯一 durable 事实。所有写成功为 200，精确 envelope 为 `{data:{installation:<九字段>,change:'installed'|'upgraded'|'reinstalled'|'enabled'|'disabled'|'removed'|'unchanged',event_id?:string,replayed:boolean}}`。owner enum 1..7 逐项映射上述小写值，0/未知值拒绝为 502；`change='unchanged'` 时 `event_id` 必须缺失，其他 change 必须带首个合法 `event_id`。同键重放保留原 ACK 的 installation/change/event_id，只把 `replayed` 置为 true，而非重算当前表示；每个 replay 出口仍先做 current IAM/Platform authorization。DELETE 的首次有效移除为 change `removed`，自然 no-op 为 `unchanged`；两者 installation 均须 `installed=false`、`enabled=false`、`removed_at` present，不会用 204 隐去 owner receipt 或发明 `removed` 字段。未知 ACK 用相同 key 重试；异输入冲突，取消/deadline 贯穿 IAM、token 与 Connect，不把 caller 取消当 owner 未提交证明。GET/List 无 receipt；GET 精确为 `{data:<九字段 installation>}`。List 遵循现有 BFF list 规范，精确为 `{data:[<九字段 installation>],meta?:{next_cursor:string}}`：owner `PageResult.next_cursor` 是 optional string，只有 present 且非空时才出现 public `meta.next_cursor`，absent 表示无下一页；present 空串或其他非法 presence 拒绝为 502。List 默认 50、范围 1..100、cursor 最多 4096 bytes，optional `enabled`/`installed` 的缺失与显式 false 分离，cursor 原样传递且绑定 subject/target/filter presence/order，不 trim、不解码、不宣称快照隔离。

**实现与验收状态。** 当前代码片已固定 v5.0.1 owner bytes/provenance/aggregate、删除 v4 installation 消费路径，并同步 canonical OpenAPI、具名运行 adapter、generated client 与测试；database schema 和 lockfile 不变。后续只剩 Root 审查/提交、Web 消费与真实 IAM→BFF→Platform 组合。门禁覆盖 SDK 双生成/来源漂移、三 digest 向量、九字段泄漏负例、uint64/UTC/presence、本人/跨用户/撤权、首次/replay/冲突/unknown ACK、删除/禁用降权、分页/cursor、timeout/AbortSignal 与旧 503/alias 不可达。正式激活还需 `pnpm format:check && pnpm lint && pnpm typecheck && pnpm contract:check && pnpm test:architecture && pnpm test && pnpm build`、真实 owner integration 与 Root smoke；当前本仓静态与隔离 HTTP 门已执行，产品激活仍以真实组合为准。


## W3 Chat→Agent typed Skill 选择（已实现消费者，组合待验）

**Owner/当前态。** BFF 唯一拥有 public `createMessage` 的用户选择与 `bff_agent_dispatch_outbox` 的不可变 Chat 投递；Agent 唯一拥有 Run 入站/执行，Platform 唯一拥有 Skill 安装与当前授权。public 现已删除名称 `pinned_skills`，仅接受 exact `selected_skill_source_refs`；普通 Chat durable outbox 和 Scheduler launch 正文均显式传递选择，无选择为 `[]`。Agent HTTP consumer 固定 2.0.0 owner `dd34a4800b4ce0cc61eb80dd715e528b9d4517da`，唯一 `contract/openapi/v1/openapi.json` SHA-256 `20398c59f42031c1b6ae2e2c3708e63ec8b5645baf741bf831bc67e14625ef99`；vendor/生成物均由本仓工具校验。Web 旧 name 消费仍待其 owner 更新。

**位置与依赖。** 采用扩展既有 `src/application/chat/message-create-input.ts`、`src/domain/chat/agent-dispatch.ts`、`src/application/chat-turn-service.ts`、`src/infrastructure/postgres/agent-dispatch-outbox-repository.ts` 与 `src/infrastructure/clients/agent/{outbox-delivery,launch}.ts` 及现有 Scheduler receipt parser；新增 `src/domain/chat/skill-source-selection.ts` 作为唯一业务值校验，供 public/durable parser 复用；唯一 public OpenAPI 在本仓 `contract/openapi/v1/openapi.yaml`，本仓 consumer 已从固定 Agent owner OpenAPI 重新生成；无生产调用的 `buildAgentLaunch` 已删除，仅保留 Scheduler builder。否决新 Skill 选择表/跨 owner SQL、按 name 查询 Platform 后补 ref、把 Web 偏好或 Agent `trace` 当执行事实。普通 Chat 的缺失 public 选择规范化为有序空数组，**每条** Agent launch（含 Scheduler 的无选择 Run）正文显式发送 `selected_skill_source_refs: []`；非空仅接精确 `skill:<SkillId>`，最多 16、JSON 编码最多 4 KiB、禁止重复，保留用户顺序。`tenant/actor/subject` 继续由当前 IAM 与受信调用上下文提供，body 不自报；BFF 不预判 Platform 当前安装/启用状态，执行时由 Agent→Platform fresh 授权。

**事务/恢复。** 用户选择作为同一 Chat turn 的请求摘要和版本化 outbox JSONB launch 一起原子持久化，`run_id` 仍由原幂等身份决定；同键同内容同顺序重放原 202 receipt，改变 ref、顺序或其他输入为 409，worker claim/重试/进程重启只发送已持久化的完全相同 launch，不按此时页面偏好重建。切片同时删除 public/trace/name 的旧 `pinned_skills` 消费与解析，不设 alias/fallback；更新 dispatch payload schema version，旧开发 fixture 重建而非默默解释旧行。Scheduler 首次 snapshot 也冻结显式空数组，恢复重发原 snapshot。Chat payload `schema_version` 从 1 改为 2；Scheduler receipt envelope 同样从 1 改为 2，并在 `parseSnapshot` 校验 launch 的显式空数组，旧 snapshot 不在恢复时补字段。SQL 仍用本仓现有 `payload JSONB` 与 `bff_idempotency_receipt.response_body` 内的 Scheduler snapshot，不新增列/表。旧版本以确定错误停止投递；只重建本任务自有开发 fixture，不删除共享开发数据。先 Agent owner 机器来源正式提交，再 BFF 文档/API/生成 pin 与代码、Web exact ref 消费分别由各 owner 闭环；当前 Agent 的非空选择明确报 `typed skill source reader unavailable`；本片只闭环无 Skill 的基础 Chat/Scheduler wire，非空选择只是严格持久传输，不宣称可执行。Platform v4 激活与真实 Skill 执行另门。发布后**不自动安装或启用**；用户须显式创建本人 installation。该裁决不阻止基础 Chat/Scheduler wire，也不把 ACTIVE read 当成可执行。

## 当前 Platform HTTP 3.1.0 读投影

放置沿既有 `src/http/routes/owner.ts` 精确分派到 `platform-projection.ts`，后者校验五个 GET 路径/查询/无 body 与幂等键；`src/infrastructure/clients/platform/projection-http.ts` 为唯一 owner wire adapter，固定 generated HTTP contract、1 MiB 响应上限、请求 deadline/取消和响应 envelope 验证。IAM 当前 Product session 是 tenant/user authority；独立 `platform:projection.read` workload token 不转发浏览器 Bearer，读路径不复用默认关闭的 v4 catalog write candidate。旧 Capability HTTP 2.0.0 facade/vendor/generated/manifest 已删除，无双读 fallback。BFF 不拥有 Skill/MCP SQL、receipt、Redis cache，Platform 仍为唯一事实 writer。替代位置“BFF 自建 Skill 表”和“复用 v4 catalog Connect 作 read projection”均因 owner 重复/契约边界不同而淘汰。以下 preflight 为历史切片，不再表示当前运行态。


## 历史快照：Published personal Skill by ID preflight（已由上文替代）

**当前态。** 活跃 Skills/Pool/Catalog 与 MCP 读取仍经旧 Capability facade；`listSkills` 输出 legacy `{data,meta}` 并丢失 owner `source_ref/revision`。新 `GET /v1/skills/{skill_id}` 目前只有 BFF canonical public OpenAPI 与语义门，没有运行 route、Platform HTTP client、projection credential 或 Web caller。

**目标态。** Browser 仍只走 Web same-origin adapter；BFF 每次先做 IAM Product session admission，以可信 tenant/user 调 Platform HTTP 3.1.0 `getPublishedPersonalSkill`。Platform 是 Skill 唯一事实 owner，只允许该 user 的 PERSONAL/ACTIVE 当前行且不要求安装；其他 tenant/owner/scope/state 与缺失同一 404。BFF 只投影七个安全字段，不存 Skill SQL、receipt、cache，不转发 user Bearer，不返回 package、manifest、Asset、签名 URL 或执行字段。

放置采用扩展现有 public Skills surface 与 canonical OpenAPI，否决新增 BFF Skill 数据模块或复用写侧 inactive v4 Connect：前者复制 owner 事实，后者不是 read projection contract。下一运行切片必须原子迁移旧四 GET 到 Platform HTTP 3.1.0、专用 workload Bearer，并删除 Capability secret/source selector/generated 双轨；个人 ACTIVE list 使用 `scope_kind=personal`，pool/catalog 不恢复 ACK。MCP 采用 owner-native 六字段并同步 Web、移除当前实际 503 的旧控件；不保留旧伪造字段兼容层。


## W3 Publish 运行候选：当前态与目标态（2026-09-29；默认关闭）

**当前态。** 固定 Platform `263a28f` inactive v4/3.0.0 的 BFF Publish 已在既有 Skills candidate flag 下由 `src/bootstrap/server.ts` 精确分派到具名 `src/http/routes/publish-skill.ts`；`src/http/publish-skill-input.ts` 仅负责稳定命令身份，`src/infrastructure/clients/platform/publish-skill-projector.ts` 负责唯一 v4 8 向量 JCS 投影，`catalog-connect.ts` 以独立 workload token 调 generated Publish。零字节体、单键、当次 IAM/可信 user+tenant、固定 PERSONAL(1)、严格 owner ACTIVE/event/revision/source_ref 检查在每次重放上执行。Platform 独有 package/validated/Storage CLEAN/CAS/receipt/outbox；BFF 不建 SQL/receipt/Storage RPC，也不经旧 Capability。HTTP/contract 静态门后仍待 Root 真 owner 组合与正式激活；下节保留文档门当时无路由事实。

## W3 Publish 文档门：当前态与目标态（2026-09-29；仅未激活机器候选）

**当前态。** BFF clean `main 1264607` 已有默认关闭的 CreateDraft/Get/Begin/Complete/Validate 运行候选，固定 Platform owner `263a28f` inactive v4 Proto/artifact；唯一 public OpenAPI 尚无 Publish，BFF 没有 Publish route/projector/Connect adapter，旧 Capability `/hub` 不承接新包发布。owner v4 Proto 的 Publish request 含 SkillId、visibility tag 4、ProductCatalogContext tag 5；本片只新增 BFF 文档/唯一 OpenAPI/operation-scoped checker/直接契约测试，不改 `src/`、生成物或 SQL。

**目标与依赖。** 未来 user-only `POST /v1/skills/{skill_id}/publish` 使用单个 Idempotency-Key 与**严格零长度请求体**：`{}`、`null`、空白和任何 visibility/asset/manifest/tenant/owner 自报均非法。BFF 在当次 IAM session/fixed tenant/user 后才以 catalog workload token 调 Platform，固定 `visibility=SKILL_SCOPE_KIND_PERSONAL(1)`，不提供浏览器选择；权限 `product.skill.publish`。稳定 command ID 绑定 operation+受信 tenant/user/skill/key，owner v4 artifact 内 digest version `3.0.0` 的 8 条 JCS 向量绑定 typed SkillId、Product user/user context、visibility=1，排除 request ID/command identity。运行片沿既有 `src/http/routes/`、`src/http/` 输入、`src/infrastructure/clients/platform/` projector/固定 generated Connect 与 `src/bootstrap/server.ts` 精确 dispatch，不复用旧 Capability/通用 BFF receipt，不建新模块。

**状态、事务与恢复。** Platform 独有 current owner/draft/validated package、fresh Storage CLEAN/对象健康判定、短 Serializable CAS draft→active、持久 command receipt 与唯一 `skill.published` outbox；BFF 不写 Skill/Upload SQL/Redis/receipt/outbox，也不代理 ZIP。首次/同键 replay/未知 ACK 都须先新鲜 IAM 与 Platform 当前事实；同键健康 replay 返回原 event_id，不同新命令对 active 拒绝，撤权或包身份/安全变化 fail closed。成功 200 仅 `source_ref=skill:<skill_id>`、正 uint64 十进制 revision、`status=active`、UUID event_id、replayed，不把 validated 当 active，也不公开 Asset/签名/manifest。Owner typed state/scan/visibility/snapshot 前置失败映射 412，命令 identity/in-progress 409；未知依赖 503、无效 owner response 502，按稳定 Connect code/metadata 而非 message。请求取消/deadline 传下游，无分页；公开 breaking 变化需 BFF 唯一 OpenAPI 与消费者固定版本同步评审。本片不激活 public，真 IAM/Storage/事件重放组合、Web Chromium 与产品发布另门。

## W3 Validate runtime 当前候选（2026-09-29；默认关闭）

在 owner `263a28f` inactive v4 精确 pin 下，具名 Validate route 沿现有 `src/http/routes/` 接入 `server.ts` IAM 后精确分派，复用同一 loopback 默认关闭 Skill catalog flag；`src/http/validate-skill-draft-input.ts` 校验唯一不受信 `attempt_id`/单键并生成绑定 operation+可信 tenant/user/skill/key 的稳定命令 ID，`src/infrastructure/clients/platform/validate-skill-draft-projector.ts` 按固定 3.0.0 JCS/8 owner 向量生成 digest，既有 `CatalogConnectClient` 用 generated v4 Proto 调用。每次 replay 先 IAM/current owner，BFF 不查 Platform/Storage SQL、不代理 ZIP、不存 receipt/状态或借旧 Capability 回退。owner 独有 current attempt、Storage CLEAN/ZIP V1/manifest 判定与 command receipt；BFF 只严格核 skill/series/valid=true/lowercase digest/ZIP manifest/replayed，再投影 200。上游前置失败 412、坏响应 502、未知 ACK 同键重新准入；取消传至 owner。此为本仓运行候选，不等于真 owner 组合、Web 或 public activation；下节是文档门当时基线。

## W3 Validate 文档门：当前态与目标态（2026-09-29；仅未激活机器候选）

**当前态。** BFF main `1aee402` 已有默认关闭的 CreateDraft/Get/Begin/Complete 运行候选与 owner `263a28f` inactive v4 精确 pin，尚无 public Validate route、Connect adapter 或浏览器正式入口。Platform v4 Proto `ValidateSkillDraftRequest.attempt_id=7`、3.0.0 command schema 与 8 条投影向量是机器事实；本仓旧“Validate 无 body”目标不再适用。本片只改唯一 OpenAPI、operation inventory/semantic gate、直接 contract test 与三面文档；不改运行代码、生成物、Proto 或 SQL。

**目标与依赖。** public `POST /v1/skills/{skill_id}/validate` 仅接本人 user-owned draft，strict body 只有当前 `attempt_id`（非空 owner typed ID），它是未受信 current-attempt selector，不能取代 Platform 当前 Skill/attempt/owner 校验；不接受浏览器 asset/hash/size/manifest、tenant/owner/subject。每次含同键 replay 先 BFF current IAM session/fixed tenant/user，再以 catalog workload token 调 owner `ValidateSkillDraft`。命令 ID 绑定 operation+受信 tenant/user/skill+单个 Idempotency-Key；digest 使用 owner v4 artifact 内 `command_digest_version=3.0.0`、JCS 与 8 条正反向量，绑定 typed Skill ID、Product context 与 attempt_id，排除 request ID/command identity。不用旧 Capability、通用 BFF receipt、Storage RPC/跨 owner SQL；未来运行片沿既有 `src/http/routes/`、`src/http/`、`src/infrastructure/clients/platform/` 的具名文件和 `src/bootstrap/server.ts` 精确 dispatch，不造兼容 alias。

**状态、事务与恢复。** owner 唯一拥有包 attempt/CAS、Validate receipt、Storage fresh CLEAN/对象健康和 ZIP V1/manifest 校验；Complete 的 `uploaded` 或 scan CLEAN 不是 validated。旧/错 attempt、未完成/感染/待扫、坏 ZIP/manifest、错 owner 或非 draft 均 fail closed；unknown ACK 使用同键、每次 IAM 后交 owner receipt 恢复，异 body/身份冲突不从 BFF 缓存重放。成功 200 strict `{data:{skill_id,series_id,valid:true,content_digest,manifest_identity,replayed}}`，只是 validated，不是 published；无 asset/URL/内部 reason。无 BFF Skill/Upload SQL、Redis、receipt、签名缓存或新事务。Root 真 IAM→Platform→Storage/ZIP、Publish 和 Web Chromium/产品激活另门。

## W3 Complete runtime 当前候选（2026-09-29；默认关闭）

BFF 已沿既有 Skills 控制面新增具名 Complete route、strict 四字段输入、独立 owner v4 command digest `3.0.0` JCS projector 和 generated Connect 调用；同一 `KOKORO_SKILL_DRAFT_CANDIDATE_ENABLED` 默认关闭开关，且 Complete 不依赖 Begin 的 ObjectStore origin 配置。`server.ts` 精确 `/complete` 分派在旧 Capability 前，当次 IAM/fixed tenant/user 先于 Platform；单键 command ID 绑定 operation+可信 tenant/user/skill/key，digest 绑定四字段与 Product context，每次 replay 再验 IAM/owner。内部 owner response 核 skill/attempt/upload/hash 与请求、正 uint64 epoch、非空合法 asset_id、UPLOADED 和 CLEAN/PENDING/UNKNOWN，才投影不含 asset_id 的 200；不按上游 message 猜感染/旧 attempt，而以 FailedPrecondition 412。无 BFF Skill SQL/receipt/Storage RPC/字节代理，取消传至 owner。此为默认关闭的运行候选、非 public activation；Root 真 IAM/Storage Complete 与 Web Chromium/CORS/PUT 尚待独立验。

## W3 Complete 文档门：当前态与目标态（2026-09-29；未激活）

**当前态。** BFF main `571108b` 已有默认关闭的 CreateDraft、Get、Begin 运行候选，并精确 pin Platform owner `263a28f` inactive v4。Root 已在隔离真 owner 组合验证 Begin、签名直 PUT、重放/冲突/替换、撤权及旧 Validate/Publish 回归；BFF 仍没有 public Complete route，浏览器 CORS/PUT 和产品激活尚未验。本片只新增唯一 OpenAPI/三面文档的 Complete 候选，不修改运行时、配置、Proto、generated 或数据库。

**目标职责和依赖。** 将来的具名 `POST /v1/skills/{skill_id}/package-upload/complete` 由 Web 同源控制面调用 BFF。每次含同键重放均先做 current IAM session、受信 tenant/user admission，随后由 BFF catalog workload 身份向 Platform `SkillCatalogService/CompleteSkillPackageUpload` 发送 Product `user/user` context；用户 Bearer、tenant/owner/subject 不来自 body，也不传 Platform。Body 的 attempt/upload/hash/size 只是 Begin 描述符的不受信回显；Platform 必须逐项核 current Skill attempt、Storage upload 的 ZIP、hash、size、scan 和 owner，而非由 BFF 推断上传完成。未来代码沿既有 `src/http/routes/` 具名包路由、`src/http/` 输入校验、`src/infrastructure/clients/platform/` v4 projector/Connect 位置扩展；不用旧 Capability、通用 mutation receipt 或 BFF Storage 代理。此片不建这些代码文件。

**状态与失败恢复。** 单个 Idempotency-Key 绑定 operation、可信 tenant/user、skill_id；owner v4 artifact 中 command digest **仍为 3.0.0**，严格按其 JCS schema 与 11 条 Complete 投影向量，包含 current typed Skill ID、Product context、attempt/upload/hash/size，排除 request ID 与 command identity。Platform 自有事务/CAS、receipt 和 Storage 状态判定冲突及 replay；同键不能绕开当前 IAM/owner/scan，unknown ACK 用同键重试，异 body/身份冲突，不建 BFF SQL/Redis receipt。`pending|clean|unknown` 只允许 `phase=uploaded`，clean 不等于 ZIP validated；infected、旧/aborted attempt、非 draft 或当前状态不符为 412。成功公开严格 200 data，**不公开 owner asset_id**；未来 BFF 必须验证内部 owner asset_id 后才投影。Get 不返回 hash/size，刷新后若丢 Begin 描述符，须保留原文件并重新精确哈希/计数，或显式新 Begin 替换，不能从 Get 推造 Complete 请求。Web 浏览器 CORS/实际 PUT、Complete 运行、后续 Validate/Publish 和 active 发布另片验收。

## W3 Begin runtime 当前候选（2026-09-29；默认关闭）

在已 pin 的 owner `263a28f` inactive v4/command digest 3.0.0 上，本仓以具名 `src/http/routes/begin-skill-package-upload.ts` 承接同一路径 POST，GET 继续独立只读；当前 IAM admission 始终在业务路由/Platform socket 前。输入及稳定 command ID 在 `src/http/begin-skill-package-input.ts`，owner JCS/SHA-256 投影在既有 Platform client 邻近的独立 projector，生成 Connect 只由 `CatalogConnectClient` 使用。复用原 `KOKORO_SKILL_DRAFT_CANDIDATE_ENABLED` loopback 默认关闭开关，不经旧 Capability 或 generic BFF mutation receipt。相同 key 的命令 ID 绑定 trusted tenant/user/skill；body 和 replace presence 改变 digest，由 Platform receipt 决定冲突/当前 pending 重签；每次 replay 仍先 IAM。

`KOKORO_STORAGE_OBJECT_ORIGIN` 可独立配置为唯一批准 ObjectStore public origin，不强制 BFF Storage RPC URL/secret；未配置时仅 Begin fail closed，CreateDraft/Get 不变。Begin 只转发经过 origin、HTTPS（隔离 loopback HTTP 例外）、无 userinfo/fragment、PUT、精确 `content-type: application/zip`、未来 ≤900 秒 expiry 校验的 owner transfer reference，保留原签名 URL/headers，不缓存、不记录敏感 query、不代理 ZIP 字节。BFF Skill SQL/Redis/receipt 不变。直接 HTTP、owner 投影向量与 Node22 静态门是本仓代码证据；Root 真 IAM/Storage/MinIO/浏览器 CORS 组合与 public activation 仍另验。下方文档门“尚无 Begin route”只记录当时基线。

## W3 Begin 文档门当前态与目标态（2026-09-29；仅机器候选）

**当前态。** BFF `f0aaf386bc7f7ca81ff4b996b84d29f0ce05e02f` 已精确 pin Platform owner `263a28f1e55745bd1829a61f68228d775751adbc` 的两份 Proto 和完整 inactive v4 artifact；默认关闭的 CreateDraft 与 Get package-upload 有运行路由，Begin 没有 BFF route、client 方法或浏览器正式入口。Root 已在隔离真 IAM/BFF/Platform/Storage 组合验证 Get 的 `none`/发布后 412/撤权 401，但那条链的 Begin 来自 owner CLI，不构成 public Begin。下方 Get/W1E 章节按当时阶段保留，不覆盖本节。

**目标及放置。** 唯一 public OpenAPI 在现有 `/v1/skills/{skill_id}/package-upload` 的 GET 旁增加 user-only POST `beginSkillPackageUpload` 未激活候选；技术方案采用将来在 `src/http/routes/` 添加具名 Begin route、独立输入/命令摘要投影和既有 `CatalogConnectClient` generated RPC 方法，淘汰复用旧 Capability Skills、通用 RPC proxy、另建 contract 或 BFF Storage 上传代理。此文档门不写 `src/`、配置、generated 或 SQL；后续运行片继续复用现有 loopback-only、默认关闭的 catalog candidate 及 `src/bootstrap/server.ts` 的 IAM admission 先行。Web 同源控制面→BFF 每次 current IAM session/fixed tenant/user→BFF catalog workload token→Platform typed Product `user/user` owner→Storage v2；浏览器 bearer 不给 Platform，body 不接受 tenant/owner/subject。

**幂等/状态/事务。** 单个 1–128 可打印 `Idempotency-Key` 在 `(skill.begin_package_upload,tenant,user,skill_id,key)` 范围派稳定 command ID；BFF 必须独立按已 pin owner v4 `command_digest_version=3.0.0` 的 command schema/JCS/向量投影 digest，明确绑定 skill、受信 Product context、文件名、ZIP MIME、size、SHA-256 和 optional replace 的 presence/value，排除 request ID/command 字段，不自造第二 wire。首次 Begin 仅 `none` 且 replace absent；显式新命令携当前 `replaces_attempt_id` 可替换 `intent/upload_pending/uploaded/aborted`，旧 ID、`validated` 或非 draft 被 Platform 拒绝。BFF 不写包状态/receipt，也不使用 generic mutation receipt 缓存临时签名；每次包括同键重放都重新 IAM 与 Platform 当前 owner/attempt gate。Platform 持久 receipt/attempt CAS 与 Storage pending 才能重签同 upload 的 PUT；已完成/aborted/旧 attempt 的旧 Begin 不重签，刷新先 Get 当前 phase 再决定新的显式替换。Platform/Storage 的跨 owner 副作用不伪称原子回滚，孤儿 Asset 退役留 Storage owner 激活前门。

**浏览器数据面。** Begin 201 仅转发经过后续 BFF 运行时严格验证的短期完整 `TransferReference(url,method=PUT,required_headers,expires_at)` 与稳定 attempt/upload/epoch/replayed。批准 ObjectStore **public origin** 必须精确比对 URL origin，拒绝 userinfo/fragment、非 HTTPS（仅隔离 loopback 可 HTTP）、非 PUT、过期/超出 Storage 最长 900 秒签名预算、额外或错误 signed headers；当前仅接受 `content-type: application/zip`，新增签名头须重审机器契约。响应 `x-request-id`/no-store；签名不入 BFF/Platform receipt。Web 在同源控制面取得短期引用后，直接向获准 public origin 原样 PUT ZIP，`credentials: omit`、`redirect: error`，不加 Cookie/Bearer、不改 URL/签名头；本地/生产 CORS 仅允许批准 Web origin、PUT、Content-Type、无凭据。既有已签 URL 无法随 session 撤权瞬时作废，保证的是撤权后不再新签与后续 Complete/Publish 的当前授权/fence。真 Chromium preflight/PUT、错 origin/header/hash/size、pending 重签、刷新 Get/撤权及旧 attempt 是后续独立运行门，不能由 OpenAPI 候选冒充。

## W3 Get runtime 当前态（2026-09-29；候选默认关闭）

本片将唯一 catalog Connect consumer 从 Platform `5b6eb2c` v3 **替换**为 owner `263a28f` 的完整 inactive v4 Proto/artifact/generated；来源树、digest、Get read binding/descriptor 与双生成都由既有 `scripts/generate-platform-connect-client.mjs` 锁定，旧 vendor 删除。`CatalogConnectClient` 仍是唯一 catalog 工作负载凭据与 Connect 边界，扩只读 `getPackageUpload`；`src/http/routes/get-skill-package-upload.ts` 单独负责输入、owner PB→strict public 状态投影和错误映射，`src/bootstrap/server.ts` 在现有 IAM admission 成功后直达该具名 route。不使用 `owner.ts` 旧 Capability HTTP 或通用 proxy。`KOKORO_SKILL_DRAFT_CANDIDATE_ENABLED` 是同一 catalog 候选开关，默认关闭且仅 loopback 配齐 Platform/IAM/credential 可启，不新增第二环境开关。

请求不带 command/receipt/idempotency：先当次 IAM session/fixed tenant/user，再用 BFF catalog token、`x-tenant-ref`、受信 `ProductCatalogContext(user/user)` 读 Platform current draft。无本仓 SQL/Redis 包副本、Storage I/O、签名与浏览器 bearer 透传。Get response 逐字段校验 `skill_id`、Proto uint64、phase/attempt/upload presence 与 typed ID，违反 OpenAPI `oneOf` 即 502；先前读结果不缓存，撤权后不建立新的 Platform 调用。公开 401/403/503 使用既有 admission 状态码，owner NotFound/owner mismatch 对外 404，非 draft 412；429 可选有界 Retry-After。所有出口 strict data/error envelope、`x-request-id` 与 no-store。Root 真 IAM/Platform 组合与产品 activation 仍独立门；下方 DOC-GATE 的“未实现 route/仍 pin v3”是当时基线，不再是当前事实。

## W3-BFF-SKILL-GET-DOC-GATE：当前态与 user-only 只读目标（2026-09-29）

**当前态。** 本片起点为 BFF clean `main caa99d90f57329065eeb0e98168316b2b1874159`。唯一新 Platform Product 路由仍是默认关闭的 `POST /v1/skills/drafts` 候选；旧 Capability 三个 Skills GET 与 MCP GET 仍走其旧 HTTP adapter，其他旧 Skills 声明返回 503，不代表包操作。BFF consumer 仍 pin Platform `5b6eb2c` 的 inactive v3 Proto/artifact；Platform owner 当前 `263a28f` 已将正式 Get/Begin/Complete/Validate/Publish 与 inactive v4 发布并由 Root 通过隔离真实 owner 组合，但其中 Begin→Publish 是 owner CLI 调用，**不是 BFF public 包链或当次用户 session 撤权验收**。下方 W1E CreateDraft 段落是当时切片记录，不能覆盖此当前态。

**本片目标仅为候选机器契约，不是运行时接线。** 在 BFF 唯一 public OpenAPI 增 `GET /v1/skills/{skill_id}/package-upload`（`getSkillPackageUpload`）；浏览器仍先到 Web 同源 adapter，未来 BFF 在每次请求以当前 IAM session 验证受信 tenant/user，再由固定 Platform catalog workload token 代言调用精确 pin 的 `SkillCatalogService/GetSkillPackageUpload`。只支持 `user` owner：BFF 构造 `ProductCatalogContext(subject_id=user_id, owner_scope=user/user_id)`，不从 path、query、header 或 body 接受 tenant/owner/subject。Platform 再按 tenant/current Skill owner/draft 校验；跨 tenant/不可见资源公开为 404，非 draft 为 412。此读操作没有 `CommandIdentity`、`Idempotency-Key`、BFF/Platform mutation receipt 或 Storage I/O；失效 session 先于 Platform socket 被拒绝，不以缓存快照返回旧状态。

**响应和失败边界。** Public `{data}` 只含 opaque `skill_id`、十进制字符串 `attempt_epoch`、`phase`，以及有值时才出现的 `attempt_id`/`upload_id`；`none` 必须 epoch `"0"` 且两 ID absent，其余 phase 必有当前 attempt/正 epoch，`intent` 的 upload absent，`upload_pending/uploaded/validated` 的 upload present，`aborted` 允许已知或未知 upload。OpenAPI 3.1 `oneOf` 和正 epoch 的 uint64 边界正则将这些关系变为机器约束；ID 限 owner 191 字符非空格式。字符串 epoch 避免 Proto uint64 到 JSON number 的精度丢失。所有成功/错误只以 `x-request-id` header 回显关联，`Cache-Control: no-store`，不放 `meta`、Storage asset/hash、签名 URL/headers、服务凭据或内部 command/receipt。GET 拒绝 query/body/Idempotency-Key；取消与有界 deadline 贯穿当次 IAM/Platform，依赖未知归 503、非法 owner 响应归 502。状态码与现有 admission 映射一致：service secret 错归 403，Product tenant 未配置归 503，429 即使 IAM 未提供合法 header 仍返回并仅可选转发有界 `Retry-After`；各状态码单独限制错误 `code`，不能用旧 Capability HTTP fallback。完整机器字段、错误码和路径由本仓 OpenAPI 唯一维护。

**后续顺序与未决项。** 本轮不修改 `src/`、Platform generated client、配置、SQL 或 Redis；运行时仍没有 Get route。Root 审查后下一代码片须一次精确 pin owner `263a28f` 的两份 Proto、完整 v4 artifact/provenance、descriptor/read binding 与 generated client，再以真实 Get handler 接线；v4 当前 `inactive/routable=false`，候选 OpenAPI 不自动激活 Product。后继按 Begin→签名 PUT→Complete→Validate→Publish 分片，另审浏览器对象数据面、批准 public origin/CORS/required headers/expiry、用户当前授权与重放，不把短期 PUT 放进 Get。BFF 不新建 Skill/包状态表或第二份 receipt，也不跨 owner SQL。Storage orphan retirement、Agent pin、Source execution proof 与最终产品激活仍为独立门。

## W1E-BFF-USER-SKILL-DRAFT v3 候选设计（2026-09-29；runtime 候选已实现、默认关闭）

当前 BFF main `2a95da2410fd89c300dc18064867ee66617549e2` 已精确固定 Platform
`5b6eb2c1532b23b9747bc4bf6ac99f69ad453de0` 的两份 `kokoro.platform.v1` Proto 原字节、完整
`platform-execution-operations/3.0.0` artifact/provenance 与 aggregate
`324e749da1bc66c1ff03de74e7299716f798f5f5bb5fa19556033b79fa09ff8d`。BFF 已有独立 strict raw
CreateDraft projector、RFC 8785 JCS/SHA-256 与全部 owner vectors；canonical OpenAPI 也已有严格 user-only
`POST /v1/skills/drafts` 候选。consumer 仍是 `generated-not-activated`，owner manifest 为
`inactive/routable=false`；Stage B 已接入 runtime route、owner-only catalog credential/token 与 generated Connect 调用，默认配置继续 fail closed。仅 loopback+完整配置可供 Root 隔离 sandbox；真实三 owner 201/replay 尚未验证。v1/v2 只作历史冻结；运行时不 import Platform `src/` 或 checker。

inactive/routable=false 是发布标记，不是 Platform runtime RPC kill switch。协调激活前 public CreateDraft 仍不发布；Root
可按 Platform ADR 在隔离 sandbox 以候选 route 做真实 IAM→BFF→Platform 201/replay 预激活验证，但不得称为公开产品可用。
六 owner sandbox、active artifact 重钉与协调激活仍是正式发布门。

## W2-F2-S9 Chat 作品快照闭环（2026-09-28；BFF 代码门已实现，待 Root 集成审查）

**代码门前基线。** Agent `delivery.created` 的 `artifact_id`/`asset_id`/`artifact_kind` 已随 BFF AG-UI CUSTOM 帧进入 live/replay，且 BFF 持久保存 Conversation↔Artifact 关联；但 `ChatApplicationService.snapshot()` 固定返回 `deliveries: []`。唯一 OpenAPI `Delivery` 仍要求 `content_hash/path/title/mime/size/run_id/created_at`，Web 严格 schema/Canvas 仍按 hash 与旧 Blob 路径消费。AG-UI frame 可 GC，刷新从 snapshot `event_watermark` 续流，不能靠旧帧补回作品；已发布的本人 Library 二元详情与原字节下载是另一条已验链。

**目标与放置。** 扩展现有 `ChatRepository.readSnapshot()`，而非建立第二个 Chat 投影：它已经在一个 `REPEATABLE READ READ ONLY` 事务中按当次 tenant/subject、active Conversation、现有 Project owner predicate 读取最近 100 条 Message 和 AG-UI cursor；在同一事务加有界 `bff_conversation_artifact` 查询和是否有更多的判定，并连同 cursor 返回给 Chat service。独立投影会复制 ACL/水位并引入跨事务竞态；从可 GC 帧或 Redis 聚合则丢失持久交付。写侧继续在既有 `commitProjection` 单事务提交 Agent source、关联、公开帧和 stream 水位；重复 source/关联冲突仍拒绝，不另建表或 worker。Message 按 `message_seq`，Delivery 按 `(delivered_at DESC, artifact_id ASC)` 独立排序；两种序列不互相冒充，UI 以 `(conversation_id, artifact_id)` 去重，不以 hash、时间或消息位置合并。`event_watermark` 与交付查询来自同一 MVCC 视图：快照前已提交的交付在快照中，快照后提交的交付只由 watermark 后 live/replay 接续；GC 后也由持久关联重建，不从过期帧恢复。正常 GC 保留最新 Run 从 `RUN_STARTED` 到 head 的帧；旧 cursor 可过期，replay 返回 expired/HTTP 410 后须重取快照，不能把旧帧当持久作品真源。尚无公开帧时 null watermark 是投影边界，不表示作品为空；若 replay(null) 返回保留帧，Web 仍按二元 ID 去重。

**有界性裁决。** 快照取本会话最近最多 100 件交付（按 `delivered_at DESC, artifact_id ASC` 取 101 件判断 `deliveries_has_more`，输出保持该稳定顺序），与最近 100 条 Message 独立；不假设交付只属于最近消息。`deliveries_has_more=true` 时 Chat/Canvas 不称当前数组为完整历史，显示“查看全部作品”并导向既有本人 `GET /v1/library?kind=artifact` 的 cursor 分页，再走二元详情/下载；这是跨会话分页而非会话专用 continuation。若产品要求在 Chat 内高效穷尽单会话历史，须另立会话分页机器契约/索引切片，不把无界快照或静默截断带入本片。

**展示与消费顺序。** 从已受信且已作 dispatch/owner 校验的 Agent immutable delivery claim 窄投影 `title/mime/size` 到 BFF 关联的必填 `source_title/source_mime/source_size_bytes`，仅供 Chat 卡片展示；项目未上线，canonical schema 走 clean-slate fresh install，隔离测试库/fixture 同步重建，不设旧行 nullable、占位或兼容回填。`path` 不是可访问 URL，也不落关联。Storage 仍唯一拥有当前 FINAL+CLEAN Artifact metadata/字节，点击时必须走本人 `(conversation_id,artifact_id)` Product detail/content 逐次重验。现有 AG-UI CUSTOM live/replay 保留完整受信事件字段（包括 `tool_call_id/path/content_hash`）；Web 严格解析完整事件，再从会话 envelope 和 ID 字段归一到二元身份，snapshot 不伪造 `tool_call_id`，path/hash 不作正式选择器。先由 BFF 修改唯一 OpenAPI、Schema、snapshot 与直接/真 PG 测试并提交；Web 随后固定该机器契约，统一 live/replay/snapshot/Canvas 二元 identity，删除正式 hash `deliveryPath/contentHash` 双轨，preview fixture 单独隔离。Canvas 首片只呈示 metadata 和原生下载；内嵌预览如另立任务须有小件 cap 与 `+1` 有界流，不把 attachment URL 全量 iframe/blob 加载。本 BFF 代码片已按上述边界改唯一 OpenAPI、canonical SQL、受信投影与 Chat 快照；Web/真浏览器 S9 链尚未实现或验收。

## W2-F2-S8 Artifact 原字节下载时限（2026-09-28；BFF 单仓代码已验，真大件待验）

**起始问题。** 基线 `src/http/routes/library-artifact-download.ts` 在 route 内以同一
`AbortSignal.timeout(120_000)` 覆盖 BFF 关联/Storage 最终态与引用读取、最多 1 GiB 的对象取回/校验/临时文件
`fsync`，以及随后对浏览器的 `pipeline`。因此一次合法慢速传输累计超过 120 秒会被截断；Web 的精确 Artifact
同源路径虽将未发头等待设为 10 分钟、200 流总时限设为 30 分钟且空闲设为 30 秒，仍不能延长 BFF 先到的
120 秒。代码片已保留完整取回后才发 200、SHA-256/长度校验、每进程两份 spool 与断连清理，并按下表拆分预算。

**当前实现与边界。** 只对精确的 `GET /v1/library/artifacts/{conversation_id}/{artifact_id}/content`，
在现有具名 route 与 `src/infrastructure/clients/storage/artifact-download-transfer.ts` 中使用共同的
客户端取消信号，并按阶段新建/释放有限预算；不再用一个 120 秒总信号贯穿全程，也不
放宽 BFF 全局 HTTP、个人文件或 Hub 路径。Web/IAM admission 在此 route 之前，仍由各自既有预算约束；下表
从进入此 route 起计，并为 Web 10 分钟未发头、30 分钟 200 流各留缓冲，而非宣称完整浏览器链路的 SLA。

| 阶段                   | 当前总预算 / 无进度预算                                                                                                                                            | 成功边界与失败处理                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BFF 私有准入与引用     | 保留现有最多 120 秒 `AbortSignal` 预算，只在 selector、BFF 关联、Storage FINAL+CLEAN 与短期引用阶段使用；Storage RPC 原有单次 10 秒上限不放宽；无字节流 idle timer | 准入、授权与引用语义不变，阶段完成后清除此信号才开始 spool。超时停止后续 I/O 并取消可取消的待决操作，未发头按现有错误映射返回；普通 PostgreSQL 查询目前不接 signal，不宣称计时器能硬取消查询。                                                                                                                                       |
| ObjectStore 取回与校验 | 从申请 spool 名额/开始 GET 到完整文件校验及 `fsync`，7 分钟总预算、45 秒无进度预算；首个持久化字节前也计 idle                                                      | 进度定义为合法对象字节成功写入临时文件，不以收到 header、`reader.read()` 返回但磁盘未写完或仅重启 timer 充数。200、声明/实际长度、≤1 GiB、SHA-256 全部符合且文件已关闭，才允许发 public 200；超时/断连向可取消 fetch/reader 传播，待文件操作收敛后关闭文件、删除目录并释放名额。无效 owner/对象字节仍是 502，依赖/时限失败仍是 503。 |
| 已校验文件出站         | 从准备发 200 头至 `pipeline` 完整结束，28 分钟总上限、25 秒无出站进度上限；计时独立于前两阶段                                                                      | 保留 Node 流背压；进度以 response writable 接受并完成写入/排空为准，不以只读临时文件或排入内存为准。客户端关闭、超时、读文件/写 socket 失败立即停止 read stream 并 destroy response；已发头后只终止连接，绝不补 JSON、改状态或把截断正文当成功。只有 pipeline 完成且响应完成才算成功；所有终态删除临时目录并恰好释放一次名额。       |

Web 200 流 idle 为 30 秒，故 BFF 出站 25 秒 idle 先收敛；BFF 现有最多 2 分钟准入/引用预算加
7 分钟取回预算小于 Web 10 分钟未发头预算，留约 1 分钟；出站 28 分钟小于 Web 30 分钟预算。
这些是应用层有限预算而非对不可取消 syscall 的硬截止或最低网络速率承诺：1 GiB 在 7 分钟
取回阶段需要约 2.44 MiB/s，在 28 分钟出站阶段需要约 0.61 MiB/s 的平均有效速率，
更慢或超过 idle 的合法链路会按时限失败，不以 5 字节 fixture 推导 1 GiB SLA。阶段切换须清除旧 timer/
listener；共同客户端取消在任何阶段向可取消的待决 I/O 传播。异常对象流的 `body.cancel()`/
`reader.cancel()` 仅 best-effort，不等待其永不完成的 Promise 才清理本地临时目录/名额；文件句柄在
文件操作收敛后关闭，不宣称不可取消 syscall 的严格毫秒级硬 deadline。spool 名额仍仅
从对象 GET 前取得到清理完成保留两份，第三份在 ObjectStore GET 前返回 `503 artifact_download_busy`；
不引入队列、Redis 配额、跨进程锁或新配置面。

**单仓验证与剩余门。** 直接假钟/受控流测试已覆盖准入 120 秒、迟到 SQL 缺失仍按 timeout 返回 503、
spool 7 分钟总/45 秒落盘 idle、出站 28 分钟总/25 秒已完成写入 idle 的正反分支、慢消费者真实 Node
HTTP 背压/已发头截断，以及非 200/坏长度对象流 `cancel()` 永不完成时的有限失败与名额回收。既有
1 GiB 边界、摘要/长度和并发 busy 回归仍通过。Root 独立 Node 22
`pnpm format:check && pnpm check && pnpm schema:check` 通过：默认测试 365 pass/1 无库 skip，
Schema 5 pass/1 无库 skip。Root `f9f5befa` 已固定本代码片 `b382642` 跑通真 IAM/HTTPS
Chromium→Web→BFF→Agent→Storage/MinIO/ClamAV，两件真实 CLEAN 作品 UI 原生保存原字节及
同租户其他成员私有 404、自有资源清零。代表性 1 GiB 限速尚未执行，不据小样本宣称大件吞吐 SLA。

## W2-F2-S5 Product Artifact：跨会话关联与按作品读取（2026-09-28；单仓已验，跨仓待验）

**当前态。** 第一片已固定 Agent event-protocol、Storage F2 Proto 与生成 client，在
`commitProjection` 同一 PostgreSQL 事务持久保存受信 `delivery.created` 的 Conversation↔Artifact
关联，frame GC 不清理关联；第二片扩 `GET /v1/library?kind=artifact` 与本人跨会话查询、
当次 Storage FINAL+CLEAN 重验、单项和原字节下载，个人 Asset 产品链与 Artifact 分离。
Root 已独立通过 Node22 完整门与隔离真 PostgreSQL/Redis 44/44、schema 6/6；
真 Storage/ObjectStore/Agent 三仓与 Web/浏览器仍待验，不把单仓门称全链闭环。

**已固定上游 consumer 来源。** Agent event-protocol owner commit
`486adb1539dd8a06ca90684e66f91be031aa70cf`，`contract/provenance.json` 的
`combined_sha256=cae30a40d712bce39ef33ef2dc857af4f5b69c6afd1956fda065ec77379ae02e`，
其中 `src/kokoro_agent/protocol/events.py` 原字节 SHA-256 为
`0ba59b358db00e53490555e450af060c8a728133a9cf8bfeb49361186adc0f1c`；
`delivery.created` 必填 `artifact_kind` 且带 `artifact_id/asset_id`。Storage F2 owner commit
`d5cfc442c675e32363ae767f5ec662a9e0d9eaea`，v2 Proto/common 原字节 SHA-256 分别为
`5a5dcaec2e1fd0d5eed369b8f79477fd0f8f653b32f9ebe14a8c339f4eb713ac`、
`4604725ec7d5896c9d74b53c6f06d19b20ee758d5ab9e1cb90177ede95bba9fd`，owner
provenance aggregate 为 `8317e644d45c8db310b44f114afa22892a6a40d6ee7d0c1c4a37a8203e79f427`。
第一片已在本仓 consumer manifest 与只读 vendor 固定这两份来源，并由生成器/契约检查证明；
第二片不重钉上游，也不从兄弟 checkout 动态读取契约。

| 设计门        | 裁决                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner/目标    | BFF 唯一写 Conversation、Share、Product API 与 conversation↔artifact **关联**；Agent 唯一写 Run/journal/critical `delivery.created`，Storage 唯一写 Artifact/Asset/Blob/Scan 与签名引用。BFF 不复制 Storage Artifact canonical metadata，不跨 owner SQL/JOIN。                                                                                                                                                                                                                                                                                                                                                                                                  |
| 两个位置      | **采用**现有 `application/agui/` 的 typed source 投影、`infrastructure/postgres/` 具名关联读写与 `http/routes/` 具名 Library Artifact handler；关联写入作为 `commitProjection` 同一事务中的窄 helper/port，列表/单项查询独立具名 repository，避免继续扩大现有约 600 行 AG-UI repository。**淘汰**从 7 日 frame/Redis 重建 Library、每个会话轮询 Storage、把 personal Asset 叫 Artifact、另建跨仓 artifacts 服务或把全部 SQL 塞进泛 `owner.ts`。新文件按一个持续变化原因设立，不建空层。                                                                                                                                                                         |
| 来源与写入    | Agent Chat `delivery` 必须严格解析 owner event-protocol 的 ID、kind、tool_call_id、摘要和 run；禁止从 MIME/路径/hash 推断资源身份。只有 source identity、tenant/conversation、BFF 自有 Agent dispatch 中的 run/subject 与 active Conversation owner 绑定均成立，才在 `commitProjection` 写关联；关联另存最小不可变 Agent 来源声明 `source_asset_id/source_artifact_kind/source_content_sha256` 只供后续 owner 回执交叉核验，不作为可公开的 Artifact metadata 真源。source event 唯一身份/摘要冲突即整事务失败。重复页、重试与崩溃重放复用唯一 `(tenant, conversation, artifact)` 和源事件约束，不产生第二件作品；关联写入、source ledger、frame、水位同成同败。 |
| 私有与分享    | 普通 Library 每页只查当次 IAM admission 的 tenant/subject 拥有的 active Conversation；现有 Project owner predicate 若适用仍须成立，Team/Project 成员身份不自动开放个人聊天。每次单项/下载重查 BFF Conversation owner/status 与关联，随后以 `web-bff + conversation scope` 调 Storage。显式分享仅经当前未撤销、未过期的 `bff_share.share_id` 且绑定同一 active Conversation 与 artifact 关联的专用 share-bound 读路径；无 share ID、仅知 artifact ID/hash、同团队或内部 Storage credential 都不是授权。分享读取的 Storage subject 从已验证 Conversation owner 派生，不取匿名请求自报值。                                                                         |
| 读取与下载    | `GET /v1/library?kind=artifact` 在 BFF 关联上按 `delivered_at DESC, conversation_id ASC, artifact_id ASC` 做跨会话 keyset，先 SQL 过滤当前 owner/active，按有界候选逐项以当前 conversation scope `GetFinalArtifact` 复验 final+CLEAN，核对 artifact/asset/kind/digest/run 与不可变来源声明；不可见项不输出，cursor 按最后检查候选推进，owner 不可用不伪装空页。单项和 `/content` 先同样 ACL+关联，再 `GetFinalArtifact`、`GetFinalArtifactDownloadReference` 双重重验；只接受受限 origin/短期 GET、不转发凭据或签名 URL，完整受界限校验 bytes 长度/SHA-256 后才回原字节。                                                                                       |
| 删除/GC/失败  | Conversation 软删除与关联清理在本仓事务内闭环，分享同事务撤销；旧 source 的迟到/重放不得复活 deleted Conversation 的关联。AG-UI frame GC 不删除关联。Storage final/clean 失效使 Product 列表不再输出、单项/下载不可见；owner 故障返回稳定依赖错误。不得用旧 hash-only Chat、AG-UI frame 或 Storage service credential 作 fallback。                                                                                                                                                                                                                                                                                                                             |
| 数据/API/验证 | 唯一 canonical SQL `database/schema.sql` 增一张 BFF-owned 关联表，无跨 owner FK、无 Artifact metadata 镜像；公开 OpenAPI 仍以 `contract/openapi/v1/openapi.yaml` 为唯一可编辑机器源。`kind=file` 行为保持，`kind=all` 的双源复合 cursor 另切。先 RED 锁来源、重复/冲突、租户/成员/删除、GC 后列表、跨会话分页、final/CLEAN/坏 owner、原字节/分享撤销，再改机器源/代码；Node22 format/check/schema/contract/PG integration 与 Root 真 Agent→Storage→BFF→Web 浏览器组合均是代码门证据，第二片候选待 Root 真实组合验收。                                                                                                                                           |

**代码片边界。** 第一片已固定机器来源、typed Agent delivery、同事务关联/删除与 canonical Schema；
第二片候选只在既有 `src/http/routes/`、`src/infrastructure/postgres/`、
`src/infrastructure/clients/storage/` 及具名 port 承接本人 Product 读取/下载，唯一 OpenAPI 增三项
读取操作。`src/bootstrap/server.ts` 只接三 route，不改 IAM/Storage/Agent/Web 或配置。
显式分享、`kind=all` 与浏览器入口不在本片；Root 的真服务组合/浏览器验收仍未完成。
原字节下载的临时 spool 只在进程内准入两个并发，名额从开始对象 GET 保留到响应结束/取消后的
临时文件清理；第三个请求以 `503 artifact_download_busy` 在取对象前背压，不建立新 Redis/SQL
配额或共享进程。此限制不改变本人 Conversation/Storage 的当次授权重验。

## W2-BFF-PERSONAL-DOWNLOAD：个人文件受控下载代码片（2026-09-28；待 Root 集成验收）

**当前态。** 设计门基线 BFF main `74bb714d5867399bc50806c158c2ffb838c27b40` 已有本人列表与上传；
本工作树代码片现已加入唯一 public OpenAPI、HTTP route、Storage 个人下载 adapter 与直接测试，
但仍待 Root 独立审查及真 Storage/MinIO/ClamAV/Web/浏览器验收，不把代码片视为整体可用。
Storage consumer 已精确固定 owner `2d87e26bbaed9a70dcd91ad1e9d126d39d275f38`
的 v2 Proto：`GetAsset` 可按 `asset_id` 查询并返回摘要；`GetDownloadReference` 返回短期 GET 引用，但只校验
scope/CLEAN，不固定普通 `upload_purpose=ASSET`。因此列表项、摘要及签名引用均不得独自充当下载授权。

| 设计项       | 目标裁决                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner / 位置 | BFF 是 `GET /v1/library/files/{asset_id}/content` 的唯一 public Product owner；Storage 仍唯一拥有 Asset、Scan、对象和签名引用。沿现有 `src/bootstrap/server.ts` 精确分发，在 `src/http/routes/` 与 `src/infrastructure/clients/storage/` 各设具名个人下载职责；不塞进泛 `owner.ts`、Project adapter 或新增一级模块。                                                                                                                                                                            |
| 路径取舍     | 采用同一文件资源下的 `/content` 字节响应，与已有上传 `/v1/library/files` 同族。淘汰浏览器直跳 Storage 预签 URL：ObjectStore origin 可能为内网地址，且引用会落入浏览器/历史、CORS 与跨域跳转边界；也不复用仅校验 PUT 的 `transfer.ts`。                                                                                                                                                                                                                                                          |
| 准入与 scope | 每次沿当前 service envelope + 单一用户 Bearer → IAM 在线 admission →固定 Product tenant 的链路；只从可信 `RequestContext` 派生 `tenant_id`、`subject_id`、`scope_kind=personal`、`scope_id=subject_id`。先严格解析单个 `asset_id` 路径段与空 query/body；不从请求头、列表 cursor、摘要或同团队身份推断 scope。                                                                                                                                                                                  |
| 双 RPC       | `GetAsset({asset_id})` 必须先在同一 personal scope 返回相同 ID、有效小写 SHA-256、普通 `upload_purpose=ASSET`、`scan_state=CLEAN`、非空安全 filename/MIME 与 `size_bytes` 在 0–1,048,576 内；再以同 scope、同 ID 和返回摘要调用 `GetDownloadReference`。后者的 ID、摘要、大小、MIME、CLEAN 必须与前一步逐项一致。任何不可见、非 ASSET、非 CLEAN 均不得取得或发出对象字节。                                                                                                                      |
| 引用与字节   | 每次 GET 使用新的 Storage `CommandIdentity`（内部命令，不要求 public Idempotency-Key），不缓存/持久化引用，也不自动重试签发。仅接受有效期未过、方法 GET、配置的精确 ObjectStore origin、无 userinfo/fragment、无 required headers 的 HTTPS/本地显式配置引用；fetch 不跟随重定向、不带 Cookie/Authorization/service secret，限制网络超时与取消。完整缓冲最多 1 MiB，检查上游 200、实际字节数和 SHA-256 与两个 RPC 一致后才发 public 200；绝不先流出部分成功。                                    |
| 响应/失败    | 成功返回原始二进制，不套 JSON envelope；`Content-Type` 来自已校验 MIME，`Content-Length` 用实际字节，`Content-Disposition: attachment` 使用安全编码文件名；`Cache-Control: no-store`、`Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff`、`x-request-id` 必备，不透传 ObjectStore 响应 header。非法 selector 400；本人不可见/不存在或其他 scope 404；owner/网络不可用 503；不可信 owner 字段、引用或字节 502。错误仍为稳定 JSON、无签名 URL/owner 原文，下载失败不输出部分 200。 |
| 数据与验证   | BFF 无新 SQL、Redis、role、schema、receipt、缓存或分布式事务；Storage 内部命令 receipt 仍属 Storage。先改唯一 public OpenAPI 和直接合同/越权/故障测试，再实现；Node22 全门与 Root 真 Storage/MinIO/ClamAV 正向、他人私有及超时/坏摘要负例才可升格 BFF 切片验收。随后 Web 精确 pin 本操作、同源窄透传和现有文件卡下载动作，最后真 Chromium 点击验收。                                                                                                                                            |

## W2-BFF-LIBRARY-PERSONAL-UPLOAD-CODE：正式个人文件上传（2026-09-28，待 Root 集成验收）

**设计基线/代码片。** BFF main `a67ae2d06b52202f349305ae3723f6e296c087a1` 只有
`GET /v1/library?kind=file` 个人 CLEAN ASSET 列表；本代码片已增加个人文件 Product 写入口。Storage
`2d87e26bbaed9a70dcd91ad1e9d126d39d275f38` 已拥有 personal scope 的 CreateUpload、CompleteUpload、
GetUploadStatus、GetAsset、Scan 与对象生命周期。BFF 已增加 `POST /v1/library/files` 的用户写入纵切；
Web 同源入口、下载、Agent Artifact、权限模型和部署不在本片。代码/直接测试已写，Root 复验及真实组合仍待验。

| 设计项       | 裁决                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner/位置   | BFF 拥有 public Product path、本人准入、上传命令协调和 receipt；Storage 继续唯一写 Upload/Asset/Scan/Blob。采用已有 `src/http/routes/` 具名 handler、`src/application/` 个人上传用例和 `src/infrastructure/clients/storage/` 独立 personal Connect adapter。把逻辑继续放入泛 `owner.ts` 或让 Project adapter 伪造 `projectId=subjectId` 均淘汰。                                                                                                                                                                                                                             |
| 请求与身份   | 一个 `files` multipart 文件，总请求体最多 1 MiB，必填有效 `Idempotency-Key`；不接受 query、额外 part 或 body 中的 tenant/subject/scope。每次 service + Bearer + IAM admission 后从受信 `RequestContext` 建 `tenant/subject`，Storage metadata 固定 `scope_kind=personal, scope_id=subject_id`，`upload_purpose=ASSET`。没有 Project owner predicate。                                                                                                                                                                                                                        |
| 恢复         | 对同一 `tenant+subject+key` 建独立 `personal-file-upload:v1` checkpoint scope；文件名、MIME、长度、SHA-256 构成语义指纹，并派生稳定 Create/Complete Storage command ID。CreateUpload 后必须先持久化原 `upload_id` 才上传对象；每次同键恢复先读 GetUploadStatus 并核对摘要/大小/MIME，completed 时 GetAsset 复核本人 scope、普通 ASSET 与 CLEAN。pending 时用同一个 Create command 刷新短期 PUT reference，再安全 PUT/Complete。Create 已成功但 checkpoint 写入未知、短期引用/PUT/Complete 暂时失败均不内联 Abort，重启后同键恢复原 upload/status/asset，不新建第二个 Asset。 |
| Receipt/并发 | 现有 `bff_idempotency_receipt` 的 `scope` 主键足够：一条独立 public `POST /library/files` 终态 receipt，一条独立 personal checkpoint，均按可信 tenant/subject/key 隔离，不新增表、索引、角色。必须先通过当次 IAM admission 与请求语义校验，再在专用路由内 claim/replay；不能落到 server 泛 `mutationTicket` 的先重放路径，也不能继承 Project `project-resource-upload:v1 + projectId`。同键不同指纹 409，并发处理中 409；仅 CLEAN 且终态 receipt 持久成功后返回 200。                                                                                                        |
| 失败/删除    | 感染为终态 422，待扫/未知完成为可同键重试 503；配置/超时/受信范围拒绝 fail closed，坏 owner 数据 502。本 Product 请求不内联 Abort 可能恢复的 upload；对象 PUT 只复用现有受限 origin/无重定向 helper，不把 Storage secret 送给对象存储。不得产生非 CLEAN success、临时下载 URL、BFF Asset 镜像表、旧 HTTP fallback。                                                                                                                                                                                                                                                          |

代码片先锁 Project 上传现有行为，再以 RED→GREEN 直接测试覆盖 checkpoint、同键异义、
Complete 不确定结果与重试、当前 IAM admission 先于 receipt replay。
`PostgresIdempotencyRepository.putReceipt` 已改为条件写 0 行即报错，终态 receipt 与 checkpoint 不默许 0 行；
真 PostgreSQL 并发/重启仍须 Root 组合验证。
真实组合门为隔离 PG + Storage Connect + MinIO + ClamAV 的 POST→CLEAN→个人 GET/刷新、
同键重放/异文件冲突、Complete 丢响应后 BFF 重启、EICAR/待扫及跨 subject/tenant 负例；不触碰 3310。

## W2-LIBRARY-BFF-FILE：个人文件 Product 列表实现（2026-09-28，待 Root 集成验收）

**当前工作树。** BFF 的 `GET /v1/library?kind=file` 在普通用户 IAM admission 后由具名路由调用个人范围的
Storage Connect v2 `ListAssets`，成功返回只含 CLEAN ASSET 的 200；旧固定 503 分支已删除。OpenAPI 已发布
必填 `kind=file`、分页和严格成功形状。consumer pin 为 Storage main
`2d87e26bbaed9a70dcd91ad1e9d126d39d275f38`，combined SHA-256
`11edffcdd668c59ef07c7b4c47d44b38dd95c2b8aee5a4d0c6475fba58850713`；Project scope 既有调用仍保留。
Root 已复验列表单仓门；真实 owner/browser 组合仍待验，尚不等于浏览器 Library 闭环。

| 设计门                 | 裁决                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Owner / 目标           | BFF 唯一拥有 public Product Library、个人授权和响应投影；Storage 唯一拥有 Asset/Scan/Blob。首片只列当次本人 personal scope 的 CLEAN 普通 ASSET，不列 Agent Artifact、Project 资源、包或他人文件。                                                                                                                                                                        |
| 公共路径 A（采用）     | 保留 `GET /v1/library`、`listLibrary`，但 `kind=file` **必填**；缺失、重复、空值或未知 kind 返回 400。不把无参“作品资料库”暗中改为“文件柜”。未来 `kind=artifact` 待 F2/可信 Agent 链，`kind=all` 待真实双源复合分页。                                                                                                                                                    |
| 公共路径 B（本片淘汰） | 新 `/v1/library/files` 类型直观，但旧 `/v1/library` 和 `listLibrary` 的正式语义仍需重裁；两者共存或 alias 造成双轨。本片用原 path 加显式 kind，后续若改变须按 breaking policy 评审。                                                                                                                                                                                     |
| 代码位置（已采用）     | 不把查询/Connect/错误堆进泛 `owner.ts`；具名 `library-file-list` handler 在 server 普通用户 admission 后精确分发。个人 client 在已有 `src/infrastructure/clients/storage/`，与 Project client 共享只读 CLEAN ASSET 页验证器而不复用 Project scope/上传命令；generated wire 类型止于 adapter。无新模块、目录或进程。                                                      |
| 身份与失败             | 原有 service envelope → 单一 Bearer → IAM 在线 admission → 固定 Product tenant → 严格 query → 从当次 RequestContext 组装 tenant/subject、`scope_kind=personal`、`scope_id=subject_id` → v2 Connect `ListAssets`。每页重验；浏览器 header/body、cursor、文件创建者、同 hash、Team 成员不是个人授权。缺配置/超时/依赖拒绝 fail closed，坏 owner 页 502，不以错误伪装空页。 |
| 分页与数据             | `limit` 省略为 50、有效 1–100；有界 opaque cursor。Storage 在 SQL 页前筛 `upload_purpose=ASSET AND scan_state=CLEAN`，按 `created_at DESC, asset_id ASC`，personal/project cursor 种类隔离。BFF 不后过滤、不自动重试、不新增 Library/Asset/Artifact 表、缓存、receipt、跨 owner SQL/角色/schema；空页 200，依赖失败非空页。                                              |
| 删除与验证             | 固定旧 503 stub 已删除；不接 Storage 内部 HTTP 或 fallback。单仓 contract、admission/越权/坏页、Node22 全门由本代码片执行；Root 后续独立验证真实 Storage/PG 与浏览器刷新/私有负例。                                                                                                                                                                                      |

首片 public item 以 `kind:"file"` 判别，同时保留 Storage opaque `asset_id`、`filename`、`mime_type`、十进制
`size_bytes`、`content_sha256`、`scan_state:"clean"` 与 UTC `created_at`；没有 `artifact_id`、`title`、`session_id`、
`content_hash`、对象 key 或 URL。未来 `kind:"artifact"` 须以 Storage F2 的独立 Artifact 身份、kind/title/source、
Agent 可信 Run/ExecutionIdentity 与正式产物列表为前置；新增 union 分支须评审 generated consumer breaking。
Web 旧 `/api/session/artifacts` 内容哈希列表不成为此 API 的别名，也不把个人文件渲染成“作品”。

**个人上传**的代码片状态以上方为准；列表 200 不代替上传的真实组合验收。

**个人下载独立纵切**由本文顶部 `W2-BFF-PERSONAL-DOWNLOAD` 设计门裁决为 BFF 受控字节转发；
当前列表 200 不代替下载验收。Storage `GetDownloadReference` 只校验 clean/scope，未固定
`upload_purpose=ASSET`；必须先在当次 personal scope `GetAsset` 校验普通 ASSET/CLEAN，再签发并核对，
短期 URL 不进入列表/receipt，也不开放 package/Artifact 普通下载。

## W1E-IAM-0.6-BFF-PIN：IAM 历史来源

IAM owner `a4c2b61467f1fc1772d6b6d8e98f081c090289fb` 的 internal OpenAPI `0.6.0` SHA-256 为
`392ca0e49544c0ec6e0d2fa782c46c33c1847e2c350102e7ad3b8af43f858ced`。沿用本仓现有
`contract/vendor/kokoro-iam/` → `openapi-ts.iam.config.ts` → `scripts/generate-iam-http-client.mjs` →
`src/generated/iam-http/` 与 manifest 的单向生成链；固定完整 owner 原始字节，但继续只生成 session、Team、invitation
操作。Platform introspection 与 E2 verifier 均不进入 BFF client/browser-private relay。只更新
`src/http/routes/iam-protocol-relay.policy.ts` 来源 tuple 并派生 JSON；不扩展 relay route 或 BFF 业务/数据边界。

## W1E-IAM-E2-BFF-SOURCE-PIN：IAM 历史来源

IAM owner `b720b6dc095b883237682102ca0a87ed6451a968` 的 internal OpenAPI 0.5.0 SHA-256 为
`cddfec4cd3439d98f399254911232c447582a97e9b1d4c109139e68baaf030b9`。BFF 沿用既有固定 vendor →
`scripts/generate-iam-http-client.mjs` → generated client/manifest → TypeScript relay policy → 派生 JSON 单向链；旧 vendor 删除。
IAM E2 `verifyExecutionAuthorization` 不进入 BFF 生成 operation allowlist 或 browser-private 准入路由。relay route/header/cookie/status
保持上一版本，public Product API、BFF SQL/Redis、事务与 AG-UI 不变。

## W1E-IAM-PERMISSION-CONSUMER：IAM 历史来源

IAM owner `5c9cecf714c87234bbc9558665b23e09afa6e9f6` 的 OpenAPI SHA-256 为
`05ff7ff712ce06571ca5e092fdaf234b9ee4d1b4978c54e0d54d2b50fe51dde2`。BFF 只从该固定机器契约生成
角色列表中新增的可选 `platform:["execute"]` 类型/校验；不在 BFF 复制 IAM 权限判断。relay policy 保持原有准入形状，
仅刷新来源 provenance。没有 BFF SQL、事务、Redis、Product API 或 AG-UI 变化。

## W1D-RELAY-PIN-BFF：IAM 来源重钉（历史验收）

当前 IAM owner 为 `6a55ffb4c22f0b155ddb83157735c0ace766701d`。其 ingress allowlist、Better Auth 1.7.3 snapshot、internal OpenAPI 0.4.0 的固定 blob SHA-256 分别为
`f63dacfa8a7bcec3c56efb8ffb762a3f8bd82bb380eff40a1462db1e77d61ead`、
`b2eac1919e16fdc30a40bee0f3c4300b641bd8f674214aea7731bf10299559e1`、
`a18d57172df841cb2f55aa845a3eeb519ddb5abc8bea1c2be74fbb7e0fb62416`，与上一 pin 字节相同。
BFF 只更新 browser-private relay policy 与 IAM generated client 的来源身份：TS policy 是唯一手写准入事实，JSON 由脚本派生；
OpenAPI vendor 移至新 commit 路径，manifest 与生成配置固定同一 commit。旧 vendor 路径删除，不保留双轨。
route/header/cookie/status、public Product API、业务状态机、SQL/Redis、事务及失败恢复均不变。
本片由聚焦来源测试、双次确定性生成、`pnpm format:check && pnpm check` 验证；跨仓 Web 消费与 Root pin 串行后续验收。

## R5-INVITE-BFF-RELAY：邀请邮件的精确 browser-private transport（历史设计门，已实现）

**当时基线（BFF main `da03b76e450018ffa00f812da461569a00a377b3`）：** `/iam` 在
`src/bootstrap/server.ts` 中先于普通 Product admission 分发，现有 `iamRelayRoute` 只匹配
`IAM_RELAY_POLICY.routes` 中的 Better Auth 静态路径。policy `2.0.0` 未准入 `/sign-up/email`，也不能匹配 IAM Nest
Controller 的三条动态路径。IAM main `7215223b2ed27a0d5217f3bbaaabce547006d3bb` 已发布 internal OpenAPI `0.4.0`
（SHA-256 `a18d57172df841cb2f55aa845a3eeb519ddb5abc8bea1c2be74fbb7e0fb62416`）：
`GET .../context`、`POST .../accept`、`POST .../reject`；邀请邮件已指向
`/iam/interactions/invitation?id=<canonical-lowercase-UUID>`。当前 BFF 的 `allowedLocation` 只接受三条旧 Web interaction、
Auth.js callback/post-logout 或静态 IAM GET，所以 IAM 邮箱验证回到这个新页面时会被判为非法上游响应并返回 502。
三条 operation 均已声明相同的 `x-kokoro-owner=kokoro-iam`、`x-kokoro-visibility=browser-private`、
`x-kokoro-stability=stable` 与 `x-kokoro-idempotency=none`，可作为后续 Root verifier 的最终 owner evidence；本阶段只冻结文档，
尚未写入 BFF runtime/policy pin。

**目标职责：** BFF 只提供 `Browser → Web same-origin server → BFF → IAM` 的窄传输边界；IAM 继续唯一拥有 User、
issuer Session、Invitation、Member、recipient/expiry/role 与状态机，Web 后续独立拥有静态页面、表单和一次性 CSRF。
这些入口不经过已入组用户才可取得的 Product Bearer/admission，不新增 Product Team endpoint，也不让浏览器获得 BFF service secret。
新邮箱按 `sign-up → SMTP verify-email → 重新 sign-in → context → accept|reject` 前进；accept 成功后才可启动 Product `/login`，
reject 只进入完成页。

| 设计门项目          | 裁决                                                                                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner / 唯一 writer | BFF `src/http/routes/iam-protocol-relay*` 唯一拥有 relay admission/transport policy；IAM 拥有四个上游 operation 及业务状态；Web 拥有浏览器 interaction/CSRF。                                                                          |
| 当前入口            | 复用 `src/bootstrap/server.ts` 的 `/iam` 先行分支、现有 relay transport、配置中的固定 `KOKORO_TENANT_ID`/Web Origin、issuer Cookie 白名单及预算。                                                                                      |
| 目录方案            | 采用同一 relay 中**独立具名精确动态 matcher**，静态 `routes` 仍只表示 Better Auth `AUTH_ROUTES` 子集；淘汰把 `{tenant_id}`/`{invitation_id}` 通配或模板硬塞进静态 map 的方案，也淘汰新 gateway/Team route/Product admission。          |
| 粒度                | 后续实现扩展现有 policy/relay/生成链和相邻测试；动态 matcher、注册 body codec、Location 判定各自保持单一职责，是否拆文件按实现大小和独立测试边界决定，不预建目录。                                                                     |
| 依赖                | BFF 只消费 IAM 固定 commit 的 `AUTH_ROUTES`、Better Auth snapshot 与完整 internal OpenAPI；generated IAM wire schema在 relay adapter 终止。禁止 sibling 源码 import、IAM SQL/Redis、Product Bearer、浏览器 tenant/actor、宽 `/iam/*`。 |
| 数据/API            | public `/v1` OpenAPI、`database/schema.sql`、Redis DB 8、receipt/outbox/cache 均不变；browser-private policy 目标版本为 `2.1.0`。                                                                                                      |
| 删除/替代           | 不保留 `/auth/invitation`、宽 `organization/get-invitation`、动态 wildcard、开放 callback、兼容 alias 或自动写重试。旧 Better Auth 静态子集继续按原精确矩阵工作。                                                                      |
| 验证                | policy/transport/client 单元与真实 IAM HTTP 先 RED→GREEN；Node22 `pnpm format:check && pnpm check`；Root 固定 IAM→BFF→Web 来源后验证精确模板/visibility/method、篡改负例、真 HTTPS SMTP 点击、accept/reject/注册及资源清零。           |

### 四个入口与双 matcher

| BFF 精确入口                                                      | IAM 机器来源                                   | 方法与目标语义                                   | BFF 额外准入                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/iam/sign-up/email`                                              | IAM `AUTH_ROUTES` + Better Auth 1.7.3 snapshot | `POST`；仅新邀请收件人的 email/password 注册     | 无 query/Authorization/Idempotency-Key/issuer Session；精确 Origin、JSON、64 KiB 总上限和恰好 `name,email,password,callbackURL` 四字段。`callbackURL` 必须逐字等于配置 Web Origin 下 `/iam/interactions/invitation?id=<canonical UUID>`；`image`、`rememberMe`、浏览器自报 callback 与额外字段拒绝。 |
| `/iam/v1/tenants/{tenant_id}/invitations/{invitation_id}/context` | IAM OpenAPI 0.4.0 `getTenantInvitationContext` | `GET`；已验证 issuer Session 的 pending 邀请预览 | `tenant_id` 逐字等于 `KOKORO_TENANT_ID`；invitation 为小写 canonical UUID；无 query/body/Authorization/Idempotency-Key。                                                                                                                                                                             |
| 同前缀 `.../{invitation_id}/accept`                               | IAM OpenAPI 0.4.0 `acceptTenantInvitation`     | `POST`；pending → accepted，并由 IAM 创建 Member | 同一固定 tenant/UUID；无 query/body/Authorization/Idempotency-Key；Web 在调用 BFF 前验证一次性 CSRF。                                                                                                                                                                                                |
| 同前缀 `.../{invitation_id}/reject`                               | IAM OpenAPI 0.4.0 `rejectTenantInvitation`     | `POST`；pending → rejected，不创建 Member        | 与 accept 相同；Web 在调用 BFF 前验证一次性 CSRF。                                                                                                                                                                                                                                                   |

静态 matcher 仍对字面路径查 `routes[path]`，只增上述 `/sign-up/email`；动态 matcher 只接受三条具名模板，不接受额外段、
尾斜线、大小写/反斜线/双斜线、点段、percent-encoded path、绝对 URL、fragment、错误方法或相似 action。两者都先验证
`web-bff` 服务身份与 shared secret，再验证配置、原始 target、header/body；本地拒绝不得打开 IAM socket。动态三路和 sign-up
都要求精确 Web Origin。动态三路必须在现有 Cookie 白名单过滤后存在一个非空、无重复的 issuer `session_token`，仅转发批准的
issuer Cookie；sign-up 则要求过滤后的 issuer Cookie 为空。Product/Auth.js/其他 Cookie 不转发。Origin 只是 BFF/IAM 的来源门，
不替代 Web 的一次性 CSRF；Web 后续所有邀请 POST（sign-up、accept、reject）均须在注入服务凭据前消费该 CSRF。

### 传输、响应与 Location

四路复用现有单次有界 transport：入站 header 16 KiB、body 64 KiB、raw query 8 KiB、总 deadline 不超过 5 秒、响应不超过
1 MiB，调用方取消贯穿到真实上游 reader/socket；不跟随 redirect、不缓存、不自动重试。动态三路以 IAM 0.4.0 generated
success/error schema验证 status/body；只有 owner 声明的 `200/400/401/403/404/409/429/500/503` 与严格 JSON envelope
可原样返回。sign-up 只接受 pinned Better Auth snapshot 声明的 native status，并保持原生 wire，不套 Product envelope。
未批准 status、content type、header、shape、超限响应或任意 3xx 均丢弃上游 body，返回脱敏
`502 iam_relay_response_invalid`；transport/timeout 返回 `503 iam_relay_unavailable`。有效 429 只保留十进制 1..86400 秒
`Retry-After`。所有成功、owner 错误和本地错误都由 BFF 固定输出 `Cache-Control: no-store`、
`Referrer-Policy: no-referrer` 与受控 `x-request-id`；动态三路不接受或输出 `Location`/`Set-Cookie`，sign-up 仍只允许现有严格
issuer `Set-Cookie` 规则，任何原始 token、cookie、password、query、Location、上游 body 或异常都不得进入日志。

现有 `/iam/verify-email` GET 保持静态 Better Auth route，但 `allowedLocation` 新增一个**只对该上游 route 生效**的 Web 同源例外：
pathname 必须逐字为 `/iam/interactions/invitation`。成功时 raw query 必须逐字为唯一
`?id=<canonical-lowercase-UUID>`；失败时只允许 Better Auth 在该 callback 后追加的单个
`&error=<OWNER_ENUM>`，其中 `OWNER_ENUM` 恰为 IAM
`VERIFY_EMAIL_REDIRECT_ERROR_CODES` 当前四值 `TOKEN_EXPIRED|INVALID_TOKEN|USER_NOT_FOUND|INVALID_USER`。IAM 的真实 SMTP 测试已证明
无效 token 返回 302 并追加 `error=INVALID_TOKEN`；若只允许成功形状，用户会收到 BFF 502 而看不到可恢复的验证失败页。BFF 因此
采用这组 owner 枚举的窄失败形状，而不是任意 `error`：禁止 code/error 的其他值、重复/重排参数、percent alias、fragment、
userinfo、scheme-relative 或外域。Web 只把枚举映射为固定安全文案，不回显原始 query。这个 Web 页面不是 IAM route，绝不加入
`routes` 或动态 matcher；它只是邮箱验证响应的精确回跳目标。当前缺少此例外会稳定产生 502，因此它与
sign-up/dynamic matcher 必须在同一实现切片落地和回归。

### 状态机、失败恢复与来源级联

`context` 只看 pending 且匹配当前 verified issuer email 的邀请；它不写状态。IAM 在 accept/reject 时重新检查 active tenant、
recipient、expiry、pending 与角色，绝不相信此前预览。accept/reject 不是 BFF receipt 操作；超时、断线或响应校验失败后的提交结果
为未知，BFF/Web 不盲重放。Web 可重新查询 context，但终态统一 404 不能证明前次 accept/reject 的具体结果，因此未知结果不得
直接启动 Product 登录。429 按合法 `Retry-After` 等待；依赖故障 fail closed，不返回缓存预览。重复/并发由 IAM 条件写与
Serializable 事务裁决，BFF 不伪造跨服务原子性。

policy 目标 `2.1.0` 继续固定 IAM allowlist SHA-256
`f63dacfa8a7bcec3c56efb8ffb762a3f8bd82bb380eff40a1462db1e77d61ead` 与 Better Auth snapshot SHA-256
`b2eac1919e16fdc30a40bee0f3c4300b641bd8f674214aea7731bf10299559e1`，并新增 IAM 最终 OpenAPI version/digest 与三条有序
dynamic operation（template/method/operationId/owner/visibility/stability/idempotency）来源。BFF vendor、
`contract/dependencies/iam-http.json`、生成配置及 generated client 后续从 IAM commit
`6a55ffb4c22f0b155ddb83157735c0ace766701d` 的 0.4.0 原始字节重生，只新增三条
issuer operation；`/sign-up/email` 仍来自静态 allowlist/snapshot，不混入 Nest generated client。

后续 TS 事实源与派生 JSON 的新增字段形状固定如下；现有 `requestHeaders`、`responseHeaders`、Cookie 与预算字段原样保留，
`routes` 也继续保留当前所有静态 entry，仅示出本片新增项：

```json
{
  "version": "2.1.0",
  "iamOwnerCommit": "6a55ffb4c22f0b155ddb83157735c0ace766701d",
  "iamAllowlistSha256": "f63dacfa8a7bcec3c56efb8ffb762a3f8bd82bb380eff40a1462db1e77d61ead",
  "iamSnapshotSha256": "b2eac1919e16fdc30a40bee0f3c4300b641bd8f674214aea7731bf10299559e1",
  "iamOpenapiPath": "contract/openapi/iam.internal.v1.json",
  "iamOpenapiVersion": "0.4.0",
  "iamOpenapiSha256": "a18d57172df841cb2f55aa845a3eeb519ddb5abc8bea1c2be74fbb7e0fb62416",
  "routes": {
    "/sign-up/email": ["POST"]
  },
  "invitationRoutes": [
    {
      "template": "/v1/tenants/{tenant_id}/invitations/{invitation_id}/context",
      "methods": ["GET"],
      "operationId": "getTenantInvitationContext",
      "owner": "kokoro-iam",
      "visibility": "browser-private",
      "stability": "stable",
      "idempotency": "none"
    },
    {
      "template": "/v1/tenants/{tenant_id}/invitations/{invitation_id}/accept",
      "methods": ["POST"],
      "operationId": "acceptTenantInvitation",
      "owner": "kokoro-iam",
      "visibility": "browser-private",
      "stability": "stable",
      "idempotency": "none"
    },
    {
      "template": "/v1/tenants/{tenant_id}/invitations/{invitation_id}/reject",
      "methods": ["POST"],
      "operationId": "rejectTenantInvitation",
      "owner": "kokoro-iam",
      "visibility": "browser-private",
      "stability": "stable",
      "idempotency": "none"
    }
  ],
  "invitationSignUp": {
    "route": "/sign-up/email",
    "method": "POST",
    "bodyFields": ["callbackURL", "email", "name", "password"],
    "callbackPath": "/iam/interactions/invitation",
    "callbackQueryParameter": "id"
  },
  "invitationLocation": {
    "sourceRoute": "/verify-email",
    "path": "/iam/interactions/invitation",
    "queryParameter": "id",
    "valueFormat": "canonical-lowercase-uuid",
    "errorQueryParameter": "error",
    "allowedErrorCodes": [
      "TOKEN_EXPIRED",
      "INVALID_TOKEN",
      "USER_NOT_FOUND",
      "INVALID_USER"
    ]
  }
}
```

`template` 是去掉固定 `/iam` 前缀后的 BFF/IAM 相对路径；Root 用 `/iam` + template 查 owner OpenAPI。数组和字段次序属于
确定性 artifact 字节的一部分。`routes` 的省略展示不表示删除旧 entry；生成器必须输出完整 policy。IAM 0.4.0 最终字节已让三条
operation 逐项声明 owner/visibility/stability/idempotency；BFF artifact 必须从这些 extension 复制并由 Root 比对，不用 path/method
推断或 BFF 自述代替 owner extension。

Root verifier 后续从固定 gitlink commit blob 同时读取 IAM allowlist、snapshot、0.4.0 OpenAPI 和 BFF TS→JSON artifact：静态 routes
继续验证为 `AUTH_ROUTES` 的窄子集；dynamic entries 必须恰好等于上述三条 path template/method/operationId，且 artifact 的
owner/visibility/stability/idempotency 必须逐项与 IAM extension 一致；拒绝 wildcard、第四条动态路径、method/operation drift、旧 digest 与
篡改 Location policy。`invitationLocation.allowedErrorCodes` 还必须逐项等于同一 IAM commit 的
`VERIFY_EMAIL_REDIRECT_ERROR_CODES`，不允许 BFF 自增错误值。该来源门只证明发布字节一致，不替代真 SMTP/HTTP/浏览器旅程。

## W1C-Team-R5：固定租户 Team 写投影（目标切片）

当前 BFF 仅有三条 Team GET；IAM `ad5224a9e0a3a31d1c593d214d37940d6923b2e7` 的 internal OpenAPI 0.3.0 已有六条写操作，其 SHA-256 `e1a023d3ae9839c345d65ec91c3674bd105a9c27f65bb6ecb10f74c965340c54` 与既有消费契约相同。IAM 是 Member/Invitation/Role 唯一 writer。目标是在现有 `src/http/routes/team.ts` 与 `src/infrastructure/clients/iam-team.ts` 扩展 Product 投影，由 `src/bootstrap/server.ts` 在统一 Product admission 后分发；不另建 gateway、Team SQL/Redis、缓存或 receipt。可信 tenant、Bearer 只来自 admission context，body 只含 owner 允许的 email/roles。六条路由为邀请创建、重发、取消，成员角色替换、移除和本人离开；`/members/me` 先于动态 member ID。

Team 写只有单次有界 owner HTTP 请求：最长 5 秒且服从调用方取消、1 MiB 响应预算、无重定向/自动重试。成功与错误均用生成的 IAM 0.3.0 Zod schema 验证；成功仅投影 `data`，错误按 status 与受控 owner code 分类，`LAST_OWNER`、`INVITATION_CONFLICT` 保留 409，`ROLE_NOT_FOUND` 保留 IAM 的 404，不套只读 GET 的 409→403。未知 status/schema/代码组合 fail closed 为 502，网络失败 503；所有公开结果 no-store/request ID。IAM 未提供 mutation receipt，BFF 不伪造幂等承诺；调用方在传输结果不确定时须重新读取 owner 状态而非盲重试。角色并发、最后 Owner 保护、邀请 pending 唯一约束与审计仍由 IAM 事务负责。

放置比较：复用现有 Team route/client 和公开 OpenAPI（采用，保持唯一入口与窄 owner adapter）；新 Team service/本地表（淘汰，会复制 owner 事实）；Web 继续旧 `/bff/*` 直连（淘汰，绕过统一 Product admission）。先更新三设计面与 public OpenAPI，再写失败测试并实现；BFF Node22 `pnpm check`，Root 在 IAM→BFF→Web pin 后做真组合。当前切片不改变 canonical schema 或普通 IAM admission。

## W1C-FIXED-TENANT-BFF-C：当前 Product 身份投影

**当前态（BFF `74ec30b`）：** 所有普通 `/v1` 请求已由 `src/bootstrap/server.ts` 在业务分发前调用 `authorizeUserRequest`，先校验 Web service 与唯一 Bearer，再校验固定 `KOKORO_TENANT_ID`，在线向固定 IAM admission 验证 token，并以受信 namespace/userId 建立 `RequestContext`。现有 Team GET 读取成员目录，runtime manifest 是 service-only，`/iam/get-session` 是 issuer 协议；均不提供当前 Product token 的窄身份投影。OpenAPI 当前 66 operation，无 `/v1/me`。

**目标态与位置：** 在既有 `src/bootstrap/server.ts` 普通用户 admission 成功后、所有 business store/upstream/receipt 分支前处理精确 `GET /v1/me`，仅把 `context.identity` 映射为 `{data:{user_id,tenant_id},meta:{request_id}}`。新增公开 OpenAPI beta `getCurrentUser`，`x-kokoro-permission: identity.self.read` 是本仓自读分类，不新增 IAM scope；不增加 route 文件或重复身份服务。错误沿用 admission 的 service/Bearer/IAM/fixed tenant 状态与码；所有结果 no-store，携带 `x-request-id`。不解析请求 body/query/header 中的身份；不带 query 的精确 GET 才命中。IAM 继续唯一拥有 Session/Identity/Tenant，BFF 只在请求生命周期内投影，不存储结果。

**替代比较与验证：** 复用 Team GET 会泄露成员目录、增加额外 IAM Team 权限和分页语义；复用 runtime manifest 无 user subject；私有隐藏 RPC 会破坏 public Product 契约。因此选择既有 HTTP composition 中的最小分支，不新建模块/进程/跨仓 owner。先同步 `docs/API_CONTRACT.md`、`docs/DATA_MODEL.md`、OpenAPI 设计，再 TDD 覆盖 same tenant、异租户、失效/撤权、缺配置、错误服务/Bearer、限流/故障、伪造字段，且零 BFF SQL/Redis/业务 owner I/O；最后更新冻结 operation baseline 并运行 Node22 `pnpm format:check && pnpm check`。Web 在 BFF 固定 commit/digest 发布后才消费，不由 BFF 代写 Web Session。

## W1C-FIXED-TENANT-BFF-B：收窄 browser-private tenant continuation

**当前态（BFF `dadf9264` / IAM `b363554d`）：** BFF relay policy `1.1.0` 准入 `/organization/list` GET 与未审查载荷的 `/organization/set-active` POST。普通 Product `/v1` 已在 IAM admission 前检查固定 `KOKORO_TENANT_ID` 是否配置、在 admission 后比对受信 tenant；独立 `/iam` relay 不经过这道 Product 闸。Web 现有选择页仍依赖 list 和可选 tenant 表单，因此本仓变更尚不能单独形成完整登录。

**目标态与放置：** IAM 仍唯一拥有通用 Organization、Session、OAuth continuation 与原生 `/organization/set-active`；BFF 仅在既有 `src/http/routes/iam-protocol-relay.policy.ts` 删除 list、提升 browser-private breaking version，在 `src/http/routes/iam-protocol-relay.ts` 的出站边界校验 set-active：受信 Web service、精确 Web Origin、有效名称且非空的 issuer session cookie、空 URL query、`application/json` 的精确 `{organizationId, oauth_query}` 字段集合、`organizationId === config.tenantId`，以及有界、合法编码且含唯一非空 `sig` 的原始 OAuth continuation query。BFF 不验证 IAM 签名；IAM 原生 handler 继续做密码学验签、Session、成员和状态校验。缺固定 tenant 在 IAM socket 前 503，异租户或非法载荷在 IAM socket 前拒绝。其他 relay endpoint 的身份、cookie、response/header/timeout 规则保持不变。仍由既有 Web same-origin adapter 与 BFF relay 双边准入，不扩建 Team 代理、SQL/Redis 事实或兼容 route。

**依赖与验证：** policy TS 是唯一手写事实源，`contract/iam-relay-policy.json` 仅确定性生成；public Product OpenAPI、IAM 原生 contract 与 `database/schema.sql` 不变。先更新三设计面，后以相邻 policy/真 HTTP 测试 RED→GREEN 证明 list/恶意 set-active 零上游 socket 和合法固定 tenant continuation 能送达 IAM；`pnpm format:check && pnpm check` 验证本仓。Web 消费方须在 BFF policy 发布后原子移除 list/选择表单，再由 Root 固定来源并跑真 OAuth 组合；本仓测试不宣称 Web 或 IAM 完成。

## W1C-FIXED-TENANT-BFF-A：普通 Product admission 固定部署租户（实现切片）

**当前态（基线 `7a7f3adf`）：** `KOKORO_TENANT_ID` 已解析为 `config.tenantId`，但仅供 service-only runtime manifest 使用；普通 `/v1` 在 IAM 在线 admission 成功后直接接纳其 `tenant_id`，所以其他有效租户的 Bearer 也能进入 Team 与 BFF 自有资源路由。

**本片实现与放置：** 扩展唯一普通用户入口 `src/auth/user-admission.ts`，保持 service envelope、唯一 Bearer 与 IAM 在线验证的顺序。凭据通过后若固定配置缺失，立即以 `503 product_tenant_not_configured` 停止，且不调用 IAM；IAM 成功后仅当已验证 `identity.namespace` 与 `config.tenantId` 精确一致才构造 `RequestContext`，否则以 `403 product_tenant_forbidden` 停止。`src/bootstrap/server.ts` 已在所有普通路由、body、receipt、数据库及 owner I/O 前调用此入口，因此不另建 Team middleware、租户目录或第二套鉴权。请求 header/body/query 的 tenant 不参与判定。service-only runtime manifest、Share、Scheduler callback 与独立 browser-private `/iam` 协议保持原路由顺序，不经普通用户闸；IAM 多租户事实与 Token 签发仍由 IAM 拥有。固定租户闸不授予同租户成员互读 BFF 私有资源的权限，现有 tenant + subject predicate 不变。

本切片不增加 Team 写投影、不修改 public OpenAPI operation、IAM contract、relay policy、BFF 表/索引、事务或 Redis；先以相邻 admission 测试证明缺配置与异租户在任何普通路由/副作用前拒绝，再跑完整本仓门禁。Root 在固定 SHA 上负责真 OAuth 异租户组合验收。

## W1C-Team-R2：IAM Team 只读 Product 投影（本仓实现，真实组合待验）

IAM main `68aa0da259df1f1ea9030936b8d5a46acba8c6ab` 是成员、邀请、角色事实的唯一 owner，内部 OpenAPI `0.3.0` 为消费来源。BFF 在既有普通 `/v1` service + user Bearer 在线 admission 后，增加 `GET /v1/team/{members,invitations,roles}` 三条只读公开投影。`src/http/routes/team.ts` 做查询与响应投影，`src/infrastructure/clients/iam-team.ts` 做有界 IAM I/O 与生成 schema 验证，`src/bootstrap/server.ts` 在普通准入后分发；本仓假 IAM HTTP 测试已通过，真实 IAM 组合待验。不在 `src/auth/` 存 Team 业务模型：该目录仍只负责入口身份；Team adapter 只在请求内持有已通过 admission 的 Bearer，调用 IAM 对应当前 tenant 三 GET，且不向其他 owner 泄露 token。`context.identity.namespace` 决定 IAM path tenant，不接受浏览器自报 tenant。

本方案沿用现有 route 与生成链，以独立有界 IAM Team 客户端隔离业务读取，优于新建 Team 服务或在 BFF 建 Team 表。`limit=1..100`、不透明 `cursor<=2048` 字符按 owner 契约准入；不缓存、不自动重试、不跟随重定向，取消与总 5 秒/1 MiB 预算贯穿 IAM I/O。成功只映射 owner 的 `data` 与 `meta.next_cursor`；IAM 不可用或响应不符 fail closed，响应固定 no-store、request ID 与稳定错误。三 GET 不覆盖本人未入组邀请、写操作、团队切换；这些需要后续 IAM owner 契约，不以旧直连或兼容层冒充完成。

## 1. Owner 与系统位置

```text
Browser
  -> kokoro same-origin /api/* adapter
  -> kokoro-bff public /v1 Product API
  -> IAM / System（含 model-catalog）/ Billing / Capability / Storage owner APIs
  -> kokoro-agent run ingress, control and execution history
  -> kokoro-scheduler generic job and occurrence dispatch
```

BFF 是公开 Product API 的唯一 owner；其他仓库只发布自己的 internal-owner contract。BFF 不跨库 JOIN，
不读取 Agent 或 owner Redis，也不复制上游 Domain Model。

## W1C-DB-BFF：单库中的固定 owner schema（源码已实现；待 Root 验收）

**当前态（`cd1c2600ea2a6e0716b07628822a49653964675a`）：** SQL-first 唯一 DDL 是
`database/schema.sql`，其中表与索引未限定 schema；`scripts/apply-schema.mjs` 只检查 `public` 表并依赖默认
`search_path`，`src/config/runtime.ts` 只校验 PostgreSQL URL scheme，`src/infrastructure/postgres/client.ts`
未固定连接的 `search_path`。因此当前代码不能宣称支持多个 owner 共享一个应用数据库。

**目标态与放置：** 同一个 PostgreSQL 数据库及应用账号中，BFF 唯一写入 schema 固定为 `kokoro_bff`；
`KOKORO_BFF_POSTGRES_URL` 必须显式携带唯一 `schema=kokoro_bff`，而 node-postgres 不会自动把该参数转为
`search_path`。BFF config、installer 和 runtime Pool 均拒绝缺失、重复、`public` 或其他 owner 的 schema 值，
并由代码对每个实际连接固定 `search_path=kokoro_bff`，不信任 URL 中可覆盖它的连接 options。运行时不自动建 schema，
readiness 校验 `current_schema()` 及关键表存在后再检查 Redis；
安装器在事务及按数据库+owner 限定的 advisory lock 下创建尚不存在的 `kokoro_bff`，从 schema 依赖 catalog 检查本 schema 的对象是否为空（包括 collation），
在固定 search_path 内安装现有 canonical SQL。其他 owner schema 或 `public` 已有对象不影响此判断；本 schema 非空、
并发重复安装均 fail closed，不改写旧表。DDL 失败回滚，不删除其他 schema，也不导入其他 owner DDL。
不引入 migration/第二份 schema、多 role、跨 owner SQL 或部署权限工程。

优先扩展已有 `scripts/apply-schema.mjs`、`src/config/runtime.ts`、`src/infrastructure/postgres/client.ts`
与其测试，不在 Root 建统一 installer，也不新建 `postgres/` 业务模块；`database/schema.sql` 的表定义保持唯一事实源。
本切片只更改连接/安装边界，不更改 HTTP/RPC contract、tenant/owner predicate、业务事务、Redis 或 generated client。
测试使用自身临时数据库或 schema，验证其他 owner 对象共存、误指向 public、重复安装、失败回滚及 runtime `current_schema()`；
安装后只核对目标 schema 与最小表/索引存在，`schema:check` 保留静态 canonical 门；列/类型/默认值/约束/索引的
全量 persisted catalog drift 尚待独立设计与验收，不能由本片宣称完成。完整 BFF schema/architecture/contract/test/build
与真实 integration 仍须复跑。旧默认 public 安装路径不保留 fallback。

## W1C-1：Web 同源 IAM 协议 relay（本次源码切片；待组合验收）

**起始基线（BFF `6238599667110fbfbc2d5ef3a9d53731f2623cfe`）：** `src/bootstrap/server.ts` 在 `/v1` 之外只处理
health/readiness 和 Scheduler callback；`/iam/*` 返回 404。普通 `/v1` 已经由 `src/auth/` 在线请求 IAM session admission，
但这只验证现有 Bearer，不能建立浏览器登录会话。本次源码切片已实现 relay，仍待 Root gitlink 来源门与真实正向 OAuth 组合验收。

**owner/依赖：** IAM `6bc9b190c359b8109238626ff689ce9839e858b5` 唯一拥有 Better Auth 1.7.3 issuer、OAuth client、
User/Session/Tenant 与授权码、token；Web 唯一拥有 Auth.js RP、Product Session、浏览器同源 `/iam` adapter；BFF 只拥有从
Web 服务身份到固定 IAM origin 的窄协议 relay。调用方向 `Browser → Web /iam → BFF /iam → IAM /iam`，与普通
`Browser → Web /api → BFF /v1 → IAM admission` 分开。BFF 不签发 token、不缓存 session、不访问 IAM schema/Redis，
也不将 `/internal/v1` 接到 `/iam`。Web 直连 IAM 和 BFF 代理通用上游均不采用。

**放置比较：** 采用现有 `src/http/routes/` 下具名的 `iam-protocol-relay` 路由，将精确路径策略、原生 HTTP 转发与
`src/bootstrap/server.ts` 的服务例外接线分开；其中 `src/http/routes/iam-protocol-relay.policy.ts` 是 BFF
path/method/request-header/cookie/response-header/redirect 准入的**唯一手写事实源**。不放到 `src/auth/`，因为那里只处理 BFF `/v1` 的用户 admission；
不放到现有 `src/upstream.ts` 通用 Product proxy，因为后者会注入业务 envelope/身份并丢失 OAuth redirect/cookie 语义。
从该 TS policy 由确定性脚本生成只读 `contract/iam-relay-policy.json`，作为 Web 消费的 `browser-private`
policy artifact；它仅发布 BFF 自有准入元数据，不复制 IAM endpoint 字段 schema。选择现有 `contract/` 而非
另建仅有一个文件的 `contract/browser-private/` 目录；不让手写 JSON 与 TS policy 双轨。artifact 固定
policy version、IAM owner commit、allowlist/snapshot digest 与有序 path/method/header/cookie/response 规则；
`pnpm contract:check` 的 --check 模式重生 policy JSON 并逐字节比对，禁止手改。IAM 私有 allowlist/snapshot
不复制入 BFF；Root 的独立组合机器门读取固定 IAM/BFF gitlink commit blob，核对两份 IAM 来源 digest、BFF
relay path/method 子集与 BFF artifact，并有篡改负例。Web vendor 快照固定 BFF commit 与 artifact
blob/SHA-256 digest，consumer test 断言准入集合和响应/cookie 规则；BFF policy 改变时先发布 owner 再更新 Web。
预计 `src/config/runtime.ts` 增加已验证的公开 issuer/Web callback 目标配置，`test/` 增加纯策略、HTTP 和真实 IAM fixture；
没有新顶层目录、业务模块、进程或数据库表。BFF policy 由自己的文件维护，不把 IAM 全部 allowlist 复制成第二个 owner contract。

**准入顺序与边界：** `/iam` 路由在普通 `/v1` admission/body/idempotency/SQL 之前独立匹配；先验
`x-kokoro-service: web-bff` 与 server-only shared secret，再对原始 URL 做精确、一次性的 ASCII path+method 匹配。
百分号编码、大小写变体、反斜线、双斜线、点段、非法 query/fragment、user-info/host override 与未知方法均在出站 socket 前拒绝；
不使用现有 `pathOf` 的 decode/filter 结果做准入。只连接配置时校验过的 IAM origin，不能由 `Host`、`Forwarded`、
`X-Forwarded-*`、query 或 redirect 改变上游。Web adapter 必须在浏览器入口丢弃任意 `Authorization`；BFF 不能仅凭同一
Web service secret 判断 Basic 最初来自浏览器还是 Web，因此 Basic 只在 `/iam/oauth2/token` 和 `/iam/oauth2/revoke`
的受信 Web server 调用传递，且由 Web 为自身已注册 OAuth client 生成；`/iam/oauth2/userinfo` 的 Bearer 也仅允许
Web server 使用 server-only user-delegated token 发起。其余 `/iam` 请求拒绝 Authorization/Bearer。
浏览器 cookie mutation 的 Origin 必须是配置中的精确 Web origin，并由 Web adapter 自行校验 CSRF；token/revoke 等
Web server-only 调用使用独立分支，不能借浏览器 Origin 冒充。Issuer session 路由仍由 IAM 原生 Session/Origin/CSRF
与权限验证，BFF 不自行认证用户或根据 cookie 建 Product identity。

**上游原语义：** OAuth/form/JSON 请求只转发经白名单校验的 Content-Type、Accept、Origin、必要请求 body 与 issuer cookies，
body 原始字节有界；不转发 Web service secret、Product Session/其他 cookie、任意浏览器 Authorization、客户端 `Host`、
forwarded/hop-by-hop headers。issuer cookie 准入与 `Set-Cookie` 回传由当前 IAM cookie 配置和 Better Auth 固定版本
锁定精确名称：`kokoro-issuer.session_token`、`kokoro-issuer.session_data`、`kokoro-issuer.dont_remember`、
`kokoro-issuer.session_token.oauth_logout_confirmation`，生产各名称加 `__Secure-`；仅在真实 owner fixture 证明
当前版本确需清理 chunk 时准入 `session_data.<非负十进制整数>`，不是开放 `kokoro-issuer.*` 前缀通配。保留每个合法
独立 `Set-Cookie`，不合并或改写成 BFF cookie。普通 issuer cookie 要求 `HttpOnly; SameSite=Lax; Path=/iam`，
生产另要求 `Secure`；唯一 logout confirmation cookie 的原生 Path 必须是 `/iam/oauth2/end-session/confirm`。
所有 issuer cookie 均为 host-only，拒绝 `Domain` 属性。原生 status、必要
`Content-Type`、`Cache-Control`、合法 `Retry-After`、`Location` 与 body 保留；logout HTML 的
`Content-Security-Policy`、`X-Content-Type-Options`、`Pragma` 经严格值校验后保留，hop-by-hop 等继续剔除，
不套 Product `{data|error}`。IAM 原生 429 的有界合法 `Retry-After` 也原样保留，不改写错误 body。
禁用自动 redirect、重试和缓存。仅固定 `/oauth2/end-session` GET 在 BFF 已完成 Web 服务身份和精确路由准入后，
由 BFF 自身合成 `Sec-Fetch-Mode: navigate` 并使用有界 Node 原生 HTTP 请求；Node fetch 会强制将该头改写为 `cors`，
使 IAM 原生无 ID token hint 的浏览器确认分支拒绝继续。入站同名头绝不透传，其余 relay 仍使用既有 fetch 路径；
两种传输共用同一 deadline、响应大小上限和 fail-closed 校验。`Location` 只接受精确公开 issuer origin 下已批准的 `/iam` GET 路径、
Web `/auth/sign-in|select-tenant|consent` 和配置中精确注册的 Auth.js callback/post-logout URI。
IAM OAuth Provider 的三种 Web 交互页会带动态**已签名 authorize query**（含 `sig`、`ba_iat`、重复
`ba_param` 等）；BFF 对这些页及注册 callback 的 raw query 只做 ≤8 KiB/合法结构/控制字符约束，按原始字节原样
转交，不解析后重排、不消费或伪造 IAM 签名，也不将 query 内嵌的 `redirect_uri` 当作新的 HTTP `Location`。
Web 续接时保留签名参数，由 IAM 原生 `/oauth2/continue|consent` 验证。BFF 只裁决实际 `Location` 的固定
origin/path，拒绝外域、任意 Web path、未注册 client redirect、CRLF、fragment、userinfo 或 scheme-relative URL，
且合法原生 Location 不重写。
整个入站 body 读取与上游 headers+body 共用从 body 读取前启动的单一截止时间，取现有 upstream 预算和固定 5 秒硬上限较小值；
上游响应 ≤1 MiB、请求 body ≤64 KiB、headers ≤16 KiB。请求超限在出站 socket 前拒绝；请求/响应提前关闭、
上游 header/body 超限立即 abort/cancel 真实 socket/reader，清理 timer/listener，不落业务副作用。IAM 不可用、超时、body/headers 超限、非法上游状态或
不可信响应头均 fail closed 为脱敏 502/503；只在收到上游响应后才能识别的恶意 Location/Set-Cookie 可有一次 IAM I/O，
但不得向 Web 输出恶意值。本地准入拒绝必须零 IAM socket，所有 relay 请求均零 BFF SQL/Redis/receipt/outbox。

**验证门：** `test/iam-protocol-relay-policy.test.ts` 证明 path/method/Origin/Authorization/cookie/Location 准入和零
上游 socket；`test/iam-protocol-relay-transport.test.ts` 证明多值 `Set-Cookie`、body/status/header、timeout/cancel/大小上限与
Product Session 不泄露；单独真实 IAM HTTP fixture 验证 discovery→authorize→sign-in→tenant→consent→token/userinfo
和 end-session/confirm 原生重定向与 cookie Path；正向断言三种 Web 交互页动态签名 query 原样保留并能续接，
以及原生 429 `Retry-After`、logout HTML `Content-Security-Policy`/`X-Content-Type-Options`/`Pragma` 被严格校验后保留。
响应必须先完成可信 header/body 校验再写 Web socket，不能先流出
半截 token/恶意 Location。合并门包含 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm contract:check`、
`pnpm test`、`pnpm build` 与 BFF owner 独立真实 HTTP；`pnpm contract:check` 必须包含
`contract/iam-relay-policy.json` 的确定性生成漂移门。本次源码切片已运行 BFF 本地门，但 Root 跨仓来源机器门与
正向 OAuth 成功链尚未闭环，不声称源码实现已验收。

**固定来源：** IAM `src/modules/auth/ingress/auth-routes.constants.ts` 在上述 IAM commit 的 SHA-256 是
`f63dacfa8a7bcec3c56efb8ffb762a3f8bd82bb380eff40a1462db1e77d61ead`；Better Auth snapshot
`contract/vendor/better-auth.v1.7.3.json` SHA-256 为
`b2eac1919e16fdc30a40bee0f3c4300b641bd8f674214aea7731bf10299559e1`。BFF 暴露的更窄路径矩阵和
精确错误策略在 [API_CONTRACT](API_CONTRACT.md#w1c-1-browser-private-iam-relay-目标尚未实现)，新增路径前要比较 owner
固定 commit/snapshot、执行真实协议测试，不把 IAM vendor snapshot 直接发布成 BFF public OpenAPI。

### R2e-IAM-VERIFY-RELAY：仅增加首次邮箱验证 GET（本仓已实现，待 Root 验收）

起始 BFF `eb1eb2926d08b8a3779898b2c31e604a8585ec8b` 的 relay policy/生成 artifact **没有**
`/verify-email`，Web 当前同源 GET 集合也没有该路径；正式验证邮件的 `${WEB_ORIGIN}/iam/verify-email?...`
因而尚不能贯通。IAM `093b76513a9aa71611c65d4f210e279d3227e002` 的固定 ingress allowlist 已发布
`GET /verify-email`；Better Auth 1.7.3 的有期签名 JWT、邮箱已验证幂等状态、错误与审计均由 IAM 拥有。本仓本次仅在现有
`src/http/routes/iam-protocol-relay.policy.ts` 增加 `"/verify-email": ["GET"]` 并将 policy 升至 `1.1.0`，再由既有生成链发布
`contract/iam-relay-policy.json`；复用 `src/http/routes/iam-protocol-relay.ts` 的服务身份、原始 target
准入和有界原生传输，不新建代理、模块、进程或 IAM schema 副本。Web 在 BFF 发布并经 Root 来源审查后，才固定
artifact commit/blob digest 并增加其同源 GET 路由；浏览器仍只走 `Browser → Web → BFF → IAM`，不直连 IAM。
当前仅重钉 IAM test-fixture owner commit 后，派生 artifact SHA-256 为
`731735ba8ce07c578fe04fa51783a95c7ac7daf50df33cea0ef9cefedc32d032`；policy version 与准入规则保持不变。

验证邮件链接的原始 query（尤其 `token` 与可选 `callbackURL`）在 BFF 只受现有 ≤8 KiB、百分号合法性、
控制字符与 raw target 边界约束；不得解析、归一化、重排、记录、缓存或把 token 提升成 BFF 凭据。
`callbackURL` 不是 BFF 的出站目标或另一个 `Location`：正式初次注册/受控开通流程须由 IAM owner 选择
`callbackURL=${WEB_ORIGIN}/auth/sign-in`，仅真实 IAM 返回的 302 `Location` 才按现有精确 Web origin 与
已批准 `/auth/sign-in` 路径校验。非法外域、任意 Web path、编码 alias、fragment、userinfo 或 scheme-relative
`Location` 均 fail closed；合法原生 status、必要 header/body 原样传给 Web，但此敏感 GET 的上游响应无论
IAM 缺失或提供可缓存的 `Cache-Control`，BFF 都固定覆盖 `Cache-Control: no-store` 与
`Referrer-Policy: no-referrer`，不自动跟随或改写重定向。BFF 自有拒绝/上游失败仍使用既有脱敏错误、
`x-request-id`、`no-store`；
已有 issuer cookie 白名单与 `Set-Cookie` 校验继续生效，Product cookie 不出站，GET 不接受
`Authorization`。本地拒绝须零 IAM socket；IAM 原生验证失败可产生一次有界 I/O，但不写 BFF SQL/Redis。
日志/trace 不包含原始 request target、query、token、`Location` 或验证响应 body。

本段只描述已发布 R2e verify-email 基线：该历史扩展不开放 `/sign-up/email`、`/send-verification-email`、
`/organization/create` 或任何其他注册/组织写入；本页 R5 目标随后只新增受限 `/sign-up/email`，其余仍关闭，
也不将 `/iam/*` 变成通配代理。首次正式账号与固定 tenant 的开通仍由 IAM owner 的受控 bootstrap 独立完成；
邮件验证只是其中必要一环，不等于 Product Session、OIDC client、tenant 成员或可登录入口已经就绪。
相邻 policy/transport 测试先 RED 后 GREEN，覆盖原始 query、原生 302、固定 no-store/no-referrer、错误方法、编码路径、外域
`Location`、Authorization 与 Product cookie；仍须由 Root 在固定来源上复验 `pnpm format:check && pnpm check`、
来源门及最终真 IAM 邮件点击/登录组合。本仓聚焦测试不冒充真实 IAM JWT 验证或用户可见入口。

**AG-UI 是 Web ↔ BFF 唯一 Agent 网络协议。** Vercel AI SDK 的 `UIMessage` 属于 Web 内部 view adapter，
不得成为第二套网络 envelope 或 resumable stream。

## 2. 当前物理实现（基线 `c5e9b3c`）

| 区域                           | 当前职责                                                                           | W1B 边界                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/main.ts`                  | 进程入口                                                                           | 不承载身份或业务规则                                                                                     |
| `src/bootstrap/`               | server composition、请求管线、route dispatch、worker 生命周期                      | Task 1 只装配 IAM admission 与显式服务例外；Task 2 在 receipt/owner I/O 之前接线资源授权                 |
| `src/config/runtime.ts`        | 运行配置与 URL/预算校验                                                            | Task 1 新增严格 `KOKORO_IAM_BASE_URL` origin；不增加环境变量测试旁路                                     |
| `src/http/routes/`             | Product route、System/owner projection、Scheduler callback                         | Task 1 抽出 runtime-manifest 服务路由；Task 2 新增 `chat-authorization.ts`，不把业务授权塞进 `src/auth/` |
| `src/application/`             | Project、ScheduledTask、Chat 与 AG-UI use case，必要的 repository/delivery port    | 延续现有业务能力聚合，不为 W1B 创建 Command bus、通用 ACL 或空层                                         |
| `src/domain/`                  | 当前确有独立不变量的 Chat、ScheduledTask、Project value 与 request context         | 是否拆分类型按语义/生命周期决定，不机械复制 DTO/Domain/Row/Wire                                          |
| `src/infrastructure/postgres/` | BFF-owned repository、durable ledger/outbox/receipt；Redis cache/notification 协调 | Task 2 修改现有 Project/ScheduledTask/Chat 数据访问；不创建数据库品牌目录的第二套实现                    |
| `src/infrastructure/clients/`  | Agent、Scheduler、Capability、Mori 等窄 owner adapter                              | Task 1 IAM admission 不放在这里，因为它共同负责 HTTP 入口身份建立，而不是普通业务 owner projection       |
| `src/generated/`               | Capability/Scheduler 固定契约生成物                                                | Task 1 增加 `iam-http`；生成物只由固定脚本产生，业务代码不得直接依赖其 wire 类型                         |
| `src/contracts/`               | 当前手写 BFF public transport types/envelope                                       | W1B 不借身份切片批量重构；字段事实仍以 public OpenAPI 为准                                               |

当前目录是已运行职责的事实，不是强制四层模板。新文件按单一变化原因放置；既有 `application/ports`、
`infrastructure/postgres` 或 `interfaces/http/agui` 不构成所有新业务必须复制的目录结构。

## 3. W1B 请求、身份与授权设计

### 3.1 `c5e9b3c` 起始基线

普通 `/v1/*` 当前由 `src/http/request.ts::authorize` 校验 `web-bff` 与 shared secret，再直接把
`x-kokoro-namespace`、`x-kokoro-principal-id` 组装为 `RequestContext`。这是待删除的自报身份入口；当前没有在线 IAM
session admission。`src/bootstrap/server.ts` 还会为 runtime manifest 制造 `userId: "runtime-manifest"`，这不是用户身份事实。
公开 Share 使用 service secret + share capability，Scheduler callback 使用独立 Scheduler bearer；它们当前和普通用户管线分支。
本段只描述起始 commit；3.2～3.4 是 Task 1 实现，3.5 是 Task 2 已实现的个人私有边界。

### 3.2 Task 1 本变更：单一用户 admission 链

```text
request id
  -> verify web-bff service + shared secret
  -> parse exactly one Bearer credential
  -> POST IAM /internal/v1/session-authorizations/verify (no body/query, no redirect/retry/cache)
  -> strict generated response validation
  -> RequestContext { namespace: tenant_id, userId: user_id }
  -> resource authorization
  -> body parsing / receipt / SQL / outbox / SSE / owner I/O
```

IAM 是 Tenant、Membership、Session 与身份唯一 owner；BFF 拥有入口准入和自己的业务资源授权。Task 1 固定消费 IAM commit
`259a66e6a569889c030734f380e99685d8b9e21c`、OpenAPI `0.2.0`、SHA-256
`f7a3ea2e5ae7ade82ae1a6756a2f560d3129ca1b2977c6b0905633a284bd3aab`。Node `22.22.2`、pnpm `11.25.0`、
`@hey-api/openapi-ts` `0.99.0` 与当前 lockfile 固定；生成入口只保留 `verifySessionAuthorization` 及其引用 schema，完整
vendor artifact 仍是可重复派生的来源。`src/generated/iam-http/` 只由脚本写入，manifest 记录精确文件清单和 digest；两次生成
必须 byte-identical。Node 22 / exact-optional compatibility 修正只允许存在于生成脚本，以固定模式和固定命中数 fail closed，
不得手改生成物或复制手写 IAM wire DTO。

`src/auth/` 采用四个职责清晰的文件：`session-admission.types.ts` 定义不含 generated 类型的窄 port；
`session-admission.transport.ts` 负责单次有界 HTTP、取消和 body cap；`session-admission.client.ts` 终止 generated schema 并归一失败；
`user-admission.ts` 依次执行 service、Bearer 和 IAM 验证后建立 context。对比把这些文件放进历史
`infrastructure/clients/iam`，这里采用 `src/auth/`，因为它们共同变化于入口身份建立，并且不能被业务 owner adapter 当作通用 IAM SDK。
production composition 默认构造真实 client；`sessionAdmission?: SessionAdmission` 仅是显式测试 seam。Bearer 只发送给 IAM，
不写入 context、数据库、日志、receipt 或其他 owner 请求。

`KOKORO_IAM_BASE_URL` 解析为 `iamBaseUrl: string | null`，只接受无 userinfo、query、hash 的 HTTP(S) origin。
缺失配置时普通用户请求返回 `503 iam_admission_unavailable`，production readiness 不宣称就绪；不得以 header identity、环境变量
测试开关或缓存决定降级。一次请求或一次 SSE 建连/重连都重新 admission；已经建立的 SSE 仍由现有 connection duration 有界，
Task 1 不宣称跨连接即时撤销。

### 3.3 IAM 失败、取消与响应约束

- IAM 只收到唯一 `Authorization: Bearer ...`、`Accept: application/json` 与受控 `x-request-id`；无 body/query、redirect、自动重试。
- 整个 headers + body 读取预算取现有 upstream 配置与硬上限 5 秒/1 MiB 的较小值；超限、timeout、transport、非法 status/
  envelope/header 都归一为 `503 iam_admission_unavailable`。
- 只有 `allowed: true` 且 `tenant_id`、`user_id`、`session_id`、`client_id` 全部非空的 strict 200 才建立 context。
  IAM 401 → `401 session_invalid`；403/404/409 → `403 session_forbidden`；429 → `429 session_rate_limited`，仅转发
  1..86400 秒的合法 `Retry-After`。
- IAM 响应必须有合法 `x-request-id` 和 `Cache-Control: no-store`；BFF 自己的 admission 响应也保持 canonical error envelope、
  `x-request-id` 和 `no-store`，不复制 IAM message/body。
- `request.aborted` 或 response 在完成前关闭时取消 IAM I/O；正常 request body end 不触发误取消。所有 listener、timer 与 reader
  都在完成或失败后清理；取消后不得继续 body 解析、receipt、SQL、outbox、SSE 或 owner I/O。

### 3.4 三个互不授权的服务例外

1. `GET /v1/shared/{shareId}`：service secret + active/unexpired Share capability，只读 Conversation 投影；不要求或使用用户
   Bearer，多带无关 Authorization header 不改变有效请求，也不授予 Run control、HITL、事件流或未分享文件。
2. `GET /v1/system/runtime-manifest`：service secret + server-side `KOKORO_TENANT_ID`/`KOKORO_DOMAIN`；显式 handler 只向 System
   发送 tenant/service 身份，删除 fake principal，不成为通用 service proxy。
3. `POST /internal/bff/scheduled-tasks/dispatch`：独立 Scheduler token、trusted event tenant 与 durable receipt/CAS；不接受 Web
   service secret 或用户 Bearer，也不由 IAM 故障改变其语义。

`GET /healthz` 与 `GET /readyz` 继续是 probe。上述边界都不是 IAM 不可用时的用户 fallback，彼此凭据不可互换。

### 3.5 Task 2 已实现：默认个人私有

用户业务 scope 统一以具名 `{ tenantId, subjectId }` 传递。Project、ScheduledTask、Conversation/Message、AG-UI events 和
Run control 对同 tenant 其他用户及跨 tenant 用户均 fail closed；资源存在性敏感的 detail/mutation/control/events 返回与缺失一致的
404。IAM admission 只证明身份，不替代 BFF owner predicate，也不根据 `x-kokoro-permission` 合成公开 API 的业务权限。

Project 新增不可由 body 指定的 `owner_id`，slug 域变为 `tenant + owner + slug`；Project revisions/skills/tasks 通过父 Project
predicate/lock 授权，不复制 owner 列。ScheduledTask 复用既有 `owner_id`；所有用户 list/detail/update/delete/retry 已增加 owner
predicate，create 在 task/outbox 同一事务中锁定并验证引用 Project 属于同一 scope。内部 Scheduler `findRecord(tenant, task)`
保留为具名服务语义，只供 callback 恢复已存 owner，不能被用户 route 复用。

Chat Conversation repository 的 `tenant + owner` predicate 现已同时验证非空 `project_ref` 指向同一 scope 的
Project；body/query 同时给出不同 `project_ref` 返回 400。query `scope` 只允许省略、空或 `direct`，其他值返回 400，绝不作为
tenant/授权来源。cancel/resume/steer 在通用 mutation receipt replay 与 Agent I/O 之前验证同 scope Conversation；Share 不进入该路径。
公开 Share 与 Scheduler callback 按 3.4 的独立边界保持可用，不新建团队共享、Project ACL 或通用授权表。

## 4. 幂等状态机

```text
missing key -> 400 idempotency_key_required
new scope   -> pending receipt -> execute -> terminal receipt
same digest + pending -> 409 idempotency_in_progress
same digest + terminal -> replay status/body
different digest -> 409 idempotency_conflict
5xx -> release pending claim so caller may retry
```

Live 且 business store 已配置时 receipt 位于 `bff_idempotency_receipt`；否则当前实现使用进程内 Map。pending claim
60 秒后可被回收。`c5e9b3c` 的 mutation fingerprint 已覆盖 method、canonical path、排序 query、canonical body、
content-type 与 `if-match`；scope 包含 namespace/actor/method/path/key。receipt 与普通业务写事务、通用 fencing 仍未统一。
资源 owner gate 现位于 replay/claim 之前，避免同 tenant 其他用户命中旧结果或制造副作用；repository/事务仍再次校验，避免 TOCTOU。

## 5. Project 与 ScheduledTask

Project 与 ScheduledTask 是 BFF-owned facts。`c5e9b3c` 的 repository 查询都携带 tenant id，但这只实现租户隔离：
Project 没有 owner 列，list/detail/slug/child mutation 和 Redis list cache 都是 tenant scope；ScheduledTask 虽已有 `owner_id`，
用户 list/detail/update/delete 仍只按 tenant 查询。当前实现已按 3.5 把用户路径收敛为 tenant + owner，并保留 Scheduler callback
所需的显式内部查询；Project Redis 列表 cache 与 invalidate 分支已经删除。关系完整性由同一事务内的 Application/Repository predicate 与锁维护，不使用数据库外键。

ScheduledTask 当前流程：

```text
validate input
  -> derive trusted tenant/actor/request/idempotency lineage
  -> BEGIN
  -> tenant + owner scoped project/task lock and task revision write
  -> write versioned Scheduler command to bff_scheduled_task_outbox
  -> COMMIT (fact and command are one local transaction)
  -> dispatcher claims with SKIP LOCKED + lease_token + fence
  -> call Scheduler outside the database transaction
  -> conditional succeeded/retryable/failed settlement
```

Outbox 不是通用跨域队列；每行只表示一个 `scheduler.register|replace|delete` command，payload 带 schema version、
task revision 和完整 tenant/actor/request/idempotency lineage。相同 `(tenant_id, task_id, command_type,
idempotency_key)` 只产生一个业务 command；同一 task 的较新 command 要等较早 pending/retryable/leased command
结束后再 claim。删除先在同一事务写 delete command，再删除 BFF fact，因此 Scheduler job 的外部删除可在进程崩溃后恢复。

Dispatcher 的 HTTP 投递是 at-least-once：lease 过期可被其他 worker 重新 claim，settlement 必须匹配 owner、token 和
fence；2xx 终结为 `succeeded`，明确的瞬时错误进入指数退避 `retryable`，超过 attempt budget 或永久 4xx 进入 `failed`。
Scheduler 注册的 409/404 只按稳定 job identity 做 register/replace reconciliation。mutation receipt 目前仍由外层
idempotency repository 单独 claim/commit，尚未与 task/outbox 合并为一个 receipt 事务。Task 2 已将 create 的稳定
`scheduledTaskId` 材料从分隔符拼接收紧为无歧义 JSON 数组 `[tenant, trusted subject, path, key]`；create replay、用户查询和
outbox lookup 不得跨 owner 命中。该修改不改变 Scheduler callback 的 opaque occurrence/key receipt scope。

## 6. Chat 与 AG-UI

### W1D-Chat-B2：同事务 assistant Message reconciliation（目标态）

当前 `commitProjection` 在一个 BFF PostgreSQL 事务内持久化 Agent source identity、AG-UI frame、
projection state 和 source high-watermark，但不更新首发时创建的 pending assistant `bff_message`；
`GET /v1/sessions/{id}` 还分别读取会话、消息和 ledger head，可能组合不同提交时刻。
目标把可映射的 `assistant.delta`、`assistant.completed`、`run.completed`、`run.failed` 投影意图
放入同一 source commit。Repository 先锁 AG-UI stream 并校验 version/lease，再仅通过本地
`bff_agent_dispatch_outbox` 的 tenant/session/run/subject 与 active Conversation owner，取得
`assistant_message_id`；source `chat_message_id`/segment ID 不作为 BFF row identity。
仅与 stream `expected_run_id` 相等的 run 可更新其 assistant row；旧 run 的 AG-UI 历史 frame
可入账但不能回写当前或历史业务 Message，已由 outbox 永久失败标记的 row 不能被晚到 source 复活。
当前 run 对 active Conversation 的 Message update 若影响 0 行，Repository 再检查 outbox/assistant
绑定；缺失或错位视为 source commit 错误，整体回滚，不推进 source watermark。无产品 Conversation、
deleted Conversation、failed outbox 或已终态 Message 是明确的合法跳过。Agent mapper 对 delta/content
要求字符串，畸形 source 在投影前拒绝而不以空串代替。

一个 run 只有一条 BFF assistant 业务 Message。多段模型/工具回合采用最后一个 assistant
segment 的正文（已实际发布的空正文也可）作为该 row 的快照表示，不拼接工具前中间段。新 segment 的首个 delta 重置正文，
同段后续 delta 追加；`assistant.completed` 使用 Agent source payload 的权威完整 content 覆盖，
但只保持 `streaming`，不把中间段误当 run 终态。只有 `run.completed(status=completed)` 把当前
正文标记 `completed`；`run.failed` 或 `run.completed(status=cancelled)` 标记 `failed` 并保留
已有正文。工具、subagent 和未知 source kind 不写业务 Message。source event 去重、body 更新、
AG-UI frame 与 high-watermark 一起提交或回滚；重复/replay 不追加第二次 delta。

公开 snapshot 改由现有 Chat repository 在同一 PostgreSQL `REPEATABLE READ READ ONLY` 事务
读取 owner-scoped Conversation、最新 100 条 Message（选择时倒序截取，响应时按 sequence 稳定升序）
与最新 ledger cursor，确保正文/status 与
`event_watermark` 指向同一数据库快照；仍不把 AG-UI ledger 当 Message 产品事实源。
Agent owner main `520ec181a101298b4f336aad273ce003b2735955` 已在真实 replay
发布空 `assistant.completed(content="")`；BFF 对收到的空终帧照常覆盖草稿正文，
只对实际已发布的 source 作上述保证，不合成缺失终帧。BFF 工作树与 Agent 已发布 owner
实现的组合验收仍由 Root 执行。

### W1D-Chat-B1：本地新会话首发 admission（目标态）

当前 `POST /v1/sessions/{id}/messages` 在通用 receipt 前要求现存 BFF Conversation，
`commitChatTurn` 也只锁定现存 active row；Web 本地生成的 `conv_<UUID>` 因而首发返回 404。
目标只对该 POST 的合法 `conv_<UUID>` 缺失 ID 允许进入 Chat 事务；其他读写与非该格式的缺失 ID
继续返回 404。`conv_*` 仅是候选创建格式，不是身份、所有权或既存资源访问凭据。

在唯一 `PostgresAgentDispatchOutboxRepository.commitChatTurn` 的同一 PostgreSQL 事务内，
非空 Project 先按 tenant + subject 锁定并重验，再用
`INSERT ... ON CONFLICT DO NOTHING` 建立由受信 IAM tenant/subject 所有的 active Conversation，
再以 tenant + subject + active + project predicate 锁定它；全局主键已属于其他 owner/tenant 或
deleted tombstone 时不更新、不复活，并与普通缺失一致返回 404。非空 Project reference 在事务内
按 tenant + subject 重验并锁定现有 BFF Project；不能用客户端 ID 或预检替代事务授权。
新会话标题由首条已校验用户内容 `trim()` 后取前 24 个 Unicode code point，截断时追加省略号，
不接受客户端自报 title，保证非空且不超过既有 200 字符约束。之后沿用既有锁顺序与
idempotency lookup → 两条 Message → Agent outbox → expected-run registration → Conversation 更新，
整个事务提交后才返回 202；同 ID 并发由主键冲突等待及 Conversation 行锁收敛，
同 key 同 digest 重放原 receipt，不同 digest 返回 409。不存在新的 API、表、外部 I/O 或 AG-UI 投影逻辑。

当前 Live event 流分成后台投影与公开读取两条单向路径：

```text
AgUiProjectorRunner (process lifecycle)
  -> seed/register eligible BFF Conversation scope
  -> claim (tenant, session) with SKIP LOCKED + lease token + monotonic fence
  -> fetch Agent source events after bff_agui_stream.source_high_watermark
  -> validate owner contract, tenant/session identity, sequence and snapshot watermark
  -> BEGIN + lock stream row + verify version and consumer fence
  -> register source identity/digest + project all AG-UI frames + advance state/high-watermark
  -> COMMIT
  -> settle progress/retry/blocked + best-effort Redis PUBLISH

GET events
  -> verify BFF-owned Conversation in trusted tenant + subject scope
  -> resolve Last-Event-ID against (tenant, session) in PostgreSQL
  -> read committed rows strictly after public_sequence
  -> @ag-ui/core validation -> SSE
```

`bff_agui_stream` 以 `(tenant_id, session_id)` 为 scope，保存 source high-watermark、下一内部 public sequence、持久化
projection state 与乐观 version；事务同时持有 row lock。`bff_agui_source_event` 以 source event id 为主键，并对
source sequence 建第二个唯一约束；相同 identity 的不同 digest/sequence 触发稳定失败。`bff_agui_event` 为每个 AG-UI
frame 保存完整 JSON payload、source mapping、frame index、单调内部 sequence 与独立随机 `agui_*` cursor。

客户端只把 SSE `id` 原样作为 `Last-Event-ID`；cursor 不编码 authority。Repository 先用 tenant + session + cursor
解析内部位置，再按 tenant + session + public sequence 查询。跨 tenant 或同 tenant 跨 subject 请求先按 Conversation owner 边界返回与普通缺失
一致的 `404 session_not_found`；当前 session 内格式错误或未知 cursor 返回 `400 invalid_event_cursor`。一个 source fact
的多 frame 在同一事务提交，但每帧有独立 cursor；连接
恰好在 START 后断开时会从 CONTENT 继续，不会把 source sequence 当作已完成整个 projection。

PostgreSQL 是 public replay 的唯一 durable truth。Redis 只 `PUBLISH` hash-scoped 更新提示，不存 event、cursor 或
high-watermark；通知失败不回滚事实。后台 runner 与 HTTP 生命周期独立，公开连接只以 bounded ledger polling 等待新
commit，不会变成第二个 Agent consumer。终态 ledger 在 Agent unavailable/disabled 和 BFF 重启后仍可独立 replay；
非终态且 projector 未配置时 fail closed。

consumer 状态与 stream 同 row：subject、next poll、lease owner/token/until、递增 fence、连续失败计数、最后错误和最后
完成时间均持久化。`expected_run_id` 表示最新接纳的 run，`latest_run_id` 只表示最近投影的 source run；旧 run 可以补投
历史 frame，但只有 expected run 的终态可以关闭 public stream。claim 的到期判断和 deadline 由 PostgreSQL 时钟计算，
并把剩余 lease budget 返回给 worker；runner 与 source client 在进程内使用 monotonic clock 消耗该预算，wall clock 只用于
日志/协议时间。注册不同 expected run 时，同一事务递增 stream version/fence、撤销旧 lease并清除旧 terminal；旧 worker
即使晚到也无法通过 commit/settlement 条件。projection state 以 run identity 隔离，某个 run 的终态只清理该 run 的
message/tool 状态。每次 source read 受 attempt budget 和 lease
deadline 共同限制，并为事务 settlement 预留时间；瞬时失败跨 claim 使用持久计数驱动 capped exponential backoff +
jitter，并在配置上限内尊重 `Retry-After`，成功 poll 清零。source gap 耗尽内部连续性预算、不符合 contract、重复
identity、永久 HTTP/容量错误把 scope 置为 blocked，避免静默跳过。
stream 持久化最新 `RUN_STARTED` 的 public sequence；GC 仅删除该边界
之前且早于 retention cutoff 的旧 run frame，并完整保留从边界到当前 head 的 run slice。没有可靠边界，或保留 suffix
中存在找不到同 run `RUN_STARTED` 的交错 frame 时跳过回收。
删除前写入有界 cursor tombstone，并推进 retention floor。tombstone 存续时返回 `410 event_cursor_expired`。

Agent 自有 event wire 的时间编码由 Agent contract 决定（当前 client boundary 保留其 epoch-millisecond 形状）；BFF
在 projection adapter 边界解析为 UTC instant，BFF domain/application/数据库事实不把 epoch 数字当作时间。该约定不
改动 Agent Run 或 Agent outbox。

Conversation、Message、Share 的产品事实由 BFF PostgreSQL canonical tables 与 ChatApplicationService 持有；Agent 只
拥有 Run、checkpoint、lease、tool journal、执行事件、HITL 与 evidence。Live session list/detail/message history/title/
delete/share routes 只读取 BFF facts。Message create 由 `ChatTurnApplicationService` 在一个本地事务内追加 completed user
message、pending assistant message、Agent dispatch outbox command，并注册同一 expected run 的 AG-UI consumer；HTTP
提交后即返回 `202`。后台 `AgentDispatchOutboxDispatcher` 在事务外以稳定 run identity、`SKIP LOCKED`、lease token/fence
和有界退避调用 Agent。AG-UI ledger 仍独立保存 Agent execution projection；W1D-Chat-B2
在 source commit 内同时维护 assistant Message 产品事实，不复制 Agent 的 ChatMessage row。

## 7. 出站与失败归一

W1D-Chat-B3 的 Agent 出站成功 wire 在 `src/infrastructure/clients/agent/http-wire.ts` 由固定
`src/generated/agent-http/` Zod 终止；`outbox-delivery.ts` 和 `projector-source.ts` 继续使用既有有界
`proxyUpstream`、服务身份、lease budget、重试与 seq 连续性，不再经通用 owner 响应 normalization 补
`meta` 或包装裸 data。generated 只含两个 Agent operation，来源治理见 `contract/dependencies/agent-http.json`。

出站 HTTP 使用整体 timeout、响应大小上限、request id、Forwarded 与服务凭据。当前 transport 不自动重试；调用方
只在具备稳定幂等 identity 时重试。缺配置、不可达、HTTP error 与 schema mismatch 分别映射为稳定错误，且不返回
provider body、SQL 或 stack。

## Storage v2 handoff history（旧 503 阶段，已由上文个人文件片替代）

Storage 继续唯一拥有 Asset、Artifact、Blob、Upload 与对象生命周期事实；BFF 只拥有 public Product API 的 Library
入口。当前唯一消费协议是 Storage Proto v2 over ConnectRPC，不保留旧的 `/internal/bff/library` HTTP transport，
也不建立临时 adapter、fallback 或双读。

在 W2 前，IAM admission 通过后的 `GET /v1/library` 固定返回 `503 storage_integration_unavailable`；准入前按 Task 1
规则返回 401/403/429/503，其中 IAM 不可用为 `503 iam_admission_unavailable`。该响应完全在
BFF 本地构造，不打开任何 Storage socket 或连接，不创建 PostgreSQL 事务、Redis cache、receipt 或 outbox。
这是当时的全 Library/Artifact 前置口径，不适用于上文已分出的个人 `kind=file` 首片：该首片只依赖
Storage 已发布的 `web-bff + personal` CLEAN ASSET ListAssets、当次本人 admission 和单 kind 分页。
Agent Artifact、Capability 关联与 `kind=all` 仍须分别完成可信 Run/ExecutionIdentity、能力 scope 和双源分页后发布；
个人文件通过不等于完整 Library 或 `EDGE-BFF-STORAGE` 全边激活。

## Platform 3.1 read consumer cutover（当前实现）

五个 GET 已统一沿 `src/http/routes/platform-projection.ts` 到 `src/infrastructure/clients/platform/projection-http.ts`；唯一 pin 是 owner 3.1.0 OpenAPI/generated HTTP，旧 Capability 2.0.0 manifest、vendor、generated 与 facade 已删。current IAM Product user/tenant 每次入站先验，出站独立 `platform:projection.read` 短期 workload token；list/MCP 用 owner-native 字段，by-ID 严格七字段。未创建 BFF Skill/MCP SQL 或兼容 fallback。真 owner 组合与 Web consumer 尚待 Root 验收。

## 8. 启动与关闭

- Mock 是本地确定性 fixture，不需要 PostgreSQL/Redis；它不是生产完成证据。
- Live BFF-owned 路由要求 PostgreSQL + Redis；`/readyz` 检查可用性。AG-UI committed replay 只读取 PostgreSQL，
  但 Redis 不可用仍会使整体 readiness 失败。
- 监听后启动 AG-UI projector、ScheduledTask dispatcher 与 Agent dispatch dispatcher；它们只 claim
  due/eligible/expired-lease rows。
- graceful shutdown 先停止 projector 与两个 dispatcher、等待当前 bounded cycle 并释放仍持有的 lease，再关闭 repository；
  尚无完整 HTTP request drain 或 termination budget。

## System consumer cutover

BFF 的窄 owner adapter 位于 `src/http/routes/owner.ts`，解析与公开投影位于
`src/application/projections.ts`。runtime manifest 与 model catalog 共用唯一
`KOKORO_SYSTEM_BASE_URL`；前者调用 `/v1/system/runtime-manifest`，后者调用
`/v1/system/model-catalog/catalog`。本切片不增加持久化事实、运行层、fallback 或第二套 owner client。

## Scheduler control and receiver cutover

**W0B-9 BFF runtime 已实现。** Scheduler 唯一维护 control `internal-owner` 与 dispatch `event-protocol`；
BFF 拥有 ScheduledTask、consumer 验证与本仓 receipt。固定 producer commit
`92bf9e7e6724c591bab4b7fa27f08d694b59a67e`、version `1.0.0`，来源是
`contract/openapi/v1/openapi.yaml`，SHA-256 `6ec2f6d5d71efa60b92bba1eb2dd0c81b7439734e2bc4450caa221e952e24183`。
原始 commit blob 只读保存到 `contract/vendor/kokoro-scheduler/<commit>/openapi.yaml`；
`contract/dependencies/scheduler.json` 状态为 `generated`，记录 provenance/config/lockfile 与 16 个生成产物 digest。
`openapi-ts.scheduler.config.ts` 固定本仓既有 hey-api 0.99.0、TS 5.9.3、Zod 4.5.4、Node 22.22.2、pnpm 11.25.0，
目标为 `src/generated/scheduler`。采用 bundled fetch、flat SDK、grouped params、fields response、Zod response validation、
clean output 与 `.js` import；不新增 fetch package。正式生成、固定命中数 exact-optional compatibility normalization 与双生成 byte-identical drift 门已接入 `contract:check:scheduler`。

### 两个窄边界与放置决定

| 边界                     | 目标位置与职责                                                                                                                                 | 依赖与删除项                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Control client           | `src/infrastructure/clients/scheduler/control-client.ts` 终止 generated SDK/Zod，把 ScheduledTask outbox command 映射为 owner Schedule command | delivery 只调用该 client；删除旧资源路由、旧稳定错误码和手写 Scheduler wire type                                                   |
| Webhook contract         | `src/infrastructure/clients/scheduler/webhook-contract.ts` 终止 generated producer webhook schema，输出本地已验证 dispatch input               | `src/http/routes/scheduler.ts` 只做认证/解码/协调；删除旧 job header、compact occurrence 和自行拼接幂等 key                        |
| Durable receiver receipt | 专用 application port 与 `src/infrastructure/postgres/scheduler-dispatch-receipt-repository.ts`                                                | 复用本仓 receipt 表而非通用 mutation claim/release；经 `BffBusinessStore` 与 `repositories.ts` 装配；不直接访问 Scheduler/Agent DB |

复用现有 owner client、postgres、port 目录优于新增一级 Scheduler 模块；尚未做 feature-first 全仓重组，不借本切片搬目录。
vendor/manifest 优于 Root 可编辑 contract 中心；producer webhook 不复制进 BFF public OpenAPI。generated 类型只在上表前两个
边界内部使用，禁止 application/domain import，也不从 sibling 源码 import。BFF-specific payload 是 BFF 的业务映射，
不是第二份 producer event schema。hey-api 的 webhook TypeScript request type 当前未覆盖 headers；receiver 使用
`zDispatchScheduleOccurrencePostWebhookRequest` 的生成 Zod schema（类型由 Zod 推导），不手写替代 owner headers。
隔离临时目录生成已核实 opaque body 为 `z.record(z.string(), z.unknown())`；该生成 validator 用于 acceptance，但 Zod transform
可能删除顶层特殊键，因此 receiver 在 acceptance 后保留原始 parsed JSON 作为 digest/本地映射事实，并递归验证 finite JSON。
receiver 继续单独验证 BFF payload，不把 opaque body 当成已通过业务授权。该可生成性检查不是正式 runtime/drift 验收。

Control client 从受信 command tenant 构造身份，消费 `createSchedule` / `replaceSchedule` / `deleteSchedule`；
register 的 `409 schedule_already_exists` 才转 replace，replace 的 `404 schedule_not_found` 才转 create，
delete 的同码 404 视为已删除。每次 method/path/body 重放沿用稳定 command key；不按 message 或任意 409/404 推断成功。
每次网络尝试有 timeout/响应大小限制；response stream 逐块计数，超过 hard cap 立即 cancel reader 并 abort 请求，
不在 `arrayBuffer()` 完成后才判断。retry 由现有 bounded outbox 管理，不在 generated client 隐式无限重试。
日/周规则使用 ScheduledTask 本地 `time` + IANA `timezone`；周日由 `nextRunAt` 在该 timezone 下的日期确定，
交给 Scheduler 处理后续时区/DST 触发，不继续把当前 UTC hour 固化为全年周期。稳定 schedule name 保持 BFF task 映射；
旧 `buildSchedulerJob` 的 UTC cron 与无顶层 timezone 的输出是待替换现状，不是目标契约。

### Receiver 执行与故障恢复

精确身份、digest、状态码见 [API_CONTRACT](./API_CONTRACT.md#scheduler-control-and-event-dependency)，数据/CAS 见
[DATA_MODEL](./DATA_MODEL.md#scheduler-receiver-receipt-design)。流程为：

```text
authenticate Scheduler -> generated webhook + local payload validation -> tenant integrity check
  -> semantic digest + deterministic occurrence identity
  -> durable key/digest claim (or conflict / terminal replay / retryable busy)
  -> first admission: validate tenant-scoped stored task + owner, persist immutable launch snapshot
  -> Agent call outside DB transaction, replay same snapshot after response-unknown
  -> fenced durable terminal receipt -> HTTP acknowledgement
```

Run identity 固定为 `run_bff_` + SHA-256(UTF-8 JSON.stringify([trustedTenant, scheduleName, canonicalOccurrence]))；
数组编码避免分隔符歧义，不依赖 actor、request ID、body 或 opaque key。Agent launch adapter 接受此稳定 occurrence identity，
message/assertion identity 同步派生；鉴权仍核对 stored task owner，不能用稳定 ID 替代权限校验。首次 admission 的 actor、
内容、project、session、Run/message IDs 与 Agent request body 保存在 durable snapshot；恢复使用原 snapshot，
不按后来修改的 task 或新 request ID 重造 launch。新 receipt 的 admission 仍校验任务 active/expiry/owner；
已提交 terminal 重放不重新执行，已经授权并冻结的 response-unknown 操作继续解析原结果，不变成一次新的任务执行。

外部 HTTP 请求允许重复，Agent Run 事实不得重复；网络调用次数不等于 Run 数量。Agent 接纳后、BFF receipt 落盘前崩溃，
下一次 reclaim 重发同一 Run identity 和 snapshot；禁止创建替代 Run ID。端到端唯一 Run 依赖 Agent durable admission
幂等返回原 Run，这是待后续 Agent-owner closure（W4）验证的依赖，不是本波已证明的事实，也不是跨服务原子事务或 memory Map 的保证。
W0B-9 证明 BFF 真实 PostgreSQL receipt/CAS、BFF 重启恢复与稳定输出；W0B-10 使用真实 Scheduler + BFF + Agent receipt stub，
证明响应丢失后，仅 BFF 重启恢复并接收保持运行的 Scheduler 重试；不重启 Scheduler。
真实 Agent admission、同 Run 参数冲突和 Agent 重启后的唯一 Run 事实属于 W4，
`EDGE-BFF-AGENT` 保持 broken；stub receipt/HTTP 调用计数不证明真实 Agent 的持久幂等，不据此扩大本波范围。
Agent 返回与期望 Run 不同、响应非法或结果未知时保留原 receipt，返回可重试
网关错误；不要把网络断开当作“Agent 未执行”。5xx 不删除 key/digest；stale worker finalize/release 被 token 拒绝。

receipt CAS 先 `FOR UPDATE` 锁定 row，再读取 PostgreSQL `clock_timestamp()`；事务开始时冻结的 `CURRENT_TIMESTAMP` 不参与
锁等待后的 eligibility/deadline。claim 与 prepare 返回数据库观察到的剩余 lease，route 用 monotonic elapsed 消耗它，
并在 Agent I/O 前扣除固定 settlement reserve；即使普通 upstream timeout 配置超过 60 秒，也只把专用剩余预算传给 transport。
预算已过期/耗尽或 stale prepare 零行时不开始 Agent 网络请求，普通 Chat adapter 不走此分支。

Scheduler 采用有界重试；receiver 活跃 lease 返回 425，不返回会被 producer 当永久失败的 409。超时 receipt 可有界 reclaim，
失败持久化 retryable 状态而不是永远 in-progress。若 producer 重试预算耗尽，需要运维按同一原始 occurrence/key 重投并审计，
本切片不声称已有自动 reconciliation worker。缺少 durable store fail closed，绝不退回进程内 receipt。

## W1E Product Skill mutation 设计门（2026-09-28，目标态）

基线 BFF `1105553cfc24d4f44a90f626132bc30323a77946`；本节是后续实现约束，不改变前述当前 HTTP consumer。
当前 `src/http/routes/owner.ts` 只实现 Skill 三个 GET 与 MCP 一个 GET，其余 Skill 路径返回
`503 capability_projection_not_configured`。Platform 物理仓仍为 `apps/kokoro-capability`，盘点 commit
`ee25c1f4d6df08be183ca10f7f5e852e0b21f641` 的 `SkillCatalogService` 有六条 mutation，尚不具备 Product 当前用户授权闭环。

### 放置与 owner

| 项         | 决定                                                                                                                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner      | BFF 拥有 Product session admission、个人私有/显式分享策略、Project/Conversation 事实与 public API；IAM 拥有组织成员/角色/Skill 动作判断；Platform 拥有 Skill catalog/revision/install 与 receipt；Storage 拥有 package asset/scan |
| 评审时事实 | IAM manifest 固定 0.6.0；Capability HTTP manifest 固定 2.0.0；BFF 无 Skill catalog mutation 实现，无本片未提交代码                                                                                                                |
| 目标职责   | 受信 session → 当前资源权限 → owner mutation；四 scope 全部受约束，不以 user-only 首片代表完成                                                                                                                                    |
| 目录比较   | 采用既有 Product `src/http/routes/owner.ts` 入口与 `src/infrastructure/clients/capability/` adapter 边界演进；淘汰 generic auth/role 下另建 Skill 权限中心及 Root 可编辑 contract                                                 |
| 粒度       | 本片只扩四份既有文档；后续 transport schema、业务授权编排、IAM/Platform client 按不同变化原因拆分，代码片另给精确放置表，不把所有职责塞入 owner.ts                                                                                |
| 依赖       | session admission 产出可信 tenant/subject；业务授权消费 IAM SDK 和本仓 Project/Conversation 查询；generated wire 类型在 adapter 终止，禁止 sibling import/跨 owner SQL                                                            |
| 数据/API   | 目标是同步 owner command，不新增 BFF Skill 表、缓存 allow 或 durable mutation receipt；public canonical OpenAPI 由 BFF 后续发布，Platform metadata/Proto 由 Platform 先发布                                                       |
| 删除项     | 激活对应 mutation 时删除其旧 503 占位；Platform 完整 cutover 同片删除 Capability HTTP vendor/client/manifest/config 与旧 name/enable/disable/import alias，不留 fallback 或双协议读写；不误删尚无替代的其他拒绝路径               |
| 验证       | 下述分阶段门禁；本片仅文档检查，不把设计稿视为机器契约或运行验收                                                                                                                                                                  |

### 四类 owner scope 的 Product 判断

`owner_scope` 是资源选择条件而非权限声明；tenant 与 subject 只来自当前 IAM admission。对已有 Skill/version/installation，
先由 Platform tenant-scoped 事实解析真实 owner，禁止用请求 body 覆盖；Platform 在 commit 与 receipt replay 前复核相同绑定。

| scope        | Product 当前权限来源                                  | 约束                                                                                                                                                                              |
| ------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| user         | BFF 比较 owner id 与当前 subject                      | 默认个人私有；显式分享只授予既定读取/使用能力，不自动授予编辑/发布；其他用户 ID 不获得写权                                                                                        |
| organization | IAM 0.7 `checkTenantSkillAuthorization`               | owner id 必须是 admission 的当前 tenant；每次使用同一具名用户 Bearer 和准确 action 在线 check，返回 tenant/subject/action 全匹配才允许；不缓存 allow，不用 BFF machine token 代替 |
| project      | BFF 当前 Project tenant + owner predicate             | 查询本仓真实存在且满足 tenant + owner 的当前可访问 Project 行；目前个人 owner 才有写权，组织成员资格不自动获得 Project 权限；未来协作者权限须由 BFF 独立设计，不复制 IAM role 表  |
| session      | BFF 当前 active Conversation tenant + owner predicate | Product session 必须解析到本仓 Conversation，不能信任客户端 session_id 或 Agent Run；删除/跨 owner/跨 tenant 均拒绝；如关联 Project，同时检查当前 Project 可访问性                |

调用顺序为 admission → 解析真实资源 owner → scope/action check → 注入受信 Product 上下文 → Platform owner 校验/执行。
用户 Bearer 只送 IAM，Platform 使用自身 workload admission 加受信 Product subject/owner/action 绑定；仅 workload+tenant 不足以授权。
该 Product 上下文的可验证承载、有效期、受众、撤权重查及 replay 语义必须由 Platform owner 发布机器契约后再消费，
不得把 `execution_proof`、body owner_scope 或普通自报 header 当成现成 Product 授权。Project/Conversation 在远端调用前重新检查；
本地事务不跨网络持锁。跨 owner 不宣称原子撤权：在授权检查后发生的并发撤权竞态须在 owner 协议中明确时点与拒绝策略，
未关闭该前置前不开放 mutation。后续每次请求与重放均重验当前权限，旧 receipt 不是授权凭据。

### 来源 pin 与实施次序

1. BFF 当前 pin IAM owner `e3c035b99cf9479ac8357c7d38147f1541dcbcac` 的 internal OpenAPI 0.7.0，原始 SHA-256
   `c8d7af8a365ad5d13eaabccf7f31133e0918ef198bdc3e7c790d90933eae91b2`；更新 vendor/manifest/生成 SDK 及 relay provenance，
   四项 owner 输入与前一 `4d981441` pin 逐 byte 相同；本次只更新 vendor/provenance，不加入 browser relay，不改变现有 session/Team/Skill 行为。
2. BFF 授权逻辑先以四 scope/action 契约测试实施；Platform owner 随后发布 Product 受信上下文、真实 owner 查询及当前权限/receipt 协议，
   Storage owner 发布可消费的 package upload/clean/digest 契约。BFF 不自行编造 owner DTO、身份头或上传成功。
3. 固定 Platform/Storage commit、version、digest 并生成 consumer；按各操作前置逐项接通 BFF catalog public mutation。
   Storage→Platform Begin/Complete 上传链及已持久化包绑定是 Validate/Publish 激活的硬前置，必须先接通并以真实 owner 验证；
   前置未就绪时 Validate/Publish 保持 fail closed，不宣称六条 mutation 均可成功，也不以任意 asset/hash 或 stub 绕过。
   随后处理 installation 与完整 Capability HTTP cutover；不把必需的 upload 链拖到六 mutation 激活之后。
4. Web 同源 adapter/scope UI 消费 BFF public contract；Root 验证 IAM/BFF/Platform 当前授权与撤权，以及前述真实 Storage 包绑定链和浏览器链路。
   三 owner smoke 不替代 Storage、Web 或四 scope 全链验收。

后续 Node 22：`pnpm format:check && pnpm lint && pnpm typecheck && pnpm contract:check && pnpm test:architecture && pnpm test && pnpm build`；
本仓 schema 门为 `pnpm schema:check`，fresh install 与真实 integration 用隔离空 `kokoro_bff` schema 的
`KOKORO_BFF_POSTGRES_URL=... pnpm db:apply-schema`、`KOKORO_TEST_POSTGRES_URL=... KOKORO_TEST_REDIS_URL=... pnpm test:integration`。
Root 真实三 owner Skill smoke 目前尚无已批准专用命令，须在 Root 任务卡建立隔离 runner 与明确命令后执行，
不得以现有 System smoke 或 fixture unit 替代。场景必须覆盖四 scope、六 action、tenant/subject 伪造、撤权后同 key replay、
当前资源删除、超时、owner digest 冲突、响应丢失后同 command 恢复及无权限时零 mutation I/O。

## W1E IAM 0.7 consumer 仓内实现

本片只履行前述来源 pin 第一步。`src/auth/skill-authorization.client.ts` 拥有组织 Skill action 的窄 IAM 调用；
`skill-authorization.types.ts` 承载其输入/结果，action 由固定 owner generated type 派生。它不拥有四 scope Product 编排。
相较塞入 `SessionAdmissionClient.verify`，独立具名 client 保持身份建立与组织业务动作检查分离；相较另建网络 transport，
复用现有 `SessionAdmissionTransport` 的超时/取消/组合 header+body 限额更少重复。transport 新增具名 Skill 方法，
私有 send 仅由两个固定 owner 路径调用，原 Session bodyless POST 不变，无文件搬迁或遗留双轨。
所有 200 结果均按 generated schema 严格校验外层及 data，且匹配输入 tenant/subject/action；异常统一 fail closed。
SDK generated operation 已发布到本仓生成物；窄 client 沿用现有 admission 有界 transport 与 generated validator，
而非借通用 fetch 绕过响应预算。当前 client 尚无生产 Product mutation 调用者，不据此宣称组织 Skill 写已开放。

## W1E user CreateSkillDraft 实施设计门（候选 runtime 已实现、默认关闭、真 sandbox 未验）

### 当前事实与本片边界

实施前历史基线 BFF main `55b2809b2f73addbac2b56bd8a04aa0c1706521b` 已有 IAM 0.7 用户 admission 与窄
`SkillAuthorizationClient`，但没有 Platform Connect consumer、catalog workload credential 或 public `POST /v1/skills/drafts`，
且普通 mutation 会先进入 BFF `mutationTicket`。Stage B 已以默认关闭的精确 route、owner-only credential/token、generated
Connect consumer 与 receipt bypass 替代该历史状态；每次请求仍先做当前 IAM admission，真实三 owner sandbox 尚未验证。

本片只开放 **user owner 的 CreateSkillDraft**。当前用户已由每次请求的 IAM session admission 得到可信
`tenant_id` 与 `subject_id`；BFF 固定构造 `owner_scope={kind:"user",id:subject_id}` 和完全相同的
`ProductCatalogContext`，不接受浏览器自报 owner/subject/tenant。个人 owner 判断就是两者逐字相等，因此不调用组织 Skill action
check，也不依赖 Project、Conversation、Storage 或 package binding。organization/project/session、CreateVersion、Validate、Publish、
Withdraw、SetStatus 继续 fail closed；本片通过不代表四 scope 或六 mutation 完成。

### 放置、来源与依赖

| 项            | 决定                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner         | BFF 拥有 public request、当前 Product subject 与错误投影；Platform 唯一写 Skill/revision/command receipt；IAM 拥有用户 session 与 Platform workload token 事实。                                                                                                                                                                                                                                              |
| 路由          | 扩展既有 `src/http/routes/owner.ts` 的精确 `POST /v1/skills/drafts` 分支，不建新进程或一级业务模块。                                                                                                                                                                                                                                                                                                          |
| 出站 adapter  | 在既有 `src/infrastructure/clients/` 下新增具名 `platform/` adapter。把 Connect/catalog token 塞进 `capability/` 的方案淘汰：该目录当前固定旧 Capability HTTP 2.0.0、shared-secret 与四个只读 GET，协议和 credential 生命周期不同，最终还要整体删除。                                                                                                                                                         |
| 生成物        | 目标固定 Platform owner `5b6eb2c1532b23b9747bc4bf6ac99f69ad453de0` 的 `kokoro.platform.v1` Proto；`platform_runtime.proto` SHA-256 `282bf886ea9648f7ce5208abd36ab47d879b2002a036d90aada2af59e74b4020`，`common.proto` SHA-256 `65025b86a89119954bfbc7ad8eb89d59109ae7f390db5ee1a68f016eefa7da08`。只读 vendor、dependency manifest、Buf/Connect 生成配置和 `src/generated/platform-connect/` 构成单向生成链。 |
| 摘要 artifact | 同一 owner commit 的 `contract/execution-operations/v3/` artifact/command digest version 均为 `3.0.0`，aggregate SHA-256 `324e749da1bc66c1ff03de74e7299716f798f5f5bb5fa19556033b79fa09ff8d`（inactive/routable=false）。BFF 构建期生成的 typed projector 必须通过 owner v3 `command.skill.create_draft.valid` 及拒绝 vectors；运行时不 import owner checker，也没有 v1/v2 fallback。                          |
| 配置          | 新增 `KOKORO_PLATFORM_BASE_URL` 与 tenant-indexed owner-only `KOKORO_BFF_PLATFORM_CATALOG_CREDENTIALS_FILE`。旧 `KOKORO_CAPABILITY_BASE_URL` 只供尚未 cutover 的四个 GET，不能作为 Connect URL 或凭据来源。                                                                                                                                                                                                   |
| 数据          | 不改 BFF schema/Redis，不建立 Skill 表、receipt、outbox 或授权缓存；Platform receipt 是唯一持久幂等事实。                                                                                                                                                                                                                                                                                                     |
| 删除/替代     | 激活此 operation 时只删除其 503 分支，并让 server 的 Platform catalog mutation 分类跳过 generic `mutationTicket`；不删除其他未替代拒绝路径，不保留 HTTP mutation fallback。                                                                                                                                                                                                                                   |

catalog credential 文件每项固定为
`{tenantId,generation,credentialRefVersion,clientId,clientSecret,resource,scope}`，其中 resource 逐字
`https://kokoro.dev/resources/platform-internal`、scope 逐字 `platform:skill-catalog.manage`。文件必须是当前进程 UID
拥有的非 symlink regular file，mode `0400|0600`；secret 不进入环境、日志或错误。BFF 以 client credentials 调固定 IAM origin 的
`/iam/oauth2/token`，禁止 redirect，严格校验 Bearer/scope/expiry；token cache key 包含 tenant、generation、credential ref、client、
resource 与 scope，仅剩余寿命 `>5s` 才复用，snapshot 改变立即失效，同 key single-flight。Platform RPC 只携该 machine Bearer；当前
用户 Bearer 永不发送给 Platform。

### 请求、幂等与调用顺序

public body 只含 `display_name`、`summary`、`tags`；BFF 不公开 `owner_scope`、`product_context`、`command` 或
`metadata_json`。三字段值不 trim/重排：display name 必须含非空白字符且不超过 255 UTF-16 code units，summary 不超过
65,535 UTF-16 code units，tags 最多 100 项、每项非空白且不超过 128 UTF-16 code units、精确值不得重复，数组顺序参与摘要。
首片固定把 UTF-8 `{}` 作为 Platform `metadata.metadata_json`，以后公开任意 metadata 必须另过 JSON schema/大小/摘要设计门。

`Idempotency-Key` 必须是唯一 header，值为 1..128 bytes 的可见 ASCII，空白、逗号合并或重复 header 拒绝。BFF 以
`hex_sha256(UTF8(JSON.stringify(["kokoro-bff","v1","skill.create_draft",tenant_id,subject_id,key])))` 计算 scope digest，
`command_id="bff.skill.create_draft.v1."+scope_digest`。`request_digest` 不由 BFF 自造另一算法，而由固定 v3 typed projector 对完整
CreateDraft Proto 业务投影生成：tenant、完整方法名、个人 owner scope、Product subject/owner 与完整 metadata 均在摘要内；
`request_id`、command identity 和 machine token 排除。相同用户/key/body 得到同 command/digest；改 body 得到同 command、不同 digest，
由 Platform 返回冲突；跨 tenant/subject/operation 不共享 command。

固定顺序是：service envelope → 唯一 User Bearer → IAM session admission/固定 tenant → strict body 与 key → 当前
`owner.id===subject` → catalog credential snapshot/token → Platform `CreateSkillDraft`。`src/bootstrap/server.ts` 必须在
`mutationTicket` 之前识别该精确 route，并像 durable Chat admission 一样跳过 generic BFF receipt/进程 Map；route 收到的
`mutation` 恒为 null。首次调用与相同 key replay 都重新经过 IAM admission、个人 owner 判断和 token 获取，然后才让 Platform
current owner gate/receipt 决定执行或 replay。无权、失效或配置错误时不得读取 BFF receipt，也不得打开 Platform socket。

Connect 单次 unary 调用使用固定 generated method、有界 deadline/取消与 1 MiB message 上限，不自动 retry。仅严格接受
`SkillId`/`SkillSeriesId` owner pattern、`revision=1`、`status=DRAFT` 与 boolean `replayed`；成功映射为 public 201。
本 operation 的 201 与所有错误只在 `x-request-id` header 携请求关联 ID，成功体为 `{data}`、错误体为
`{error:{code,message,retryable}}`；`src/contracts/envelope.ts` 的旧 `meta.request_id` helper 不用于新 route。
`src/bootstrap/server.ts` 的 admission 失败分支也要对这条精确 route 使用同一错误 envelope，不能仅成功时遵守新契约。
Platform `ALREADY_EXISTS` 映射 409 `skill_idempotency_conflict`；`ABORTED` 映射 409
`skill_command_in_progress`；有效业务前置失败映射 412 `skill_precondition_failed`；资源耗尽映射 429
`skill_rate_limited`；workload token/IAM/Platform 不可用或超时、Platform 对 machine workload 返回的 Connect `UNAUTHENTICATED`
均映射 503 `skill_dependency_unavailable`（不是用户 401，且不自动重试）；不可能的 owner/status/形状、
未声明 code 或非法 response 映射 502 `skill_response_invalid`。BFF 不根据 message 分支，也不自动重发 mutation。

### 实施与验证门

先准备 design-first OpenAPI 候选与 contract tests，再实现 generated consumer、token provider、server admission cut 与 owner route 候选。inactive/routable=false 是发布标记，不是 Platform runtime kill switch；正式默认入口继续 fail closed，只有 loopback 隔离候选配置可在协调激活前使用同一生产代码做真实 201/replay sandbox。
RED→GREEN 必须锁定：strict body/key、可信 user context、伪造身份字段拒绝、同 key replay 每次重验 IAM、同 key drift 409、
跨 subject 不共享、generic Map/PG receipt 零调用、无权时零 Platform I/O、credential generation 变化、token/Connect timeout/取消、
1 MiB 限额、严格 response 与完整 Connect code 映射。Node 22 执行完整 `pnpm format:check && pnpm check && pnpm schema:check`；
Root 可在 active artifact 发布前用隔离真实 IAM + 候选 BFF + Platform + PostgreSQL/Redis 验证首次 201、响应丢失后 replay、撤销 session 后同 key 拒绝以及 Platform 仅一条 Skill/receipt；这是 ADR-002 要求的预激活证据，不是 public 产品激活。正式发布仍需六 owner sandbox、Platform active/routable=true artifact、BFF 重新固定精确 commit/aggregate并由 Root 协调切换。Web adapter 仍是后续消费者。

## BFF-CHAT-ACTIVE-DOC：同一读快照中的 existing running（已实现，owner真实GREEN已验）

**Owner、当前态与裁决。** BFF 是 public Chat snapshot 与 durable AG-UI projection 的唯一 owner。基线d654的 OpenAPI 已有 optional `active_run` 和 `running` status，但该基线 `ChatApplicationService.snapshot()` 从不输出；本片已实现下述读映射。Root 首片保持 v1机器原字节，只恢复可证明的 existing running；不加queued、不收窄enum、不改`src/contracts/chat.ts`/generated、不要求Web contract升级，也不拼造`RUN_STARTED`或增加Web fallback。

**真实 writer 与矩阵。** `agUiConsumerRegistration` 写expected；换新expected清terminal但保留latest。`runProjectionState`对任意run的`RUN_STARTED`都把latest改为该run，仅E为空或start属于E才清terminal；只有E的FINISHED/ERROR把latest/terminal写E。permanent dispatch failure同样仅在失败run为E时写latest/terminal=E。故合法状态包括：历史`E=null`配null/started/terminal marker；新expected的`(E=X,L=null|O,T=null)`；running的`(X,X,null)`；terminal的`(X,X,X)`；以及terminal后late old start的`(X,O,X)`。最后一种必须省略而非错误；active期间late old start`(X,O,null)`也合法且保守省略。

**读映射与失败。** 采用现有`PostgresChatRepository.readSnapshot()`，在同一连接/MVCC snapshot和Conversation ACL成功后增加一行tenant/session stream查询，并通过`ChatSnapshot.activeRun`交给service映射snake_case。E为空全部省略；T=E全部省略且不看L；T为空且L=E才输出`{run_id:E,status:"running"}`；T为空而L为空/其他值省略。任一非null marker为空白，或E非空而T非空且T!=E，抛固定内部`CHAT_ACTIVE_RUN_STATE_INVALID`；E=null历史流不因无法认领而任意503。淘汰service另开AgUiRepository事务及扫描Message/outbox/frame。

**并发、GC和权限。** 读取不锁stream；Message、Delivery、cursor、E/L/T来自同一repeatable-read边界。GC只删event/frame，不删stream fence。所有stream读取都在现有tenant/subject/Project/active Conversation predicate后执行；cursor/run ID不授予权限。晚到old start导致running暂时不输出是已知保守缺口，不在read侧猜测或改writer。

**后继与精确代码门。** 首片源码允许集仅`src/application/ports/chat-repository.ts`、`src/infrastructure/postgres/chat-repository.ts`、`src/application/chat-service.ts`；测试为现有`test/chat-service.test.ts`、`test/agui-http.integration.mjs`、`test/agui-projection.integration.mjs`、`test/agent-dispatch-outbox.test.ts`及真实PG `test/chat-facts.integration.mjs`。RED→GREEN覆盖上列全部可达矩阵、blank/foreign-terminal非法row、permanent failure writer→snapshot、RR barrier、GC、tenant/subject/Project/deleted Conversation；不改OpenAPI、`src/contracts/chat.ts`、Schema或generated。`queued`、`waiting`、durable pending、旧start覆写及files另片，running首片不称整个能力完成。

实现已严格落在上述三个源码文件与五个测试文件；纯 Node 22 门通过，Root 的隔离 PostgreSQL RED 证据为 3 pass/5 expected fail。实现后的真实 PostgreSQL/Redis/localhost fake Agent GREEN 由 Root 自有临时资源复验，当前文档不把纯门替代为组合验收。

## W2 单文件项目资源上传（实施切片）

BFF Project 是当前关系授权 owner，Storage main `094847da9f4f03e5f3dbda06658430c74bc32f54` 的 `kokoro.storage.v2` 是唯一 Upload/Asset owner。保留现有 POST `/v1/projects/{projectId}/resources` + multipart `files` 形态，首片只接受一个文件，总 HTTP body 不超过 1 MiB（含 multipart 开销）；多文件明确 400，不承诺批次原子性。先 IAM admission，再 `projects.find({tenantId,subjectId}, projectId)` 取 canonical project.id，之后才解析/调用 Storage。

采用具名 `src/http/routes/project-resource.ts`、`src/application/project-resource-upload.ts` 与 `src/infrastructure/clients/storage/`；不把上传塞入 Library 或现有大 live-bff handler。owner Proto只读 vendor→Buf生成→窄Connect facade，generated类型止于client。Node原生FormData解析只处理已限流/有界读取的完整body，不手写multipart分隔；filename/MIME/hash/size再验证。允许独立 Storage origin/credential 与明确 ObjectStore origin；PUT只接受该origin、无userinfo/fragment、不重定向、唯一content-type，绝不携内部身份到ObjectStore。

此精确route在通用receipt前自行做规范化指纹（canonical project、filename、MIME、真实size/hash），复用既有持久receipt。额外一条create-stage checkpoint只存稳定upload_id，在PUT/Complete前确认已落盘；相同身份/指纹重试用GetUploadStatus恢复completed资产，否则复用原pending上传。同key异义冲突，不从Storage私有ID算法派生Upload。每次replay先重验项目当前授权。整体预算小于既有60秒pending reclaim；超时/取消无自动业务重试。PUT/引用失败对已知pending上传尝试有界Abort；Complete结果未知不盲Abort，保留checkpoint供重试查询。创建返回丢失时依靠相同Create命令取回pending upload。

删除原resources 503 stub；Library、Skill package、chat关联不动。零新Schema/跨owner SQL。验证单文件、畸形/超限multipart、tenant/subject/项目404、SSRF与secret不外发、同key/异义、receipt失败、Complete响应丢失、重启checkpoint恢复及abort。真实Storage/PG集成由Root另验；单测不表示真实owner链完成。

W2 scan gate：Complete 与恢复 GetAsset 均只放行 CLEAN；INFECTED 返回终态 422，PENDING/UNKNOWN 返回可重试 503。完成资产的 checkpoint 保留，重试仅查询既有 upload/asset，不重复 PUT/Complete，不 Abort 已完成资产，不下发引用。

## W2 项目资源持久列表（当前实现；真实组合待 Root 验收）

Storage v2 `ListAssets` 已固定 owner commit `ef0fd7779bf434120ac1f8a58592222f534a7c45`，原始 Proto 与生成器来源记录在 `contract/dependencies/storage-connect.json`。当前在同一 Project HTTP 边界新增 `src/http/routes/project-resource-list.ts`，独立输入/投影类型（不把 GET 塞入上传 orchestration），复用 Storage client 的具名 `listAssets` 方法：每次先以 IAM admission 的 tenant/subject 调 `projects.find`，取本仓 canonical project.id；失败按普通不可见项目返回 404，不向 Storage 打开 socket。随后以固定 `web-bff` 服务凭据和受信 project scope 调 Storage Connect，传 limit（默认50，1..100）/cursor（最多4096可见ASCII，不解码），拒绝未知或重复query，只投影 `ASSET` 且 `CLEAN` 的列表项。BFF 不接 Storage 既有 HTTP 列表、不读其 SQL/Redis，也不建本仓 Asset 映射表或第二份资产事实。

列表按 Storage 的 tenant/project scope，而非按上传者过滤；BFF 当前私人 Project owner predicate 决定谁能读。cursor 由 Storage 绑定调用方、tenant、project、subject、filter 和 limit；BFF 只透传不解码，错误不降级成假空列表。返回列表不含 upload_id（Storage 资产行不提供此关联），也不返回签名下载 URL；下载另走受信、逐次授权的 owner 契约。测试先覆盖 200/空页/下一页、跨项目/跨 subject 不可见、scan/purpose 过滤、Storage 故障与恶意 cursor，最后用真实 Storage+PostgreSQL/ObjectStore 组合验证刷新仍可见。

GET 专用响应 gate 验证 page 数量/唯一 Asset ID、purpose/scan/origin enum、filename/MIME/SHA/uint64 与 Timestamp范围；RFC3339 UTC保留owner纳秒精度。非法owner页为502，不本地过滤伪造部分页；owner INVALID_ARGUMENT为400，认证/权限/超时/不可用为503，其余未知RPC错误为502。HTTP外层在admission前对精确GET设置request ID，no-store沿现response helper。零自动retry，10秒总调用预算及request断开取消，不改POST/checkpoint。

### BFF activeRun running首片 Root最终证据（2026-09-30）

同一个ACL先行RR snapshot实现已通过Root Node22完整纯门（contract191、architecture27、test506pass1skip、format/lint/typecheck/build）及canonical fresh install、定向8/8与全7文件真实PG/Redis/localhost HTTP integration47/47、0失败/0跳过。日志 `/tmp/kokoro-bff-active-run-root-pg-fixture-final-gates.log`、`/tmp/kokoro-bff-active-run-real-pg-final-green.log`；自有/新增临时库0、Redis新增0/baseline保留。首次PG7/1因fixture缺正常assistant/dispatch binding失败，改由ChatTurn.submit建立绑定后复验，不改生产guard。公开OpenAPI/schema/generated字节未变；浏览器终态全文与queued/waiting/pending/files仍后继，不能据47项owner integration宣布全产品完成。
