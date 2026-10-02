## R74：ScheduledTask create / public5 源码 GREEN 候选（未发布）

R75 当前更正仅机器presence：创建必须提供 title/prompt/frequency/time/timezone，另四字段保持optional，与现 production parser 的既有行为一致。无 SQL/DDL、事务、默认值、clock、源码或integration fixture变更；唯一 canonical database/schema.sql 原字节保护。Root修复前真实full integration已149pass/0fail/0skip并完整owned回收，supported Node22完整offline全部exit0（`/tmp/kokoro-bff-r75-root-supported-node22.log`）、native十二文件审0。P1原因是OpenAPI缺属性required而非数据层缺实现；public5仍未发布，补行后的精确hash由Root再验，不用旧149代表新hash已验。

基线 main / d695fcbc0cd3f0376c34f64f6217d9d8e74c1b3c；Root 已复验 R73 纯 RED 83=51pass/32fail/0skip，以及 owned canonical fixture 上真实 HTTP+PG+Redis 53=14pass/39fail/0skip（含父/嵌套 failure，不是 39 个独立缺陷）。资源已由 Root 回收。本节覆盖下方 R73 的「版本待裁定/生产未修改」阶段描述；全部下方原正文保留，不作为当前完成证据。

本片无 DDL，database/schema.sql 与仓储均保护。create 同一解析对象只携带可信范围下的精确项目引用：省略仍存NULL，合法ID/slug经现 Project FOR SHARE 查询存canonical ID；task+outbox 首次写入事务不变，外层 receipt 保独立事务。闭合输入/query拒绝先于receipt，权限404/准入403不混淆。项目路径原 path binding 保留，无新业务事实/跨ownerSQL。

创建固定 active/enabled=true，删除 public create 的两个广告字段不改数据库状态枚举或 PATCH。Root 已批准 public5 /v1 breaking；发布顺序同 API_CONTRACT。真实 RED 的 rollback/recovery、合法linked/independent、隐私/重放/撤权 controls 已通过，仅说明旧基线控制有效；本轮修改后仍须 Root 重新执行完整资源回归。当前不安装schema、不启动服务/PG/Redis、不重复宣称旧证据为GREEN。

## R73：ScheduledTask create 输入拒绝与事务证据（无 DDL）

基线 `main / d695fcbc0cd3f0376c34f64f6217d9d8e74c1b3c`，R71 已由 Root 发布。本节为 R73 ScheduledTask create 的唯一当前目标；下方全部旧正文逐字节保留，其 R71「待发布」和宽松输入描述仅是历史阶段，不覆盖本节。当前阶段仅 D0 + tests RED，生产实现、canonical contract、SQL、package/pin/generated 尚未修改。

Owner 为 BFF ScheduledTask，Project 与 ScheduledTask 均是本仓事实。唯一 canonical `database/schema.sql` 不变：无项目时 bff_scheduled_task.project_id 为 NULL；合法可见 ID/slug 经同 tenant/owner 查询后存 canonical project ID。任务独立，不创建 Conversation/Message，无新表/索引/迁移、跨 owner SQL 或缓存事实。

目标输入为 optional 精确非空、无边缘空白的 string project_id；非法类型/null/数组/空白不降级成 NULL。unknown body/query（含重复）、非 boolean auto_approve、create enabled/status 在 receipt 前 400；有效引用不可见/缺失/跨 tenant 在 receipt 前 404。初始 active/enabled=true 已是仓储事实；删掉 create 广告字段不改 SQL，后续状态变化仍既有 PATCH。

首次创建沿现 src/infrastructure/postgres/scheduled-task-repository.ts 的一个 checked-out client 事务：outbox 去重→同 tenant/subject Project 查询 FOR SHARE→task INSERT→outbox INSERT→COMMIT。outbox 写失败回滚 task+outbox；HTTP 5xx 释放 generic pending receipt。外层 receipt 独立事务仍是当前架构，不能写成三表同事务。已提交 task/outbox 的恢复早返分支位于 Project 重验前，不能把首次写入锁保证推广到全部恢复路径。

本片测试用精确 tenant/subject/key 快照证明拒绝零新增；成功 linked/independent controls 同时核 task 默认值、canonical project、register outbox/lineage 与 terminal receipt。重启重放比较原完整响应及三表内容；同 key 换另一可见项目 409，项目撤权后原 key/body 404且原记录不变。跨 tenant fixture 只操作 BFF 自有表，仍走正确 tenant admission；不更改原错 tenant 的 403。

回滚测试复用现 scheduled-outbox integration 的真实 PostgreSQL BEFORE INSERT 故障触发器，只匹配本例唯一 key；对象名唯一、finally 精确回收自有 trigger/function。新例不安装 schema、不 DROP/TRUNCATE 业务表、不重置共享 Redis；Root 先用现 owner installer 创建 owned fixture。create HTTP/仓储/receipt 为真实实现，暂停 delivery worker 仅隔离后台投递，不用 mock response 代替事务。未运行资源前，所有深层断言只标待验，不伪称数据库 RED。

本阶段无 canonical schema 变动，因此不重复已通过 schema gate；完整发布前仍由 Root 按阶段跑 schema:check、fresh fixture/业务集成与回归。版本/consumer 前置门同 API_CONTRACT.md；三 D0 目标一致不代表机器实现一致性已通过。retention、既有 Scheduler callback/accept/head 与其他 owner 生命周期均不在本片。

## R71：独立 ScheduledTask 可选项目关联的数据事实（无 DDL）

基线 main / 3928043ec243eaec28af32c231a0bbf75a8b19ec。本片仅补公开创建 schema 的可选 `project_id`。现 repository 在字段省略时把 `bff_scheduled_task.project_id` 写为 NULL；提供引用时，在既有事务内解析并验证同 tenant/subject Project，持久化解析所得 project ID。ScheduledTask 独立持久化，不创建或依赖 Conversation/Message。

唯一 canonical `database/schema.sql`、repository、事务/锁序、幂等、outbox 与 retention 全部保持原字节；没有新表、迁移、跨 owner SQL 或数据修复。本片纯契约回归不替代数据库或完整用户旅程验收。下文历史正文完整保留。

## R62 / R59 实施候选（未发布）

当前 canonical 已增加一张 bff_agui_run_interaction 最新 Run read projection；同 source/frame/HWM/CAS 事务写入，授权 RR 读取核验完整 state 与 START/ledger/source provenance，GC 保护活跃依赖，删除在原父事务内完成。DDL 的真实 fresh catalog 与完整并发验收仍由 Root 执行，未声明通过。 基线 main / 759bfe0a8c521946cae31a74b6426f43b063bae1；本轮八项离线门均 exit 0；资源门未运行，精确数量与格式证明记录在 docs/CURRENT.md 的 R62 前缀。以下 R48 设计及原 body 逐字节保留，阶段句以本前缀为准。

---

## R48-BFF-D0：run-scoped 完整 interaction 投影与同事务公开水位（当前目标，DDL未实施）

本前缀与 TECH/API R48 是唯一当前数据方案；下方旧 waiting/revision“待owner”与旧锁图仅作历史 body 保留。唯一 canonical database/schema.sql 当前字节冻结。Agent e977923 HTTP4 已发布，输入来自其 interaction.state/ChatInteractionState，不复制 Agent Run/native checkpoint/intent 表，不跨 owner SQL。

### owner、存储位置与字段决定

BFF Chat 是完整 interaction public read model 唯一 writer，Agent 仍是事实 owner。FIFO head 不另建表，继续用 bff_agent_dispatch_outbox 的现最早 nonterminal row。比较现 bff_agui_stream 扩多列与一张 run-scoped 投影：stream-only 会在下一 run覆盖上一轮 provenance，且把 text/tool projector cache、session source HWM 与 Run revision混为一类；采用新 bff_agui_run_interaction，PK (tenant_id,session_id,run_id)，只维护每个 Run 最新完整 revision。它无独立 public CRUD、lease、进程或生命周期模块，不是第二 intent/journal。所有 ID 沿本仓 opaque TEXT，不改既有 Conversation/dispatch 类型。

| 字段组（后继canonical目标） | 类型/NULL/职责与约束 |
|---|---|
| tenant_id、session_id、run_id、subject_id | TEXT NOT NULL；前三列 PK；subject 来自已锁 active Conversation/stream/dispatch 一致身份，不从 source payload自报 |
| projection_schema_version | INTEGER NOT NULL，值1，命名 CHECK；表示 BFF projection envelope，非 Agent HTTP/public版本 |
| interaction_revision、pause_revision、pause_ref、phase | BIGINT NOT NULL 正 interaction revision/非负 pause revision；pause_revision<=interaction_revision，pause_ref TEXT仅在revision0为NULL，其余非空；phase TEXT NOT NULL CHECK active/waiting/resuming/terminal |
| groups | JSONB NOT NULL array，保存固定owner版本的原序 full collection，display/input_schema为受限外部schema；phase waiting/resuming要求非空、pause_revision>0，active/terminal明确空 |
| action_command_id、action_pause_revision、action_kind | TEXT/BIGINT/TEXT 同空同非空；kind为owner accepted/native_consumed/validation_failed/unknown/cancelled，action revision正且<=pause_revision；resuming须accepted/unknown且action revision=当前pause；waiting validation_failed须引用更早pause |
| interaction_digest | TEXT NOT NULL lowercase64hex命名 CHECK；对完整六字段规范化JSON计算SHA-256，对象键递归排序、数组保序、optional字段存在性保留；同revision内容冲突不因不同source ID放行 |
| source_owner、source_event_id、source_sequence、source_digest、source_occurred_at | NOT NULL；owner固定kokoro-agent，source ID非空/sequence BIGINT正/digest lowercase64hex/UTC TIMESTAMPTZ(3)，与现source ledger同事务绑定，不复制 private source payload |
| public_sequence、public_cursor、created_at、updated_at | BIGINT正/TEXT opaque cursor/UTC TIMESTAMPTZ(3)；每个接受的更高full revision绑定一个CUSTOM frame，created_at不覆盖，updated_at仅真实replace更新，no-op不改 |

R56 P2 的 digest 身份界定：interaction_digest 仅绑定 owner 完整六字段 full state：对象键递归排序、groups/items 等数组保序，optional 字段的实际存在性与 null 值保持；不套用 control 的 optional-null 归一规则。同 revision 的 full-state digest 相等才允许 no-op，mutation fingerprint/control digest 均不能证明 state/source 相等。

BFF mutation fingerprint 绑定本仓外层 durable receipt scope（可信 tenant/subject/method/path/key）及现 method/path/query/canonical headers/semantic body 请求语义；它是现 stableStringify 指纹，不是 Agent request_digest，也不是 interaction_digest。不同请求表示是否在 BFF receipt 层冲突仍按本仓规则；owner 的 null/omitted 等值不自动使两份 BFF mutation fingerprint 或 receipt 可互换，不重写全站幂等策略。 Agent4 control request digest 基于固定 owner 的 RunResume typed normalization：material 含 kind/run_id/session_id/expected_pause_revision/pause_ref/decisions，排除 command_id/request_digest；只在 owner 声明的可选 nullable model 字段 approve.args、reject.reason 上将 null 与 omitted 归为同值。其余 required locator/item identity 不默认、不省略；decisions 保序；对象键排序、紧凑 UTF-8 JSON 后输出 sha256:<hex>。不得递归删除 submit.value、edit.args 或非空 approve.args 内的业务 null；业务字典中的 {"x":null} 与 {} 是不同 material。

现 src/infrastructure/clients/agent/control.ts、control-receipt.ts 与 control route 仍消费旧逻辑，后继必须在已列精准写集迁移 required locator、typed normalization 和 receipt digest 对照；对应现 test/agent-control-adapter.test.ts 的 owner-fixed 向量至少覆盖 approve.args/reject.reason null↔omitted 同 digest、submit.value/edit.args/非空 approve.args 内业务 null 保留且不同 digest、排除 delivery IDs、required revision/ref 与决策顺序。full-state 同 revision optional omitted↔null 不等值的投影向量独立保留，不用 control 向量替代。当前仅修正文档，未迁移 adapter/向量，不构成 public4 完成。

submitted 不新增独立 boolean：它由 phase=resuming + 精确当前 action_pause_revision + kind accepted/unknown 表达，防止上一轮 native_consumed/validation_failed 结果把新 waiting 误标已提交。稳定参与过滤、CAS、JOIN的数据全部为普通列；groups无独立逐项SQL查询需求，不做per-item write/GIN索引。PK同时服务 snapshot/resume 的 tenant/session/head-run 等值查；不再加同形索引、source副本UNIQUE或装饰性业务索引。source唯一性仍由现 bff_agui_source_event PK/sequence UNIQUE保护。

数据库命名 CHECK只保护单行正值、phase/cardinality、locator与action三元组等稳定不变量；group/item/allowed_decisions全局唯一、closed display schema、safe整数及跨revision关系由固定owner decoder+纯 reducer+事务测试保证。JSONB上限沿现 HTTP request/upstreamMaxResponseBytes 与AG-UI frame预算，超预算整批拒绝、不得截断full collection。不能因schema接受int64就无损转超JS safe integer。

### 写入、无外键完整性与失败恢复

Conversation→stream→dispatch→interaction/Message/Artifact→source/public ledger 为固定顺序；同父锁已串行tail，跨conversation先排序一次锁完全部父。新表没有FK/REFERENCES，不用跨schemaJOIN。writer在已锁C确认active、owner/subject、raw head run与started/expected一致；无父、foreign、failed/terminal旧run新source一律拒绝。纯 ACK settlement仍停在现dispatch CAS；resume HTTP事务不持锁跨owner网络。

commitProjection 同 checked-out client把完整 typed mutation、source identity、CUSTOM frame/public sequence/cursor、stream version/HWM、Message/Artifact与terminal→下一queued全部原子提交。首次full revision INSERT；更高revision在现 version/lease CAS内整体UPDATE header/groups/action/digest/provenance/frame引用。revision下降拒绝；同revision异完整内容拒绝；同revision同内容不再frame/update投影，但不同合法source identity仍连续登记与推进HWM，不把整个source batch漏掉。exact已存source幂等仍按event/sequence/digest核验，不能用revision equality遮蔽source冲突。pause_revision同Run不倒退，resuming的action必须当前pause；re-pause新header/groups完全替换，validation在新item保留，不merge旧集合。

RUN_STARTED且未出现任何interaction row，是连续source前缀的合法初始无pause态；这和“已waiting但row丢失/坏payload”不同，后者fail closed。queued没有pause不制造revision0行。owner phase active/terminal 的完整空groups才对既有pause整体解除；native_consumed可能产生新非空waiting，所以action kind不能替代phase/groups。interaction phase terminal不单独terminal dispatch，直到run.completed/run.failed；若真正run terminal先结算，不发明owner revision，旧run row不再成为head/pending truth。下一Run有独立PK，绝不继承A的groups/ref/action。

consumer锁后DB clock、expiry CAS/remaining budget、sticky admission_unknown_seen、post-terminal/failed source guard、exactduplicate与missing-parent authority修复不变。CAS/SQL/完整集合校验失败，projection/source/frame/HWM/Message/next head全部回滚；restart只从DB最新完整revision恢复，Redis不是pending权威，不从control receipt/普通tool结果修补缺集合。

### RR读、GC、删除与canonical安装

snapshot/resume均先可信Conversation授权再同一REPEATABLE READ READ ONLY连接读取raw FIFO head、stream、head-run projection；snapshot还读取原Message/Artifact和event_watermark。校验scope/subject/started/header/phase/collection及current frame reference一致，不只按公开state猜SQL状态；在现 public ledger tenant/session/sequence PK 的 START→watermark 范围查当前 run 最新 kokoro.interaction.state CUSTOM，Row 必须匹配其存在性、revision、完整内容digest与cursor。无Row只有在连续有效前缀内也无任何full-state CUSTOM时才证明初始无pause；已有frame但缺Row、Row落后latest frame或引用不存在均fail closed。此查复用现索引和ledger，不增has_pause marker/第二state副本；不同HTTP请求不共用快照。resuming保持全集，active/queued的[]来自有效初始或owner明确空集合，不对坏数据fallback。HTTP之后owner另验revision/ref，BFF不声称跨服务原子事务。

GC只在实际取得同tenant父锁后的重查stream集合内执行。原live queued引用与START/source/tombstone保护保留；本新增查询按live head PK取latest interaction.public_sequence，把当前full revision frame纳入retainFrom最小边界，因此pending与opaque watermark不能被半清。candidate发现、锁后requery和实际删除共用effective boundary=min(latest START、live queued sequence、live head最新full revision sequence)；同parent存在/合法START引用/存在过期且public_sequence<effective boundary的全部eligibility必须在LIMIT前满足。当前只用sequence<START发现而删除用min(START,queued)会选到A queued1/START2却无<1可删，batchSize1可永久饿死后续B；这是新独立公平性缺口，不因authority4pass而已验。精确A/B生产父事实单例与最小source位置见TECH R48，source/table均不在本D0写。source ledger不因public GC删除。只有已terminal/failed、不再head且其public frame已依原retention回收的run projection可在同父事务回收；非terminal或无父历史孤儿不自动修/删。public snapshot不提供历史pending查询，故一Run最新read model不保留每revision第二日志，历史在source/public ledger。

Conversation当前为soft delete；后继在既有delete事务父锁内停止consumer/fence、保持durable cancellation outbox与dispatch处理，再物理删除本仓run interaction read model（如原Artifact links），不改为物理删Conversation或恢复可见。source/public历史仍按现retention，不宣称删除投影等于全部历史隐私清除。缺父/错subject检测只告警/fail closed，修复由Root明确owned范围另授，worker不删除共享数据。

后继仅 database/schema.sql 增本表与解释后的命名CHECK/PK；scripts/apply-schema.mjs保持owner空schema/单事务/唯一installer，不新migration/ALTER/兼容schema、不自动改旧数据库。Root在自有空kokoro_bff schema执行fresh install/catalog drift/故障rollback，同底库同role其他owner schema保持不变。现integration TABLES、zero-write fingerprint和scoped cleanup需精准补本表，不能靠漏表清理或忽略残留放绿。

### 最小数据RED与当前未验

Root authority4pass0skip281.213ms已验的是父边界，完整projection21pass9fail的原矩阵仍未绿。后继现 agui-projection.integration.mjs 追加真实至少两group、多kind/multiple items的waiting→accepted/resuming→unknown→native-consumed active与re-pause/validation_failed、same/different revision replay、foreign/stale/fence/gap/mixed batch零写、interaction/CUSTOM insert触发器故障全回滚、授权RR barrier旧head/fullpause/cursor对新revision、restart/full set与GC引用。原R43三条公开head后段及R46四authority原断言保持；九失败迁移仅按TECH表、WIN03审查与Root批准执行。

当前DDL/新表/contract4/source均未实现。D0只核固定owner JSON事实与四doc当前前缀/原body hash；Root后继运行 pnpm schema:check、pnpm db:apply-schema、自有catalog对照、完整integration/contract/architecture/test/build及精确多连接锁barrier。此处字段表是待批准canonical设计，不是第二SQL或已应用证明。

---

## BFF-SCHEDULED-D0：独立 execution scope、dispatch 与 session source ledger（2026-10-01；canonical schema 候选，fresh install 待 Root 验证）

采用三表而非原两表草图。`bff_scheduled_agent_scope`以`(tenant_id,task_id)`为PK，保存稳定session/subject、可空且同空同非空的`active_dispatch_id/active_run_id`、session级`source_high_watermark`及consumer lease/fence/poll/failure。它不对会被物理删除的`bff_scheduled_task`建FK；task删除后仍是head/cursor恢复锚点。

`bff_scheduled_agent_dispatch`冻结occurrence与launch identity，生命周期`pending|leased|retryable|admitted|terminal|failed`，包含sticky unknown、lease/fence/attempt/backoff/timestamps。唯一 `(tenant,task,occurrence)`、`(tenant,task,idempotency_key)`、`(tenant,run)`。三表一律不建 `FOREIGN KEY`/`REFERENCES`；scope存在、身份/active一致与orphan防护由同事务scope锁后predicate维护。固定九位`occurrence_order_key`保持纳秒排序。scope无active时选已accepted最早row并固定；active A存在时迟到更早B不得替换，A释放后才参与剩余排序。

`bff_scheduled_agent_source_event`按session事实建模，主键`(tenant,task,source_sequence)`，唯一`(tenant,task,source_event_id)`，保存required `source_run_id`、owner/digest/time/kind/完整受信payload。cursor在scope而非dispatch/run。Agent Chat seq是session级；历史run、foreign run和不产生public frame的event仍连续落ledger。仅精确active run terminal改变dispatch/scope；identity/digest/gap/混批错误全rollback。

锁序callback为receipt→task→scope→dispatch；worker为scope→dispatch→source。delete维持task→Scheduler outbox→物理DELETE且不碰scope，故无反锁。callback先锁task并commit后，后续delete不影响accepted执行；delete先commit则callback拒绝。pause/delete不级联、不取消或释放已接纳head。canonical fresh schema建CHECK/partial indexes，不建migration/兼容层/跨ownerSQL；锁后`clock_timestamp()`做lease CAS。TTL/最终scope回收未裁决，当前不purge。

### R25-P1 terminal drain anchor 与最终CAS

`bff_scheduled_agent_source_event.source_digest`写入前必须由repository基于完整`source_payload`使用唯一canonical JSON（对象键递归排序、数组保序）重算SHA-256并匹配；错误digest、重复sequence或event-id碰撞均使整批事务回滚，不推进scope cursor、不改变active dispatch。

不新增表、列、索引或外键。`bff_scheduled_agent_dispatch.status='terminal'`可以在source session尚未drain时继续被`bff_scheduled_agent_scope.active_dispatch_id/active_run_id`引用；这不是可执行head，而是唯一drain anchor。consumer candidate必须包含该terminal anchor。`source_high_watermark`逐页连续推进，只有本次合法页`exhausted=true`且active dispatch已terminal时才原子清空active tuple。任何同active post-terminal source、duplicate/gap/id/digest/run冲突使整页与cursor/marker更新回滚。

锁序保持scope→dispatch→source。claim/consumer lease在锁后取DB时钟，写lease后、COMMIT前再取同连接最终DB时钟并核预算；不足则ROLLBACK。已提交但尚未网络I/O的lease通过token/fence CAS做never-sent release；该路径永不清active/head；`admission_unknown_seen`无论真假均原值保持，consumer lease清理不受dispatch unknown标记限制。无新DDL，fresh schema仍是唯一事实源。

R25数据库测试必须使用真实多连接及精确`pg_blocking_pids`，并覆盖非零cursor N→N+1、terminal跨页/restart drain、callback/delete双赢家、故障注入原子rollback、冲突批零写、expired/never-sent CAS以及多scope并行而同scope单租约。

## BFF-EXECUTION-HEAD-D0：head、pending revision 与锁序数据设计（未实施）

head不新增表：权威为`bff_agent_dispatch_outbox`同tenant/conversation最早`(conversation_dispatch_seq,outbox_id)`且status在`pending|leased|retryable|admitted`。snapshot先授权Conversation并校验head subject，不读payload或pending Message正文。

waiting不能用单marker表达完整pause集合。canonical SQL须保存Agent owner发布的最新full revisioned collection（revision header与规范化items的最终形状等待owner artifact），至少绑定tenant/session/run/revision、完整集合digest及source provenance。每个更高受信revision整体替换投影；BFF不发明逐项opened/resolved或服务端partial merge。browser ACK不变；Agent durable decision受理事实以revision/fence CAS写submitted并进入resuming，同revision不得重复decide且完整items不删；owner native-consumed后的下一revision非空表示re-pause/waiting、明确空才active，terminal/cancel关闭投影。最终DDL等待Agent contract，当前不落表/列。

现锁图要求Conversation-first：submit/delete/artifact已如此，claim/failure及consumer/GC未统一。目标为Conversation→stream→dispatch→Message/Artifact/source/public ledger。单Conversation锁完全串行tail，内部无需排序；跨conversation batch先按tenant/conversation一次锁完全部Conversation，再按同序进入stream/tail。`claimConsumers`和`collectGarbage`同样先取对应Conversation集合，renew/settle/release为单conversation。独立cancellation outbox不触Chat tail。

submit同事务写Message、outbox、queued event与cursor；terminal/failed同事务选下一head。queued identity稳定，重复no-op。RR snapshot一次读取head、stream、cursor和最新authoritative revision；waiting=集合非空且未submitted，resuming=集合非空且当前revision已submitted，四者必须同一快照一致。GC保护watermark、queued transition与full revision/source引用。无FK方针不变，以Conversation锁、同txn CHECK/unique与CAS维护完整性。

下一代码片实际数据面：`database/schema.sql`、`agent-dispatch-outbox-repository.ts`、`agui-projection-repository.ts`、`agui-consumer-repository.ts`、`chat-repository.ts`、`conversation-artifact-projection.ts`及现projection helper；没有泛化cancel/retry文件。双连接测试覆盖单Conversation writer竞争与跨Conversation claim/consumer/GC一次锁全。

R43 FIFO/RR 收敛（目标，未实施）：stream `terminal_run_id`保存Run历史marker，Conversation是否仍有工作由同tenant/conversation/subject的durable FIFO head判断。A terminal、选择B及B queued frame/cursor在同一Conversation-first事务提交；replay有效结束结果在同一一致性读边界关联head、stream terminal事实与ledger watermark，有head即不以历史marker关闭SSE，无head且合法terminal事实存在才允许在ledger drain至head后结束。现内部page的terminal结果须head-aware，不机械透传marker；不新增表/列/公开字段，不靠清除A的历史dispatch terminal事实或伪造B RUN_STARTED表达queued。旧run source守卫、duplicate幂等、tenant/subject与GC保护仍保留；snapshot沿现授权后RR读取，数据库回滚不得留下B head/frame/cursor的部分交接。

R44 内部第一源码片（候选，待 Root 集成验证）：canonical database/schema.sql 字节不变，不新增表列；queued public ledger row 以 dispatch_queued:<outbox_id> 派生稳定 source_event_id/cursor，frame_index=0，只写 public sequence/version，不写 bff_agui_source_event 或 Agent high-watermark。submit/terminal/never-admitted failure 的 head 选择、queued 写入和 cursor 分配在同一 Conversation-first 事务，写入失败整批回滚；重放同 key 或同 queued identity 不推进 cursor。RR 内部 snapshot 从 raw 最早 nonterminal dispatch 校验 subject/stream identity，不跳过非法 head。replay 同语句取得 head、watermark 和历史 terminal；GC 保留 live dispatch 的 queued sequence 及原 START/source/tombstone 规则。完整 authoritative pause revision 的 canonical schema/事务、四态与公开4 仍属后继三面 D0；本片没有固定 []、partial merge 或双写。

## BFF-FIFO-ATOMIC：terminal-gated Conversation queue 目标数据模型（2026-10-01；源码与真实PG门已验证）

`lease_until` 判定使用目标行锁之后、同连接读取的单一 PostgreSQL `clock_timestamp()` 值；事务起点时钟不得用于跨锁等待的 expiry 判断。claim 只有在提交前数据库观测剩余预算大于零时才能返回，不使用最小 1ms 夹值。该规则不改变 terminal dispatch 的历史事实状态机。

canonical `bff_agent_dispatch_outbox` 后续把status收敛为
`pending|leased|retryable|admitted|terminal|failed`，新增
`admission_unknown_seen BOOLEAN NOT NULL DEFAULT FALSE`与`admitted_at TIMESTAMPTZ(3)`；保留`completed_at`作为terminal/failed
时点。约束为：pending/retryable无lease且未完成；leased三项lease齐全且未完成；admitted无lease、admitted_at非null、
completed_at null；terminal无lease且admitted_at/completed_at均非null；failed无lease、admitted_at null、completed_at非null。
unknown flag可在leased/retryable/admitted/terminal为true且只允许false→true；failed必须false。

expired leased重领前原子置unknown=true。ready/lease索引仍只覆盖可claim pending/retryable与过期leased；更早
pending/retryable/leased/admitted全是Conversation barrier，terminal/确定未接纳的failed不阻塞。unknown快速预算耗尽保持retryable与expected fence，不进入failed；`available_at`按现backoff cap写为30秒后，使同一row/run/key
跨cycle有界重新claim并单次POST。现`bff_agui_stream.consumer_next_poll_at`同时是受信terminal读取的durable唤醒；两条恢复路径都不
新建queue/process、不产生tight loop。unknown=false且本地never-sent耗尽才可failed。

耗尽head探测以独立短事务完成并无条件释放锁；普通claim随后按tenant/session确定序先锁全部候选stream，再锁/重验dispatch并安装expected；enqueue只注册consumer subject。terminal source可把leased/retryable/admitted
head在同一事务更新assistant Message、source/public events、stream version/watermark/terminal，并设置dispatch terminal；极速terminal
以`COALESCE(admitted_at,CURRENT_TIMESTAMP(3))`补全，且把current expected清null。迟到delivery settlement因status、lease token与fence
不匹配不再写。各入口禁止在取得stream/dispatch后回锁Conversation。

post-terminal检测以历史dispatch `(tenant_id,conversation_id,run_id,status=terminal)` 为真源，不依赖会被下一claim改变的
`expected_run_id/terminal_run_id`。exact duplicate只核已有source row的owner/event-id/sequence/digest；其他旧run source在任何insert/
watermark update前失败。无新表、Redis key、跨owner FK/JOIN或Scheduler复用；fresh DDL不建migration/alias/旧succeeded兼容。

正式Agent source reader在任何UI frame过滤前保存owner `run_id`为内部`sourceRunId: string|null`；即使该source投影零frame，也以此历史dispatch terminal/failed守卫。非空event/assistant/artifact/frame run必须与sourceRunId一致；明确session级null才不按run守卫，不改变owner wire。

## BFF-CHAT-PAGING1：keyset谓词与索引同向（2026-10-01；源码与回归已验证）

唯一schema database/schema.sql逐字节保持。bff_conversation.updated_at是TIMESTAMPTZ(3)，现JavaScript Date cursor毫秒精度与schema一致。
现两个active索引以tenant/owner及可选project_ref分区，updated_at DESC、conversation_id ASC；目标谓词
updated_at < cursor_timestamp OR (updated_at = cursor_timestamp AND conversation_id > cursor_id)，不用两列同向row comparison。
所有值仍参数化，同owner Project存在性与active/tenant/subject门不变。无DDL、migration、兼容表、跨owner SQL或新事务。
Root用现实例与同role的自有临时数据库验证canonical fresh apply及真实分页；只回收自有库，不清共享Redis或用户应用数据。

# kokoro-bff data model

## BFF-CHAT-ROLE2：`bff_message.role` 两角色约束（2026-10-01；目标态，未实施）

`bff_message` 仍由 BFF Chat 唯一写入。当前 canonical SQL、domain/public TypeScript 与 OpenAPI 一致声明
`user | assistant | system`，row mapper 信任 row 字符串；真实漂移是这四项三角色声明相对于唯一 BFF writer、Agent contract
与 Web consumer 的两角色事实。目标 fresh canonical schema 把命名 CHECK 收窄为
`role IN ('user', 'assistant')`，不新增列、表、索引、状态、事务、receipt、缓存或
retention 规则。Message status/failure/run CHECK 与现查询、锁序和 tenant 过滤保持不变。

本仓采用 fresh schema，不提供 ALTER/migration；通用 fresh installer 的既有能力不变。本片验收中，Root 仅在自有随机
临时数据库内的空 `kokoro_bff` schema 运行 `db:apply-schema`，旧三角色 CHECK 不会自动更新。当前用户数据库与 rows
不修改、不删除、不扫描过滤；若激活前发现 historical/manual `system` row，必须由 Root 另立生命周期裁决，不得改为
assistant 或在读取时隐藏。fresh CHECK 承担精确两角色约束，row mapper 继续信任 canonical 数据库约束；本片不授权新增
mapper parser、过滤或 fallback。

待验：现 schema governance 测试先证明 `system` 可写的真实 RED，随后证明普通 user/assistant 成功、普通 system 以
`ck_bff_message_role` CHECK violation 失败；Root 使用同一现 PostgreSQL 实例/role与随机临时库执行 fresh
`pnpm db:apply-schema`，并执行定点测试、`pnpm contract:check`、architecture、lint、typecheck、build、full test。当前文档门
未运行数据库或服务，不构成 schema 已应用或用户数据已兼容的证据。


## BFF-RETRY-DESIGN：原 user 上的新 attempt（2026-09-30；零 BFF DDL，未实施）

### 当前数据事实与目标行语义

当前基线 `ccb8e144d72e35d90f9edc23f8b3ed0c82fde98d` 的唯一 canonical schema 已有
`bff_conversation`、`bff_message`、`bff_agent_dispatch_outbox`和 `bff_agui_stream`；没有 retry 表、attempt
表或 retry 列。这正是目标结构：重试不拥有独立于 Message/run/outbox 的生命周期、ACL 或查询，
所以不新建第二真源，`database/schema.sql` 在后续实施候选中保持原字节。

首次成功的 retry 在现表上形成下列事实：

| 事实 | 原行 | 新行 / 改写 |
| --- | --- | --- |
| user Message | 保留原 `message_id`、原 `run_id`、content/status/sequence | 无新 user，不改写原 run |
| failed assistant | 保留原 assistant/run/content/verified safe failure | 不改写，仍可审计 |
| retry assistant | 无 | 新 `message_id`、新 `run_id`、`role='assistant'`、`status='pending'`、空 content，failure 两列 NULL，`message_seq=MAX+1` |
| source dispatch outbox | 必须绑定原 user/assistant/run，`status='succeeded'`，严格 payload | 保留不变 |
| retry dispatch outbox | 无 | 新 outbox/run/assistant/request/identity；`user_message_id` 复用原 user；`status='pending'`；`conversation_dispatch_seq` 等于新 assistant 的 `message_seq` |
| AG-UI stream | `expected_run_id=terminal_run_id=old_run_id`；`latest_run_id` 可为 NULL/其他旧 marker | 同事务 register 新 expected run，version/fence 增长，terminal/start marker 按现 registration 清空，旧 lease 清理 |

新 outbox 冻结原 payload 的 content、requested model、agent、thinking、ordered Skill source refs、MCP
servers、project 和原 user ID，只生成新 request/run/assistant/outbox/identity。Agent owner 发布后，launch 还必须带
typed `retry_of_run_id=source.run_id`。BFF 严格解析原 persisted payload，不从 Message content 反推配置，
不从 HTTP body 重建冻结选项。Agent `4.0.0` 已是 owner 四文档冻结的目标设计候选，但尚未
实施/发布，当前仍无可 pin 的 artifact；不得在 BFF schema 中预埋未发布语义。

### 持久 envelope v3 与双 producer lineage

零 DDL 不等于持久 JSON 不升版。Agent 4.0 的 `retry_of_run_id` 是 required nullable，所以 BFF 两个
Agent launch producer 必须在同一 consumer cutover 升级：

| persisted fact | 当前 | 目标 v3 不变式 |
| --- | --- | --- |
| `bff_agent_dispatch_outbox.payload` | `schema_version=2`；launch 无 parent | `schema_version=3`；顶层仍 exact `{schema_version,launch}`；`launch.retry_of_run_id` required，normal 为 JSON null，retry 为非空 target run；canonical digest/parser/row lineage 都包含该值；v2 fail closed |
| `bff_idempotency_receipt.response_body` 的 Scheduler dispatch receipt | envelope `schema_version=2`；Snapshot Agent body 无 parent | envelope `schema_version=3`；envelope/snapshot/launch/body/trace/receipt 全部 exact closed；Scheduler 是 normal producer，所以 `retry_of_run_id` 必须存在且恰为 null；v2 fail closed |

Chat v3 首次持久前必须用新 Agent generated validator 验证 required nullable 字段。normal submit 的
canonical request material 显式含 null；retry material 显式含 parent run 并与 operation/target digest 一致。
row parser 重验 `request_id/run_id/session_id/message_id/content`、user/assistant/run identity 和 parent；public receipt 的
run/user/assistant 三 identity 只从该已验 outbox row 读取。
Chat v3 launch 的 required keys 为
`request_id/run_id/session_id/feature_key/message_id/content/selected_skill_source_refs/retry_of_run_id/trace`，
只允许 optional `requested_model_label`；trace 恰允许 required `source='kokoro-bff'` 和 optional
`project_ref/agent/thinking/mcp_servers`。

Scheduler v3 不再只检查 `selected_skill_source_refs=[]`。strict parser 必须验证 exact key set、
`retry_of_run_id=null`，并从 snapshot 的 tenant/schedule/occurrence/task 重算
`schedulerOccurrenceIdentity`；`run_bff_<identity>`、`msg_bff_<identity>_user`、
`msg_bff_<identity>_assistant`、`bff:<identity>`、`session_id=scheduled:<taskId>`、launch request ID 与 receipt
必须全部精确相等。否则在 Agent I/O 前拒绝，不用 snapshot 中的部分值拼出新命令。

Scheduler v3 的 closed key set 是：envelope 恰为
`schema_version/state/claim_token/lease_until/retry_at/snapshot/last_error_code/response`；snapshot 恰为
`tenantId/schedule/occurrence/idempotencyKey/actorId/taskId/launch`；launch 恰为
`requestId/body/identityAssertionRef/receipt`；receipt 恰为
`run_id/user_message_id/assistant_message_id`。Scheduler Agent body 恰为 required
`request_id/run_id/session_id/feature_key/message_id/content/selected_skill_source_refs/retry_of_run_id/trace`，
`selected_skill_source_refs=[]`、`retry_of_run_id=null`，trace 恰为 `source` 与 optional `project_ref`。
`response` 恰为 `status/body`，其 body 仍是已冻结的 HTTP JSON 值；state/claim/lease/snapshot/response 的现有
互斥不变式继续校验。任何层级多/少键都不是 v3。

### 资格与不变式

对一个未使用的新 key，事务必须证明：

1. Conversation 在当前 tenant 内 active、owner 是 admitted subject，且 `project_ref` 与 private query 精确一致；
   对 project conversation，现 `bff_project` owner row 仍存在。
2. target 是该 Conversation 中最新 assistant row，`status='failed'`，`run_id` 非空，
   `agent_failure_code`/`agent_failure_retryable` 满足现 `ck_bff_message_agent_failure`，且 retryable 恰为 TRUE。
   本地 dispatch failure、cancel、delete 的两列均 NULL，不可重试。
3. 唯一 source outbox 的 tenant/conversation/subject/user/assistant/run 与 target 及原 user 精确一致，状态是
   `succeeded`。source payload 必须通过版本化 strict parser，其 `session_id`/`message_id`/`run_id`/content/project
   与行及 Message 相等，未知字段、缺失冻结字段或不一致均 fail closed。
4. source 之后不存在 `pending`/`leased`/`retryable` dispatch 或 pending/streaming assistant；stream 必须有
   `expected_run_id=terminal_run_id=target.run_id`。`latest_run_id` 不是资格等式，因为 run 可在 START 前失败；
   `consumer_state` 也不是额外条件。仍在 active/HITL 的 run 无 terminal equality，因而自然拒绝。

### 锁序、same-key 恢复与单事务写入

在进入 SQL 前必须完成 online IAM session admission；不输出任何 receipt 前必须证明当前
Conversation/project/target visibility。仓储层在单一 transaction 内使用下列固定顺序，与现 AG-UI
projection 的 stream→Message 锁序一致：

1. `BEGIN`；有 project 时对 owner-matching `bff_project` 取 `FOR SHARE`。
2. 以 tenant/conversation/status/project/owner 对 `bff_conversation` 取 `FOR UPDATE`。在该已锁范围内做 target
   静态可见性查询；失败返回隐藏的 not-found，不输出历史 receipt。
3. 查询同 `(tenant_id,conversation_id,idempotency_key)` outbox。已有 row 且
   `request_digest=SHA-256(chat.message.retry,tenant,subject,conversation,project,target_assistant)` 时立即 commit 并回收
   其 run/user/assistant receipt；不同 operation/target/digest 拒绝冲突。该步早于下面所有动态 tail/state
   检查，保证 commit 后 reply 丢失可恢复。
4. 对首次 key，锁定并校验 source outbox 与当前可达的 unfinished outbox；验证 source `succeeded`、
   精确 lineage 和 strict parsed payload。
5. 对 `bff_agui_stream` 取 `FOR UPDATE`，校验 expected/terminal 等式；不依赖 latest 或 consumer
   stopped。
6. 最后按 stream→Message 锁序读/锁 target、原 user 与 tail，重做最新 assistant、verified retryable
   profile、无 pending/streaming 及全部 row/payload 绑定检查。
7. 计算 `next_seq=COALESCE(MAX(bff_message.message_seq),0)+1`；只插入一条新 pending assistant，并以同
   `next_seq` 作为新 outbox `conversation_dispatch_seq`。新 row 复用 original `user_message_id`，使用新
   run/assistant/outbox/request/identity assertion 和当前 actor。
8. 执行现 canonical consumer registration：expected 切到新 run，version/fence 增长，旧 lease/token/until 清空；
   更新 Conversation timestamp，`COMMIT`。之后 worker 才可进行 Agent HTTP I/O。

任一 validation、insert、registration 或注入故障都 `ROLLBACK`：不可留下孤立 assistant、outbox、新
expected run 或 fence 增量。Conversation row lock 使同 key 并发命令串行；后到者在第 3 步回收已提交
receipt，不存在一个另表“pending receipt”。

### generic receipt、retention 与删除边界

`bff_idempotency_receipt` 与 Chat 业务事实是不同 transaction，不能用于本命令。
`src/bootstrap/server.ts` 必须将 retry 列入 `durableChatAdmission`；否则在 Chat commit 后、generic receipt
commit 前崩溃会留下不可回收的 pending ticket。本设计的唯一权威 receipt 是 committed retry outbox。

v3 parser 不读 v2、不将 missing `retry_of_run_id` 当 null，也不在读取时重写 JSONB。Root-owned
验收只在 fresh fixture 中产生 v3。对已有受管运行组，activate 前必须先盘点 Chat v2
`pending/leased/retryable` outbox 与 Scheduler v2 pending/retryable receipt，在无新 admission 的有界窗口 drain。
已终态 v2 历史的 same-key replay/retry 政策、运行组是 fresh 替换还是保留数据停机切换，仍是
Root/owner 在 activate 前必须闭环的生命周期依赖。本片不清理、批量升级或删除用户/共享数据，
不擅自新增 scope/会话删除 SQL 或扩大 retention contract。

当前 schema 没有该些 Chat 行的 GC job。未来 retention 在 retry 可用/幂等回收窗口内必须同时保留原
user、target failed assistant、source outbox 与 committed retry outbox；不得先清 source payload 再从 public Message 猜配置。
Conversation delete 仍按现有保留/取消语义处理，删除状态下不接受新 retry。

### 真实 PostgreSQL / owner 验收矩阵（后续）

- canonical schema 安装前后 byte/DDL inventory 证明零新表、零新列、零新索引；
- 成功行数与序列：原 user/failed assistant/source outbox 不变，恰新增一 assistant+一 outbox，新
  message/dispatch seq 相等且无 gap；
- Chat normal/retry 都只持久 v3，分别锁定 required null / target parent；旧 v2、missing、extra、
  空串、自引用或 row/digest/receipt identity 不一致在 worker I/O 前 fail closed；
- Scheduler fresh claim/snapshot/restart replay 只持久 v3 且 required parent 恰为 null；v2、缺字段、
  non-null parent、extra key、canonical occurrence 或 run/user/assistant/session/request/assertion 错绑均在 Agent I/O 前拒绝；
- 串行与真并发同 key 都只有一 attempt；reply-loss 回收在 target 状态已变后仍返回同 receipt；
  同 key 的 submit/另 target 冲突；
- 非最新、failure NULL、两个 `retryable=false` code、非 failed、空 run、source 非 succeeded/错绑/坏 payload、
  active/pending/streaming/HITL 全部零写拒绝；`latest_run_id` 为 NULL 但 expected=terminal=target 的 START 前失败
  是合法正例；
- 跨 tenant/owner/project/target 无可见性且不泄漏 receipt；在 assistant insert/outbox insert/consumer registration
  各注入点验证完整 rollback；旧 lease/fence 的 stale worker 不能落帐；
- 真 Agent owner 门必须用同 original user/new run + `retry_of_run_id` 完成一次 attempt，证明原 pre-turn
  checkpoint/context 完整、native HumanMessage 只一条。当前 `SAME_USER_NEW_RUN=ChatIdentityConflict` 是必须先被
  Agent owner 修复的 RED，不是 BFF 可跳过的已知限制。

当前验收范围（2026-09-30）：BFF-AGENT-FAILURE3的canonical fresh install、动态CHECK7/7与真实七integration47/47已由Root
在自有隔离fixture执行通过。GC后snapshot/list/合法Share同safe profile矩阵已锁定；source/test冻结hash与资源回收见CURRENT。
这不是所有owner单库组合、真实provider或Web端到端的验收证据；下文目标约束由现canonical schema与实现承担。

## BFF-AGENT-FAILURE3：Message 安全失败数据设计（2026-09-30；canonical 与隔离数据库已验）

### 当前态与 owner

起始基线 BFF main `15e07fa44670bc13705ce3f6f700e73afcb72ccc` 的唯一 canonical
[`../database/schema.sql`](../database/schema.sql) 没有 failure 列，Agent 2.0 的 `retryable` 会被丢弃。当前
实现已在同一个 `bff_message` CREATE TABLE 内加入两列和本节完整命名 CHECK；没有 migration、第二张表、
新索引、默认值、role、retention 或 Redis truth。fresh install 与真实约束矩阵已经由 Root 的隔离 PostgreSQL fixture
验收，实际schema7/7及七integration47/47见CURRENT，不以静态schema test代替。

Agent owner commit `f3be3b97dd67df69ed3c6cb88c59f3bc2db97703` 唯一拥有 failure code 与 retryability 分类；BFF
目标固定其 HTTP `3.0.0` OpenAPI SHA-256
`e9f0a543f74dee34212f0ea4fe366d46218268462ac54dce08e41965f34d2d2c` 与 provenance 文件 SHA-256
`d116657f65027de8bd829dc0408fd86046da0ac0a1d2934bd2a87e835c897b5f`。BFF 拥有 Conversation/Message
和 durable public projection，目标只在已绑定 Message 保存安全、闭合的 Agent failure
快照。采用扩展既有 `bff_message`，不建 `bff_message_failure`：failure 没有独立身份、查询、权限或生命周期，拆表会给同一
Message 终态制造第二 writer/真源。新增两列都是 nullable，且不新增索引：当前读取始终先按既有
tenant/conversation/sequence 找 Message，不按 failure code 搜索。

后继固定来源时，`openapi.json` 与已发布 `provenance.json` 必须同存于
`contract/vendor/kokoro-agent/f3be3b97dd67df69ed3c6cb88c59f3bc2db97703/`，dependency manifest 固定两份文件
SHA，并由 generator 验证 provenance `http_contract.version/path/sha256` 及 failure generated artifact 的
`source_sha256` 都指向上述 3.0 contract；不能只凭文档文字接受数据码集。独立 delivery 旧来源仍保持原字节。

### 目标列与完整 CHECK

```sql
ALTER TABLE bff_message
  ADD COLUMN agent_failure_code TEXT,
  ADD COLUMN agent_failure_retryable BOOLEAN,
  ADD CONSTRAINT ck_bff_message_agent_failure
  CHECK (
    (
      agent_failure_code IS NULL
      AND agent_failure_retryable IS NULL
    )
    OR
    (
      agent_failure_code IS NOT NULL
      AND agent_failure_retryable IS NOT NULL
      AND agent_failure_code IN (
        'token_budget_exceeded',
        'recursion_limit_exceeded',
        'assembly_failed',
        'enqueue_failed',
        'dispatch_exhausted',
        'contract_incompatible',
        'internal_error',
        'model_unavailable',
        'dependency_unavailable',
        'model_access_denied'
      )
      AND (
        agent_failure_retryable = FALSE
        OR agent_failure_code IN ('model_unavailable', 'dependency_unavailable')
      )
      AND role = 'assistant'
      AND status = 'failed'
      AND run_id IS NOT NULL
      AND length(btrim(run_id)) > 0
    )
  );
```

项目 canonical schema 采用 fresh install，实际实现是在现有 `CREATE TABLE bff_message` 内加入两列和命名 CHECK，
上面的 `ALTER TABLE` 只精确说明目标 SQL 语义，不建立 migration。CHECK 保证两列同为 NULL 或同为非 NULL；10 个 code
都允许 `false`，仅 `model_unavailable` / `dependency_unavailable` 可为 `true`；非空 failure 还必须绑定
assistant + failed + 非空 run。user/system、pending/streaming/completed、run-less assistant 及所有非 Agent failure
终态必须两列均 NULL。BOOLEAN 不给 default，TEXT 不使用任意字符串、JSONB 或数据库 enum；owner 码集的下一次演进须先改
owner contract、BFF consumer/public contract、CHECK 与 Web consumer，不能只放宽应用 parser。

两个 `IS NOT NULL` 都是完整约束的一部分，不能依赖 `IN`/boolean expression 的 SQL `UNKNOWN`：PostgreSQL `CHECK`
会接受不为 `FALSE` 的 `UNKNOWN`，缺任一显式非 NULL guard 都可能让 partial-NULL row 通过。tests-only RED 必须写出分别直接插入
`(agent_failure_code=NULL,agent_failure_retryable=false)` 与
`(agent_failure_code='internal_error',agent_failure_retryable=NULL)` 的两个独立用例；当前 15e Schema 先因目标列/约束缺失而
稳定 RED，GREEN 安装目标 Schema 后两例必须各自以 CHECK violation 被拒绝，不能只靠静态字符串匹配。

### writer、事务与失败恢复

`bff_message.status='failed'` 当前有四类可达来源，目标数据语义如下：

| writer | status | failure 列 |
| --- | --- | --- |
| strict verified Agent `run.failed` | `failed` | 同一 source projection transaction 写二元组 |
| Agent `run.completed(status=cancelled)` | `failed` | 两列保持/显式设为 NULL |
| BFF dispatch permanent failure | `failed` | 两列保持/显式设为 NULL |
| Conversation delete 对 mutable assistant 的终止 | `failed` | 两列保持/显式设为 NULL |

`agent-cancellation-outbox.status='failed'` 只是取消命令自身失败，不更新 Message。禁止把 dispatch/cancel/delete 的本地
error code 转写为 `agent_failure_code`，禁止以 `internal_error` 补齐 unknown owner code。只有固定 Agent 3.0
`ChatFailure` 严格验证成功的 source 才能写二元组。

application→repository 的目标 assistant update union 也必须强判别：Agent terminal 为
`{kind:"fail",failure:<required safe profile>}`，取消为 `{kind:"cancel"}`。禁止让 `fail` 携 optional failure；
否则新增 writer 很容易在数据库 CHECK 之前丢失来源语义。`fail` 分支写两列，`cancel` 分支和
dispatch/delete writers 显式保持两列 NULL。

目标写入复用现有 `PostgresAgUiProjectionRepository.commitProjection()` 本地事务与锁顺序：可选 Artifact
Conversation lock → `bff_agui_stream FOR UPDATE` → source identity → bound Message → AG-UI frames → stream/version/
watermark。Message update 仍必须同时匹配 tenant、conversation、expected run、consumer subject、active Conversation
owner、非 failed dispatch、assistant ID、run、role 和 mutable status。verified failure 的两列、Message status/body、
`bff_agui_source_event`、`bff_agui_event`、projection state、run terminal marker 与 source high-watermark 同成同败；CHECK
或任一后续 insert/update 失败时全部回滚。重复 source 继续由 event ID/sequence/digest 证明同义，不产生第二 Message 写入。

完整 Agent source page 在进入事务前先验证 envelope、identity/sequence/watermark 与每个 failure payload。坏 event 在页首、
中间或末尾都不得产生 source row、Message 更新、frame、version 或 watermark；runner 沿现有 blocked settlement 只阻断该
consumer，其他 tenant/session consumer 不回滚。不存在坏页的部分接受或“跳过后继续”。

### reads、ACL、Share、GC 与 retention

- snapshot：先以 trusted tenant/subject/Project predicate 找 active Conversation，再在同一
  `REPEATABLE READ READ ONLY` transaction 读取 Message、Delivery、AG-UI cursor/active-run；Message SELECT 增加两列，
  failure/status/body/watermark 因此来自同一 committed snapshot。
- Message list：单条 query 继续以 tenant + owner + active Conversation + Project predicate 约束，再按
  `(message_seq,message_id)` keyset；cursor 不是权限凭据。
- Share：每页/读取继续检查 share ID、同 tenant/conversation、未撤销、未过期和 active Conversation，才读取相同两列；
  failure 不扩大 Share capability，也不泄露 raw payload。
- GC：现有 AG-UI GC 只删除旧 `bff_agui_event` 并维护 tombstone/retention floor，不删除或重建 Message failure；故旧
  `RUN_ERROR` frame 被回收后，合法 snapshot/list/Share 仍由 Message 返回安全 failure。
- delete/retention：Conversation delete 仍软删 Conversation、撤销 Share、保留 Message 供既有 retention/audit cleanup；
  本片不新增 legal hold、独立 failure retention、cache、Redis copy 或跨 owner SQL/FK/JOIN。

### 实施阶段记录（已完成）：tests-only RED 与 GREEN 真实数据库矩阵

以下记录已完成的实施顺序，不是当前未实施状态。tests-only阶段当时保持canonical Schema为15e bytes，先让 governance/integration tests 对目标列、完整 CHECK 与
直接 insert 矩阵形成稳定 RED；不先改 `database/schema.sql`。Root 接受 RED 后的单 owner GREEN 才写 actual canonical
`CREATE TABLE`，再以真实 PostgreSQL 执行：两 NULL 接受；code NULL + retryable false、code value + retryable NULL
两个方向都直接拒绝；10 code×false 和 2 availability code×true
接受；其余 8 code×true、unknown、空白拒绝；非 assistant、非 failed、NULL/空 run 携 failure 均拒绝；四类 writer 中
只有 verified Agent failure 非 NULL。真实 PostgreSQL 还要证明 projection 后段故障回滚 Message/source/frame/watermark、
并发/重复 source 收敛、RR barrier、tenant/subject/Project/deleted ACL、Share revoke/expiry、GC 后 Message failure 保留。

所有后继命令显式使用 `PATH=/Users/nako/.nvm/versions/node/v22.22.2/bin:$PATH` 并先记录
`node --version`=`v22.22.2`；默认 shell 的 Node 24/engine warning 不作为 Node 22 证据。预定门禁为
`pnpm schema:check`、空 `kokoro_bff` schema 的 `pnpm db:apply-schema` 与 drift、
`pnpm test:integration`（全部7个owner integration文件）及`pnpm test`中的schema/architecture checks。初始文档时点尚未执行这些门；
现canonical两列/CHECK已存在，Root fresh install、动态schema7/7、architecture27/27与真实七integration47/47证据见CURRENT。

## BFF-PERSONAL-DOC-GATE：本人安装不新增 BFF 数据事实（2026-09-30）

Platform `skills/installation` 是安装资源、enabled/removed 状态、generation、命令 receipt 与 outbox 的唯一 owner/writer。BFF 当前在途消费者已唯一固定 Platform `6519ae9a7dba63586474d2860f6725d3165b701e` v5.0.1 aggregate `3f97b3c98fd8e7ce46e4a8ea73237ddb85e764849d2b15dd28d0a3a58a69e42f`，五个本人 installation 方法只做逐请求 public 投影，不保存第二份安装表或 receipt；旧 v4 vendor/fallback 已删除。代码尚待 Root 提交和真实 owner 组合验收，产品未激活。`database/schema.sql`、`kokoro_bff` schema、现有表/索引/role、Redis DB 8、retention 与 fresh install 均不变。

BFF 不创建 `bff_skill_installation`、安装 projection/cache、command receipt、outbox 或 cursor 表，不复用 `bff_idempotency_receipt` 保存安装 ACK，也不查询/连接 Platform SQL。三个写命令的幂等、CAS、generation 与 original-safe-ACK replay 均由 Platform receipt 事务拥有；BFF 只在单次请求内验证并映射安全结果。unknown ACK 使用同一个 owner command identity 恢复，caller 取消不产生 BFF terminal row。GET/List 每次从 owner 读取，cursor 不持久化；Publish 不写安装事实，也不自动插入安装。

九字段安装安全表示是传输投影而非 BFF Row，精确字段为 `installation_id`、`source_ref`、`series_id`、`revision`、`installed`、`enabled`、`installed_at`、`updated_at`、`removed_at`。typed IDs/source 保持 opaque；revision 只以正 uint64 十进制 JSON string 输出；三个时间只接受 UTC RFC3339 `Z` 并保留 optional presence。owner 没有 `removed` boolean：移除态由 `installed=false`、`enabled=false`、`removed_at` present 表达。DELETE 的 200 receipt 首次有效移除为 change `removed`，自然 no-op 为 `unchanged`；写 ACK 保持 receipt 的 installation/change/event_id，同键 replay 只令 `replayed=true`。这不会转换为本地软删除。BFF 不保存 tenant/subject/target、package asset、digest/hash、manifest、签名 URL、execution proof 或 owner internal reason。GET 只包 `{data:<installation>}`；List 的 owner optional `PageResult.next_cursor` 仅在 present 且非空时映射为 public optional `meta.next_cursor`，非法 presence 502，不形成 BFF cursor Row。

本设计没有 BFF 数据事务、跨 owner FK/JOIN、双写、retention/GC 或 migration。当前实现的 schema 证据是 `git diff -- database/schema.sql` 必须为空，加 `pnpm schema:check`/`pnpm db:apply-schema` 回归现有 canonical schema；真实组合必须证明首次/replay/冲突/撤权/跨用户、disable/remove 在 unhealthy source 下仍可降权、分页 presence/cursor 与 BFF 重启后由 Platform receipt 恢复，而不是检查 BFF 新行。旧 503 installation stub/按 name route 删除不会迁移旧数据，因为它从未拥有 installation 数据。


## W3 Chat typed Skill 选择（已实现，零 SQL Schema 改动）

`bff_agent_dispatch_outbox.payload JSONB` 已是不可变 Agent launch 快照；本片将有序 `selected_skill_source_refs` 与 Chat 用户/助手消息、expected-run registration 在同一事务写入，并将相同有序数组纳入 `request_digest`。同键同摘要只重放原 receipt，异 ref/顺序 409；claim、lease takeover、HTTP 重试与进程重启只读取该 JSONB 原文语义，不从用户当前本地偏好或 Platform 列表重算。Chat payload `schema_version` 1→2，旧版解析确定失败，不双解旧 `trace.pinned_skills`。Scheduler 的现有 `bff_idempotency_receipt.response_body` envelope `schema_version` 1→2，`snapshot.launch.body` 首次持久化显式 `[]`、恢复原值重发；旧版 snapshot 拒绝而非补值。仅重建任务自有旧 fixture，不自动清理共享数据。没有新 Skill 事实、BFF 安装表、额外 SQL 列/索引/Redis key、跨 owner JOIN 或 BFF→Platform 预授权缓存；Agent/Platform 保留 Run/安装/执行权限真源。发布不自动安装/启用；用户须显式创建 installation。本数据门只保证基础 Chat 与 Scheduler 不因 Agent required 字段断链。

## 当前 Platform projection 数据边界

五个 GET 使用当前 IAM Product tenant/user 与独立 Platform projection credential 获取 owner 当前事实；BFF 没有新增 Skill/MCP 表、索引、事务、Redis key、receipt 或投影缓存，也不跨 owner SQL。`source_ref`、`revision`、status 与 cursor 来自 Platform；BFF 只校验并透出公开安全字段。旧 Capability HTTP transport 删除不触及本仓 canonical `database/schema.sql`。下方“未激活机器候选”为历史记录。


## 历史快照：Published personal Skill read（已由上文替代）

新 `GET /v1/skills/{skill_id}` 未激活机器候选不新增表、列、索引、事务、receipt、outbox、Redis key 或 cache。Skill tenant、user owner、PERSONAL scope、ACTIVE state、`source_ref` 与 `revision` 都是 Platform owner 事实；BFF 只在当次 IAM admission 后读取并安全投影七字段。非本人/跨 tenant/非 PERSONAL/非 ACTIVE 与缺失均由 owner read 隐蔽为 404。

后继原子 read cutover 也不得复制 Platform Skill/MCP 数据。旧四 GET 改用 Platform HTTP 3.1.0；个人 ACTIVE list 使用 `scope_kind=personal`。MCP 必须采用 owner-native 六字段、同步 Web 并移除当前实际 503 的旧控件，禁止持久化或继续合成旧 revision/url/allowed_tools/secret_ref。


## W3 Publish 运行候选：无 BFF 持久化 owner（2026-09-29）

Publish 现已接默认关闭的 BFF 具名 route/固定 Platform v4 Connect 调用；本仓 canonical SQL、索引、事务、Redis、receipt/outbox 仍无改动。每次含 replay 先当次 IAM，再让 Platform 按 current Skill/package/Storage CLEAN 与自身 command receipt 判定；BFF 仅做严格短暂 public 投影，不跨 owner SQL、不存签名或 ZIP。运行候选不代表产品激活或 Root 真 owner 组合已验；下节是文档门当时尚无 route 的历史状态。

## W3 Publish 候选：无 BFF 持久化 owner（2026-09-29）

本片仅新增唯一 public Publish OpenAPI/文档候选，BFF 还没有 Publish route；`database/schema.sql`、索引、事务、Redis、receipt、outbox 与角色均零变更。Platform 唯一拥有 current Skill/package、validated→active CAS、command receipt 与 `skill.published` 内部 outbox；Storage 唯一拥有 Asset/scan/对象健康。BFF 不读取其他 owner SQL、不复制 Skill/包/事件事实、不存成功 replay 或签名 URL，不代理 ZIP；未来每次包括同键 replay 先当次 IAM，再交 Platform current owner/fresh Storage 判定。公开 source_ref/revision/status/event_id/replayed 只是 owner 已提交事实的短暂投影，不新建 BFF 表或跨仓事务。Web/真组合/激活另门。

## W3 Validate runtime：无新增 BFF 数据事实（2026-09-29）

默认关闭的 Validate route 已接 owner v4 generated Connect，但本仓 canonical `database/schema.sql`、索引、Redis、Skill/Upload receipt 与对象字节缓存均零变更。每次 replay 先当次 IAM/Platform；`attempt_id` 只在请求内用于 owner current-attempt 匹配，不能成为 BFF 事实。Platform/Storage 仍分别拥有验证状态/manifest/command receipt 与 Asset/scan/对象，BFF 不跨 owner SQL、无 Storage RPC/ZIP 字节代理；下节“无 route”是文档门历史基线，Root 真 owner 组合和产品激活待验。

## W3 Validate 候选：无 BFF 持久化 owner（2026-09-29）

本片只有唯一 public Validate OpenAPI/文档候选，无 BFF Validate route。Skill current draft/attempt、Storage Asset/scan/ZIP、manifest、验证状态与 owner command receipt/CAS 均留在 Platform/Storage；本仓 `database/schema.sql`、表/索引/事务/Redis 不变，不新增 BFF receipt、asset/hash 镜像或跨 owner SQL。每次包括重放仍先 current IAM 与 owner fresh 检查；`attempt_id` body 仅未受信选择符，不能把它持久化为本仓权威事实。200 的 digest/manifest 是 owner 已验证投影，ZIP `uploaded`/CLEAN 不是 validated，Validate 也不是 published。后续运行片、真组合和 Web 才能给产品完成证据。

## W3 Complete runtime：无新增 BFF 包数据事实（2026-09-29）

默认关闭的 Complete route 已接 owner v4 generated Connect，但本仓 `database/schema.sql`、索引、Redis、receipt、对象字节缓存均零变更；Platform/Storage 仍分别拥有 current attempt/command receipt 与上传/Asset/scan。每次重放先当次 IAM/owner，BFF 只短暂校验并投影 owner response，内部 asset_id 不写入也不公开。无跨 owner SQL/Storage RPC/上传代理；文档门“无 route”是前片基线，产品未激活，真 owner Complete 组合待 Root 独立验证。

## W3 Complete 候选：无 BFF 持久化事实（2026-09-29）

本片仅为 public Complete 文档/机器 OpenAPI 候选，BFF 当前没有 Complete route。包 attempt、upload、scan、asset、command receipt/CAS 的唯一 owner 分别为 Platform/Storage；BFF `database/schema.sql`、索引、迁移、Redis 均零变化，不新增或复用通用 BFF mutation receipt 保存命令/签名 URL。每次含 replay 的 IAM/owner 检查必须读取当次权威事实，不能用 BFF 缓存命中代替。Body 的 attempt/upload/hash/size 仅供 Platform 与 current Skill/Storage 匹配；即使 owner 返回 asset_id，未来 public 投影也不持久化或公开它。Get 没有 hash/size，BFF 不建刷新恢复副本；客户端只能持原描述符/重选原文件精确重算，或新 Begin 显式替换。owner v4 inactive/产品未激活，真 Complete 运行和三方组合另验。

## W3 Begin runtime：无新增 BFF Skill 数据事实（2026-09-29）

Begin 已有默认关闭运行候选，但本仓 canonical `database/schema.sql`、Redis、Skill/Upload receipt 与签名缓存均未增；稳定 command ID/owner digest 仅随当前调用发 Platform，由其持久 receipt/attempt CAS 和 Storage Upload 承接重复/冲突与签名重签。BFF 不读取其他 owner SQL、不保存 URL/query/headers、也不代理 ZIP 字节。每次 HTTP 重放仍先 IAM，撤权不靠本地 receipt 放行；真 owner 组合及浏览器数据面后续由 Root/Web 独立验。下方文档门“只有机器候选”按原切片基线理解。

## W3 Begin 文档门：零 BFF Skill/Upload 数据事实（2026-09-29）

BFF 当前 canonical `database/schema.sql` 与 Redis 没有 Skill 包状态、Storage Upload 或专用 Skill receipt；本片只有 inactive public Begin OpenAPI 候选，不改 schema、Prisma、迁移、索引、缓存或后台任务。未来 Begin 也不走 BFF generic `bff_idempotency_receipt`：BFF 的稳定 command ID/owner digest 传给 Platform，Platform Skill current attempt/epoch/version + durable command receipt 是唯一状态/幂等 owner，Storage v2 持有 Upload、对象与扫描；BFF 不跨 owner SQL/JOIN、不存签名 URL/headers/expiry、不把浏览器 ZIP 字节落地。每次包括 replay 都须当次 IAM session 与 Platform 当前 owner/attempt 授权，不能用本仓缓存 result 绕过撤权或过期。首次/显式替换、旧 attempt CAS、外部 Storage ACK/COMMIT unknown 与 orphan retention 均属 Platform/Storage owner 边界；短期 PUT 的浏览器 CORS/批准 origin 验证留后续真组合。下方 Get/W1E 历史段落按各自基线理解，不覆盖本节。

## W3 Get runtime：零本仓数据模型变更（2026-09-29）

当前 BFF consumer 已从 Platform 旧 v3 替换为 owner `263a28f` inactive v4 原字节/生成物，且具名只读 Get runtime 候选已接线；唯一 canonical `database/schema.sql`、BFF Redis 和所有 receipt 均未改。每次请求经 IAM session 后只读 Platform canonical Skill 的 current attempt/epoch/phase/upload，由 Platform 自身持有 tenant/owner/draft 权限；BFF 不读 `kokoro_platform`/Storage schema，不缓存包事实，不把 GET 写进 `bff_idempotency_receipt`。Proto uint64 在 HTTP 转 decimal string，非法 owner 状态 fail closed 502；撤权不使用旧快照。Root `4300f4fc` 真 IAM/BFF/Platform 隔离组合已验 fresh draft `none` 200、Publish 后 412、同一 session 撤权后 401 且零新增 Platform socket；中间各 phase 尚未由 BFF public Get 真 owner 组合逐一采样，public activation 尚未完成。下方 DOC-GATE/W1E 是历史切片基线，其“pin v3/无 Get route”不覆盖本节。

## W3 user-only package upload Get：零 BFF 数据变更（2026-09-29）

当前 BFF clean `main caa99d90f57329065eeb0e98168316b2b1874159` 的唯一 canonical `database/schema.sql` 没有 Skill catalog、package attempt、Storage Upload 或专用 Skill command receipt；已有 `bff_project_skill` 是 Project 产品关联，不是 Platform Skill 真源。BFF 当前只实现默认关闭的 CreateDraft 候选并 pin Platform `5b6eb2c` inactive v3；Platform owner `263a28f` 的 package Get/Begin/Complete/Validate/Publish 真组合已验但未由 BFF public 消费。下方 W1E 段落记录旧 CreateDraft 切片，不把“真 sandbox 未验”或“Validate/Publish 未通”延伸到 Platform 当前 owner 状态。

本轮只新增 public Get 的候选 OpenAPI/设计，`database/schema.sql`、BFF Redis 与运行时均不变。未来 Get 每次在 IAM session 确认受信 tenant/user 后，向精确 pin 的 Platform 只读 RPC 取当前单行 package phase/attempt/epoch/upload；BFF 不持久化/缓存副本、不查询 `kokoro_platform` 或 `kokoro_storage` schema，也不使用 `bff_idempotency_receipt`/进程 Map。Platform 的 Skill 单行与其 receipt 仍为唯一权威状态；Storage 拥有 Upload/Asset/scan，GET 不向 Storage 签发引用。响应的 `attempt_epoch` 作为 decimal string 投影，以免 uint64/BigInt 精度丢失；`none` 的 absent ID 与 epoch 0、其他状态 presence 由后续 BFF client/route 校验，不通过新增 BFF 表或 SQL 约束承接。任何本轮 Schema diff 均属越界；下一代码片仍须在相同零 Schema 边界证明当次撤权后无 Platform I/O。

## W1E user Skill draft 数据门（2026-09-29；runtime 候选已实现、零 Schema 变更）

当前 BFF main `2a95da2410fd89c300dc18064867ee66617549e2` 的 canonical `database/schema.sql` 没有 Skill catalog 或 Skill 专用 receipt 表（已有 generic BFF receipt 不用于此操作）。Platform consumer 已 pin owner `5b6eb2c1532b23b9747bc4bf6ac99f69ad453de0` 的两份 Proto 与完整 inactive v3 artifact/provenance；public CreateDraft 机器 OpenAPI 与默认关闭 runtime 候选均已实现；真实 IAM→BFF→Platform sandbox 尚未验证。以下 user-only 目标以 Platform main `5b6eb2c1532b23b9747bc4bf6ac99f69ad453de0` 的 execution artifact v3 aggregate `324e749da1bc66c1ff03de74e7299716f798f5f5bb5fa19556033b79fa09ff8d` 为离线候选来源；该 artifact 仍 inactive/routable=false；这是发布标记而非 runtime RPC kill switch。Root 可在隔离 sandbox 通过候选 route 验证真实写入/replay，但公开发布仍需六 owner sandbox、active artifact 重钉与协调激活。本片零 BFF Schema/Redis 变更；Skill/revision/command receipt 只写 Platform owner schema，每次请求先以当前 IAM session 重验受信 tenant/subject，BFF 不用自己的 generic receipt 返回 Skill replay。Storage package/Validate/Publish 和其他 owner scope 不在首片。

## W2-F2-S9 Chat Delivery 快照数据边界（2026-09-28；BFF canonical Schema 已修改，待 Root 集成审查）

代码门前 `bff_conversation_artifact` 主键 `(tenant_id,conversation_id,artifact_id)`，存 Agent 来源 event ID/sequence/digest、run、asset/kind/hash 与 `delivered_at`；它不存 `title/mime/size`。当前 `ChatRepository.readSnapshot()` 在一个 `REPEATABLE READ READ ONLY` 事务内读本人 active Conversation（含 Project owner predicate）、最近 100 条 Message、公开 AG-UI cursor，却没有读关联，故 service 恒给空 `deliveries`。`bff_agui_event` 帧可 GC，非作品持久真源。

现已在本仓 canonical `database/schema.sql` 为既有关联增必填 `source_title TEXT NOT NULL`、`source_mime TEXT NOT NULL`、`source_size_bytes BIGINT NOT NULL`（非空白、非负且为 JS 安全整数）；三者来自已受信、不可变 Agent `delivery.created` claim，随既有 `commitProjection` 的 source/关联/frame/stream 水位同事务写入，重复 source/冲突不覆盖。项目未上线，canonical schema 采用 clean-slate fresh install，隔离测试库与 fixture 随 Schema 重建，不为旧行设 nullable/占位/双轨回填；若代码门发现必须保留的真实旧数据证据，先报告 Root 再裁决。本窄展示 claim 不是 Storage 当前 Artifact metadata；不存 Agent `path`、Storage title/filename/scan/object key/签名 URL，不复制 owner 数据库。

读侧在同一 Chat snapshot 事务里先确认当前主体可见的 active Conversation/Project，再按 `(delivered_at DESC,artifact_id ASC)` 查本会话 101 行，返回最近 100 行及 `deliveries_has_more`，输出保持该稳定顺序；Message 仍按 `message_seq` 独立排序。现有全局 Library 索引以 `(tenant_id,delivered_at DESC,conversation_id,artifact_id)` 开头，不能声称它已高效服务单会话查询；隔离真 PG 20k 关联/100 会话样本中，原全局索引单会话 LIMIT 101 为 109 shared buffers/0.288ms，具名单会话索引 `(tenant_id,conversation_id,delivered_at DESC,artifact_id ASC)` 为 6 buffers/0.037ms，故本代码片已加入；仅是本次样本，不作生产性能承诺。读公开 cursor 必在同一 MVCC 边界；关联与 frame/stream 的写入本来同成同败，快照前后竞态由 watermark 续流与二元去重闭环。Conversation 软删同事务清关联，frame GC 不删关联；无跨 owner SQL/FK、无新表、Redis 或 Storage metadata 镜像。

代码门验收：空 schema 安装/漂移、新行三字段全值、真 PG 同事务 watermark+交付、101 件边界/排序、重复 source、GC 后刷新、软删/本人/Project、event/snapshot 竞态与查询计划；本仓 canonical Schema 和隔离真 PG 测试已实施，Web/跨仓链仍待验。

## W2-F2-S8 Artifact 下载时限：无持久模型变更（2026-09-28；BFF 单仓已实现）

当前 `GET /v1/library/artifacts/{conversation_id}/{artifact_id}/content` 逐次按当次 IAM 身份查询本仓
active Conversation 与 `bff_conversation_artifact` 关联，再读 Storage 唯一拥有的 FINAL+CLEAN metadata/
签名引用；最多 1 GiB 原字节进入请求独占临时文件，校验后才出站。基线同一 120 秒信号覆盖取回和
出站的问题现已按阶段拆分，属于请求生命周期而非数据库状态。已存在的 `bff_conversation_artifact` 只保存受信交付
关联；临时文件、计时器、活动名额和已发送字节不属于可持久化 Product 事实。

当前该 route 的生命周期分为保留最多 120 秒的本人关联/最终态/引用阶段、7 分钟总/
45 秒无落盘进度的对象取回校验、28 分钟总/25 秒无出站进度的响应管道；2+7 分钟为 Web
10 分钟未发头预算留约 1 分钟。共用客户端取消向可取消的 I/O 传播，异常对象流的取消 Promise
不会阻塞本地清理，不把普通 PG query 或磁盘 syscall 冒称严格硬取消；临时目录与文件句柄在
成功、未发头失败、已发头失败、取消时都释放，每进程同时保留的 spool 名额仍为两份，
清理后可复用。对象字节、预签 URL、阶段 deadline、出站偏移、计数器和权限结论均不写 PostgreSQL/
Redis，也不增加恢复队列：失败后重新 GET 必须重新进行本人授权与 Storage 当前态/引用核验，不能
从残留 spool 恢复或复用旧签名引用。

因此 `database/schema.sql`、`kokoro_bff` owner schema、事务、索引、receipt、outbox、AG-UI ledger、
Redis DB 8、retention 与跨 owner 数据边界均零变更；不增加 BFF Artifact metadata 镜像或跨仓 SQL。
单仓假钟/慢消费者及取消异常测试已回归两名额在正常/超时/断开后的释放，Root 独立 Node 22 全门
通过；Root `f9f5befa` 在本代码片 `b382642` 上已验真 owner 小件原字节/私有及自有资源清理，
代表性 1 GiB 限速仍待验。现有下节 S5 初版“目标新表/尚未修改 Schema”是历史设计基线；当前是否
已经落表以本仓 `database/schema.sql` 与 `docs/CURRENT.md` 顶端 S5 代码片为准。

## W2-F2-S5 Conversation↔Artifact 关联投影（2026-09-28；文档目标，Schema 尚未修改）

**当前事实。** BFF `d5c868f8ab8b8a33750e1286e9d020ca72895641` 的唯一 canonical
`database/schema.sql` 已有 `bff_conversation`、`bff_share`、`bff_agent_dispatch_outbox`、
`bff_agui_source_event`/`bff_agui_event`/stream 与其 lease/GC；没有 Artifact 关联表。
`bff_agui_event` 是有限期公开重放帧，不能作为 Library 持久事实。Storage
`d5cfc442c675e32363ae767f5ec662a9e0d9eaea` 唯一拥有 Artifact/Asset/Scan/Blob 表；
Agent `486adb1539dd8a06ca90684e66f91be031aa70cf` 唯一拥有 Run、tool journal、critical
`delivery.created` 与 Chat `delivery`。本节设计没有更改任一 Schema、role 或数据库。

**目标唯一新表：** 在本仓唯一 `database/schema.sql` 的 `kokoro_bff` owner schema 增
`bff_conversation_artifact`，只保存 BFF 的“已验证 Agent 交付事件把某 Artifact 关联到某 Conversation”
这一 Product 关系；Agent 事件中的 asset/kind/digest 仅作为不可变来源声明供 Storage 交叉核验，
不当成可公开的 Artifact metadata 真源，不保存 Storage title/MIME/size/scan/对象 key/URL 的副本。

| 列/约束（目标）                                                                                | 用途                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenant_id`, `conversation_id`, `artifact_id` 非空 TEXT                                        | 关联 identity，`PRIMARY KEY (tenant_id,conversation_id,artifact_id)`；ID 不是授权。                                                                                                                                                                                        |
| `run_id`, `source_owner='kokoro-agent'`, `source_event_id`, `source_sequence`, `source_digest` | 可信执行及源事件身份，`UNIQUE (tenant_id,conversation_id,source_owner,source_event_id)`；同身份异内容/异 artifact、同 artifact 异来源都须事务失败而非 `ON CONFLICT DO NOTHING` 静默吞掉。                                                                                  |
| `source_asset_id`, `source_artifact_kind`, `source_content_sha256`                             | 必填、不可变的 Agent 交付声明；`source_artifact_kind` 仅八值、digest 小写 64hex。只用于对照当次 Storage `GetFinalArtifact` 的 asset/kind/digest，不在绕过 owner 重验时直接输出。                                                                                           |
| `delivered_at TIMESTAMPTZ(3)`                                                                  | Agent source event 的 UTC 时间，只作 BFF 关联顺序，不冒充 Storage Artifact `created_at/finalized_at`。                                                                                                                                                                     |
| 索引                                                                                           | `ix_bff_conversation_artifact_library (tenant_id,delivered_at DESC,conversation_id ASC,artifact_id ASC)` 服务跨会话 keyset；主键服务二元组与删除查询。若真实 EXPLAIN 显示 tenant 宽扫描不可接受，再由代码门评审 BFF owner 快照/索引，不预存 Storage metadata 或 IAM 决策。 |

投影源只能是固定 Agent event-protocol 的 `delivery.created`/Chat `delivery`，严格解析 artifact ID、kind、
asset ID、run ID 与 source identity；其来源声明不作为新表的第二 Artifact 真源。`commitProjection`
既有 PostgreSQL 事务中先验证连续源身份、`bff_agent_dispatch_outbox` 的 tenant/conversation/run/subject
与 active `bff_conversation.owner_id`，随后写 source ledger、关联、AG-UI frame 和 high watermark；
全部同成同败，lease/version 冲突回滚。重复投递以源 event ID、digest、sequence 与关联主键复核同一
含义，不双写；源内容冲突/关联冲突阻断页而非悄悄跳过。没有跨 Storage 事务、SQL、FK 或 JOIN。

Library SQL **在 LIMIT 前**按当次 IAM tenant/subject JOIN 本仓 active `bff_conversation` 过滤，
应用现有适用的 Project owner predicate，按 `(delivered_at DESC,conversation_id ASC,artifact_id ASC)`
推进 opaque keyset；cursor 绑定 kind、tenant、subject、limit，每页重新准入/授权，不提供快照隔离。
候选关联再以可信 conversation scope 调 Storage `GetFinalArtifact` 读取 FINAL+CLEAN 当前态，核对
artifact/asset/kind/digest/source_run_id 与源绑定；消失/非 CLEAN 项不返回，owner 不可用返回依赖错误。
单项/下载先查同一 BFF active Conversation+关联，再用 Storage Final Artifact RPC 重验，不能以
`bff_conversation_artifact`、content hash 或 Storage service identity 单独放行。

Conversation 软删除与关联物理清理、当前 Share 撤销同属 BFF 删除事务；历史 Agent source 迟到/重放
对 deleted Conversation 不再插入关联。AG-UI frame 的 7 日 GC 与关联生命周期分离；未删除的 active
Conversation 作品在 frame GC 后仍可列，删除后不通过旧 frame/Redis/hash 恢复。Share 读取每次核
`bff_share` 未撤销、未过期、同 tenant/conversation 且 active，专用 share-bound 操作不把团队成员或
匿名 Artifact ID 变成 owner 资格。关联 GC/删除策略只影响 BFF Product 可见性，不删除 Storage Artifact；
若要物理删除 Storage 对象，须另立 owner 生命周期任务。

代码门的 Schema 证据：`pnpm schema:check`、空 `kokoro_bff` schema 安装/drift、真实 PG 的同事务
崩溃/重复/冲突/删除/租户 keyset 与 EXPLAIN；契约证据是本仓 OpenAPI/Storage 生成来源 checker 和
Agent event source digest。本次只改四份设计/CURRENT，不能把新表或 Product 200 记作当前存在。

## W2-BFF-PERSONAL-DOWNLOAD：下载不新增本仓事实（2026-09-28；代码片待 Root 验收）

设计门基线 BFF main `74bb714d5867399bc50806c158c2ffb838c27b40` 尚无公开个人文件下载路径；
本工作树代码片已加入 `GET /v1/library/files/{asset_id}/content` 的 OpenAPI/runtime，但真 owner 与浏览器
仍待 Root 验收。BFF 每次经 IAM
admission 后，从可信 tenant/subject 派生 personal scope；Storage `GetAsset(asset_id)` 是 Asset/Purpose/Scan/
摘要/大小的唯一 owner 读取，`GetDownloadReference` 是同一 owner 的短期签发。BFF 仅在一次请求内暂存
不超过 1 MiB 的对象字节，核对 owner 元数据和 SHA-256 后一次性发出，不持久化对象、引用、查询结果或授权决定。

`database/schema.sql`、既有 `bff_idempotency_receipt`、`kokoro_bff` schema、索引、事务、retention、
Redis DB 8、role、outbox、AG-UI ledger **均不变**；GET 不建立 public idempotency receipt 或缓存。
Storage Proto 要求签发命令身份和其自身命令 receipt，这是 Storage owner 的现有事实，不是 BFF 表。
不同租户/subject、Project、package、Artifact、非 ASSET 或非 CLEAN 对象均不形成 BFF 下载数据；
不查询 Storage SQL，不建立跨 owner FK/JOIN，也不双写 Asset/Scan/Blob。Storage 引用过期后重新准入和
签发，不把短期 URL 放入 Library 列表、浏览器持久状态、日志或历史回执。

## W2-BFF-LIBRARY-PERSONAL-UPLOAD-CODE：写入命令复用既有 receipt（待 Root 集成验收）

设计基线 BFF main `a67ae2d06b52202f349305ae3723f6e296c087a1` 的个人 Library 仅 GET；本代码片新增个人 POST。
`database/schema.sql` 中 `bff_idempotency_receipt(scope TEXT PRIMARY KEY, fingerprint, status,
response_body JSONB, created_at)` 已供 Project 上传和普通 Product mutation 使用。本个人 POST 不新增
`bff_file`/Asset 镜像表、upload 表、索引、role 或跨 Storage SQL；Storage 仍唯一持久化 Upload/Asset/Scan/Blob。

既有同一 canonical receipt 表内使用**两个不相撞的 scope**：

1. public 终态：`[trusted tenant, trusted subject, "POST", "/library/files", key]`，指纹覆盖个人文件的
   filename、MIME、字节长度与 SHA-256；仅保存已确认 CLEAN 的成功响应或确定性终态错误。IAM 当前准入及
   文件指纹校验在 claim/replay 前执行，跨用户/租户绝不读取对方 receipt。
2. Storage 恢复 checkpoint：`[trusted tenant, trusted subject, "personal-file-upload:v1", key]`，同一指纹，
   持久 body 只存原 `upload_id`。从该 scope 哈希稳定派生 Create/Complete command identity；它不同于
   Project 的 `project-resource-upload:v1 + projectId`，不会把 Project predicate 机械换成 subject。

claim 的 pending 状态、60 秒 stale-claim 与现有主键可用于同键并发；业务请求 45 秒 timeout 和 caller
取消不能把未知 Storage 完成结果当失败后另造 Upload。首次 Create 成功后先证明 checkpoint 写入，
才使用受限 PUT 引用；Create 应答丢失或 checkpoint 暂时失败由相同 command 重放恢复。个人 Product 上传不内联 Abort，避免可重试失败把原 Upload 变为 aborted；重试读取
GetUploadStatus，completed 时再 GetAsset 核对身份、指纹、purpose/scan；pending 时沿原 upload 与相同
command 恢复 PUT/Complete。最终 200 必须先证明 public receipt 持久化，不能只写内存 Map。

`src/infrastructure/postgres/idempotency-repository.ts` 的 `putReceipt` 已检查条件写 affected-row，0 行立即报错；
直接测试覆盖 0 行，真 PostgreSQL 并发、stale claim、崩溃恢复仍待 Root 组合验证。
现有表/主键足够，若测试证明需要新的数据约束再单独评审 canonical schema，
不为预想扩展先建表。上传后 Library GET 仍从 Storage personal CLEAN ASSET 查询，BFF 不双写列表事实。

## W2-LIBRARY-BFF-FILE：个人文件只读投影（2026-09-28，待 Root 集成验收）

当前 BFF `GET /v1/library?kind=file` 通过 Connect v2 只读 Storage，不写 Library/Asset/Artifact 数据。Storage owner
`2d87e26bbaed9a70dcd91ad1e9d126d39d275f38` 已在唯一 `kokoro_storage` canonical schema 内按
`tenant + personal scope`、`upload_purpose=asset`、`scan_state=clean` **先过滤后 keyset 分页**发布 v2
`ListAssets`；BFF generated 输入已固定新 Storage `2d87e26`。当前用户身份投影到该 owner RPC，
不在 BFF 复制一个文件事实。

目标 `GET /v1/library?kind=file` 的 `items` 是每次从 Storage CLEAN ASSET 映射的瞬时表示，
`next_cursor` 是绑定受信 tenant/subject/scope/limit 的 owner opaque 翻页位置；每页重新执行 IAM
admission 与 Storage scope 授权，不保存到 BFF PostgreSQL/Redis 或浏览器长期缓存。BFF 不查询 Storage
表/Blob/Scan SQL，不按文件创建者、相同摘要或项目成员推断本人权限；个人 `scope_id` 始终为当次可信 subject。
无匹配返回空页，感染、待扫、package、Artifact 及其他个人/项目/会话范围行不进入此表示。

本列表对 `database/schema.sql`、既有 Project 上传 receipt/事务、Redis DB 8、BFF schema、role、索引、
retention/outbox 零变更；不创建 `bff_library`、`bff_asset` 或 `bff_artifact` 表，不持久化列表 cursor、
缓存、receipt 或第二读模型，也不建立跨 owner FK/JOIN/双写。Storage 继续拥有对象生命周期、扫描、
摘要与短期下载引用。Agent 最终 Artifact 有另一身份/生命周期；F2 kind/title/source、可信 Run 与独立
列表/下载尚未发布，不能把 personal ASSET 行重命名成 Artifact。

**个人上传**的既有 receipt 复用和代码片验收边界以上方为准，不把本列表改成 BFF 写入事实。
后续**个人下载**每次重验当次 scope，并以 GetAsset 检查 `upload_purpose=ASSET`、CLEAN 后才向 Storage
索取新的 GetDownloadReference；短期 URL 不写 BFF receipt、列表或长期业务事实。Storage 当前
GetDownloadReference 自身没有固定普通 ASSET purpose，单独调用它不足以保证此 Product 语义。

## W1E-IAM-0.7-BFF-PIN：当前数据边界

IAM 0.7 仍唯一拥有 Organization Skill 授权决定。BFF 的窄 `SkillAuthorizationClient` 只作每次在线查询，
不存储或缓存 IAM allow、成员/角色、会话或授权正文；当前 `database/schema.sql`、事务、Redis、receipt、outbox、
AG-UI ledger 均未改变，也无跨 owner SQL。Product Skill mutation 尚未接入该 client。

## W1E-IAM-0.6-BFF-PIN：历史数据边界

IAM `a4c2b61467f1fc1772d6b6d8e98f081c090289fb` 唯一拥有 Platform workload 身份、资源与 token
introspection 事实；BFF 此片只固定 OpenAPI `0.6.0` 来源，不调用该操作，不存储、投影或复制 IAM 决策。
`database/schema.sql`、事务、Redis、cache、receipt、outbox、AG-UI ledger 均不变；无跨 owner SQL。

## W1E-IAM-E2-BFF-SOURCE-PIN：历史数据边界

IAM `b720b6dc095b883237682102ca0a87ed6451a968` 拥有 execution authorization 决策、审计及其数据生命周期。
BFF 本片仅固定完整 OpenAPI 0.5.0 来源；生成 operation allowlist 不增加 E2 verifier，不调用新操作，
不增加持久化事实或跨 owner SQL。
`database/schema.sql`、事务、Redis、cache、receipt、outbox、AG-UI ledger 均不变。

## W1E-IAM-PERMISSION-CONSUMER：数据边界不变（历史验收）

IAM `5c9cecf714c87234bbc9558665b23e09afa6e9f6` 的新增 `platform:execute` 是 IAM 角色目录代码事实，
不是 BFF 数据。BFF 仅更新版本固定的只读 client 与 relay 来源；`database/schema.sql`、SQL/Redis、事务、
cache、receipt、outbox、AG-UI ledger 及 owner 数据生命周期均不变。

## W1D-RELAY-PIN-BFF：数据边界不变（历史验收）

IAM owner `6a55ffb4c22f0b155ddb83157735c0ace766701d` 的固定传输来源字节与上一 pin 相同。
本片只更新 BFF relay policy、generated IAM client 的 commit provenance 与 vendor 路径。
IAM 继续唯一拥有 Identity/Session/Tenant/Invitation/Member；BFF 不新增 SQL、schema、Redis、缓存、事务、receipt、outbox 或跨 owner 读写。
`database/schema.sql` 与全部现有业务数据生命周期保持不变；验证聚焦来源生成与无业务 diff。

## R5-INVITE-BFF-RELAY：邀请 transport 无本地事实（历史设计门）

IAM main `7215223b2ed27a0d5217f3bbaaabce547006d3bb` 是 User、issuer Session、Tenant、Invitation、recipient、
角色、Member 与 accept/reject 状态的唯一 owner。BFF 目标切片仅增加一个受限 Better Auth 静态 sign-up transport、三个精确
Nest invitation dynamic transport，以及 verify-email 的精确 Web Location 回跳；它不拥有或投影这些业务事实。

因此 `database/schema.sql`、当前 16 张表、owner schema、索引、约束、retention/fresh install、Redis DB 8、
`bff_idempotency_receipt`、outbox、cache、AG-UI ledger 与业务 transaction **全部不变**。BFF 不保存注册 email/name/password、
验证 token/callback、issuer Cookie、context 响应、邀请 ID/角色/过期时间、Member ID 或 accept/reject 结果；不读取 IAM PostgreSQL/
Redis，不创建跨 owner SQL/JOIN/外键，不把 browser-private interaction 变成 Product Team 数据。

`/sign-up/email` 可能在 IAM 内创建未验证 User 并发送 SMTP；context 是 IAM RepeatableRead 只读查询；accept/reject 在 IAM
Serializable 事务中条件更新 Invitation，accept 才创建 Member并写 IAM Audit。BFF 的单次 HTTP transport 不与这些 IAM 事务组成
分布式事务。BFF 的 no-store/no-referrer、大小/时间/取消与来源 policy 只是传输约束，不是持久化或缓存事实。IAM 的 context Redis
限流桶仍是 IAM owner 协调数据，BFF 不复制计数或把它写入本仓 Redis。

状态只由 IAM 收敛：

```text
pending --accept--> accepted + Member
pending --reject--> rejected
pending --owner cancel--> canceled
pending --time passes--> unavailable/expired
```

context 不修复或写状态，只暴露与已验证 issuer email 匹配的 active pending 邀请。BFF 不为 POST 建 receipt，也不自动重试；
accept/reject 在 IAM 已提交但响应丢失时，BFF 只能报告未知。重新 GET 返回 404 不能区分 accepted/rejected/canceled/其他终态，
不得伪造本地成功事实或直接创建 Product Session。重复/并发由 IAM 条件写、唯一性与 Serializable 事务处理；BFF 请求取消只停止
继续传输，不能回滚已经在 IAM 提交的写。

目标实现的数据库验证结论是“零 BFF SQL/Redis 路径”，应由 architecture/HTTP 测试和真实组合前后快照证明；不需要也不得为此
修改 schema、运行 migration 或新增数据库集成模型。真实 SMTP/PG/Redis 的业务状态验证归 IAM/Root 组合，BFF 单仓只证明本地拒绝
零 upstream socket、成功/失败均零本仓写入以及未知结果不重试。

## W1C-Team-R5：Team 写投影无本地事实

Member、Invitation、Role、并发条件写、pending 唯一索引、最后 Owner 保护和审计均归 IAM。BFF 六条 Product 写仅在一次请求生命周期内转发已准入 tenant 与 user Bearer，校验 owner wire 并投影结果；不新增 BFF 表、索引、schema、Redis key、缓存、receipt、outbox 或跨 owner SQL。`database/schema.sql` 保持不变。IAM 无 mutation receipt，BFF 不以本地缓存假冒幂等；超时/断线的提交状态是不确定的，客户端需读取 IAM 经 BFF 暴露的当前 Team 事实。

## W1C-FIXED-TENANT-BFF-C 当前身份投影数据边界

当前 BFF `74ec30b` 的可信 `RequestContext` 已由固定租户、在线 IAM admission 建立，但没有公开只含当前 user/tenant 的 Product 投影。目标 `GET /v1/me` 仅在该 admission 成功后读取请求内存中的 `identity.userId` 与 `identity.namespace` 并立即响应；不读取或写入 BFF/IAM PostgreSQL，不创建身份/Session/Team 表、Redis key、cache、receipt/outbox、事务或异步事件。固定 tenant 仍来自部署配置并与 IAM 受信结果比较，浏览器自报 body/header/query 不进入身份。`database/schema.sql`、16 张表、索引、owner schema、retention、fresh install 与既有 tenant+subject 资源 predicate 完全不变；此数据面无 SQL/Redis 命令可验，HTTP 测试需证明没有业务 store/owner 调用。IAM 仍唯一保存 Identity、Tenant、Session 与撤权事实，BFF 每次请求在线验证，不持久化授权快照。

## W1C-FIXED-TENANT-BFF-B relay 数据边界

当前 BFF `dadf9264` 的 browser-private policy `1.1.0` 仍允许 IAM organization list 与任意 set-active JSON 进入原生 IAM；它不改变 BFF 表，但与部署固定租户目标不一致。目标切片只收窄 BFF 传输准入：在任何 IAM socket 前，用部署配置 `KOKORO_TENANT_ID` 与请求的精确 `organizationId` 比对，并要求合法 issuer cookie 与有界 signed OAuth continuation query。BFF 不读取 IAM Session/Tenant/Membership 表、不把浏览器 body 提升为 Product `RequestContext`，IAM 仍负责签名、成员和事务事实。BFF `database/schema.sql`、16 张表、索引、tenant/subject predicate、receipt/outbox、Redis DB 8、retention 与 fresh install 均不变；失败和成功的 relay 都不产生 BFF SQL/Redis 事实。本仓可用 policy/HTTP 零上游 socket 负例验证出站边界；真实 IAM 状态转移须由后续组合验收。

## W1C-FIXED-TENANT-BFF-A：固定部署租户不落库

当前 BFF 所有用户事实仍按 IAM admission 的 tenant 与 subject predicate 存取，但入口原先未把受信 tenant 限定到 `KOKORO_TENANT_ID`。本切片在普通 `/v1` 用户 `RequestContext` 建立前比较受信 IAM tenant 与固定部署配置；缺配置或异租户请求均不进入业务 route、body 处理、receipt、SQL、Redis 或 owner I/O。同租户既有个人私有 predicate、事务、outbox 与 AG-UI ledger 不变。IAM 继续唯一拥有 Tenant/Membership/Session，BFF 不持久化固定租户目录或 Team 事实；`database/schema.sql`、索引、缓存 key、retention 和跨 owner 数据边界均零变化。service-only、Scheduler callback 与 browser-private IAM relay 的已有身份/数据路径不经普通用户闸，本片不赋予其新权限。

## W1C-Team-R2：零 Team 持久化边界（实现中，真实组合待验）

Tenant/Membership/Invitation/Role 的 canonical schema、权限与分页快照仅由 IAM owner `68aa0da259df1f1ea9030936b8d5a46acba8c6ab` 维护。BFF 的三个只读 Product 投影不修改本仓 `database/schema.sql`，不创建 Team 表、Redis cache、receipt、outbox、共享 ORM 或跨 owner SQL。每次请求在线 admission 后由同一 User Bearer 调用 IAM；BFF 只保留请求生命周期内的验证结果和响应投影。IAM 故障、取消、无权、cursor 不合法或响应超限时不写 BFF 数据；验证使用零写入/零跨 owner SQL 的架构测试与真实 HTTP 负例。旧 Team 直连的删除属于 Web 消费切片，不能通过在 BFF 复制 IAM 数据来完成。

## Owner 与 canonical schema

[`../database/schema.sql`](../database/schema.sql) 是本仓唯一 canonical PostgreSQL schema。BFF 不保存 migration 链，
不使用外键，不允许其他仓库直接读取这些表。关系由 tenant + owner scoped Repository/Application predicate、事务锁和 reconciliation
维护。

## W1C-DB-BFF 固定 owner schema（源码已实现；待 Root 验收）

**当前态（`cd1c2600ea2a6e0716b07628822a49653964675a`）：** canonical SQL 未限定 schema；安装器
要求 `public` 无表，runtime PostgreSQL Pool 默认 search_path。下文“空数据库安装”是此旧当前事实，不能作为
单库多 owner 可运行的证据。

**目标态：** 唯一 canonical DDL 仍为 `database/schema.sql`，所有 BFF 表、索引和约束仅安装于固定
`kokoro_bff`；`KOKORO_BFF_POSTGRES_URL` 显式 `schema=kokoro_bff`，代码对 runtime/installer 连接均固定
`search_path=kokoro_bff`。安装前在事务中取得 BFF owner advisory lock、创建不存在的目标 schema，并只检查
本 schema 的 catalog 对象；其非空即拒绝，其他 schema（包括 `public`）已有表不影响 BFF fresh install。
安装结束只校验目标 schema 与最小 BFF 表/索引存在，失败整体回滚。完整列/类型/默认值/约束/索引的 persisted
catalog drift 尚待独立实现；现有 `schema:check` 是静态 canonical 门，不冒称已覆盖该缺口。重复安装不是 no-op，
旧 public URL 不兼容。BFF repository 继续使用未限定表名但 search_path 不含其他 owner schema；
tenant/subject predicate、BFF 本地事务、retention、Redis DB 8 与跨 owner opaque reference 均不变。
测试 fixture 可用独立临时数据库或自有临时 schema 隔离，不表示应用部署需要多个数据库或角色。
本片不新增表、migration、外键、第二份 DDL 或跨 owner SQL。

## 当前表

| 表                                 | Owner fact                                        | 关键键/查询                                                                                                  | 当前备注                                                                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bff_project`                      | Project fact                                      | `project_id`; tenant + owner + slug 唯一；owner list 排序索引                                                | `owner_id` 来自可信 subject；list/detail/slug/mutation 均为 tenant + owner scope                                                                                                                                                                 |
| `bff_project_instruction_revision` | instruction revision                              | tenant + project + updated_at                                                                                | `current` 由应用维护                                                                                                                                                                                                                             |
| `bff_project_skill`                | project skill state                               | tenant + project + skill PK                                                                                  | 布尔 enabled 投影                                                                                                                                                                                                                                |
| `bff_project_task`                 | project task projection                           | task id；tenant + project 排序                                                                               | status 有有限 CHECK                                                                                                                                                                                                                              |
| `bff_scheduled_task`               | ScheduledTask definition                          | task id；tenant + owner 用户查询索引；revision                                                               | 用户 list/find/update/delete/retry 均带 owner predicate；内部 Scheduler callback 按 tenant + task 读取 stored owner，是独立服务语义                                                                                                              |
| `bff_scheduled_task_outbox`        | ScheduledTask → Scheduler command                 | outbox id；`tenant_id + task_id + command_type + idempotency_key` 唯一；ready/task index                     | bounded register/replace/delete queue；保存版本化 payload、lineage、lease/fence、attempt/error/terminal state                                                                                                                                    |
| `bff_idempotency_receipt`          | mutation receipt                                  | scope PK                                                                                                     | pending/terminal status 与 JSON response                                                                                                                                                                                                         |
| `bff_conversation`                 | Conversation 产品事实                             | `conversation_id`；tenant + owner + updated_at 稳定列表排序                                                  | active/deleted tombstone；删除不物理清除，保留至 retention cleanup                                                                                                                                                                               |
| `bff_message`                      | Message 产品事实                                  | `message_id`；tenant + conversation + message_seq 唯一                                                       | role/status CHECK；`run_id` 是 Agent opaque reference，不做跨仓关系约束                                                                                                                                                                          |
| `bff_agent_dispatch_outbox`        | Chat → Agent launch command                       | outbox id；`tenant_id + conversation_id + idempotency_key` 唯一；run id 唯一；ready/lease/conversation index | 与两条 Message、expected-run registration 原子提交；保存版本化 payload、lineage、lease/fence、attempt/error/terminal state                                                                                                                       |
| `bff_share`                        | Share 产品事实                                    | `share_id`；tenant + conversation active partial unique                                                      | revoked/expired rows retained；public lookup 只接受未撤销且未过期记录                                                                                                                                                                            |
| `bff_agui_stream`                  | tenant/session public projection + consumer state | `(tenant_id, session_id)` PK                                                                                 | projection version/source watermark；`expected_run_id` 是最新接纳的 run fence，`latest_run_id` 是最近投影的 source run；latest run start retention boundary；subject、due time、lease token/fence、persistent failure count、blocked/error state |
| `bff_agui_source_event`            | 已摄取 Agent source identity                      | tenant/session/owner/event PK；source sequence 唯一                                                          | 保存 SHA-256 digest；包括零 public frame 的未知 source kind                                                                                                                                                                                      |
| `bff_agui_event`                   | append-only public AG-UI frame                    | tenant/session/public sequence PK；cursor 全局唯一；source frame 唯一                                        | 完整 JSON payload 与 opaque cursor                                                                                                                                                                                                               |
| `bff_agui_cursor_tombstone`        | 已回收 public cursor 的有界诊断事实               | tenant/session/cursor PK；expiry index                                                                       | 在 tombstone 窗口内区分 expired 与未知/foreign cursor                                                                                                                                                                                            |

所有当前 repository 查询都显式携带 tenant id；用户资源还携带可信 owner scope。Project、ScheduledTask 与 Conversation 已关闭
同 tenant 跨 subject 的已知访问缺口。跨 owner reference 是 opaque id，不做跨数据库 JOIN。

## W1C-1 浏览器 IAM relay 数据边界（工作树已实现；待 Root 验收）

起始 BFF `6238599667110fbfbc2d5ef3a9d53731f2623cfe` 尚无 `/iam` relay；当前待验工作树只是在 Web 服务身份
校验后传输 IAM 原生协议，不拥有用户、OAuth client、授权码、access/refresh token、issuer Session、consent、
Product Session 或 tenant membership 事实。IAM `6bc9b190c359b8109238626ff689ce9839e858b5` 拥有前六类与
tenant membership；Web 独自拥有 Auth.js Product Session 与其 Redis 协调状态。BFF 继续只拥有本页当前表列出的
Product/AG-UI/Outbox 事实，普通 `/v1` 的 `tenant_id + user_id` 仍来自 IAM 0.2.0 在线 admission。

W1C-1 不修改 `database/schema.sql`、任何 BFF Repository、Redis namespace、receipt/outbox 表、索引或事务。
由 BFF TS 准入策略派生的只读 `contract/iam-relay-policy.json` 是版本化传输 policy artifact，不是持久化模型、
SQL schema 或 IAM session/token 副本；Web 固定消费其 BFF commit/blob digest 不会获得 BFF 数据库读写权。
relay 不为登录、refresh、logout 建 BFF idempotency receipt/cache/session/token 表；不以 `get-session` 响应或浏览器 cookie
创建 BFF `RequestContext`，也不从 query/body/header 自报 tenant/actor。准入拒绝、IAM 错误、timeout、断连与非法
`Location`/`Set-Cookie` 均不写 BFF SQL/Redis、不领取 BFF lease、不创建 Product fact。IAM mutation 成败由 IAM
自身事务/审计负责；跨 IAM/Web Product Session 的 revoke/logout 不是 BFF 分布式事务，BFF 不伪造原子性承诺。

验证用 BFF 数据库表计数/Redis namespace 快照和 owned-process/socket 断言证明上述零写入；真 IAM 登录可改变 IAM 自己
的 fixture Session/consent/token 数据，测试清理只清理本次创建的 IAM fixture，不清空共享资源。API/path/错误策略详见
[API_CONTRACT](API_CONTRACT.md#w1c-1-browser-private-iam-relay-目标尚未实现)；运行时放置与请求生命周期详见
[TECHNICAL_DESIGN](TECHNICAL_DESIGN.md#w1c-1-设计门web-同源-iam-协议-relay目标尚未实现)。

### R2e-IAM-VERIFY-RELAY 数据边界（本仓已实现，待 Root 验收）

IAM `093b76513a9aa71611c65d4f210e279d3227e002` 已发布 `GET /verify-email`，并独占 Better Auth 1.7.3
有期签名 JWT 的签发/校验、用户邮箱已验证幂等事实与审计。起始 BFF `eb1eb2926d08b8a3779898b2c31e604a8585ec8b`
尚未准入 `/iam/verify-email`；本次只把该 GET 加入既有 browser-private relay policy。BFF 不持有 token、
不建立身份或 Product Session，不查询/写入 IAM 数据库，不把 IAM 验证结果投影为本地表或 Redis key。
`callbackURL` raw query 不是 BFF 的业务字段或出站路由，真实 302 `Location` 只按现有受限 Web/issuer 目标校验；
原始 query、token、原生响应 body/Location 均不写日志、receipt、outbox、缓存或业务事实。

本切片对 `database/schema.sql`、所有 BFF 表/索引、事务、Redis namespace、retention/GC 和 fresh install **零变更**。
仅重钉 IAM test-fixture 来源后的 browser-private artifact SHA-256 为
`731735ba8ce07c578fe04fa51783a95c7ac7daf50df33cea0ef9cefedc32d032`；无新增持久化事实。
准入拒绝、IAM 成功/失败/过期/重复验证、302、超时/取消和恶意 `Location` 均零 BFF SQL/Redis 写入；
IAM 对邮箱已验证事实的幂等更新与审计是 IAM 自己的事务，不能误称为 BFF 的零副作用或跨服务原子事务。
正式首个账号/固定 tenant 的受控 bootstrap 与 Product Session/OIDC client 开通各有 owner，邮件验证只是一环，
不因 relay 增加而推定开通完成。本仓无 SQL/Redis 代码路径；跨仓验收的零写入证据仍应比较 BFF 表与
Redis namespace 前后快照，并由真实 IAM HTTP 证明 JWT 有期及邮箱状态幂等语义；本片不修改 canonical schema。

## W1B 数据边界

### Task 1 本变更：IAM admission 不落库

IAM Session、Membership、Tenant、client 与 bearer credential 都是 IAM owner fact。Task 1 不修改 `database/schema.sql`，
不新增 IAM/session/token/cache/receipt 表，不把 generated wire response 或 Bearer 保存到 PostgreSQL/Redis。每次普通用户请求在线
admit 后只在请求生命周期中保留 `{namespace: tenant_id, userId: user_id}`；取消、拒绝与 IAM 不可用都不得产生业务 row、receipt、
outbox 或 cache entry。Share、runtime manifest 与 Scheduler callback 的独立服务身份同样不写成伪用户事实。

### Task 2 当前实现：Project 与 ScheduledTask 个人 scope

Task 2 只对 fresh-install canonical schema 做 clean-slate 修改，不建立 migration、default owner 或旧数据回填：

| 对象                 | 当前 schema / query                                                                                                                                       | 保护的不变量                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `bff_project`        | 新增 `owner_id TEXT NOT NULL`；唯一索引改为 `(tenant_id, owner_id, slug)`；真实 list 排序索引覆盖 `(tenant_id, owner_id, created_at ASC, project_id ASC)` | owner 来自可信 subject，body 不可指定；同 tenant 不同 owner 可复用 slug，且 list/detail/slug/mutation 不互见                 |
| Project child facts  | revision/skill/task 不机械复制 owner 列                                                                                                                   | 每次 read/write 先以 `(tenant_id, owner_id, project_id/id-or-slug)` 锁定或验证父 Project；同一事务维护无 FK 关系完整性       |
| `bff_scheduled_task` | 复用现有 `owner_id`；用户索引/查询 scope 为 `(tenant_id, owner_id, ...)`                                                                                  | list/detail/update/delete/retry 只能命中 owner；create 引用 Project 时在 task + outbox 事务中验证并锁定同 scope Project      |
| Chat `project_ref`   | 不新增 owner 副本                                                                                                                                         | 非空 reference 在 Conversation create/message/control/read 路径上解析为同 tenant/owner Project；外部字符串本身不是 authority |

Project Redis list cache `kokoro:bff:projects:${tenant}` 及其 invalidate 分支已删除，不迁移为 owner cache，也不双读旧 key；
PostgreSQL 是唯一 Project truth。Redis 的 readiness、AG-UI publish 与其他既有职责不变。

ScheduledTask 用户 create 的稳定 `task_id` 以无歧义 JSON 数组包含 `tenant + trusted subject + canonical path + Idempotency-Key`；
同 key replay 和 outbox lookup 不得跨 owner 命中。`bff_scheduled_task_outbox.actor_id` 继续保存首次可信 actor lineage，payload owner
必须和 task row 一致。Scheduler callback 所需 `findRecord(tenant, task)` 是明确的内部查询：它只从已存 row 恢复 owner，不能作为
用户 repository API。它与 `scheduler-dispatch:v1` 的 tenant + opaque key receipt scope、occurrence digest 和 snapshot/CAS 不混用。

Conversation/Message/Share 使用既有 owner facts，本片未新增 ACL 表。Task 2 已在通用 mutation receipt replay 和 Agent I/O 之前做
Conversation owner gate，因此其他用户的 cancel/resume/steer 不会命中旧 receipt 或创建 owner call。Share row 只授权其现有只读
Conversation projection；撤销、过期或 tombstone 后拒绝，且不授权 Run control、event stream、Project 或未分享文件。

### AG-UI 不变量

#### Chat snapshot active Run 读模型（running 首片目标）

不新增表、列或索引。现有 `bff_agui_stream.expected_run_id` 是最新准入 run fence，`latest_run_id` 是最近收到 `RUN_STARTED` 或 expected terminal 的 run marker，`terminal_run_id` 只记录 expected run 的终态。Chat repository 在 owner-scoped Conversation/Project predicate 成功后，于读取 Message、Delivery 和 ledger cursor 的同一 `REPEATABLE READ READ ONLY` 事务内按 `(tenant_id,session_id)` 读取三字段。

三个实际 writer 决定可达矩阵，而不是读侧理想状态机：consumer registration 换 expected 会清 terminal 但保留 latest；projection 的任意 `RUN_STARTED` 都覆盖 latest，仅 current expected start 才清 terminal；current expected terminal与permanent dispatch failure同时写 latest/terminal=expected。因此 `E=X,L=O,T=null` 可表示新 run 尚未开始或晚到旧 start，`E=X,L=O,T=X` 可由终态后晚到旧 start产生，二者都合法。`E=null` 是 seed/历史未准入 stream，合法持有 null、started 或 terminal marker。

首片映射为：E为空全部省略；E非空且T=E全部省略，不看L；T为空且L=E输出running；T为空且L为null/其他值省略。所有非 null marker 必须是非空白string；E非空时T非空却不等于E是当前writer不可达冲突，抛固定 `CHAT_ACTIVE_RUN_STATE_INVALID` 并回滚/失败，不伪装running或503合法历史。读取不加锁、不写projection、不延长retention；GC不删除stream fence。tenant、subject、Project和soft-delete权限仍由先行Chat owner predicate决定。

该首片不持久queued/waiting/pending facts，也不修复旧 `RUN_STARTED` 覆写latest；后继若要稳定输出queued/waiting，须定义current expected lifecycle、等待/恢复/终态清除与pending metadata，并重新通过DATA/SQL/API门。`pending_pauses`和`files`空数组不代表能力完成。

当前 repository 已在既有只读 RR 事务与 ACL 之后读取三 marker，不增加 schema、索引或写路径；非法 row 的纯 connection 测试已证明 rollback/release。Root 隔离 PostgreSQL 已完成 canonical fresh install、定向8/8与完整owner integration47/47、0失败/0跳过，包含RR barrier、GC fence、正常ChatTurn binding、late START、权限拒绝与永久dispatch失败。临时数据库/Redis新资源均回收；日志 `/tmp/kokoro-bff-active-run-real-pg-final-green.log`。此证据不覆盖浏览器或queued/waiting/pending后继。

W1D-Chat-B2 目标态不增加表、列或跨 owner SQL。`bff_agent_dispatch_outbox` 持有
`(tenant_id, conversation_id, run_id, subject_id, assistant_message_id)` 的本地绑定，
`bff_agui_stream.expected_run_id` 持有当前 run fence；在同一 stream row lock/version/lease
事务内才可把已验证 Agent source 的 delta、completed、failed/cancel 意图写回对应
`bff_message`。只按 source 自报 `chat_message_id`、`segment_id` 或 `run_id` 不授予更新权。
update 必须同时匹配 BFF Message 的 tenant、conversation、assistant ID、run、role、可变状态，
以及 active Conversation owner；旧 run 和永久投递失败 row 不覆写。source identity/frames、
assistant body/status、projection state/high-watermark 同提交；重复 source 不重复追加 delta。
当前 run 的 active Conversation 若 UPDATE 影响 0 行，必须检查 outbox、subject、assistant ID 与
Message row；缺损则回滚整个 source commit，不允许只推进 ledger。deleted Conversation、failed
outbox、已终态 Message，以及无产品 Conversation 的历史 AG-UI scope 可合法跳过。
Message 仍是一 run 一条业务 row，多段 assistant 以最后一段正文为快照，工具和未知 source
不写 Message；仅对 Agent 实际发布的 source 保证，Agent owner main
`520ec181a101298b4f336aad273ce003b2735955` 已发布空 completed source。
Snapshot 以倒序截取最新 100 条 Message，再稳定升序呈现；读取以单连接
只读 repeatable-read 同时观察 Conversation、Message、
AG-UI cursor，不接受已更新正文与旧 watermark 的混合视图。

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

1. `bff_scheduled_task` 的 `tenant_id` 是每个 public read/write 的必需范围；当前普通用户路径还带
   `owner_id = trusted subject`，只有显式 Scheduler callback 内部查询可以按 tenant + task 恢复已存 owner。`time` 是本地
   wall-clock rule，`timezone` 必须是 IANA 名称，`next_run_at`/`expires_at` 是 UTC instant，数据库精度固定为
   `TIMESTAMPTZ(3)`。
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

Project side effect、mutation receipt claim 与 aggregate/outbox 的统一事务、outbox retention 和后台业务
reconciliation 尚未完成；这些不属于本切片。ScheduledTask → Scheduler、Chat → Agent bounded outbox 与 AG-UI source
consumer/GC 已是当前 schema 事实。

当前没有独立 Chat assistant reconciliation worker、durable command receipt resource、version/ETag 或 delivery
projection 表。Conversation、Message、Share 已由 BFF PostgreSQL 拥有；Agent HTTP ingress 负责 launch/control，独立
projector 的窄 source reader 只读取 execution events，不直接充当 Chat 产品事实读取源。

### Chat 产品事实不变量

W1D-Chat-B1 目标态在现有 canonical 表上实现隐式首次创建，不新增 schema。仅首发 POST 且
`conversation_id` 为合法 `conv_<UUID>` 时，`bff_conversation` 的缺失主键可在 Chat turn 本地事务
插入，`tenant_id`/`owner_id` 来自可信 admission，`project_ref` 必须在同事务先由本仓 Project 的
tenant + owner 行验证。标题由首条消息内容确定性截取至最多 24 个 Unicode code point
（截断加省略号）；空内容在入口拒绝。全局主键冲突时 `ON CONFLICT DO NOTHING`，随后
tenant + owner + active 条件锁定；foreign/deleted row 不覆盖、不复活，也不插入消息或 outbox。
新 Conversation、user/pending assistant Message、Agent outbox、AG-UI expected-run registration
在同一 PG 事务提交或回滚；同 ID 并发等待主键并在行锁内执行原有 digest/key 去重。

1. 所有 Conversation/Message/Share repository 查询都带 `tenant_id`；用户 Conversation/Message 还带 `owner_id`。跨 tenant
   或跨 owner 的 id/cursor 不返回有效事实。起始 `c5e9b3c` 的 `project_ref` 只被当作 Conversation filter；当前非空值必须先
   通过同 tenant/owner Project predicate，不能仅凭字符串匹配获得关联访问。
2. Chat admission 与 Conversation lock 在同一事务中执行，锁顺序固定为 Conversation → idempotency lookup → message
   sequence allocation → user/assistant Message insert → Agent outbox insert → expected-run registration → Conversation
   updated_at；没有数据库级跨仓关系约束。
3. Conversation delete 先更新 active row 为 deleted tombstone，再在同一事务撤销 active shares；Message rows 保留用于
   retention/audit cleanup，公开列表与详情只看 active conversation。
4. Share 的 partial unique index 只限制 `revoked_at IS NULL`。创建 share 时在持有 Conversation lock 的事务中先将已过期且
   未撤销的 share 标记 revoked，再创建 replacement，因此过期 share 不会阻塞新 share；retention job 后续清理历史 rows。
5. Conversation 与 Message 列表使用 `(updated_at, id)` / `(created_at, message_seq, message_id)` 稳定排序，cursor 是带前缀的
   base64url opaque token；时间在 application/domain 使用 UTC `Date`，数据库使用 `TIMESTAMPTZ(3)`。
6. Agent outbox 只在 `pending`、到期 `retryable` 或 lease 已过期时 claim；同一 conversation 按创建顺序投递。
   settlement 必须匹配 tenant、owner、token、fence 和未过期 lease；永久失败会原子标记对应 assistant Message failed。

## 时间、约束与命名

所有数据库瞬时点统一使用 `TIMESTAMPTZ(3)` + `CURRENT_TIMESTAMP(3)`，API 为 RFC 3339 UTC。AG-UI 与 ScheduledTask/outbox
表使用毫秒精度和 `pk_`/`uq_`/`ck_` constraint 名；部分既有 index/CHECK 尚未按 Root 规范命名。这是剩余 schema 治理
缺口，不把时间精度合规扩大为其它命名重构。

`NULL` 当前用于可选 instruction/project/expiry 等语义。Event/ledger 一旦落地应 append-only，不机械添加
`updated_at`；同一毫秒顺序使用 public sequence 作为第二排序键。

## Redis

BFF 本地逻辑库固定为 Redis DB 8。当前代码执行 readiness `PING` 与 AG-UI projection
更新 `PUBLISH`。AG-UI 不写 Redis key/stream；publish 是可丢失提示，失败不回滚 PostgreSQL。Redis 不保存 canonical
Project/ScheduledTask/receipt/outbox，也不是公开 AG-UI replay 事实源；丢失后 Scheduler/Agent dispatcher 从 PostgreSQL
继续 claim，AG-UI replay 仍从 PostgreSQL 恢复。

## 安装与 drift

安装器只在空 `kokoro_bff` owner schema 安装当前 canonical SQL；同库其他 schema 可已有对象：

```bash
KOKORO_BFF_POSTGRES_URL='POSTGRES_URL?schema=kokoro_bff' pnpm db:apply-schema
```

`CREATE TABLE IF NOT EXISTS` 属于 canonical SQL，但安装器在 owner schema 非空时先拒绝重复安装，不能用它修复 drift。
发布验收仍需要 schema naming /
无外键/UTC 检查和真实 repository integration；生产升级策略在 V1 clean-slate 阶段尚未定义为历史 migration 链。

## Retention 状态与缺口

AG-UI frame retention、最新 run boundary 保护、retention floor 与 cursor tombstone 已由后台 GC 实现，并有真实
PostgreSQL integration 覆盖。source identity rows 当前作为投影审计事实长期保留，不与 frame 同步删除。仍未声明 receipt TTL/归档、
Project 删除清理、ScheduledTask tombstone、ScheduledTask outbox 归档和 source identity 的最终保留周期；这些策略必须先
进入 contract/SLO/runbook 与恢复测试，不能用临时 SQL 直接清表。

## System projection data boundary

System runtime manifest 和 model catalog 均为只读 owner projection，不写入 BFF PostgreSQL，也不新增
表、缓存事实或 schema。BFF 只在请求生命周期内验证并转换 System wire data；System 仍是这些事实的唯一 writer。

## Storage projection data boundary

BFF 当前不保存 Library、Asset 或 Artifact 表，也不保存 Storage cursor、缓存、receipt 或 outbox；Storage 仍是对象与
文件生命周期事实的唯一 writer。当前 `GET /v1/library` 的 503 degraded response 不访问 PostgreSQL、Redis、Object
Store 或 Storage network endpoint，不形成可恢复的业务事实。

本切片不修改 `database/schema.sql`，不新增 migration、索引、Redis namespace 或跨 owner foreign key。未来 W2 若需
durable BFF projection，必须先重新通过 owner、API、事务、retention 与 canonical schema 设计门。

## Platform projection data boundary（当前实现）

Platform 独占 Skill/MCP 事实、owner 查询和 cursor；BFF 的五个 public GET 只作当前 IAM 用户的短暂投影，不新增表、缓存、receipt、Redis key、跨 owner JOIN 或 SQL。旧 Capability HTTP 客户端删除不影响 canonical schema。

## Scheduler receiver receipt design

**W0B-9 已实现专用 repository 与下述 CAS。** 无 schema 变更：复用现有
`bff_idempotency_receipt(scope TEXT PRIMARY KEY, fingerprint TEXT, status INTEGER, response_body JSONB, created_at TIMESTAMPTZ(3))`。
本切片不改 canonical schema，SHA-256 仍为 `8dcb1b3194ed4d4c50c42cdb9a199fec5e253793dd3ca062e92094ab68436da1`。
不新增 Schedule/Occurrence/Agent Run 表、不跨 owner SQL、不把 Redis 变成 receipt 真相源。

当前通用 `claimReceipt` 在 pending 60 秒后允许不同 fingerprint 覆盖原值；通用 `commitReceipt` 遇 5xx 或落盘失败会
release/delete pending。scope 还包含 actor。因此直接复用通用 mutation 流程不能满足本 receiver 的永久 digest 绑定与恢复。
选择专用 Scheduler receipt port/repository，保留其他 public mutation 行为；通过 BffBusinessStore 暴露 `schedulerDispatchReceipts`，
在 `src/infrastructure/postgres/repositories.ts` 复用同一个 pool 装配，不另建数据库连接或后台进程。

### 存储与状态机

- scope 是 API_CONTRACT 定义的三元 JSON tuple；tenant 在每个操作的 scope 中强制提供，不能由 body actor 拼出新 scope。
  scope PK 提供同 key 并发唯一性；fingerprint 保存完整 semantic SHA-256，接纳后永不改写。
  opaque key 以 JSON 字符串无损保存；canonical nano occurrence 保存在 JSONB snapshot 字符串，不放入毫秒 timestamp 列。
- status=102 仅作内部未终态标记。response_body 是版本化本地存储 envelope，不是 owner wire schema：
  `schema_version=1`、`state=pending|retryable|terminal`、`claim_token`、`lease_until`、`retry_at`、`snapshot`、
  `last_error_code` 与 terminal `response`。snapshot 在 admission 前可为空；首次通过存储任务鉴权后、任何 Agent I/O 前，
  原子保存 trusted tenant/schedule/occurrence/opaque key、actor、完整 Agent launch 参数和确定性 Run/message/assertion IDs。
  snapshot 一经保存不可改写。终态 status 为实际 HTTP status，response 只保存可重放 status/body，不把内部 token/snapshot 返回 caller。
- 首次 claim 插入固定 digest；冲突先读并比较 digest，不因 age/state 改变规则。匹配且 terminal 则 replay；活跃 pending 返回 425。
  retryable 到期或 pending lease 过期时，只在同 digest 上原子更新随机 `claim_token` 与 lease，保留 snapshot 和所有身份。
  lease 固定 60 秒；row lock 获取后以 `clock_timestamp()` 计算新 lease/判断 deadline，禁止使用事务开始时冻结的
  `CURRENT_TIMESTAMP` 发出已过期 claim。claim/prepare 返回数据库当时的剩余毫秒，单次 Agent I/O 从该预算扣除 monotonic elapsed
  与固定 settlement reserve；worker 不延长旧 token，普通全局 upstream timeout 不能越过专用预算。
- prepare snapshot、finalize、release-to-retryable 均匹配 scope + fingerprint + claim_token + 未终态 + 未过期 lease；检查受影响行数。
  旧 worker 零行更新即失去 claim，不返回自认成功，不覆盖新 token。release 只清 lease/设 retryable 与 retry_at，不删除 receipt。
  普通瞬时失败设有限退避；进程在 release 前崩溃仍可在 lease 到期后 reclaim。created_at 保留首次接纳时刻，lease 使用 JSONB 内的
  UTC 毫秒字段，由 SQL 参数化表达式/数据库时间计算；不依赖 created_at 重置模拟 fencing。
- 单次本地事务只覆盖 claim 或 snapshot/settlement；远端 Agent 调用不持数据库锁，不承诺 BFF/Agent 原子提交。
  首次 snapshot 验证必须保留 tenant/task/owner 检查；同一 snapshot 的恢复重发原 launch（包括原 Agent request ID），
  不能随当前 task revision、actor 或 request ID 改写已经可能接纳的 Run。prepare/CAS 失败时禁止开始 Agent I/O。
  snapshot 只保存该命令必需信息，不保存 bearer token；日志不输出 payload、凭据或整份 snapshot。
- Agent 成功但 BFF finalize 失败时保留原 key/digest/snapshot，BFF 重启后以相同 Run identity 重试。端到端 Run 事实唯一依赖
  Agent durable admission；真实 Agent 的保证待 Agent-owner closure（W4）验证，本波只验证 BFF receipt 与稳定输出。
  暂时依赖失败返回可重试状态；明确业务失败写 terminal response。活跃 pending、retryable、terminal 均拒绝不同 digest。
  非 JSONB envelope 版本、损坏 snapshot 或冲突 Agent receipt 均 fail closed 并记录，不静默清空重建。

### 查询、保留与验证边界

只有按完整 scope PK 的 claim/replay/CAS 查询，不做全表扫描，因此不新增索引。既有 schema 的 JSONB/status 容纳专用存储 envelope，
不改变表 owner/列类型/约束/fresh install；该存储格式由专用 repository 验证。scope 的协议 namespace 与通用 public mutation
五元 scope 不相交，通用 release 不触及本 receiver 的行。无物理删除、软删或 TTL：在另行批准 retention/replay 上限与恢复策略前，
Scheduler receipt 持续保留，不用 cache TTL 或 Scheduler 重试预算到期清除 digest。失败/重试状态亦保留供同身份恢复和审计。

W0B-9 已增加真实 PostgreSQL repository 测试：并发同 key、不同 digest、过期 reclaim、短 row-lock 等待后新 lease 的剩余期限，
等待中到期的 prepare/finalize/release 拒绝、stale token、retryable、tenant 隔离及稳定 snapshot。另有真实 PostgreSQL + BFF HTTP
以及 Agent stub 测试：Agent 接纳后 finalize 失败，关闭/重建 BFF 后在数据库 task 与 transport request ID 已变化时，同 key 仍重发
首次完整 snapshot 与同一 Run identity；并通过真实 stale prepare CAS 证明零 Agent I/O。这里的 stub 只证明 BFF HTTP/PG 恢复，
不证明真实 Agent durable admission 或唯一 Run 事实。
W0B-10 使用真实 Scheduler + BFF 进程及 Agent receipt stub：响应丢失后，仅 BFF 重启恢复并接收保持运行的 Scheduler 重试；
不重启 Scheduler。分别记录 HTTP attempts、
稳定 Run ID 与 stub receipt 数量，不把 stub 计数写成真实 Agent Run facts。真实 Agent admission、同 Run 参数冲突、Agent 重启后
唯一 Run 事实归 Agent-owner closure（W4），`EDGE-BFF-AGENT` 保持 broken，不增加到本波验收范围。
不能将 memory double、文档正则检查或 build 成功称作真实 PostgreSQL 或 Agent 的持久恢复证据。
本实现切片使用任务独占 PostgreSQL 完成 fresh install、非空拒绝与真实 receipt integration；Redis 仅复用 DB 8 且不作为 receipt 真相源。

## W1E Product Skill mutation 数据边界（目标，未实现）

### 首个 user CreateSkillDraft 数据切口

首个正向链只实现 user owner 的 `CreateSkillDraft`，不等待 organization/project/session，也不接 Storage。BFF 从每次 IAM
session admission 的受信 `tenant_id`、`subject_id` 派生
`owner_scope={kind:"user",id:subject_id}`，并构造 owner 完全相同的 `ProductCatalogContext`；public body 只有 Skill metadata，
不接收或保存 tenant、subject、owner scope、Product context、Proto command 或 `metadata_json`。首片的
`metadata_json` 是 BFF 固定产生的 UTF-8 `{}`，不是浏览器事实。

此切口对 BFF canonical schema 的差异必须为零：不新增 Skill、revision、command、receipt、outbox、owner、授权、token、package、
asset 表或索引，不写 Redis，也不把 `bff_project_skill` 升级为 catalog。BFF 派生的 `command_id` 与 v3 `request_digest` 只随当次
Connect request 发送；Skill、revision 与 command receipt 只由 Platform 在其 owner schema 和事务中持久化。catalog credential
文件以及按 tenant/generation 缓存的短期 machine token 是进程配置/内存，不是业务数据；token/secret 不持久化、不进入日志或错误。

`src/bootstrap/server.ts` 当前在业务 route 前运行的 generic `mutationTicket`（包括 PostgreSQL
`bff_idempotency_receipt` 与进程内 Map）必须对这个精确 operation 跳过，route 收到的 mutation context 恒为 null。首次请求和
completed replay 都先重新执行当前 IAM user admission 与 `owner.id===subject`，再调用 Platform；BFF 不允许从自己的旧 receipt
直接返回历史 201。Platform 是唯一 durable receipt owner，负责同 command/digest replay 与同 command/不同 digest 冲突。
Platform 响应丢失或 BFF 崩溃后，客户端用同 key 重试，BFF 在重新 admission 后向 Platform 发送同 command；没有 BFF
enqueue、跨库事务、补偿表或 202 接纳语义。

实现门必须以 schema diff/`pnpm schema:check` 证明 BFF 零数据变更，并以测试证明 CreateDraft 路径对 generic Map/PG receipt、
Project/Conversation store、organization action check 与 Storage client 均为零调用；撤销用户 session 后同 key replay 必须在
Platform socket 前拒绝。Platform consumer 目标固定 owner `5b6eb2c1532b23b9747bc4bf6ac99f69ad453de0` 和 execution v3 aggregate
SHA-256 `324e749da1bc66c1ff03de74e7299716f798f5f5bb5fa19556033b79fa09ff8d`（已在 BFF pin；inactive/routable=false，尚未激活），不得以旧 Capability HTTP 或 v1/v2 digest
建立第二套幂等事实。

本片仅文档，不改 `database/schema.sql`、索引、事务代码或安装器。目标六 catalog mutation 不引入 BFF Skill/revision/install、
IAM role/permission、Storage package 表，不复制 Platform receipt 或缓存 allow；Platform 是 catalog 状态与 command receipt 的唯一 writer。
BFF 现有 `bff_project_skill` 是 Project 产品关联事实，不升级为 Skill catalog、安装或组织授权事实源。

四 scope：user 比较受信 subject；organization 在线 IAM 0.7 action check；project 查询本仓 tenant + owner 的当前 Project；
session 查询本仓 tenant + owner + active Conversation，关联 Project 时再次检查其范围。
`bff_project` 没有 status/deleted 字段，Project 授权依据是当前真实存在且满足 tenant + owner 的项目行，不假定 active 状态。显式 share 只按其既有权限使用，
不能借 read share 获得 mutation；当前未实现的通用 Skill share grant 不在本片新增空表。无跨 owner SQL/JOIN/外键。

已有 Skill/installation 的真实 owner 由 Platform contract 查询与执行时校验；BFF 不以 body owner_scope 建立新事实。
这些授权查询复用现有主键/tenant/owner predicate，不新增索引；本地读取事务结束后才发远端请求，不持本地行锁等待 IAM/Platform。
不声称 BFF Project/Conversation 删除与 Platform mutation 是跨仓原子事务。远端 Product 上下文及撤权竞态的时点必须由 owner 契约收敛。

幂等事实只留 Platform：BFF 为同 public key 派生稳定 command 身份与 semantic digest，绕开通用 BFF Skill mutation receipt
（含进程内 Map），每次重试/结果 replay 都重新检查当前权限。Platform 同 command 恢复响应丢失；BFF 无 durable enqueue，
不得返回代表后台任务已接纳的 202。Platform receipt retention、资源删除后 replay、冲突规则以 owner 机器契约为准，
BFF 不另建 TTL/GC，也不擅删 owner rows。若后续确需异步交付或 Skill 分享新事实，另过本仓 schema/事务/retention 设计门。

验证：`pnpm schema:check` 与 schema diff 证明本片未改 schema；真正 Project/Conversation predicate 集成测试仍需
`KOKORO_TEST_POSTGRES_URL=... KOKORO_TEST_REDIS_URL=... pnpm test:integration` 的隔离 fixture，
Platform durable receipt/撤权恢复由 Root 真实 IAM/BFF/Platform smoke 验证，BFF unit double 不代替该证据。

## W2 项目资源上传的数据边界

不新增/修改canonical schema、Asset表或Project文件关联表；Storage唯一写Upload/Asset/Blob/Scan。BFF复用现有`bff_idempotency_receipt`保存规范化请求的最终响应，并为同tenant/subject/canonical project/public key保存create-stage checkpoint（稳定upload_id与同一指纹）。checkpoint先持久化并读回，才允许PUT/Complete，避免Storage成功后BFF崩溃导致重试新建资产。URL、headers、secret、原始bytes不进入receipt；文件hash/size及最终资产表示仅为请求/响应快照，不成为Storage事实副本。

checkpoint 是独立 scope 的 terminal status=200（外层是 canonical route scope），不是 pending body。现有 claim 只 reclaim status=102、release 只删除 status=102，故外层 5xx 与 60 秒 reclaim 均不清除 checkpoint。checkpoint与现有receipt使用相同保留边界，不引入新后台worker/Redis缓存。未知Complete结果先通过已保存upload_id在原scope查询；completed asset关系由Storage验证，BFF核对返回metadata。错误时释放外层pending claim，稳定checkpoint保留；已知pending失败尝试Abort，不撤销已完成Asset。无跨库事务，不承诺请求失败自动删除已完成对象。真实数据库恢复验证由Root串行执行。

W2 scan 错误不回滚 Storage 完成事实：感染 422 以既有外层 receipt 固化，待扫描/unknown 503 释放外层 pending 但保留 terminal upload checkpoint，因此同 key 重查同一 Asset，不新建资产。

W2 资源列表当前实现不新增 BFF 表、索引、物化快照、缓存或 migration。Project 所有权仍来自本仓 canonical `bff_project` 的 tenant+owner 查询；Asset、purpose、scan、created_at 与排序 cursor 只来自 Storage owner。GET 不使用上传 receipt 重建列表，也不把 POST 的 upload_id 当作资产列。Storage 的 scope 索引与分页查询由其 canonical schema 验证；BFF `pnpm schema:check` 必须证明本仓数据模型零变化。跨仓读取无事务或双写，Storage 不可用时显式依赖失败而非返回空列表。
