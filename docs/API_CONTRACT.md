## R62 / R59 实施候选（未发布）

当前 canonical 已为 public4.0.0 工作树候选：execution_head 是唯一当前 Run/pause 公开字段，resume 必须完整集合与 revision/ref，ACK 不消费 pause；Agent HTTP4 固定 e977923ea9992cbddaf0cdbc6c8f8d23b3af120e 并完成正规生成。control receipt 仅对齐固定 owner 的 typed-null/Unicode/数字表示，不改变外层 fingerprint 或 state digest。 基线 main / 759bfe0a8c521946cae31a74b6426f43b063bae1；本轮八项离线门均 exit 0；资源门未运行，精确数量与格式证明记录在 docs/CURRENT.md 的 R62 前缀。以下 R48 设计及原 body 逐字节保留，阶段句以本前缀为准。

---

## R48-BFF-D0：public4 完整 execution_head 与 Agent4 resume 契约（当前目标，未发布）

本前缀与 TECHNICAL_DESIGN.md / DATA_MODEL.md 的 R48 方案是唯一当前设计；下方原 body 保留历史，包括“Agent 未发布”描述，不据其继续猜 owner 字段。本轮只写文档，canonical public3、Agent3 vendor/pin/generated、source/tests/SQL 未改。

### 已发布依赖与发布顺序

Agent e977923ea9992cbddaf0cdbc6c8f8d23b3af120e 的 contract/openapi/v1/openapi.json 已发布 HTTP4.0.0，SHA-256 763ff7a9cf668eb59ae7cfb59b2fd4f84fafde124063d9a365f138b6a30cf04f；provenance SHA-256 e2e6cd9f2228900d0c0a8d795f19815a145bd8f0d18c785ffbe059214b5ed99a。BFF 后继固定该完整 commit/version/digest、重建 generated control/launch/session-events，并删除 Agent3 与单独 delivery event 的旧 split pin；不在 BFF contract 另建可编辑 Agent schema 副本。owner 的 ChatInteractionState/InteractionGroup/InteractionItem/ResumeDecision 是输入机器事实，不直接共享 Agent DB 或私有模型。

Root 已裁决 public4.0.0 为首次上线前原 /v1 corrective breaking artifact：snapshot 删除 active_run 及顶层旧 pending_pauses，以 execution_head 唯一表达当前执行；不建 /v2、双字段、旧3 fallback。Message/session/receipt/权限/可信身份/分页/AG-UI envelope 与既有 opaque cursor 路径不变。BFF 三面和完整测试同片通过、Root 发布不可变 artifact 后，Web 才 repin commit/version/digest 并删除旧消费者/fresh 激活。HTTP4 未发布 retry_of_run_id，future retry4.1 不在本 cut。

### Snapshot 公开形状与一致性

GET /v1/sessions/{id} 的现 response 内，execution_head 为可缺失的 closed object，required run_id、state、pending_pauses，额外字段拒绝；无 FIFO nonterminal head 时缺失，不用 null/空 run 猜测。state 精确 queued|active|waiting|resuming；active 对应 UI streaming，不新增 streaming wire alias。

| state | pending_pauses | 事实依据 |
|---|---|---|
| queued | 空数组 | matching RUN_STARTED 尚未投影，pending/leased/retryable/admitted 差异私有，不是从 parser 失败推断空 |
| active | 空数组 | matching started 且从未出现有效 interaction 的连续源初始态；有 revision 后必须是 owner phase active/terminal 的明确空集合；terminal interaction 不是 Run terminal |
| waiting | 恰一条完整 PendingPause | 该 Run 当前 owner phase waiting，含全部 groups/items；新 pause/re-pause/validation_failed 均整体替换 |
| resuming | 恰一条完整 PendingPause | 同 pause 的完整 groups 保留，owner durable source phase resuming，action_result accepted/unknown 且 action.pause_revision 精确当前 revision；阻止新 key 重复 decide |

PendingPause 不是逐 item 的独立 lifecycle；它投影当前一个 owner pause 的六字段 interaction_revision、pause_revision、pause_ref、phase、groups、action_result，phase 此处限 waiting|resuming、pause_revision 为正整数、pause_ref 非空。groups/items 保留 owner 原顺序与全部 group_id/item_id/request_id、kind、allowed_decisions、display、可选 validation；group/item 全局唯一。action_result 保留 command_id/pause_revision/kind，waiting 可含上一轮 native_consumed/validation_failed/cancelled 等 owner 允许结果，不能因非空结果把新的 waiting 误判 submitted。具体 schema 由 BFF canonical OpenAPI 的 PendingPause/ResumeDecision 定义公开投影，并对固定 owner 机器图做 contract assertions；手写 type 不当第二可编辑 schema。

input_schema 是 owner 已公开的显示/输入 schema；result_preview 必须同时有 owner truncated/source。不得输出 checkpoint locator/namespace、task/interrupt 定位、原 tool args、decision value/private submitted data、token 或内部 fence/lease/attempt/outbox。optional nullable display/validation 字段按 owner 实际存在性保留，不从缺失伪造 null。interaction_revision 与 pause_revision 不同义，两个安全整数按 owner交叉约束处理。owner 没有公开 Run fence 字段，不让用户 body 自报 fence/身份。

head、最新 full revision、Message/Artifact 与 event_watermark 在授权后的同一 RR transaction 读取；no-head/历史 ended run 不显示 pending，foreign/损坏/错 subject 或不一致状态 fail closed。同 RR 在 matching START 至 watermark 的现 ledger 范围查当前 run 最新 full-state CUSTOM，与 Row 的存在性/revision/digest/cursor对等；没有 Row 但已有 full-state frame 不能被当成初始[]，不新增一份 pending 布尔事实。phase active 在已消耗 pause 后仍可保留正 pause_revision/非空历史 pause_ref，不能强行归零。RR 只保证一次 HTTP read，不宣称跨请求同快照。

### Resume request、完整集合、幂等与 ACK

保持 POST /v1/sessions/{id}/runs/{runId}/control 与 Idempotency-Key。run.resume 的 public body 是 closed object，required kind、decisions、expected_pause_revision、pause_ref；session_id 由受信 path 注入 Agent ResumeControl，不从 public body 接收。expected_pause_revision 精确正安全整数，pause_ref 非空；禁止旧 decisions-only、tool_id alias、optional/default revision/ref 或 trace 定位。

ResumeDecision 五分支直接对齐已发布 owner：approve 的 item_id 与可选 args；edit 必须 args；reject 的 item_id 与可选 reason；respond 必须非空 response；submit 必须 object value。所有分支 closed，只有 owner允许的 nullable/optional 字段；未知 type/key、重复 item ID、missing/extra item、错 allowed_decisions 整批拒绝，不跳过坏项。decisions 必须覆盖当前 pause 全部 groups 的 item ID 集合且每项恰一次，不做 partial merge/“只交剩余项”。BFF 做可信 parent/head/RR 完整集合与结构预验；动态 input_schema/native结果由 Agent 唯一验证，并从其下一完整 revision 显示 validation。owner 在 I/O 时再次校验 revision/ref/整集合，因此 BFF RR 读到 HTTP 发出之间的跨服务 race 不被当作原子性保证。

本轮设计的 BFF 失败语义：结构不符继续400 invalid_run_control；不可见 Conversation 保持404 session_not_found，非当前/不存在 run 使用404 run_not_found；有效 shape 但 stale pause/ref、非 waiting 且非合法同 key recovery 为409 run_control_conflict（BFF public code，不是伪造 Agent failure code）。现 same key/different body 为409 idempotency_conflict、处理中为409 idempotency_in_progress；Agent 的实际错误继续现 owner envelope 归一，不重写 failure profile。新 BFF semantic code 须在后继 canonical error 示例与 contract tests 同片落地，当前未激活。

reuse 现 durable mutation receipt，不新增 intent 表/另造幂等身份，明确以下三种不同 identity：

- BFF mutation fingerprint 绑定本仓外层 durable receipt scope（可信 tenant/subject/method/path/key）及现 method/path/query/canonical headers/semantic body 请求语义；它是现 stableStringify 指纹，不是 Agent request_digest，也不是 interaction_digest。不同请求表示是否在 BFF receipt 层冲突仍按本仓规则；owner 的 null/omitted 等值不自动使两份 BFF mutation fingerprint 或 receipt 可互换，不重写全站幂等策略。
- Agent4 control request digest 基于固定 owner 的 RunResume typed normalization：material 含 kind/run_id/session_id/expected_pause_revision/pause_ref/decisions，排除 command_id/request_digest；只在 owner 声明的可选 nullable model 字段 approve.args、reject.reason 上将 null 与 omitted 归为同值。其余 required locator/item identity 不默认、不省略；decisions 保序；对象键排序、紧凑 UTF-8 JSON 后输出 sha256:<hex>。不得递归删除 submit.value、edit.args 或非空 approve.args 内的业务 null；业务字典中的 {"x":null} 与 {} 是不同 material。
- interaction_digest 仅绑定 owner 完整六字段 full state：对象键递归排序、groups/items 等数组保序，optional 字段的实际存在性与 null 值保持；不套用 control 的 optional-null 归一规则。同 revision 的 full-state digest 相等才允许 no-op，mutation fingerprint/control digest 均不能证明 state/source 相等。

相同 key 先按 BFF mutation fingerprint 重放/核冲突；只有已观察相同 action_result.command_id 的 resuming 可以用相同 pause 做 owner 幂等恢复，不允许另一 key 重复决定。若前次 ACK unknown 且本仓无 receipt，owner 仍唯一核其 typed-normalized control digest；BFF 不声称凭不含私有 args/value 的 state source 可重算原请求。Agent receipt.command_id 必须匹配 Idempotency-Key，receipt.request_digest 必须匹配上述 owner normalization 后的 control digest，不直接使用 BFF fingerprint 或原始未归一 control JSON。

现 src/infrastructure/clients/agent/control.ts、control-receipt.ts 与 control route 仍消费旧逻辑，后继必须在已列精准写集迁移 required locator、typed normalization 和 receipt digest 对照；对应现 test/agent-control-adapter.test.ts 的 owner-fixed 向量至少覆盖 approve.args/reject.reason null↔omitted 同 digest、submit.value/edit.args/非空 approve.args 内业务 null 保留且不同 digest、排除 delivery IDs、required revision/ref 与决策顺序。full-state 同 revision optional omitted↔null 不等值的投影向量独立保留，不用 control 向量替代。当前仅修正文档，未迁移 adapter/向量，不构成 public4 完成。

202 ControlReceipt（即使 status=succeeded）只证明 command admission/replay，不清集合、不把等待变 active、不结算 FIFO。只有 durable interaction.state 的 accepted/unknown 把当前全集置 resuming；native_consumed 的下一完整 revision 明确空集合才 active，非空则 waiting/re-pause；validation_failed 也是新 waiting。browser ACK、HTTP超时/unknown、普通 activity/tool returned 不能改变 pending。interaction phase terminal 与真正 run terminal 分开处理，最后 Run terminal 才释放 head/按 ledger drain 结束；cancel HTTP ACK 同理。

### AG-UI 与机器改动

公开仍是同一 durable AG-UI SSE，不另发逐项 opened/resolved 或 legacy envelope。BFF 将严格 validated interaction.state 整体投影为一个 CUSTOM，name=kokoro.interaction.state，value 是 owner 六字段 full state（包括 active/terminal 的明确空 groups）；metadata 继续现 event_id/seq/session_id/run_id/UTC timestamp，frame/cursor与state同事务。queued CUSTOM name/value 原样，绝不隐藏它清旧列表断言。重复 revision 不再生成相同 state frame；raw source identity/序列/高水位仍按现连续性与 duplicate guard 处理。

后继机器精确范围：contract/openapi/v1/openapi.yaml 的 version/ChatSessionDetailResponse/ExecutionHead/PendingPause/ResumeDecision/RunResumeRequest、control examples/409 code 示例与 SessionEventStream CUSTOM 示例；contract/tests/v1-operations.json 只更新批准的 breaking inventory；Agent vendor/dependencies/config/generator/generated 见 TECH R48 表。当前 canonical/inventory 实际88个 operations（包括非 /v1 边界）；其 path/operationId/owner/visibility/permission/idempotency metadata 不因字段cut增加新路由，不沿旧 README 84摘要计数冒称机器事实。schema-first 与 current generated producer/strict decoder必须同片一致，不手改 generated 或用 cast 冒充 public字段。

Root真实投影21pass9fail/0skip不是 public4 GREEN；精确旧测试迁移表在 TECH R48。R43 三例公开 head/水位/重启后段维持原断言；新的 waiting/resuming/full revision/required resume/body privacy/零写错误/owner receipt/no ACK消费/GC/RR 与 published-pin contract tests 是后继 RED。当前机器/source/schema仍冻结，后继实际命令与发布前置见 CURRENT R48。

---

## BFF-SCHEDULED-D0：内部 durable acceptance 与 terminal gate（2026-10-01；内部源码候选，真实 PostgreSQL 待 Root 验证）

public Product OpenAPI、Scheduler webhook与Agent3 launch/session-events wire不变。`POST /internal/bff/scheduled-tasks/dispatch`的202收敛为：BFF已在同事务保存冻结occurrence snapshot、execution scope/dispatch及幂等结果；不表示Agent admitted、Run started或terminal。重放同scope+digest返回同202且不重复入队；冲突仍409。

receiver不再同步代理Agent。内部worker只发送scope已固定active；无active时从已accepted rows按RFC3339Nano固定九位key选最早。一旦A固定，迟到的更早B只排队、不能抢占A。Agent2xx只admitted；terminal来自`/v1/sessions/{scheduled:<task>}/events`的session级连续source。reader保存所有事件的sourceRunId/seq/id/payload后才判断；只有精确active run terminal释放，历史/foreign事件只推进合法cursor。

现task delete仍物理删除；独立scope无task FK并继续恢复已202 occurrence。pause/delete不取消、不failed、不释放已accepted/admitted head，只阻止未来接纳。现Scheduler delete outbox语义不变。unknown固定同run/key恢复；只有明确never-admitted失败释放。Agent4非前置，未发布busy code不进入分支。

callback自身同claim处理中仍425，基础设施503，身份/shape400/401，幂等冲突409。202后异步结果不改写receipt。无新增Scheduled run public查询/取消协议；scope/dispatch/source ledger均internal。

### R25-P1 内部状态与响应边界

Scheduled session source的`source_digest`是内部完整性字段：唯一表示为递归键排序JSON的SHA-256；adapter生成与repository重算必须使用同一application ledger helper，格式正确但内容不匹配的64位hex同样整页拒绝且cursor/ledger/dispatch零写。此项不新增或改变公开/owner wire。

公开Product API、Scheduler callback及Agent3 wire均不变；`202`仍只表示BFF已durable acceptance。内部Scheduled状态新增明确的drain语义：active terminal在source尚未exhausted时只把dispatch记为terminal，scope active identity继续作为session drain anchor；后续合法foreign/history/零frame page继续推进cursor。只有连续source页确认`exhausted=true`才释放scope并允许下一dispatch。该内部状态不新增public字段。

网络前预算耗尽不是Agent admission unknown。Scheduled私有repository port提供fenced never-sent release；它要求当前owner/token/fence且未开始I/O，失败或late调用为no-op；历史`admission_unknown_seen`保持sticky，但不妨碍结束这次确定未发送的lease并以同run/key重试，绝不清active/head。开始I/O后的timeout、5xx、坏2xx仍按sticky unknown恢复同run/key。public `active_run`仍只在受信`RUN_STARTED`后可见；本片不新增queued/inflight public identity。

R24的51项真实PG结果为历史候选证据，并未覆盖上述P1故障注入与跨页状态，因此R25完成前不得称完整Scheduled gate验收。

## BFF-EXECUTION-HEAD-D0：public 4.0.0 corrective contract（未实施）

Root裁决首次上线前在原`/v1`单路径发布public `4.0.0` breaking artifact。snapshot以严格`execution_head:{run_id,state,pending_pauses}`替代`active_run`，state仅`queued|active|waiting|resuming`；旧字段/generated consumer删除，不建`/v2`、双字段、fallback或Web双读。BFF先固定owner artifact commit/version/digest，Web再repin并做fresh组合激活。ROLE2当前3.0是正式基线；未来retry是BFF 4.1且依赖Agent实际retry artifact。下一片同步`contract/README.md`与仓`README.md`，本轮未授权。

无nonterminal FIFO head时`execution_head`缺失。queued隐藏pending/leased/retryable/admitted差异；active只在匹配RUN_STARTED且pending集合为空；waiting表示authoritative集合非空且decision尚未提交；resuming表示Agent durable source已受理当前revision的decision、同一完整集合保留并标记submitted，禁止重复decide。`pending_pauses`、head、state与`event_watermark`来自同一RR快照：queued/active为空，waiting/resuming非空。具体item/action schema等待Agent HITL owner artifact，BFF不先定义逐项生命周期。

HTTP resume/deny/cancel ACK（含2xx）不改变集合或state。只有Agent durable source确认受理当前revision decision才以fence CAS进入resuming并标记submitted；只有owner确认effective native resume已consumed并发布下一完整revision才整体替换。新revision非空表示re-pause并进入waiting，明确空才active；terminal/cancel按owner source结算。unknown ACK、任意activity、普通tool返回不能清空；source/revision replay幂等，同revision异内容、倒退、foreign/fence冲突整批拒绝。

BFF-owned CUSTOM `kokoro.run.queued` strict value仅`{run_id,dispatch_sequence}`，分别为非空identity与正十进制字符串；cursor/event id由outbox稳定派生且幂等。响应不暴露actor、outbox、payload、lease或attempt。tenant/owner/project来自受信上下文。

R43 FIFO/RR 收敛（目标，未实施）：Run的`RUN_FINISHED`/`RUN_ERROR`只表示该Run终态，不等于Conversation流关闭。A terminal后已有B durable head（含queued、尚未RUN_STARTED）时，SSE须继续按现有界ledger等待规则服务；不能仅因历史`terminal_run_id=A`提前结束。有效结束判定与head/watermark来自同一一致性读边界；仅无head且存在合法terminal事实、已送达ledger head时按现规则结束。不新增公开结束字段或fallback，不伪造B RUN_STARTED。重启后`Last-Event-ID`仍原样使用已发出的opaque cursor，不重建queued身份或重复发送已越过的frame；snapshot各字段保持同一RR视图，不承诺跨请求快照一致。

R44 内部第一源码片（候选，待 Root 集成验证）：public3 canonical OpenAPI、src/contracts/chat.ts 与 ChatApplicationService 映射逐字保持；内部 ChatSnapshot.executionHead 不是新公开字段，也不附固定空 pending 集合。BFF-owned queued 仍通过既有 AG-UI CUSTOM 承载严格 {run_id,dispatch_sequence}，稳定 identity/cursor 不写 Agent source ledger 或高水位。replay 内部 terminal 结果只在无 FIFO head 时表示可结束，route/SSE wire 不变。冻结三条 R43 测试的公开 execution_head 断言均保留：queued 回滚测试也有后段公开断言，故本内部片不承诺任何完整测试已 GREEN。Agent e977923 / HTTP4 已发布但本片 pin/generated/parser 不变；随后完整四态、full pending revision 与公开4 必须经同 owner 三面 D0、机器契约及正式消费切片，不以未发布候选、cast 或空集合补字段。

## BFF-FIFO-ATOMIC：内部 Conversation gate，不改变 public 3.0.0（2026-10-01；源码与真实PG门已验证）

内部 lease/fence 不采用调用方时间。实现须在目标行锁之后读取同连接数据库实时时钟，以该 `db_now` 完成 expiry CAS；锁等待跨过 expiry 的 ACK、unknown、not-admitted、consumer renew/settle 均为 no-op，projection consumer commit 为 lease conflict 且整批回滚。Agent durable terminal 仍可在 HTTP lease 结束后提交。

本片不修改canonical OpenAPI、operation、HTTP status/envelope、幂等key、Message/AG-UI frame schema或Agent owner wire。
`POST /v1/sessions/{id}/messages` 的202仍只表示BFF已原子持久化Message与dispatch receipt，不表示Agent admitted、queued或
terminal；public响应不暴露内部dispatch状态。严格匹配的Agent 2xx只形成内部admitted，后继仍等待durable terminal source。
terminal可先于HTTP ACK；后到ACK/timeout/4xx受lease+fence+terminal CAS约束为no-op。内部耗尽探测与普通claim分成两个事务，前者无论settled与否都先释放stream锁，后者按tenant/session确定序执行stream→dispatch。

内部delivery结果必须区分 admitted / owner证明not-admitted / unknown。timeout、5xx、408/425/429、连接异常、invalid或oversized
2xx均属unknown；一次unknown发生后，后续4xx不证明历史请求未接纳。只有从未unknown且owner严格4xx或send前本地失败可形成
pre-admission failed。unknown快速预算耗尽后，同一durable outbox仍以同run/idempotency按现30秒backoff cap有界重新POST；每claim
一个timeout、每worker cycle现16条上限，AG-UI terminal reader并行恢复。public不新增该分类，也不把BFF dispatch failure伪装成Agent failure profile。

连续source wire不变。历史dispatch terminal是post-terminal守卫真源：即使stream已释放expected并接纳下一head，旧run也只接受
完全相同source identity/sequence/digest的幂等duplicate；任何新/冲突source拒绝且不推进cursor。未发布terminal retry、required
parent、Agent4 artifact和durable queued均不在本片。Scheduled callback虽同样可产生相同`scheduled:<task_id>`，当前不经过Chat
gate；这是必须独立闭环的P0，不以本片public/API描述掩盖。

正式Agent source reader在任何UI frame过滤前保存owner `run_id`为内部`sourceRunId: string|null`；即使该source投影零frame，也以此历史dispatch terminal/failed守卫。非空event/assistant/artifact/frame run必须与sourceRunId一致；明确session级null才不按run守卫，不改变owner wire。

## BFF-CHAT-PAGING1：响应与cursor协议保持（2026-10-01；源码与回归已验证）

唯一 public机器事实源仍为 HEAD293dfe7 的 contract/openapi/v1/openapi.yaml 3.0.0；本片不修改机器版本、schema、operation或生成客户端。
GET /v1/sessions仍返回 sessions与required string|null next_cursor，按 updated_at DESC、conversation_id ASC继续分页。
cursor只作为位置，不授予权限；每页重新应用tenant/subject/active/Project筛选。筛选改变时消费者丢弃cursor；本片不新增filter绑定协议。
修复同timestamp续页遗漏是恢复既有排序，不更改 direct/omitted/project_ref语义，不引入未发布retry mutation。
下方ROLE2历史待发布与retry候选不是当前机器状态；Root真实HTTP/PG与完整contract门验证后才记录本片通过。

# kokoro-bff API contract policy

## BFF-CHAT-ROLE2：Message role public 收窄（2026-10-01；目标 `3.0.0`，未发布）

当前 canonical OpenAPI 仍为 public `2.0.0`，`ChatMessage.role` 声明 `user | assistant | system`；实际 BFF writer、Agent
contract 与 Web consumer 只有 `user | assistant`。目标机器契约将 `info.version` 设为 `3.0.0`，保持 `/v1`、路径、方法、
operationId、权限、幂等、分页、错误与 AG-UI 语义不变，只把响应 role 收窄为精确两值。不增加 system notification/prompt
能力，也不把 system 过滤或映射为 assistant。source publication 不激活 3310，Web 必须在后继 owner 切片固定已发布 BFF
commit/version/digest 后才可协调 fresh 组合。

该响应 enum 收窄是 breaking，不称 backward compatible。Root 已批准它作为首次公开发布前、仅本次 role 漂移修正的
corrective baseline：目标 public `3.0.0` 仍使用 `/v1`。正式发布后，本文常规 breaking policy 继续要求 `/v2`，不得引用
本次例外。未来正式 retry 是以 ROLE2 发布完成且 Web 消费锁步为前置的 additive public `3.1.0`；Agent `4.0.0` 仍未实现/
发布，当前不声明 retry operation 可调用。

API、SQL 与运行时必须同片一致：OpenAPI 两角色、domain/public TypeScript 两角色、fresh canonical SQL CHECK 两角色。
row mapper 当前信任 canonical 数据库约束；本片不为旧三角色 schema 新增 parser、过滤或 fallback，也不把 source 用于旧
schema。旧数据库不会由 installer 自动修复。待验：OpenAPI 定点 RED/GREEN与 `pnpm contract:check`、
`pnpm test:architecture`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test`；发布 commit/digest、Web repin 与 fresh
组合均待后继，不以本次文档编辑冒充机器契约已发布。


## BFF-RETRY-DESIGN：失败 assistant 重试 public 契约（2026-09-30；目标 `3.1.0`，未实施）

### 当前机器事实与 owner 发布门

当前 canonical [`../contract/openapi/v1/openapi.yaml`](../contract/openapi/v1/openapi.yaml) 的
`info.version` 是 `2.0.0`，没有 retry operation。目标是 additive public `3.1.0`（以 BFF-CHAT-ROLE2 的 public `3.0.0` 发布及 consumer 锁步完成为前置），HTTP namespace 仍是
`/v1`，现有 create/list/snapshot/share/AG-UI operation 的 request/response 不改。

目标 public 发布被 Agent owner 前置阻塞。当前 Agent `3.0.0` / commit
`f3be3b97dd67df69ed3c6cb88c59f3bc2db97703` 对同 original `message_id` + 新 `run_id` 会产生
`ChatIdentityConflict`，并在同 scoped thread 中生成两条 native HumanMessage。Agent 须先发布经
provenance 固定的 typed `RunRequest.retry_of_run_id` 和完整 attempt 语义；目标 Agent `4.0`
已是 owner 四文档冻结的 breaking 目标设计候选，但尚未实施或发布，当前没有可用版本、commit 或 digest。BFF 不用
手写 DTO、optional fallback 或旧 `message_id` 透传假装契约已可用。

Agent 4.0 目标将 `LaunchRequest` / `LaunchBody` / `RunRequest.retry_of_run_id` 定义为
**required nullable**：normal 必须在 JSON 中显式发 `null`，retry 必须发最近失败 parent 的非空
run ID。缺失不等于 normal；没有 default、omit-on-null、trace lineage 或 3.0 fallback。BFF 实际有两个
Agent launch producer：Chat outbox delivery 和 internal Scheduler dispatch receiver。Chat normal、Scheduler normal 都必须显式
`retry_of_run_id:null`，只有本 public retry command 生成非 null值；两个 producer 与各自 persistent parser
必须同片切换。

### operation

```text
POST /v1/sessions/{session_id}/messages/{assistant_message_id}/retry
visibility: public
owner: kokoro-bff
permission capability: chat.message.create
idempotency: required
request media type: application/json
```

- `session_id` 和 `assistant_message_id` 是不透明 path identity，不从 body 接受替代值。query 只复用
  private Chat 的 `scope` / `project_ref`：`scope` 缺省、空或 `direct`，`project_ref` 最多一个。
- body 是 required closed object：`type: object`、`maxProperties: 0`、
  `additionalProperties: false`。唯一合法 JSON 值是 `{}`；零字节、`null`、array、scalar 或任何成员都拒绝。
- raw `Idempotency-Key` 恰好出现一次，1–128 字符，每个字符是 `\x21-\x2B` 或
  `\x2D-\x7E`；不 trim、不 comma-join，不接受空白、逗号或重复 header。
- 不接受 content、model、agent、thinking、Skill/MCP 或 project 快照；它们只从原 BFF outbox
  的严格、已绑定 payload 恢复。

`x-kokoro-permission: chat.message.create` 复用现有能力名，不创建新 IAM permission。当前实际
enforcement 是 Web→BFF service 边界、Bearer online session verification、fixed tenant，再由 BFF 执行
Conversation/project/target private owner 可见性。该 extension 不宣称 IAM 现在另行解析 action grant。

### 202 与幂等语义

202 复用现有 `MessageReceiptResponse`：

```json
{
  "data": {
    "run_id": "NEW_RUN_ID",
    "user_message_id": "ORIGINAL_USER_MESSAGE_ID",
    "assistant_message_id": "NEW_ASSISTANT_MESSAGE_ID"
  },
  "meta": { "request_id": "REQUEST_ID" }
}
```

`user_message_id` 故意保持原值；新 run 与 assistant ID 只在首次 commit 时生成。同 admitted
tenant/subject/conversation 中，同 key + operation + target 返回已提交的同一 `data`，即使返回
202 后连接中断、target 已不再是最新失败或新 run 已活跃。每次 response 的
`meta.request_id` 仍是当前 request ID，业务 `data` 从 committed outbox 恢复。

同 key 用于 create-message、另一 target、另一 project scope 或其他不同 semantic digest 返回
409 `idempotency_conflict`。并发同 key 首请求由 Conversation lock 串行；后到者回收第一个已
提交 receipt，不创建第二 attempt。该 route 绕过 generic `bff_idempotency_receipt`，不返回
generic `idempotency_in_progress`；权威 receipt 是同事务 outbox。

### 首次请求的资格与错误

同 key 回收在当前 ACL/target visibility 后、动态状态检查前执行。未使用的新 key 只可指向：
active Conversation 的最新 assistant，严格 `status=failed`，有 verified Agent profile 且
`retryable=true`，原 dispatch 已 `succeeded`，冻结 payload/Message/outbox lineage 精确，并且无新
dispatch、active run 或未决 HITL。普通 resend、successful regenerate、BFF 本地 dispatch recovery 都是
其他 operation，不得进入本路由。

| HTTP | stable code | 含义 |
| --- | --- | --- |
| 400 | `invalid_retry_request` | body 不是精确 `{}`，或 path/query 不符合契约。 |
| 400 | `idempotency_key_required` / `invalid_idempotency_key` | key 缺失，或 raw header 不是唯一合法值。 |
| 401/403 | 现 IAM session/service codes | online admission 失败；不读取 retry 事实。 |
| 404 | `session_not_found` / `message_not_found` | Conversation/target 不存在或对当前 tenant/owner/project 不可见；跨权不区分。 |
| 409 | `idempotency_conflict` | 同 key 已绑定不同 operation/target/digest。 |
| 409 | `retry_not_allowed` | 新 key 的 target/profile/source/tail/run/HITL 状态不满足完整重试前置。 |
| 413 | `request_body_too_large` | 超过现 BFF mutation body 上限；不进入 Chat 事务。 |
| 429 | 现 IAM rate-limit code | online admission 限流，保留受控 `Retry-After`。 |
| 503 | `agent_not_configured` / `business_store_unavailable` | 依赖未配置或 BFF 业务存储不可用；无部分重试事实。 |

Agent worker 网络失败发生在 202 之后，按现 durable outbox 的有界重试/终止语义处理，
不把 provider diagnostics 暴露为 public error。新 Agent run 若再失败，仍由 BFF-AGENT-FAILURE3 的严格
safe failure 契约决定是否可再次 retry。

BFF 内部持久 wire 也是契约门的一部分：Chat `AGENT_DISPATCH_SCHEMA_VERSION` 从 2 升为 3，
Scheduler receipt envelope 从实际 2 升为 3。两者的 launch 都必须保留 required
`retry_of_run_id`；Chat retry 非 null，所有 normal 为 null。v3 parser 拒绝 v2、missing/extra/错类型；
Scheduler 还必须拒绝非 null parent，并验证 canonical occurrence 派生的 run/user/assistant/identity assertion。
这不改变 public 202 receipt shape，但确保该 receipt 只能来自同一严格 v3 row/snapshot。

### additive 发布与验证

`3.0.0` 到 `3.1.0` 只新增 operation 和 closed empty request schema；现有 schema/operation 不收窄，`/v1`
不改名。machine contract 必须同片更新 operation inventory 与 `contract/README.md`。新 Agent owner pin
必须用具体 commit/version/OpenAPI SHA/provenance SHA 替换当前 HTTP owner 目录并重新生成 client；
独立 `delivery.created` `486adb…` event source 不变。在 owner artifact 发布前，本节不是已发布
public 承诺。

发布/激活顺序是：Agent 4.0 artifact 先 publish 但不 activate；BFF 在同一切片 repin 并更新
Chat normal+retry、Scheduler normal、Chat payload v3 与 Scheduler receipt v3；扫描其他 Agent launch sender 无遗漏；
再发布 public 3.1/Web 消费，最后协调运行组。已有 v2 不在 parser 内自动补 null、升级或删除；
Root-owned 验收使用 fresh fixture，受管环境的 fresh/drain/历史 replay 生命周期必须在 activate 前另行决定。

## BFF-AGENT-FAILURE3：Message 安全失败与 RUN_ERROR（2026-09-30；当前机器事实，消费者协调待完成）

### 当前机器事实与协调版本

起始基线 BFF main `15e07fa44670bc13705ce3f6f700e73afcb72ccc` 的 canonical artifact 是 public 1.0、
无 `ChatMessage.failure`，且固定 Agent HTTP 2.0。当前实现已把唯一 canonical
[`../contract/openapi/v1/openapi.yaml`](../contract/openapi/v1/openapi.yaml) 升为 public `2.0.0`，保持全部 HTTP
路径仍在 `/v1`，并发布本节的 optional closed failure 与单向 presence guard；旧 1.0/Agent 2.0 不保留 alias、
fallback 或双轨 vendor。发布 commit 与最终 artifact digest 由 Root 集成后记录。

目标以 Agent owner commit `f3be3b97dd67df69ed3c6cb88c59f3bc2db97703` 的 HTTP `3.0.0`
OpenAPI（SHA-256 `e9f0a543f74dee34212f0ea4fe366d46218268462ac54dce08e41965f34d2d2c`，
provenance 文件 SHA-256 `d116657f65027de8bd829dc0408fd86046da0ac0a1d2934bd2a87e835c897b5f`）
为唯一 failure source。BFF public artifact 协调升为 `info.version=2.0.0`，但 HTTP 路径仍全部位于 `/v1`，本片不建立
`/v2`、alias、双返回或旧 failure fallback。消费者必须按 BFF 发布 commit、version 与 digest 同步 repin；该协调 breaking
变更不冒充向 1.0 consumer 兼容。

### `ChatMessage.failure`

目标 canonical OpenAPI 在 `ChatMessage` 增加 optional `failure`，其唯一 shape 为：

```yaml
type: object
required: [source, code, retryable]
additionalProperties: false
properties:
  source: { type: string, const: agent }
  code:
    type: string
    enum:
      - token_budget_exceeded
      - recursion_limit_exceeded
      - assembly_failed
      - enqueue_failed
      - dispatch_exhausted
      - contract_incompatible
      - internal_error
      - model_unavailable
      - dependency_unavailable
      - model_access_denied
  retryable: { type: boolean }
if:
  properties: { retryable: { const: true } }
then:
  properties: { code: { enum: [model_unavailable, dependency_unavailable] } }
```

schema 还必须以条件组合表达：`failure` 存在时 `role=assistant`、`status=failed` 且 `run_id` 必须存在并非空；其他
Message 不得出现 failure。精确 presence guard 是：

```yaml
allOf:
  - if:
      required: [failure]
    then:
      required: [run_id]
      properties:
        role: { const: assistant }
        status: { const: failed }
        run_id: { type: string, minLength: 1 }
```

`if.required=[failure]` 不得只写 `if.properties.failure`，否则 failure 缺失也会误中 then；没有 `else` 或反向
`required:[failure]`，因此 assistant+failed+run 仍可表示 cancel/dispatch/delete，failure 不是 mandatory。十个 code 的
`retryable=false` 都合法，只有 availability 两码允许 `true`。缺失与 `null` 不同：failure 缺失表示没有 verified Agent
failure；不发布 `failure:null`，也不以 unknown code、BFF dispatch code、取消、Conversation delete 或 raw diagnostics
填充。契约 mutation tests 必须分别删除 `if.required=[failure]`、then 的 role/status const、`required:[run_id]` 与
`run_id.minLength` 并得到 RED，同时证明没有反向强制 failure。

以下三个现有 public read 使用同一 `ChatMessage` schema，因此必须同片更新并同样保持安全字段：

1. `GET /v1/sessions/{id}` 的 optional `data.messages`；
2. `GET /v1/sessions/{id}/messages` 的 `data.messages`；
3. `GET /v1/shared/{share_id}` 的 optional `data.messages`，仅在既有 service-only Share capability active、未撤销、
   未过期且绑定 active Conversation 时返回。

它们不返回 Agent `payload_json`、exception、provider message、stack、HTTP body 或 error_kind。failure 不改变
Message cursor、limit、排序、`event_watermark`、Share permission 或 error envelope。`ChatRun` 仍只表达现有
`active_run` read；不因 terminal Message failure 新增或输出 `active_run.status=failed`，不删除其历史声明状态。

### 标准 AG-UI 实时失败

Web/BFF Agent network protocol 仍只有标准 AG-UI。verified Agent `run.failed` 目标投影为：

```json
{
  "type": "RUN_ERROR",
  "threadId": "CONVERSATION_ID",
  "runId": "RUN_ID",
  "code": "model_unavailable",
  "message": "Agent run failed",
  "metadata": {
    "kokoro": {
      "event_id": "EVENT_ID",
      "seq": 42,
      "session_id": "CONVERSATION_ID",
      "run_id": "RUN_ID",
      "timestamp": "2026-09-30T00:00:00.000Z",
      "failure": { "source": "agent", "code": "model_unavailable", "retryable": true }
    }
  }
}
```

`RUN_ERROR.code` 必须等于 `metadata.kokoro.failure.code`；message 是固定安全文本，不采用 owner/provider 原文。
snapshot 与实时 failure 的 `{source,code,retryable}` 必须来自同一个已验证 owner payload，并在同一 BFF projection
transaction 提交。BFF 自有 dispatch permanent failure 继续发送既有 `RUN_ERROR`，但没有
`metadata.kokoro.failure`，也不令 Message 出现 Agent failure；不新增 `CUSTOM`、legacy SSE envelope 或第二错误协议。
`EventSchemas.parse()` 对 metadata 的 passthrough 不能证明序列化对象没有泄漏：直接契约测试必须检查最终 durable/SSE
frame 顶层没有 `retryable`，`metadata.kokoro.failure` 的 key 集恰为 `source/code/retryable`，没有 owner `status`、raw
payload/diagnostics 或 extra；顶层 code 与 nested code 同值，message 精确为 `Agent run failed`。这些断言也必须对删除
guard、复制 top-level retryable 或扩散 extra 的 mapper mutants 失败。

### Agent 3.0 consumer 与严格负例

完整 owner OpenAPI 只读固定到
`contract/vendor/kokoro-agent/f3be3b97dd67df69ed3c6cb88c59f3bc2db97703/openapi.json`；同目录固定 owner
`provenance.json`，其文件 SHA-256 是
`d116657f65027de8bd829dc0408fd86046da0ac0a1d2934bd2a87e835c897b5f`。dependency manifest 与 generator
必须验证 provenance 的 `http_contract.version=3.0.0`、
`path=contract/openapi/v1/openapi.json`、
`sha256=e9f0a543f74dee34212f0ea4fe366d46218268462ac54dce08e41965f34d2d2c`，并验证 failure generated
artifact 的 `source_sha256` 同值，而不是仅在文档中记录来源。现有 generator
继续仅生成 `createRun` 与 `replaySessionEvents` operation，同时从 owner
`#/components/schemas/ChatFailure` 确定性生成
`src/generated/agent-http/failure-profile.gen.ts`。该 runtime validator 是 owner schema 的只读派生物；不得手写十码
allowlist、设置 `orphans:true` 生成无关 schema 或让 generated 类型穿透 infrastructure client。完整
`ReplayPageEnvelope` 和页内所有 `run.failed.payload_json` 必须先全部验证，再交 projection；任一非法 event 令完整页
零写且只 block 对应 consumer。

owner wire 先验证完整 `ChatFailure={status:"failed",code,retryable}`，public safe shape 明确不含 owner status。contract
RED/GREEN 矩阵至少包含：10×`false`、2×`true` 接受；其余 8×`true`、unknown、缺 code、缺 retryable、缺/wrong/null
status、extra property、string/number/null retryable、非 object payload 拒绝；generator structure tests 对
`Failure.required`、retryable `if/then`、`ChatFailure` 的 Failure ref、status required/const 和
`unevaluatedProperties:false` 分别做 drift mutant 并要求生成失败。public failure 的 extra/null/错误 role/status/缺 run
拒绝；snapshot/list/Share/实时使用同一 safe shape；raw exception/message/stack/provider sentinel 永不出现。

### 实施阶段记录（已完成）：breaking、来源删除与验证

HTTP 3.0 repin 删除旧
`contract/vendor/kokoro-agent/dd34a4800b4ce0cc61eb80dd715e528b9d4517da/openapi.json` 及对应 manifest/config pin，
不保留 2.0/3.0 双 client。Agent delivery event-protocol 的独立旧来源
`486adb1539dd8a06ca90684e66f91be031aa70cf` 与 aggregate
`cae30a40d712bce39ef33ef2dc857af4f5b69c6afd1956fda065ec77379ae02e` 保持原字节；它不是本次 HTTP failure
schema pin，不能随旧 HTTP vendor 一并删除。

以下记录已完成的授写顺序，不是当前待实施状态。第二门当时只写上述既有 tests：直接断言当前 mapAgentEvent fallback、RUN_ERROR、canonical public 1.0/字段/presence
guard 与 owner/schema 目标而稳定 RED；OpenAPI、Schema、vendor、manifest、generator、generated 与 runtime 均保持 15e
bytes，且不 import 尚不存在的 generated file。Root 接受 tests-only RED 后，同一单 owner GREEN 才一次更新 canonical
public 2.0、`contract/README.md`、Schema、f3be `openapi.json+provenance.json`、manifest、generator/config/generated、
runtime 与 tests，并删除 dd34 vendor；禁止提交/发布旧新双轨或虚假 generated manifest。`contract/README.md` 必须同步
public 2.0、Agent 3.0、published provenance 与 `/v1` breaking 结论，不能继续宣称 1.0/Agent 2.0。

后续实际验证显式使用 `PATH=/Users/nako/.nvm/versions/node/v22.22.2/bin:$PATH` 并先记录
`node --version`=`v22.22.2`；默认 shell Node 24 结果不作为 Node 22 证据。命令是 `pnpm contract:check:agent`、
`pnpm contract:check`、`pnpm test:architecture`、
`pnpm typecheck`、`pnpm test` 与 `pnpm build`。初始文档门当时只完成设计，随后canonical/public2、vendor/generated和runtime已一次实施，
Root完整门与真实七integration已通过，证据见CURRENT；Web严格consumer repin与真实运行组仍待后继，不混为已通过。

## BFF-PERSONAL-DOC-GATE：本人安装 public 目标（2026-09-30；canonical OpenAPI 已接线，真实组合待验）

当前 canonical OpenAPI 与在途 runtime 已唯一固定 Platform `6519ae9a7dba63586474d2860f6725d3165b701e` v5.0.1 aggregate `3f97b3c98fd8e7ce46e4a8ea73237ddb85e764849d2b15dd28d0a3a58a69e42f`，并接线以下 public `/v1` 本人安装资源及五个 owner 方法；旧按 name enable/disable contract、stub、alias 与 v4 fallback 已删除。该消费者代码尚待 Root 提交及真实 IAM→BFF→Platform 组合验收，产品未激活；本文链接本仓唯一 `contract/openapi/v1/openapi.yaml`，不是第二份机器 schema。

| Method/path | 输入与语义 | 成功 |
| --- | --- | --- |
| `POST /v1/skill-installations` | strict body 只含原样 canonical `source_ref`；单个 Idempotency-Key；显式安装，不由 Publish 触发 | 200 owner receipt ACK |
| `GET /v1/skill-installations` | optional `enabled`/`installed` 保留 presence；optional `limit`/`cursor` 不 trim | 200 当前本人页 |
| `GET /v1/skill-installations/{installation_id}` | canonical exact ID；无 body/query/idempotency key | 200 当前本人表示 |
| `DELETE /v1/skill-installations/{installation_id}` | canonical exact ID；单个 Idempotency-Key；不接 body | 200 receipt；installation 为 `installed=false`、`enabled=false`、`removed_at` present |
| `PUT /v1/skill-installations/{installation_id}/enabled` | strict body 只含 required boolean `enabled`；单个 Idempotency-Key | 200 owner receipt ACK |

身份只来自 current IAM session 的可信 tenant/user；BFF workload metadata 使用精确 `x-kokoro-subject`，public body/header 不接受 tenant、subject、owner scope、target、execution proof、package/hash 或 command identity。资源缺失或对当前可信 tenant/subject 不可见统一 404，不泄漏存在性；缺失/失效 session 是 401，service/session/tenant 或 workload 已认证但无权是 403；organization/project/session/global/shared 不在此版本。POST 只能安装本人 PERSONAL/ACTIVE source，且发布不自动安装。读权限不等于执行权限；安装/true-enable 的 source/package/fresh health 与 current generation 由 Platform owner 每次判定。

安装安全表示精确为九个 snake_case 字段：`installation_id`、`source_ref`、`series_id`、`revision`、`installed`、`enabled`、`installed_at`、`updated_at`、`removed_at`。revision 必须是 `1..2^64-1` 十进制字符串；时间必须为合法 UTC RFC3339 `Z`；optional 时间缺失保持缺失，禁止把缺失、null、epoch 或本地时间互换。owner 不存在 `removed` boolean；移除态必须是 `installed=false`、`enabled=false`、`removed_at` present。安全响应不得出现 tenant/subject/target、package asset、content digest/hash、manifest、signed URL、proof 或内部 reason。

GET 成功精确为 `{data:<九字段 installation>}`。三种写成功精确为 `{data:{installation:<九字段>,change:'installed'|'upgraded'|'reinstalled'|'enabled'|'disabled'|'removed'|'unchanged',event_id?:string,replayed:boolean}}`：owner enum 1..7 逐项映射小写，0/未知拒绝为 502；`unchanged` 必须没有 `event_id`，其他 change 必须有首个合法 `event_id`。首次 ACK 的 installation/change/event_id 由 owner receipt 固定；同键 replay 只把 `replayed` 置 true，禁止用当前状态重算。DELETE 首次有效移除返回 change `removed`，自然 no-op 返回 `unchanged`，两者 installation 均用 owner-native removed state，不发明 `removed` 字段。

List 成功沿现有 BFF list 规范：`{data:[<九字段 installation>],meta?:{next_cursor:string}}`。owner `PageResult.next_cursor` 是 optional string；只有 present 且非空时 public 才出现 `meta.next_cursor`，absent 时整个 `meta` 缺失，present 空串或非法 presence 为 502。默认 limit 50，合法范围 1..100；cursor 最大 4096 UTF-8 bytes，opaque、原样转发，按 `installation_id ASC`，非 snapshot。cursor 绑定 product surface、可信 tenant/subject、派生 target、`enabled`/`installed` 的 presence+value 与排序；缺失 filter 表示包括 removed，显式 false 不等于缺失。调用者不得解码 cursor，BFF 不 trim、重签或缓存它。

所有响应包含有界 `x-request-id` 与 `Cache-Control: no-store`。稳定错误 envelope 仍为 `{error:{code,message,retryable}}`：400 非法 path/body/query/key/cursor，413 请求体超过各操作固定上限，401 session 缺失或失效，403 service/session/tenant 或 workload 被拒，404 installation/source 不可见，409 同键异 digest/命令进行中，412 source 不可安装、stale generation 或非法状态前置，429 IAM/Platform 限流（合法时转发有界 Retry-After），502 owner 响应违反九字段/receipt/presence，503 tenant 未配置或 IAM/Platform 依赖不可判定，504 deadline。错误按 owner code+stable reason 映射，不解析 message。请求 AbortSignal/deadline 必须贯穿；写请求发生 unknown ACK 时只允许同 key 重试，不降级本地成功或切换旧服务。

三写操作的 command digest 分别使用 Platform v5 artifact 中独立的 `skill.product.install`、`skill.product.set_installation_enabled`、`skill.product.remove_installation` 定义，digest version 均为 `product-personal-installation/1.0.0`；source/installation/boolean presence 与可信 subject/target 按 owner machine binding 投影，不把 request ID、token、command ID 纳入 digest。GET/List 不制造命令或 receipt。Breaking/activation：本仓 canonical OpenAPI、operation inventory、语义门、生成 client 与 runtime 已在同一在途切片更新；旧 503 paths 删除而非 alias/fallback，Web 再固定新 BFF commit/digest。


## W3 Chat typed Skill 选择契约（已实现，组合待验）

唯一 public `MessageCreateRequest` 已移除 name `pinned_skills` 与对应 trace 字段；Agent required `LaunchRequest.selected_skill_source_refs` 已在 HTTP 2.0.0 commit `dd34a4800b4ce0cc61eb80dd715e528b9d4517da` 发布，`contract/openapi/v1/openapi.json` SHA-256 `20398c59f42031c1b6ae2e2c3708e63ec8b5645baf741bf831bc67e14625ef99`。本片机器契约一次替换旧字段为 `selected_skill_source_refs?: string[]`，每项原样匹配 owner `^skill:(?!skill:)[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])`、7–197 ASCII 字符（不 trim、不接受 display name/裸 ID）、最多 16 项、禁止重复、保留顺序、整个数组以无额外空白的 JSON 编码为 UTF-8 后最多 4096 bytes；缺失 public 值等同空数组，非法形状 400 `invalid_message`，同 `Idempotency-Key` 改变选择或顺序 409 `idempotency_conflict`。BFF 对 Agent 的 Chat 与 Scheduler `POST /v1/runs` 必须始终显式发送该字段，包括 `[]`，不得通过 `trace`、name 或别名补选。当前 IAM tenant/user admission 不变；目标 Agent 在 Run 执行时经 Platform 校验 installed/enabled/current；当前固定 Agent 非空选择会 fail closed，reader 尚未接入，而 BFF public 已发布本人 ACTIVE 读回**不证明可执行**。正式 Agent 2.0.0 来源 pin 与生成 drift 已接入；真实双边测试仍由 Root 在隔离组合验收。本人发布后不自动可用；用户须显式安装/启用。该裁决不构成基础无 Skill Chat wire 的前置条件。

## 当前 Platform projection public read

唯一机器契约 `contract/openapi/v1/openapi.yaml` 的 `GET /v1/skills`、`/v1/skills/{skill_id}`、`/v1/skills/pool`、`/v1/skills/catalog`、`/v1/mcp/servers` 已按 Platform HTTP 3.1.0 运行切换。成功严格 `{data}` 且 `x-request-id`、`Cache-Control: no-store`；list 保留 owner `source_ref`、十进制 `revision`、`next_cursor`，MCP 保留六个 owner-native 字段。by-ID 只接 canonical `skill_id`，当前 IAM user/tenant 可见的 PERSONAL/ACTIVE 未安装 Skill 也可读，其余统一 404。错误只含 `{error:{code,message,retryable}}`；先当前 IAM admission，再用独立 projection workload token 调 Platform。旧四 GET 的 `{data,meta}` 和 Capability 2.0.0 客户端已删除。Web 同源消费与 Root 真组合验收仍待后续；下方“未激活候选”是历史门记录。


## 历史快照：`GET /v1/skills/{skill_id}` 未激活候选（已由上文替代）

canonical OpenAPI 现声明唯一 `getPublishedPersonalSkill` public read candidate。输入只有 canonical `skill_id` path；无 query、body 或幂等键。IAM-admitted Product tenant/user 是唯一身份来源；本人 PERSONAL/ACTIVE 且未安装也可读，非本人、跨 tenant、非 PERSONAL、非 ACTIVE 与缺失统一 404。成功严格为 `{data:{skill_id,source_ref,revision,status,name,summary,tags}}`，`status=active`、`source_ref=skill:<skill_id>` 形状、revision 为正十进制字符串；错误严格 `{error}`。状态集合精确为 200/400/401/403/404/429/502/503，所有出口要求 `x-request-id` 与 `Cache-Control: no-store`，429 可带有界 `Retry-After`。本片不激活 route。

现有 `listSkills` 机器合同仍为 legacy `{data,meta}` 且丢 `source_ref/revision`，本片不改变它。下一运行 cutover 与旧 Skills/Pool/Catalog/MCP 四 GET 的 Platform HTTP 3.1.0 迁移必须同提交完成，并删除旧 credential/source selector/generated。MCP 只发布 owner-native `server_id/provider_key/server_identity/transport/declaration_digest/status` 并同步 Web、移除当前实际 503 的旧控件；旧伪造 revision/url/allowed_tools/secret_ref 映射没有兼容期。


## W3 Publish public 默认关闭运行候选（2026-09-29）

唯一 OpenAPI 的 `publishSkill` 现有同路径具名 BFF route，仍固定 inactive owner v4/3.0.0 且产品未激活；当前 IAM/fixed user+tenant 每次含 replay 先于 Platform，原始 body 恰零字节、单个 Idempotency-Key，内部固定 PERSONAL(1)。owner 8 向量投影、严格 200 `{data}`、状态专属 `{error}`、有界 request ID/no-store 已由直接 HTTP/contract 门覆盖；`Aborted` 只在 metadata `publish_snapshot_conflict` 时为 412，其余为 409，不解析 message。BFF 不持有 receipt/SQL/Storage，真 owner/IAM 组合及激活另门。下节为文档门历史状态。

## W3 Publish public 机器候选（2026-09-29；尚无运行路由）

唯一 public OpenAPI 新增 user-only `POST /v1/skills/{skill_id}/publish`，operationId `publishSkill`、permission `product.skill.publish`、单个 1–128 可打印 `Idempotency-Key` 必填；owner `263a28f` v4 仍 inactive，BFF 本片**不接 Publish runtime route**、产品未激活。机器扩展 `x-kokoro-empty-body: required` 且无 `requestBody` 明确原始请求体必须**恰为零字节**，并非 `{}`、`null`、空白或忽略输入；`x-kokoro-fixed-visibility: personal` 固定后续内部 owner 入参，任何 public visibility/asset/hash/manifest/tenant/owner 均不接收。未来 BFF 当次 IAM user/fixed tenant admission 后固定 owner `SKILL_SCOPE_KIND_PERSONAL(1)`，不把 legacy W1E visibility 规划当现行 body。owner v4 `command_digest_version=3.0.0` 的 8 条 JCS 向量绑定 typed SkillId、受信 Product user/user context 和 visibility=1，命令 ID 绑定 operation+tenant/user/skill/key；request ID/command identity 不参与 digest。

200 strict `{data:{source_ref,revision,status:"active",event_id,replayed}}`，`source_ref=skill:<SkillId>`、revision 为正 uint64 十进制字符串、event_id 为 UUID；不含 Skill 包/Storage asset/URL/manifest 或 legacy meta。同键成功 replay 必在当次 IAM、current owner/validated 包和 fresh Storage CLEAN/健康后返回原 event_id，另键对 active 拒绝；unknown ACK 同键重新准入后交 owner receipt，BFF 无 receipt/outbox。Platform 唯一做 draft→active CAS、持久 receipt 与 `skill.published` outbox，不把 validated/CLEAN 冒称 active。每个 200/错误出口有有界 `x-request-id` 与 `Cache-Control:no-store`。状态专属 strict `{error:{code,message,retryable}}`：400 非零体/无效键，401 session missing/invalid，403 service/session/tenant forbidden，404 不可见 Skill，409 幂等冲突或命令进行中，412 visibility/current draft/validated/scan/snapshot 前置失败，413 超限非零体，429 IAM/Platform 限流且 Retry-After 可选有界，502 owner 非法响应，503 tenant 未配置/IAM、Platform 或 Storage 不可判定；不依 message 猜分支。正式 runtime、Root 真组合、Web 和激活另门；本接口无分页，公开 breaking 变更须新版本审查。下方 W1E Publish “visibility” 属废止历史规划。

## W3 Validate runtime 当前契约（2026-09-29；public 未激活）

唯一 OpenAPI `validateSkillDraft` 的 strict request/200/error wire 不变，现已接默认关闭的 BFF 具名 POST route，与 CreateDraft/Get/Begin/Complete 共用候选 flag；Platform v4 仍 inactive，产品未发布。每次包括同键重放先 current IAM user/fixed tenant，再由独立 catalog workload 调 Platform；body 仅 `attempt_id` 不受信选择符，命令身份绑定 operation+可信 tenant/user/skill/key，固定 owner digest 3.0.0 JCS/8 向量。Platform current Skill/attempt、Storage fresh CLEAN/ZIP V1 和 receipt 是权威；BFF 不保存包事实/receipt，也不调用 Storage。200 仅当 owner skill/series/valid=true/lowercase digest/ZIP manifest/replayed 全核后发 strict `{data}`；错误依状态专属 `{error}`，成功/错误均有有界 `x-request-id` 与 no-store。旧/感染/未完成/坏 ZIP 由 owner 前置失败映射 412；其中 owner `Aborted` 仅在稳定 metadata `x-kokoro-error-code=package_attempt_conflict` 时映射 412，其余 `Aborted` 保持 command-in-progress 409，不从 message 猜测。坏 owner 502，未知 ACK 使用同键重新 IAM/owner；不走旧 Capability。Root 真 owner 组合、Publish public、Web 与激活另门；下节“无运行路由”为文档门历史基线。

## W3 Validate public 机器候选（2026-09-29；尚无运行路由）

唯一 public OpenAPI 增 user-only `POST /v1/skills/{skill_id}/validate`，operationId `validateSkillDraft`、permission `product.skill.validate_draft`、单个 1–128 可打印 `Idempotency-Key` 必填。BFF 当前没有 Validate route；owner `263a28f` v4 inactive、产品未激活。strict JSON body **必须仅有 `attempt_id`**（非空、owner typed ID ≤191 字符），对应 owner v4 Proto tag 7；下方历史“Validate 无 body”已被该机器事实替代。Get/Complete 返回当前 attempt ID 只帮助客户端选择，Platform 仍按 current tenant/user/Skill/attempt、Storage 已完成绑定与 fresh CLEAN/ZIP V1 重新判定；不接受 asset_id、content_digest/size、manifest、tenant/owner 或 URL 自报。

每次含同键 replay 均先 current IAM session/fixed tenant/user，再经 BFF catalog workload 调 Platform；稳定 command ID 绑定 operation+可信 tenant/user+skill+key，owner v4 command digest **仍为 3.0.0** 且 JCS/8 向量绑定 attempt_id。200 strict `{data:{skill_id,series_id,valid:true,content_digest,manifest_identity,replayed}}`；content_digest 为小写 64hex，ZIP V1 manifest_identity 为 `zip-v1:sha256:<64hex>`，无 asset/scan/签名/legacy meta；valid=false 不伪装成功。每个出口 `x-request-id` ≤128、`Cache-Control:no-store`。错误 strict `{error:{code,message,retryable}}`，分状态收窄：400 invalid request/key，401 session missing/invalid，403 service/session/tenant forbidden，404 不可见 Skill，409 幂等冲突/command in progress，412 stale attempt/非 draft/包未完成或扫描、ZIP/manifest 不合格，413 body 过大，429 IAM/Platform 限流且 Retry-After 可选有界，502 owner 非法响应，503 tenant 未配置/IAM、Platform 或 Storage 不可判定。未知 ACK 使用同键重新 IAM/owner，不存 BFF receipt；Validate 不等于 Publish，发布另切片。

## W3 Complete runtime 当前契约（2026-09-29；public 未激活）

唯一 OpenAPI `completeSkillPackageUpload` 的 strict request/200/error wire 不变，现已接默认关闭的 BFF 具名 POST route，与 CreateDraft/Get/Begin 共用 loopback 候选 flag；Platform `263a28f` v4 仍 inactive，产品未发布。每次同键重放先 IAM current user/fixed tenant，再调 Platform owner；header-only `x-request-id` 与 `Cache-Control:no-store` 在成功、拒绝和默认关闭出口一致。四字段仅不受信描述符回显，owner 当前 Skill/Storage 是唯一判定；BFF 完整核验 owner asset_id 但 200 不公开，CLEAN 仍只等于 uploaded 非 validated。命令 ID/digest 由固定 3.0.0 JCS/11 owner 向量验证；旧 Capability 和通用 BFF receipt 不承接此命令。下节“无 Complete route”是文档门历史基线；真 owner Complete、浏览器链及正式激活待 Root/Web 后续门。

## W3 Complete public 机器候选（2026-09-29；尚无运行路由）

唯一 public OpenAPI 新增 user-only `POST /v1/skills/{skill_id}/package-upload/complete`，operationId `completeSkillPackageUpload`、permission `product.skill.complete_package_upload`、必填单个 1–128 可打印 `Idempotency-Key`。BFF 当前有默认关闭的 CreateDraft/Get/Begin 运行候选，**没有 Complete route**；Platform `263a28f` v4 manifest 仍 inactive，正式 Product API 未激活。Body strict 仅 `attempt_id`、`upload_id`（非空 owner typed ID，最多 191 字符）、小写 64hex `content_sha256`、整数 `size_bytes=1..33554432`，四者是 Begin 描述符的不受信回显，不能替代 current Skill/Storage 匹配；不接受 asset_id、scan_state、tenant/owner、URL 或传输头。

每次含同键 replay 均先 IAM current user session/fixed tenant/subject，BFF 代言 user owner 后才触 Platform。稳定 command identity 按 operation+可信 tenant/user+skill_id+key；owner v4 command digest version `3.0.0` 的 JCS/11 向量覆盖完整四字段与 Product context，排除 request ID；BFF 不存 receipt。200 strict `{data:{skill_id,attempt_id,attempt_epoch,upload_id,phase:"uploaded",replayed,content_sha256,scan_state}}`，scan_state 仅 `clean|pending|unknown`，epoch 为正 uint64 decimal string；无 `asset_id`、签名 URL 或 `meta`。内部 owner asset_id 仍需未来 runtime 验证。CLEAN 只代表扫描当前干净，不代表 ZIP validated。所有成功/错误均有有界 `x-request-id` 和 `Cache-Control:no-store`。400 invalid request/key，401 session missing/invalid，403 service/session/tenant forbidden，404 不可见 Skill，409 幂等冲突/command in progress，412 infected/旧或 aborted attempt/非 draft/当前状态不符，413 body 超限，429 IAM/Platform rate limit 且 Retry-After 仅可选有界，502 owner 非法响应，503 tenant 未配置/IAM 或 Platform 依赖不可判定；各状态的 error.code 由独立 response component 收窄，错误体 strict `{error:{code,message,retryable}}`。

Browser 完成 Begin 的短期签名 PUT 后才发送 Complete；签名 PUT 的批准 origin、method、headers、expiry 与 Chromium CORS 属 Begin/浏览器边界，不由 Complete 接受 URL。Get 不公开 hash/size，刷新只能保留原描述符或重选原文件重算并确认完全一致；若做不到，显式新 Begin attempt 替换，不缓存 BFF 文件摘要。Root 真 owner 组合的 Begin 证据不等于本 public Complete 已验；代码、真 IAM/Storage、Web Chromium 与产品激活仍待后续片。

## W3 Begin runtime 当前契约（2026-09-29；public 未激活）

已批准的唯一 OpenAPI `beginSkillPackageUpload` 候选现接到 BFF 默认关闭运行路由，owner v4 inactive 与文档门字段/状态码不变。POST 每次先 current IAM user/固定 tenant，再以独立 catalog workload token 调 Platform；单个可打印 Idempotency-Key 与 strict JSON 文件事实形成稳定 command ID 和 owner 3.0.0 JCS digest，缺失/null replace 不等价。UTF-8 文件名按字节 ≤255 校验（255 接受、256 拒绝）。201 只含严格 `{data}` 的当前 attempt/epoch/upload 与原样短期 PUT transfer reference；失败按本机契约各状态专属 `{error}`，成功/错误均 `x-request-id`/no-store。同键 replay 不走 BFF receipt，仍由 Platform 当前 owner/attempt/Storage pending 决定是否重签；BFF 拒不受批准 origin、非 PUT/签名头/expiry 的 owner response 为 502。Begin 缺 object origin 只返回 503，不影响 CreateDraft/Get。后续 Root 真组合及浏览器 CORS/PUT 验收前不称 public 激活；下方文档门“无运行路由”为历史基线。

## W3 Begin public 候选契约（2026-09-29；无运行路由）

当前 BFF 已 pin Platform owner `263a28f1e55745bd1829a61f68228d775751adbc` 完整 inactive v4 artifact/provenance，aggregate `902f8f2c2fbeb95a441820c1cf16b0a9c793eadac7106f9fcd5e41e3878b7f79`；CreateDraft 与 Get 为默认关闭运行候选，**Begin 仅新增唯一 public OpenAPI 机器候选**，没有 BFF Connect 调用或已激活产品。`POST /v1/skills/{skill_id}/package-upload`、`beginSkillPackageUpload`、`product.skill.begin_package_upload`、`x-kokoro-idempotency: required`；路径复用 Get 的 typed Skill ID。单个有效 Idempotency-Key 必填，Content-Type 固定 JSON；strict body 仅 `filename`（非空、非 `.`/`..`、无分隔/控制、无首尾空白、UTF-8≤255 bytes）、`mime_type=application/zip`、整数 `size_bytes=1..33554432`、小写 64 hex `content_sha256`、可选非空 typed `replaces_attempt_id`（缺失与 null 不等价）。不从公开输入接收 tenant/owner/subject/command、upload/asset 或 URL。

每次包括同键 replay 先 current IAM session/fixed tenant/user，再以 BFF catalog workload token 和受信 Product `user/user` context 调 owner Begin。BFF 稳定 command ID 以 operation+tenant+user+skill ID+key 派生；owner v4 机器 artifact 的 **command digest version 仍为 3.0.0**，按其 schema/JCS/向量独立投影，不能按 artifact 4.0.0 猜测 digest。Platform current owner/draft/attempt 与 receipt 是唯一写入事实；首次 `none` 不带 replace，恢复须新键+当前 attempt ID 显式替换；同键 replay 仅 current pending/Storage pending 才能重签。BFF generic receipt 不用于此命令，不保存或缓存 signed reference。201 strict `{data:{skill_id,attempt_id,attempt_epoch,upload_id,transfer_reference,replayed}}`，epoch 是完整 uint64 十进制字符串；`transfer_reference` 严格含 `url`、固定 `PUT` method、当前仅 `content-type: application/zip` 的完整 required_headers、RFC3339 `expires_at`。每个成功/错误均 `x-request-id` header、`Cache-Control: no-store`，无 `meta`。未来 BFF runtime 必须做批准 public origin/HTTPS 或隔离 loopback HTTP/userinfo/fragment/redirect、签名 header 和未来有界 expiry 的 fail-closed 校验；OpenAPI `format: uri` 本身不证明部署 origin 已获准。

状态专属错误组件：400 `invalid_skill_request|idempotency_key_required|invalid_idempotency_key`，401 `session_authentication_required|session_invalid`，403 `service_auth_failed|session_forbidden|product_tenant_forbidden`，404 `skill_not_found`（跨 tenant/owner 不可见统一掩蔽），409 `skill_idempotency_conflict|skill_command_in_progress`，412 `skill_precondition_failed`（旧 replace/非 draft/非 pending replay），413 `request_body_too_large`，429 `session_rate_limited|skill_rate_limited` 且 Retry-After 仅可选有界值，502 `skill_response_invalid`，503 `product_tenant_not_configured|iam_admission_unavailable|skill_dependency_unavailable`。错误体只 `{error:{code,message,retryable}}`，不返回内部 reason/Storage 凭据。浏览器在 Web 同源控制面之后只向批准 ObjectStore public origin 直 PUT 原字节，`credentials:omit`/`redirect:error`/签名头原样；正式 CORS/preflight/PUT 与 Complete 是后续浏览器/运行片，不因本机器候选宣称可用。

## W3 Get runtime 当前契约（2026-09-29；public 仍未激活）

唯一 public `GET /v1/skills/{skill_id}/package-upload` OpenAPI 候选已接到 BFF 默认关闭的真实 route；与 CreateDraft 共用 `KOKORO_SKILL_DRAFT_CANDIDATE_ENABLED`，只供 loopback 隔离验证，Platform v4 仍 `inactive/routable=false`。BFF 精确消费 owner `263a28f1e55745bd1829a61f68228d775751adbc` 两份 Proto 与完整 v4 aggregate `902f8f2c2fbeb95a441820c1cf16b0a9c793eadac7106f9fcd5e41e3878b7f79`；`readBinding.version=1.0.0`、`bindingVersion=3.0.0`，Get 不引入 command/proof。旧 v3 vendor 删除，CreateDraft 保留 owner v4 中不变的 v3 command digest/vector，不有旧服务 fallback。

每次 GET 包括重复读都先 current IAM user session/fixed tenant，再用 catalog workload token 调 `SkillCatalogService/GetSkillPackageUpload`；公开不能输入 owner/subject/tenant，不能把 bearer 传 Platform。200 strict `{data}` 中 epoch 为 uint64 十进制字符串、phase/ID presence 按本仓 OpenAPI `oneOf`；错误 strict `{error}` 按状态专属 code，429 的 Retry-After 可选有界，所有出口 `x-request-id` header/no-store。404 隐去其他 tenant/user，412 非 draft，502 拒非法 owner response；GET 不发 Storage 签名、不持久化 receipt。Root `4300f4fc` 隔离真 IAM/BFF/Platform 组合已验 fresh draft `none` 200、Publish 后 412、同一 session 撤权后 401 且零新增 Platform socket；中间各 package phase 尚未由 BFF public Get 在真 owner 组合逐一采样，公开产品仍未激活。下方 DOC-GATE/W1E 的旧 pin 与“尚无 route”只记录当时状态。

## W3 user-only GetSkillPackageUpload 候选（2026-09-29；尚无 BFF route）

当前 BFF `main caa99d90f57329065eeb0e98168316b2b1874159` 仅有默认关闭的 public CreateDraft 候选，Platform consumer 仍固定旧 owner `5b6eb2c`/inactive v3；旧 Capability 三 Skills GET 不提供包状态。Platform `263a28f` 的正式 Get/Begin/Complete/Validate/Publish 与 inactive v4 已通过 Root 的隔离 owner 组合，但 BFF 尚未消费 v4，owner CLI 不构成用户可调用的 Product API。下方 W1E v3 段落只记录 CreateDraft 切片，不覆盖本节当前事实。

唯一 public OpenAPI 的新增候选是 `GET /v1/skills/{skill_id}/package-upload`，operationId `getSkillPackageUpload`、permission `product.skill.get_package_upload`、idempotency `none`。路径只接受 opaque typed Skill ID；无 query、request body 或 `Idempotency-Key`。BFF 将来每次先验当前 IAM Product session/tenant/user，只代言 `user` owner，再由 Platform current tenant/owner/draft gate 返回最新状态；不以浏览器自报身份、旧请求缓存或 Storage 服务密钥代替授权。200 为 strict `{data}`，字段仅 `skill_id`、十进制字符串 `attempt_epoch`、`phase=none|intent|upload_pending|uploaded|validated|aborted`、可选 `attempt_id`/`upload_id`；`none` 的 epoch 为 `"0"` 且两个 ID 缺席，其余阶段约束见技术设计。没有签名、Asset、hash 或扫描推断；刷新或丢失 Begin ACK 只能用此状态决定下一步，不把 GET 变成重签 PUT。成功和错误均由 `x-request-id` header 表示请求关联并 `Cache-Control: no-store`，无 legacy `meta.request_id`。

候选错误由 OpenAPI 固定：400 严格路径/query/body/header 拒绝；401 仅为 session 未提供/无效，403 包含 service secret 失败、session 禁止或 tenant 不符；404 为不存在、跨 tenant 或不可见 Skill；412 为非 draft/当前状态不满足 Get；429 为限流，`Retry-After` 仅在上游提供合法有界值时转发，缺失/非法时仍可返回 429；502 为 owner 返回非法；503 包含 Product tenant 未配置及 IAM/Platform 依赖不可判定。该分组与既有 `user-admission.ts`/`session-admission.client.ts` 的实际状态映射一致。各 HTTP status 的独立 response component 以 `allOf` 收窄允许的 `error.code`，404 不能承载 502 的 `skill_response_invalid`；错误体 strict `{error:{code,message,retryable}}`，不复制上游 token、SQL、签名或内部 reason 文案。`SkillPackageUploadState.oneOf` 机器约束各 phase 的 epoch/ID presence，正 epoch 限于 Proto uint64 十进制范围且 ID 遵循 owner 191 字符格式；这不是仅文字说明。GET 不使用 BFF generic mutation receipt，也不新增 command digest；Platform v4 read binding/Proto 的精确 commit、原字节 digest 和 generated client 在**下一代码片** pin。本轮 OpenAPI 是未激活候选，BFF 运行时仍无 Get route；`inactive/routable=false` 不因这份 public 声明改变。后续 Begin/Complete/Validate/Publish 的各自路径/公开字段及浏览器 signed PUT/CORS 边界另过设计与机器契约门，不复用旧 name/revisions 路径冒充。

## W1E-BFF-USER-SKILL-DRAFT v3 契约门（2026-09-29；public 未发布）

当前 BFF `2a95da2410fd89c300dc18064867ee66617549e2` 已精确 pin Platform
`5b6eb2c1532b23b9747bc4bf6ac99f69ad453de0` 的两份 `kokoro.platform.v1` Proto 原字节、完整
`platform-execution-operations/3.0.0` artifact/provenance 与 aggregate
`324e749da1bc66c1ff03de74e7299716f798f5f5bb5fa19556033b79fa09ff8d`；consumer 状态仍是
`generated-not-activated`，owner manifest 为 `inactive/routable=false`。唯一 public OpenAPI 已加入
`POST /v1/skills/drafts` 的未激活候选契约；Stage B runtime/credential/Connect handler 已实现但默认关闭，仅完整 loopback 候选配置可供隔离验证，不能据此宣称 public CreateDraft 已激活。v3 的 `skill.create_draft` command schema
严格要求 `command_digest_version`、完整 FQ method、受信 tenant 与 command 中的 owner scope、Product context、
完整 metadata；排除 request ID/command identity/execution proof。旧 v2 digest 不作运行 fallback。
当前 v3 用于离线 consumer 候选/向量校验；inactive/routable=false 是发布标记而非 runtime RPC kill switch。协调激活前本仓不得将下文 public 201 契约发布为可路由能力；Root 可在隔离 sandbox 用候选 route 做真实 IAM→BFF→Platform 201/replay 预激活验证，但该证据不等于公开发布。现有 Capability HTTP 四条 GET 保留为当前机器/运行事实；Storage package/Validate/Publish 另片。

## W2-F2-S9 Chat Delivery 身份契约（2026-09-28；BFF 机器契约已修改，Web 待消费）

代码门前 [`../contract/openapi/v1/openapi.yaml`](../contract/openapi/v1/openapi.yaml) 的 Chat snapshot `Delivery` 仍是必填 `content_hash/path/title/mime/size/run_id/created_at` 的 hash-only 形状，运行时 `deliveries: []`；AG-UI `kokoro.delivery.created` live/replay 已携 Agent 二元 ID/kind，但这不使严格 Web 消费方自动兼容。现 BFF 唯一机器 OpenAPI 已改为：snapshot 每件 Delivery 必有 `conversation_id`、`artifact_id`、`asset_id`、`artifact_kind`、`title`、`mime`、非负安全整数 `size`、`run_id`、UTC `created_at`；`conversation_id` 来自已准入会话，展示值来自已验证 Agent immutable claim，`created_at` 对应交付时间而非 Storage 创建时间。去掉 snapshot `path/content_hash`；旧 hash 不能合成 Artifact ID 或下载路径。现有 AG-UI CUSTOM live/replay 保留完整受信 payload，包括 `tool_call_id/path/title/mime/size/content_hash` 和三 ID/kind；Web 严格解析该完整事件，以事件会话 ID 和 `artifact_id` 归一，snapshot 不虚构 `tool_call_id`，path/hash 不作正式选择器，`asset_id`、hash 或 title 也不替代二元身份。

`ChatSessionDetail.data` 保留最近 100 条 Message 和同一事务的 `event_watermark`，新增最多 100 件、按 `(delivered_at DESC,artifact_id ASC)` 稳定排序的 `deliveries[]` 与必填 `deliveries_has_more: boolean`。后者为 true 只表示本会话还有较早交付，Chat/Canvas 应显示“查看全部作品”；既有本人 `GET /v1/library?kind=artifact` 可用 opaque cursor 逐页查旧件及二元详情/原字节，但不是会话专用 cursor。快照 Message 的 `message_seq` 与交付时间/ID 分别排序，不新增虚假的共同序号。active Conversation/Project owner 准入失败仍按现有 404/403，不新增 IAM 权限或分享资格；Artifact detail/content 仍在点击时向 Storage 核 FINAL+CLEAN，卡片 claim 不作下载授权。BFF OpenAPI/行为/真 PG 提交后 Web 才 pin 精确版本并删正式 hash/旧 Blob 双轨；BFF 机器契约/行为已更新；Web 尚未 pin 或更新，未宣称端到端闭环。 同一 `SessionSnapshotResponse` 也被 service-only Share GET 引用；该路径强制 `deliveries: []`、`deliveries_has_more: false`，不把本人私有作品带入分享。

目标合同门：OpenAPI strict schema 与 generated drift、AG-UI live/replay/snapshot 同一 identity、坏/缺字段拒绝、两件同 hash 不合并、`deliveries_has_more`/GC 后刷新、cursor 后新事件无漏/重、本人/Project/软删负例；Web 后续另验 Canvas metadata/详情/原生下载/取消，首片不把 attachment URL 全量 iframe/blob 加载，内嵌预览另需小件 cap 与 `+1` 有界流。真 IAM→Chromium→BFF→Agent→Storage 链仍为 Root 集成门。

**代码门证据。** 受信 claim、snapshot 映射、OpenAPI strict 字段与 schema 直接 RED→GREEN；Node22 单仓全门和隔离真 PostgreSQL 后续结果以 `docs/CURRENT.md` 为准。

## W2-F2-S8 Artifact `/content` 时限与失败语义（2026-09-28；BFF 单仓已实现）

唯一机器契约仍是 [`../contract/openapi/v1/openapi.yaml`](../contract/openapi/v1/openapi.yaml) 的
`downloadLibraryArtifact`：路径、GET 输入、本人二元授权、`storage.library.read` 分类、200 原字节及
`Content-Type/Length/Disposition`、`Cache-Control:no-store`、`Referrer-Policy:no-referrer`、
`X-Content-Type-Options:nosniff`、`x-request-id` 均不变。本时限调整不增 query、header、身份、角色、
幂等键、状态码或错误码，不改个人 `kind=file` 下载与 Hub 全局 budget。

**起始问题：** BFF 原先一个 120 秒 `AbortSignal` 同时限制取回/校验和出站，即使 Web 精确 Artifact
adapter 有 10 分钟未发头、30 分钟 200 流上限也可能先截断。**当前内部预算：** BFF route 内本人
关联/Storage final+reference 保留现有最多 120 秒信号，准入语义不变；对象取回至完整校验/文件关闭为 7 分钟总、45 秒无落盘进度；
出站为 28 分钟总、25 秒无 response 写入/排空进度。各阶段独立计时、共同响应/请求断开取消；Web 的
10/30 分钟及 30 秒 idle 仍是单独上界，2+7 分钟为未发头阶段留约 1 分钟。预算不是新的公开请求参数、
PostgreSQL 查询或磁盘 syscall 严格硬取消承诺，也不是任何大小对象的传输成功保证。

| 失败点                                                          | HTTP 可观察结果                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 准入、引用、取回/校验在发头前失败                               | 保留现有稳定 JSON error envelope 与 `x-request-id`；不可见仍 404，错误对象/摘要/长度仍 502，依赖不可达或阶段超时仍 `503 storage_unavailable`，名额已满仍 `503 artifact_download_busy`。不得先发部分 200 或把 owner 故障伪装 404。 |
| 200 头已发后客户端断开、BFF 出站总/idle 超时或本地读取/管道失败 | 停止读取并终止响应连接；不再发送 JSON 或另一个状态码，不添加成功尾帧/回执，也不把部分 `Content-Length` 视为完成。客户端须把截断/长度不符当失败；Web 同源 adapter 的长度与完整结束检查仍是独立下游门。                             |
| 正常完成                                                        | 只有已校验文件全量经背压管道结束且响应完成才结束请求并释放 spool；完整原字节与原安全头保持。                                                                                                                                      |

最多两个同时占用的本进程 spool 名额从 ObjectStore GET 前到正常/取消/失败清理后保留，第三个请求在
对象 GET 前返回同一 `503 artifact_download_busy`。未发头时限/取消不得泄露内部 URL、secret 或
临时路径；已发头失败不得伪装下载成功。机器 OpenAPI、Storage Proto、错误码与 Web 契约本次零修改，
直接假钟与慢消费者 HTTP 测试已验证阶段预算、迟到准入 timeout 503、截断及取消释放；底层
`body.cancel()`/`reader.cancel()` 不完成也不阻塞本地清理。Root 独立 Node 22 全门已通过；
Root `f9f5befa` 在本代码片 `b382642` 上已验真 IAM/HTTPS Chromium/Agent/Storage 两件原生下载原字节及他人 404；代表性 1 GiB 限速仍待验。

## W2-F2-S5 Product Artifact 公开契约（2026-09-28；单仓已验，跨仓待验）

**当前机器事实。** 第一片已固定 Agent event-protocol 与 Storage F2 Proto，持久投影
`bff_conversation_artifact`；第二片在唯一 OpenAPI 与 runtime 发布私有 Artifact 列表、
单项和原字节下载。Root 已独立验证 Node22 完整静态/默认门与隔离真 PostgreSQL/Redis
integration 44/44、schema 6/6；真 Storage/ObjectStore 与三仓组合仍待验，
share-bound Artifact operation 尚无机器入口。下表为当前 Product wire，单仓通过不冒充用户可见闭环。

| 目标 public wire                                                    | 明确语义                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /v1/library?kind=artifact`（保留 `listLibrary`）               | `kind` 仍必填，仅允许单个 `file` 或 `artifact`；省略、重复、未知及 `all` 均 `400 invalid_library_kind`，不改变 `kind=file` 的个人文件 200。`limit` 缺省 50、范围 1–100；单个 opaque `cursor` 长度 1–4096。每页重新 service+Bearer/IAM admission、绑定 tenant/subject/kind/limit/位置；不是权限凭据或跨更新快照。                                                                                                                                                                                                                                                         |
| Artifact 200 分支                                                   | 沿现有 `{data:{items,next_cursor},meta:{request_id}}` 运行 envelope（`x-request-id` 仍必带；header-only 目标是既有全仓偏差，另切裁决）。`items[]` 是判别 `kind:"artifact"`，含 `conversation_id`、`artifact_id`、`artifact_kind` 八值、`title`、`filename`、`mime_type`、十进制字符串 `size_bytes`、小写 64hex `content_sha256`、`source_run_id`、UTC `delivered_at`；`asset_id` 可作为已校验 owner ID 输出但不作为单项路径或权限。无 hash-only selector、对象 key、临时 URL 或个人文件冒名。空页为 `[]`/`null`；Storage 最终状态变化可能造成稀疏页，不伪装为 snapshot。 |
| `GET /v1/library/artifacts/{conversation_id}/{artifact_id}`         | 固定 `operationId: getLibraryArtifact`，现有 `storage.library.read` 分类 metadata 不变，不新增 IAM 权限设计。每次按二元组先查 BFF 关联及本人 active Conversation，再以受信 tenant+conversation scope 调 Storage `GetFinalArtifact`；返回同一 Artifact item。单知 artifact ID、相同 digest、其他用户会话或同团队均不开放。                                                                                                                                                                                                                                                |
| `GET /v1/library/artifacts/{conversation_id}/{artifact_id}/content` | 固定 `operationId: downloadLibraryArtifact`，200 为经最终 metadata/短期引用/对象字节校验后的原二进制，不套 JSON、不 302、不暴露签名 URL。响应 `Content-Type/Length/Disposition`、`Cache-Control:no-store`、`Referrer-Policy:no-referrer`、`X-Content-Type-Options:nosniff`、`x-request-id`；在发头前完成受界限字节长度与 SHA-256 核验，不出部分 200。GET 不要求 public 幂等键；Storage 签发所需 command receipt 属 Storage，不写 BFF Product receipt。                                                                                                                   |
| 显式分享                                                            | 首个 S5 代码切片只发布本人私有 Artifact Library，不混入别人分享。后续独立分享切片只用专门 `/v1/shared/{shareId}/artifacts/{artifactId}` 与 `/content`，沿既有 Share service-only 边界实时核验 share 的 tenant/conversation、未撤销/未过期、active Conversation 与关联；不把 share ID 当一般 Library cursor 或本人 ACL 替代，不从现有 `GET /v1/shared/{shareId}` 快照隐式附加下载资格。                                                                                                                                                                                   |
| 错误                                                                | 非法 selector/query/cursor 为稳定 400；同固定租户他人 Conversation、错二元组、未关联、Storage 不可见/非 FINAL/CLEAN 统一 404，不泄露存在性。固定 Product tenant 外的受信 IAM 身份仍在既有 admission 先返回 `403 product_tenant_forbidden`，零 BFF SQL/Storage 调用；认证/准入其余 401/403/429/503 保持。Storage 超时/不可达 503，owner 响应、引用或 bytes 不可信 502；列表 owner 故障不是空页。错误不含 owner 原文、内部 URL/secret。                                                                                                                                    |

`LibraryListResponse.data` 在页级 `oneOf`：空页、至少一项且全为 `kind=file`、至少一项且
全为 `kind=artifact` 三者互斥；不允许同页混排，`next_cursor` 在空页也可非空以继续跳过
当前不可见的关联。Artifact `/content` 每进程最多同时保留两个下载 spool 名额；第三个请求在
ObjectStore GET 前返回稳定 `503 artifact_download_busy`，请求完成、失败或客户端断开后释放。
这是进程内背压而非新增跨进程租户配额或持久权限事实。

上游固定源为 Agent `486adb1539dd8a06ca90684e66f91be031aa70cf` event-protocol
aggregate `cae30a40d712bce39ef33ef2dc857af4f5b69c6afd1956fda065ec77379ae02e`；
Storage `d5cfc442c675e32363ae767f5ec662a9e0d9eaea` 的 `kokoro.storage.v2` Proto
aggregate `8317e644d45c8db310b44f114afa22892a6a40d6ee7d0c1c4a37a8203e79f427`。
Agent owner `delivery.created`/Chat `delivery` 的 `artifact_id`、`asset_id`、`artifact_kind` 与
Storage owner `GetFinalArtifact`/`GetFinalArtifactDownloadReference` 仅在本仓 consumer 边界严格解析；
不得复制为第二份可编辑机器契约。Storage `ListFinalArtifacts` 只按单 conversation scope，不能直接
提供跨会话 Product 页。public `kind=all` 需文件+作品双源稳定复合 cursor，另片决定，不做旧路径 alias。

## W2-BFF-PERSONAL-DOWNLOAD：个人文件字节契约代码片（2026-09-28；待 Root 集成验收）

**当前工作树机器事实**：[`../contract/openapi/v1/openapi.yaml`](../contract/openapi/v1/openapi.yaml) 已加入
`GET /v1/library/files/{asset_id}/content`（`downloadLibraryFile`）及 frozen operation baseline，
直接合同/行为测试通过，尚待 Root 独立验收和提交。下表为本代码片 wire 与语义，不代表真 Storage/浏览器已验。
Storage consumer 已固定 v2 `GetAsset` 与 `GetDownloadReference`；后者不限定
`upload_purpose=ASSET`，因此 Product 必须先做本人 scope 的 GetAsset purpose/CLEAN 校验，并核对签发结果。

| 面            | 目标 public wire 与语义                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 路由/metadata | `GET /v1/library/files/{asset_id}/content`，固定 `operationId: downloadLibraryFile`、`x-kokoro-owner: kokoro-bff`、`x-kokoro-visibility: public`、`x-kokoro-stability: beta`、`x-kokoro-idempotency: none`、`x-kokoro-permission: storage.library.read`。它是 BFF 受控字节转发，不返回 302、预签 URL 或 JSON 文件内容。                                                                                                                                                                                          |
| 输入          | 单个合法 `asset_id` 路径段；无 query/body，不接受客户端 SHA、scope、tenant、subject、Storage URL 或 `Idempotency-Key` 来扩权。每次 service+Bearer→在线 IAM admission；可信 tenant/subject 唯一决定 personal scope。                                                                                                                                                                                                                                                                                              |
| 200           | OpenAPI 以 `*/*` + `format: binary` 描述任意经过校验的 Asset MIME；实际 `Content-Type` 取已核对的 Asset MIME，完整缓冲并校验 SHA-256/长度后才发送。`Content-Length` 为实际字节数，`Content-Disposition: attachment` 采用安全 ASCII fallback + RFC 5987 `filename*`、过滤控制字符/路径分隔符；`Cache-Control: no-store`、`Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff`、`x-request-id`。不透传 ObjectStore Cookie、ETag、Location、签名 query、缓存或安全 header。                            |
| Owner 前置    | 同一受信 personal scope 的 `GetAsset(asset_id)` 返回相同 ID、`upload_purpose=ASSET`、CLEAN、合法摘要/MIME/文件名及 `size_bytes≤1,048,576`；再以该摘要调用 `GetDownloadReference`，逐项核对 ID/摘要/大小/MIME/CLEAN。仅接受未过期 GET、精确配置 ObjectStore origin、无危险 required headers 的签名引用；不向 public 返回引用。                                                                                                                                                                                    |
| 错误          | 非法 selector/多余 query/body 为 `400 invalid_library_file`；本人不可见或不存在、非本人/租户资源及非普通 ASSET/非 CLEAN 统一 `404 library_file_not_found`，避免探测；依赖配置缺失、超时或不可达为 `503 storage_unavailable`；owner 响应、签名引用、对象状态/字节长度/摘要不可信为 `502 storage_response_invalid`。保留现有 Product admission 401/403/429/503。错误是现有 `{error:{code,message,retryable,...}}` JSON envelope，`x-request-id` 必带，不含内部 URL/凭据/owner 原文；失败前不发送二进制或部分 200。 |
| 幂等/缓存     | 安全 GET 不要求 public 幂等键，不写 BFF receipt、缓存或 SQL。Storage Proto 的 `GetDownloadReference` 要求内部 `CommandIdentity`，每次 HTTP GET 新建并交由 Storage owner 处理其命令 receipt；不得把签名 URL 写入本仓终态回执或列表。                                                                                                                                                                                                                                                                              |

本工作树已进入唯一 OpenAPI/runtime 并通过直接合同测试；Root 仍须复验真对象字节与权限负例，
Web 同源 adapter 只能按该二进制契约窄透传，浏览器不得跳转内部 Storage origin。现有 BFF JSON 错误
`meta.request_id` 偏差依旧属于全仓 envelope 裁决，本片不在成功二进制中增设 JSON envelope。

## W2-BFF-LIBRARY-PERSONAL-UPLOAD-CODE：个人文件写入契约（代码片；待 Root 集成验收）

设计基线 BFF main `a67ae2d06b52202f349305ae3723f6e296c087a1` 只有
`GET /v1/library?kind=file`。本代码片已在唯一 public OpenAPI 和 runtime 增加
`POST /v1/library/files`（`operationId: uploadLibraryFile`），而不是用无 kind 的
`POST /v1/library` 隐含文件、复用 `/v1/projects/{projectId}/resources`，或接 Storage 内部 HTTP。
`x-kokoro-permission: storage.library.write` 只作为 BFF operation 分类 metadata，不由请求自报 grant，
也不引入本片 IAM 角色/权限模型改造。

| 面   | 当前代码片 wire 与语义                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 请求 | `POST /v1/library/files`，无 query；`multipart/form-data` 恰好一个名为 `files` 的二进制 part，无额外 form 字段、tenant、subject、scope 或 project ID；完整 body ≤1,048,576 bytes。必填唯一原始 `Idempotency-Key`，长度 1–191、可打印 ASCII、无逗号或前后 OWS；同键重试必须是同一文件语义。                                                                                                                                                                                                                        |
| 成功 | 200，仅 Storage `upload_purpose=ASSET` 且 `scan_state=CLEAN`、本人 personal scope 及 BFF 终态 receipt 持久成功后返回。沿当前 BFF envelope：`{data:{file:{kind:"file",asset_id,filename,mime_type,size_bytes,content_sha256,scan_state:"clean"}},meta:{request_id}}`；`size_bytes` 是十进制字符串。响应带 `x-request-id`、`Cache-Control:no-store`。不返回 internal `upload_id`、ObjectStore key/PUT reference、下载 URL、Artifact/session 字段或伪造的 `created_at`（GetAsset 无此字段；列表 GET 再取权威时间）。 |
| 幂等 | public 终态 receipt 的 scope 包含受信 tenant、subject、方法、精确 path 与 key；独立 `personal-file-upload:v1 + tenant + subject + key` checkpoint 只保存原 Storage upload ID 和文件指纹。指纹覆盖 filename、MIME、字节长度、SHA-256；相同键/同指纹重放同一已持久的最终状态，同键/不同指纹 409；处理中 409。每次 replay 前仍要在线 IAM admission。503/未知 Complete 不写假成功，客户端用同键同文件重试。                                                                                                           |
| 错误 | 400 `invalid_library_file`/`invalid_idempotency_key`，413 `request_body_too_large`，409 `idempotency_conflict`/`idempotency_in_progress`/`file_upload_aborted`，422 `library_file_infected`（终态），502 `storage_response_invalid`，503 `library_file_scan_pending`/`storage_unavailable`/`file_checkpoint_unavailable`（可同键恢复）；保留普通 Product 401/403/429/503 admission。错误 message 不包含 owner 原文、secret 或临时引用，不把依赖故障伪装为空列表。                                                 |

Storage v2 Connect 精确使用已固定 owner 的 CreateUpload、GetUploadStatus、CompleteUpload、GetAsset；
任一创建/短期引用/PUT/checkpoint/Complete 的未知或可重试失败均不内联 Abort，保留同键稳定 Create 与原 upload 恢复；metadata 中 `service=web-bff, tenant=当次 IAM tenant, subject=当次 IAM subject,
scope_kind=personal, scope_id=subject`，CreateUpload purpose 固定 ASSET。请求 headers/body/filename/hash/receipt
都不是访问其他 subject 的授权依据。Complete 应答丢失后先按同一 upload ID 查询状态并复核 GetAsset，不能换键/新建
Upload；pending 才可用同 Create command 刷新短期 PUT 引用。最终 200 前验证 Storage asset 的
asset ID、文件名、MIME、大小、SHA、purpose 和 CLEAN 状态。

现有 BFF success/error JSON 仍带 `meta.request_id`，与 Root API 手册“仅 header 承载 request ID”目标有
既有全仓偏差；本片按当前 BFF 机器契约保持同形状并显式加 `x-request-id`，不单独发明第二种 envelope。
机器 OpenAPI、直接 contract tests 与 runtime 已在本代码片同片修改；这不是 Root 集成验收、真实 Storage/PG/MinIO/ClamAV 组合或 Web 用户流程通过的证据。

## W2-LIBRARY-BFF-FILE：个人文件公开契约（2026-09-28，待 Root 集成验收）

当前机器事实为 [`../contract/openapi/v1/openapi.yaml`](../contract/openapi/v1/openapi.yaml) 的 `GET /v1/library`、
`listLibrary` 与 `storage.library.read` metadata，已发布必填 `kind=file` 和个人文件 200。BFF Storage manifest 固定
`2d87e26`/combined SHA-256 `11edffcdd668c59ef07c7b4c47d44b38dd95c2b8aee5a4d0c6475fba58850713`。
Root 已复验列表单仓门；上方个人上传代码片尚待 Root 集成验收，下载、Artifact 与 Web 用户流程不由此声明完成。

路径比较：**采用**原 `GET /v1/library`/`listLibrary`，将 `kind=file` 设为必填；**淘汰**另起
`/v1/library/files` 并使旧 path/operationId 语义悬空，亦不建 alias。缺失、空值、重复或未知 kind 都是
`400 invalid_library_kind`，无参不会静默改为个人文件。首片仅支持 file；Agent Artifact 与 all 分别在其
owner 链/双源复合 cursor 验收后发布，不能提前给不存在的成功样本。

| 当前 public wire | 语义                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 请求             | `GET /v1/library?kind=file&limit=50&cursor=...`；只允许这三个单值 query、无 body。`limit` 省略为 50、范围 1–100；`cursor` 可省略，存在时长度 1–4096，仅原样回传，不作为授权。                                                                                                                                                        |
| 200              | `{data:{items:[...],next_cursor:string\|null},meta:{request_id}}`；空列表 `items:[]`/`next_cursor:null`。页最大 100，`Cache-Control:no-store`、`x-request-id`。                                                                                                                                                                      |
| `items[]` 首片   | 严格对象：`kind:"file"`、`asset_id`、`filename`、`mime_type`、十进制字符串 `size_bytes`、小写 64hex `content_sha256`、`scan_state:"clean"`、RFC3339 UTC `created_at`。Storage `origin=generated` 也不将普通 ASSET 变成 Artifact。没有上传 ID、对象 key、短期 URL、`artifact_id`、`session_id`。                                      |
| 分页             | Storage personal cursor kind=`personal_library`，绑定受信 tenant、scope、caller、subject、limit；SQL 先筛 CLEAN/ASSET，按 `created_at DESC, asset_id ASC`。BFF 每页重建本人 scope；cursor 是位置而非快照/权限，跨用户/租户/scope/limit 或非法 cursor 映射稳定 400。                                                                  |
| 错误             | 普通 Product admission 的 service/Bearer/IAM/fixed-tenant 401/403/429/503 保持；本路由非法 kind 或分页为 `400 invalid_library_kind`/`400 invalid_library_page`，owner 坏页/字段为 `502 storage_response_invalid`，缺配置/不可达/超时/受信 scope 被拒为 `503 storage_unavailable`。不泄露 owner 原文/secret，不把依赖错误映射空数组。 |

当前 `x-kokoro-permission: storage.library.read` 是 BFF public operation 分类 metadata，不是浏览器自报 IAM grant
或 Storage caller 凭据。本片保留现有 metadata；真实本人授权来自当前 service+Bearer+IAM admission 与
`scope_kind=personal, scope_id=subject_id`。若未来 File/Artifact 拆权限，需单独评审并变更 owner OpenAPI
及消费者，不能只改展示标签。未来 `kind:"artifact"` 有独立 `artifact_id`、Storage F2 kind/title/source、
可信 Agent Run 与当前资源授权；新增 union 分支可能让穷尽式 generated client 破坏，必须做 breaking/consumer 检查。

**个人上传**以上方独立代码片为准；不能从文件列表 200 推断 POST 的真实组合或 Web 用户流程已通过。

**个人下载的下一独立 Product 契约**已由本文顶部设计门裁决为
`GET /v1/library/files/{asset_id}/content` 受控字节转发，当前机器契约/runtime 尚未实现。
列表不带 URL；每次从本人 admission 重建 scope，先 `GetAsset(asset_id)` 确认普通 ASSET/CLEAN，
再用返回摘要签发并核对。摘要和 cursor 不是权限。Web 旧 `/api/session/artifacts` 的作品形状
不等于个人文件，不作为下载 fallback。

本片已先将字段/参数/错误写入唯一 public OpenAPI，精确固定 Storage 新 Proto/生成 manifest，再切 runtime
并删除固定 503 stub。跨 subject cursor 的拒绝由 Storage owner 保证，BFF 每页重建当次 subject；Root 真实 owner
组合负例仍待验。本 Markdown 不维护第二份可编辑机器 schema。

现有 BFF canonical JSON envelope 仍含 `meta.request_id`，Library 与其他操作保持同一 shape；Library 路由同时
显式写 `x-request-id`。这与 Root API 专项手册的 header-only request ID 目标不一致，属于既有全仓级技术债，
本片不对其他 public operation 作不兼容 envelope 重构。

## W1E-IAM-0.6-BFF-PIN：历史来源

IAM owner `a4c2b61467f1fc1772d6b6d8e98f081c090289fb` 的 internal OpenAPI `0.6.0` 原始 SHA-256 为
`392ca0e49544c0ec6e0d2fa782c46c33c1847e2c350102e7ad3b8af43f858ced`。BFF 只读 vendor 保留完整
owner 契约；生成 operation allowlist 不加入 Platform workload introspection 或 E2 verifier。browser-private relay policy
仍为 `2.1.0`，route/method/header/cookie/status/error 映射不变，仅 owner commit/version/digest 来源更新；public Product
OpenAPI 不变。`contract/dependencies/iam-http.json` 与 `contract/iam-relay-policy.json` 为确定性生成物。

## W1E-IAM-E2-BFF-SOURCE-PIN：历史来源

IAM owner `b720b6dc095b883237682102ca0a87ed6451a968` 的 internal OpenAPI `0.5.0` SHA-256 是
`cddfec4cd3439d98f399254911232c447582a97e9b1d4c109139e68baaf030b9`。BFF 固定完整 owner vendor，但生成器只筛选既有
session、Team、invitation 操作；IAM E2 `verifyExecutionAuthorization` 不进入 BFF generated client 或 browser-private relay route。
relay policy 版本仍是 `2.1.0`，路径、方法、header、cookie、status、错误映射及 public Product OpenAPI 不变。

## W1E-IAM-PERMISSION-CONSUMER：历史来源

IAM owner commit 为 `5c9cecf714c87234bbc9558665b23e09afa6e9f6`，OpenAPI `0.4.0` SHA-256 为
`05ff7ff712ce06571ca5e092fdaf234b9ee4d1b4978c54e0d54d2b50fe51dde2`。IAM 角色列表响应仅增加可选
`platform:["execute"]`，BFF 生成 client 消费其结构而不进行权限裁决；relay `2.1.0` 的 route/method/header/cookie/status
和 public Product OpenAPI 均不变，BFF policy provenance/派生 JSON 随 owner pin 更新。

## W1D-RELAY-PIN-BFF：来源变更，不变更 wire 契约（历史验收）

IAM owner commit 更新为 `6a55ffb4c22f0b155ddb83157735c0ace766701d`；固定 allowlist、Better Auth snapshot 与
internal OpenAPI 0.4.0 的 SHA-256 与上一 pin 完全相同。BFF `2.1.0` relay policy 的 `iamOwnerCommit`、
IAM vendor 目录、generated client manifest 与生成配置同步重钉；policy JSON 仍由 TS 事实源生成。
静态/动态 route、method、header、cookie、status、错误映射和幂等语义不变；public Product OpenAPI 无变化。
Web 必须在 BFF 发布后消费新的 policy digest，不复制 IAM contract 或手写 generated client。

## R5-INVITE-BFF-RELAY：邀请 interaction 的 browser-private 契约

**R5 当时状态：** BFF 工作树 policy `2.1.0` 已把 IAM owner 固定为
`7215223b2ed27a0d5217f3bbaaabce547006d3bb`、OpenAPI `0.4.0`/SHA-256
`a18d57172df841cb2f55aa845a3eeb519ddb5abc8bea1c2be74fbb7e0fb62416`，并实现精确静态 sign-up、三条参数化邀请 relay 与
`/iam/interactions/invitation?id=<UUID>` 邮件回跳。三条 invitation operation 的 owner/visibility/stability/idempotency、vendored
OpenAPI、generated client 与 policy JSON 是 Root verifier 的机器来源；public Product OpenAPI 不包含这些 browser-private 入口。

这些 operation 的 BFF visibility 为 `browser-private`，不进入 public Product
`contract/openapi/v1/openapi.yaml`，也不经过 Product admission。Caller 只能是 Web same-origin server：每次请求先带
`x-kokoro-service: web-bff`、server-only shared secret 与受控 request ID；浏览器没有这些凭据。BFF 固定上游 IAM origin，
不接受 Host/Forwarded/query/body 改向，不接收 Product Bearer 或自报 actor/recipient/tenant。

### 精确请求矩阵

| BFF request                                                           | 唯一准入形状                                                                                                                                                                                                                                                                                                                                | 上游机器来源                                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `POST /iam/sign-up/email`                                             | 无 query、Authorization、Idempotency-Key 或 issuer Session；精确 Web Origin、`Content-Type: application/json`；总 body ≤64 KiB 且 JSON 恰有 string `name,email,password,callbackURL`。`callbackURL` 逐字为 `${WEB_ORIGIN}/iam/interactions/invitation?id=<canonical-lowercase-UUID>`；额外字段、`image`、`rememberMe`、其他 callback 拒绝。 | IAM `AUTH_ROUTES["/sign-up/email"]=["POST"]` 与 Better Auth 1.7.3 snapshot；不是 Nest invitation Controller。 |
| `GET /iam/v1/tenants/{tenant_id}/invitations/{invitation_id}/context` | 无 query/body/Authorization/Idempotency-Key；`tenant_id` 逐字等于 BFF `KOKORO_TENANT_ID`，`invitation_id` 是小写 canonical UUID；精确 Origin与非空 issuer Session Cookie。                                                                                                                                                                  | IAM 0.4.0 `getTenantInvitationContext`。                                                                      |
| `POST .../{invitation_id}/accept`                                     | 同一固定 tenant/UUID/Origin/issuer Session；无 query/body/Authorization/Idempotency-Key；Web 在调用前验证并消费一次性 CSRF。                                                                                                                                                                                                                | IAM 0.4.0 `acceptTenantInvitation`。                                                                          |
| `POST .../{invitation_id}/reject`                                     | 与 accept 相同；Web 在调用前验证并消费一次性 CSRF。                                                                                                                                                                                                                                                                                         | IAM 0.4.0 `rejectTenantInvitation`。                                                                          |

动态路径仅匹配上述三条完整模板；额外段、尾斜线、大小写/反斜线/双斜线、点段、percent-encoded alias、绝对 URL、fragment、
错误方法均为 404，且零 IAM socket。固定 tenant 未配置为 503 `product_tenant_not_configured`；path tenant 错配为 403
`product_tenant_forbidden`；非法 UUID/body/header/cookie 为现有稳定 relay 400/403/413；服务身份错误为 403。所有本地拒绝
带 `x-request-id`、`Cache-Control: no-store`、`Referrer-Policy: no-referrer`，不回显 tenant、email、password、cookie 或原始目标。

issuer Cookie 继续只接受 policy 中的精确名称/前缀/Path/host-only/SameSite/Secure 规则。三条 dynamic route 在过滤后必须有唯一
非空 `kokoro-issuer.session_token`（生产带 `__Secure-` 前缀）；Product/Auth.js/未知 Cookie 不转发。sign-up 在过滤后必须没有
issuer Cookie；新用户必须在真实 SMTP 验证后重新走独立 issuer sign-in。Origin 不等于 CSRF：Web 后续对 sign-up/accept/reject
表单负责一次性 CSRF，BFF 只在已完成 Web 验证的 server request 上复核 Origin/service identity。

### Owner 成功、错误与失败映射

三条动态 operation 只接受 IAM machine contract 声明的 status 集合
`200,400,401,403,404,409,429,500,503`、`application/json` 和严格 generated schema；目标成功体保持以下 native
envelope/status，不套 BFF Product envelope：

```json
{"data":{"invitation_id":"UUID","tenant_id":"TENANT","tenant_name":"NAME","roles":["member"],"status":"pending","expires_at":"RFC3339"}}
{"data":{"invitation_id":"UUID","member_id":"MEMBER","status":"accepted"}}
{"data":{"invitation_id":"UUID","status":"rejected"}}
```

context 的 404 隐藏不存在、错收件人、错 tenant 与终态；匹配收件人才可能得到 `409 INVITATION_EXPIRED|TENANT_DISABLED` 或
`404 ROLE_NOT_FOUND`。accept/reject 由 IAM 再次验证 recipient/tenant/pending/expiry/role；accept 成功才创建 Member，reject
不创建 Member/Product Session。sign-up 只接受 pinned Better Auth snapshot 声明的 native status/body 上限，不创建 BFF Product
Session 或 membership；200 user 的 email/URI/date-time 必须满足 pinned Better Auth schema，token 只允许 null/省略且
`emailVerified=false`。即使 owner wire 成功，仍必须完成邮件验证并重新登录。

动态非 200 先验证完整 generated `ApiErrorResponse`、稳定 owner code 且 `details=[]`，再保留该 code/retryable，以 code→固定安全文案表
重建 JSON；owner message 与 payload 一律丢弃。sign-up 非 200 按 snapshot 精确接受 400/401 必填 string message，以及
403/404/422/429/500 的可选 string message，然后按 status 重建固定 `IAM_SIGN_UP_*` code/message；不回传 owner message 或任意额外字段。

所有成功和 owner error 均输出 BFF 受控 `x-request-id`、`Cache-Control: no-store`、
`Referrer-Policy: no-referrer`；仅 429 可保留十进制 1..86400 秒的 `Retry-After`。动态三路不允许 Location 或
Set-Cookie；sign-up 同样拒绝任何 Set-Cookie，SMTP 验证前不建立 issuer Session。未声明 status、非法/超限 header/body、schema 漂移、任意 dynamic
3xx 或敏感原文均被丢弃并归一为 `502 iam_relay_response_invalid`；timeout/transport/cancel 归一为
`503 iam_relay_unavailable`。不记录或返回未验证的 upstream body/message、token、cookie、password、query、stack 或 URL。

accept/reject 不声明 BFF 幂等 receipt，BFF 不自动重试。网络结果未知时 Web 可以重新 GET context，但终态 404 无法证明上次写的
结果，不能据此启动 Product OIDC；明确 accept 200 后才能 `/login`，reject 200 后只显示完成。context/sign-up 的 429 遵守
合法 Retry-After，依赖失败不返回缓存数据。

### 邮箱验证 Location 与机器来源

`GET /iam/verify-email` 的 owner 302 仅新增一个来源受限的 Location：当且仅当当前上游 route 是 `/verify-email`，目标必须与
配置 Web Origin 同源，path 逐字 `/iam/interactions/invitation`。成功 raw query 逐字为唯一
`?id=<canonical-lowercase-UUID>`；验证失败只允许在该 query 后追加一次
`&error=TOKEN_EXPIRED|INVALID_TOKEN|USER_NOT_FOUND|INVALID_USER`。这是 IAM
`VERIFY_EMAIL_REDIRECT_ERROR_CODES` 的完整 owner 枚举；现有真实 SMTP 测试中无效 token 确实以 302 追加
`error=INVALID_TOKEN`。其他 error/code、重复或重排参数、编码别名、fragment、userinfo、scheme-relative 或外域一律 502。
Web 必须把枚举映射为固定安全文案，不回显 query。该目标是 Web 页面，不是 IAM endpoint，不加入静态 `routes` 或动态模板；
既有 Auth.js callback/post-logout 与旧三条 Web interaction 规则不放宽。

目标 policy `2.1.0` 仍以 TS 为唯一手写事实源，JSON 为派生产物：静态 `routes` 从 IAM `AUTH_ROUTES` 的窄子集新增
`/sign-up/email`；独立 dynamic collection 固定三条 template/method/operationId/`browser-private` visibility；同时固定
IAM 0.4.0 final version/SHA、allowlist SHA `f63dacfa...ead` 与 Better Auth snapshot SHA `b2eac191...59e1`。BFF IAM vendor/
generated manifest/client 后续重钉该 IAM commit，生成范围仅在现有 admission/Team operations上增加三条 invitation operation。
Root verifier 从固定 IAM/BFF commit blob 复核静态子集、三条动态模板/visibility/method/operationId、全部 digest 与 Location 篡改
负例；Web 只消费发布后的 BFF artifact。public `/v1` OpenAPI、operation baseline 与 Product Team 三读六写均零变化。

派生 JSON 的字段 contract 为：顶层新增 `iamOpenapiPath="contract/openapi/iam.internal.v1.json"`、
`iamOpenapiVersion="0.4.0"`、`iamOpenapiSha256="a18d57172df841cb2f55aa845a3eeb519ddb5abc8bea1c2be74fbb7e0fb62416"`，
`iamOwnerCommit="6a55ffb4c22f0b155ddb83157735c0ace766701d"`；`invitationRoutes` 是三项有序数组，每项恰有
`template,methods,operationId,owner,visibility,stability,idempotency`，相对 template 分别以
`/v1/.../context|accept|reject` 结尾，methods 分别为 `["GET"],["POST"],["POST"]`，owner=`kokoro-iam`、
visibility=`browser-private`、stability=`stable`、idempotency=`none`。`invitationSignUp` 固定静态 route/method、
排序后的四个 body field、interaction callback path/query key；`invitationLocation` 固定 sourceRoute=`/verify-email`、同一 path、
query key=`id` 与 canonical lowercase UUID value format，并固定 `errorQueryParameter="error"` 及上述四值有序
`allowedErrorCodes`。Root 还须从同一 IAM commit 校验该数组恰等于 owner
`VERIFY_EMAIL_REDIRECT_ERROR_CODES`。完整示例与 owner-extension 校验方式见
[TECHNICAL_DESIGN](TECHNICAL_DESIGN.md#状态机失败恢复与来源级联)；Root 不从 Markdown 猜字段或把动态路径并入 `routes`。

## W1C-Team-R5：Team Product mutation（目标切片）

BFF public `/v1` beta 增加六条写：`POST /team/invitations`（`{email,roles}`）、`POST /team/invitations/{invitation_id}/resend`、`DELETE /team/invitations/{invitation_id}`、`PUT /team/members/{member_id}/roles`（`{roles}`）、`DELETE /team/members/{member_id}`、`DELETE /team/members/me`。所有路径带 `/v1` 前缀；body 严格限于列出的字段，重发、取消、移除与离开无 body。固定部署 tenant、actor 与 user-delegated Bearer 从统一 Product admission 取得，不接受 body/query/header 自报。IAM 0.3.0 owner 对应 `iam:invitation.write` 或 `iam:member.write` scope、当前 membership 与 permission；BFF 只投影，不代授权。

成功均为 200 `{data:<IAM 对应写结果>,meta:{request_id}}`，分别为 invitation `{invitation_id,status:pending|canceled}`、role replacement `{member_id,roles}`、member removal/leave `{member_id,status:removed|left}`，以机器 OpenAPI 各 operation schema 为准。错误为 400/401/403/404/409/429/502/503；本地输入拒绝 400，IAM 业务冲突 409 保留受控 `LAST_OWNER`、`INVITATION_CONFLICT` 等 409 code、`ROLE_NOT_FOUND` 等 404 code，不把 409 压成 403；上游 500/503 或网络故障 503，形状漂移 502。限流只传合法有界 Retry-After；全部结果 no-store/x-request-id。IAM 没有写 receipt，本投影 `x-kokoro-idempotency: none`，没有 Idempotency-Key 承诺或自动重试；未知结果由调用方读取事实再决定后续操作。输入/响应字段与错误集合的唯一可编辑事实源是 `contract/openapi/v1/openapi.yaml`；IAM 生成客户端只消费固定 owner OpenAPI，非另一份可编辑 schema。

## W1C-FIXED-TENANT-BFF-C：`GET /v1/me` 当前身份契约

**当前态（BFF `74ec30b`）：** public OpenAPI 没有 `/v1/me`；Web 可消费的 Team 列表、service-only runtime manifest 与 browser-private IAM issuer Session 不等于固定 Product token 的当前身份。已有普通 `/v1` admission 绑定 Web service + 唯一 Bearer + IAM 在线验证 + 固定租户。

**目标态：** BFF 作为 public owner 添加 beta `getCurrentUser`、`identity.self.read` 分类，GET 无参数/正文/idempotency receipt；query 或带正文的请求在 admission 后返回 400。成功 200 的既有 Product envelope 是恰好 `{data:{user_id:string,tenant_id:string},meta:{request_id:string}}`，身份两字段仅来自本次受信 `RequestContext`；`x-request-id` 与 `Cache-Control: no-store` 固定，不缓存、不返回 issuer Session/token/scope/Team 目录。缺服务 403、缺/非法 Bearer 401、固定 tenant 未配置 503（零 IAM I/O）、IAM 拒绝/撤权 401/403、异租户 403、IAM 限流 429（仅合法有界 Retry-After）、IAM 不可用 503，均沿用稳定错误 envelope/no-store/request ID；身份不匹配不回显 token 或外租户 ID。query/路径别名不成为替代身份入口。公开机器字段事实源仅 `contract/openapi/v1/openapi.yaml`，冻结 v1 operation baseline 添加新操作；IAM 原生契约与 BFF relay policy 不变。Web 固定 BFF 来源后于 code callback 与 refresh finalize 调用并校验自身预期 subject/tenant，本仓不定义 Web Session 行为。

## W1C-FIXED-TENANT-BFF-B：browser-private relay breaking policy

**当前态（BFF `dadf9264`）：** relay policy `1.1.0` 仍公布 `GET /iam/organization/list`，且 `POST /iam/organization/set-active` 在通用 service/Origin/cookie/body size 检查后把任意 JSON 透传 IAM。下面 W1C-1 原始表记录的是该已发布基线，不是固定租户目标。

**目标态：** policy `2.0.0` 删除 list，无 alias/fallback；set-active 仅供受信 `web-bff` 服务以配置的精确 Origin 调用。请求 URL 不带 query；入站须有合法且非空的 issuer `session_token` cookie，不能用 Product cookie 代替。`Content-Type: application/json`；body 是恰好两个 key 的 JSON object：`organizationId` 为与服务端 `KOKORO_TENANT_ID` 精确相等的非空 string，`oauth_query` 为无前导 `?`、不超过 policy `maxQueryBytes`、无控制字符/反斜线/畸形 percent escape 且恰有一个非空 `sig` 的原始 continuation query。BFF 保留原始 query 字节给 IAM，不自行验证或重签 `sig`。缺固定配置返回 `503 product_tenant_not_configured`；未知 path/method 包括 list 返回 404；其余本地拒绝为稳定 400/403，统一 `x-request-id`/`Cache-Control: no-store`，且均零 IAM socket。IAM 原生响应、权限和验签语义保持原样，BFF 不新增公开 `/v1` operation、幂等 receipt、分页或事件。Web 必须按固定 BFF commit/digest 切换消费者；跨仓切换前固定租户登录尚未闭环。

## W1C-FIXED-TENANT-BFF-A：普通 Product admission 的固定租户错误

普通 `/v1` 用户操作保留既有 service envelope、唯一 User Bearer 与 IAM 在线 session admission；服务身份或 Bearer 格式先失败。`KOKORO_TENANT_ID` 未配置时在 IAM I/O 与业务处理前返回 `503 product_tenant_not_configured`；IAM admission 成功但其受信 `tenant_id` 与固定部署租户不相等时，在 route/body/idempotency/owner I/O 前返回 `403 product_tenant_forbidden`。两者使用现有错误 envelope、`x-request-id` 与 `Cache-Control: no-store`，不回显任何租户 ID；IAM 自身 401/403/429/503 仍按既有映射，不能由 header/query/body 提供另一租户值覆盖。Team 三 GET 与其他普通 Product 操作共用此闸；这不是 IAM Team 写 permission 的替代品。Share、runtime manifest、Scheduler callback 与 `/iam` browser-private 原生协议各守其独立服务边界，不应用此普通用户租户错误。当前 public OpenAPI 的 403/503 通用错误响应不新增 operation 或字段。

## W1C-Team-R2：已实现、待真实 IAM 组合验收的公开只读契约

IAM owner 内部 OpenAPI `0.3.0` 固定于 `68aa0da259df1f1ea9030936b8d5a46acba8c6ab`；BFF public OpenAPI 是 Web/开发者唯一 Product 契约。`GET /v1/team/members|invitations|roles` 使用现有 service + User Bearer 准入，tenant 从 IAM admission 结果取得；唯一查询为 `limit` 与 `cursor`，默认 25、范围 1..100、cursor 最长 2048。成功 `{data:[...],meta:{request_id,next_cursor}}`，资源项字段与 IAM 0.3.0 一致，不复制 IAM 的写操作。错误明确区分本地非法分页 400、IAM 身份/权限拒绝 401/403/404、限流 429 与依赖/契约失败 503/502，`Retry-After` 只在合法且有界时保留；所有响应带 `x-request-id` 和 `Cache-Control:no-store`。public schema 与运行时在同一未提交切片，假 IAM HTTP 六项已通过；真 IAM scope/权限及 Web 消费仍待组合验证，不将当前工作树视作已发布接口。

## 事实源与可见性

[`../contract/openapi/v1/openapi.yaml`](../contract/openapi/v1/openapi.yaml) 是本仓唯一字段级机器事实源。
`docs/api/` 只解释资源和生命周期；Root 只发布 catalog/reference，不保存可编辑镜像。

BFF 是 Kokoro 唯一 `public` HTTP owner。Browser 仍必须经 `kokoro` same-origin adapter 调用；“public”不表示浏览器
持有服务 secret。IAM、System（含 model-catalog）、Billing、Capability、Storage、Agent、Scheduler 和 Music 的接口均为各 owner
自己的 internal contract，BFF 只发布重新投影后的 Product API。

## W1C-DB-BFF 数据库连接边界（源码已实现；待 Root 验收）

当前 BFF `cd1c2600ea2a6e0716b07628822a49653964675a` 的 PostgreSQL 连接未固定 owner schema，安装器只检查
`public`；这不是单库组合的已验收状态。目标为同一应用数据库和账号下的固定 `kokoro_bff` schema，连接 URL
显式 `schema=kokoro_bff`，运行时及安装器独立校验并固定 search_path；误指向 `public`/其他 owner 拒绝。
这是仅限 BFF 数据边界的配置与安装契约，不改变本仓 public OpenAPI、`browser-private` IAM relay policy、
内部 HTTP/RPC wire、version、错误 envelope、generated client 或消费者 pin。数据库 URL 不从浏览器请求、
Header、tenant 或 actor 推导；其他 owner 的 schema 仍只能通过其公开 API/RPC 访问。

## W1C-1 `browser-private` IAM relay（本次源码切片；待组合验收）

起始 BFF commit `6238599667110fbfbc2d5ef3a9d53731f2623cfe` 的 `/iam/*` 返回 404；本次源码切片已实现下述
BFF transport 准入，但仍待 Root gitlink 来源门与真实正向 OAuth 组合验收，不表示登录已可用。它不是 BFF public Product `/v1` operation，不在
`contract/openapi/v1/openapi.yaml` 复制 IAM 字段或伪造 OAuth schema。IAM 是 native OAuth/OIDC 与 Better Auth
wire owner；BFF 只决定 Web adapter 可经 relay 访问哪些固定 path/method，以及如何处理 HTTP 安全边界。
机器证据由唯一手写 `src/http/routes/iam-protocol-relay.policy.ts` 经确定性脚本派生只读
`contract/iam-relay-policy.json`（该历史切片初始 policy version `1.0.0`，当前为 `2.0.0`；IAM 固定 commit/allowlist/snapshot SHA-256、下面的
path/method、请求/响应 header、cookie/redirect 策略）。它是 `browser-private` BFF 自有准入策略，不是
IAM OpenAPI/Better Auth schema 副本；手写 TS 与 JSON 不双向编辑。`pnpm contract:check` 重生 policy JSON
字节并拒绝漂移；IAM 私有 allowlist/snapshot 不复制入 BFF。Root 独立组合机器门从固定 IAM/BFF gitlink commit
blob 验证两份 IAM digest、relay path/method 子集及 BFF artifact，含篡改负例；该门通过前 W1C-1 不验收。
Web 以固定 BFF commit + 此 artifact blob/SHA-256 digest 保存只读 vendor 输入，并运行 consumer test 比较
Web route policy 与 BFF 已发布矩阵；不能只看本页 Markdown 或松散版本范围。

固定上游来源为 IAM main `b363554d07e5b6e182160b42ae1402330e55d9db`，
`src/modules/auth/ingress/auth-routes.constants.ts` SHA-256
`f63dacfa8a7bcec3c56efb8ffb762a3f8bd82bb380eff40a1462db1e77d61ead`；原生 schema 快照
`contract/vendor/better-auth.v1.7.3.json` SHA-256
`b2eac1919e16fdc30a40bee0f3c4300b641bd8f674214aea7731bf10299559e1`。下面集合**比 IAM allowlist 更窄**；
升级或增加 endpoint 必须重新固定 owner commit/digest、逐项审查用途/方法、运行真实 IAM HTTP，不从 vendor snapshot 自动开放。

| BFF `/iam` 精确相对路径                                                                 | 方法      | 本片用途与 caller                                       | 额外身份/载荷边界                                                                                               |
| --------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `/.well-known/openid-configuration`、`/.well-known/oauth-authorization-server`、`/jwks` | GET       | Auth.js discovery/JWKS，Web server 或受控浏览器同源读取 | 无用户 Bearer、无 cookie mutation                                                                               |
| `/oauth2/authorize`                                                                     | GET、POST | Code+S256 PKCE，Browser 经 Web                          | issuer cookie；唯一 `resource` 和注册 client/redirect 由 IAM 检查                                               |
| `/oauth2/token`                                                                         | POST      | Auth.js server-only code/refresh exchange               | 仅受信 Web server 生成 `client_secret_basic`；浏览器 Basic/Bearer 在 Web ingress 剔除；无 issuer/Product cookie |
| `/oauth2/userinfo`                                                                      | GET       | Auth.js server-only claims fetch                        | 只转发 Web server 所持 user-delegated Bearer；浏览器 Bearer 不透传                                              |
| `/oauth2/revoke`                                                                        | POST      | Auth.js server-only refresh/access revoke               | 只接受 Web server 生成的 client Basic；无浏览器 Authorization                                                   |
| `/oauth2/end-session`                                                                   | GET、POST | RP logout，Browser 经 Web                               | issuer cookie/ID token hint 由 IAM 验证，post-logout URI 精确注册                                               |
| `/oauth2/end-session/confirm`                                                           | POST      | 仅 IAM 原生 logout 确认续接                             | issuer cookie + 同源 mutation 检查                                                                              |
| `/sign-in/email`、`/sign-out`                                                           | POST      | Web 登录页/退出 issuer Session                          | issuer cookie（如有）及 IAM Origin/CSRF；Product Session 独立清理                                               |
| `/get-session`                                                                          | GET       | Web 登录页/tenant/consent 当前 issuer Session           | 只读取 issuer cookie，不建立 BFF Product identity                                                               |
| `/organization/list`                                                                    | GET       | `1.1.0` 历史基线；`2.0.0` 已删除                        | 当前 relay 返回 404，零 IAM socket                                                                              |
| `/organization/set-active`                                                              | POST      | 固定 tenant OAuth 续接；不提供选择器                    | 以本页 W1C-FIXED-TENANT-BFF-B 的精确输入准入；IAM 继续原生验签与 Session/成员校验                               |
| `/oauth2/consent`、`/oauth2/continue`                                                   | POST      | Web consent/authorize 续接                              | issuer Session、原生 consent/reference 校验                                                                     |

本片**不开放** IAM allowlist 中的 `sign-in/magic-link`、`magic-link/verify`、注册/邮件验证/密码重置、其他 Session
管理、organization create/get/update/member/invitation/role 写入、`oauth2/introspect`；旧 Web magic-link/team-session
直连不会借 relay 换路径恢复。`/internal/v1`、`/iam/v1`、admin、匿名 dynamic client registration、client/resource CRUD、
未知/编码 alias 均拒绝。若真实 Web 登录/consent 证明上表缺少 IAM **已发布**的具名路径，只能单独评审并加测试，
不能改成通配 relay。

所有路径由 Web 同源 adapter 用 `x-kokoro-service: web-bff` 与固定 BFF shared secret 调用；BFF 先验此服务身份，
再在原始 request target 上对 path+method 精确匹配。缺/错服务身份 403，未配置服务凭据 503；未知、不规范 path
或错误方法统一 404，均不得形成上游 socket。禁止 percent-encoded slash/dot、大小写/双斜线/尾斜线别名、绝对 URL、任意 Host/Forwarded
改向及 CRLF。BFF 不能凭 Web service secret 证明 Basic/Bearer 在 Web 入口的原始来源；Web 必须移除浏览器 Authorization，
只有 Web server 的 token/revoke/userinfo 分支可生成/传递上述精确 credential。BFF 不持有 OAuth client secret，
也绝不把 service secret 发给 IAM。

浏览器 cookie mutation 须带精确配置的 Web Origin；Web adapter 自行验证同源 CSRF 证据，BFF 复核 Origin，IAM
继续执行原生 Session/CSRF/权限规则。Web server-only token/revoke 不复用浏览器 mutation 分支；只有预先定义的
protocol request-id 可传输，不把浏览器任意身份、forwarded host 或自报 tenant/actor 当作 authority。

只转发原生协议必要的 query、Content-Type/Accept/Origin、body 和 IAM 固定版本的**精确 cookie 名称**：
`kokoro-issuer.session_token`、`kokoro-issuer.session_data`、`kokoro-issuer.dont_remember`、
`kokoro-issuer.session_token.oauth_logout_confirmation`（生产对应 `__Secure-` 前缀）；若真实 IAM fixture 证明
需要清理 `session_data.<非负十进制整数>` chunk，仅准入该数字后缀。这里不是 `kokoro-issuer.*` 通配。
拒绝重复或畸形 cookie，不转发 Auth.js/Product Session cookie。响应只回传合法 issuer `Set-Cookie` 多值（不折叠）、
必要原生 header、status、body；普通 issuer cookie `Path=/iam`，logout confirmation cookie **仅**允许
`Path=/iam/oauth2/end-session/confirm`。全部 cookie 要求 `HttpOnly; SameSite=Lax`、host-only（无 Domain），生产另要求
`Secure`；不接受其他 Path、域或名称。该例外来自 IAM 当前锁定的 OAuth Provider 1.7.3 logout confirmation 原生行为，
必须以真实 HTTP 断言，不能因简化 cookie filter 而破坏合法 logout。
`Location` 只可指向固定公开 issuer origin 下已批准的 `/iam` GET 路径、Web `/auth/sign-in`、`/auth/select-tenant`、`/auth/consent`，
或事先配置且经 IAM client 注册的**精确** Auth.js callback/post-logout URI。三种 Web 交互页上的 IAM 原生
authorize query 含 `sig`、`ba_iat` 与重复 `ba_param` 等动态签名参数；callback 也带动态 code/state/iss。
BFF 只固定实际 `Location` 的 origin/path，并对 raw query 做 ≤8 KiB、合法结构与 CRLF/控制字符检查；合法原生
query 原样保留，不解析重排、不消费/伪造 IAM 签名，也不把其中的 `redirect_uri` 当作另一个 HTTP 目标。
Web 续接原样传回 IAM，由 IAM 验签；不允许任意外域、任意 Web path、未注册 redirect、fragment、
scheme-relative 或 userinfo。IAM 原生 OAuth/Better Auth body/error、表单、redirect 和 cache header 不套 BFF
Product envelope，也不重写合法 Location。IAM 原生 429 的合法有界 `Retry-After` 保留；logout HTML 的
`Content-Security-Policy`、`X-Content-Type-Options`、`Pragma` 经严格值校验后保留，hop-by-hop headers 仍剔除。
BFF 自有拒绝/依赖错误可用脱敏稳定 code 与 `x-request-id`/`Cache-Control: no-store`，绝不透出 upstream URL、token、cookie。

仅固定 `/oauth2/end-session` GET 在 BFF 内部合成 `Sec-Fetch-Mode: navigate` 以保留 IAM 无 hint 的原生浏览器确认语义；
客户端提供的同名 header 不参与此决定且不透传到其他路由。此服务端传输细节不扩展 browser-private 请求 header allowlist。
上游固定 IAM origin，单次有界 I/O（不自动重定向、不重试、不缓存）；入站 body 与上游 headers/body 共用单一
timeout ≤5 秒，响应 ≤1 MiB，且不超过更小的现有 BFF upstream 配置；请求 body ≤64 KiB、headers ≤16 KiB，
断连或上游 header/body 超限即 abort/cancel 真实 socket/reader 并清理资源。IAM 不可达、超时、超限和非法响应
统一 fail closed 为 502/503；本地拒绝零 IAM socket，响应后恶意 Location/Set-Cookie 允许一次 IAM socket 但值不可
出站；全部 relay 路径零 BFF SQL/Redis/receipt/outbox。普通 `/v1` 仍执行已有 IAM 0.2.0 在线 admission，
Share/runtime-manifest/Scheduler 各自服务例外保持不变。只有 W1C 真进程测试通过后，本节才转为当前 contract；
完整 `EDGE-WEB-BFF` 仍待 Product generated consumer 与 AG-UI 单协议另片验收。
真实 IAM HTTP 正向测试必须覆盖三种交互页签名 query 续接、429 `Retry-After` 与 logout HTML 上述安全 header，
不能只用手工 stub 假设协议值。

### R2e-IAM-VERIFY-RELAY 增量（本仓已实现，待 Root 验收）

IAM owner `093b76513a9aa71611c65d4f210e279d3227e002` 的固定 ingress allowlist 已发布原生
`GET /verify-email`；起始 BFF `eb1eb2926d08b8a3779898b2c31e604a8585ec8b` 的
`src/http/routes/iam-protocol-relay.policy.ts` 和派生 `contract/iam-relay-policy.json` 均无此项。
上表“本片不开放邮件验证”描述 W1C-1 已实现的旧范围；R2e 本仓切片**只**从该范围中增加
`/iam/verify-email` 的 GET，不增加 POST/别名、不更新 public `/v1` OpenAPI、不复制 Better Auth 字段 schema。
policy version 由 `1.0.0` 升为 `1.1.0`，生成 artifact 仍为只读。
本次来源级联只重钉 IAM test-fixture commit，当前 artifact SHA-256 为
`731735ba8ce07c578fe04fa51783a95c7ac7daf50df33cea0ef9cefedc32d032`；路由、header 和限额语义未变。
Web 须在 BFF policy 发布后固定其 commit/blob digest，才能增加同源入口；IAM 是 token 和验证结果唯一 owner。

| BFF browser-private 请求            | 原生效果与约束                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /iam/verify-email?<raw-query>` | BFF 按现有服务 envelope 与原始 path/method 准入，透传有界原始 query；IAM 校验 Better Auth 1.7.3 的有期签名 JWT `token`，邮箱已验证状态幂等，并决定原生结果。BFF 不解析/重排/记录 token，也不从 query 的 `callbackURL` 选择上游或重定向目的地。错误方法、编码 alias、越界/畸形 query 在出站前拒绝。                                                                                                                                                                                                                                                                                    |
| IAM 原生响应                        | 保留原生 status、已允许 header/body 和合法独立 `Set-Cookie`；302 仅接受实际 `Location` 指向固定 Web origin 的已批准 `/auth/sign-in`，或现有允许的精确 issuer GET/Web callback/post-logout 目标。`callbackURL=${WEB_ORIGIN}/auth/sign-in` 由 IAM owner 的初次开通流程指定；其 query 字面值自身不构成 BFF 的 `Location` 授权。对该 GET 的上游响应无论缺失或带可缓存的 `Cache-Control`，BFF 均固定输出 `Cache-Control: no-store` 与 `Referrer-Policy: no-referrer`；自有拒绝/上游失败仍返回脱敏稳定 code、`x-request-id` 与 `Cache-Control: no-store`。不自动跟随 redirect、重试或缓存。 |

GET 仍拒绝任意 `Authorization`，只筛选既有 issuer cookie，绝不把 Product Session cookie 或 Web service secret
送往 IAM；现有精确 Origin、request/response header、body、timeout、大小上限、取消和非法 `Location`/`Set-Cookie`
fail-closed 规则不变。验证邮件 raw query、token、原生响应 body/Location 不进入 BFF 日志、缓存、receipt、
数据库或 Redis；IAM 原生失败/过期/重复使用的具体状态由 IAM 决定，BFF 不改写为 Product envelope。
本段是已发布 R2e verify-email 基线：`/sign-up/email`、`/send-verification-email`、组织创建/写入和通配 `/iam/*`
在该历史切片继续不开放；本页 R5 目标随后只新增受限 `/sign-up/email`，其余仍关闭。首次正式账号与固定
tenant 的受控 bootstrap 由 IAM owner 独立完成；一次邮箱验证成功是必要条件，不代表 Product Session、
OIDC client、tenant 成员或完整 R2e 登录入口已完成。本仓 policy/transport 测试已覆盖模拟 IAM 的
302/no-store/no-referrer 及外域、编码、错方法负例；真 IAM 邮件点击、JWT 校验与完整登录仍待 Root 组合验证。

## Operation metadata

每个 operation 必须声明：

| 扩展                   | 当前值/格式                           | 含义                        |
| ---------------------- | ------------------------------------- | --------------------------- |
| `x-kokoro-owner`       | `kokoro-bff`                          | 公开协议 owner              |
| `x-kokoro-visibility`  | `public`                              | Product API 可见性          |
| `x-kokoro-stability`   | `stable\|beta\|experimental`          | 兼容承诺；当前 v1 为 `beta` |
| `x-kokoro-idempotency` | `none\|required`                      | 是否要求 `Idempotency-Key`  |
| `x-kokoro-permission`  | 稳定 dotted identifier 或 `anonymous` | admission 权限意图          |

`pnpm contract:check` 对全部 operation 执行门禁；`node scripts/verify-openapi.ts` 另外校验字段命名、响应 envelope、
状态码、幂等参数、分页游标和 AG-UI replay 形状。metadata 表示协议策略，不证明对应 Live adapter、数据库事实或
SLO 已经完成；实现状态看 [`CURRENT.md`](./CURRENT.md)。

## 调用与鉴权

### `c5e9b3c` 起始基线

普通用户请求目前由 Web server 发送以下 header：

```http
x-kokoro-service: web-bff
x-kokoro-internal-secret: <server secret>
x-kokoro-namespace: <trusted namespace>
x-kokoro-principal-id: <trusted principal>
x-kokoro-request-id: <optional correlation id>
```

`src/http/request.ts::authorize` 在 shared secret 通过后直接信任 namespace/principal header，尚未调用 IAM。这是 Task 1
要删除的旧身份来源，不是目标安全契约。当前 runtime manifest 还使用伪造 `runtime-manifest` principal；Task 1 把它改为显式
service-only operation。这段只记录起始 commit；下节描述 Task 1 admission，随后章节描述 Task 2 已实现的私有资源 contract。

### Task 1 本变更：IAM session admission

普通 `/v1/*` 顶层 OpenAPI security 使用 `serviceHeader + internalSecret + userBearer` 的 AND 关系：Web adapter 必须同时提供
`x-kokoro-service: web-bff`、正确 internal secret 与唯一 `Authorization: Bearer <session credential>`。旧
`namespace`/`principalId` security scheme 删除；即使客户端继续发送同名 header，也不参与身份建立或 owner 请求。
当时的 66 个 path/method/operationId 保持冻结；W1C-FIXED-TENANT-BFF-C 另加 `GET /v1/me`，当前合计 67 个。所有受保护 operation 在 machine contract 中显式发布 401/403/429/503，
Share 与 runtime manifest 使用下表的 operation-level service-only override。该 clean-slate 身份修正不承诺与未上线旧 header
契约兼容。

BFF 先检查服务身份，再解析 Bearer，然后消费 IAM 固定 commit
`259a66e6a569889c030734f380e99685d8b9e21c`、internal OpenAPI `0.2.0`、SHA-256
`f7a3ea2e5ae7ade82ae1a6756a2f560d3129ca1b2977c6b0905633a284bd3aab` 的
`POST /internal/v1/session-authorizations/verify`。请求无 body/query，只带 Bearer、JSON Accept 与受控 `x-request-id`；
redirect、自动重试和 admission cache 都关闭。只有 strict 200 且 `allowed=true`、`tenant_id`、`user_id`、`session_id`、
`client_id` 非空才建立 `RequestContext.identity={namespace:tenant_id,userId:user_id}`。BFF 不解码 JWT 自建 authority，
不把 Bearer 保存到 context、日志、receipt、数据库或转发给其他 owner。

用户 admission 失败在 body 业务解析、idempotency claim/replay、SQL、outbox、SSE 与 owner socket 之前返回：

| 条件                                                               | Public status / code                  | 约束                                                         |
| ------------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------ |
| service 缺失/错误                                                  | `403 service_auth_failed`             | 不调用 IAM；shared secret 未配置属于部署错误，不改用用户凭据 |
| Bearer 缺失、重复或格式错误                                        | `401 session_authentication_required` | 不调用 IAM                                                   |
| IAM 401                                                            | `401 session_invalid`                 | 不复制 owner message                                         |
| IAM 403/404/409                                                    | `403 session_forbidden`               | membership/session/tenant 不可用都 fail closed               |
| IAM 429                                                            | `429 session_rate_limited`            | 仅转发十进制 1..86400 秒的合法 `Retry-After`                 |
| IAM timeout/transport/其他 status/非法 envelope、header 或过大响应 | `503 iam_admission_unavailable`       | 零重试、无缓存 fallback                                      |

IAM 成功与错误都必须有合法 `x-request-id` 和 `Cache-Control: no-store`。BFF admission 响应使用本仓 canonical
`ErrorEnvelope`、`x-request-id` 与 `Cache-Control: no-store`，不返回 IAM body、token 或 stack。请求取消或 response 提前关闭会
取消 IAM I/O；正常 request body end 不视为取消。一次用户请求或每次 SSE 建连/重连都重新 admission。

### 显式服务边界

| Operation                                     | 身份与 authority                                                     | 与普通用户入口的关系                                                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz`、`GET /readyz`                 | probe contract                                                       | 无用户身份；readiness 必须反映 IAM 配置缺失而不能伪装可服务用户                                                                 |
| `GET /v1/shared/{shareId}`                    | `serviceHeader + internalSecret` + active/unexpired Share capability | OpenAPI 覆盖顶层 userBearer；不以额外 Authorization 授权，也不因其存在而拒绝；只读分享不授予 Run control/HITL/events/未分享文件 |
| `GET /v1/system/runtime-manifest`             | `serviceHeader + internalSecret` + server-side tenant/domain         | OpenAPI 覆盖顶层 userBearer；无 fake user，不是 IAM fallback                                                                    |
| `POST /internal/bff/scheduled-tasks/dispatch` | 独立 Scheduler bearer + trusted event headers + durable receipt      | 不属于 public OpenAPI 顶层 security，不接受 Web session Bearer                                                                  |

四类凭据不可互换。`x-kokoro-permission` 继续表示 Product operation 的动作意图；IAM session admission 不返回也不合成
公开 API 的业务 permission，BFF-owned facts 仍由资源 predicate 授权。

### Task 2 当前 contract：个人私有资源

W1D-Chat-B1 目标语义：`POST /v1/sessions/{id}/messages` 对 Web 本地新造的
`conv_<UUID>` 可在首条合法消息的 BFF 事务中隐式创建 active Conversation；成功仍返回既有
`202 MessageReceiptResponse`，不增加独立 create-session operation。首条内容派生服务端标题，
body 不接受 title。既有 active Conversation 的追加消息行为不变；其他格式的缺失 ID、
已删除 ID、跨 tenant/subject 的 ID，以及不可见 Project 一律 fail closed 为 404。
客户端提供的 ID 不赋予任何既存资源权限。相同 `Idempotency-Key` 与请求摘要重试返回原 receipt，
同 key 不同内容返回 `409 idempotency_conflict`；同 ID 并发首发不会创建多条 Conversation。

普通用户资源默认 scope 为 IAM 验证得到的 `{ tenantId, subjectId }`，body/query/header 不能自报覆盖。Project 的
list/detail/slug/instruction/revisions/skills/tasks、ScheduledTask 的 list/detail/create/update/delete/retry、Chat/Message、
AG-UI events 与 cancel/resume/steer 都同时验证 tenant + subject。其他用户的 detail/mutation/control/events 与不存在资源使用同一
404，不通过 403 或字段差异泄漏存在性；list 不返回同 tenant 其他用户资源。Project slug 只在同一 owner scope 唯一，因此同租户
不同用户可使用相同 slug。

ScheduledTask create 中 `owner_id` 只取 trusted subject，body 不能指定；引用 `project_id` 必须属于相同 scope。Scheduler callback
继续从受信事件 tenant 与已存 task owner 建立内部执行身份，不把事件 body actor 变成 authority。Conversation 非空
`project_ref` 必须解析为同 scope Project；创建和后续 message/query/control 都 fail closed。message body 与 query 同时提供不同
`project_ref` 返回 `400 invalid_message`；Chat query `scope` 只允许省略、空或 `direct`，其他值返回 400，并且永远不作为 tenant
或共享授权来源。

显式 Share 仍是 Conversation 的独立只读 capability，可撤销/过期；持有 Share 不授权 Project、ScheduledTask、Run control、
HITL、AG-UI events 或未分享文件。Task 2 不引入 Project ACL、团队共享或通用 authorization table。

## Envelope 与字段

JSON 成功：

```json
{ "data": {}, "meta": { "request_id": "REQUEST_ID" } }
```

JSON 错误：

```json
{
  "error": { "code": "stable_code", "message": "Log-safe message" },
  "meta": { "request_id": "REQUEST_ID" }
}
```

外部 JSON 字段统一使用 `snake_case`，瞬时点使用 RFC 3339 UTC 毫秒精度。`ProjectInstructionRevision` 的 canonical
字段是 `updated_at`（`string`、`date-time`）和 `actor_name`，对应 schema example 也使用相同字段。此契约切片只更新
BFF 的机器事实与契约门禁；runtime mapper、Web consumer 和 `docs/api/v1/projects.md` 仍由 source/documentation owner
同步，在同步完成前不把运行时 parity 当作已验证事实。错误 `code` 可编程且稳定；message 不暴露 SQL、stack、credential
或 provider 原文。

业务 JSON 成功响应统一使用 `{data, meta}`，错误响应统一使用 `{error, meta}`。`/healthz` 的 `200`、`/readyz` 的
`200/503` 是明确的 probe `HealthResponse` 例外；probe 的无效请求和业务失败仍使用 `ErrorEnvelope`。SSE 响应使用
各自的 `text/event-stream` schema，不套 JSON envelope。

## 列表、并发与版本

- 列表使用 opaque cursor、稳定排序与明确 limit；客户端只原样回传 cursor。
- 当前 mutation 并发主要由 idempotency claim 和数据库约束控制；Project/ScheduledTask 尚未公开 version/ETag。
- `/v1` 的 breaking policy 与 provenance 见 [`../contract/README.md`](../contract/README.md)。删除 path/method、重命名
  operationId、收窄 schema 或改变 permission/idempotency 语义必须进入新版本。

## Library degraded contract history（旧 503 阶段，已被个人文件 200 替代）

历史上 `GET /v1/library` 保留既有 path、method、`listLibrary` operationId 与 operation metadata。`c5e9b3c` 在受信
service-envelope admission 通过后只返回 `503 storage_integration_unavailable`；Task 1 后它与其他普通用户 operation 一样，
还必须先通过 IAM Bearer admission。认证失败使用本页稳定 401/403/429/503 语义，admission 成功后仍返回 Storage 503。
503 使用 canonical `ErrorEnvelope`，当时的 `meta.request_id` 行为保持不变。机器契约曾删除
不可达的 200 success 与仅服务旧 transport 的 `LibraryResponse`/`LibraryItem` schema；这不是 Library 可用性声明。

此处旧全 Library 前置现已拆分：上文个人 `kind=file` 首片以已发布 Storage personal CLEAN ASSET
ListAssets、本人 admission 和单 kind 分页定义独立 200；Agent Artifact/Capability 关联与 `kind=all` 仍待
trusted Run/ExecutionIdentity、能力 scope 和双源复合分页分别定稿。W1 IAM admission 已在 Task 1 闭环。
本切片不激活 Storage edge，不接受旧 HTTP fallback，也不把 placeholder 200 当作兼容承诺。

## Platform projection dependency（当前实现）

五个 public read 的唯一机器定义是本仓 OpenAPI；内部 consumer 由 Platform owner 3.1.0 artifact 固定生成，`contract/dependencies/platform-http.json` pin 完整来源与生成结果。严格 `{data}`/`{error}`，不再提供旧 `{data,meta}` read envelope、Capability 2.0.0 双读、伪造 MCP 字段。请求 tenant/user 来自当次 IAM Product admission，不从 body 或浏览器自报；BFF 使用专用 projection workload token。Root 真组合与 Web caller 待验。

## 幂等：当前事实与目标

除无副作用 GitHub preview 外，POST/PATCH/DELETE 要求 `Idempotency-Key`。当前 scope 为 namespace、actor、method、canonical
path 和 key；fingerprint 覆盖 method、canonical path、排序 query、canonical body、content-type 与 `if-match`。Live 且
business store 配置时 receipt 持久化到 PostgreSQL；否则部分
非 BFF-owned Live mutation 和 Mock 使用进程内 Map。

目标仍需按 operation 确认更多 selected headers，并让普通 receipt、BFF business fact 与 outbox 在同一事务提交；该目标
尚未统一。现有资源 owner predicate 先于通用 receipt replay/claim，防止同 tenant 其他用户重放已存在结果；repository/事务继续重验。

## Chat snapshot `active_run`（首片不改机器契约）

`GET /v1/sessions/{id}` 已有 optional strict `{run_id,status}` 的 `active_run`，且现 enum 已包含 `running`。Root 首片裁决保持 v1 OpenAPI 原字节：runtime 只恢复既有 `running` 表示，不增加 `queued`、不删除 terminal enum、不建立 alias，也不要求消费者版本升级。机器契约中其他 status 的既有声明不等于本片有 durable owner事实或会输出；queued/waiting/pending 的完整语义另过版本与数据门。

snapshot 从一个 PostgreSQL read snapshot 返回 Conversation、Message、Delivery、`event_watermark` 与可证明的 active run。先通过可信 tenant/subject/Project Conversation predicate，再按同一 tenant/session 读取 durable stream。设 E=`expected_run_id`、L=`latest_run_id`、T=`terminal_run_id`：仅 `E!=null && T==null && L==E` 输出 `{run_id:E,status:"running"}`；`E==null`、`T==E`（无论L为何值）及 `T==null && L!=E` 均省略。不得从 Message status、outbox、consumer state 或 frame presence 推断，也不得把 latest old run 当 active identity。

当前 writer 的可达矩阵必须作为实现依据：`E=null` 的初始/历史 stream 可有 `(L,T)=(null,null),(R,null),(R,R)`，均省略；新 expected 可有 `(X,null,null)` 或 `(X,O,null)`；current start 为 `(X,X,null)` 并输出 running；current terminal/permanent dispatch failure 为 `(X,X,X)`；terminal 后晚到旧 start 可达 `(X,O,X)`，仍终态省略；active期间晚到旧 start 可达 `(X,O,null)`，保守省略。非 null marker 空白，或 `E=X` 且 `T=O` 的未知冲突抛 `CHAT_ACTIVE_RUN_STATE_INVALID` 并沿现内部失败响应，不自行新增 public error code。`E=null` 的历史组合不因无法认领而任意503。

下一片不改 contract tests 的 schema bytes，只增加行为断言：normal mid-run 输出 existing running；start前、new expected+old latest、active期间late old start、finished/error、terminal后late old start与permanent dispatch failure均省略或输出如上；覆盖同一RR快照、GC、跨tenant/subject/Project与deleted Conversation。`queued`、`waiting`、非空 `pending_pauses` 和 `files` 仍未闭环。

runtime 已实现该既有 shape 的 service 映射且 contract bytes 未变；Root 最终 Node22 format/lint/typecheck/contract191/architecture27/test506pass1skip/build 通过。Root 在自有临时库完成 canonical fresh install、定向8/8及全部7文件真实PG/Redis/localhost HTTP integration 47/47、0失败/0跳过；资源回收DB0、Redis新增0/baseline保留，日志 `/tmp/kokoro-bff-active-run-real-pg-final-green.log`。浏览器刷新续流/终态全文和完整生命周期仍未验收。

## AG-UI

W1D-Chat-B2 目标语义：`GET /v1/sessions/{id}` 的 `messages` 是最新至多 100 条、按
sequence 稳定升序呈现，与 `event_watermark` 来自同一 BFF PostgreSQL 读取快照；更早历史
使用独立 Message 分页接口。该 cursor 只表示此快照已持久化的 AG-UI ledger head，
不表示 Agent execution 的实时状态。首发 `202` 的 `assistant_message_id` 是 BFF 产品 Message ID，
与 Agent source `chat_message_id`/AG-UI segment ID 不要求相同。一个 run 的多段 assistant
输出在 BFF snapshot 中以最后一个实际已发布 segment 的权威 completed 正文（可为空）表示；中间段 completed
仅维持 `streaming`，run success 才标记 `completed`，run failure/cancel 标记 `failed`。
Agent HTTP consumer W1D-Chat-B3 将 owner `contract/openapi/v1/openapi.json` v1.1.0 固定于
`520ec181a101298b4f336aad273ce003b2735955` / SHA-256
`2b9c7aad6f38db3e20200b037e4818ae932209ba3deecabf8fc984db6bcec492`。仅生成
`createRun`/`replaySessionEvents`，分别只接受 202 `LaunchReceiptEnvelope` 与 200
`ReplayPageEnvelope`；缺少或多出 wire 字段、裸 body、204、非法 enum/int64/epoch 时间值均视为
owner contract mismatch。BFF 自有 run/session 比对和 source seq 连续性仍独立执行；Agent
运行时未列出的 replay 400、x-request-id 与 error retryable 差异留 Agent owner 后续修正。

Agent owner main `520ec181a101298b4f336aad273ce003b2735955` 已发布空
`assistant.completed(content="")` source；BFF 按该真实事件覆盖此前草稿，且不伪造缺失终帧。
以上不改变已发布 JSON 字段、SSE frame 或 cursor 形状。

`GET /v1/sessions/{id}/events` 的网络 payload 是 AG-UI SSE。BFF 不发布 legacy SessionEvent wire，也不发布 Vercel
AI SDK data stream。独立后台 projector 把 Live source 事件原子写入 BFF PostgreSQL ledger 后，HTTP 才能读取；每个
AG-UI frame 的 SSE `id` 都是独立
`agui_*` opaque cursor。客户端只保存并原样回传最后确认的 `id`，不得解析、构造或跨 tenant/session 复用；replay
严格从该 cursor 对应内部位置之后开始。

Agent source `seq` 只保留在 AG-UI `metadata.kokoro` 中用于诊断和投影 provenance，不是 public cursor。当前 session 内
无效格式或未知 `Last-Event-ID` 返回 `400 invalid_event_cursor`；不属于 trusted tenant 的 session 返回与普通缺失一致的
`404 session_not_found`。已知但已被 retention GC 回收的 cursor 返回 `410 event_cursor_expired`。终态已提交时，即使 Agent disabled/unavailable，
BFF 重启后仍可只从 PostgreSQL replay；Redis 不参与 cursor 解析或历史读取。`event_watermark` 是当前 public ledger head
cursor；第一帧尚未产生时为 `null`。

projector 通过 PostgreSQL lease/token/fence 独立于浏览器连接运行；后台 GC 以最新 `RUN_STARTED` 的 public sequence
作为安全回收边界，只回收该边界之前且超过 retention 的旧 run frame，并保留从边界到 head 的完整 run slice；没有
可靠边界时不回收该 stream。retention floor 与有界 cursor tombstone 同步维护。字段级定义与例子只看 canonical OpenAPI；实现、
恢复和剩余缺口见 [`TECHNICAL_DESIGN.md`](./TECHNICAL_DESIGN.md)、[`RELIABILITY.md`](./RELIABILITY.md) 与
[`CURRENT.md`](./CURRENT.md)。

## 资源文档

资源路径、请求、响应和示例从 [`api/README.md`](./api/README.md) 进入。OpenAPI 与资源文档冲突时以 canonical
OpenAPI 为字段事实源，以 `CURRENT.md` 判断运行时是否已接线。

## System owner dependency

`GET /v1/system/runtime-manifest` 与 `GET /v1/models` 分别消费 System owner 的
`GET /v1/system/runtime-manifest` 和 `GET /v1/system/model-catalog/catalog`。owner wire JSON 使用
snake_case、成功 envelope 仅为 `{data}`，request ID 仅由 `x-request-id` header 表达；BFF 再按本仓
public v1 envelope 投影。旧 `meta` 与裸 body 均拒绝；System 错误必须是仅含
`error.code`、`error.message`、布尔 `error.retryable` 的 owner envelope。模型目录的 `key`、
`display_name`、布尔 `is_default` 与必填的 string/null `next_cursor` 被严格消费。

## Scheduler control and event dependency

W0B-9 已把固定 artifact 生成并接入 BFF control 与 event runtime。Scheduler producer 的唯一机器来源是 commit
`92bf9e7e6724c591bab4b7fa27f08d694b59a67e` 的 `contract/openapi/v1/openapi.yaml`（version `1.0.0`，SHA-256
`6ec2f6d5d71efa60b92bba1eb2dd0c81b7439734e2bc4450caa221e952e24183`），本仓只读 vendor 与
`contract/dependencies/scheduler.json` 绑定它；不把 internal/event operations 加入本仓 public OpenAPI。

- Control：`/internal/scheduler/v1/schedules/{name}`，generated create/replace/delete consumer；以 bearer service token
  认证，tenant 使用 `X-Kokoro-Tenant-Id`，关联使用 `X-Request-Id`，command `Idempotency-Key` 来自 durable outbox。
  请求、成功/错误（当前 owner 的 `{data,meta}` / `{error,meta}`）均按 pinned owner schema 校验；本切片不替 owner 重写 envelope。
  稳定错误只使用 `schedule_already_exists` / `schedule_not_found`。BFF 不消费不存在的 Schedule GET/list 或 occurrence query API，
  不自造分页/recovery query。pause/resume 虽由 owner 发布，本切片只通过 replace 的 paused 字段表达业务启停。
- Event：producer 的 `webhooks.scheduleOccurrenceDispatch` 拥有 POST/PUT wire schema、headers、at-least-once delivery
  和 retry classification；BFF 配置的 target 是 `POST /internal/bff/scheduled-tasks/dispatch`，PUT 返回 405，
  不是承诺实现所有 producer 支持的 target method。BFF target 必须启用 bearer token，即使 producer schema 允许其他 target 无认证。
- Receiver 首先验证 Scheduler 服务凭据，再把 `X-Kokoro-Tenant-Id` 作为唯一 trusted tenant。
  BFF payload `tenant_id` 仅作完整性字段，必须逐字等于受信 header；不一致返回 `400 invalid_scheduler_dispatch`，
  不用 body 建立身份，也不采用旧 namespace/job header。`task_id` 与 schedule name 必须符合 BFF 映射，`owner_id` 必须匹配
  受信 tenant 下的 stored task；prompt/project/auto_approve/timezone 是 BFF payload 的业务映射与一致性校验，不上升为 Scheduler schema。
- `X-Kokoro-Scheduler-Schedule`、`X-Kokoro-Scheduler-Occurrence`、`X-Request-Id`、`Idempotency-Key`、`traceparent`
  按生成 webhook validator 校验，headers 大小写按 HTTP 规则归一。Scheduler key 是 opaque，存储原值，不 trim、解析、重构，
  不校验自造 `schedule:<name>:<time>` 格式；owner schema 长度上限仍生效。生成 validator 的 transform 后对象不作为摘要输入；
  接纳成功后保留原始 parsed JSON 的全部 own keys（包括顶层/嵌套 `__proto__`）。

### Semantic digest 与身份

semantic digest 是 SHA-256(UTF-8 canonical JSON([trusted tenant, schedule, canonical RFC3339Nano occurrence, parsed body]))。
occurrence 只接受合法 UTC `YYYY-MM-DDTHH:mm:ss[.fraction]Z`，fraction 为 1..9 位；规范化仅去掉末尾零和空小数点，
保留纳秒区分，以手写 proleptic Gregorian 规则校验四位年（含 `0000`/`0099`/`0100`），不使用会把 0..99 映射到
1900..1999 的 `Date.UTC`，拒绝无效日历日期、秒 60、偏移量及旧 compact 时间。无 fraction 与全零 fraction
表示相同 instant。request ID、traceparent、header 排列和 JSON 原始空白不参与摘要，opaque key 只索引 receipt，不参与 digest。

canonical JSON 对对象递归按 UTF-16 code unit 排序键，并按该顺序逐项递归序列化为文本：
每项是 JSON.stringify(key) + ":" + canonical(value)，用逗号连接后包在花括号内；数组逐项递归序列化、保持原顺序。
JSON.stringify 仅用于 key 与 scalar 的转义/编码，不将排序后的条目重建为 object 再整体 stringify，因为 JavaScript
会把 integer-index key 重排为数值顺序。例如 `"2"`、`"10"`、`"01"` 必须输出为 `"01"`、`"10"`、`"2"`，嵌套对象同样如此。
字符串不做 Unicode normalization。入口使用 JSON.parse 的 JSON 语义（重复键取最后一项），仅允许有限 IEEE-754 number，
`-0` 归一为 `0`；溢出为 Infinity 的数字、非 JSON 值拒绝，不跳过任何已接纳字段。顶层必须是 object。
该算法是本 receiver 的版本化规则，不是声称完整实现 RFC 8785；W0B-9 独立 unit 测试必须锁定 `"2"`/`"10"`/`"01"`
及嵌套数字键的精确输出，并覆盖 Unicode、嵌套键、数组、数字、request ID 变化和纳秒差异。
本设计的文档治理断言不构成 canonical JSON 算法已实现或已验收的证据。

receipt scope 为 JSON.stringify([trusted tenant, "scheduler-dispatch:v1", opaque key])，排除 payload actor 与请求关联字段。
同 scope 不同 digest 恒为 `409 idempotency_conflict`，包括 pending 已超时、失败与重启后；同 digest terminal 重放原 status/body。
同 digest 活跃 pending 为 `425 idempotency_in_progress`，不能返回 producer 视为永久错误的 409。
首次不可信/非法入参为 400，认证失败为 401，任务不存在/不可见为 404，任务不活动或 snapshot 不一致为 409，过期为 410；
这些明确终态不触发第二个 Run。持久 store 缺失/不可用、依赖配置失败为 503；Agent 网络/响应未知为 502，保留可恢复 receipt。
返回 202 仅在 Agent 确认相同 Run 且 terminal receipt 落盘后；响应丢失通过原 receipt 重放。
Scheduler Agent admission 还必须有大于零的 `database remaining lease - monotonic elapsed - settlement reserve`；预算耗尽不执行 Agent I/O。
该专用预算上限不改变普通 Chat/owner 调用的全局 upstream timeout。

receiver 的 Run identity 只依赖 trusted tenant + schedule + canonical occurrence（无歧义 JSON tuple + SHA-256），
与 opaque key、actor 和 payload 变化解耦；改变 key 不得产生同 occurrence 的第二个 Run，Agent 对不同 launch 参数须冲突而非新建。
body 仍需 tenant 完整性与业务授权校验；身份摘要不是授权凭据。pending snapshot、claim token、保留策略见 DATA_MODEL。
producer 的 408/425/429/5xx 可重试，其他非 2xx 永久失败；BFF 不重新定义其 retry 分类。
owner artifact 升级须更新 commit/digest/config provenance、重新生成和验证两条 consumer 边界，breaking 变更按 owner 版本策略评审；
W0B-9 clean-slate 同时删除 jobs/job_*、旧 header 与 compact occurrence 路径，不维护 alias 或双协议 fallback。

## W1E Product Skill mutation 契约目标（已废止的历史基线）

**历史基线，勿作为当前消费者契约。** 本节保留 W1E 当时的六操作规划与前置条件；当前 Validate 以[顶部 W3 Validate public 机器候选](#w3-validate-public-机器候选2026-09-29尚无运行路由)和[唯一 public OpenAPI](../contract/openapi/v1/openapi.yaml)为准。owner v4 `ValidateSkillDraftRequest.attempt_id`（Proto tag 7）对应 public strict body **必填 `attempt_id`**；下表及后文“仅资源标识与幂等身份”、尚无 Validate 机器契约等表述均只描述旧基线，不得复制为现行请求。

当前 public canonical OpenAPI 与运行时代码没有下表六 catalog mutation；已有 name/revisions、enable/disable、GitHub import 等
声明仍不构成 owner mutation 接通。此设计不修改机器契约，不增加浏览器 IAM relay。四 scope 权限规则与 pin 顺序见
[技术方案](TECHNICAL_DESIGN.md#w1e-product-skill-mutation-设计门2026-09-28目标态)。

下表是 BFF 下一 public OpenAPI 切片的目标；字段细节以该切片发布的机器契约为准，不能拿本文充当 generated SDK 输入。
全部使用 Product service envelope + 当前用户 admission、`Idempotency-Key`、strict body，返回 `{data: ...}` 与 `x-request-id`。
业务 ID 使用 owner opaque Skill ID，不将旧 name 路径保留为 alias。

| Public 目标                           | Platform RPC       | action / 请求与成功表示                                                                                                                                   |
| ------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/skills/drafts`              | CreateSkillDraft   | create_draft；首个 user-only 切片由受信 subject 固定 owner，不接受 owner_scope；201 skill_id/series_id/revision/status/replayed                           |
| `POST /v1/skills/{skill_id}/versions` | CreateSkillVersion | create_version；metadata，base_skill_id 来自 path，owner_scope 从 base 事实解析；201 新 skill_id/series_id/revision/status/replayed                       |
| `POST /v1/skills/{skill_id}/validate` | ValidateSkillDraft | validate_draft；resource 来自 path，幂等身份来自 header，不接受 asset/digest body；200 valid/content_digest/manifest_identity/skill_id/series_id/replayed |
| `POST /v1/skills/{skill_id}/publish`  | PublishSkill       | publish；visibility；200 source_ref/revision/status/event_id/replayed                                                                                     |
| `POST /v1/skills/withdrawals`         | WithdrawSkill      | withdraw；source_ref/reason；200 source_ref/status/event_id/replayed                                                                                      |
| `PATCH /v1/skills/{skill_id}/status`  | SetSkillStatus     | set_status；status 白名单；200 skill_id/revision/status/replayed                                                                                          |

上表 Validate 行仅记录 W1E 当时规划；当前 v4 public 请求另**必填 `attempt_id`**，以顶部 W3 契约及唯一 OpenAPI 为准。
上表 Publish 行的 caller visibility 也是 W1E 历史规划；当前 public Publish 机器候选严格零字节 body，BFF 后续运行时仅固定 PERSONAL(1)，以顶部 W3 契约及唯一 OpenAPI 为准。

organization 每条操作调用 IAM `POST /internal/v1/tenants/{tenant_id}/skill-authorizations/check`，body 只有准确 `action`。
使用当前具名 user Bearer；200 仅接受 allowed=true 且 tenant_id/subject_id/action 与本请求一致；任何缺失、额外或错配字段 fail closed。
user/project/session 使用 BFF 当前资源事实，不能把组织 skill allow 外推到个人、Project 或 Conversation。
发布 visibility 不改变 owner_scope，也不自动创建个人分享或组织成员权限。已有资源必须先得到 Platform 真实 owner，禁止 body 自报。

upload 的 begin_upload/complete_upload/abort_upload 与 installation 的 install/set_installation_enabled/remove_installation
沿用四 scope 规则及 IAM 同名 action；安装要分别检查 source 可见性与 target owner 写权，source 可读不等于 target 可写。
这些动作不是本片六 catalog API 的伪装复用：Storage package upload 契约、Platform installation Product admission 和 BFF public
对应路径均需后续 owner pin/机器契约发布。按本节历史基线，Validate 只提供资源标识与幂等身份等必要输入；当前 v4 请求另必填 `attempt_id`，见顶部契约。Platform 从已持久化的 Complete 包绑定
读取 asset reference 与 content digest，并联合 Storage 重验 clean/归属/摘要；没有有效 Complete 绑定时拒绝 Validate。
Storage→Platform Begin/Complete 上传链及持久包绑定必须先于 Validate/Publish 成功路径激活，Publish 还要求有效的包验证状态；
该硬前置未就绪时两动作保持 fail closed，不把其余 catalog 操作可用宣称为六条 mutation 全部可成功。
Platform owner `5b6eb2c1532b23b9747bc4bf6ac99f69ad453de0` 已发布 CreateDraft 的受信 Product context 与 inactive/routable=false execution artifact v3；
下节首片据此固定消费。Validate/Publish 的 Storage 包绑定仍属于后续范围，不阻塞 CreateDraft，也不允许借首片转发浏览器任意
asset/hash。包 bytes 不走小型 RPC JSON，不接受浏览器自报扫描通过。

### 幂等、错误与撤权

目标 BFF 不使用通用 mutation receipt/Map 缓存 Skill 成功结果。每次重试先 admission 和当前 scope/action check，再调用 Platform；
稳定 command identity 绑定 tenant、subject、operation、真实 owner scope、目标资源与 public key，semantic digest 包含规范化 body，
不包含 request ID、token 或每次变化的授权凭据。具体 command 编码与长度由 Platform 发布契约约束，BFF 不另造持久 receipt。
同 key/digest 由 Platform durable receipt 返回 replayed，同 key 不同 digest 为冲突；跨 subject/tenant 不共享结果。
超时与响应丢失不生成新 command；禁止未经证明的自动 mutation retry。owner 在当前权限与资源范围检查之前不得 replay 历史成功。

阶段 B HTTP 映射固定为：413 `request_body_too_large`；入口准入只沿用 `service_auth_failed`、`session_authentication_required`、`session_invalid`、`session_forbidden`、`session_rate_limited`、`product_tenant_not_configured`、`product_tenant_forbidden`、`iam_admission_unavailable`，不新增 `unauthorized` 等 alias。429 可带 1..99999 秒的可选 `Retry-After`。

目标 public 稳定映射：无效 body 400 invalid_skill_request；session 失效 401 unauthorized；当前动作拒绝 403 skill_forbidden；
不可见或跨 tenant 的资源 404 skill_not_found；digest/状态冲突 409 skill_conflict；package/状态前置不满足 412 skill_precondition_failed；
限流 429 skill_rate_limited；IAM 依赖不可用 503 iam_admission_unavailable，Platform/Storage 暂不可用 503 skill_dependency_unavailable；
响应结构或绑定非法 502 skill_response_invalid。retryable 只用于契约允许的瞬时错误，不透出 token/内部 owner payload。
这些新增 Skill code/status 须先落 canonical OpenAPI 与 contract tests；当前运行错误码保持原事实，不提前声称已实现。
无权限时不发 mutation；跨 owner 并发撤权时点与受信 Product 上下文由 Platform 前置协议收敛，未收敛不放行 public mutation。

### 首个 user CreateSkillDraft public 契约（下一机器契约切片）

本节把首个正向链收敛为一个 operation；`contract/openapi/v1/openapi.yaml` 与冻结 surface 已发布候选机器契约，候选 runtime route 已实现但默认入口仍 fail closed，真实 IAM→BFF→Platform sandbox 尚未验证。

```http
POST /v1/skills/drafts
Idempotency-Key: 1..128 visible-ASCII bytes
Content-Type: application/json

{
  "display_name": "Research assistant",
  "summary": "Searches and synthesizes evidence",
  "tags": ["research", "writing"]
}
```

operation metadata 固定为 `operationId=createSkillDraft`、`x-kokoro-owner=kokoro-bff`、
`x-kokoro-visibility=public`、`x-kokoro-stability=beta`、`x-kokoro-idempotency=required`、
`x-kokoro-permission=product.skill.create_draft`。该值只是 BFF Product operation 分类，不新增 Web OAuth scope，也不触发 organization
IAM action check。不接受 query、尾斜线 alias 或其他 method。body 三字段全部 required，object
`additionalProperties:false`；因此 `tenant_id`、`subject_id`、`owner_scope`、`product_context`、`command`、
`request_digest`、`metadata_json` 和 package/asset/hash 都是非法额外字段。`display_name` 必须含非空白字符且不超过 255
UTF-16 code units；`summary` 可为空但不超过 65,535 UTF-16 code units；`tags` 是最多 100 项的数组，每项为含非空白字符且不超过
128 UTF-16 code units 的 string，精确重复拒绝，顺序保留并参与命令摘要。BFF 不 trim 或重排这些值，首片给 Platform 的
`metadata_json` 固定为 UTF-8 `{}`。
OpenAPI `maxLength` 的 Unicode 字符计数不等同于 JavaScript/Platform 的 UTF-16 code-unit `.length`；实现与 contract tests 必须用含 emoji 的边界值锁定上述精确规则，不以机器 schema 的单个 `maxLength` 声称等价。

`Idempotency-Key` 只能出现一次，不 trim；空值、OWS 之外的空白、非 ASCII、逗号合并和超过 128 bytes 都返回
`400 invalid_idempotency_key`。缺失返回 `400 idempotency_key_required`。BFF 用已验证 `tenant_id`、`subject_id`、operation 与
该 key 派生固定 `command_id`；Platform v3 projector从可信 tenant、个人 owner、Product context 和三项 metadata（含固定 `{}` bytes）
生成 `request_digest`。同 tenant/subject/key/请求语义重试由 Platform durable receipt 返回原资源并把 `replayed` 置 true；同
tenant/subject/key 但任一 body 值或 tag 顺序变化返回 409，BFF 不另存 receipt，也不自动 retry。

唯一成功是 201；新 operation 按 Root API 手册只把请求关联 ID 放在 `x-request-id` header，不复制现有旧 BFF envelope 中的 `meta.request_id`：

```json
{
  "data": {
    "skill_id": "skill_opaque",
    "series_id": "series_opaque",
    "revision": 1,
    "status": "draft",
    "replayed": false
  }
}
```

`skill_id` 与 `series_id` 必须匹配 Platform Proto 的 1..191 ASCII-byte opaque ID domain
`^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])`；CreateDraft 只接受 `revision=1`、owner enum `DRAFT`，public 投影为
`status="draft"`；`replayed` 是严格 boolean。同一 completed receipt replay 仍返回 201 和相同 ID/revision/status，仅
`replayed=true`。所有响应带 BFF `x-request-id` 与 `Cache-Control:no-store`；错误体使用 `{ "error": { "code", "message", "retryable" } }`，不含 `meta.request_id`；不透出 machine token、Platform request/metadata、
Connect trailers 或 owner message。

| HTTP    | 稳定 code                                              | 精确来源/语义                                                                                                                                             | retryable |
| ------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 400     | `invalid_skill_request`                                | strict body、字段长度/重复 tag 或本地投影非法                                                                                                             | false     |
| 400     | `idempotency_key_required` / `invalid_idempotency_key` | key 缺失或不满足上述唯一 header 规则                                                                                                                      | false     |
| 401/403 | 既有 session admission code                            | 用户 session、服务调用资格或固定 tenant 被拒绝；发生在 body、幂等与 Platform I/O 前                                                                       | false     |
| 429/503 | 既有 session admission code                            | IAM session 限流或不可用；发生在 body、幂等与 Platform I/O 前                                                                                             | true      |
| 409     | `skill_idempotency_conflict`                           | Platform `ALREADY_EXISTS`：同派生命令、不同 v3 digest/operation                                                                                           | false     |
| 409     | `skill_command_in_progress`                            | Platform `ABORTED`：相同命令正在处理或 fence 尚未收敛                                                                                                     | true      |
| 412     | `skill_precondition_failed`                            | Platform 明确 `FAILED_PRECONDITION`；CreateDraft 正常正向链不产生该状态                                                                                   | false     |
| 413     | `request_body_too_large`                               | BFF body budget                                                                                                                                           | false     |
| 429     | `skill_rate_limited`                                   | Platform `RESOURCE_EXHAUSTED`；只保留合法有界 Retry-After                                                                                                 | true      |
| 502     | `skill_response_invalid`                               | 非法 ID/revision/status/body、意外 PermissionDenied/NotFound、未知或矛盾 Connect code                                                                     | false     |
| 503     | `skill_dependency_unavailable`                         | catalog credential/token、Platform 配置/transport、deadline、`UNAVAILABLE` 或 machine workload 的 Connect `UNAUTHENTICATED`；不映射为用户 401、不自动重试 | true      |

客户端取消会贯穿 IAM token exchange/Platform RPC，不伪造一个 JSON 成功或自动重发。BFF 当前用户 Bearer 只用于 IAM session
admission；user CreateDraft 不调用 organization Skill action，也不把该 Bearer发给 Platform。Platform consumer 精确固定
`kokoro-platform@5b6eb2c1532b23b9747bc4bf6ac99f69ad453de0` 的 `kokoro.platform.v1.SkillCatalogService/CreateSkillDraft`、
Proto SHA-256 `282bf886ea9648f7ce5208abd36ab47d879b2002a036d90aada2af59e74b4020` 和 execution artifact v3 aggregate
`324e749da1bc66c1ff03de74e7299716f798f5f5bb5fa19556033b79fa09ff8d`（inactive/routable=false）；旧 Capability HTTP mutation、v1 digest或手写
Proto DTO 都不是 fallback。

## W1E IAM 0.7 pin 仓内事实

本仓 IAM vendor/manifest/provenance 当前固定 `e3c035b99cf9479ac8357c7d38147f1541dcbcac` 的 0.7.0；四项 owner 输入与前一 `4d981441d154c83b63987f284e3a82a559595870` pin 逐 byte 相同，16 个生成 SDK 文件保持原始字节不变；
public OpenAPI、browser relay route/method/header/cookie 策略不变。新增 server consumer 仅使用具名
`POST /internal/v1/tenants/{tenant_id}/skill-authorizations/check`，body 仅 action，用户 Bearer 不转发给 Platform。
200 的 allowed 必须为 true，tenant_id/subject_id/action 与本请求逐字一致，外层与 data 额外字段拒绝；
所有接纳响应要求有效 x-request-id、Cache-Control no-store 与 application/json。owner 401/403/429 必须分别匹配
UNAUTHENTICATED/PERMISSION_DENIED/RATE_LIMITED，状态/机器码矛盾 fail closed；有效配对分别归一为
session_invalid/skill_forbidden/skill_rate_limited，坏响应、超时、未知状态及依赖故障归一为 503 iam_admission_unavailable。
这些是内部窄调用结果，不表示上述目标 public Skill mutation/错误 schema 已发布；旧 Session 与 Team 行为不改。

## W2 项目资源单文件上传

现有 `uploadProjectResources` operation 保持 multipart/form-data 的 `files` 字段与 Idempotency-Key；首片恰好一个File、无其他字段/query，总body上限1 MiB。文件名1..255 Unicode码点，无控制字符、斜杠、反斜杠及`.`/`..`；MIME为有界type/subtype，空MIME采用application/octet-stream。服务端计算真实SHA-256和size，不接收body身份、hash或Storage引用。项目path可为既有查询标识，Storage scope固定为查询返回canonical project.id。

成功200 `{data:{resources:[{upload_id,asset_id,filename,mime_type,size_bytes,content_sha256,scan_state}]},meta:{request_id}}`；size_bytes为十进制string，scan_state仅clean；CompleteUpload与GetAsset均检查scan，infected稳定422 `resource_file_infected`且不可重试（终态receipt），pending/unknown稳定503 `resource_scan_pending`可用同key重查已完成资产，不返回resources或下载引用。x-request-id/no-store；不存在或非本人项目404；非法输入400、超限413、同key异义/正在执行/原上传已abort为409；配置/Storage/PUT未知失败503，坏owner响应502。响应不含签名URL、secret或provider错误。失败不得伪造资产；相同key恢复原上传，已abort时需新key明确新尝试。只有完整成功才保存外层成功receipt，当前授权先于重放。

独立凭据代言固定web-bff+受信tenant/subject+project scope；owner仅从固定版本Proto生成。全局Library、Skill包和多文件不属于本片。

### W2 项目资源读取契约（当前）

固定 Storage owner `ef0fd7779bf434120ac1f8a58592222f534a7c45` 的 v2 `ListAssets`，已发布 `GET /v1/projects/{projectId}/resources?limit=…&cursor=…`。它是 public Product API，由 BFF 在每次请求先校验固定租户/当前 User Bearer 与该私人 Project 的 tenant+subject predicate；不存在和无权同为 404。limit 默认50、范围1..100，cursor 长度1..4096且只含可见ASCII、opaque 且绑定受信 project/subject/filter，不接受浏览器自报 tenant/scope。成功为 `{data:{items:[{asset_id,filename,mime_type,size_bytes,content_sha256,scan_state,created_at}],next_cursor},meta:{request_id}}`；只含 `ASSET`/`CLEAN`，不含 POST 独有的 `upload_id`、下载 URL、内部状态或 package。非法分页/cursor 400，owner 失败按既有 public 错误语义返回 502/503，不用 preview/mock 200 替代。机器事实源仍是 `contract/openapi/v1/openapi.yaml`，新增 operationId `listProjectResources` 与 `ProjectResourceListResponse`；POST形态和checkpoint不变。
