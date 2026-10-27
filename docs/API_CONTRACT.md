## MCP-PREPARE-OUTCOME：独立错误政策1.0／lookup1.1（2026-10-27，Root 已固定；候选未正常配对）

保现Prepare POST及原 `GET /browser/v1/mcp/servers/{id}/prepare-receipt?expected_state_version=<原CAS>` 请求、header、completed response、身份／期限／no-store。唯一code-first `PREPARE_OUTCOME_FAULT_POLICY` 经原generator发布 `contract/mcp-prepare-outcomes-v1.json`；owner_feature仅由正式Native pin manifest派生，指向Platform f294正式feature。共享connector错误1.1、Public28.5和普通GET不扩。

| 单一closed typed reason＋Connect FailedPrecondition | 允许操作 | status／code／retryable | 事实及本地退休 |
| --- | --- | --- | --- |
| PREPARE_CONNECTION_REJECTED (4) | prepareServer、getMcpPrepareReceipt | 412／mcp_personal_prepare_rejected／false | definite_rejection／exact_failed，不归成功、不自动新命令 |
| PREPARE_EXECUTION_FENCED (5) | **仅getMcpPrepareReceipt** | 409／mcp_personal_prepare_execution_fenced／false | historical unknown＋local_execution=fenced；仅explicit_stop_waiting，automatic_intent_retirement_authorized=false |

lookup1.1 `completed_only=true` 明确仅success_wrapper；`negative_ack=true` 明确仅prepare_connection_rejected_typed_error_only，不增加negative DTO，reason5不纳negative。查询原件引用独立outcomes_source摘要及GET allowed_faults；same_command仍只GET原lookup，automatic_retries/new_command_authorized/prepare_authorized全false。POST政策不含5，也不由query政策授POST权限。缺/多/坏detail、错误code/type/字段/enum/operation或混合receipt marker均不授上述分类。旧generic409/412、processing含过期lease、missing/expired、当前prepare_failed均不冒确定拒绝或fenced。

## MCP-PREPARE-RECEIPT-D0：browser-private 原 Prepare 回执 GET（2026-10-27，Root 已批准；browser-private候选、未正式配对）

仅设计`GET /browser/v1/mcp/servers/{id}/prepare-receipt?expected_state_version=<原CAS>`，不加入Public OpenAPI。沿现browser service envelope＋Product Session、`mcp_personal`资源的`read` action及可信tenant/subject，Browser只走App same-origin adapter。owner具名query已固定正式`688bc1e3d74c18c54ca85bc72d8e4ce242ac995a`并原生接线；本仓仍是未正常激活的候选，不把peer冒成正常历史收口。

| 边界 | 约束 |
| --- | --- |
| path/query | 现Server ID闭集/canonical路径/精确GET；仅一个required `expected_state_version`，沿原Prepare十进制string CAS校验；不接body、current CAS别名、额外/重复query或fragment |
| lookup header | 恰一个原`Idempotency-Key`，沿可见ASCII1..191字符闭集，拒空白/重复raw header；只定位旧命令，不创建命令。仅本exact GET例外，其它GET继续拒该头；不收浏览器digest/tenant/subject |
| owner request | 独立request_id、command（原CommandIdentity）、server_id、expected_state_version。digest复用原Prepare method＋可信tenant/subject/exact server/原CAS，不按query method造新身份，不嵌套原request/双request_id |
| 200 | `{data:{completed:<原Prepare安全ACK>}}`；复用现Server/Connector/declarations/replayed表示，strict closed、replayed=true、exact server、历史state_version=原expected+1及精确关联。无negative/status分支、新Server DTO或额外current projection |
| 历史/current | owner重核当前本人可见性，但历史ACK不要求等于current CAS；原历史absent transport沿现replayed ACK规则，不补current transport/CAS；availability仅为owner当次本人同RR安全副本投影。下一写仍独立fresh current读取 |
| 生命周期 | 原总deadline/AbortSignal/1MiB传输界、发送前及出口fresh同主体/read action；no-store/x-request-id。零自动重试、零Prepare/claim/refresh、新key或执行许可 |

仅本具名query消费正式owner既有receipt marker：missing/foreign → `404/mcp_personal_not_found/false`，不是“未执行”证明；processing → 现`409/mcp_personal_command_in_progress/true`；expired → 现`412/mcp_personal_command_replay_expired/false`；旧不确定失败 → 现`503/mcp_personal_command_outcome_unknown/false`；key/digest/原CAS冲突 → 现`409/mcp_personal_idempotency_conflict/false`。未知/重复/错Connect code marker、混合detail、坏completed沿`502/mcp_personal_response_invalid/false`；身份拒绝先于owner I/O，依赖/取消/期限沿现有界依赖错误。其它普通GET继续拒receipt marker，不凭rawMessage分支或造negative枚举；marker精确规则以owner正式profile为准。

所有非completed都保原unknown，不授新key/重建/重发Prepare；same_command在本query仅允许再读原lookup，不解释为POST许可。本节覆盖10-24 prepare_inspection_recovery本次恢复后继的旧重放策略，旧tuple和历史证据保留。后继本feature code-first schema/政策沿现generator生成browser-private artifact，App固定正式commit/digest后再接；Public28.5原件与其它业务接口不扩大。现已有route/strict wrapper/lookup-only code-first profile与peer候选；已固定正式owner并实际Native Get配对；尚不称正常恢复。

## PROJECT-PIN-D0：个人固定读取与状态 PUT（2026-10-27，Root 已核 D0，Public28.5 本地候选）

固定偏好归 BFF Project owner，不修改原 Project closed 表示；后继只新增两条 public／beta operation，正式 canonical 仍 `contract/openapi/v1/openapi.yaml`，本节不是第二份机器 schema。身份沿当前 Session 和受信 tenant／subject，Root 已裁决 operation permission 均为 project.read＋现 owner-only、未删除 Project 可见性；这是 own preference write，不授 Project 共享写权限；完整 Session、服务身份方法边界和同源 CSRF 保持，body 不含 tenant／actor／subject，不新增 IAM action／协作 ACL。具体 owner／并发／部署门见 [技术设计](TECHNICAL_DESIGN.md) 同名 D0，数据见 [数据模型](DATA_MODEL.md)。

| 候选 operation | 闭合输入 | 200 当前表示 |
| --- | --- | --- |
| GET `/v1/self/project-pins`，listSelfProjectPins，idempotency none | 默认 limit=50，1..100；optional opaque cursor≤2048字节。或仅传单个 canonical project_id 作精确过滤，不能混用 limit／cursor；无正文／命令头，其余 query 拒绝 | `{data:{items:[{project_id,pinned_at}],next_cursor}}`；只列当前本人可见且已固定项目，空数组非失败。精确过滤先核可见性，未 pin 为200空 items／null cursor，不可见404 |
| PUT `/v1/projects/{projectId}/pin`，setProjectPin，idempotency natural | canonical ID、无 slug／query；strict JSON `{is_pinned:boolean}` ≤1KiB；拒 null／extra／主体／timestamp／rank／版本字段，拒 Idempotency-Key／If-Match | `{data:{project_id,is_pinned,pinned_at}}`；true 时 pinned_at 为已存 RFC3339 UTC，false 时为 null，重复 true 保原值、false 清除偏好而非删除 Project |

GET keyset 为 pinned_at DESC／project_id C 字节序 ASC，cursor 绑定当前 tenant／subject／limit／固定排序和位置；每页当前授权，不是全程快照，query 变化弃旧 cursor。单精确过滤不需要耗尽全列表；普通未耗尽分页不可证明缺席项目未 pin。每页≤64KiB、同一请求 admission／正文／SQL／出口共10秒绝对预算，AbortSignal 与迟到围栏贯穿；不暴露其他 subject、Project 内容、SQL 或凭据，不把 cursor 当权限。

沿既有 service／Session 准入401／403／429（限流头）／503；本操作400 project_pin_request_invalid（含坏／跨 scope cursor、闭集或 framing），404 project_not_found（不存在／非本人可见／删除，一致隐藏存在性），503 project_pin_unavailable（存储／期限／结果未知，retryable=true）；400／404 retryable=false，无新的409／412／receipt 查询。成功 no-store 与 x-request-id 沿本仓原 envelope，message 不作分支。503 的 bit 不授权自动 PUT，失败时不发假状态 ACK。

同 client 每 subject／project pending 串行，未知仅显式精确 GET 观察当前状态；相同值可收敛当前展示但不是原请求 receipt，不同值需用户明确下一次 PUT，跨设备／迟到写 LWW 不保证点击顺序。列表／精确读不写偏好；GET403／404不当作未固定。BFF schema／正式后继 artifact 先交付，App 再正规生成和同源接线；原192操作、Project wire、MCP definition pin／其回执及模型执行链保持，不先安装假入口或消费 dirty 契约。

## TOOL-ACTION-DETAIL-D0：Public28.4 候选动作详情与 Share null（2026-10-27，源码候选）

本地 canonical 候选 Public28.4.0／192操作已固定正式 Agent HTTP8.2.0 `fc8b0f09f3cfd96211b33d863d5e629bbed13e46`；OpenAPI／provenance 两原件经 Git blob／直接 SHA 校验与原18输出 generator 消费，不从 dirty 源码或浮动分支生成。完整 Public28.4 SHA256 `48aa9638d133223c9f78655e9398ddbb44159963f92a2db891a09212f3aa2726`，尚未发布或正常激活；无新 operation、URL、权限或协议。

唯一 public canonical 仍 `contract/openapi/v1/openapi.yaml`。候选 Public28.4.0 仅在 strict `RunToolActivity` 增 optional `display_detail`，形状 closed `{kind:"file"|"mcp_tool",name}`；原五字段 required、九个 display_code、subagent／Skill 保持。name 非空 NFC，1..120 Unicode scalar 且 UTF-8≤480 bytes，无控制字符（Cc）／Cf／孤立代理；拒绝未知 kind、额外字段、坏 Unicode／非 NFC、超限及非法 code/detail 配对，不截断、静默 normalize 或 generic fallback。file name 另受 canonical basename pattern 约束（非 .／..、无 /／反斜杠／冒号），MCP 公有声明 name 不套用文件限制。file 仅配 read／write／deliver 三个文件 code；mcp_tool 仅配 describe／call 两个 MCP code，其它 code 必须 absent。absence 与 null／空对象不同；历史 absent 原样读取、不回填。不发布参数／结果／完整路径／答案等替代详情；来源由 Agent typed producer 明确给出。

`RunProcessActivity` 仍为唯一 activity 图：同详情经原 CUSTOM `kokoro.activity.updated`、`RunExecutionProcess`／`RunProcessPage`、`MessageActivityPart.activity` 和 private ordered 重开同值承接。对同 activity_id，activity／segment_id／display_code／detail presence+值不可变，status 沿原语义；compact 与 Message fold 写前校验，漂移拒绝并原事务回滚。活动身份、首位置／latest、public_sequence、source seq/digest、opaque cursor、分页／重放、请求幂等和 actor 权限不变。

**Share 只做必要闭包。** 当前 `SessionSnapshotResponse` 仅由 `getSharedSessionSnapshot` 使用，却允许非 null execution_process；正式 PG runtime 又省略该 required 字段。后继保该 response 和 ChatMessage 原形，只将 execution_process 固定 null、runtime 补显式 null。正式／备用 Share 出口均保公开 message 白名单与原文件／delivery redaction，不读 private activity／parts、不 spread head／rendering／parts_cursor。PrivateSessionSnapshotResponse 不变；Share capability／服务身份不授当前 subject 的私有读取权，不向匿名 recipient 新增任何工具对象。App 共享 decoder 拒非 null，私有 extend 显式 override 由 App 后继承担，不扩 ACL／Share 管理。

固定生成闭包见 [本片技术设计](TECHNICAL_DESIGN.md#tool-action-detail-d0受信动作详情与共享隔离2026-10-27root-已裁决源码候选)：现 Agent config／generator 双 pin、vendor 两原件、dependency manifest及18输出；新边界参数从唯一 canonical 正规生成，运行校验补齐 compiler 尚未执行的 maxLength／pattern 语义。Public28.4 精确 inverse 恢复完整28.3 SHA256 `85a1b51cd151581b51d7ea7992d85e04462c03fafb36d0527e1df352dd85223a` 再走全部父链，不改旧证明／192 inventory；App 十个完整snapshot generator 统一固定正式 BFF commit/hash，独立 private pins 不动。

验收复用现 owner wire／source／parts／contract 回归与真实 PG＋正式 HTTP入口：闭集及Unicode界限、开始／完成稳定值、compact/fold漂移原子回滚、重复／replay／重开、历史 absence、当前 actor／scope及 Share secret-canary／撤权 race。源码候选／focused 通过不等真实 PG、发行或正常配对通过；无额外日志／传输／数据库／owner。

## 文件工具显示类别后继

当前 canonical 为 Public28.3.0／192 操作，保全部路径／operationId／请求与响应结构，仅 `RunToolActivity.display_code` 在原七值之后追加 `tool.file.write`、`tool.file.deliver`。分支仍 strict `{activity:"tool",activity_id,segment_id,status,display_code}`，status 仍 running／completed／failed；subagent／skill 独立分支不扩值。未知 code／错分支及 filename、args、path、result、secret 等额外字段不发布、不回退为 generic，旧 `tool.execution` 合法且原样读取。

Agent 依赖固定正式 HTTP8.1.0 `38c294d38cf05149c320622f52490f82fb1fff91`，完整 OpenAPI SHA256 `1642829ccf5364692051e836938ef33b36cffeca25f2b7766ad95cd44a1542c9`、provenance SHA256 `879695cfacd55014b9f6a28e3138d88bc009ba9d46acfac27497a26f0025acad`；vendor 取该 commit Git blob 并保留原8.0历史原件。沿原三操作 allowlist、generator 与 generated validators，不增加接口、认证、授权、执行或幂等行为。

同一安全 activity 贯通 live CUSTOM、compact、ordered Message parts 与 reopen，不添加只对其中一路的字段或第二套协议。原 JSONB／格式版本不变，无 DDL。后继全文精确逆回原 Public28.2 SHA256 `e0bb74069c65fb8d414a6a3cb0d6f4c8d9bcb40bb693c2409a9cbe051b8bac53` 后才复用未改历史父证明；原192操作库存不变。消费者先固定新闭集，再协调生产者输出新类别，避免旧 reader 拒绝新值；正常激活不由本文或类别存在推断。

## PROJECT-MCP-RECOMMENDATIONS-D1：项目推荐配置 GET／PUT（2026-10-27，本地候选、未正常激活）

Root已选BFF Project owner和完整三种ref，不再采用D0 provider-only协议。只管理现本人Project偏好，不是definition发布／grant／Connection创建；自然幂等配置PUT不要求Idempotency-Key，不增加receipt/journal/outbox。当前canonical源码候选Public28.2／192操作；固定28.1全文／190顺序parent与两列完整SQL父逆证，源码尚未提交／正常激活，不冒App消费者已接通。

| operation | 闭合输入／结果 | 语义 |
| --- | --- | --- |
| GET `/v1/projects/{projectId}/mcp-recommendations`，`getProjectMcpRecommendations` | 无query/body/Idempotency-Key；200 `{data:{project_id,recommendations,state_version}}` | current Session+exact本人未删除Project；返回已保存refs，即使已不可见，不解析成可用授权 |
| PUT 同路径，`replaceProjectMcpRecommendations` | strict JSON `{expected_state_version,recommendations}`；无query/Idempotency-Key；200同GET形状 | current Session+exact本人Project条件替换；只对新增ref复用对应现owner读取资格验证，无部分写／自动重发 |

`recommendations`是0..16个唯一闭合oneOf：`{kind:"provider",provider_key}`、`{kind:"mcp_connector",connector_id}`、`{kind:"custom_api",profile_id}`；对应ID必有且其他变体字段/额外键/null拒绝。provider key为`[a-z0-9][a-z0-9._-]{0,63}`；connector/profile ID为`[A-Za-z0-9][A-Za-z0-9._:-]{0,190}`。按kind ASCII再ID ASCII排序输出／保存；同kind+ID重复拒绝，不用display_name／URL／private key前缀猜kind。`[]`明确清空，缺字段不等于清空。state/expected均canonical十进制字符串`1..2147483647`、initial `1`。expected与锁中current不符412；相同canonical refs且CAS匹配时200原当前版、无写；真正变化才+1，MAX的变化拒绝412。不使用If-Match／ETag第二CAS。

新增差集基于首次权威current refs/version计算；若expected不符先拒绝、零owner调用。provider通过现exact personal provider GET；mcp_connector通过现exact本人connector GET并要求type=mcp／非revoked；custom_api通过现exact本人Custom API GET。保留的旧ref不重新验证、不因失效被隐式删除；新增不可见/撤销ref拒绝，当前owner timeout/错误是依赖失败而非缺失。校验只读，不访问secret、创建连接或OAuth；owner I/O期间不持PG锁，末端parent锁必须重新校CAS／主体／删除状态，变化即412而非重算后覆盖。目录／connector的当前MCP read和Custom API原Session/owner read边界均保留；不新增Platform/IAM授权。实际可用与执行另验，GET/PUT不输出execution_ready、配置secret或运行承诺。

成功200 data envelope、no-store/x-request-id；GET无body framing，PUT JSON≤16KiB，响应≤64KiB，原10秒总预算从admission/body至owner读取、SQL和出口重验，取消贯穿、无晚响应提交视图。规范permission为`project.read`／`project.update`且保持本人owner范围；idempotency metadata分别`none`／`natural`，不声明命令回执。当前Session/service/tenant/action准入错误沿既有边界；400 `project_mcp_recommendations_request_invalid`（闭集/请求头/格式）、404 `project_not_found`（不可见/删除/非exact Project）、412 `project_mcp_recommendations_precondition_failed`（CAS／新增ref不可见或撤销／版本耗尽）、502 `project_mcp_recommendations_response_invalid`（坏owner/表示）、503 `project_mcp_recommendations_dependency_unavailable`（依赖/期限/unknown）；503 retryable=true但不自动PUT，其他本操作自有错误retryable=false。不新增idempotency_conflict或永久receipt端点。正式machine须固化这些status/code/bit与原准入tuple，message不作分支。

网络失败／取消后的提交结果不推测。用户显式GET核当前配置：等于目标只能说“当前配置已是该值”，不认定原保存ACK；不同保草稿与行内冲突，经用户基于fresh state_version明确再保存。GET失败保原草稿，不生成新命令／自动覆盖。后台不对MessageCreate缺省或空 `selected_mcp_connection_ids` 默认继承。App仅pristine新项目draft将provider/mcp_connector解析到当前本人available Connection；多匹配用户明确选择、显式空选优先、原16个/4096bytes限制不变。Custom API ref仅配置，当前无Run Acquire/tool映射、不视为可执行；runtime缺口仍OPEN。原Platform发布pin与其所有receipt政策原样保留。

## 2026-10-26 Public28 / Agent8 工具展示闭集（源码候选，未正常激活）

正式目标为唯一 canonical Public28.0.0／187 operations，不新增 HTTP endpoint 或数据 Schema；Root 已授固定正式 Agent8 `ff36759214ff5d1e015cd9e288abbcb2d8e0c46d` 的 Git 原件消费与正规生成。Agent HTTP8.0.0 OpenAPI SHA256 `93103b5f1df90ad4524e7fc08274211ed2f0805760d70923931e9449a59e37ff`、provenance SHA256 `4333d87e7f2199d549afb1c3334bebf17af99682bcbc093e9b2bba204982570f`，本地 BFF 候选已固定此 HTTP8 pin；正常组合未因本片切换，不将候选路径或浮动源码当正式依赖。

`RunToolActivity.display_code` 唯一变化为 required string enum：`tool.execution`、`tool.file.read`、`tool.mcp.discover`、`tool.mcp.describe`、`tool.mcp.call`、`tool.web.search`、`tool.web.fetch`。字段／分支仍 closed，unknown、错类型、额外成员及用 subagent code 充 tool 均拒绝；subagent 只接受既有 `subagent.execution`。旧 generic 是合法历史事实，保持原值，不改写／升级成具体能力。

值由 Agent 正式 activity 提供，经现 HTTP decoder、`kokoro.activity.updated` CUSTOM、compact 与 ordered activity part 原样承接；保持 activity_id／segment_id、状态、first/latest/public_sequence 与原 source digest／范围绑定。它仅是安全展示类别，不是工具参数／结果、外部来源、浏览页数／耗时、审批或执行授权；不推测 final/commentary，不从工具名称或文案再分类。原准入、scope/actor、取消／迟到、unknown 管理命令、ledger／cursor／Message ACK 均不改变，无历史回写或新重试机制。

Public28 仅 version 与该 const→enum delta；具名 build/test-only inverse 必须恢复完整原 Public27 SHA256 `d2b3d546164cadc9655616fc44daf1511a6f7d4a2e5d172f1415552af8942ed1` 再进入原27→26及以下链，旧 hash／原件不修改。消费者等正式提交后固定 artifact 生成。新 code 落库后旧 reader 不具备可安全降级保证，正常激活／恢复须由 Root 固定完整配对；不因未知类别换 generic、漏掉过程或重发 Run。

## 2026-10-26 browser-private MCP Server 图标 GET

`GET /browser/v1/mcp/servers/{server_id}/icon` 是独立媒体资源；无 query/body/Idempotency-Key，精确 canonical ID 路径。成功200为原始 `image/png` 或 `image/jpeg`、精确 `content-length`，`cache-control:no-store`、`x-content-type-options:nosniff`、`referrer-policy:no-referrer`、原 `x-request-id`；绝不将 signed URL 增加为列表持久字段。metadata 列表不读取 Storage、不逐 server 补全。

沿现可信 service envelope + 人类 Session + 当前 MCP read 与10秒绝对预算。404 `mcp_personal_not_found`（无绑定/绑定改变），400 `invalid_mcp_personal_request`，502 `mcp_personal_response_invalid`，503 `mcp_personal_dependency_unavailable`（retryable=true）；其余当前 Session/action 准入 tuple 保持，所有失败是原 JSON error envelope，不输出部分图像。签名引用仅配置 origin／短时GET／无required headers，完整有界字节验证后，出口鲜读同绑定并重核主体/权限。无自动重试、命令恢复资格、RPC/Schema/Public27 改动；唯一新 HTTP 机器源 `src/application/mcp-server-icon.contract.ts`，正规生成 `contract/openapi/browser/v1/mcp-server-icon.json`。

## CHAT-ORDER-1：同 Message 有序 parts 与有界读取（2026-10-25 定案；2026-10-26 候选，正常未切）

**2026-10-26 实测后的 legacy 空完成充分证明（批准的窄后继）：** 正常R6存在12个不同ID的END-only及一个delivery帧；缺START不证明空，旧正文/ledger保持原样。允许仅用已保留BFF行构造固定Agent已发布wire形状的空完成候选，并复用原source payload canonicalJson/SHA256唯一算法；完整候选与原source_digest逐字精确匹配才承接该空槽。`source_index = source_sequence - first_retained_source_sequence` 只作有界候选，不是Agent不变量或公开坐标；任一身份、索引、时间、optional字段presence、event_type、payload_json原字节差异都保持legacy，不搜索／兼容序列化或新增网络依赖。所有原当前scope／dispatch／source／range／GC／512帧／4MiB／10秒门保持；仍要求唯一可见START与delta等持久正文、合法terminal。已证空ID不得后续重开，fold该槽只用真实空串，绝不把最终全文灌入；delivery仅具名非parts承接并推进原公开位置。无机器契约、Schema、权限或旧行/xmin写入；原Agent真实GET仅作为Root诊断证据，不进入运行读路径。

**D1D 公共坐标补充（2026-10-26，候选未正常生效）：** 原 `metadata.kokoro.seq` 是 Agent/BFF 各自源序号，不等于 durable public ledger 的 `public_sequence`；一次源事件可展开多个 frame，BFF admission 也占公开位置。每个 durable AG-UI data frame 的读取／replay 投影须从 PG 原十进制列暴露 required `metadata.kokoro.public_sequence`，保持原 seq 类型／source_owner、opaque cursor、source digest 与存储 payload/xmin 不变；不回填旧事件或改变 source 协议。完整 replay 字节预算计入新增字段，损坏位置／元数据不伪造。App 仅用该公开坐标与 parts revision 合并，绝不拿旧 seq/cursor 猜坐标；parts 领先 SSE 不推进全局 stream cursor，确认版本不因迟到 snapshot 降级。同段多页 confirmed baseline 与 live overlay 分开，避免重复 replay 后缀。Public27 尚未发布，追加固定 commit/digest 后消费者正规生成；完整 Public26 逆证与全部历史 hash 保持。

**D0已批准；Public27机器契约已本地9f46a8e固定（正常仍Public26）。** 原Session/Conversation/Project当前授权与AG-UI live协议保持。新增只服务private assistant的ordered read描述与一个Message continuation；user/legacy正文、shared DTO/原可读body/权限、MessageCreate与全部历史幂等ACK原形不变，不建公共parts续读或让匿名读过程。

private assistant具备完整ordered证明时，独立read形状保原message_id/role/status/run/failure等身份，content:null仅表示未内联，新增strict rendering：{mode:ordered,format_version:1,revision,event_watermark,parts_cursor}。snapshot先只ref，不重复塞聚合全文；event_watermark沿原EventWatermark的opaque AG-UI cursor或null，不是public_sequence；原shared复用的SessionSnapshotResponse保原字节，private另用PrivateSessionSnapshotResponse；可有很小首屏但非本片前置。无ordered证明的旧assistant维持原legacy正文，绝不把NULL变[]或发明序号。不得由缺rendering认定已确认写未执行并重派。

唯一新读取 GET /v1/sessions/{id}/messages/{messageId}/parts?cursor=...&limit=1..32，默认16逻辑slot；无body/幂等写key，不新事件流。每页核当前Session、tenant/subject、Conversation/Project及exact Message/run；no-store/request-id/JSON、取消及原10秒绝对预算保持。成功data绑定session_id/message_id/run_id、format_version/revision/event_watermark、items与next_cursor，封闭字段由唯一canonical后继定义。

items是text|activity判别片段。text含part_id、segment_id、first_sequence/latest_sequence、text、offset/end/total_scalars、completed；segment_id显式承接现已公开AG-UI messageId，part_id仍opaque，不靠拆ID匹配live。activity含part_id、first_sequence/latest_sequence、原strict safe activity。序号/版本/offset用canonical非负十进制string；first不随status修正移动。Unicode scalar左闭右开[offset,end)，不按UTF-16 code unit或UTF-8 byte拆断。同part多片不是多消息/多工具slot；不公开raw args/result、summary/checkpoint或秘密。

每text片段最多4096scalar；完整最终UTF-8 JSON含envelope/metadata≤1MiB，每页至多32逻辑slot；巨大text由同part下一offset续读，末片才转slot，不截正文冒完整。snapshot/messages沿现总1MiB出口只放有界描述，不引入64KiB全snapshotpacker，不为user/legacy/shared追加通用分片。候选有限PG投影，Node仅装箱有限片段，不先载整巨JSONB；单metadata超限明确503 message_parts_budget_exceeded。

opaque cursor绑定当前身份/Conversation/Project scope、Message/run、format与parts版本水位、ordinal/scalar offset，不授身份。非法/错scope400，真实401/403/不可见404，版本变化409 message_parts_changed，legacy有证恢复源已GC为410，依赖/投影不可证503；不透SQL/正文/凭据/异常原文。409先保已确认partial/live，只有显式重读，不新增自动episode/无限重试/Send或模型重派。next_cursor=null仅证明此版本序列已读完，非Run终态或HITL授权。

旧R6仅在exact source/dispatch/Message与完整89帧range、合法prelude、唯一START42和delta==持久content均可验时，请求内RR局部恢复ordered；≤512帧/4MiB/10秒，不写旧行/xmin。缺源、旧多段completed正文无证保原legacy，不批量backfill、拼造正文或假序号；恢复预算超限明确503，不截前512帧冒完整。新parts持久后不依赖ledger永久保留。

DB content继续全部text slots原序原字节拼接；private ordered reader用parts，不以聚合字符串猜交错。completed只修同segment，TEXT_END无全文且不等final；live必要时只作该Message的有界fresh读回，不全会话重播。所有public text原位可见、连续activity不跨正文；当前无commentary/final phase，不发布lasttext猜出的final、伪浏览分组/时长或每Run固定panel。

后继机器契约仅变private assistant读取及新operation；独立read DTO与原user/legacy/shared/command ACK严格分开，须正式版本/唯一OpenAPI/固定commit-digest生成与准确Public26全文inverse，再配对App。D1A三列/fold及Public27机器事实已有候选和隔离证据；private route/App消费与非空演进尚未正常配对，BFF/App/PG验证绑定实际停写候选，不能以契约提交冒真实UI完成。

## 2026-10-25 personal SSE 后继表示与 Public26（Root 已裁决，设计门）

本片消费者源码候选固定正式 Platform `8cfead647856ef54ec851a3bebe169a3ca14d212`；唯一当前机器源为 Public26.0.0，正常与 App/Agent 成套激活另验。正式后继 Public26.0.0 仅 version 与既有 `McpConnectionProjection.transport` 增 `sse_compat`，其它路径、operation、shape、metadata/download 与权限不变；准确恢复完整 Public25 原件 SHA256 `7261ac9ce2140555ba97ebff2bf0359533cc49dda014b08dcd6a6054a8d38b1c` 后，再调用原25→24完整 inverse，旧 hash/断言不改。personal browser-private 成功校验继续在现 client 边界维护，不新增另一份 public 机器事实源。

- `POST /browser/v1/mcp/servers`：optional `transport` 闭集为 `streamable_http|sse_compat`，省略保旧 HTTP 摘要；显式分别带 Proto optional 2/3 并入摘要。null、数字、Proto token、别名、STDIO/未知值拒绝。`PATCH /browser/v1/mcp/servers/{server_id}` 不接受 transport，原 CAS/写字段保持。
- `POST /browser/v1/mcp/servers/import`：原 opaque `config_json` 与 key 不变；旧 JSON `type:streamableHttp` canonical item 不追加2，新增 `type:sse` item 加 transport3，混合批整体 exact 绑定原顺序/名称/URL等非秘密摘要；不转写原 JSON、泄漏 secret 或把新合法 SSE 送旧 invalid-config 摘要 fallback。owner 原子验证/保存不转归 BFF。
- fresh `GET /browser/v1/mcp/servers/{server_id}` 的 Current schema 必须有真实 `transport:streamable_http|sse_compat`；新 Register/import ACK 同样必须 present，并与原请求 effective transport 匹配。0/1/unknown、错 ID/版本/请求绑定或新 ACK 缺字段仍拒绝。Current 不是 ACK 的缺省/兼容分支。
- 历史 ACK schema 与 Current 明确分开。原 absent Register、整批旧 HTTP JSON 仅在 owner `replayed=true`、原输入可证明且其余 exact 绑定均合法时允许 transport absent；显式 HTTP/SSE Register 或混合/SSE JSON 不因 replayed 就获此豁免。新网络的旧 Prepare/Update ACK 同样只能从原 exact completed receipt 以 replayed=true、原 operation/key/request 关联重播时允许缺 transport 并保成功事实；新非 replayed ACK 仍要求真实值。旧 App 内已确认成功不追溯改未执行，此与新 wire 校验分开。缺值只代表没有 current transport 资格，不能改旧 ACK、默认 HTTP、混入 payloadGet 或当未提交发新 key。后续显式 fresh Get 失败/撤权/切主体仍保原确认/unknown/原请求恢复，不产生自动重派。
- JSON ACK 必须保外层 replayed 与原 config_json 的 exact 上下文，逐项验证/投影，不能丢上下文复用 Get schema。Personal Connect Connection 原字段保持；picker 沿独立 Platform HTTP7.0 与 Public26 闭集消费真实 `sse_compat`，不由 provider/status 猜传输或资格。

沿原 service envelope 与当前人类 Session/MCP action、绝对总10秒、最后同 tenant/subject 重验、AbortSignal/late-response fence、no-store/request ID及 secret-safe 错误；原 unknown 只按原 body/key/digest 恢复，确认回执不是当前授权。无新 endpoint、DB Schema、权限、依赖或外部 SSE client。当前 producer commit/profile/descriptor/OpenAPI 已固定并正规生成；正常 Platform/BFF/App/Agent 同步配对，任一候选或本设计门不表示当前支持 SSE 执行。

## 2026-10-25 既有 AG-UI 的合法 preflight 前缀（候选）

固定 Agent 允许 Skill activity 早于 initial RUN_STARTED，build 失败可零 START。BFF 保原 source/CUSTOM 顺序和 opaque cursor，仅当前可信 expected/FIFO 接受头、主体全等及既有 leased/retryable/admitted ACK race 可保存 closed Skill prelude；它不是 active/process/执行开始声明。无 START 的首次 terminal interaction 仅接受 revision1、pause0、null pause_ref、groups[]、null action_result；切页/重启快照仍 queued 且无可操作 pause，真正 run.failed/run.completed 才结算 FIFO。其他 pre-START Todo/tool/subagent/可操作 interaction 仍拒绝，source 重用漂移及旧 lease 仍回滚。公开路径、shape、Public25 和 generated 原字节不变。

## 2026-10-25 GetSkill metadata-only / Public25（Root 已裁决，未正常激活）

既有 `POST /skill.v1.SkillOptionalService/GetSkill {skillId}` 仍是当前 Session/tenant 授权的 browser-private beta 展示读取；skillId 保 series 显式 current 语义，成功严格为 `{skill}`，无 downloadInfo，不访问 package/Storage 或创建下载 handle。此成功只证明返回的 exact revision metadata 已获准读取，不证明文件可用。唯一 canonical 的 `SpecificationDetailResponse` 与现展示字段保持单一事实源，无新 endpoint、owner 或 Schema。

`POST /skill.v1.SkillService/DownloadSkill` 成功仍严格 `{skill,downloadInfo}`，三下载字段继续来自真实 package binding 与有界 handle；独立 prepare/confirm、当前身份/精确版本、扫描/字节、文件错误和未知结果语义保持。原 GetSkill required downloadInfo 是本次明确替换的本地展示约束，非已证明的 Manus 全场景必需规则；Public25.0.0 精确逆回完整 Public24 后再验旧合同，operation inventory 不变。消费者须固定 Root 正式交付的 commit/digest 后正规更新 snapshot 与原生成链，禁止 optional fallback/双响应或伪造 downloadInfo。

## 2026-10-25 Skills 媒体地址与更新候选（源码候选，未正常激活）

Hub、详情及分享精确修订摘要的 `coverImage` / `cover_image` 提供 `/api/v1/skills/{exact_version_uid}/cover`，不再依赖元数据内联的 `product.cover`。地址只表达可尝试的同源媒体资源，不证明封面存在、当前 CLEAN 或可执行；不得改用 series ID、外部 URL 或 `/api/hub`。Web 沿既有合法路径映射，实际有图、无图和依赖失败由独立 `/v1/skills/{exact_version_uid}/cover` GET 的原 200/404/503 及其他既有错误确定；该 GET 的当前身份、owner 精确来源绑定、扫描/字节及出口重验不变。

`available_update` 仅为 owner 已发布且当前主体可见的更高 exact revision 元数据候选，不是 Storage 包可用证明或更新 ACK；列表不为候选请求 fresh package proof。实际 Install/Update 仍独立校验当前资格、包及 fresh proof，保原 key/body、CAS、未知结果恢复和错误；metadata 查询失败不得伪造 absent。Proto、成功表示字段、canonical Schema 与媒体 GET 协议未改变，正常配对和页面验收由 Root 后继执行。

## 2026-10-25 browser-private URL MCP 项目发布（隔离候选）

私有 profile1.1 的每个非200响应现由 canonical code-first 源生成精确 status/code/retryable 闭集；自有9类失败、原bootstrap的8个Session/service/tenant/action准入tuple及现 connector-command-errors-v1.json 的MCP6个receipt tuple组合发布。shared来源带文件SHA，未复制可编辑receipt政策；message不参与分类。生成的consumer vectors区分首次明确拒绝与已有unknown。仅精确400/mcp_project_publication_request_invalid/false和412/mcp_project_publication_precondition_failed/false，在publish/remove无任何历史unknown且用户显式修改意图后允许新命令；其余tuple、错status/bit/未知码、receipt查询、receipt404均不授权新key。所有自动重试=false。

Public24 与现公开 OpenAPI 原件不变。唯一可编辑新 HTTP schema 为 src/application/mcp-project-publication.contract.ts；私有 OpenAPI/profile 只从该源生成，不复制第二份手写 schema。现 browser service envelope + 人类 Session；当前 MCP read/manage 与全部 canonical 本人项目资格每次重核，无body tenant/subject/权限声明。

- POST /browser/v1/mcp/servers/{server_id}/project-publications：原 Idempotency-Key + connector_id、expected_source_state_version、1..32 唯一 targets；每项 project_id 和 expected_pin={absent:true} 或 {current:{pin_id,state_version}}。
- GET /browser/v1/projects/{project_id}/mcp-pins：limit 默认50/max100、opaque cursor；无body或key，返回真实 pins/next_cursor，包括 removed 墓碑。
- DELETE /browser/v1/projects/{project_id}/mcp-pins/{pin_id}：原 key + expected_state_version，不删除 source/revision/其他项目。
- POST /browser/v1/mcp/project-publication-receipts：原 key + 恰一 publication（含原 server_id 和全部原发布字段）或 removal（原 project_id/pin_id/expected_state_version）；只查同操作原ACK，绝不转入变更。

成功200、data envelope、no-store/x-request-id。Publish ACK包含exact revision和全部exact pins/replayed；移除ACK只含本pin/replayed；receipt返回类型化原ACK。execution_ready 必须 false，不能由个人connection状态推断。闭集输入错误400、不可见404、当前权限403、idempotency conflict/in-progress409、CAS412、限制429、坏owner502、依赖/超时/未知503；无异常文本/凭据泄漏。429保合法Retry-After，未知结果只允许当前主体显式原key/body恢复，不授新命令。

source/pin CAS 为1..2147483647十进制字符串；ID沿冻结profile、目标按ASCII canonical ID排序，摘要是固定数组JSON元组而非JCS。新成功current pin推进+1，removed墓碑重发必须exact current，原成功receipt保历史ACK。已固定独立 Platform profile/descriptor/vectors 到实际提交 dd8d536a28059cbdbe0674debc47bf28d039fb47，五项原冻结artifact摘要经该commit逐一核等；receipt marker精确沿原 connector-command-errors-v1.json 的mcp闭集映射，通用错误用mcp_project_publication_*。profile vectors_sha256为向量JCS摘要、vendor manifest为pretty文件字节SHA，两者分开验证。源 metadata/URL/OAuth/Header 不通过新HTTP输出，外部凭据不被复制；本片不改变现删除/授权/消息/运行契约。

## 2026-10-24 browser-private 图标暂存（实施中）

固定 Platform 7d8115a4b0dc752687babe7db35d0a936f51c76a／mcp-icon-v1；仍 Public24，原无图请求字节语义保持。POST /browser/v1/mcp/icons/uploads 接 filename/mime_type/content_sha256/size_bytes（十进制字符串，1..1048576）；POST icons/import 接 image_url；GET icons/{intent_id} 无 body/key；POST icons/{intent_id}/complete 接 expected_state_version 与 source_version_id，cancel 仅接 expected_state_version。四写均要求原 Idempotency-Key，主体只来自 admission；UUID intent、版本1..2147483646。返回安全 intent／replayed 与即时 upload_reference 或 preview_reference，no-store。原 Server／CustomAPI create 可选 icon={intent_id,expected_state_version}；update 同字段或 clear_icon=true 互斥，缺省保留绑定；metadata/save ACK 无持久短 URL。错误沿现 MCP／CustomAPI profile，未知结果只能显式复用原命令。

## 2026-10-24 Prepare 原请求恢复（既有JSON卡，设计门）

**跨tab约束（独审补齐）：** failure存写也核exact subject/server/connector/key，且同key乱序回调不能把inspect_owner/expired/conflict降回undefined或same_command；invalid只可收紧为其它不可恢复分类。已恢复RAM K在核验前后及POST前须与日志原子重核；另一tab已清退K并reserve K2时，旧窗口不得采用K2、沿用K的核验凭证、覆盖其failure或清退K2。保守锁旧窗口并重新加载，不改owner/回执协议。

**问题/基线：** 长metadata已由BFF14bb159/App c3f301e修正且正常GET200；原502 invalid仍按browser-private profile1.0 inspect_owner锁定，旧tab消失证明RAM不能作为关闭/重开的恢复保证。当前主体/同实体ready只证当前状态，不证原命令receipt。

**取舍/边界：** 保留通用错误语义，增加Prepare专属“核验后显式原命令重放”政策；不把所有invalid改same_command，也不新建Platform receipt查询RPC/事实镜像。BFF code-first profile1.1新增独立prepare_inspection_recovery，原错误tuple/recovery、automatic_retries=false、new_command_authorized=false与Public24完整原件不变。条件为operation=prepareServer、failure=invalid、当前主体、精确server+connector可信读及原server版本不倒退；授权只允许原key/body/CAS显式重放，不授权新命令。其它inspect_owner错误不变。

**失败/验证：** 核验零POST，读取失败/错ID/错关联/旧版本/取消/身份或generation变化均不授恢复；核验不是成功、不是receipt。重放仍由owner当前授权/CAS/幂等回执裁决，完整exact ACK到达才收口。保过期/身份冲突锁定及迟到ACK、秘密清退、管理与Prepare互锁；固定消费者由正式提交及digest正规生成。先行为RED→窄修→相关门→正常同一实体与原请求验收；不以GET200称原Prepare恢复。

## 2026-10-24 私有MCP发现长描述消费修正（正常读取已验，原Prepare恢复仍开放）

正常JSON导入201后Prepare返回502，已定位owner合法2006字节工具显示文本被消费者额外1000字节界限拒绝。仅对发现declaration display_name移除逐字段长度上限，保留Unicode/既有内容校验、其它字段上限、strict结构、ID/CAS/声明一致性以及整个传输响应预算；不截断、不改写owner原文或declaration digest。读取与首次/重放Prepare receipt共用该投影。

该面是现有browser-private管理投影；公开Public24原件、固定owner artifact、错误profile、SQL/权限与运行配置不变，不为局部实现伪造新的public发行。502 invalid仍为inspect_owner，旧冻结请求没有因本修正获得重试资格；后继须先正式定义可信核验后仅显式重放原key/body/CAS的Prepare恢复，合法exact receipt到达才完成。其它inspect_owner错误继续封锁。BFF14bb159/App c3f301e已正常配对，仅重载BFF及单份App源；同一实体详情GET502→200、硬刷新重开GET200，长文本547/2006字节保持。原Prepare exact receipt未重放，inspect_owner后恢复及关闭/重开持久恢复仍开放，不称JSON CRUD已闭环。

## 2026-10-24 普通会话 MCP 精确选择（BFF 候选实施，尚未正常配对）

目标公共24.0：现消息创建请求以selected_mcp_connection_ids替代trace-only mcp_servers。新字段optional、默认无额外MCP，最多16个唯一有序Connection ID，格式/4096-byte限额与待发行Agent后继机器源一致；浏览器自报身份、URL、凭据及未知字段仍拒绝。MCP资格由Agent/Platform当前授权检查，不因通过BFF输入校验而成立。

internal launch只消费Agent正式固定artifact，不手写第二模型；public唯一机器源仍为contract/openapi/v1/openapi.yaml，待owner先交付再改。历史trace mcp_servers只作已有receipt诊断，不是新输入alias/运行fallback。相同idempotency key变化列表触发原请求冲突，恢复不重新计算当前选择。未发行，public当前仍23.1。


新非空选择在原幂等material末尾追加具名对象域；旧mcp_servers诊断槽固定null，不复用其数组位置，避免旧trace-only请求与新执行意图碰撞。缺省/[]保持原未选字节；旧trace只在持久payload reader保留，不成为新body别名。

## 2026-10-24 Agent 待核对失败码纵向消费（候选，未正常激活）

沿既有AGENT-1／CREDIT-1，只接受Agent正式HTTP7.3的具名model_settlement_pending且retryable=false；BFF不从异常文字、已有回答或余额推断结算，不写资金、不改历史generic失败。新码与已生成正文共同持久化，snapshot／replay同义，保持原AG-UI与source／watermark原子事务。Agent先交付固定commit和完整父证明，再以原generator固定单一新source并保原三操作消费范围；公开ChatMessage.failure追加同码后App正规固定消费，不单独提前重载新producer。

持久边界必须同时承接：旧canonical database/schema.sql的ck_bff_message_agent_failure为十码闭集，新码在现PG写入会拒绝并回滚frame／message／watermark。不得仅改generator／UI。新增具名owner收敛只在精确原CHECK或目标CHECK、已validated／正确relation下原子替换并验证；fresh installer仍仅空schema，不能用于正常旧库、不重建／清数据。已有文本、旧码、原source／事务／actor／Run／取消／幂等均保持，非空隔离PG须验证升级／回滚／drift与新码持久回放后才正常配对。

本片无新的业务表／资金模型／权限／服务或计价决定。未来只读展示用量待核对不证明已capture、released或可重派；unknown、坏回执和身份不符沿原失败。当前BFF候选已实现并在独占PostgreSQL验过具名升级／drift／有限锁等待取消、正文保留及snapshot／replay／重开连接／重复终态／回滚；完整门与App／正常配对仍后继；同一纵切片包含Agent→BFF→App和正常页面，不能把Agent组件通过当产品完成。

固定Agent `8cc975e0850ebc990c436d3f2cff544c9424cbda`／HTTP7.3，raw `c096eab9f2aa392215351a106a670692d5f58f945980a5e028b3a83d17509731`。Public23.1／186 operations只在原ChatMessage.failure.code追加model_settlement_pending，retryable允许true仍仅原两码；新raw `703dba47da8a5c659b4236bb0a72317588ad29a4ca444ff9e5c99cfbcd00634b`。完整23.0字节逆证保持，原所有内部Admission／settle／recover API均不改。

## AGENT-1／CREDIT-1：原预算仅恢复内部HTTP（2026-10-22，本地已验）

固定Billing23ff719／exp10（raw f3d510bbf084d0dddad91d8cfafd13caf19e23c2a97074b363e0687291e14654），十一操作正规窄生成。内部1.3原件SHA256 `4de1a6c7564f3a994d879cfc93588021c5ef4aeebbcc89959fa574d5b6f16d39`，原1.2完整parsed hash `64b3d8a5d73c4b07e25f4283f932a755a513f0a409d924eb27403f152e7fdb29` 由仅删除recover／还原版本精确承接，再串原1.1／1.0保护。内部1.3唯一新增POST /internal/v1/model-admissions/recover，Agent专用机器credential、原durable Run提交者、原永久key；复用AgentModelAdmissionRequest／Response／Error，body仍六事实、禁proof／旧consumption header及身份／金额。200为原held创建ACK，不是GET当前态；404不是取消、没有资金或可派发证明。known bindings／whole budget／UTC时间严格核验、no-store／request ID／bounded EOF／总deadline及取消保持；仅一次owner recover调用，不回落到create。原create／settle／Public23不改语义，无运行alias。

以下旧版本段落保留当时发行快照，不覆盖本节当前1.3／exp10。

## AGENT-1／CREDIT-1：正式结算内部HTTP（2026-10-22）

固定Billing deab94efc9ee7d86d1d1072481920423d55b36ff／exp9，raw SHA256 `7b5335fde2be601b2d6256cb9b68b0964d5518cfa053b50f2029358a059a0924`；单一窄生成十操作，原九项保持，旧exp8 vendor退役，无alias。内部code-first1.2新增唯一POST `/internal/v1/model-admissions/{admission_id}/settle`；Public23／186及原raw保持。request只有owner原run_id／evidence_event_id／evidence_revision／evidence_digest，必需原永久Idempotency-Key，禁止proof与旧consumption header；create仍必需proof。独立kokoro-agent/model_admission/tenant credential，不信自报payer，不借浏览器／IAM／Scheduler凭据。

200为原sealed命令ACK：admission／Run／attempt、原证据三字段、captured／released／pending_reconciliation及reason、整Credit字符串、usage／settlement引用与UTC毫秒时间。字段、三态闭集与上界由固定owner generated schema定义，规范化补全not／codepoint及strict-before-intersection，不复制第二手写DTO。BFF核已知admission／Run／证据逐项相同；attempt由owner绑定、后继Agent再核原attempt。旧pending ACK不变为当前GET结果；不回原证据／价格／凭据，不接受调用方金额／usage。

原提交者经durable reader派生，用户退出／Run terminal／Conversation移动软删不触发新Session／IAM／live project准入；Billing仍核原Admission关联。400／403／404／409／422／502／503映射固定model_settlement码，不透owner错误message；no-store／request-id、单次共享deadline／取消、bounded EOF／原key恢复保持。未知结果不自动重发或重定向，不以pending授新派发。原internal1.1及1.0全图有精确逆保护；默认未配置独立credential不接触peer。

## AGENT-1：内部预算入口／Billing exp8消费（2026-10-22，已实施）

public23.0／186完全不变。现内部code-first生成链新增POST /internal/v1/model-admissions（createAgentModelAdmission），internal1.1；独立AgentModelAdmissionBearer，权限agent.model_admission，非浏览器／人类Bearer／IAM绑定读取者。body上限16KiB（覆盖512码点双引用的转义表示），闭集为run_id、attempt_id、request_ref、attempt_binding_digest、planned_digest、final_request_digest；必需单一Idempotency-Key8..128和x-billing-execution-proof1..16384 visible ASCII，不接tenant/user/recovery。成功201原held Admission及完整绑定／整数预算／snapshot摘要／毫秒UTC时间；原receipt恢复亦201原表示，不返回当前状态代替原回执。

唯一Billing来源d345025／experimental.8／raw SHA256 2c65b64c896a85cb89e6b8f23ee9802b6e5cf2440d9a8debaa23973f5c199b6e；现固定生成器选择原八操作＋createAdmission，退役旧exp6 vendor，不兼容header／body。SDK closed原六事实绑定，成功还核status=held及created_at=updated_at；错误只映射稳定安全码，不泄露上游message或proof，未知回包／超时均不作拒绝已提交的证明。BFF内部输入错误400、服务身份403、来源不可见404、资金意图冲突409、业务拒绝403、不足积分／无配置价／attempt不合格422、坏上游502、依赖503；所有响应no-store／x-request-id。原IAM binding operation与schema保持完整相等，不让Agent使用IAM凭据。

## AGENT-1／MODEL-1：精确模型绑定消费者（2026-10-22，本地已验）

本地停写七门全0、contract973／architecture36／默认1658 PASS及3原资源SKIP，真实compiled owner HTTP＋独占PG13项通过，758输入无漂移，独审Approved。正常未激活；详细证据与限制见CURRENT首节。

沿Root有效主链及已批Billing rate2；主方唯一writer，BFF基线4d8a028，固定owner2d3ed0fbee9219a93f02b67b23f69492fd568917／exp6／7044102dd6e221338348152bb268eaca6516039cc5ca5122d3c42a096f6dc962。沿原八操作生成链，只为原MeteringRate加入required闭集model_revision{id,content_digest}；保原商业字段供管理员显式配置，不由BFF猜映射／计价或验证System存在。发布与读回均完整保留pair，缺失／坏pair／额外字段拒绝，不添加旧rate fallback。

Public升23.0.0表示必填字段破坏变更，186有序操作不变；build-only inverse逐字还原完整22.5原件，再沿原所有父门，无运行兼容。无SQL／配置／服务／身份或预算变化，三具名管理员route、同tenant/actor、绝对10秒、1MiB/12层、原key/body/time与未知恢复语义保持。写区仅canonical／固定owner vendor与正规SDK／精确inverse、直接风险回归及当前文档；既定方案不新增服务或协议。先请求／读回pair与旧缺字段真实RED，再正规配对／完整BFF门、真实compiled owner HTTP＋独占PG；正常激活及App/Admin后继，不以消费者绿称实际Agent扣分。

## AGENT-1／CREDIT-1：计价管理Public22.5（2026-10-22）

只新增3个具名管理操作：GET /v1/admin/billing/metering/pricing和POST /v1/admin/billing/metering/{rate-revisions,policy-revisions}，Public22.5／186操作。请求及配置字段从固定Billing experimental.5同语义消费，外部snake_case；新增机器字段仍只在本canonical编辑，data沿owner表示，meta.request_id沿原BFF envelope。POST required key，完整publication_id/reason/configuration固定；201仅正式kind/revision/content_digest/published_at/effective_from，核对应kind和原生效时间。HTTP400输入错/owner正式拒绝，401/403身份或管理权拒绝，409原identity/key漂移，429原限流，502坏owner数据，503依赖/未知；不回echo私有错误。

GET无query／body／Content-Type／framing（包括CL0）／命令头，200 data中rate_revision和policy_revision可独立null，表明未发布；返回最大已发布revision，可未来生效，不用它推断active或未知POST结果。POST1MiB/12层/闭集JSON保原命令，没有默认价格或预算；响应最多1MiB（受原全局更严格cap限制），严格JSON/重复键、当前tenant上下文、协议数值字符串不经Number。billing operator三凭据/u1仅server持有，浏览器不发送owner secret/角色。保原183操作全文与顺序，inverse只构建期使用，SDK正式生成无手改。

## CREDIT-1：后台非现金积分命令（2026-10-22）

Public22.4新增POST /v1/admin/billing/credit-grants，required Idempotency-Key、strict {funding_id,subject_id,amount_credits,reason,effective_at}。金额为正整数字符串（最多9223372036854），不是micros或货币；首次表单意图冻结v4UUID、key和UTC毫秒生效时间，刷新/未知重试不新建。201 data仅account_id/grant_id/journal_id，加原meta.request_id；不返回合成余额或支付成功。400非法请求，401/403当前身份/成员资格拒绝，409原命令参数漂移，429限流，502坏owner回包，503依赖/未知；提交后失败不证明零效果，只恢复原命令。BFF当前管理员与同tenant成员资格每次核实，body不承载tenant/operator/role/source/price。

Billing固定90929ef及a09e00a3d6f602fdaff13a50a5a839c8a989b1a26ab28c43eac314738fcfdef2；三服务凭据仅server配置，新增KOKORO_BILLING_OPERATOR_PROXY_SECRET可缺省（发放503，原读链不退化），填写时独立、32–2048可见字符。旧182操作全文及有序inventory完整逆证；无API alias、双读或schema改动。管理员成员读取仍复用当前分页接口，不新增身份事实。

## MODEL-1 提供方上游模型候选（2026-10-22，design-first）

目标Public22.3新增单个 `GET /v1/admin/model-providers/{provider_id}/upstream-models`，operation `listAdminModelProviderUpstreamModels`。唯一字段源仍canonical public OpenAPI；标准data/meta envelope，data仅provider_id与items[{id}]，约束与System6.1固定consumer一致。不得把候选ID冒称已发布业务模型、上下文能力、价格或调用可用性。

当前平台管理员本人Session；无query/body／Content-Length（包括0）／Transfer-Encoding／Content-Type／Idempotency-Key／If-Match／If-None-Match，受信actor与tenant仅上下文，成功no-store。错误沿现admin model configuration闭集400/401/403/404/429/502/503（以canonical声明为准），不透传供应商正文；读取不做隐式重试。缺独立model-management凭据仍503，禁止回退普通web-bff或system-admin。

下游App仅增加精确同源桥、Admin显式刷新/选择复用原revision表单；必须固定本次正式public发布物后实施，不引入任意URL代理，不改变共享模型／业务组合或原CRUD权限。

## 2026-10-21 本人积分账户无感初始化

新增 Public22.2 PUT `/v1/billing/credit-account`，严格必需空JSON对象、无query，仅当前Product Session主体。BFF公开标注billing.self.write，执行沿现Product Session自主体准入；owner边界沿已有web-bff delegated-self与u1可信tenant/subject传输消费Billing main158579f / experimental.3正式PUT；天然幂等，不新增BFF receipt、Schema或IAM action。返回现summary真实投影，disabled为403；不假零、不充值。GET summary/ledger仍只读；App仅专用缺账户404后发明确PUT，未知结果先GET核实。正式固定artifact及窄生成client；总预算、取消、响应上限与凭据隔离保持。

## 2026-10-21 Skills 公开身份矩阵与 App 绑定（已批准，实施中）

GET /v1/skill.list 保持原 ok/request_id/data 及固定错误结构，仅使用 IAM VerifySkillListIdentity；普通 oauth_app 带 project_id 返回400，网站四 RPC 仍仅 Session。管理新增 GET/POST /v1/admin/open-apps/{app_id}/skill-bindings 与 DELETE /v1/admin/open-apps/{app_id}/skill-bindings/{series_id}；POST 仅 skill_id 与必填 expected_binding_version（0=首次或正 CAS），DELETE 仅正 CAS，写入必需 Idempotency-Key。app_id 只是选择器，可信 tenant/app/client 来自 fresh IAM VerifyOpenAppManagementAuthorization；不接 body 身份或 trusted。固定 Platform451d0fb。管理返回 exact binding_id/series_id/skill_id/revision/state_version/source_status/created_at/updated_at/removed_at 与 nullable metadata；元数据仅 name/summary/created_at/updated_at/product，不伪造安装。列表为 data.bindings + required nullable next_cursor；写回执为 data.binding/event_id/replayed，沿 meta.request_id。原 ok/request_id/data 公开 Skill 列表不变。Public22.1 未发行候选180操作；current增量完整逆回原22.0字节与原176有序inventory，旧父hash不变。

## 2026-10-21 Skills 删除与公开身份收口（实施中）

新增 DELETE /v1/self/skills/{skill_id}：Idempotency-Key 必填，JSON 仅 expected_state_version 与 expected_publication（显式 null 或 current_version_id/state_version）。200 返回 series_id、skill_id、state_version、status=deleted、event_id、replayed；400 输入、404 不可见、409 原命令冲突/处理中、412 确认快照失效、429 受限、502 非法 owner 响应、503 依赖。禁止客户端传 tenant/subject。完整 canonical 与发行固定 owner 后同步。

## 本人历史原包下载配对（2026-10-21，实施中）

固定 Platform `97b27b3056f3024fe1c0509072349e1b274efac4` 实现提交，机器原件/Native descriptor/HTTP6.3 原字节保持。沿现 browser-private POST /browser/v1/skills/{version_id}/download，本人 managed 精确 GET 验证归属后，除原 active 外接受明确 product.source_kind=personal 的 disabled/withdrawn。未知来源、其他来源、草稿/隔离/废弃仍不合格；安装/分享 resolver 规则不改。资格/原包 hash/size 在句柄下载前后仍重新确认，同一 subject/tenant、预算与取消保持，无新 API、公开字段、Schema、缓存或服务。App 必须消费原 ZIP 而非重组预览文本，恢复另走新 UID/上传/扫描/校验/publication 确认；本片不切换正常环境。

## 2026-10-21 Admin 详情确认快照（目标，未正常激活）

同一未发布 Public22.0.0 /176 候选：GET /v1/admin/skills/{skill_id} 唯一使用的 SkillProductRecordResponse 新增 required meta（closed），仅含 required publication，复用既有 SkillPublicationPrecondition。data及全部其它操作/Schema不变；记录精确版本与publication当前指针是不同事实。显式absent:true映为null，current保留ID与canonical decimal至9223372036854775806；缺失、false absent、空oneof、错类型/越界和未知wire均为502 skill_response_invalid。权限、no-store/request-id、错误与超时维持原表；不新增fallback或API路径。

## 2026-10-21 发布确认快照接线（源码候选，未正常激活）

目标 Public22.0.0 /176 operations，沿现 /v1 路径。PublishSkill 使用独立 SkillPublishRequest，PublishOfficialSkill 同样追加 required expected_publication；SkillAudienceRequest 保持原形。明确 null 或 closed current_version_id/state_version，正十进制版本至9223372036854775806。Native expected_publication 映射 absent:true 或 current typed SkillId/version，两命令摘要包含此值。旧缺字段输入拒绝，不兼容；稳定错误412、key与成功输出保持。当前 owner HTTP6.3历史读取独立pin保持，不新增操作。

## 2026-10-21 Public21.2.0 个人系列历史

唯一public机器源仍为 contract/openapi/v1/openapi.yaml，新增GET /v1/self/skills/{skill_id}/versions（listPersonalSkillVersions），共176有序operations；同路径原POST创建draft保持原样。权限 product.skill.read_managed_personal，查询仅limit(1–100)/cursor；新操作无body和幂等键，不接客户端主体或过滤字段。

200为闭集data/meta：data含series_id、publication(可null)、versions、required nullable next_cursor；版本项保精确skill_id、revision、name/summary、status、archive_size/file_count、UTC created_at、is_current。publication current/state_version与撤回时间分开表示，current不等于可执行或最大revision；历史不自动升级安装。错误复用原管理读取400/401/403/404/429/502/503及no-store/request-id，owner500不透传内部资料。

Platform HTTP固定 efe1ed1/6.3完整原件与SHA，generated只通过既有生成器更新。现Public21.1.1的全部原文和175有序inventory由精确增量逆证保留；仅测试／构建校验该父图，不加runtime旧版分支。消费者待本批固定发行后接入，不宣称正常页面已加载。

## 2026-10-21 Public21.1.1 配对目标

本次从21.1.0补入已合Public19.0.1的skill.list并集描述，方法、查询、返回、权限、错误、175有序operations及全部模型字段保持。GET当前项目安装完整精确表示覆盖同series个人安装，停用／旧版本仍保留，列表不授执行权；共享预算、1000项上限及返回前重核项目不变。当前原文由既有配置检查核描述位置／篡改／降版，再逆回既有冻结父全文；机器源唯一，消费者等待正式提交后固定生成。

## MC-02 当前公开配置增量（2026-10-20，design-first）

Public21.1仍/v1，新增10具名admin operation至175：GET model-providers/model-definitions/model-features、POST model-providers/model-definitions/model-revisions/model-labels、GET model-provider-creations?idempotency_key、POST model-revisions/{revision_id}/publish、PATCH model-labels/{label_id}。新列表保limit/cursor分页；创建201，其他200。body/error/meta闭集，Key输入writeOnly、输出不得含Key。query主体只取可信context，lookup404表示未确认。新命令原Idempotency-Key；publish和PATCH必须强If-Match，create不收CAS；不暴露owner credentials/read。原四路由接口/CAS/错误不变，消费者须固定新source/hash。

## 2026-10-20 Public21 / System5 MC-02A 配对门

canonical Public21.0.0 保165操作。AdminModelLabel.display_name 改 required nullable（alias 未设由owner保持 null），AdminModelRevision 删除 feature_key；只读管理不增加创建/PATCH入口。业务 `/v1/models` 的 closed ModelCandidate 必需 provider/name/is_default/display_name/model_id/revision_id/provider_id/feature_key/request_model；name=稳定label key（1..128），provider=owner显式值（1..128），display_name=owner有效别名或原模型名（1..255），feature_key 1..128，request_model 1..255，三ID为UUID。closed data 必需 models 与 nullable next_cursor，不暴露连接 URL、secret_handle_ref 或 Key。

唯一System5固定 artifact/provenance由现生成链分发，新增第5个窄消费操作 getModelCatalog 只服务既有 public `/models`。不从slash/display_name推provider，不兼容旧catalog/revision或缺字段。新 test-only Public21→20 精确逆证再委托原20→19及双父证明，旧oracle不改；App/Admin由Root固定同一Public21后续配对。正常激活与执行许可独立，本片不涉及Key保存/领取。

## 2026-10-20 Public20.0.0 / System4 配对门（隔离候选）

唯一公开事实源 `contract/openapi/v1/openapi.yaml` 升至 20.0.0，165 operations 和四个管理员模型操作不增减。`AdminModelRevision` 必需 `request_model`（1..255）及 closed `connection`：固定协议 `openai_chat_completions`、类型 `direct|litellm`、受界 HTTP(S) `base_url`（1..2048）与 `secret_handle_ref`（1..255，仅引用）。旧 `transport`/`gateway_model_name` 不再接受或返回；不以 union/fallback 兼容 System3。标签、路由列表与 PUT key/CAS/错误形状保持。

System owner 4.0.0 固定 commit `dafbc66c9ab5e55b556dbd1dd71c79cef354f69c`、artifact/provenance digest，由现窄生成链记录；公开 major 的精确逆证恢复完整 Public19 再执行原历史检查，不是运行时兼容器。App/Admin 必须固定同一 Public20 产物后再切换。没有 provider/revision 管理写 API、secret 值、执行许可或正常激活承诺。

## 2026-10-20 既定项目执行 internal1 producer 收口（未激活）

唯一 code-first 源 src/http/project-execution-binding.contract.ts 正规生成 contract/openapi/internal/v1/openapi.yaml／1.0.0；精确 POST /internal/v1/project-execution-bindings/verify，IAM 专用文件凭据、闭集输入与 no-store 成功/错误。成功仅返回匹配的 project_ref、原有序 selected_skill_source_refs 与 selection_digest；未知、错身份、资源不可见、已退役和期限失败均闭锁，不转成 Web admission 或执行许可。保留 Public19/165 operations、HTTP7 与全部现有错误/权限边界。IAM 已固定 d623f76/internal1；本次只补既定 producer，不新增 public 字段、fallback 或收费执行入口。

## 2026-10-19 MCP generic 前置失败消费纠正

Platform 当前合同允许无 detail 的 FailedPrecondition，含续期 scope 收缩后原 Prepare CAS 失配；BFF按既有 generic412 `mcp_personal_precondition_failed` 返回，不将合法前置失败误报502，也不伪造 `not_prepared` reason。本段取代下方旧“URL server必须带typed detail”的消费者误设。只有非空detail声明typed profile，仍严格核唯一已知消息/有效reason，未知、重复、畸形或冲突detail保持502；receipt marker分类仍先行。不改成功解码、权限、owner CAS/事务/回执、重试行为、机器字段/profile或数据模型；App现有412已配对，无新增兼容分支。

## 2026-10-19 MCP availability 严格消费者修复（隔离候选）

沿用户已确认的独立实时可用性/Platform使用前续期方案，修已在main复现的owner字段13被旧descriptor拒绝；不重做协调器。唯一当前Platform bundle配对实际已合入4a4e4c4/HTTP6.2，使用owner Git原始artifact/摘要与原两生成链；旧当前vendor退休，不接受双版或忽略unknown。Connector/Server的availability为必需五态，与durable status/enabled独立；零值、缺失、未知、字符串冒充enum仍拒绝。原browser/v1入口、身份、租户、幂等回执、总预算/取消及错误恢复不变；不改Product Public19/165或独立command-error/历史profile。

读响应包括OAuth内嵌及现命令ACK的当次owner投影；BFF不自己猜过期/刷新、不发AS请求。Server保全部安全历史header描述，32项只限制owner当前active配置；仍受既有wire字节预算，不重建缓存/状态机。SQL/canonical/schema与数据模型不变，无新API/owner/网关/worker/依赖。App/Admin和真实整链按同一契约依赖续接，不因本BFF局部通过冒称完整闭环。正常687输入及原availability mixed保留，全部变更在独占候选；不重载正常服务/数据库，不启模型、实际工具或扣费，不新增远端PR。

验收：原真实descriptor负控，固定生成/漂移、五态与缺失/unknown拒绝、真实Connect transport/主体与版本回执/历史header安全、当前全部相关门。原失败保留，不放宽已有安全断言。当前仅设计门与写区已确定，尚未宣称验证通过。

## 2026-10-19 已合入 owner 发布物配对（隔离候选）

复用现IAM/Billing窄SDK，固定已合入main的IAM7cbe988/0.14.0与Billing3f5e0da/4.0.0-experimental.2。按owner Git object逐字分发OpenAPI后走唯一正式生成器，退休旧c64/cd92当前vendor，不增加多版本接受、接口或新客户端。IAM只有未消费E2表示变化，本仓已批准窄operation集合/生成响应应保持；独立浏览器私有relay policy0.7仍按其原owner事实，不借此改OAuth准入。Billing仅将同一Catalog/本人Credit三GET沿正式SDK从退役/v2改/v1，完整身份/decimal/closed response/超时取消与错误保障不变。

Public19/165机器字节、BFF schema/持久回执/权限/配置不改；正常687输入mixed与availability WIP不混入候选，正常服务不重启，不发模型、实际工具或收费请求。只配对已交付既有能力，后继App/Admin固定同一已合Public契约再集成，不扩展功能。验收保既有行为/contract负控，补真实owner只读HTTP配对，完整本仓门和独立审查后集中PR。

## 2026-10-19 既有分支集成：唯一 Public19.0.0（候选）

本次只合并本地 d8634f0 与 main 16e5c711 已批准能力，不新增功能。唯一当前 /v1 契约165操作：保本地 Skills取得来源、项目精确选择/消息默认冻结、知识、完整日历与Library筛选、五项MCP包管理；承接main八项账号会话/姓名、共享/归档操作与Team完整platform/skill权限。旧名称关联PATCH及recurrence_anchor_at请求字段保持退休，不建alias或runtime fallback。两父原文/有序inventory通过本次明确增量的精确逆证保留，既有历史hash与断言不重签；全部后端入口、owner准入/取消/事务/幂等和历史回执保持。

Schema只在原BFF canonical叠加main既有归档列/索引；项目/日历/知识结构与旧表删除保持。正常库不自动演进，未重启服务、启用模型/实际工具/扣费。停写后的728输入完整格式/lint/types/契约845项/架构/默认1489 PASS与3原SKIP/fresh build已通过；13文件真实PostgreSQL＋Redis 346 PASS/0 SKIP，fresh canonical安装与自有测试库回收已验证，独立审查无遗留确定P0–P2。首次资源7个失败已定位并修正既有fixture的owner search_path、HTTP7显式project_ref和ObjectStore VersionId ACK；原503、未知提交、重启与撤权恢复断言保持，未以放宽断言消除失败。新availability消费者WIP和正常mixed均未夹入；代码交付不代表正常Schema/运行服务或完整页面已配对。

## Agent HTTP7 窄消费者（2026-10-18，正常尚未配对）

只升级内部固定Agent artifact到7104f3d/7.0.0，public18.1及157 operations原字节保持。SDK仍只生成Run POST、events GET、control POST，不开放新增usage-evidence读、更不触发模型/收费。Launch网络必含project_ref:string|null，从BFF原durable scope投影，直聊显式null；不会信任浏览器trace或重新读取移动后的项目。当前strict生成源/provenance与本地manifest由同一正式命令校验。

两个派发client在写socket前统一校验owner request闭集；拒绝无效BFF保存形状，不生成第二套request schema或自动旧版本fallback。原request_id/run/session/message、selected_skill_source_refs、key、身份headers与成功/错误/HITL语义不变。正常激活/历史未知admission核对独立验收，模型/扣费继续暂停。

## 2026-10-18 Public18.1 MCP 包管理目标

新增POST /v1/admin/mcp/packages/{package_id}/uploads、GET同路径/{upload_id}、POST同路径/{upload_id}/complete与/abort、POST /v1/admin/mcp/packages/{package_id}/publish。四写单Idempotency-Key≤191 ASCII，命令摘要仅可信主体与固定意义由SDK生成；路径package/upload保持精确绑定。Complete/Publish size_bytes为1..33554432十进制字符串，SHA lowercase64；staging source版本不是运行版本。Publish body含provider_key和精确上传/asset事实，无任意command/env/URL。

所有操作当前人类平台管理员＋mcp_catalog.manage、固定租户、no-store/x-request-id。Begin/Complete/Abort/Status/Publish统一200，表示当前owner结果而非虚构新BFF资源；Begin的PUT引用只短时返回。Pending/Unknown扫描如实返回；发布不是启用/执行许可。公开错误稳定脱敏：400输入、401/403身份、404资源、409回执冲突/处理中、412资格、413包预算、429准入限流、502坏owner响应、503依赖/超时/未知。四写未知保原key/body，GET状态不证明发布未提交；Publish只能原命令恢复。Public18.1是新增五操作/157，现18其余内容用完整逆证精确保留，不加运行时旧版本fallback。

## 2026-10-18 MCP package admin 内部消费者

公开API继续Public18/原operation集合，本片不增路由。固定Platform fa5c5e5新独立五方法及mcp-package-admin-v1/profile、vectors和descriptor；沿现direct owner-only BFF mcp_admin凭据/固定tenant，不新增IAM scope。SDK本地command摘要绑定tenant/subject/package/source/provider完整业务意义，四命令保留原commandId，status无command。输出严格校验后投影，不返回生成message、身份header或依赖错误详情；pending/unknown scan不转clean，发布ACK不当执行许可。

## 2026-10-18 Artifact 服务端检索实施边界（候选，未正常加载）

延续 BFF Library 关系与 Storage FINAL 元数据现有边界，在唯一 GET /v1/library 的 artifact 查询新增 q/type；分页按 Storage 当前经授权验证的 title/filename/mime 匹配，不用未核实的 BFF source claims 代替，也不建立第二份 Final metadata 表、索引、worker 或跨 owner SQL。复用原 min(500,limit*5) 候选上限与30秒取消预算，每次查询只走一个受界候选窗口；可能返回空 items 且仍有 next_cursor，消费者必须显式区分“当前窗口未匹配、可继续”与已穷尽的无结果，不自动扫完整库。

BFF 拥有产品分类/查询规范化和分页位置，Storage 保持原17 RPC与唯一 FINAL+CLEAN真值。查询为不区分大小写的 NFC 子串，匹配最终 title/filename；类型使用既有八类 UI taxonomy（all加七个结果类型），mime/title规则在 API 文档明确，后续消费者不再对已加载页二次决定搜索结果。结果按原 delivery keyset 排序，不宣称 BM25、向量、相关性排名或索引全量搜索性能。

因为 cursor 从旧无filter形状收敛为单一完整 filter tuple，唯一 Public18 正式声明该失效边界；退休旧cursor解码，不双读旧协议。file 查询拒绝 q/type，非默认/默认 artifact 均由同一个严格规范化 tuple 绑定 kind/tenant/subject/limit/query/type，改查询不可复用游标；每页身份和 Storage 当前资格重验。无模型/工具/扣费。先改 canonical/query/行为测试并隔离验收，producer和App固定消费及正常配对前不重载正常 BFF，也不修改正常App使其提前发送新query。

## 2026-10-18 固定 Scheduler 3.0（实施门）

owner固定3bb7ff61b0d72418aa048ca35b8c3f144a33f13e／3.0.0／d349eae8bba207074b1edf91acd9f08e94f39a27363441f45186c1799159c999。mutation Schedule.next_due_at条件nullable，null必须once run_at且paused=false；data.status仍命令结果，BFF只把updated的该形状当同触发源耗尽，不拿旧ACK充current。新canonical条件在唯一生成器正规补全，拒非法cron/null、错误paused/缺字段或绑定漂移。

Public17与现业务字段不变；同一冻结once instant的普通/完整规则编辑和启停允许past，不代表重新调度或执行；不同instant、新建/recurring转once仍future。next_run_at由当前owner读，exhausted返回null；仅该已证终态允许与产品paused意图不同，完整正文/revision仍匹配。后继正常切换仍需旧未知命令退休与消费者配对，不提前重载。

## 2026-10-18 退休重复调度 next 事实（周期候选续接）

不改 Public17 当前读/写形状和固定 Scheduler2 wire；新 mutation snapshot 的 next_run_at 总为 null（登记异步且未知），旧已持久 ACK 原 JSON 不改写。Details 仅用权威 current reader 的 next 与 scheduling_state，不从写回执或旧 BFF 列恢复。内部 outbox success port 只结算 command，不返回/接受 next projection。

## 2026-10-18 权威调度当前读取（周期候选续接）

Public17 未发行候选补当前 Details 必需 scheduling_state=pending|active|paused|exhausted|failed；next_run_at 只在已核验 active owner current 时返回，否则为 null。业务 status 与调度状态分开，exhausted 不表示 Agent 成功。登记已成功却读到404、绑定不符或依赖失败返回503，不伪装 pending/空列表。写回执保持原不可变表示，不增加 current 字段，不改旧 ACK。完整16.2逆回保护原契约字节；消费者配对与正常激活另验。

## 2026-10-18 Public17 多周期目标（隔离候选）

frequency扩为daily/weekly/monthly/once；保time/timezone，weekly必需weekdays唯一0..6，monthly必需month_days唯一1..31，once必需local_date真实ISO日期，其他频率不接受这些字段。recurrence_anchor_at退出输入和当前读，无别名；next_run_at仍必需nullable且只来自Scheduler。PATCH触碰规则须携带完整frequency/time/timezone与对应选择，其他字段保持部分更新。写ACK仍不可变；仍符合当前请求形状的同key/body重放原JSON，退休anchor/缺少周选择等旧请求在claim前拒绝，不新增双parser或alias。历史回执保留原样，正常切换前必须先收敛未知ACK；新当前详情/列表严格执行规则条件，不用历史ACK回填编辑器。到点后的同key回放不再执行未来校验；新建/改期只接受未来once。

公开版本17.0.0，operation不新增；机器变更完整逆回16.2精确SHA，再接原16.1/16.0保护。内部Scheduler保持固定2.0，BFF将本地规则转成cron或run_at，冻结command使用outbox4，无任意callback URL或凭据输入。正常消费者未配对前不重载。

## 2026-10-18 Scheduler 2.0固定消费

内部Scheduler source固定8a26c91aa24d1f48a760b6234ab1ed5855d20936与完整digest；公开BFF仍16.2/152 operations不变。旧1.0 vendor替换，SDK正规生成并校验drift。新增owner current GET消费，输入path name与可信tenant/request ID，不传Idempotency-Key/body/query；响应是data.schedule，request ID只在header，不套旧mutation meta。

当前读取保持owner的schedule/run_at恰一和status/next联合约束；跨资源name错配、非法calendar/精度、错误条件或超限响应不投影成成功。业务写ACK/current读取生命周期仍分开；本切片不放宽mutation next，暂不把新的once形状塞入旧daily/weekly产品input。历史回执不改写，body与key保持原语义。

## Public16.2：当前 ScheduledTask 读取返回周期锚点（2026-10-18，源码候选）

GET /v1/scheduled-tasks 列表项与 GET /v1/scheduled-tasks/{id} 详情使用 ScheduledTaskDetails：复用原 ScheduledTask 字段，增加 required recurrence_anchor_at:string/date-time。它是 BFF 保存的规则 UTC instant；next_run_at 仍必需 nullable，只代表 Scheduler 确认的下次时间，不能互代。

写操作 ScheduledTaskResponse/原 ScheduledTask 快照不变，新写入和历史终态均保持相同 ACK 格式；不为新增读字段改历史回执或用当前事实补齐旧结果。创建/PATCH输入、身份/幂等、callback与数据库不变。消费者需固定16.2并区分当前读取与不可变ACK，不加缺字段fallback；正常旧实例未配对激活前不宣称返回新读字段。

## Public16.1 本人知识（2026-10-18，目标机器与源码候选）

唯一机器源新增六operation：GET /v1/preferences/knowledge（可选单一query，≤500 Unicode scalar值，字面case-insensitive子串）；GET/PUT/DELETE /v1/preferences/knowledge/{knowledge_id}（lowercase UUIDv4）；GET/PUT /v1/preferences/knowledge-usage。身份只取IAM准入context。无身份selector、Idempotency-Key或ETag条件头。当前四字段profile原样保持，知识不等于记忆导入。

列表data为{items,max_items:100}，全部有效项至多100，created_at DESC/knowledge_id ASC；不返回cursor或宣称跨请求快照。item为knowledge_id/name/when_to_use/content/revision/created_at/updated_at；原文保留，三个required字段须非空白且各≤500/500/2000。PUT body恰为expected_revision/name/when_to_use/content；expected0创建201+Location，正revision替换200。DELETE body恰为正expected_revision，成功204无正文；删除后ID永不复用，相同删除前revision重试204，其他409；缺失/foreign404。

usage data为enabled/revision，缺省false/0且读不写；PUT body恰为expected_revision/enabled，CAS成功200。关闭不删知识，不暗示已应用到Agent。所有写拒绝重复/未知JSON key、非fatal UTF8、NUL/孤立surrogate、非安全整数及超65536原始bytes；GET无body。错误为closed {error:{code,message,retryable}}，no-store/x-request-id；409知识版本冲突/耗尽/上限，503 unavailable或save_unknown。未知COMMIT仅GET核实，不自动重复命令。

六operation为public/beta、owner kokoro-bff、knowledge.self.read/write、idempotency=none（明确CAS/固定资源ID而非无幂等保护）。正常库/consumer激活未发生；完整父逆保证原16.0所有surface字节不变，禁止第二public契约或假发布commit。

## 调度 callback 的任务版本（2026-10-18，内部语义切片）

`POST /internal/bff/scheduled-tasks/dispatch` 继续使用固定 Scheduler generated webhook 的服务认证、header、occurrence 与幂等身份。该 owner 契约将 body 定义为 opaque JSON；BFF 自己注册的 body 新增 required `task_revision`：JSON number、正安全整数，精确等于对应 BFF command 的 frozen task revision；不是 Scheduler schedule.version。缺失、字符串、null、非正、非整数或溢出在零 receipt claim 前返回 400 invalid_scheduler_dispatch。其余既有身份/正文校验保持。

首次接纳的 body revision 与当前 task 不符返回 durable 409 invalid_scheduler_dispatch，不准备新 launch；相同 key/body 复现原终态，不按新规则重试，异 body 仍 409 idempotency_conflict。匹配时原 revision 进入 frozen snapshot；恢复已有 snapshot 也须与 body revision 相等，并由已有锁内 accept 再核当前 task revision；在途规则变更拒绝而不派发。原 snapshot 已接受后重放不表示当前规则再次执行。

本片不改变 public16.0.0 OpenAPI、不新增 public 字段或路由，不修改 Scheduler opaque schema/vendor/generated。配对激活要求及 v2 command 退休见 TECHNICAL_DESIGN；未盘点和更新的旧 schedule 不能冒称可继续运行。

## S4c 项目选择本地契约候选（2026-10-17，尚未发行）

当前预激活Public15.1替换为单一Public16，路径仍/v1：移除旧PATCH /projects/{projectId}/skills/{skill}，增加GET/PUT /projects/{projectId}/skill-selection。表示为data.project_id与data.installation_ids；PUT closed body {installation_ids:[...]}，最多16个、唯一、精确installation ID，[]清空，必需原Idempotency-Key，响应no-store。身份只取受信tenant/subject与当前BFF项目；PUT在写前核正式Project安装，错误/不可用不部分保存。替换事实和完成receipt同事务，原key重放不恢复已被后续修改的旧默认。

MessageCreateRequest字段名与Agent wire保持；只纠正省略继承项目默认、显式[]不继承。消息历史返回其已冻结selected_skill_source_refs。新消息选择快照与项目/Conversation移动冲突返回409，原意图可明确重试；已提交命令重放先取原receipt、不重新解析现默认。唯一OpenAPI已更新为Public16.0.0／146 operations，新增Message坏owner响应502，并以完整Public15.1父契约逆证保留未受影响字段；本地源码已接线，消费者固定版本与正常运行切换尚未完成。

## 项目安装 Public15.1（2026-10-17）

新增六operation：POST/GET /v1/projects/{projectId}/skill-installations、GET/DELETE同集合/{installation_id}、PUT同ID/enabled、POST同ID/update。input/ACK/错误/Idempotency-Key/10秒预算沿个人安装，项目身份只来自已校验pathname与当前BFF项目事实；body不接project/tenant/subject，响应沿原安装组件。write每次fresh当前Skill action，项目资格及身份在owner调用前后复核；跨tenant/user/project不转owner。正式Project response project_ref严格回绑canonical ID，拒个人ACK/错误project/未知wire，不能以URL或旧receipt代替权限。

public artifact15.1.0为additive145 operations，先精确移除四新增path并逆回完整Public15.0，再运行原历史检查；网站Skill ownerType和公开八类不变。没有新BFF资金/模型许可或正常环境激活。

## S2 skill.list 八类当前源码契约（2026-10-17，正常激活待续）

固定 Platform `e17283888ae1a8cf10365dfc8dd670115d6d187c`：RPC enum1 UNKNOWN/2 DIRECT/3 HUB；0/缺失/非法值拒绝。HTTP6.1.0及acquisition profile/provenance同commit。公开唯一/v1/skill.list的SpecificationPublicSkill.owner_type为personal/official/team/project/app/hub/device/unknown；仅此公开item改词表，不新增字段、required、alias或mutation输入。artifact15.0.0表示响应枚举配对切换，不是HTTP/v15。原14.8完整SHA `a9729722383de5571821961357051499612d12c76aa835b8774828adea82a577` 通过严格去三枚举值/还原version逆回，不改任何其它operation/schema/metadata。

hub来自已提交安装取得事实；unknown来自显式未知取得或合法但未识别的ownership；direct才按真实owner/官方分类映射。内部非法enum/绑定不转unknown。网站ownerType、共享revision owner_type与source_kind各保原语义，不复用公开八类替换所有字段。无正式Device发现/OpenApp准入不宣称这些入口已可用；不改变现人类身份范围来模仿Manus APIKey/OAuth。

项目query保原BFF项目当前资格和前后复核，返回安装exact revision但id仍稳定series，停用安装照常列出，列出不启用。creator_info仍仅真实IAM creator，不借publisher替代。生成、实际wire与产品组合分层验收；尚未执行的消费者/正常数据库和服务切换不算完成。

## 2026-10-16 skill.list 官方参考复核（当前差距，不发行新契约）

当前业务源码b4292b6及唯一canonical `contract/openapi/v1/openapi.yaml`不变。重新读取[官方skill.list](https://open.manus.ai/docs/v2/skill.list)及[官方v2 OpenAPI](https://open.manus.ai/docs/v2/openapi_v2.json)，解析其Skill组件而非只看示例：七个字段名与当前SpecificationPublicSkill相同，双方item均未声明required；现有presence不应因示例全出现就改成全部必填。官方owner_type现为personal/official/team/project/app/hub/device/unknown，当前canonical/runtime仍五类；下文2026-10-09五类是历史快照，不再代表当前完整官方词表。hub/device真实来源生产及unknown语义仍待现有设计确认，不只扩枚举、不从ZIP/GitHub/audience推导来源，也不把损坏owner响应降级成unknown。

公开读取职责仍是已安装可供任务选择，包含停用项，读取不启用；当前聚合只传installed=true而不传enabled过滤，按精确安装source事实组装稳定series ID、真实作者和Unix秒，project_id先后两次按同tenant/subject核项目资格。稳定ID是既定Kokoro裁决，不改成revision UID；但列表回包不证明所返ID已通过项目默认/显式空选择与Agent pin继承端到端执行。正式个人更新保持精确pin，不能让新来源分类顺带改变更新/执行选择。

官方按API Key、standard OAuth Open App、trusted client区分返回范围与project_id资格；当前/v1/skill.list明确只调用既有fresh human Product Session admission、无第二API-key/Open-App主体入口。该差异须沿IAM可信caller与owner能力设计裁决，不能在BFF按header/body自报client类别、把机器身份当人类，或为对齐页面临时放权。既有网站私有RPC另有camelCase视图，既不是公开skill.list的替代，也不是应凭名称删除的兼容alias。

本轮没有改Schema、公开机器源或生成物，没有调用Manus业务API/取得凭据，也未发送模型/Tool/计费请求。现有skill-specification-http文件在Node22以concurrency2重验64PASS/0SKIP；真实loopback HTTP、受控owner/IAM及纯聚合层的证据不冒正常API Key/OAuth、真实项目安装或Agent执行验收。原始官方摘要SHA和逐字段比较只留本地ignored收据，非Root可编辑机器契约。

## 2026-10-16 Skill Share 创建与 Resolve 的活动版本校验（既有协议内修复）

Create 与 Resolve 使用和既有 Shared Summary 相同的精确 revision active/valid 资格，严格核 `source_ref` 与 owner UID，继续原包检查。POST 在持久化前和回执前读取；已有活动 locator 复用也必须重新核资格。withdrawn/disabled/draft/quarantined 或不可见仍为既有404，缺元数据依赖503，非法 owner 表示502；不新增 status/code/字段或放宽本人包预览，也不借 share 赋予权限。DELETE 继续原 creator/tenant 边界，不要求源仍 active，才能撤销失效链接。

预检查拒绝不调用 create；若预检后、BFF create 已提交才发生 owner 撤回，后检拒绝误导201，但已保存 locator 可能仍在。GET 不隐式删除或撤销它，不构造跨 owner 原子事务/回滚承诺；后续读取仍实时拒绝。原机器契约闭集、幂等身份/expiry、public 当前14.8/139与独立 browser-private profile 不变。

## AUTH-P3：BFF→Platform auth 消费边界（实施设计，2026-10-16）

普通 BFF 全部 Platform surface 固定新 owner auth profile 的 commit/version/digest；catalog 与 skills_admin 从 IAM workload token 切换专用本地服务 Bearer，projection/MCP/Custom API 沿现 direct 模式。此为内部 breaking auth 消费，不改 Public14.8、139 operations、HTTP body/status、OpenAPI 或浏览器认证。人类 IAM session/action、第三方 OAuth、Agent 执行 proof 与 Billing 资金授权不变。只接受新严格凭据文件，不为旧 OAuth 文件加 fallback。机器 profile 与源码/正常配对的证据分别记录。

## SKILLS-UPDATE U3：个人安装更新 public 契约（本地源码已实现，未正常激活；2026-10-16）

唯一机器源 `contract/openapi/v1/openapi.yaml` 现为 14.8.0 additive：`POST /v1/skill-installations/{installation_id}/update`，operationId `updatePersonalSkillInstallation`，public/beta、owner kokoro-bff、idempotency required、permission `product.skill.install`（复用当前 IAM install action，无新授权词）。body 必有且仅有两个严格 source-ref 字符串 `expected_source_ref`/`source_ref`；path ID、单 Idempotency-Key 沿现安装闭集，禁止 query/重复 JSON keys/未知键/显式 null/非 UTF-8/超 65536 bytes。内容类型仅 application/json，身份与 command digest 不由 body 提供。

成功 200 `{data:{installation,change:"upgraded",event_id,replayed}}`；安装 leaf 沿唯一 SkillInstallation，event_id 必需。实现再核 ID 等于 path、source_ref 等于请求目标、installed=true 且无 removed_at，保 enabled 的 false。错误沿现状态专属组件：400 invalid_skill_installation_request/缺 key，401/403 当前 session/service/action denial，404 不可见，409 idempotency_conflict/command_in_progress，412 precondition_failed，413 body too large，429 rate_limited，502 response_invalid，503 dependency_unavailable，504 dependency_timeout；不暴露内部异常/provider响应。每次含 replay 都重新用户/动作准入，响应 no-store 与 x-request-id。

owner 唯一 Proto 的 Update 请求只含 request_id/command/installation_id/expected_source_ref/source_ref，使用原 `product-personal-installation/1.0.0`。本仓固定 owner `11cb7604a5385047fd872cedc8a55273eae59043` 的 Proto/descriptor/update profile/provenance digest 并正规生成，不导入 sibling 源码；HTTP projection 的独立 pin 不因本 RPC 加法移动。本地 client/route 与机器已接线；正常服务未切换，本节不代表 API 已正常激活；旧 Install/Enable/Remove 各自语义不变。


## SET49：主线与设置归档合同集成

合并主线已批准的MCP public四写删除及既有设置/归档能力，以16.0.0/146发行（breaking删除，不冒minor）。integration-public-contract.mjs逐字节验证完整当前合同及有序清单，精确恢复原15.4全文/150后委托全部原inverse和oracle；main贡献保留，不修改Skills/MCP业务。Billing唯一pin使用正式experimental.5发行，保三读与严格专用404；当前验证进行中，正常服务不变。

## SET-47 本人归档任务 Public15.4 D0（2026-10-15；未实现/未发行）

传输边界补充：exact encodeURIComponent wire不变，BFF原生raw HTTP仍可读取历史ID `.`/`..`；WHATWG URL（含fetch）会规范化dot path segments，百分号编码点也不能解决。Web后继须对此两ID在fetch前拒绝并明确禁用归档/恢复说明，不做双重解码/fallback/新API；不能宣所有历史ID浏览器皆可操作。普通conv与Unicode ID不受此限制。

当前阶段更新：四操作实现候选已完成，正常outer gate与正规150清单已接线，原15.3全文/146及全部历史inverse继续；下方“设计阶段未接runtime/门”的描述保留为D0历史。源码纯门证据与未验PG/正常组合见CURRENT，未发行不得消费者固定工作树artifact。旧正常run与DB未改。

GET `/v1/sessions/{session_id}/archive` 为同一归档路径上的正式 chat.read/idem none 本人状态读取，成功同 `{data:{session_id,archived_at}}`，未归档明确返回NULL，foreign/deleted/失效父同404。Web active任务列表合成必须正式读state：confirmed archived不合成；404新draft按原行为；未知失败不能当unarchived。由此新增四operations、三paths，总150，旧Chat响应字段不变。

路径 session_id 接受任意合法非空 UTF8 历史 Conversation ID（包括Unicode/大小写），按 exact encodeURIComponent 后的单segment可逆canonical百分号表示处理，不能抄move的conv_UUID限制；拒非法编码而不trim/归一化ID。分页同毫秒Unicode/BMP/astral与大小写按C UTF8字节序必须实测。后继多primitive query/command沿TS§6.7用具名Readonly对象，不复制旧长位置参数。

运行裁决：保留旧正常run，不重启/ALTER/清事实。后继正式BFF/Web pin由Root用formal launcher现--web-port开启独立新run，复用现PG/Redis服务器但使用自有fixtureDB/namespaces；canonical fresh install即可。不建立在线升级或migration链，本片没有运行资源操作。

唯一 canonical `contract/openapi/v1/openapi.yaml` additive15.4.0/150，旧15.3.0/146完整字节逆恢复 SHA256 `694251d4f4c1bcc9a79ae4fd2d4c050c87a0a8af39bea0a9f0bed3a4dcae5ad5`；原有序146数组 JSON SHA256 `e88eca53ec77f6b05cba05188b1a72445e5c7fad07657930a1d317d5f0cc2658`。不改旧 operation/schema/permission/oracle；独立 outer gate 成功后委托 SET21 门。现正常门入口及清单未升级，runtime 尚未注册，Web 不得提前消费。

| 正式候选 endpoint | 准入 | 请求/成功 |
| --- | --- | --- |
| GET `/v1/account/archived-tasks` | 本人 chat.read | 仅 limit（默认20、1..100）、cursor（1..2048）；`{data:{items:[{session_id,title,archived_at,project_ref}],next_cursor}}` |
| GET `/v1/sessions/{session_id}/archive` | 本人 chat.read | 无query/body；`{data:{session_id,archived_at}}`，NULL为确知未归档；unknown不可冒NULL |
| POST `/v1/sessions/{session_id}/archive` | 本人 chat.write | strict 空 JSON `{}`、恰一 Idempotency-Key；`{data:{session_id,archived_at}}` |
| POST `/v1/sessions/{session_id}/restore` | 本人 chat.write | 同上；fresh restore archived_at=null，历史 receipt 可返回历史值，必须随后 read |

成功与 error 均 closed JSON，无 meta；request ID 仅 x-request-id header、Cache-Control:no-store，429 带正整数 Retry-After。错误 `{error:{code,message,retryable}}`：400 输入；401 session_authentication_required/session_invalid；403 service_auth_failed/session_forbidden/product_tenant_forbidden；状态读及写404 session_not_found（foreign、deleted、无合法父均同404）；写409 archive_state_conflict；写413 body超过4096 bytes；写415 MIME/encoding；429 session_rate_limited；500 internal_error；503 product_tenant_not_configured/iam_admission_unavailable/具名 unavailable。具体 code/status/布尔闭集以 canonical schemas 为准；只有429/503 retryable=true，仍不意味着客户端自动重试写。所有状态响应≤1MiB、无 capability/cookie/location、无正文身份自报。

列表只输出四字段，title 原值不 trim/截断，不猜 max200；project_ref 保留原值或 NULL。归档时间为UTC固定毫秒，cursor 严格闭集绑定可信 tenant/subject/limit/archived_at/session_id，非签名且不授权；每 SQL 重验身份及 active Conversation/有效 Project。顺序 archived_at DESC、同刻 session_id COLLATE C ASC（UTF8字节比较），limit+1产生 next_cursor，无跨页快照。归档/恢复/删除/父变化会影响后页，不承诺整个遍历稳定快照。

Idempotency-Key 为恰一个1..128可见ASCII值，不 trim、不逗号合并（排空白/逗号）。两个命令共享 archive-state scope：tenant+subject+key；fingerprint含action/id。相同 key/fingerprint 返回原200 receipt且不再次写；不同 action/id返回409。必须先验当前 owner/status与父，再重放；delete胜出后404。fresh 相同状态不更新时间；fresh相反状态按行锁顺序生效，无 expected-state CAS。归档期间 directread/rename/move/share/Run继续，不撤销公开链接，不用取消副作用模拟归档；Web 禁止宣称“停止任务”。

HTTP 生命周期与超时见 TECHNICAL_DESIGN；空 JSON body拒重复/未知键、坏UTF8/JSON、非对象及query。JSON MIME/identity encoding、合法chunked、父取消、未知COMMIT均需后继真实负控。这里是设计契约，不是运行验证。

## SET-21 已验证的 public15.3（2026-10-15）

canonical新增GET /v1/account/shared-tasks / listOwnedSharedTasks，public15.3.0/146全文SHA256 694251d4f4c1bcc9a79ae4fd2d4c050c87a0a8af39bea0a9f0bed3a4dcae5ad5。独审/Root纯门与真实HTTP/数据库验证通过；完整15.2/145逆恢复、原操作字段和旧oracle保持。响应只有安全四字段，UTC毫秒符合canonical TIMESTAMPTZ(3)，同刻ID明确C/UTF8字节序。下文既定闭集/预算/权限/错误语义已实现；正常Web页面待正式发行后消费，不能把纯门/PG样本当浏览器验收。

## SET-21 本人任务分享列表（2026-10-15；Root真实RED后具名源码准入）

title保正规旧Chat字符串，不增加trim/全长200猜测或截断；shared_at降序的同毫秒session_id按UTF8字节升序（SQL COLLATE "C"），keyset比较同一规则，不依服务器locale或JS UTF16顺序。此新增排序说明须进机器合同和负控，原145面保持。

Root真实缺operation/版本/响应断言RED已复现。现按CURRENT表授canonical机器和具名实现；发行仍需冻结独审、Root复验及真实owner事实验证，拟15.3不得提前称为正式可消费。

目标新增一个GET /v1/account/shared-tasks / listOwnedSharedTasks，owner=kokoro-bff、visibility=public、stability=beta、idempotency=none、permission=chat.read。身份唯一原browser-service+Product Bearer在线准入和配置tenant；只列当前本人拥有可见的有效Conversation分享。发行前保持当前15.2/145，拟additive15.3/146先过完整逆恢复。

query只limit（缺省20、canonical十进制1..100）、cursor（缺省首屏，存在非空≤2048）；拒重复/未知参数、坏percent/UTF8、非GET/body framing、Content-Encoding/Idempotency-Key。sht1_ canonical base64url(JSON)，closed kind=shared_tasks、tenantId、subjectId、limit、sharedAt/sessionId anchor；fatal UTF8、BOM、重复decoded key、错误日期/身份/limit拒绝。cursor可编辑而非不可伪造身份，SQL每次重新过滤本人。UTC毫秒、shared_at DESC/session_id ASC keyset，不承诺跨页快照。

200 closed {data:{items:[{session_id,title,shared_at,expires_at}],next_cursor:string|null}}；最多limit条，同页session唯一且顺序合法，next存在必须有实际末条和后续候选，空页next=null。session_id/title沿现Chat合法原字符串，shared_at为Share.created_at，expires_at为真实nullable UTC时间；不公开share_id/url/capability，不推导完成状态。x-request-id只header、no-store/JSON，总响应≤1MiB，无新meta.request_id。原分享创建/撤销data.share_id+meta合同不改。

新endpoint closed错误{error:{code,message,retryable}}，无meta/details/SQL信息。status/code：400 shared_tasks_input_invalid；401 session_authentication_required/session_invalid；403 service_auth_failed/session_forbidden/product_tenant_forbidden；429 session_rate_limited；503 product_tenant_not_configured/iam_admission_unavailable/shared_tasks_unavailable。429/503 retryable=true，其余false；429 Retry-After可缺省，存在沿现admission/send为canonical1..86400，其他状态无该头。未公开错误归503 shared_tasks_unavailable，不透任意code/message，不修改通用send/admission；本精确GET的外层catch同closed503。

route入口单10s上限含准入/输入/DB/输出，停止/逾时无新查询或输出，零自动retry。invalid/anonymous零repository I/O；cursor跨身份/tenant/limit不得进SQL，missing live store503而非假空。唯一machine为canonical OpenAPI及正规inventory；Root三设计已独审无确定P1/P2；当前Web接收后另授机器/源实现。下方历史面字节保持。

## SET-19 本人姓名 public PATCH（2026-10-15；已实现并通过真实owner验证）

当前canonical public15.2.0/145全文SHA256 3214e32d273fbc514db1c1f2307f7855b623f1f613fb1da710cc51d23c41f453；正式IAM消费、独审、Root真实保存/CAS/权限/撤销验收见CURRENT顶部。Web消费与实际页面闭环仍未验收。

正式消费IAMc64faa7992301f31495e163d04049c48a23d0225/internal0.13.0，artifact SHA256 c22c55ef2b963a89ca3e03016138c2da74f5f005edf1b6ee8c5572daaf466262。唯一新增PATCH /v1/account/profile / updateAccountProfile：owner kokoro-bff、visibility public、stability stable、idempotency none、permission iam:account-profile.write。public additive15.2.0/145operations，现15.1全文SHA5972f7be07a0117d8ee036fa4e742da7942b3c864d009c2847e70e69112a747d为不可修改的inverse起点。

严格无query/application-json实际body≤64KiB，恰{name,expected_name}两required string；未知/重复key/坏UTF8/非JSON/Idempotency-Key/重复Content-Type拒绝。name1..100 UTF16 code units、合法Unicode、无C0/C1、无ECMAScript trim边界空白，不修剪归一化；expected_name为userinfo原名含空字符串及原空白，最长16384 UTF16，不规范化。只转发本人admitted Bearer，subject来自正常Product admission，tenant/client/target不从body取。

Content-Encoding仅缺省或唯一identity；允许合法单一chunked并按真实字节有界读取。Node HTTP parser在进入route前拒绝的冲突framing不保证应用层plain JSON，不能以该边界冒本片已响应。

expected_name正式仅UTF16长度限制，含escaped lone surrogate也须逐字保留；入站采用本片flat JSON codec而非会拒该原值的全局strict parser。fatal UTF8/JSON语法/duplicate decoded键/closed两string规则保持，新name仍必须wellformed；原全局parser与其他API不放宽。owner新ACK仅含新wellformed name与真实subject，仍沿原strict原文检查。

200严格{data:{subject,name}}，subject与admitted subject相同且name与新提交原文相同；所有本片响应no-store、x-request-id仅header，JSON无meta/request_id/credentials/email/role。错误严格{error:{code,message,retryable}}、不含details/meta/raw owner正文。normal admission原401/403/429/503代码保留但采用本片plain envelope。

| IAM status / code | BFF status / code |
| --- | --- |
| 400 INVALID_ARGUMENT | 400 account_profile_input_invalid |
| 401 UNAUTHENTICATED | 401 session_invalid |
| 403 PERMISSION_DENIED | 403 account_profile_forbidden |
| 404 TENANT_NOT_FOUND、409 TENANT_DISABLED | 403 session_forbidden（资格失效，不是姓名冲突） |
| 409 CONFLICT | 409 account_profile_conflict，不泄露新姓名；需userinfo重读 |
| 413 PAYLOAD_TOO_LARGE | 413 account_profile_request_too_large |
| 429 RATE_LIMITED | 429 account_profile_rate_limited，仅合法Retry-After1..86400 |
| 500 INTERNAL、503 DEPENDENCY_UNAVAILABLE、缺配置/预算/网络 | 503 account_profile_unavailable |
| owner未知tuple/不合法header/raw schema/错subject/name | 502 account_profile_response_invalid |

本地body校验400/413；本片unexpected内部错误最后兜底500 internal_error。retryable只429/503为true，写仍不自动retry。normal admission诸码按既有authenticate/service/tenant语义原样，JSON剥仅本片metadata。绝对总时间min(config.upstreamTimeoutMs,10s)，headers+正文总min(config上限,1MiB)；迟到promise/abort/已close响应不得冒成功。request期限不是数据库rollback保证，unknown后正规userinfo读当前name，再由用户明确决定新PATCH。

正常IAM生成保18已有operation，仅新增1；不改生成器全局strip策略，以具名raw pre-strip+strictParseRawJson封闭新响应。public新独立outer inverse恢复完整15.1 artifact及144清单后运行旧治理，不重算旧摘要/删旧negative oracle。源码/机器实现已冻审且Root真实owner验证通过；Web浏览器闭环仍未完成。

## SET-18 本人 Session public 边界（D0 独审通过，2026-10-14；尚未发行）

IAM正式错误缓存修补已发行284bfd8fea91d57dae18fa2b7c772d75c7b6dcd9，internal0.12.0 artifact仍为SHA256 f6f3588d0fe52e5b3eed57e117e25b991caabc9e2825d1a0edcf9149f6a3e26b。本仓V2业务已冻审并真实BFF→IAM通过，public15.1.0候选SHA2565972f7be07a0117d8ee036fa4e742da7942b3c864d009c2847e70e69112a747d、canonical/inventory144；正式单pin更新及两新增消费元数据/格式回归修补已完成并接收，源码任务仍沿Root卡。本仓待Root正式发行，尚未正常激活；Skills/连接器业务排除，Root保留docs/Git/资源与最终验收。

canonical事实源仍为contract/openapi/v1/openapi.yaml，当前候选public15.1.0 SHA2565972f7be07a0117d8ee036fa4e742da7942b3c864d009c2847e70e69112a747d；其父public15.0.0全文SHA2565f6b1178cb878718090ba65d6b0d563185078624af0d3d46a01e568af87264a4。候选只追加两operation/安全closed component，public15.1.0同/v1/144 operations；不改原142项字段、权限、错误、metadata或历史摘要。先新最外层门精确剥两路径/components/版本还原完整15.0原字节，再执行原历史门。

| 操作 / operationId | 目标请求与响应 |
| --- | --- |
| GET /v1/account/sessions / listAccountSessions | 本人iam:account-session.read；limit1..100默认25、cursor省略或非空≤2048、拒重复/未知query和body；200 {data:{current_session:{session_id,created_at,expires_at},sessions:[同形]},meta:{request_id,next_cursor}} |
| DELETE /v1/account/sessions/{session_id} / revokeAccountSession | 本人iam:account-session.revoke；非空sid≤255与owner正式约束一致、无query/body/Idempotency-Key；200 {data:{session_id,revoked:true},meta:{request_id}}只从owner已提交ACK投影 |

metadata均owner=kokoro-bff/visibility=public/stability=stable，permission分别上表scope，idempotency=none；DELETE为具名owner状态收敛，不使用BFF通用receipt或请求key。仅正常Product user_delegated本人，tenant来自admission，跨tenant会话列表仍由owner判本人；机器/operator不得替代。参数/字段以正式0.12 schema发行核验后冻结，设计不是可调用contract。

request-id/no-store使用BFF现安全输出。owner错误只按固定generated错误schema和status/code一致关系映射：400 account_session_input_invalid；401 session_invalid；403 account_session_forbidden；404 account_session_not_found；409 CONFLICT→account_session_conflict，TENANT_DISABLED→403 session_forbidden（与session-admission.client.ts对owner409的普通准入映射一致；不作为撤销冲突）；413 account_session_request_too_large；429 account_session_rate_limited仅合法Retry-After1..86400；500/503/缺配置/timeout/网络→503 account_sessions_unavailable；畸形/错绑定/未知状态或错误tuple→502 account_session_response_invalid。常规外层service/admission错误保持，不把上游敏感message透传。

未知DELETE结果不是失败回滚或成功：无自动retry，Web必须重新list核目标是否仍active；取消也不等于rollback。current撤销409、foreign/不存在同404、保留expired本人重复200、清理后404由IAM唯一裁决。本仓不变更scope/resource或注册图、不用旧refresh增加scope；正式scope演进与新authorize由Root资源阶段完成。

唯一owner consumer生成使用正式0.12.0 source commit/version/SHA256；保持原16具名operation并追加2项，不读取未提交源码/手改generated/保旧pin双轨。Web随后仅消费正式public15.1.0固定artifact；Skills/连接器操作与其contract原字节保持。


Root源码复核纠正统计：旧canonical142/旧inventory141漏一个已存在的browser-private操作；本片正规完整inventory144，严格逆恢复旧141清单与完整15.0 API原字节。此清单登记纠偏没有Skills业务/API/权限语义变化，旧Conversation与format失败不冒通过。

## SET-15 Catalog 固定消费者与未开放 checkout（2026-10-13，候选已实施）

保持现public15.0.0 listBillingPlans、BillingPlan七字段及所有operation不变；已固定Billing ba98badab9445ae676a8f48faa55912d42ce5d2e的exp4与SHA2568a3d12cf7517e7ee6cb2958b740bb69ab4831d38a383e61aca383b5fd1e8b27a（required offer_key为owner strict breaking），以原字节vendor与正常generator替换exp3单pin。新增唯一generated getCatalog，并保原两本人读。严格消费GET /v2/commerce/catalog的data.items/page与闭集item；完整有界分页后一次投影，合法终页items=[]才是空目录，失败不转空/不截尾。金额/积分保持decimal string；真实运行组合与浏览器验收仍待Root。

plans失败统一现public允许503 billing_unavailable，不新增未声明502、不转owner错误正文/身份或任意status。认证来源为当前IAM admission，可信tenant编码与独立Billing service/internal/Bearer因素；任何缺失/错配/取消/畸形owner响应关闭失败。checkout继续现入站校验后明确503 billing_unavailable且无owner I/O，移除旧v1双读/写路径；不修改公开成功shape或借目录修复开放支付。重定向、未知字段、非终页空items、循环cursor/重复revision或key、预算耗尽都不得返回部分成功。

## SET-13 TeamRole 权限闭集纠正（2026-10-13，机器待实施）

唯一可编辑事实源仍为contract/openapi/v1/openapi.yaml。目标public15.0.0在TeamRole.permissions增加可选platform（仅execute）与skill（IAM当前15动作），每数组仍非空，未知域/动作拒绝；既有六域、Role字段、所有operation路径/metadata、错误与分页保持。动作来自当前固定IAM机器契约，不建第二权限事实源，字段查看不授予执行或Skills能力。

这是strict consumer的breaking，不作为minor；本次Root仅批准自有开发隔离BFF/Web在/v1配对切换，先完成owner和历史逆门，再发布不可变SHA/digest并由Web正常生成，最后Root实际登录；禁止原14.7消费者与新响应混跑、alias或fallback。尚未批准main/日常/生产激活，无法核验的Admin consumer须在后继激活前补齐；未来稳定breaking仍按contract README/v2政策。本片最外层验证新两域精确闭集后仅撤销这两字段与version，必须恢复完整public14.7摘要，再运行原14.6及全部历史门，不改旧fixture/摘要。
## CV-SVC MCP workload认证profile（D1，2026-10-13；BFF 源码候选已实现，待配对验收）

现 `/browser/v1/mcp/*` 与 `/v1/admin/mcp/providers*` 的HTTP方法/body/成功错误/CAS/幂等不变，Platform `ProductMcpPersonalService`、`McpProviderAdminService` Proto和固定generated输入不变。只切这两internal-owner caller认证：HTTP/Connect Bearer内容是opaque本地service credential，caller=kokoro-bff、surface严格mcp_personal或mcp_admin、tenant绑定；不再取得IAM机器OAuth token，不包含第三方用户OAuth变化。

BFF每次请求从受限文件读取version1严格闭集 `{version:1,entries:[{credential_id,secret,caller,surfaces:[指定唯一surface],tenant_id}]}`。三用途（含projection）使用独立credential ID/secret和实例，不容错旧OAuth数组schema，不fallback；回显、错误、日志不含secret。tenant出站一致性头为owner实际读取的`x-kokoro-tenant`，subject由已准入BFF代言。human admission/action权限和执行proof均保持既有事实，不把服务直认证当“无授权”。

consumer生成物和body不改，当前owner pin/digest仍保护；认证profile代码/设计/负控先由owner配对批准再切运行配置。不增加public API/v2或兼容路由。真实两surface配对与普通用户/Admin权限负控尚待验。

## CN-07a MCP Provider Admin typed owner errors（2026-10-13）

既有六个 `/v1/admin/mcp/providers*` operation与成功schema不变。Platform Connect `InvalidArgument`统一映射`400 invalid_mcp_provider_admin_request`；`NotFound`仅对get/update/enabled/remove映射`404 mcp_provider_admin_not_found`；mutation的`AlreadyExists`映射`409 mcp_provider_admin_conflict`且不可重试，`Aborted`映射`409 mcp_provider_admin_command_in_progress`且可重试，`FailedPrecondition`映射`412 mcp_provider_admin_precondition_failed`且不可重试。operation不允许的同码、Unauthenticated/PermissionDenied及其他依赖错误仍为`503 mcp_provider_admin_dependency_unavailable`，不得伪装成人类403。映射只读Connect Code，不按owner message猜测；响应不透传owner message、headers或秘密。canonical已声明这些status且error code为string，本片不改OpenAPI版本或生成物。

## App API 修复当前切片（2026-10-13）

- HTTP 业务路径统一 `/v1`，artifact SemVer 不等于路由版本。Billing 唯一消费源为 owner commit `1ceeae550f05857d1e7fa0da1e83af23a552f0ca` 的 `contract/openapi/v1/openapi.yaml`（SHA-256 `35b4a2d1d178f6a548fe67460c8e8cbba9eb247296f9051f6ec23060235baff8`）；现生成器只消费本人 Credit 两读，不回退旧 v2。
- Platform projection 固定 owner commit `6b4c9db6719d2f5fd37a752921e603f4b0221de6`、HTTP artifact `6.0.0`（SHA-256 `50afde42d7a1564ecb058c78dff68e4ea81bbb3552bd96dbf6203b036ec381ae`）。该 surface 使用 owner profile 的本地 Bearer、caller/surface/tenant 绑定和每次重读，不作机器 OAuth/token 缓存；其他 surface 和外部当前用户 IAM 准入不随此片改动。
- Billing 只有符合 owner envelope 的 `billing.credit_account_not_found`、非 retryable 404 才投影账户空态；未知路由或其他 404 是依赖协议错误，不冒充账户不存在。传输使用 owner 定义的 `x-request-id`。
- 不变更公开 BFF wire、数据库或目录边界；仅替换对应 vendor pin 和正规生成物。源码门禁、正常运行切换与浏览器验收分别记录在 `docs/CURRENT.md`，未实施的付款/推理/其他认证切片不计入完成。

以下阶段记录保留原时点，不覆盖本段当前调用方案。

## T-K03.20 本人 MCP 可连接目标投影（BFF 已实施，待 Web 消费）

canonical public 从 `14.5.0` 递增至 `14.6.0`，不新增 endpoint 或命令。`PersonalMcpProvider` 可选新增 `connection_server_id`：它是 Platform 仅在 Provider 恰有一个 `registered + streamable_http` managed Server 时发出的不透明 ID。它不表示 endpoint、origin、tool selector、credential、OAuth URL 或连接已建成；缺失表示 Browser 不可发起既有授权/建连接命令，不能猜测或替换 ID。所有现有请求、错误 envelope、CAS、`no-store` 与 current-subject admission 保持不变。

## T-K03.19 本人 MCP OAuth/Connection Product API D0（BFF 已实施，待 Web/Agent 端到端验收）

固定在 canonical public `14.5.0 / 155 operations` 的既有 `/v1/self/mcp`，均为 `owner=kokoro-bff`、`visibility=public`、`stability=beta`、`cache-control:no-store` 与可信 session 的当前 `mcp_personal` action。Browser 仍只经 Web 同源 adapter 调用 BFF；没有到 Platform 的直连、浏览器 bearer 转发或自报 tenant/subject。

| 操作 | HTTP | 请求 | 成功 |
| --- | --- | --- | --- |
| Begin authorization | `POST /v1/self/mcp/connectors/{connector_id}/authorization` | `{server_id,expected_state_version}` | `{authorization_id,authorization_url,expires_at,connector}` |
| Reconnect authorization | `POST /v1/self/mcp/connectors/{connector_id}/authorization/reconnect` | `{server_id,expected_state_version}` | 同 Begin |
| Complete callback | `POST /v1/self/mcp/authorization/callback` | `{state,code}` 或 `{state,error}`，二选一 | `{connector}` |
| Create connection | `POST /v1/self/mcp/connections` | `Idempotency-Key` + `{connector_id,server_id,allowed_selectors,expected_state_version}` | `{connection}` |

所有 body strict JSON、最大 64 KiB；ID、state、code、error、selectors 与 CAS 在 BFF 入站闭集校验。Complete 不记录/回显 code 或 token；Platform 依据 opaque state 的受信绑定校验当前主体。Connection 的 Idempotency-Key 直接成为 Platform command identity，BFF 不另建 receipt。错误沿当前 personal MCP 的 400/401/403/404/409/412/413/429/502/503 闭集，不添加 OAuth 供应商专用 HTTP 协议。

<!-- T-K03.19-BFF-MCP-OAUTH-API-D0-END -->

## T-K03.19 D3 Provider 管理 API（2026-10-11；实施中）

BFF 将在既有 `/v1` 下新增 `GET|POST /v1/admin/mcp/providers` 与 `GET|PATCH|DELETE /v1/admin/mcp/providers/{provider_key}`、`PUT /v1/admin/mcp/providers/{provider_key}/enabled`。它们是 `owner=kokoro-bff`、`visibility=browser-private`、beta 的受控管理 adapter，不是 Platform RPC 的重命名，也不暴露 Connect、workload token、tenant/subject header 或 owner receipt。所有成功为 `{data: …}`、所有失败为稳定 `{error:{code,message,retryable}}`、全响应含 `x-request-id` 和 `cache-control:no-store`。

读取与命令（含同 key replay）均在 BFF fresh session 后检查 IAM `mcp_catalog/manage`；普通用户和过期/失权管理员在任何 Platform 调用前终止。命令要求单个 `Idempotency-Key` 与 body `expected_state_version`，其余身份只从可信 session 获得；Platform 返回的 provider/CAS/replay 状态经窄映射为 snake_case。Platform `McpProviderAdminService` 是唯一 internal-owner contract，固定 `b95365f` 的发布输入；无 HTTP alias、无自由代理、无浏览器 bearer 转发。

<!-- BEGIN:T-K03.13-BFF-MCP-PERSONAL-CRUD-D0 -->
## T-K03.16 Connector V1 API 对齐 Manus（已实施）

唯一新 public operation 为 `GET /v1/connector.list` / `listConnectors`，`owner=kokoro-bff`、`visibility=public`、`stability=beta`、`idempotency=none`、权限为当前已验证的主体 Connector 读取资格。该接口无 `project_id`、分页、筛选、body、`Idempotency-Key`、调用方 tenant/subject；未知或重复 query、body、transfer-encoding 均是 `400`。HTTP 成功固定 `200`、`cache-control: no-store`、`x-request-id`，JSON 与 Manus 字段完全为：

```json
{ "ok": true, "request_id": "…", "data": [{ "id": "…", "name": "…", "type": "mcp", "description": "…", "category": "…" }] }
```

失败固定 `{ "ok": false, "request_id": "…", "error": { "code": "…", "message": "…" } }`，不添加 BFF 泛用 `retryable/details`，也不泄露 owner payload、状态、CAS、scope、credential 或 Provider key。`data` 可为空；每项五字段都必需。`id` 是 Connector 的稳定 owner ID，`type` 仅 `builtin|byok|mcp`，仅 `active` Connector 代表已安装，停用仍在结果中；其余字段只取 owner 实际 display/metadata。Provider 必须具备恰好一个公开 category 才能映射到 Manus 的单值 `category`。缺任一必需投影、Connector 与 Provider 关联不一致、Provider category 不是单值、超出有界扫描或 owner protocol 无效都关闭为 `502 connector_response_invalid`。当前会话/权限拒绝为 `401/403`，owner 依赖或 deadline 为 `503 Unavailable`。完整接口使用当前用户身份，不改变连接、安装、启停或授权事实。

`/v1/self/mcp/*` 不是 `connector.list` 的 alias。它将作为下一 Web browser-private 管理迁移的一部分整体删除 public exposure；在该迁移完成前，任何新 public consumer 只能使用 `/v1/connector.list`。这避免以 compatibility fallback 把两种 API 表示长期并存。

<!-- T-K03.16-CONNECTOR-V1-API-D0-END -->

## T-K03.13 本人 MCP 管理公开边界 D0（目标，未实施）

当前 canonical public **14.4.0 /151 operations，沿 /v1**。这是已真实启用四读的 Connector strict 五字段发生 breaking 的显式本地 development clean-slate 配对切换例外：无外部生产客户，唯一已核 Web 消费方先固定新 artifact/strict schema 全验，Root 再切正常 runtime；中间不宣称兼容/闭环，无旧 schema fallback/alias。未来对外稳定 breaking 仍遵原 /v2 策略，例外不泛化。

六新增：POST /v1/self/mcp/connectors（createPersonalMcpConnector，201）；PATCH /v1/self/mcp/connectors/{connector_id}（updatePersonalMcpConnector，200）；PUT 同资源 /enabled（setPersonalMcpConnectorEnabled，200）；DELETE 同资源（removePersonalMcpConnector，200）；GET /v1/self/mcp/providers 与 /{provider_key}（list/getPersonalMcpProviders，200）。原四读 connector 保原五真实字段，加 required enabled/state_version，optional display_name/description/created_at/updated_at 按 owner presence 输出，缺省不造空值/时间。connection六字段与旧active投影不变。Provider只投影 Platform 目录事实：名称、描述、类型、分类、示例、作者、官网/隐私链接、enabled/CAS；可选 cover_image_url 与 updated_at 仅在 owner 明确提供时返回，缺失保持未知。真实目录/filter/分页，不是静态推荐、使用量或连接事实。

命令 strict JSON：Create provider_key/connector_type/display_name/description；Update display_name/description/expected_state_version；Enabled enabled/expected_state_version；Remove expected_state_version。名称1–100、描述0–1000 Unicode scalars且拒 lone surrogate；CAS为原真实 **1..Number.MAX_SAFE_INTEGER decimal字符串**，不推算/截断。原 Idempotency-Key 可打印ASCII≤191，直接为 owner commandId；JCS SHA256 精确绑定 {method,tenant_id,subject_id,input}，method为正式ProductMcpPersonalService方法全名、type为正式enum整数、CAS为decimal字符串，不混request_id/key或自报身份。owner既有receipt裁决重放/冲突/并发。所有命令只真实 {data:{connector}}，无伪replayed/event/connection字段。

每 operation 逐status闭集：现400/401/403/404/429/502/503读族保持，命令加409 typed idempotency冲突/进行中、412 CAS/state precondition、413 body超限；provider总list不开放404。命令成功后重新准入失败为未知，不冒owner回滚。10s总budget含≤65536请求body，response累计1MiB、requestID/no-store/取消闭合。schema-first机器 RED→GREEN；新六operation及connector delta精准逆恢复原13.3 canonical SHA256 `0a9683b38cfd30534931dd0cd7821e3ccded94d6d15613a711cebc1f1e83a209` 后委托原历史checker；其余137非本片 bytes/约束与旧baseline/hash负控不重算。
<!-- END:T-K03.13-BFF-MCP-PERSONAL-CRUD-D0 -->

<!-- BEGIN:T-K03.13-BFF-MCP-PERSONAL-READ-D0 -->
## T-K03.13 已发行本人 MCP 四读：实现目标（2026-10-10）

当前唯一机器事实源 `contract/openapi/v1/openapi.yaml` 为 **13.3.0 / 137 operations**。本片只实现其已有 `/v1/self/mcp/connectors`、`/v1/self/mcp/connectors/{connector_id}`、`/v1/self/mcp/connectors/{connector_id}/connections`、`/v1/self/mcp/connections/{connection_id}` 四 GET，原 Resolve/Skills/current active MCP 投影不变；无 public 增量或 generated 更新。`/providers` 未在此 canonical 发行，不映射为 connector、也不放开任意 self 路径。完整个人创建/更新/启停/移除、授权/connection 和后台依赖后继 owner 契约，不由本片替代。

现 guard 对四读实际 503；目标固定 vendor `91bc3655ebd3648cb8f8ccddfacb5628bdeb1c5c` 的 `ProductMcpPersonalService` 对应四 RPC→严格 `PersonalMcp*` public 白名单，安全属性/enum、分页 nullable cursor 和 ID/主体绑定按机器及下文 R320，不透传 private 字段。GET 无 body/transfer-encoding/idempotency-key，参数不 trim，重复/未知 query 拒绝；可信 tenant/subject/request ID 来自准入，返回前重准入。全部 no-store、request ID，绝对 10s/1 MiB/取消边界沿 TECH。

沿现 PersonalMcp status/code/retryable 闭集：400 invalid_mcp_personal_request；401 session_authentication_required/session_invalid；403 service_auth_failed/session_forbidden/product_tenant_forbidden；404 mcp_personal_not_found；429 session_rate_limited；502 mcp_personal_response_invalid；503 product_tenant_not_configured/iam_admission_unavailable/mcp_personal_dependency_unavailable。Retry-After 仅按既有合法规则处理；owner 机器资格或 deadline 失败不伪用户 401，不新增 504/499，未知 wire/enum 拒绝。正常 workload IAM 与 Platform surface 当前未激活，Root 独立核资格/handshake 后才记录真实四读通过；受控 HTTP 测试不代替正常组合。
实现放置同步：`src/bootstrap/runtime.ts` 已纳入本片允许集，composition 创建/close 退役个人 client 与 token（含在途取消）；不采用原 R320 的 WeakMap/static client 生命周期，其他原文保留为历史。
<!-- END:T-K03.13-BFF-MCP-PERSONAL-READ-D0 -->

<!-- BEGIN:T-K03.14-BFF-SHARE-REVISION-D0 -->
## T-K03.14-BFF-SHARE-REVISION D0（目标，2026-10-10）

当前 BFF main `c9e8fab`，public13.2/136 operations；本片是目标设计，尚未改业务/机器/生成。Platform 正式 `91bc3655ebd3648cb8f8ccddfacb5628bdeb1c5c` 已发布 exact `ProductSkillReadService/GetSkillRevision`（skill-product-revision-read-v1/1.0.0，75/39/24）。现 SkillSpecification detail 仍由 series current 取得，不能供共享旧 revision 摘要；现 Resolve 六字段不含 metadata。

目标 public13.3.0/137 operations 新增受准 `GET /v1/skill-shares/{share_id}/skill`；原 Resolve 六字段、Create 禁 Idempotency-Key/无自动重试、DELETE creator 资格与 GetSkill current 语义不变。分享不授予资源权限，浏览器仍 Web同源→BFF→Platform/IAM，无 owner SQL/管理员替代入口。

新operation `getSharedSkillRevision`，owner BFF/public/stable、permission skill.read、idempotency none；沿现Product envelope/error family逐status闭集（200成功，400/401/403/404/429/502/503；owner不合规响应502 skill_response_invalid，依赖503；不发明个人命令族）。request为closed GET share_id（现ID规则）；零body/query/key，no-store/request-id。

候选严格data白名单为share_id/source_ref/skill。skill必有skill_id、series_id、revision（owner decimal string）、display_name、description、tags、example_prompts、category_keys、created_at、updated_at、owner_type及真实source_kind（personal/official/third_party）；original_name/author/cover_image只有事实才出现。skill_id是精确UID，Web内部version映射此UID，不用decimal revision或series；无current=true/installed/enabled/usageCount/publisherType，安装事实继续正式installation读取。author定义为真实creator_ref:user的IAM found投影{user_id,display_name}，缺引用或正规not-found则omit；IAM失败不能吞成缺作者，身份/请求ID/预算校验继续生效。真实publisher引用若要另展须Root具名批准字段，不作为creator别名/fallback。

读取顺序：findActive(可信tenant,shareId)并核shareId/tenant/resourceKind=skill_revision/活动与expiry→固定source_ref解析UID→Platform GetSkillRevision(product purpose)→assertSkillWireKnown、projectSkillProductRecord(expectedUID)且source/series/revision/active/validated与owner scope/source_kind合法→正式IAM作者→窄schema校验→再次findActive并核同shareId/tenant/resourceKind/sourceRef/created/expiry/url且仍未撤销→active signal/总deadline后send。失效/不可见404；不冻结分享权限、不借creator身份读取。

封面只在该record有已验证真实cover时输出 `/api/v1/skills/{encoded exactUID}/cover`，沿既有受准read；不造空封面/series拼接/外部图。tags/examples只owner原值，无默认三例。原GET Resolve data严格六字段share_id/source_ref/url/created_at/expires_at/revoked_at不扩；原POST未知结果不自动Create，正式origin修正已独立归Root，不consumer改URL。metadata与包目录/选UTF8文件仍分别调用现正式bound接口，不从SKILL.md推作者/标题。

新机器OpenAPI public13.3.0/137与本文同步；当前未发行，Web不得提前当可用API。旧136路径/operation/errors保持，新增schema不是camelCase GetSkill alias。完整vendor/generated资格与路径闭集见同任务TECHNICAL_DESIGN；执行前先Root设计门，机器/生成后完整contract及负控，再正式Web消费与浏览器验收。

<!-- END:T-K03.14-BFF-SHARE-REVISION-D0; original body follows -->

## T-K03.14-BFF-GITHUB-ADMISSION（目标，2026-10-10）

当前共享 AI/GitHub handoff 在 admitted 后重放 Create 获取初始 CAS，实际 owner 返回当前版本导致 Begin412。目标仅修现 BFF 私有 receipt：frozen→created（真实 Create ACK 的 skillId/initialStateVersion 已持久）→admitted（同创建身份、初始CAS及真实 Begin attempt/upload/epoch/stateVersion）→selected（真实 PUT版本与原 Complete 意图）→completed（真实 Complete ACK stateVersion）→terminal。created 持久成功/精确读回后才 Begin；Begin 和获取 transfer 均使用原 key/body/初始CAS，PUT 不再 Create。Create ACK 丢失且尚未 Begin时只同键重放；created/admitted checkpoint ACK 丢失通过精确 readback 或保留原阶段恢复，不推算版本或替换意图。

completed 持久成功/精确读回后才 Validate；Validate提交后ACK丢失或terminal CAS失败，从completed同原Validate key/body/冻结Complete CAS恢复，不重复Complete、不读最新CAS替代。

非terminal checkpoint严格携带私有proofVersion:2，旧200无版本（包括旧frozen）零owner写入并失败闭合，避免重放当前CAS伪造初始proof；terminal201保持原样。阶段成员、frozen/fingerprint及 owner 身份严格绑定；旧缺创建proof的 admitted/selected receipt保持原数据并失败闭合，terminal201原结果可重放，不宣称旧 intent已恢复。取消/claim/CAS败者及未知ACK语义保持，AI与GitHub共享调用均测试。无新增 public字段/API/contract、SQL/schema、依赖或 owner权限变更；现两源码、两测试实施后工程门与真实链仍待 Root 验收。

## T-K03.14-BFF-GITHUB-PATH-CONTRACT D0（2026-10-10；仅文档，待机器切片）

当前唯一可编辑事实源为 `contract/openapi/v1/openapi.yaml`（13.1.0），完整SHA-256 `418db9504b179d29113385f334628d304130491d4bbc86169e20c712cf2cd045`。Root批准13.2.0作为现parser事实的机器声明纠偏，保 `/v1`、operationId及原错误/权限/幂等；不改变实际运行时准入，不推广为任意breaking变更豁免。

仅五处path `maxLength:2048→256`：`GithubSkillRequest.path`、`GithubSkillImportRequest.path`、`GithubSkillResponse` 单选 `selector.path` 与 `repository.path`、多选 `paths.items`。现parser256字符限制不改；archive UTF8 relative文件路径≤256 bytes（含文件名）是另一安全约束，不能用数据库2048或字符数替代。空根与原POSIX路径规则保持。

新current校验仅接受13.2，显式inverse只恢复版本及上述五处2048，要求原13.1完整SHA相等后继续原历史门。历史Public13.1及更早父摘要/snapshot保持；`Public9SkillGithubProvenance.path`历史读取2048、repository/owner URL2048及manifest历史pattern原样保留，后者不与path债务混改。operation inventory及外部owner vendor/generated/provenance不变；本仓不新增自有public生成物。正式提交后消费者才独立固定commit/version/digest并正规生成，不编辑旧artifact。

后继机器片待验证：契约RED→GREEN、`pnpm contract:lint`、`pnpm contract:semantic`、`pnpm contract:check`，以及精确input/真实ZIP边界测试；当前D0仅文档，不把上述命令列为已通过。

## T-K03.14-BFF-ADMIN-PACKAGE D0（2026-10-10，待实现）

四包operation及请求/ACK/error来自现Public13.1唯一本仓机器contract，不新增URL、schema、Proto、生成物、alias或版本。变化只有admin-web-bff服务凭据可到达这四既有操作，仍经当前IAM准入和动作权限。严格method、skill ID、子路径闭集，不能开放整个/v1/skills；GET与mutation语义保持。Admin adapter须单独闭集接线，尚未完成。

## T-K03.14-BFF-CAS D0：12.0.0 当前 → 13.0.0 目标（2026-10-10；机器未改）

BFF 唯一 public source 仍是 `contract/openapi/v1/openapi.yaml`；当前 **12.0.0**，Root 裁决后继正式 **13.0.0**，URL 与 operation 均保持 `/v1`，不造 `/v13`。目标收紧三个当前 optional 字段为 required，其他请求/响应字段、owner pin 与权限不变。本阶段仅文档设计，契约/生成/源码/测试未实现。

| 当前操作/schema | 当前事实 | Public13 目标 / 下一步版本来源 |
| --- | --- | --- |
| CreateDraft / SkillDraftResource | 不接 CAS，ACK required data.state_version | 保持，以真实 ACK 为初始 observation |
| CreatePersonalVersion | 明确不接 CAS，独立 draft ACK required data.state_version | 保持，不从 base/state/revision 推算 |
| GET package-upload / SkillPackageUploadState | required data.state_version 与 phase/attempt/upload 身份 | 保持，仅观察/恢复，不代替原 command receipt |
| POST package-upload / BeginSkillPackageUploadRequest | expected_state_version optional | required；输入版本取 Create ACK 或同资源 owner read；成功 SkillPackageBeginResource.state_version required |
| POST package-upload/complete / CompleteSkillPackageUploadRequest | source_version_id required，CAS optional | CAS required，取 Begin ACK；对象版本取真实 PUT x-amz-version-id；CompleteResource.state_version required |
| POST validate / ValidateSkillDraftRequest | attempt_id required，CAS optional | CAS required，取 Complete ACK；SkillValidateResource.state_version required |
| POST publish | strict audience + expected_state_version already required | 保持，取 Validate ACK；成功 SkillPublishResource.state_version required；禁止零body |
| Metadata update / discard / audience | required CAS | 保持，从 current record product.state_version 或前次 mutation ACK 获取 |
| Cover Begin / Complete | required CAS | 保持，Complete 用 BeginCover ACK 版本与真实 PUT object version |
| Personal Withdraw | required CAS | 保持；普通 CreateVersion 不机械加 CAS |
| Admin version/publish/withdraw/quarantine/restore/audience/discard | 七具名操作 required CAS，完整 record ACK | 保持，从 data.skill.product.state_version 或当前 detail/list observation 获取 |

state_version 与 expected_state_version 是 canonical positive decimal string，现运行时最大 `9223372036854775807`；数字/null/0/leading zero/溢出/重复键与未知字段拒绝。response 必须保 strict envelope、identity、attempt/source-ref/series/revision、phase 与真实 version，消费者不得 strip version 来适配旧 schema。当前 self GET `/v1/self/skills/{skill_id}` 与 list item 的 `product.state_version` 是 owner 记录；package inspection 的 revision 不是 CAS，installation state 不替代 Skill version。

完整 consumer 必须同时接：Create/Version ACK state_version、package Get state_version/attempt identity、Begin request CAS/ACK state_version、PUT source_version_id、Complete request CAS/object version/ACK state_version+scan_state、Validate request CAS/ACK state_version+identity、Publish explicit audience/CAS/ACK state_version+event。导入/metadata/封面/Admin 有自身 required CAS，不能以只修 Begin 宣称发布链通过。

首次发送与same-key replay使用原body、原CAS、原semantic digest，当前 IAM admission 每次 fresh；未知 ACK 不换 key、不按更高 Get 版本改旧请求。新 key 异操作在当前 owner 同事务 CAS 中比较；owner FailedPrecondition 保既有 412 skill_precondition_failed，命令冲突/in-progress 保既有409。目标缺 CAS 在 BFF 400 invalid_skill_request 且 owner 零调用，消除目前 owner InvalidArgument 被投影502的缺字段路径；不通过放宽错误或 owner 校验伪造成功。

后继由 BFF owner 发布13机器事实与正规 baseline/历史逆向证明，保历史 Public12/11 及 owner不可编辑 artifact，不手改 generated。消费者固定该正式 artifact再正规生成/检查；Web `3c59071` 与 release `c9b02b6` 分叉，禁止整包移植或把 release能力冒充正常实现。原Admin既有基座按具名 contract后继接线，不新增泛化代理/后台壳。本阶段 contract检查/测试未运行，不记通过。

<!-- T-K03.14-BFF-CAS-API-D0-END; historical body retained -->

## T-K03.14-BFF-PIN 当前 Platform 固定发行（2026-10-10；待 Root 验收）

当前 Connect/HTTP 消费输入唯一固定 Platform `32666c1c18360e707048a1104efe6b50e375002f`；物理 owner 为 `apps/kokoro-capability`。从该正式 Git 对象逐项核对，87 项必要 publication 与原 `84262b...` 字节完全一致，Proto/descriptor、HTTP 5.3.0、execution V5–V10、historical qualification 及所有 artifact 摘要不变；active/routable V10 aggregate 仍为 `dddb0d194af44dbf0b83a0a0443d774f3dee63f8cb03c364ad529c4c230fb85b`。当前说明覆盖下文历史 pin，不改历史验收事实。

既有 public 与 browser-private API、请求/响应/错误字段及四 local import RPC 全部不变。使用现 Connect/HTTP 工具独立正规生成，并同步绑定测试的 current fixture/pin；不复制或手改 owner artifact、业务 DTO。

<!-- T-K03.14-BFF-PIN-CURRENT-END; historical body retained -->

## R357-BFF-ADMIN-INGRESS-D0：Admin Identity read contract（已发布于当前源码候选）

`admin-web-bff` 的 service envelope 使用独立 secret，并且只在 fresh human admission 后访问具名 Admin surface。public v1 artifact 新增且只新增以下 owner-preserving read operations：

| BFF path | method | IAM owner operation | permission |
| --- | --- | --- | --- |
| `/v1/admin/identity/members` | `GET` | `listTenantMembers` | `admin.identity.read` |
| `/v1/admin/identity/invitations` | `GET` | `listTenantInvitations` | `admin.identity.read` |
| `/v1/admin/identity/roles` | `GET` | `listTenantRoles` | `admin.identity.read` |

每项请求只允许 `limit`（默认 25，1–100）与 opaque `cursor`（至多 2048 字符）。tenant 不出现在 path、query 或 body；BFF 从已准入 context 固定 tenant、actor、bearer 与 request id，再经现严格 IAM Team client 投影。成功为闭合 owner page data 与 `no-store`/request id；普通用户或非 Admin service credential 为 `403`，非法 query 为 `400`，未命中具名路径为 `404`，限流与 owner dependency 维持固定 envelope。不存在 `/v1/admin/*` catch-all、ordinary `/v1/team/*` alias、直接 browser-to-IAM 调用或私有 Admin DTO。

本片不发布 audit、global user directory、user lifecycle、session revocation、管理员授权写入、任意查询或任意 owner relay。后续 API 只能在 IAM owner contract、固定 vendor revision、BFF machine schema 与 consumer pin 同时更新后单独发行。

机器验证以 canonical `contract/openapi/v1/openapi.yaml`、operation baseline（136）和 route contract test 为准；它验证三个 exact operationId、权限、query bounds、成功/失败响应以及拒绝未登记 operation。测试 fixture secret 只存在测试进程，不写日志、文档或响应。

<!-- R357-BFF-ADMIN-INGRESS-API-D0-END -->

## T-K03.4 精确 Skill 下载 browser-private 合同（BFF源码候选，未发布）

参考 `POST /skill.v1.SkillService/DownloadSkill` 的 `{skillId}` 永远表示series显式current，request/response/path保持原样。旧安装pin、managed exact version及share exact revision不向该参考请求增加selector，也不恢复已删除的`GET /v1/skills/{id}/download`。候选Kokoro私有合同只有：

| Method/path | selector唯一含义 | strict success 200 |
| --- | --- | --- |
| `POST /browser/v1/skill-installations/{installation_id}/download` | 当前tenant/subject仍installed的exact installation source/revision | `{data:{source_ref,revision,download_info:{download_url,filename,expires_at}}}` |
| `POST /browser/v1/skills/{version_id}/download` | 当前tenant/subject可见的managed exact Skill version | 同上 |
| `POST /browser/v1/skill-shares/{share_id}/download` | 当前tenant内active、未撤销、未过期share绑定的exact source | 同上 |

路径ID使用各现机器schema；三个POST均无query、无payload、无`Idempotency-Key`，且不接受body/header中的tenant、subject、source_ref、revision或series。无body、`Content-Length:0`及非null但实际零字节stream等价合法；`Transfer-Encoding`、冲突framing、正length或读取到任一字节均为400且owner零调用。零payload读取与取消共用请求绝对预算，abort/deadline先到立即终止，不等待永挂stream cancel，任何迟到EOF/字节不得恢复请求。`source_ref`必须与可信record完全相同，`revision`为正uint64十进制字符串；`download_url`只允许`/skill-downloads/{43字符opaque handle}`，filename非空且后续字节响应仍使用既有安全Content-Disposition，expiry为未来UTC且不晚于owner transfer/handle TTL。响应带`Cache-Control:no-store`与合法`x-request-id`，不返回内部transfer URL、required headers、digest、token、cookie、owner message或share creator资料。

状态闭集候选：400 invalid request/selector，401 current session缺失，403 subject或tenant不具资格，404 installation removed/not found、managed version不可见、share revoked/expired/not found或exact source已不可见，405 method，429 current admission rate limit，502 owner record/download/transfer/digest不可信，503 owner/IAM/Platform依赖不可确认，504统一绝对预算耗尽。POST无mutation receipt；任何重试都fresh admission和record读取。随后唯一字节入口仍为现`GET /skill-downloads/{handle}`：410只表达handle到期/淘汰/重启丢失；handle closed qualifier只能是`catalog_current+series_id`、`installation+installation_id`、`managed+version_id`、`share+share_id`之一，并另绑exact source_ref/revision，禁止把不同ID混入skillId。GET按qualifier再次执行对应fresh record资格，再exact-source下载，在现60秒/128容量生命周期内完成spool前后confirm、末次admission及完整长度/SHA-256确认。

share动作不成为匿名下载，也不把shareId当本人DownloadSkill授权；撤销、到期、换tenant或换登录主体后旧handle失败关闭。installation与catalog同series时，私有installation动作下载旧pin，参考DownloadSkill下载新current，两者不得互相fallback。managed历史版本只走version path；缺exact owner事实就404/依赖错误，不猜current。

本节未修改public OpenAPI、参考网站contract、Platform Proto/HTTP或generated client。BFF源码候选已由唯一可编辑机器源`src/http/routes/skill-download.policy.ts`确定性生成`contract/skill-download-policy.json`；它只收录上述三个exact method/path，不与local-import policy合并。Root验收、正式提交、服务重载与Web消费前仍不宣称正常路径已发布。

<!-- R357-BFF-EXACT-SKILL-DOWNLOAD-API-D0-END -->

## R357-BFF-ACTIVATION：正式 active owner 的消费边界（D0，wire 不变）

唯一 owner 输入更新为 Platform commit `84262b664275229c62370d49f51ad5e276116148`、active/routable v10 aggregate `dddb0d194af44dbf0b83a0a0443d774f3dee63f8cb03c364ad529c4c230fb85b`、Root publication digest `8a850363580521fadf75bc20b1be70bfe62c20004568c00b72a77f614caa672f`。四个 internal-owner 方法、下列四个 `/browser/v1` private route及其 request/success/error wire均不改；变化仅是生产 composition 在完整配置时可注册既有 exact dispatch。

写请求和同 key receipt replay一律先 fresh current session，再对同一 tenant/subject执行 `create_draft AND install`；两者均通过才允许 catalog workload token与 owner command。Get 每次 fresh read并使用 projection workload token。任何 browser bearer、body tenant/subject或旧身份 header均不是 owner credential。配置不完整时四路径继续404且owner零调用；不得改成503、fallback或公开 `/v1` operation。

固定 consumer machine范围是 `contract/dependencies/platform-{connect,http}.json`、单一 `contract/vendor/kokoro-platform/84262b.../` 完整必要 publication、`scripts/generate-platform-{connect,http}-client.mjs`、三份 Connect `src/generated/platform-connect/**_pb.ts` 及HTTP工具必要机械产物；旧 `981df60e...` vendor整目录删除，来源只取正式Git对象。private policy仍由既有 policy源与 `scripts/generate-local-skill-import-policy.mjs` 唯一生成。public OpenAPI字节、operation census、Developer Portal与public SDK保持不变。

<!-- R357-BFF-LOCAL-IMPORT-ACTIVATION-API-D0-END -->

## T-K03.4 本地 Skill import browser-private 合同（仅设计，未发布）

本能力没有已证明的 Manus public upload write suffix，因此不新增 public `/v1` operation。唯一拟议外部边界是 Kokoro BFF `browser-private` v1：

| Method/path                                                  | strict request                                                         | strict success projection                                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `POST /browser/v1/skills/local-imports`                      | 单 `Idempotency-Key`；JSON `{filename,size_bytes,content_sha256}`      | 201 `{data:{intent_id,skill_id,phase:"upload_pending",upload_id,transfer_reference,expires_at,replayed}}`                     |
| `POST /browser/v1/skills/local-imports/{intent_id}/complete` | 单 key；JSON `{upload_id,source_version_id,size_bytes,content_sha256}` | 200 `{data:{intent_id,skill_id,phase:"uploaded",upload_proof,scan_state,expires_at,replayed}}`                                |
| `POST /browser/v1/skills/local-imports/{intent_id}/finalize` | 单 key；零请求体                                                       | 200 `{data:{intent_id,phase:"completed",skill,installation,replayed}}`                                                        |
| `GET /browser/v1/skills/local-imports/{intent_id}`           | 无 query/body/key                                                      | 200 `{data:{intent_id,skill_id,phase,expires_at,upload_proof?,rejection_code?,skill?,installation?}}`，presence 按 phase 闭集 |

`transfer_reference` 仅含 approved-origin URL、`PUT`、完整 required headers与RFC3339 expiry；`upload_proof`仅含持久的 upload/asset/source-version/hash/size，Get 不返回或查询 scan。Complete 的 `scan_state` 是当次权威读取的独立字段。ID、uint64、lowercase SHA-256、Timestamp、enum/message presence、content type、request ID、no-store和错误 status/reason 全部严格投影；unknown/UNSPECIFIED/额外字段拒绝，不回显 owner message、token、URL凭据或内部事实。

三个 POST（包括 completed/same-key replay）必须 fresh `create_draft AND install` 后才调用 Platform；GET 使用 fresh session/read。Begin 的 201（含同 key 重签）只适用于未到期的 `upload_pending` intent 且 Storage upload 仍为 pending；`uploaded`、`completed`、`rejected` 或 expired phase 的旧 Begin 重放投影 owner 明确 phase/precondition 错误，不返回 transfer reference，调用方以 GET 恢复。Finalize 已 completed 的原 key 在 owner 至少 30 天 receipt 保留窗内仍精确重放同一成功结果。tenant/subject 只来自受信 session，不能从 body/header自报。预算、取消、900秒 PUT上限、24小时 intent、原key恢复与 unknown ACK 规则以技术设计为准。BFF 不接 Storage、不持久 receipt/intent。

该 private contract 当前候选由 `local-skill-import.policy.ts` 唯一编辑并确定性生成根 policy JSON；不写入 public OpenAPI/Developer Portal/public SDK/count。正式 Platform A6 已供生成 client 与注入式隔离合同/HTTP测试；owner artifact inactive 时生产 composition 不注入 client，该 namespace 仍为404而非 null-client 503。只有 owner active/routable 与真实 Storage 集成门同时成立，后继激活切片才注册 exact dispatch。GitHub/AI 的普通 Draft/Validate/Publish 与后台 Admin Publish 保持原合同。

<!-- T-K03.4-BROWSER-PRIVATE-LOCAL-IMPORT-API-END -->

## T-K03.3 下载句柄有界生命周期（候选）

Public12与全部字段不变。过期/淘汰/重启丢失的字节句柄410，重新GetSkill/DownloadSkill获新metadata；不漂移旧主体/exact版本。实际字节头固定attachment; filename="skill.zip"与RFC5987 UTF-8 filename*编码原名，引号/分号/Unicode不直接插值。

<!-- T-K03.3-DOWNLOAD-CORRECTION-END; complete previous body follows -->

## T-K03.3 后继唯一正式owner输入（源码候选，待Root验证）

唯一Platform9ed6801673ca279f446712de6eee3476717bfb24，active244d70909067b63e0b6dff721fbc976758e9b08e420d6f19faa638ab628afe2f；HTTP5.3/Proto保持本轮正式发行版本，generated正规生成。
Public12同/v1/skill.list及既定四网站POST/字节handle，optional project_id以当前Project owner权读取project exact安装；完成前同tenant/subject再核权限。APIKey/OAuth额外资格仍OPEN，不scope冒human。
ListHubSkills includeOfficialSkills→include_official_skills，首页shuffle→shuffle；pageToken原opaquecursor，后页显式shuffle（含false）400，保过滤绑定。
ProductSkillInstallation.skill_created_at19/source_owner_scope20直接source facts，公开Unix秒/网站UTC字符串按原类型转换；creator_ref语义不变，无事实不伪造。既有installation管理wire不加字段或改未知ACK职责。

<!-- T-K03.3-SUCCESSOR-END; complete previous body follows -->

## T-K03.2 Skills 正式 Product协议收敛（2026-10-09；目标待owner发行）

当前基线 adcdac3 / Public11.0.0 /132 operations；原 Skills 42paths/47ops 的职责清单如下，表中旧路径均带 /v1。对应参考替换时同片删旧别名，未观察操作不假装已有Manus同名文档；其它85 operations与Team保持，不扩到user.me。
官方唯一依据：[skill.list](https://open.manus.ai/docs/v2/skill.list)（2026-10-09核对）；GET /v2/skill.list → GET /v1/skill.list，可选 query project_id:string；成功 {ok:boolean,request_id:string,data:Skill[]}，错误 {ok:boolean,request_id:string,error:{code:string,message:string}}，不加旧meta/retryable外壳。
Skill的id/name/description:string，owner_type=personal|official|team|project|app，creator_info:{user_id:string,name:string}，created_at/updated_at:integer<int64> Unix秒；保原可选/缺省声明。Root B稳定skillId=原seriesId，versionUid=现Skill.id，current为owner显式发布引用；安装保精确旧version。包含停用安装且读取不启用；正式owner字段/artifact未发行时为必需后继输入，不声称已固定消费。
文档 APIKey/标准OAuth/trusted client可见性不同：标准OAuth仅其App技能、project_id为InvalidArgument400；APIKey/trusted可含可见项目。Kokoro按正式IAM实际凭据类别/主体/授权实现，不以service scope或浏览器参数冒任一类别；原文 security空数组不作匿名授权。
网站来源：Root r357-manus-skills-protocol-observed.json五次POST200、truncated=true；用户九项JSON SHA262d4df11290ac3dbde396f88d7ed435b70c54eb04be2f6251a56f02cd4338a6。BFF browser-private原/skill.v1.SkillOptionalService/{ListSkills,ListHubSkills,GetSkill}与/skill.v1.SkillService/DownloadSkill，Web/api＋原path；不重复/v1、不造公开同名方法。
下列S=string、B=boolean、I=integer；presence仅记录本次出现/缺失，所有未证明required/optional/default/enum/错误格OPEN，遗漏不等于可选、null或false；完整规范已明确的公开skill.list可先实施，不等待穷尽网站枚举。
Hub集合H：skillId/originalName/displayName/userDescription/publishStatus/sortOrder/createdAt/publisherType/usageCount/type:S；icon:{type:S,value:S}；exampleQuestions:S[]；tags:{values:S[]}；currentVersion:{versionUid:S,checksum:S,archiveSize:S,fileCount:I,status:S,current:B,createdAt:S}。
Hub扩展X：verified:B；coverImage/cmsUpdatedAt/syncStatus:S；source:{type,url,owner,repository,ref,path,stars,forks,latestCommitSha,latestCommitAt,licenseSpdxId,licenseUrl,licenseStatus,licenseCategory,pathCommitAt:全S}；currentVersion附sourceRevision/sourceRevisionAt/licenseSpdxId/licenseUrl:全S；tagOptions:{values:[{tag:S,displayName:S}]}。
Detail集合D：id/name/description/version/updatedAt/ownerType/type/displayName/sortOrder/createdAt/visibility/userDescription/coverImage/addTime:S；added/defaultEnable/defaultAdd:B；exampleQuestions/sessionTypes:S[]；tags:{values:S[]}；skillIcon:{type:S,value:S}。DownloadInfo集合F：downloadUrl/filename/expiresAt:S。
ListSkills的userAddedSkills与officialSkills元素均观察D、enabled:B、icon:S、skillConfig:{teamSkillForceAdd:B}；只有officialSkills观察deviceCapable:B。此是各数组字段union而非逐record必有承诺；Detail的D不因此自动获得enabled/deviceCapable/skillConfig。

| 实际POST与请求presence                                                                          | 实际200响应字段类型与presence                                                                                                           | 未观察规则/错误/写协议                                                 |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| OptionalService/ListSkills；{}，零请求成员                                                      | userAddedSkills:object[]、officialSkills:object[]均出现；元素按上述ListSkills集合                                                       | required/optional/default/enum OPEN；错误OPEN；关联写协议OPEN          |
| OptionalService/ListHubSkills；pageSize:I=9、shuffle:B=true、includeOfficialSkills:B=true均出现 | skills:object[9]、tagOptions出现；元素H与X字段union出现；nextPageToken未出现                                                            | 所有presence规则OPEN；不推下一页不存在；错误OPEN；写协议OPEN           |
| OptionalService/ListHubSkills；pageSize:I=1出现，shuffle/includeOfficialSkills未出现            | skills:object[1]、tagOptions、nextPageToken:S出现；H、coverImage/cmsUpdatedAt/source/syncStatus/版本source与license出现，verified未出现 | 不推缺省开关值或verified=false；presence规则OPEN；错误OPEN；写协议OPEN |
| OptionalService/GetSkill；skillId:S出现                                                         | skill:object含D、downloadInfo:object含F均出现                                                                                           | presence/enum/default OPEN；错误OPEN；关联写协议OPEN                   |
| SkillService/DownloadSkill；skillId:S出现                                                       | skill:object含D、downloadInfo:object含F均出现；POST返回JSON，非ZIP body                                                                 | presence/enum/default OPEN；错误OPEN；关联写协议OPEN                   |

用户九项逐record观察verified为5/9，source/syncStatus/cmsUpdatedAt及版本source/license字段为4/9；coverImage在九项出现但未证明全局必有。所有verified/source/sync与license presence及状态转移只是observation，未见规则OPEN；不按publisherType/sourceKind推true/false或补null。

### 原全Skills职责承接/替换表

H=现authorizeUserRequest：web-bff service envelope＋唯一human Bearer→fresh IAM session，tenant=context.identity.namespace且等config.tenantId，subject=context.identity.userId；不信body/旧identity header。A=H＋现CheckTenantSkillAuthorization action与当前IAM admin资格；不是service scope或陈旧platformAdmin标志授human。O-R=现platform:projection.read，O-W=platform:skill-catalog.manage，O-A=platform:skills-admin.manage各自固定tenant正式workload credential；均不替human。actions逐项来自src/auth/user-admission.ts现skillActionForRequest与正式IAM schema；网站POST read按原读取语义映射H，不能猜read/manage动作字符串。

| 旧 /v1 路径与方法（完整42paths/47ops）                                                                                        | 正式职责与参考处理                                                                                                                                   | 当前可信human/admin与owner边界                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET /skills、/skills/pool、/skills/catalog                                                                                    | 分开已安装选择、有效池、Hub目录；公开选择以skill.list替换；Hub按ListHubSkills，非同资源合并                                                          | H→O-R；现GET无独立Skills IAM action，owner可见性读，不能以POST carrier改为写action                                                                     |
| GET /skills/{skill_id}、/self/skills、/self/skills/{skill_id}                                                                 | active确认、owned管理、本人详情；ListSkills/GetSkill已观察，owned草稿职责保留；始终当前human IAM/tenant准入，拒绝匿名，状态/权限失败安全404/403      | H→O-R；owned本人边界/active状态由owner核；无anonymous                                                                                                  |
| POST /skills/drafts；GET/POST /skills/{skill_id}/package-upload；POST其/complete                                              | 真实Create/Begin/观察/Complete与版本ACK；参考写协议待观察，保现固定CAS/key与来源版本                                                                 | H→O-W；POST create_draft/begin_upload/complete_upload；GET观察仍H、现owner O-W句柄读                                                                   |
| POST /skills/{skill_id}/validate、/publish；PATCH其/draft；POST其/discard、/audience                                          | 校验/发布/编辑/丢弃/可见性事务；未观察，保owner生命周期与审计，不删职责或猜公开名称                                                                  | H→O-W；validate_draft/publish/update_draft/discard_draft/set_publication_audience                                                                      |
| POST /self/skills/{skill_id}/versions、/withdraw                                                                              | 普通独立新draft与实际CAS撤回；未观察，保与Admin版本语义区别                                                                                          | H→O-W；create_version/withdraw；本人owner scope固定user/当前subject                                                                                    |
| GET/POST /skill-installations；GET/DELETE /skill-installations/{installation_id}；PUT其/enabled                               | 精确版本安装/读回/移除/启停；ListSkills表示补充不替写准入，操作协议待观察                                                                            | H；GET→O-R；POST install/DELETE remove_installation/PUT set_installation_enabled→O-W                                                                   |
| POST /skills/github/preview、/github/import、/ai-import                                                                       | 固定commit/path预览导入、真实conversation/artifact ZIP导入draft；写协议待观察，不用Chat回调冒成功                                                    | H；preview→O-W调用前后当前资格、无独立IAM action；两import create_draft→O-W                                                                            |
| GET /skills/{skill_id}/package、/self/skills/{skill_id}/package、/skill-installations/{installation_id}/package               | 可选file_path原目录与正文/exactrevision；网站文件API未观察，保路径/UTF8/大小和安装旧版                                                               | H→O-R；catalog可见性、managed本人、installation原绑定由owner核；无独立GET action                                                                       |
| GET /skills/{skill_id}/download                                                                                               | POST原DownloadSkill取得JSON F，downloadUrl指向唯一GET /skill-downloads/{handle}字节资源（Web/api）；旧直接二进制入口删除，不宣新GET为Manus公开method | H→O-R＋I/O后同身份readmit；当前下载资格/exact包由owner核；新handle每次同准入                                                                           |
| GET/POST /skills/{skill_id}/cover-upload；POST其/complete；GET /skills/{skill_id}/cover                                       | 实际cover版本ACK/扫描/CAS与图片读取；参考写协议未观察，保本人与Admin权限隔离                                                                         | H→O-W；POST begin_upload/complete_upload，GET观察/cover bytes当前资格；不替Admin授权                                                                   |
| GET /admin/skills、/admin/skills/{skill_id}；POST其/versions、/publish、/withdraw、/quarantine、/restore、/audience、/discard | Admin列表详情七事务；未观察，保当前human admin/专用owner凭据/CAS，不扩大普通发布权                                                                   | A→O-A；GET admin_read；POST admin_create_version/official_publish/admin_withdraw/quarantine/restore/admin_set_publication_audience/admin_discard_draft |
| POST /skill-shares；GET/DELETE /skill-shares/{share_id}；POST /skills/usage                                                   | BFF自有链接/撤销与可信usage聚合；参考未观察，链接不授匿名/跨tenant资格，缺coverage不变0                                                              | H；share写BFF自有tenant/creator且inspect→O-R，usage本tenant可见性；现无独立Skills IAM action                                                           |
| PATCH /projects/{projectId}/skills/{skill}                                                                                    | 项目Skills选择关联；与公开list项目读取分开，保项目权限/幂等，不猜task调用字段                                                                        | H＋现authorizeLiveBffMutation项目资格；fresh inspect→O-R；关联写本仓，现无Skills专用IAM action                                                         |

新增字节资源GET /skill-downloads/{handle}仅browser-private、H当前准入；opaque小TTL/容量有界内存绑定tenant/subject、exact version、原资格、真实filename/expiry。过期或重启旧句柄410，撤权403或安全404；scan/依赖稳定脱敏错误；句柄缺失同410；no-store、request-id、取消预算沿现边界，不暴露内部URL/凭据、不猜最新。skillId普通GET/Download解析owner显式current，本人安装下载保持原installation→旧version绑定；owner无必需selector/资格时失败，不latest/HEAD。
BFF一次修改唯一public OpenAPI/现route与projector；正式 owner发行后固定生成，不编辑generated文件；Web随后固定新artifact，同时删对应旧snake/扁平schema与旧data/meta消费，Admin与其它仍有效CAS保原职责。新机器major/digest由Root冻结发行，不在本设计伪报操作总数不变。
各已定义参考接口采用自己的success/error；网站仅200已观测，错误/headers/枚举/默认值待证据与本地正式裁决。现错误脱敏、status语义、412真实CAS/409幂等冲突/unknown、request-id、限流Retry-After、取消/绝对预算/no-store门仍保持，不能为接新shape放宽准入或吞依赖失败。
合同验收保非Skills/Team块与有效权限/tenant/CAS/取消/unknown原阴性；新active合同依正式规范校验，不继续机械叠历史20层hash逆向；逐一覆盖全表职责、公开停用列出且零写、坏project资格、creator与publisher不同、Hub分页/tagOptions、下载过期/撤权/精确版本以及旧别名拒绝。缺参考不是“接口已完成”，不替Root正常资源/页面证据。

<!-- T-K03.2-BFF-API-CONTRACT-END; complete original body follows -->

## R357-H1 当前人类 MCP 准入（2026-10-09）

本切片归 BFF auth 与既有 MCP projection；IAM 唯一拥有身份/成员权限。只消费正式 IAM 55befe5092f96d617088549df3166e1d381e6b1c / 0.11.0 / SHA47011671cf2c3631c5ff914db4b40a8a9f9cdecc9b2b6fcd13a359a45b0882d3。
既有 bounded session transport 承接 /internal/v1/authorization/check；两个普通 auth 文件分别定义类型与 HTTP 编排，不新建模块/框架、不复制 Skills 预算。mcp_personal read/manage 必须是当前人类 current_membership，匹配已验证 tenant/subject；workload client_scope 不授浏览器管理权。
普通 session → MCP action checker → 已有两 projection 共用入口起始的 monotonic 10s 预算与取消；false=403，invalid=401，rate=429，依赖/身份/协议错配=503。no-store、closed envelope、request-id 严格校验，取消/到期后的迟到响应不得成功。
现四个 self MCP GET 尚无正式 owner adapter，授权后仍503；未实现非GET仍503且无 owner 副作用。不得消费 Platform 候选 wire，真实目录/详情/CRUD/授权/执行/admin、正常scope与登录激活仍OPEN。
旧15个 IAM generated operations / Team / Skills 协议保留；唯一 vendor 正规替换及生成，不并存旧pin。生产无mock，显式测试 composition seam 只用于隔离行为验证。

<!-- R357-MCP-H1-END; original suffix retained -->

## R356 普通 Skills 生命周期 Public11 预激活纠正（2026-10-09）

唯一当前契约为 Public11.0.0，同 `/v1`、132 operations。普通 CreateVersion 只接 strict metadata，不接收或转发 expected_state_version；Platform 在事务内核当前主体/owner与 active/disabled base，分配新 revision 并创建独立 draft/stateVersion=1，不改 base。普通 Withdraw 实际修改原 Skill，严格要求当前 expected_state_version；原 key/body、digest、receipt、current IAM、取消与绝对预算保持。Admin version、Publish 及其他真实 CAS 不变。

Root 将未正常激活的 beta 以唯一 corrective major 修正；首次公开激活后的 breaking 策略保持。当前机器只改这两个普通输入与 version，先精确逆回完整 Public10.0.0 SHA2f98f529bda413912b5c15e6de45db7cdadf0e0bc51fd5de44818db9727efbb8，再运行全部原 Public9.0.1/8.10 历史门。无 owner 契约、表、Schema、依赖或新框架；DATA_MODEL/canonical schema 原字节保持。消费者等待 Root 正式提交再固定生成；源码验证不代表真实组合、正常激活或 Skills 页面完成。

<!-- R356-LIFECYCLE-PUBLIC11-END -->

## R356 Publish Public10 预激活 corrective cut（2026-10-09）

首次正常对外激活前，Root裁决将未正常激活的 beta Public9 Publish 修正为唯一 Public10.0.0，同 `/v1`、132 operations，无 `/v2` 或零body fallback。Publish 严格 required application/json `{audience, expected_state_version}`，复用既有 SkillAudienceRequest；ordinary current IAM/tenant、fixed PERSONAL、固定 command/key/digest/CAS、取消预算和 strict response/header 保持。正式对外发行后的 breaking-major 策略不变，本裁决不授权以后静默破坏客户端。

Platform仍唯一拥有 Skill状态/receipt/发布；BFF只转当前正式wire，不读取owner数据库、不新建表/Schema/依赖。DATA_MODEL现有零持久变化边界与本技术/API门一致，原数据设计字节保持。机器 current10先核完整 Publish，再逆为exact Public9.0.1 SHA4ad3a0553d3b45a78fdd53c857ad66c25b1baa3d53c3af619333d70fefcad5db，继续原Public8.10及历史父证明。消费者必须等Root正式commit后正规固定生成；正常服务、真实组合、浏览器和S01–S10仍待Root，不以pure结果宣完成。

<!-- R356-PUBLISH-PUBLIC10-DESIGN-END -->

## R356 Public9.0.1 消费者一致性修正（同 132 operations）

GET package-upload 的现有真实 source_version_id 现列入闭合 schema，可选、1–1024 printable ASCII且拒绝字面 null；不从对象 current read 推断版本。owner 无效版本稳定返回502 skill_response_invalid；安装列表 owner query/source-bound cursor 的 InvalidArgument 返回400 invalid_skill_installation_request，不泄露内部原因。原 Public9/Public8.10 父逆和其它 closed blocks 保持。此为源码契约修正，正常服务未重新激活，不能称 Skills 页面验收。

## R353-B2 当前源码候选（2026-10-08；待Root冻源审查/真实配对）

唯一 BFF writer 为 bff_skills_product_source_r353；工作树 HEAD d2695c47bca64a8e83168aa259e2366f7cee3ea8。当前唯一 Platform固定fa185ed2b25c3e81946cfdcd12d7665d02b8bad3、Product1.2/HTTP5.2/63RPC/32commands/24proofs、完整81正式publication；aggregate ce7708d7e2a15d7e3a77b7b9ea45905ab3fbe90093e343d0be9b3140ca03e2d6、descriptor 453f275b6e95052437072c3f52bbe74675271400526680003569b6bd09196fb1、HTTP 6d4abae68cd5cc6e2d8676ac34a48f7ea3564196ec6215ea1531b3cfedd3c3d7。HTTP直接读同Platform vendor/openapi；原701候选72副本移除，无双pin。IAM7c62e759760448e127b21200f87adeefdc6016f7/0.10、Storage d13f33a/v3继续原正规固定生成；不升级其它owner。

Public唯一9.0.0/132operations，具名Product checker先核完整当前closed blocks，再剥本片还原完整Public8.10字节SHA640f47f9c70341aa49934eec319a4dcc5bab76bba83e4407d6a9e0c3ab0ac389并运行全部旧父证明。机器/纯门只证明本源码；正常Storage旧源版本资格、真实IAM/Platform/Storage/Agent配对、provider、普通/管理员浏览器与S01–S10由Root继续验证，仍OPEN。未运行数据库/资源/服务/正常激活，不以fixture为integration或UI完成。

### 当前公开机器与行为

Catalog/managed/published/installation投影真实category_keys/product/source_kind/creator/publisher/examples/UTCskill_updated_at与available_update，available_update只作exactlaterrevision提示，不发明UpgradeRPC。draft/version/audience/discard、package-directory可选file_path与download、cover三命令/bytes、admin列表详情与七命令、AI/GitHub、typed Skill Share/Usage沿当前唯一Public9。createLocalSkillDraft只是Create→Begin→PUT→Complete→Validate的产品编排，不加aliasoperation。删除getSkillQuota/listSkillRevisions以及对应旧schema/参数。

所有身份来自当前受信IAM，browser不自报tenant/subject/publisher权限；普通catalog/project/installation与admin专用credential隔离。新Skills返回data-only/no-store/x-request-id、closedsanitizederror；超限413、未知/重复字段400、异常不回空列表/默认作者/假cover/零usage。Sharecreate/resolve需currentexactrevisionread、creator可以撤自己link；conversation匿名share保持原事实不返回Skill。Usage闭集available真实successful_run_count或unavailable，缺可信全历史proof就unavailable。

GitHubpreview请求{repository_url,path?}只支持canonicalhttps://github.com/owner/repository。固定API真实defaultbranch→fullSHA，受限ZIP+SKILL.md以正式js-yaml4.3.2 FAILSAFE解析真实name/description及可选metadata。根目录优先，否则唯一合法目录；多候选返回{selection_required:true,repository_url,commit,paths}，不默认取首项。就绪返回{selection_required:false,selector:{owner,repository,commit,path},metadata,repository,content_sha256,size_bytes}。import请求仅selector，重新从同SHA/path包解析metadata，不接受browser metadata，也不支持URL-only直接import。GitHubprovenance无asset_ref时真实omit、AIrequired保持，draft前不造Asset。所有网络覆盖同请求deadline/cancel、固定host、redirect:error/credentials:omit、有界UTF8/YAML/ZIP/hash。

安装list已接既有source_kind闭集、未知/重复400、缺省all由省字段表达；分页cursor由owner绑定query资格。当前正式P4已修owner typed/raw/RPC source_kind绑定与分页前query筛选；BFF将installed/owned query按trim后1–1024 Unicode scalars严格校验，保字面%/_/反斜杠，不做当前页过滤；query/source/actor等cursor身份由owner绑定。BFF loopback只证明转发，Root真实PG证据与后续配对/浏览器分别验收。category_keys替代categories旧alias，无兼容字段或双decoder。PNG/JPEGcover资格与下载全spool按TECH当前限制；记录式创建及完整正常浏览器S01–S10待验。

P4仅既有installed与owned列表可选query消费，Public9.0/132不另发版本，不新增方法/Schema/依赖。原52e副本76删净，仅fa185ed正式81机器；新增query6从独立parent完整逆向剥离后保所有历史父SHA，生成物只正规生成。P1/P2已含source I/O后required当前session同tenant/subject重验及owner坏响应502；原浏览器input400保持。仍非正常激活/配对/页面或S01–S10完成。

<!-- R353-B2-CURRENT-PREFIX-END; immutable historical baseline follows -->

## R353-BFF-D0：Skills Public 9 目标契约（尚未发布）

当前正式 public 仍是 8.10；Public 9 只在 Platform 正式 D1 63 RPC/32 command/24 proof、IAM 0.10、Storage v3 与 BFF runtime 成对冻结后发布。唯一 OpenAPI 继续 closed snake_case schema；旧操作原义保留，新增/required 字段一次发行，不 alias、fallback、双 pin 或 body 自报身份。

### Product 表示与操作

Catalog、preview/detail、managed、published、installation 使用 Platform exact revision 的 creator/source/category/examples/updated_at/package/optional cover/audience/draft/admin 与 `available_update`；publisher display 由 BFF 对本页 refs 去重后调用 IAM 批量解析，missing 显式，不用 raw id、安装者或 tags 猜。Package/cover bytes 经 BFF 代理且末端复核；cover absence 合法，package 必须存在。`available_update` 仅作提示；Platform D1 不设 Upgrade RPC，用户明确更新时先移除旧安装，再对 exact 新 revision 重新安装，绝不隐式换源或升级。

四类 Create 入口最终归一为 Platform draft/version command：手工与既有 package、AI exact artifact selector、GitHub restricted public repository；optional presence、原序、重复与 explicit empty 按 owner canonical 保持。AI 缺 immutable association、Storage bytes 或同 run completed 失败；GitHub 非允许 host/ref/path、私有认证、redirect、超限或 hash/type 不符失败。record 的正式输入仍 OPEN，不增加猜测字段。

Skill share 是 BFF typed Share：create 需登录、同 tenant、current readable exact `source_ref`；同 `(tenant,creator_subject,source_ref)` 返回唯一 active link，过期后替换。creator 可 revoke 自己的 link。resolve 也必须登录同 tenant并 fresh Platform read，withdraw/quarantine/audience/identity 变化返回 not found/forbidden 的既定安全映射；link 不授权匿名或跨 tenant。旧 conversation `/v1/shared/{share_id}` 仍仅返回 conversation，不接受 Skill target。

Usage 返回 exact source_ref 的 `{ status: available, successful_run_count }` 或 `{ status: unavailable }` closed union。计数定义为同 tenant、ready 引用该 exact source_ref 且严格 terminal `run.completed(status=completed)` 的 distinct `run_id`；重复 ready/terminal、乱序和多次投递只计一次，failed/cancelled 不计。缺可信 tenant 历史覆盖证明必须 `unavailable`，不得把空行、GC、启动时间或单 session 水位映为 0。

### 身份、失败与发布门

tenant/subject/session 来自当前 IAM admission；admin 操作必须走 IAM 0.10 current admin check 与专用受信 Platform machine surface，普通 catalog credential、浏览器布尔和 publisher profile scope 不授 admin。Share/usage 是 BFF 自有事实；Platform/IAM/Storage/Agent owner 错误按既有 closed Product error 映射，依赖异常不返回空列表、默认封面、默认作者或零计数。

后继机器范围为 `contract/openapi/v1/openapi.yaml`、operation inventory、Platform/IAM/Storage dependency manifests/vendor、正规 generators/generated、现 Skills contract checkers与具名 parent inverse/HTTP/SDK tests。正式 owner source、完整 provenance/digest与 BFF Public 9 parent 未冻结前不写版本/operation 数的伪最终值；现目标 63/32/24 不等于已消费。发布后仍须真实登录、普通/管理员/跨 tenant、撤权、重放、GC、package/cover、AI/GitHub 与返回/焦点浏览器验收。

### R353-B1 implementation boundary

B1 publishes no Public 9 operation. The existing anonymous `/v1/shared/{share_id}` reader is explicitly conversation-only; Skill rows have a separate authenticated repository port and cannot be returned by that route. Usage result modeling is closed `available|unavailable`, but no public usage route is activated in this slice.

<!-- R353-BFF-D0-SKILLS-PUBLIC-9-END -->

## R350-B2：Skill 示例 Public 8.10 契约

唯一 public contract 为 `8.10.0 / 111 operations`。`CreateSkillDraftRequest` 与 `CreatePersonalSkillVersionRequest` 各新增 optional `example_prompts`；absence 与 present `[]` 不合并。`Skill`、`ManagedPersonalSkillResource`、`PublishedPersonalSkillResource`、`SkillInstallation` 的 closed schema 均新增 required `example_prompts`。

数组最多 10 项；每项 1–1000 Unicode scalar、`trim()` 后非空、拒绝 U+0000 与孤立 surrogate；数组总 UTF-8 不超过 16384 bytes。原文、顺序、重复保留，不 trim/dedupe/normalize。input null、alias、重复 JSON key、非法 UTF-8 与任意越界值在调用 owner 前拒绝；owner read 的缺失/null/坏数组映射既有 `skill_response_invalid`。Publish operation 继续要求零 body，且没有 `example_prompts` 输入。

具名 semantic checker 只剥本次两个 Create 各自的 request property、四个 required read property及 version，结果必须等于 Public 8.9 parsed canonical SHA `e95f026581b389dad643d390f543f9ab057a2bfd0cbb02dfab0aeb8cc662631d`。随后旧 updated-at/package parent checker继续验证原父链，不能更新旧基线掩盖漂移。`contract/tests/v1-operations.json` 保持原 111 字节。

Owner 机器固定为 commit `94bd0ea94aabc60c666fdb2cfa8784baf194e24b`、HTTP `3.5.0`、Proto SHA `5fd99ca07adc6c40c917071b652d4c048905fcb23674dc7f695dad89a2a2b684`、descriptor SHA `d9b82ed81c643be7bab6cb19319fed86e566663a4cdae1c68afcc91386dab52b`、HTTP SHA `370e3d7152796042f00095eda86eec4bc9883766c051f7f7dc864dce2b359b04`。BFF 固定完整 60-file publication，不修改历史 V5–V9。

<!-- R350-B2-SKILL-EXAMPLE-PROMPTS-END -->

## R345-B-D0：Skill 更新时间固定契约（已定设计，尚未发行）

BFF 当前仍是 `411e6906f651087dbbd8ff8afd96d53e38b352c0` / public `8.8.0 / 111 operations`；Platform `dcc2102e41a677b52367f2cc1a18b6283bbda2e6` 只有设计，正式 3.4.0 commit/digest 尚待 owner 冻结。后继 BFF 只能固定消费 Root 已审查提交的正式 artifact，不能用当前工作树生成物或预填 digest。

### 固定 owner 输入

- Platform HTTP 3.4.0 只在现 `Skill`、`SelfManagedSkill`、`PublishedPersonalSkill` 三个 closed schema 中增加 required `skill_updated_at`，值为精确 Skill revision 的 RFC 3339 UTC `...Z`；原 paths、operations、permission、分页、错误与缓存头不变。
- Platform Proto 只在 `ProductSkillInstallation` 增 `google.protobuf.Timestamp skill_updated_at = 14`；现 45 RPC、旧字段、服务、V5–V9发行物与 tag 8 `updated_at` 全保。BFF 固定正式 proto/FDS/provenance并验证剥除仅 field14 后完整图等于父图。
- HTTP 与 Connect generated consumer 都必须 required/strict；缺字段、额外字段、非法时间或未知 owner shape 映为既有安全 `skill_response_invalid`，不能静默删除、默认或回退。

### Public 8.9 唯一增量

canonical `contract/openapi/v1/openapi.yaml` 升为 **8.9.0 / 111 operations**，不增删 path、operationId、status、permission、header、error code、retryability 或 request shape。四个现有 schema 保持 `additionalProperties: false` 并增加同一属性：

```yaml
skill_updated_at: { type: string, format: date-time, pattern: "Z$" }
```

| Schema                           | 8.9 required/properties 变化                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Skill`                          | 核心 required 增 `skill_updated_at`；`installed` 仍是原可选属性，其他字段不变。                        |
| `ManagedPersonalSkillResource`   | 原安全八字段增为安全九字段，`skill_updated_at` required。                                              |
| `PublishedPersonalSkillResource` | 原 ACTIVE 七字段增为八字段，`skill_updated_at` required。                                              |
| `SkillInstallation`              | required 增 `skill_updated_at`；`installed_at`、`updated_at`、optional `removed_at` 及全部原语义不变。 |

`skill_updated_at` 只表示所绑定精确 Skill revision 的 `Skill.updatedAt`。特别是安装响应：tag7/`installed_at` 是安装时刻，tag8/`updated_at` 是安装记录变化时刻，tag14/`skill_updated_at` 是来源 Skill 时刻；三值允许不同，不建立相互先后约束，也不以 tag8 补 tag14。

### 完整面保护与负控

新 `scripts/verify-skill-updated-at-contract.mjs` 具名检查版本、四个 closed schema、required/property/type/format/`Z$`，再从 parsed 8.9 clone 中只删除四处 `skill_updated_at` 并把版本还原 8.8.0；结果必须与正式 8.8 全文 parsed canonical SHA `6981d9c4571b5c2c5198025e9c1fbda6bfa62805063e7483fa33c379021de9c8` 相等。`contract/tests/v1-operations.json` 仍为原 111 且 byte-exact。

R342 package checker 必须先剥 R345 四字段回到 8.8，再按原逻辑剥 package 增量回到 8.7，原 8.7 hash 不更新；不能用新 baseline hash 掩盖旧契约漂移。现 `verify-openapi.ts` 主入口只接该具名 checker并收紧已有四schema断言；`check-contract.mjs` 只晋级当前版本字面，111不变。强负控逐一覆盖 required 删除、property 删除/增加、open object、非 string、缺 format、缺/放宽 `Z$`，并证明失败来自具名规则而非仅版本/hash。

运行切换严格成对：Platform 新版 ready 前不启 BFF 新 fixed consumer，BFF 新版 ready 前不恢复 Skills 入口；回滚同样配对。Web 固定 8.9 并完成真实页面验收才构成用户证据。作者/publisher、example prompts、封面、usage及未安装目录正文资格不在本契约，不发布空值、假值或推断字段。

<!-- R345-B-SKILL-UPDATED-AT-D0-END -->

### R343 本人技能包正文运行已接通；Web 详情仍待验收（2026-10-08）

本片基线 e70562759e80a18a959c0e418e495721027ac54f/public8.8.0/111，不改机器契约、SQL、scope或配置。新增三个普通文件分别承接两GET编排、固定Connect与严格响应映射；现server精确分流，projection credential/token仅有界读取/绝对预算/轮换防迟到强化。唯一调用仍 Browser→Web→BFF→Platform→Storage，正文不缓存、不伪造。

Root正常持久用户正式HTTP/form/OAuth登录后，用现本人active source与同revision安装作正控：Platform真实两个目录和全部两文件200且相等；新public四GET真实先0PASS/4FAIL（均404），受控源码激活后4PASS/0FAIL/0SKIP。真实正常九条边界/缺失GET全部通过：未知/重复/空query、相对穿越、NFD、读幂等头、Content-Length0均400；不存在文件/本人源404，严格request ID/no-store/closed不可重试error/无Retry-After。不是浏览器UI/E2E证据。

Root Node22.22.2完整check自然0：contract317PASS；default897PASS/0FAIL/2原资源SKIP，lint/typecheck/all固定consumer生成检查/build通过。独审 iam_skills_admission_review_r343对8冻结源码/测试无确定P0/P1/P2阻断。另一次Root误用Node24在固定Node22门自然失败留日志；不是放宽pin，显式Node22重跑。Root完整format:check及8冻结文件定向Prettier均自然0。

正式资源故障：Platform OAuth resource尚legacy5导致introspection403，Root匹配已配置operator后沿IAM官方read/extend/read得到current6，fresh introspection200；角色/client/binding/凭据没改。初次受控启动Root误注旧manifest enabled=false遮当前持久.env.local true导致安装列表503，已停原句柄并只沿正式.env.local同端口启动；当前来源和安装列表200。未新建数据/账号/包/安装，未reset共享基础设施，未重启其它owner。

普通查看详情Web接线仍在实现；真实作者/Skill日期/示例/usage、任意catalog未安装正文资格、后台同步及完整页面验收继续OPEN。工程或四GET通过不表示与Manus一致。所有Root证据仅ignored私有var/dev/r255-preserve，秘密不提交。

<!-- R343-PACKAGE-RUNTIME-RECEIPT-END -->

## R342 包正文公开契约当前态（2026-10-08）

唯一 public OpenAPI 现为 **8.8.0 / 111 operations**，两本人包 GET 的机器表示已按 R340 设计实现：managed source_ref 精确绑定路径 skill_id，两条文件读取 selected_file.path 精确绑定请求 file_path，目录/空正文/原BOM、安全路径与 uint64 精度闭集不变。旧109完整parsed表示剥增量后保持；Platform固定52输入/current45 RPC不变。

本阶段没有新增 HTTP runtime 路由或 Web 详情接线，运行中的 BFF 仍来自 d218a1a。身份、持久配置、SQL、业务事实、资源及两本人读取资格均未改。下列 R340“目标8.8/111”仅机器发布这一阶段由本节更新；三普通runtime文件/凭据安全强化、真实owner系统链、受控激活和用户同弹窗验收仍待实施。工程结果见 CURRENT R342，不把契约发行当页面完成。

<!-- R342-PUBLIC-MACHINE-CURRENT-END -->

### R341 原文 BOM 解码纠正（2026-10-08）

真实现消费者2.14.0默认Protobuf decoder剥字符串开头U+FEFF，Root新增原BOM守卫实际20PASS/1FAIL。原文保持规则不放宽；现普通src/infrastructure/protobuf-text-encoding.ts负责同步幂等进程wire策略，采用公开configureTextEncoding/getTextEncoding复用encode/check，只让strict与非strict decoder均ignoreBOM:true。现createBffServer在composition前配置一次；不在请求期间切换/恢复、不改owner string/bytes协议或JSON transport、不手改generated。放在现infrastructure而非Skills业务/新模块；package默认format仅加该路径。零SQL/身份/public路由/正常服务变更。最终验证以CURRENT实际收据为准，页面查看详情及示例仍未实施，不凭辅助codec通过判用户闭环。

## R340 Skills 本人包正文公开契约设计（2026-10-08；尚未发行/实现）

基线 `c91fee642c5bac79d5beab90b15a1eaf97637047`，当前 canonical public8.7.0/109，固定 Connect e83a2ad/43且缺 inspection。目标固定 Platform **1f6f764bc4bcf09d235e086ae7fe137acf16d63d** 当前45/20/24，完整52输入及三双父/历史 V5–V9以 TECH R340为准；V8/V9历史各43，不改census。先完整固定生成，再独立 canonical OpenAPI **8.8.0 / 111**追加以下两 GET，原109及全部旧 schema/metadata/status语义完整保持。当前只三 D0前缀，不已发布public，不存在正文生产route，不宣正常激活。

### 两个具名本人 GET

| Public path / operationId目标                                                               | 唯一 fixed owner RPC                                                                     |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| GET /v1/self/skills/{skill_id}/package / getManagedPersonalSkillPackage                     | ProductSkillPackageInspectionService.InspectPersonalSkillPackage                         |
| GET /v1/skill-installations/{installation_id}/package / getPersonalSkillInstallationPackage | ProductSkillInstallationPackageInspectionService.InspectPersonalSkillInstallationPackage |

owner=kokoro-bff、visibility=public、stability与既有首发策略一致、idempotency=none、permission=self/current user；Platform机器侧仅现 platform:projection.read，不新增human角色或scope。service envelope+当前 IAM Session唯一准入，tenant/subject来自 context，不从外来legacy header/body身份自报；不自动安装或先取目录猜权限。来源 path ID或安装 path ID精确送对应 typed wrapper，无command/proof/product_context；request_id原BFF ID，file_path optional presence保留。

唯一 query键 file_path，省略=目录，存在=指定目录文件原文；显式空、重复/unknown query、body(content-length/transfer-encoding)、idempotency-key均400。path ID沿当前 owner ID闭集1–191 ASCII `[A-Za-z0-9][A-Za-z0-9._:-]*`；file_path沿 owner ZIP路径：合法Unicode、NFC、UTF-8≤256B、非空、不以BOM/drive/absolute路径开头、无反斜线/NUL、无空段/./..。不trim、不二次URL-decode、不折大小写/替斜线、不把 maxLength码点当UTF-8字节验证。正常 HTTP query解码只一次后原样送owner，非法解码输入拒绝，不宽松修复。

### closed成功响应与原文

200 为唯一 `{data:{source_ref,revision,files,selected_file}}`；全部对象 additionalProperties=false，所有上述字段必填，无request_id/meta复制。`x-request-id`仅响应header；Cache-Control:no-store成功与错误一致。

- source_ref：合法 skill:<ID>；来源请求精确等 skill:<path skill_id>，安装请求合法ref但不猜来源ID；安装归属由owner本人绑定判定。
- revision：1..18446744073709551615的规范十进制字符串，无+号/前导0。
- files：0..128安全普通文本目录项，每项精确 path与size_bytes；path同安全规则，唯一并保持owner确定排序；size_bytes为0..18446744073709551615规范十进制字符串。Proto合法省略repeated由正规decoder得到空集合，再公开[]，不是伪造文件。
- selected_file：目录请求必须null且owner selected message无presence；选择请求必为 `{path,text}`，path等请求且存在files，text允许空字符串。缺wrapper/错method响应、unknown字段、duplicate/乱序路径、错source/ref/revision、坏值或presence不符都502，不补默认身份/正文。
- text原BOM、空、Unicode与换行保留，不trim、不base64替代binary、不截断；检查原文UTF-8字节与所选目录size_bytes一致。正文不当执行指令、不执行HTML/SVG/脚本、不包含资产ID/下载URL/header/tenant/subject/receipt/provider异常。
- BFF完整public JSON实际UTF-8编码（含data/null/escaping全部开销）**≤1,048,576 bytes**，单独与owner protobuf/JSON的1MiB区别；超限429 skill_package_limit_exceeded且retryable=false，不截断、不伪成功。不拿owner readMaxBytes冒public最终限额。

### 错误闭集、身份与预算

统一closed `{error:{code,message,retryable}}`，message固定脱敏，禁SQL/URL/token/正文/原异常；已知 request ID返回header，no-store。只按可信typed Connect Code及固定结构reason/header识别配对，不靠message substring猜错误。

| HTTP | code                                                   | retryable / 来源                                                                                               |
| ---- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 400  | invalid_skill_package_request                          | false；输入闭集/路径拒绝，owner固定InvalidArgument                                                             |
| 404  | skill_package_not_found                                | false；不存在/foreign/removed统一，不泄存在性                                                                  |
| 404  | skill_package_file_not_found（有条件候选，当前不启用） | false；仅后继确认 owner 稳定机器 details/error code 可区分文件缺失时准入；无此事实统一 skill_package_not_found |
| 412  | skill_package_precondition_failed                      | false；合法绑定包暂不可预览等固定FailedPrecondition，不混超量                                                  |
| 429  | skill_package_limit_exceeded                           | false；owner ResourceExhausted或本次public实际JSON超1MiB；超量文件不可预览仍429，不擅改412/413、无自动retry    |
| 502  | skill_package_response_invalid                         | false；坏typed响应/身份/headers/安全投影、Internal或未知错误tuple                                              |
| 503  | skill_package_dependency_unavailable                   | true；token/机器资格401或403、Unavailable/Canceled/DeadlineExceeded与本地完整预算耗尽；不伪用户session401/403  |

当前 inspection 实现的 NotFound rawMessage（如 package_file_not_found）不视为已发布稳定机器 details/code；当前公开映射必须统一 skill_package_not_found，不读取 message 判 missingfile/foreign。文件专属码在未取得正规机器事实前不得列实际可达分支；后继机器契约可只发行当前可达统一404闭集，不凭 D0 候选宣存在。ResourceExhausted 同样统一429 limit，不靠 message 区分超限/非文本；只有 typed FailedPrecondition 才映412。

当前session admission闭集仍原401(session_authentication_required/session_invalid)、403(service_auth_failed/session_forbidden/product_tenant_forbidden)、429(session_rate_limited，true且经验证Retry-After)、503(product_tenant_not_configured/iam_admission_unavailable，true)，不放宽或复制第二授权源。包表示确定大小拒绝的429不是时间窗口限流，不猜retry-after秒数；owner提供header也不据其虚构重试许可。机器资格失败退役token/flight，不自动重试/fallback；caller仍live的owner取消/预算到期明确503，只有caller实际断开不写。

首await前单一绝对10秒贯穿session/credential/tokenHTTP/RPC/strictdecode/publicJSONencode与末端fence，无每层重计、cache正文或已验结果replay。Platform重新在线授权及两次本人来源/安装/package/CLEAN复核；来源active/disabled/withdrawn且validated，安装installed且精确revision，draft/quarantined/removed不供正文；变化失败关闭，不替最新版。各owner事实与BFF调用不是跨服务原子事务/持久快照，授权之后已发送字节不承诺撤回。

### 发行与验收

三 D0 →52正式固定输入/三双父/完整生成 →public8.8/111及旧109 deep equal →真实IAM OAuth HTTP/Platform/Storage/PG/BFF四读缺口RED →runtime/安全强化 →真实组合GREEN →Root正常受控激活 →Web固定BFFpublic artifact与实际查看详情/切文件/异步返回。canonical仍只contract/openapi/v1/openapi.yaml；public测试/operation inventory由原入口扩展，零Schema/权限/credential变更。格式/contract/生成/type/build都是辅助，不等用户完整页面通过。

任意可见非本人未安装catalog来源正文资格、作者/usage/series、Skills human-admin与前后台同步保持OPEN；不以这两本人GET宣完整Skills或Wave0–7完成。

<!-- R340-SKILLS-INSPECTION-API-END -->

## R323 本人 MCP 四读机器契约已发布，运行接线尚未实现（2026-10-07）

当前唯一public OpenAPI **8.7.0 / 109 operations**，新增四 `/v1/self/mcp/*` GET（本人connector列表/详情、connector下connection列表、connection详情），固定metadata、安全closed shape/参数/错误与no-store。原105 operations/88path items/456components Root独立完整document剥增量后deepEqual，Platform固定vendor/generated、runtime/source/Schema/正常身份完全未动。旧R320三面中“尚未写机器契约”的阶段现由本节替代；五普通TS、正规OAuth HTTP到owner组合及正常激活仍目标，不把contract发行当已存在HTTP路由。没有新数据库/credential或兼容层。

Root实际四缺口RED 77旧PASS/4新FAIL；首机器contract73381 302PASS/1FAIL为旧R240闭集包含新path，最窄排除仅四新path/四ID，原hash/92不变。独审发现新Retry-After范围P2，现尾负控2PASS/1FAIL拒86401；只新header/verifier两行修canonical1..86400/绝对末尾、不容LF。原四RED组全文exact，旧response不改。专用checker和11漂移负控保闭集；scope JSONSchema字符计数不同于UTF-16 JS string.length，描述明确后继mapper仍须真实运行补强，不能单靠maxLength冒同规则。

Root显式Node22.22.2最终71468完整pnpm check自然exit0：contract304PASS/0SKIP、default879中877PASS/0FAIL/2原资源SKIP，lint/typecheck/build；13002 format:check自然exit0。只辅助机器验收，未运行全资源integration、真实本人四读HTTP/E2E或正常用户连接器CRUD，不把两skip计为通过。独审最终1fa085a4无确定阻断，七机器freeze加三已批准D0/本CURRENT/INDEX精确十二paths由Root独占提交；539其它tracked exact，原var保留。完整70/个人33不升级，支付最后，后继按既定实际IAM HTTP/Platform/BFF系统RED再授runtime五文件。

## R320 本人 MCP 四读 Product 消费设计（目标，尚未实现）

基线 `a3e9a7ed6615e35bcf722d5d20bddd997dcf7e86` / `codex/r257-bff-normal-current`；当前551 tracked、仅原var。已固定Platform owner `e83a2ad3a7c7d333ad0b0b8e7f3d3f64e497bc42` 与V8 aggregate `4a5ed2ca1a25673967ac2ee05a43c5f568bdd19c9ff768d8e606fdac94b9542f`；43 RPC/20 command/24 proof和历史parent39/完整V8→V7→V6→V5继续冻结。本设计新增BFF公开本人管理读，不改owner wire，不把机器消费标记当正常runtime已启用。原105 operations/public8.6.0尚无本节四GET；目标独立additive public8.7.0/109，正常服务当前版本另以Root维护证据为准。

事实owner仍Platform；IAM拥有准入与机器资格；BFF拥有public安全投影；Web仅同源adapter。四读不是完整CRUD，secret宿主/privateServer/创建编辑/启停撤销重连及mutation幂等恢复仍OPEN。本次只三D0前缀，禁止先写contract/src/test/config/credentials/Schema；Root文档通过后再按下面顺序另授。

### 四个 public 操作（唯一schema待机器切片发布）

| GET / operationId                                                               | 固定ProductMcpPersonalService RPC | input闭集                      |
| ------------------------------------------------------------------------------- | --------------------------------- | ------------------------------ |
| /v1/self/mcp/connectors / listPersonalMcpConnectors                             | ListPersonalMcpConnectors         | query status?、limit?、cursor? |
| /v1/self/mcp/connectors/{connector_id} / getPersonalMcpConnector                | GetPersonalMcpConnector           | 一个path ID；无query           |
| /v1/self/mcp/connectors/{connector_id}/connections / listPersonalMcpConnections | ListPersonalMcpConnections        | path ID；query limit?、cursor? |
| /v1/self/mcp/connections/{connection_id} / getPersonalMcpConnection             | GetPersonalMcpConnection          | 一个path ID；无query           |

全部metadata owner=kokoro-bff、visibility=public、stability=beta、idempotency=none、permission=`product.mcp.read_personal`（这是public operation描述，不新增IAMrole/scope）；普通本人无需platformAdmin。请求禁止body/transfer-encoding/idempotency-key、未知或重复query；limit仅规范十进制1–100、省略50，不trim、不接受0/负数/小数/exponent/前导零；cursor非空canonical owner opaque base64url≤2048，BFF不解码内容，原样传owner校验绑定。status仅pending/active/error/revoked，省略所有管理状态，无空串/数字/unknown。path ID完整ASCII `[A-Za-z0-9][A-Za-z0-9._:-]{0,190}`，不trim/大小写修复，禁止解码后slash或多次decode。GET detail不接受分页。owner请求只正规generated字段；request_id来自BFF可信请求context，identity永不来自query/body。

### 成功closed schema与安全语义

四200分别为 `{data:{items:Connector[],next_cursor:string|null}}`、`{data:{connector:Connector}}`、`{data:{items:Connection[],next_cursor:string|null}}`、`{data:{connection:Connection}}`；所有对象additionalProperties=false、列举属性必填。cursor有下一页才非空，末页null；items可空、最多100，保持owner顺序，绝不自动退第一页或合并旧projection。每个请求固定Cache-Control:no-store和x-request-id原BFF ID（已知可信ID时错误同样回传）。

- Connector精确字段：connector_id(string ID)、connector_type(`builtin|byok|mcp`)、provider_key(`[a-z0-9][a-z0-9._-]{0,63}`)、status(`pending|active|error|revoked`)、approved_scopes(string[]，每项JS string.length为1–128，禁止任何JavaScript `/\s/u`匹配的空白字符，集合unique，不trim或改序)。
- Connection精确字段：connection_id/connector_id/server_id(string ID)、allowed_selectors(string[]，每项1–256、非空、无首尾空白/唯一)、policy_digest(64 lowercase hex)、status(`active|revoked`)。
- 正规generated解码缺省repeated空集合后public明确[]；未知enum/缺必需message/坏字段/错误method资源ID/列表越界/重复ID或bad cursor返回502，不补授权/伪unknown。owner detail ID必须等于path，connections列表每条connector_id必须等于path；不把inactive connector对应active connection当usable承诺。
- 不输出tenant/owner/subject、external_account_ref、authorization/secret/handle、server identity/URL、rawheaders/provider响应、内部receipt或operation元数据。所有错误message固定脱敏，不靠message substring判类。

### 错误与身份退役闭集

统一 `{error:{code:string,message:string,retryable:boolean}}`，对象closed，三属性必填；no-store。公开status/code/retryable配对：

| HTTP | code闭集                                                                                      | retryable                   |
| ---- | --------------------------------------------------------------------------------------------- | --------------------------- |
| 400  | invalid_mcp_personal_request                                                                  | false                       |
| 401  | session_authentication_required、session_invalid                                              | false                       |
| 403  | service_auth_failed、session_forbidden、product_tenant_forbidden                              | false                       |
| 404  | mcp_personal_not_found（owner NotFound，不区分缺失/非本人）                                   | false                       |
| 429  | session_rate_limited                                                                          | true；透传经校验Retry-After |
| 502  | mcp_personal_response_invalid（坏wire/persisted Internal/不可能owner参数拒绝）                | false                       |
| 503  | product_tenant_not_configured、iam_admission_unavailable、mcp_personal_dependency_unavailable | true                        |

owner InvalidArgument针对已允许的opaque cursor拒绝映400；owner机器Unauthenticated/PermissionDenied、token获取失败、Unavailable/DeadlineExceeded/资源耗尽归503 dependency，不伪用户session401/403。本地完整10秒deadline届满有可写response时503 dependency；只有caller实际abort/disconnect才不迟到写响应；owner RPC返回Canceled而当前caller仍live时，必须返回closed 503 `mcp_personal_dependency_unavailable`（retryable=true），不把owner取消误当caller断开，也不悬挂无响应；无499公开schema。owner未知错误tuple或未知enum归502；不重放不同主体结果。本人缺失/foreign404不回漏授权细节；获取token不缓存用户session，当前session拒绝直接终止且不继续owner调用。

旧105操作及全部原Schema/status语义保留。8.7.0/109仅这四public GET追加，原8.6.0/105差分与operation baseline检查同时更新；不存在本片public mutation、secret、Webadapter或schema发布。

### 发布与真实验收顺序

1. 文档门通过后，先在现contract测试保原105操作/旧schema语义，新增四GET缺口RED；再唯一 `contract/openapi/v1/openapi.yaml` 发布8.7.0/109、现 `contract/tests/v1-operations.json` 精确增加四operation及现schema检查/测试更新。Platform vendor/descriptor/generated不再生成或改pin；Web之后只消费BFF正式public发行物，不复制Platform Proto。
2. 使用正式IAM HTTP token接缝的真实系统RED，再授五普通TS及必要现config/server接线；现Node22/BFF框架不升级。Root负责实际test/build/type/lint/contract/architecture/format门与Git。无mock、unit计数或native预签token冒系统通过。
3. 后继新普通 `test/mcp-personal.integration.mjs` 放现test根（不是新test/integration树），通过 `pnpm build && node --test --test-concurrency=1 test/mcp-personal.integration.mjs` 使用Root提供的受保护fixture路径、独立BFF/Platform数据库边界与Redis namespace、真实IAM user session及OAuth token HTTP、真实Platform TCP。fixture私密值不入日志/断言，测试缺资源明确skip且不算通过；正式验收要求0资源skip。原 `test/platform-projection-route.test.mjs` 和所有Skills/projection回归保留；public闭集扩现 `test/contract/openapi-contract.test.mjs`、`test/contract-governance.test.mjs` 及 `scripts/verify-openapi.ts`，仅必要将新系统test纳入现package命令。
4. 必须实际覆盖四GET成功/安全集合缺省/两页无重漏、detail/list connector统一foreign/absent404、跨subject/tenant/filter/connector cursor拒绝、错scope/缺subject/未知字段、session拒绝、token HTTP失败/自然过期/官方disable后旧token拒绝、credential轮换/并发取消/慢token与RPC/decode预算及同request-id。不导入IAM私有fixture到BFF，不访问其他owner SQL。Root R317仅native issuer证据现已由R320实际HTTP资格补齐：官方隔离fixture+独立managed personal client，真实POST /iam/oauth2/token Basic+client_credentials/resource/scope返回200/Bearer/单scope/300s，实际introspection200且BFF caller/tenant一致；错surface403、扩scope400 invalid_scope、官方disable后旧token401。Root78264自然exit0/finally关闭，未用native预签personal、未改正常权限。该证据仅资格子链，不证明BFF新token类/四GET或正常激活通过；sanitized结果见Root ignored r320-iam-http-result.json。
5. 隔离链通过与正常激活分开。正常BFF/Platform独立资格和0600配置、显式路由配置、受控reload/ready/回滚由Root另维护切片；不扩旧projection/catalog/E2 scopes，不重启当前服务。BFF正式commit/artifact固定后Web再接四读，浏览器MCP/Settings自然用户链另验，工程门不提升完整70/33。

### 真正未决

四读public形状/身份/目录/零Schema已在本前缀确定，不再反复总体设计。实际OAuth HTTP资格子链已由Root R320验证；BFF实现的token缓存/退役/预算与四GET实际组合仍须后继系统验证，正常启用时机和Web消费是独立执行门。secret本机或托管宿主、privateServer及全部mutation生命周期仍未裁决，本片没有代替它们选择auth-none或借Agent/global Register写入口。

### R323 两项精确澄清（不扩大既定方案）

approved_scopes沿固定Platform `mcp-personal.mapper.ts` 的scopes分支：每项JS string.length为1–128，禁止任何JavaScript `/\s/u`匹配的空白字符（含中间空白），集合unique；不trim、不清洗、不改序。它不同于allowed_selectors仅禁止首尾空白的既定规则。此为public safe投影闭集，不新增scope/角色或更改owner wire。

owner RPC Canceled与caller生命周期分开：caller仍live且response可写时，owner Canceled映closed HTTP503、code=`mcp_personal_dependency_unavailable`、retryable=true；本地绝对deadline届满但response仍可写时同样503。只有caller实际abort/disconnect才停止写响应，不把共享deadline signal或ownerCanceled本身当caller断开；无499、新重试/fallback或物理network保证。原十秒绝对预算、五普通TS职责、旧105有效语义和零Schema均不变。

<!-- R320 personal MCP consumer design end; prior document follows byte-exact. -->

## R319 固定 Platform V8 消费文档门（机器消费候选已生成，待Root验收）

基线为本仓 `76098c089dbcf23cc10d49140000ab04889ed7d7`、`codex/r257-bff-normal-current`，Root 起始清单543 tracked、仅既有 untracked var；原文完整保留为历史后缀。Root 已裁决本片仅升级 **Platform Connect 固定机器消费**：owner正式提交 `e83a2ad3a7c7d333ad0b0b8e7f3d3f64e497bc42`，完整V8→V7→V6→V5链、最新43 RPC/20 command/24 proof及parent39保护。不新增BFF public operation、业务client/runtime、IAM资格/权限、数据库或浏览器功能。

提交基线固定owner `c94909f1c593f2b7ffd5f325786739da744ff31f` / V7；本候选已以唯一新commit vendor替换旧Connect vendor，不双pin、latest或fallback。V8 artifact原 `inactive` / `routable:false` 与consumer `generated-not-activated`标记保留；这些是发行/消费阶段metadata，不是runtime kill-switch或正常服务启用事实。Platform R317运行证据与BFF未来真实消费/正常维护分开；四读也不是完整MCP CRUD。

### 固定机器事实，不发布新public API

唯一新owner pin为e83a；`contract/dependencies/platform-connect.json`由现正规generator发布。完整V8六文件（含provenance）aggregate `4a5ed2ca1a25673967ac2ee05a43c5f568bdd19c9ff768d8e606fdac94b9542f`，继承V7 `3384a88f31be1fdd3e15bcbceb33e4fd7d62b04dfbfef65fcc35c24ce7afbb72`；原V6/V5各自aggregate与完整bytes不变。最新descriptor SHA `5f0f00f605f6a445b4d80943459b69bf9f489fd7851cc80b6c2700f8f78a8d0e`，parent39 SHA `0467c1c45e8ac27c79cb906e27bfdb679d88739e45bfa38128f0f629bec686d5`。Platform Proto SHA `c93ae886195d7c676d1bc2a3e99dcaa8013afdd7df304558a8ea0552ec0be7e4`，common Proto保持原精确来源。

V8四本人读与11messages以固定Proto/descriptor/profile为事实源，本文不复制字段。最新43去除这四RPC及11messages后必须与parent39一致；20command/24proof保持，四读不得获得Agent proof或command身份。V8 190 vectors完整字节/provenance闭集均入固定发行物，两个3/2具名negative fixture不成为运行DSL。生成检查拒绝文件遗漏、多余文件/目录、变动digest和父链漂移，不为了V8放宽成任意0.x/版本。

旧HTTP projection有独立pin与有效用户：active本人connection聚合/provider筛选、server catalog与新管理四读语义不同。保留既有HTTP artifact/routes/client，且没有“新失败退旧”兼容分支。本片不改 `contract/openapi/v1/openapi.yaml`，不新增self URL、public schema/错误envelope、Web协议或生产路由；之后公开四读须由BFF独立文档/contract切片发布。

### 验证与后继边界

先在现 `test/platform-connect-contract.test.mjs` 追加固定V8缺口期望并取得自然机器RED，再按Root另授写集更新输入/pin并正规生成。Node22、本地现Buf/Protobuf-ES/Connect精确版本不升级；`pnpm contract:generate:platform` 和 `pnpm contract:check:platform` 继续两次独立生成byte一致、精确源/树/包/配置/hash/manifest门；common输出应保持原bytes，platform输出由工具增加四方法/11messages。原V5 census39保持历史输入，最新43与parent39分开验证，不把旧断言全改43。Root负责最终contract/default/architecture/build与范围审查/Git；作者已在Node22执行正规生成/check/build及现contract单文件16 PASS/0 SKIP；Root最终工程门与独审尚待，不宣用户功能通过。

当前机器范围无新的owner/Schema/字段/密钥政策未决。后续BFF四本人读public契约、独立personal客户端资格、真实用户session与OAuth token HTTP获取→Platform introspection、Web消费和正常进程维护另切片；R317 native issuer证据不能冒BFF HTTP token链通过。privateServer/secret宿主/编辑启停重连及全mutation政策仍未决，不在此裁决。正常projection、Skills、权限与服务保持不动。

Root完整contract首轮298项中289 PASS/9 FAIL，六个既有测试仍硬编码旧vendor路径造成ENOENT，属于本次cutover遗漏而非历史baseline。现 `test/contract/openapi-contract.test.mjs`、`test/skill-installation-http.test.mjs`、`test/skill-package-begin-http.test.mjs`、`test/skill-package-complete-http.test.mjs`、`test/skill-publish-http.test.mjs`、`test/skill-validate-http.test.mjs` 仅旧40字符commit→新40字符commit字面替换；原V5 bytes与全部断言/版本/count不变，同唯一固定点继续校验。完整门待Root重跑。

<!-- R319 fixed V8 consumer design end; prior document follows byte-exact. -->

## R291 Project release runtime 当前候选（2026-10-07）

public 8.6.0/105 与固定 Storage e8b99284 / combined c22b5c10 机器事实均未由本片改变。两具名 ReleaseProjectScope/ReleaseConversationScope 只发送已持久化 command/digest 与可信 tenant/subject/scope，无 actor header；严格 ACK/错误 tuple 分支已接 runtime worker。新租期观察字段只属 BFF 内部 port，不是公开 JSON/Proto 或第二网络协议。原 DELETE 202 pending receipt 不被 worker 改写；logical released 与 physical pending 分开。

Root 15真PG/受控 generated Connect 行为通过，仍不是真Storage/IAM或Browser验证；正常8.5消费者未切换，aggregate DELETE/status 17用户路径与真正丢ACK恢复仍待验。下面旧D0是历史设计时点。

---

## R284 Project scope release worker API边界（目标，尚未实施）

本片不新增或修改 public API。当前 commit `6f20f81a8d15992b35bc07e76ac8808d7072bee8` 已具备本地 Project DELETE/status runtime、SQL与 `8.6.0 / 105` 机器候选；正常服务仍为 `39db` / public `8.5.0`，尚未激活或供Web消费。worker完成后，原 `DELETE` 仍只返回并重放保存的 `202 {data:{...,logical_release_state:"pending",physical_cleanup_state:"pending"}}`，`GET .../deletion`仍是唯一当前投影；request ID、Location、closed errors与无条件读取语义不变。

BFF只调用固定Storage internal-owner `ReleaseProjectScope`与`ReleaseConversationScope`。请求body只有正式`CommandIdentity`；tenant/subject/scope kind/scope id来自持久可信metadata，service为`web-bff`，不得发送actor header。Storage ACK没有scope回显；BFF只在精确RPC、当前lease/fence与`scope_released=true`同时成立时接受，uint64 counts不转不安全Number且不作为物理清理完成证明。

错误/恢复为内部状态机而非新public错误：unknown、cancel、deadline、断连、无ACK和正规retryable tuple保`pending`并以同command/digest恢复；可信terminal为`blocked`。普通claim不重开blocked。只有固定owner正规`UNAUTHENTICATED`资格错误可在至少300秒冷却、每轮最多一条、同身份/命令/新fence下作一次可能写的恢复RPC；PermissionDenied、InvalidArgument、digest mismatch、precondition与坏shape不得自动恢复。public GET仅观察`pending|blocked|released`，不暴露owner code、lease、attempt、credential或内部恢复原因；`physical_cleanup_state`继续固定`pending`。

后继必须以固定Storage owner真RPC验证成功、replay、丢ACK、错误tuple与错误metadata，不以mock response宣称owner资格；public机器仍不因worker增加operation。

## R282 Project 删除 API 当前态（候选，未发行）

当前工作树已实现候选 `DELETE /v1/projects/{projectId}` 与 `GET /v1/projects/{projectId}/deletion`，并通过 Root 隔离 HTTP/PostgreSQL 16/0；公开 shape、closed errors、header-only request ID 与无条件 status GET 均保持下方 R276 方案。正常正式 API 仍为 `8.5.0 / 103 operations`，`8.6.0 / 105` 尚未发行或供 Web 消费，不能据此宣称用户链完成。

## R276-PROJECT-DELETE-D0：公开删除与状态资源（本地 runtime 已实现；机器候选未发行）

> 技术编排见 [TECHNICAL_DESIGN.md](./TECHNICAL_DESIGN.md) 同名章节，表、事务和 outbox 见
> [DATA_MODEL.md](./DATA_MODEL.md) 同名章节。当前正式已发布 contract 与正常 runtime 仍为 `8.5.0 / 103 operations`；
> 当前工作树的 `8.6.0 / 105 operations` OpenAPI 机器候选与本地 runtime/SQL 已由 `6f20f81a` 实现，但尚未发行、生成消费者、
> 接入 Storage release worker 或完成 owner/browser 链。Storage 单 Asset 删除不进入本次版本。

### 公开 owner、授权和共同约束

- public owner 为 `kokoro-bff`。两条 operation 均只允许当前 Product tenant 内 Project owner；tenant、subject、actor 与
  service identity 来自当前可信 admission，不接受 body/header 自报。
- DELETE 是幂等命令，要求单个合法 `Idempotency-Key`；command namespace 固定为 operation + tenant + subject + canonical
  Project + key，digest 覆盖 method/path/空 body。同 Project 同 key 异 digest 返回冲突；同一 key 可在不同 Project 独立使用。
- GET 是无条件权威读取，无 body、mutation/idempotency key；不提供 ETag/If-Match，也不据条件头改变语义。两条 response 均
  `Cache-Control: no-store`；request ID 只在 required `x-request-id` header，不进入 JSON resource/error envelope。
- 所有对象 closed、snake_case。成功固定 `{data}`；错误固定 `{error:{code,message,retryable}}`。`physical_cleanup_state`
  本版本唯一合法值为 `pending`。

### `DELETE /v1/projects/{projectId}` — `deleteProject`

- 请求：operation-specific `ProjectDeletionId` 严格匹配 canonical Project UUID（并以绝对字符串边界拒尾 LF）；DELETE 在
  operation 层以同 name/in 覆盖现 path-level 泛型 `ProjectId`，不改变同 path 原 GET/PATCH。空 body；必需 operation-specific
  `Idempotency-Key`，其 type/pattern/1..128 与绝对边界拒空白、逗号、非打印 ASCII、尾 LF。重复/尾斜线/编码静态 segment、
  重复 key、framing body、未知 query 均在 repository/owner I/O 前拒绝。
- 成功：`202 Accepted`，`Location: /v1/projects/{canonical_project_id}/deletion`，body：

```json
{
  "data": {
    "project_id": "PROJECT_ID",
    "logical_release_state": "pending",
    "physical_cleanup_state": "pending"
  }
}
```

本地 Project/Conversation/Schedule 事务已提交才可返回 202；Storage 逻辑 release 尚在 outbox。相同 key/digest 在 current
owner 与 receipt 检查通过时永远返回保存的原始 `pending` data/status/Location，不返回 GET 的当前状态；每次只生成新的
`x-request-id` header。未知提交结果必须以原 key 恢复，不换 key。删除后使用新 key 统一 404，不泄露墓碑或既有 receipt。

### `GET /v1/projects/{projectId}/deletion` — `getProjectDeletion`

- status path 使用 operation-specific `ProjectDeletionId`（不是共享泛型 `ProjectId`）；只对当前 owner 的已删除 Project 可见；
  active Project 或不存在/跨 tenant/跨 subject 均 fail closed，不泄露存在性。
- 成功 `200 OK` 与 DELETE 使用同一 closed data shape；`logical_release_state` 为：
  - `pending`：至少一条冻结 command 未取得可信终态且无 blocked；
  - `blocked`：至少一条 command 收到可信 terminal failure；后台只允许按同 command/receipt 恢复，不开放修复 API；
  - `released`：冻结的 Project + 全部 Conversation command 均取得可信逻辑 release ACK。
- `released` 不是物理对象删除完成；在 owner 发布正式物理终态证据前，`physical_cleanup_state` 仍必须为 `pending`。

### Closed 状态/错误 profile

| HTTP            | code                                                   | operation  | 语义                                                                                               |
| --------------- | ------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------- |
| 400             | `invalid_project_deletion_request`                     | DELETE/GET | path/query/header/body/framing 不符合本 operation 的 closed profile。                              |
| 400             | `idempotency_key_required` / `invalid_idempotency_key` | DELETE     | key 缺失或不合法；GET 携带 mutation key 归 invalid request。                                       |
| 401/403/429/503 | 现 admission stable code                               | DELETE/GET | 沿当前 session/service/Product tenant admission；429 只接受现合法 `Retry-After` profile。          |
| 404             | `project_not_found`                                    | DELETE/GET | 不存在、非 owner、跨 tenant/subject、active 状态读统一闭合。                                       |
| 409             | `idempotency_conflict`                                 | DELETE     | 同 Project command namespace/key 的 digest 不同；同 key 跨 Project 独立。墓碑上的新 key 返回 404。 |
| 409             | `idempotency_in_progress`                              | DELETE     | 同 key 事务/结果尚不能安全重放；客户端只使用原 key恢复。                                           |
| 503             | `business_store_unavailable`                           | DELETE/GET | BFF 本地权威 store/事务依赖失败。                                                                  |

错误统一为 `{ "error": { "code": "...", "message": "...", "retryable": false } }`，request ID 仅在 header。
`retryable=true` 只允许 429、503 与 409 `idempotency_in_progress`；409 `idempotency_conflict` 及其余 profile 均 false。
不得将 Storage/Scheduler 内部 code、lease、attempt、对象 key 或物理 provider 状态暴露给 public API。逻辑 outbox
`blocked` 是 GET 的可观察 data 状态，不转换成一次性 HTTP 5xx。

### ScheduledTask 与一致性承诺

- DELETE 原子暂停 Project 关联 ScheduledTask，并以当前 revision fence 写 `scheduler.replace`；不删除、不 detach，状态 read
  不把 Scheduler owner 状态拼成第二事实源。
- DELETE 前完成的 Move 决定冻结成员；DELETE fence 后的 Move/创建/恢复/写内容 closed fail。列表与详情不再返回墓碑 Project，
  但 deletion status 是 owner 专用恢复资源。
- 本 D0 不定义 retention 时限、slug 复用、物理 cleanup completed、批量删除或 admin repair API。

## R267-SKILLS-LIFECYCLE-D0：public 8.5.0 两个个人生命周期命令（仅设计）

当前公开机器仍为`8.4.0`/101；目标 additive `8.5.0`/103仅新增：

- `POST /v1/self/skills/{skill_id}/versions`，operationId `createPersonalSkillVersion`；path是本人active/disabled精确base revision，成功创建同series新draft。
- `POST /v1/self/skills/{skill_id}/withdraw`，operationId `withdrawPersonalSkill`；path是本人active/disabled精确revision，成功转withdrawn。

两者owner为`kokoro-bff`、public/beta，当前Session与固定Product tenant准入；BFF以可信tenant/subject构造Platform `OwnerScope(user, subject)`和ProductCatalogContext。请求不得自报tenant/owner/subject/series/revision，不能使用latest。公开治理permission固定`product.skill.manage_personal`，不代表另建IAM permission或放宽Platform workload权限。

### 请求、响应与严格HTTP

共同要求单一`Idempotency-Key`（可打印非空1..128，拒重复/合并）、无query、严格JSON与64KiB上限、fatal UTF-8、重复/未知键关闭；Content-Type必须`application/json`，冲突framing/Transfer-Encoding拒绝。无ETag/If-Match条件语义。`skill_id`沿现opaque owner ID profile。

CreateVersion body固定严格`{display_name,summary,tags}`。display_name是基于当前本人detail的只读不可变名称断言，不授rename；BFF不额外GET/缓存，Platform事务精确比较base名称，不同即412。summary允许空且不trim，tags沿现draft闭集。成功`201`：`data={skill_id,series_id,revision,status:"draft",replayed}`与`meta.request_id`；revision固定正十进制string且>=2，skill/series ID合法、新skill ID不得等于path base。BFF无base预读，series归属由owner事务保证。

Withdraw body严格`{reason}`，reason为1..2048 code points且至少含一个非空白字符，原样不trim进入digest；成功`200`：`data={source_ref,status:"withdrawn",event_id,replayed}`与`meta.request_id`。source_ref必须等于`skill:<path id>`，event_id必须匹配`^evt:[a-f0-9]{64}$`。撤回不删除安装/包或返回物理清理状态。

所有成功/错误必须`Cache-Control:no-store`，header `x-request-id`与body`meta.request_id`一致。错误closed tuples：

| HTTP | 允许code                                                                                     |
| ---: | -------------------------------------------------------------------------------------------- |
|  400 | `invalid_skill_request`、`idempotency_key_required`、`invalid_idempotency_key`               |
|  401 | `session_authentication_required`、`session_invalid`                                         |
|  403 | `service_auth_failed`、`session_forbidden`、`product_tenant_forbidden`                       |
|  404 | `skill_not_found`                                                                            |
|  409 | `skill_idempotency_conflict`、`skill_command_in_progress`                                    |
|  412 | `skill_precondition_failed`                                                                  |
|  413 | `request_body_too_large`                                                                     |
|  429 | `session_rate_limited`、`skill_rate_limited`；Retry-After仅1..86400                          |
|  502 | `skill_response_invalid`                                                                     |
|  503 | `product_tenant_not_configured`、`iam_admission_unavailable`、`skill_dependency_unavailable` |

新两命令envelope固定`{data,meta:{request_id}}`或`{error:{code,message},meta:{request_id}}`，错误无`retryable`；旧101 operations不变。owner NotFound与PermissionDenied目标都投404防枚举；AlreadyExists→409 conflict，Aborted→409 in-progress，FailedPrecondition→412，ResourceExhausted→429，Unavailable/DeadlineExceeded/Canceled/Unauthenticated→503，未知/坏response→502。当前owner以`assertCatalogAdmission`在命令/receipt前重读current resource，不存在为NotFound、owner不符为PermissionDenied，故两者统一404；`assertCatalogReplayCurrent`还核CreateVersion返回的新draft当前status/revision。BFF不得为了先返回receipt而绕过这些校验。

### 幂等、恢复与breaking策略

Platform receipt是唯一durable幂等事实。BFF稳定派生command ID并用正式projector重算digest；同一path下同key同语义仅在owner current replay guard仍成立时回放并`replayed=true`，同一path同key异body409；不同path使用不同command namespace，不定义为冲突。BFF不得用自己的ACTIVE-only预读挡住receipt；但owner current replay guard仍是合同：CreateVersion产生的新draft后来已发布等状态漂移时，原key可412而非永远重放201；Withdraw终态同key沿现owner规则可回放。当前Session/tenant/subject授权每次先行，撤权后的历史key也拒绝。

timeout/cancel/断连为未知结果而非回滚。消费者只可显式用原key/body重放；不得自动retry/rekey。权威read可显示当前draft/withdrawn，但不等同该command已确认。API无BFF receipt查询、事务状态或latest endpoint。

8.5为additive beta；旧101 operations与wire保持。不存在旧version/withdraw public alias。未发行Storage删除只改计划顺序为8.6/105，原合同不在本API片修改。Platform Connect contract现已有两RPC；Root已逐字节核6e5的common/platform Proto与现c949 vendor相等，不制造新pin，descriptor/generator仍由机器门复核。

### 预算与验证门

从exact route进入且admission前起单一10秒绝对预算，覆盖IAM、token、Connect、解析与回复；signal与absolute deadline/remaining budget贯穿，Connect transport禁止自动retry；过期/取消后不采纳迟到结果，不能只race promise。机器必须以正反例锁path/body/key、错误tuple/envelope/header、响应identity、重放与未知恢复；真实组合再证明本人/他人/跨tenant、active/disabled正向、draft/withdrawn/quarantined负向、并发版本分配与撤权重放。本文未发布机器或执行测试。

<!-- R267-SKILLS-LIFECYCLE-D0-API-END -->

## R266-SKILLS-BFF-D0：本人 Skill 管理 public read contract（目标8.4.0，尚未发布）

### 版本、路径与治理

当前唯一public机器事实仍`contract/openapi/v1/openapi.yaml` 8.3.0/99；本节定义下一additive 8.4.0/101目标，不把文档当已发行能力。新增且仅新增：

| method/path                      | operationId                 | metadata                                                                                             |
| -------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /v1/self/skills`            | `listManagedPersonalSkills` | owner `kokoro-bff`；public；beta；idempotency none；permission `product.skill.read_managed_personal` |
| `GET /v1/self/skills/{skill_id}` | `getManagedPersonalSkill`   | 同上                                                                                                 |

事实owner固定Platform `3d4ba6c3462e3896481f902adf47e0713c4187e4` HTTP3.3/raw`b6e5d0e…`/combined`9ad2c428…`；BFF通过固定vendor/generated client消费。Platform Connect pin不变。旧`/v1/skills*` ACTIVE discovery/published detail、安装和catalog mutation全部保持；新read不能作为安装/执行grant。

### 请求与成功响应

身份不出现在path/query/body。每次请求必须通过现service envelope与当前Bearer Session admission；可信`tenant_id/user_id`只来自IAM结果，BFF向Platform传匹配tenant/subject。普通用户、作者身份和资源owner每页/每detail重新验证；Platform admin、Organization member或内部service身份不自动获得他人的本人记录。

list唯一query：`limit`可省略默认50、整数1..100；`cursor`可省略，出现时1..2048 opaque；`status`可省略，出现时仅`draft|active|disabled|withdrawn|quarantined`。每项只含required `skill_id/source_ref/series_id/revision/name/summary/tags/status`；revision为正十进制字符串，summary允许空串，返回值不trim。成功：`{data:{skills:[...],next_cursor:string|null},meta:{request_id}}`；owner合法省略`next_cursor`时BFF规范化为public `null`，显式非空合法值原样映射，null/空串/超界/其它shape拒绝。稳定排序/cursor语义由Platform管理surface拥有，BFF不得后过滤、重排或造cursor。

detail path只接canonical exact `skill_id`且零query，成功`{data:item,meta:{request_id}}`。返回exact revision，不折叠为latest；不存在、跨tenant或非本人统一404，不泄漏存在性。两响应及所有错误都要求`x-request-id`与body`meta.request_id`等于当次BFF request ID、`Cache-Control: no-store`。

GET closed input：任意`Content-Length`（含`0`）、`Transfer-Encoding`、`Idempotency-Key`或body均400；仅Content-Type且无body合法。未知/重复/空query拒400。读取是无条件读取：不要求ETag/If-Match，调用方即使发送条件头也不改变结果且不作为额外拒绝条件；无receipt、mutation key或自动retry。

### 稳定错误闭集

公开错误继续使用现BFF envelope`{error:{code,message},meta:{request_id}}`，不新增统一`retryable`字段；retry/read策略由status+稳定code契约决定。目标闭集：

| status | code/来源                                                                                                                                    |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `invalid_skill_request`：path/query/framing/body/idempotency key非法，或owner合法`capability.invalid_request`                                |
| 401    | 现IAM admission `session_authentication_required                                                                                             | session_invalid`          |
| 403    | 现service/session/Product tenant admission闭集：`service_auth_failed                                                                         | session_forbidden         | product_tenant_forbidden`                                                                                                                   |
| 404    | detail `skill_not_found`：owner合法不可见/不存在；list无404成功语义                                                                          |
| 429    | 现admission `session_rate_limited`；合法有界`Retry-After`按现公共规则                                                                        |
| 502    | `skill_response_invalid`：owner非JSON/坏UTF-8/超1MiB/额外或缺字段、identity不绑定、未知status/code组合、owner500 internal或不符合正式profile |
| 503    | `product_tenant_not_configured                                                                                                               | iam_admission_unavailable | skill_dependency_unavailable`：本地配置、credential/token、transport、owner正式503、machine workload认证/权限失败、任一阶段10秒绝对deadline |

Platform OpenAPI的`ErrorEnvelope.error.code`机器shape是普通string，并未发布code enum；这里的closed tuple来自固定owner runtime行为与BFF显式验证政策，不冒充owner机器枚举。精确映射：400 `capability.invalid_request`→400；400 `capability.subject_invalid`→503 `skill_dependency_unavailable`（可信subject/header集成失配，不甩给用户400）；detail合法404；503 `capability.dependencies_unavailable`→503；其余已知machine认证/权限错误只映依赖503，不能冒充当前用户401/403；owner internal500及任何未知status/code/retryable tuple均502。取消/response关闭时停止写响应，不把迟到结果映200。BFF不透传owner message、retryable字段、tenant/subject或内部reason。

### 供应链与breaking规则

一次clean repin删除旧3.2 vendor目录，固定Platform完整commit+raw digest；`@hey-api/openapi-ts`沿现配置正规生成16output并由manifest逐SHA验证。public唯一OpenAPI升8.4.0、operation inventory升101；原99 operations逐项wire/metadata保持。历史Storage delete文档中的8.4/101只为未发行占位，本目标占用实际下一版本后，Storage两个delete后继为8.5/103；其API权限、预算、错误与owner receipt规则不变。

当前未决：机器尚未写、generated未刷新、runtime未实现、Root真实IAM/Platform与Web未验；不能称8.4已发布或完整Skill CRUD完成。

<!-- R266-SKILLS-BFF-D0-API-END -->

## R261-BFF-FILE-DELETE-D0：public两操作与owner receipt（仅设计，8.4未发）

基线为正式 BFF `/Users/nako/.codex/worktrees/kokoro-r257-bff-normal`、Root给定 HEAD `7269e97`。本轮只三文档新增前缀，原全文suffix逐字节保留；未修改源、机器、生成物、配置、Schema、正常数据或untracked var。现公开8.3.0/99 operation没有单文件删除；目标8.4.0/101尚未发布。Storage现pin仍`e8b9928418924812587b7ac07900aee4be5bc27f` / combined `c22b5c10ee698d579753dcac370be371d8dba1df8fead1a12883f5443fbad18a`；17 RPC候选combined `9b602259c3b777e31deb63563467ae160c04bde415e841851aefae760902f34f`不是正式新发布，最终owner commit待定。Storage正式源/机器发布后才准repin及正规生成，禁止先消费mutable工作树。

| 路径 / operationId                                                               | permission metadata / scope                                     |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `DELETE /v1/library/files/{asset_id}` / `deleteLibraryFile`                      | `storage.library.delete`；受信personal scope_id=subject_id      |
| `DELETE /v1/projects/{projectId}/resources/{asset_id}` / `deleteProjectResource` | `project.resource.delete`；本人active Project解析到canonical ID |

两operation都是BFF/public/beta，幂等required；不增加IAM policy事实。零body/query，不接受tenant/actor/subject/scope/object key/mode输入，不提供alias。asset_id沿现owner合法有界ASCII ID（1..191，首位字母或数字，余字母数字/`.`/`_`/`:`/`-`），不假定UUID；Project沿现ID/slug且canonical化。拒transfer-encoding、非零content-length、条件写头（owner无CAS）及非法selector；无body的Content-Type不单独拒。Idempotency-Key检查raw唯一、原值1..191 printableASCII且无空白/逗号，不trim。无ETag/If-Match/If-None-Match保证，不发明版本字段。

成功200严格 `{data:{asset_id,deleted_at,replayed}}`，三字段required、各层closed；asset_id精确等请求、deleted_at为owner合法UTC时间、replayed布尔。`x-request-id`有界且关联本次请求，JSON/no-store。request ID只header；新边界不复用旧meta.request_id的宽ok/failure，也不改原99操作envelope。replay仍返回原asset/time、仅replayed=true；不将历史request ID写进新响应。

### closed错误图

错误严格 `{error:{code,message,retryable}}`、无meta/details/原文；message为BFF固定安全说明，不作为判断依据。所有成功/错误均有x-request-id与no-store；限流Retry-After仅转实际合法1..86400整数秒。code只属于本表，不把Storage原码命名改写回owner合同。

| HTTP | code闭集                                                                                                                    | retryable/事实                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 400  | `invalid_file_delete_request`、`invalid_idempotency_key`                                                                    | false；本地非法输入或匹配的owner INVALID_ARGUMENT                                                                  |
| 401  | `session_authentication_required`、`session_invalid`                                                                        | false；当前本人准入                                                                                                |
| 403  | `service_auth_failed`、`product_tenant_forbidden`、`session_forbidden`                                                      | false；当前准入，不借platform_admin越过本人scope                                                                   |
| 404  | `project_not_found`（仅项目）、`file_not_found`                                                                             | false；不可见/缺失/他命令已删，不枚举跨scope对象                                                                   |
| 409  | `idempotency_conflict`、`file_delete_conflict`、`file_delete_precondition_failed`                                           | digest mismatch false；CONFLICT沿owner retryable（在途/SSI可能true、Artifact引用false）；PRECONDITION_FAILED false |
| 429  | `session_rate_limited`、`storage_rate_limited`                                                                              | true；有界Retry-After可选，无自动mutation retry                                                                    |
| 502  | `storage_response_invalid`                                                                                                  | false；坏ACK/错误tuple/未知协议，不能当已删                                                                        |
| 503  | `product_tenant_not_configured`、`iam_admission_unavailable`、`business_store_unavailable`（仅项目）、`storage_unavailable` | true仅表示可稍后核实同意图，不承诺未提交或自动重发；配置/依赖诊断不泄密                                            |

Storage ErrorDetail/Connect/status/header一致性必须固定验证：InvalidArgument/INVALID_ARGUMENT→400；NotFound/NOT_FOUND→404；AlreadyExists/COMMAND_DIGEST_MISMATCH→409幂等冲突；AlreadyExists或retryable Aborted/CONFLICT→409业务冲突；FailedPrecondition/PRECONDITION_FAILED→409前置；ResourceExhausted/RATE_LIMITED→429；Unavailable/DEPENDENCY_UNAVAILABLE、Internal/INTERNAL→503。Storage Unauthenticated/UNAUTHENTICATED、PermissionDenied/PERMISSION_DENIED是本次服务credential/策略依赖错误，映射503而非让用户重新登录401。未知或矛盾组合502。Canceled/DeadlineExceeded按现Connect无detail例外处理成取消/未知，不伪造ACK；不按message猜码。

### command与确认

只消费正式发布后的v2 DeleteAsset：request command/asset_id，身份全在可信metadata；response asset_id/deleted_at/replayed。command ID域分隔+tenant/subject/scope/publickey，不含asset；digest绑定asset语义。同scope同key异asset409，同key同语义合法已删重放，异key已删404。BFF每次fresh授权后直接调用，无GetAsset前置、第二receipt或本地成功cache。Storage源commit待定，候选digest不能代替正式发行。

总10秒/每RPC消息1MiB为目标，包含admission、Project授权和owner；剩余预算不重置，无自动retry。当前projects.find缺signal且Pool未固定连接/查询预算；目标已由Root裁决为现project port/service/repository新增 `findActiveResourceProjectId(scope, idOrSlug, signal: AbortSignal, deadlineAt: number): Promise<string | null>`，required取消与绝对deadline无默认值，仅返回同本人active谓词下canonical ID/null。新普通 `infrastructure/postgres/project-resource-access.ts` 承接有限checkout/事务内SQL期限/exact client退役及迟到获取释放，不改旧find或全局query/statement。取消后零Storage IO；pool saturation/held SQL/迟到checkout/连接故障真实门待验，不能用race冒取消。连接丢失/timeout可能已提交：保原key显式同意图核定或只GET查看，不造“已删除”；ACK后fresh现列表从首cursor刷新，单页缺行不证明未知请求提交。逻辑删除不等provider立即清理；旧签名URL最多300秒自然到期。Web动作当时需人类永久删除确认。

机器先按8.4/101目标新增两个closed操作及完整前置错误，原99wire不动；具名预算接缝设计已由Root裁决；只有Storage新commit正式发布、Root另准源范围后才进入source阶段，实际期限/取消门仍须通过。字段细节只在本仓唯一OpenAPI形成机器事实，不建立副本/alias/通用删除协议。

Root最终补充裁决：现 `src/infrastructure/postgres/client.ts` 唯一Pool仅增加 `connectionTimeoutMillis: 1000`，有限约束底层connect与pending队列，堵住仅race/late-release仍可能无界等待；不改全局query_timeout/statement_timeout、max、credentials，不创建新Pool。此为D0目标并非源码已支持。保留五新普通文件和三现port/service/repository接缝；真实完整旧回归及pool饱和、SQL锁、取消、late acquire/连接故障门必须验证无泄漏及取消后零Storage IO。

<!-- R261-BFF-FILE-DELETE-API-END -->

## R259-SKILLS-METADATA-BFF-D0：安装元信息契约（2026-10-06；D1冻结候选待Root验收）

D1候选已写入public8.3/99与固定owner生成物；此为未发布工作树，不改变正常BFF/Web合同，Root验收前不得消费。

固定 owner 为 Platform `c94909f1c593f2b7ffd5f325786739da744ff31f` / digest `4fe862adba0d460fa23713c124ba747d457f23f777043926739d16e35d350e07`。现五个 Product installation RPC、请求、分页、幂等、错误和 V7/V6/V5 历史 artifact 均不变；只在 `ProductSkillInstallation` 增 required tag10 `display_name`、tag11 `summary`、tag12 `source_status`。BFF public五个既有安装操作同步返回 required `display_name`、`summary`、`source_status`，OpenAPI additive升8.3.0但仍99 operations；成功/错误 envelope及`meta.request_id`不变。

- `display_name`与`summary`必须来自安装所绑定的精确 owner revision关联，BFF不另查catalog或缓存。`display_name`须非空白且JS `length<=255`；`summary`允许空串、JS `length<=65535`并原样投影、不trim。public JSON字段required不等于Proto implicit scalar具备独立wire presence：owner省略合法空summary时固定decoder得到`""`，不得据此判坏响应。
- `source_status` public闭集为`active | disabled | withdrawn | quarantined`；UNSPECIFIED、draft、未知数值/名称视为坏owner响应并走既有稳定502错误，不扩新错误协议。状态只描述来源当前安全状态，不等于安装enabled，也不授权执行。
- GET、LIST、Install/Enable/Remove ACK使用同一 `SkillInstallation` schema。receipt replay保留owner原change/event/replayed/安装状态，仅呈现owner当前权威元信息；BFF不保存或改写receipt。
- removed、disabled、withdrawn或quarantined资源仍按owner授权可读并携带三字段；不存在第二查询、兼容optional shape或九字段fallback。
- consumer必须一次固定新commit/descriptor/generated；旧vendor目录同切片删除。V6 `sourcePins`必须改用其发布时五个historical pins独立校验，不得随latest Proto/descriptor常量漂移；latest两项另按新pin严格校验。BFF vendor V5–V7实际27文件及三aggregate保持byte-exact，owner V1–V7历史总量93文件仍由owner发布证据约束，不发布V8。

机器/RED范围与顺序以同轮TECHNICAL_DESIGN前缀为准。实现前测试须在旧BFF上证明：新owner pin失败、十二字段strict response失败、public required schema失败；测试double不得代替Root最终真实IAM→BFF→Platform回读/replay。当前正常进程不重载，Web仍不得消费未发布字段。

<!-- R259-SKILLS-METADATA-BFF-D0-API-END -->

## R257 管理路由 HTTP 实施验收（2026-10-06 16:16 UTC）

四个已发布public8.2操作现有具名route/client实施，System3.0固定artifact与全部旧operation不变；无BFF DDL/新owner/兼容proxy。

Root92682 Node22 check+format exit0：contract264/0、主829PASS/0FAIL/2既有skip、lint/types/drift/build0；Root50905正式IAM CLI资格/Audit/CodePKCE/current admission→BFF四具名操作→System真实PG官方seed/三读/visible CAS保存/权威回读/原key重放/异body与旧版本409/坏Session401通过。资源PG77→77/IAM前缀keys0→0、cleanup passed；独审ea30e379，route8f59/clientb308/test3aeae1冻结。

正常BFF仍旧进程，本次未重启/授正常管理员；Web管理页面仍占位，合法普通Session403/管理员撤权后重放、普通models visible投影、浏览器保存确认、推理和资金未验。仅owner子链及本切片工程通过，旧404/400/502/取消抖动证据保留；下方阶段描述为历史exact suffix，不作当前否认实现的依据。

- 当前机器候选为 public `8.2.0` / 99 operations；System consumer 固定 3.0.0 commit `955bd587f46a771e43a4330d202d90a7d2d67262` 与原字节 SHA-256 `94ed91655741cbba66ce80a4c41717b9179cc509cb6858534e0b78aa3e6dc059`，生成过滤只含三读一写四具名 operations。

## R256-ADMIN-03.D0：四个 current-tenant 模型路由管理契约（2026-10-06；目标 8.2.0，未发布）

当前 public 机器基线为 8.1.0/95 operations；唯一可编辑事实源仍是 `contract/openapi/v1/openapi.yaml`。目标 additive 升级为 8.2.0/99 operations，不覆写旧 immutable artifact，不建 `/v2`、兼容 alias 或任意 `/system` proxy。固定 owner 输入是 System 3.0.0 runtime-Zod OpenAPI（SHA256 `94ed91655741cbba66ce80a4c41717b9179cc509cb6858534e0b78aa3e6dc059`）；正式 immutable commit/digest 由 Root 开工前写入 pin。System 仍为最终授权、状态、CAS 与 receipt owner。

| Public operation                                                      | System 3.0 固定 operation | 语义                                                                            |
| --------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------- |
| GET `/v1/admin/model-routing` / `listAdminModelRouting`               | `listRoutingPolicy`       | current tenant routing 有界分页                                                 |
| GET `/v1/admin/model-labels` / `listAdminModelLabels`                 | `listModelLabel`          | current tenant label 有界分页，仅供首片选择/显示                                |
| GET `/v1/admin/model-revisions` / `listAdminModelRevisions`           | `listModelRevision`       | current tenant revision 有界分页，仅供首片选择/显示                             |
| PUT `/v1/admin/model-routing/{label_id}` / `replaceAdminModelRouting` | `putRoutingPolicy`        | 单 label 显式 CAS upsert；System 现行四字段完整请求，首轮 UI 验收只编辑 visible |

### 身份、请求与成功表示

- 四操作均需现 service envelope、唯一用户 Bearer、current IAM admission 且 `platform_admin === true`；false 为 403 `admin_model_routing_forbidden`。tenant/actor 只来自受信 context，query/body/header 不接 tenant、actor、service、permission 或 global selector。BFF 仅映射为 web-bff + current tenant + actor + 三 read 的 `system:read`/PUT 的 `system:write`；System 再校验。缺/坏 platform_admin 或 IAM unavailable 保 503，不复用旧 true。
- 三 GET 唯一 query 为可选 `limit`、`cursor`：limit 缺省 50、十进制 1..100；cursor opaque 1..2048。重复/空/未知 query、body、Idempotency-Key、条件写头均 400。成功严格复用现 BFF 分页 envelope：closed `{data:[...],meta:{request_id,next_cursor}}`，`next_cursor` required 且为 opaque string 或末页 `null`；data item 由各 operation 独立 closed schema 固定。保 owner 稳定排序；cursor 绑定 tenant 与 operation/filter，不是权限，跨主体/操作拒绝。每页重验 current admission，不宣称跨页 snapshot。
- PUT path `label_id` 为 UUID；无 query；required `Idempotency-Key` 1..128。创建仅 `If-None-Match: *`，更新仅 `If-Match: "N"`（N>=1），二者同时、缺失或其他值 428 `admin_model_routing_precondition_required`/400 invalid request。closed body 与固定 System 3.0 generated request exact，BFF 接受并转交该 owner 契约全部合法四字段变化，不另读旧 row、做字段 merge/重复写规约或缓存权限；第一轮 UI/用户验收只编辑 visible并提交其已读完整快照。不接受 partial/PATCH/null/多字段。raw JSON、media type、body bytes 与字段界沿固定 owner artifact并由 BFF strict 前置校验。
- PUT 200 只表示 owner command ACK，响应严格复用现 BFF envelope `{data:{...routing snapshot/version...},meta:{request_id}}`；随后客户端以 GET routing 从首页开始有界分页查同 label，只有 same id、目标 version、完整字段相等才 `confirmed`。普通 `/v1/models` 另行刷新只验证 visible projection。不存在 public detail GET；不得发明 `/routing/{label}` GET 或将 PUT echo/catalog 当权威回读。
- 成功和错误均 `Cache-Control: no-store` 与 `x-request-id`，且 header 值必须与 body `meta.request_id` 一致。四操作复用现 BFF envelope，不采用 System 的 header-only 表示：成功为 closed `{data,meta:{request_id}}`（分页仅在 meta 追加 required nullable `next_cursor`），错误为 closed `{error:{code,message},meta:{request_id}}`。unknown/additional/null/unsafe integer/非法 cursor/截断、错误 status-code 组合均不得投影 success/empty。

### 错误、幂等、期限与取消

System 400 `INVALID_ARGUMENT`→400 `invalid_admin_model_routing_request`；403 `FORBIDDEN`→403 `admin_model_routing_forbidden`；404 `NOT_FOUND`→404 `admin_model_routing_not_found`；409 `VERSION_CONFLICT`→409 `admin_model_routing_version_conflict`，`IDEMPOTENCY_KEY_REUSED`→409 `admin_model_routing_idempotency_conflict`，`INVALID_STATE`→409 `admin_model_routing_invalid_state`；428 `PRECONDITION_REQUIRED`→428 `admin_model_routing_precondition_required`；System 503/transport/config→503 `admin_model_routing_unavailable`。owner 401/credential/permission mismatch 不伪装普通用户未登录；按 service dependency failure 503 并告警。未知 status/code、坏 media/JSON/envelope/request-id/schema、超限→502 `admin_model_routing_response_invalid`。公开错误保持现 BFF closed `{error:{code,message},meta:{request_id}}`，不新增统一 `retryable` 字段或第二错误协议，不透传 owner message、SQL、secret 或正文。

每次 owner call 使用一个 10 秒总预算覆盖凭据/header、连接、响应 body 与 strict parse，各阶段不得重置；response body 有固定上限、无自动重试。request abort/response close 传播 AbortSignal并退役迟到结果；取消不证明 owner SQL/COMMIT 撤销。System durable receipt 是 PUT 幂等唯一事实：原 key+原 body/precondition 可由明确后继流程重放以取原结果，同 key 异请求固定409；BFF 不 claim 自己的 mutation ticket。网络/期限/丢 ACK 进入 `unknown`，只读核实，不自动产生新 key。GET 找不到、失败、读到旧/更高版本不能证明原命令失败或成功。

### 发布、RED 与范围

正式发布同时更新 OpenAPI、semantic validator、99-operation inventory、固定 System dependency/generated 与 contract tests；生成物不手写，旧 System pin 不双读。后继首个真实业务 RED必须使用合法 current-admin Session、固定 Product tenant、正式 web-bff service identity与 System 自有 PG 已存在 routing row，目标 public GET/PUT因当前 BFF route 未实现而失败；伪 token、登录前拒绝、空数据或不存在方法不算。正负还需 ordinary false、org-admin/platform-false、撤权、跨 tenant/global、伪 identity、CAS冲突、same-key异body、wrong feature/draft/retired revision、invalid owner response、取消/unknown与 System 零越权写。跨两行默认切换、CRUD/publish/provider、推理/计费不在 8.2 四操作内。

<!-- R256-ADMIN-03-D0-API-END -->

## R257-PERSONALIZATION-EVOLUTION-D0：具名运维操作边界（2026-10-06；目标待实施）

源码基线 399e70dfd97004c4c75cfb1e83c571a38c749437 已发布 public 8.1.0/95 operations；本片不改其 HTTP、IAM pin 或 generated，不新增管理 HTTP/RPC。下面旧全文为完整历史后缀。已有数据演进只新增 owner 运维 CLI，ADR 为 [ADR-003](./ADR/ADR-003-personalization-schema-evolution.md)，正常激活仍未验。

拟正式入口 pnpm db:evolve-personalization check / apply，只接受这一个必需位置参数；未知/重复/多余参数拒绝。显式读取既有 KOKORO_BFF_POSTGRES_URL，不自动加载 .env、不接受 URL/SQL 参数或隐式 apply；拒系统数据库及非 kokoro_bff schema、options/search_path 注入。连接信息和原始 PG 错误不回显。check 同 advisory lock 串行只观察；apply 同锁同事务，唯一允许写入见 DATA。

| 退出/结果                             | 语义及恢复                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 0 / check legacy 或 current           | 已完成同锁 catalog 观察；legacy 不是无条件执行授权，normal 仍需备份/恢复与维护配对门。current 不是上次 COMMIT ACK/因果证明。 |
| 0 / apply applied 或 already_current  | 前者目标创建/后置校验/COMMIT 与清理确认；后者精确 current，零 DDL，不改已存行/revision。                                     |
| 2 / invalid_request 或 invalid_schema | 参数/目标/碰撞/漂移不合格，零修复；稳定安全 code，不透传对象正文/SQL。                                                       |
| 3 / unavailable                       | 连接/锁/预算/COMMIT 前失败；主错误保留并附安全 cleanup 状态，不声称靠超时已取消 SQL。                                        |
| 4 / unknown                           | apply 已发 COMMIT 后未完成确认或安全收尾；禁止自动重试/声称回滚。新连接同锁 check，失败/超时仍停止。                         |

结果仅 operation、request_id、state/result、安全 code、duration_ms 及必要 cleanup 状态；不输出 URL/credential、正文/参数/正文摘要。CLI 不消费 Session、不授管理员；本人 HTTP 资格仍来自 current Session，schema 权限不代替业务资格。check 失败不包装 legacy，apply 失败不输出 applied。精确 catalog/期限见 DATA/TECH，不提供 reset/down/fallback 开关。

发布先具名隔离演练和 Root normal 备份恢复/只读前置，再协调 IAM/BFF/Web；正常旧实例不因文档或纯门通过而重载。本人保存未知回执继续按 public8.1 只读核实，不自动重发；schema current 也不等浏览器保存或后台管理 CRUD PASS。

<!-- R257-PERSONALIZATION-EVOLUTION-API-END -->

## R257-PERSONALIZATION-D0：本人四字段 Product 契约（2026-10-06；目标未实施）

正式基线 ac3cd1da4f13e9e22320efbd4dbf4009aa0a2e29 的 public 8.0.0/93 operations 无 personalization；以下旧全文为 exact suffix。唯一机器源 contract/openapi/v1/openapi.yaml 新增两个 additive operations，目标 public 8.1.0/95 operations；不修改旧 artifact 或既有 operation shape。Root 验收后交新 immutable commit/version/digest，Web 固定生成消费；本轮未改机器源。

| 项       | 目标合同                                                                                                                                                                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 资源     | GET /v1/preferences/personalization / getSelfPersonalization；PUT 同路径 / replaceSelfPersonalization。owner=kokoro-bff，visibility=public，stability=beta。                                                                                                                              |
| 资格     | 现 service envelope+唯一用户 Bearer+current IAM admission；tenant/subject 只来自受信 context。普通本人可用，无他人 selector/管理员旁路。permission metadata 为 personalization.self.read / personalization.self.write，仅 public 用例分类，不新造 IAM scope/grant。                       |
| 幂等     | 两者 x-kokoro-idempotency=none；PUT 以 required expected_revision 保证同条件至多一次效果，不要求 Idempotency-Key、不造 receipt。重复旧版本409，不承诺相同 ACK 重放。现治理默认 mutation required-key，后继只能对精确 method/path/operationId 增 CAS 例外及反向负控，不放宽其他 mutation。 |
| 请求边界 | 唯一精确路径，无 query（未知/重复/空 selector 均400）；GET无body。PUT一个 application/json Content-Type，raw body≤65,536 bytes，严格 UTF-8/raw JSON，重复键/坏转义/孤立 surrogate/NUL 拒绝。旧 PATCH不alias；其他method405，Allow: GET, PUT。                                             |
| PUT body | closed {expected_revision,nickname,occupation,about,instructions}；revision为required integer 0..9007199254740991，不接受unsafe/fraction/string/coercion；四项required string，空串表示清除，不接受null/漏项/多字段/数组。                                                                |
| 字段界   | nickname128、occupation256、about2000、instructions8000 Unicode code points（非UTF-16 code units）；保空白/换行/内容，不隐式trim/normalize/截断。字段和whole-body界同时成立，转义膨胀仍受raw bytes限制；正文不执行插值/Agent应用。                                                        |
| GET200   | closed {data:{personalization:null,revision:0}} 只代表owner本次确认不存在；存在为 {data:{personalization:{nickname,occupation,about,instructions},revision:N}}，N为1..9007199254740991。null+正revision/对象+0非法。GET不建行、不假空。                                                   |
| PUT200   | 仅COMMIT确认后返回同结构非null snapshot；首次revision1，替换expected+1。字段取成功SQL返回值，不把请求echo当持久ACK；与旧revision相同内容仍须CAS，成功推进一次。                                                                                                                           |
| 传输     | 所有成功/错误no-store、x-request-id；request ID只header，不增meta/body字段。无ETag/分页/event/公开profile。Web后继保header，当前泛代理丢request-id不算已闭环。                                                                                                                            |

### 失败与 ACK 未知

新operation用现规范closed {error:{code,message,retryable}}，不泄raw parser/SQL/正文；400 invalid_personalization_request 覆盖query/GET body/JSON/字段/Content-Type；413 request_body_too_large；405 method_not_allowed；409 personalization_revision_conflict（首次竞争/stale）不得附私有当前内容，另GET本人值。版本安全上限拒409 personalization_revision_exhausted、零更新/不回绕。以上retryable=false。原401/403/429/503 admission code/语义保留，但本新资源统一no-store/header及无meta error shape，不改旧路由。

缺表/DB故障/锁或预算耗尽/损坏Row为503 personalization_unavailable，绝不伪null/空串/零版本成功。COMMIT已派发后失败/断连/timeout如仍能响应为503 personalization_save_unknown；retryable=false指不得自动重发写，允许只读核实。客户端任何网络异常/丢失ACK也按unknown，即使没有该code。GET临时失败可retryable=true；PUT依赖失败保守false，恢复先GET。取消不保证错误body送达，也不证明提交已撤销。

显式保存冻结正文和旧revision：200 ACK后GET与ACK完整四字段/revision相等，才显示“已保存并读回”。更高版本（即使同内容）如实提示当前版本变化，不冒ACK最新。ACK丢失后GET expected+1且内容一致只证明“当前值已核实”，不证明哪笔并发写；GET旧版本可能早于在途提交，不据此安全重发。值不同/更高版本为冲突，读失败仍unknown。不得自动把新revision贴旧草稿重发、无提示覆盖或无限loading。

### 发布与验收

合同、canonical、source同片过lint/semantic/正规inventory、真实HTTP+PG/生命周期后由Root发布。Web immutable pin/strictparse/同源CSRF/显式按钮/ACK回读与actor退休属后继片。正常既有数据正规演进和IAM0.8/Web组合门未满足不单侧激活。Root验合法普通Session A/B保存/刷新/清空/冲突/未知读回；preview/HTTP doubles/合同门不称完整FR-14 PASS。Knowledge、导入、Agent读取/应用不在两operation内，原台账保持OPEN。

<!-- R257-PERSONALIZATION-D0-API-END -->

## R257-ADMIN-BFF-D0：本人当前管理员投影（2026-10-06；未实施/未发布）

本仓当前6d46ec8已发布MCP public8.0.0/93 operations；本片仅设计，原三D0全部正文为exact suffix。唯一public机器源仍contract/openapi/v1/openapi.yaml；不新增管理verify端点/服务，不复制IAM资格写契约。

### 固定owner输入

IAM POST /internal/v1/session-authorizations/verify / verifySessionAuthorization，internal-owner，既有iam:session-authorization.verify；固定0.8.0 commit d24aa2b697de59a350e8588720620df331bc5da5，contract/openapi/iam.internal.v1.json SHA256 0153a16f5c2779803d73d93d5533caf1b377d21299cefe01613d7cd1b2cbb194（本次只读重算exact）。BFF现active仍0.7.0/e3c035b99cf9479ac8357c7d38147f1541dcbcac，未改pin或generated。

消费新成功data的required platform_admin:boolean及全部原allowed:true/tenant_id/user_id/session_id/client_id，以正规generated严格解析；不由JWT decode/自报header/body/role/email推导。true由IAM保证fixed Product client+tenant+当前User资格且原完整会话准入成立；BFF仍核已验tenant==自身fixed tenant，不另设客户端名单/权限scope。普通false是合法会话。owner缺字段/null/错型/多字段、损坏/故障不默认为false，沿503 iam_admission_unavailable；旧身份/限流/固定tenant错误语义不改。

### 唯一public变化

| 项             | 目标                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 路径/operation | 原GET /v1/me / getCurrentUser，owner=kokoro-bff，public/beta，idempotency=none，permission=identity.self.read；93operation保持。                        |
| 请求           | 原service envelope+唯一本人Bearer，body/query拒绝保持；不接他人user/tenant/admin selector，不新增Idempotency-Key或管理员token。                         |
| 200            | 原{data:{user_id,tenant_id},meta:{request_id}}中的data追加required platform_admin:boolean；CurrentUserIdentity保持closed，其余原字段/既有meta语义不改。 |
| 普通用户       | 当前false仍200，不拦普通页面；Web后继隐藏Settings后台入口，访问/admin及受保护管理API按各自边界拒403。                                                   |
| 传输           | 沿现no-store/x-request-id/有界响应与取消；不公开IAM session_id/client_id、资格版本、管理者名单、reason、Audit或secret。                                 |
| 错误           | 沿现400/401/403/429/503与envelope；资格校验未知/依赖失败保503而非伪false或回用旧true；不在/me假造新的admin403。                                         |

新字段属于strict表示演进，public仍处正式发布前8.0.0，由Root发布新的immutable commit/digest后Web固定消费；已交MCP artifact保持原字节。没有optional字段、missing→false、旧shape双读、旧权限alias或另一个可编辑contract中心。现operation inventory不增删；后继新增真实管理命令时才逐个声明它们的owner/权限/失败/审计，不用本布尔覆盖所有owner操作。

### 安全时序与发布门

BFF每个请求在线IAM核验，不将肯定结果作为后续请求票据。Web/admin server与管理API必须各自fresh取得本人投影，只在明确true时准入；同一个未过期token撤权后新请求读false。缓存、Cookie显示字段、先前页面200/true不允许绕过新检查。授权snapshot先于并发撤权的在途请求仍有时序窗口，后继业务执行点另验，不虚构本片expires_at/receipt或跨服务原子撤销。

正常IAM现旧实例与BFF旧strict0.7保持配对。本片源未实施，Root须先完成正常IAM已有库两字段演进/验证、准备BFF0.8及Web新public消费，再同受控窗口切换；两种strict shape不兼容，不先激活一侧导致全部普通准入失败，不增加兼容fallback。正常用户管理员授予仅IAM具名管理权正式CLI，非本BFF/Web产品代码或启动seed。

验收：现真实HTTP controlled owner证明true/false/同token撤权新调用、错shape/伪身份/错tenant/取消与普通回归；Root再验正式帐号普通无入口/直链拒绝、管理员当前页面、撤权/刷新/切人，以及各owner真实业务独立授权。当前没有后台CRUD或正常用户E2E通过结论。后继精确文件/命令见TECH同名前缀。

<!-- R257-ADMIN-BFF-D0-API-END -->

## R257-MCP-BFF-D0：本人 Connection public只读契约（2026-10-06；仅设计，未发布/激活）

唯一机器源仍是 contract/openapi/v1/openapi.yaml。目标在当前发布前8.0.0中仅新增 GET /v1/mcp/connections / listSelfMcpConnections；owner=kokoro-bff、visibility=public、stability=beta、idempotency=none、permission=capability.mcp.read（既有MCP治理分类，非新IAMgrant）。Root后继发布新immutable commit/digest，旧已交接blob不覆写；Web固定新artifact后消费。本轮机器/inventory/generated/source/config均未改。

固定owner为Platform commit 9ab3b653360d04fb498a238659edeec01e72f62d、HTTP3.2.0、contract/openapi/platform-http.openapi.json、SHA256 4b42dd161c972b3447cfea3a6f80a949bbdb573c46213dbf8ef4c3ecb58e72da；generated调用listSelfMcpConnections，不以Connect或移动工作树代替。

### 输入/身份/分页

每次现IAM Session admission后的context.identity.namespace/userId建立唯一tenant/subject，BFF生成owner headers；现tenant-bound workload token使用Platform audience/platform:projection.read。caller身份header不成为authority；不收tenant/subject/owner/scope/Run/proof query/body。
唯一query闭集是可选connection_id、provider_key、limit、cursor：connection_id为1..191且正则 ^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$；provider_key为1..191；limit缺省50、仅十进制正整数1..100；cursor为1..2048 opaque。重复/未知/空值拒绝；沿现projection先trim再校验，除此不变换大小写或解析/重签cursor。limit拒浮点/指数/符号/前导零/越界；无body、transfer-encoding或Idempotency-Key。非法400 invalid_query_parameter且零owner调用。
精确connection_id仍列表，不新detail alias。cursor由owner绑定tenant/subject/surface/全部filters；跨主体/filter或坏cursor拒400，不默默回第一页。每页重验当前资格，不宣跨请求snapshot；更换filters/主体须从首页重新请求。

### 成功投影

200严格为 {data:{connections:[...],next_cursor?:string}}，顶层/data/item均closed。无JSON meta/request_id；传输只用x-request-id，全部响应Cache-Control:no-store。next_cursor有后页才出现、1..2048，末页缺失，非null/空串。

| 每项required字段                         | 约束                                            |
| ---------------------------------------- | ----------------------------------------------- |
| connection_id / connector_id / server_id | 各自独立opaque ID，1..191、同上述ID正则，不互代 |
| provider_key                             | string 1..191，owner原值                        |
| transport                                | 唯一streamable_http                             |
| status                                   | 唯一active                                      |

资格为同tenant active connection、active且owner=user/当前subject的connector、其current approved且属于该connector的authorization、registered/streamable_http/provider匹配的server。先完整资格再keyset/limit；不存在/他人/撤销exact filter均合法empty，不泄存在。BFF原顺序/身份/cursor投影，不按Server过滤/去重/合成Connection。
不返回server_identity/declaration_digest/URL/headers/secret handle/token/scopes/grant/proof/audit/raw row，不加name/authorized/enabled。owner200返回Server旧shape也拒绝；active不等于工具权限/选择提交/enable/Agent成功。

### 错误与取消

错误严格 {error:{code,message,retryable}}，安全固定message、所有状态含BFF x-request-id/no-store。新GET单独closed错误profile，不为其放宽旧Skill/Serverprofile。

| 条件                                                                                          | public结果                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 现服务认证、缺/失效Session、资格拒绝、限流、固定tenant/依赖失败                               | 保现401/403/429/503及service_auth_failed、session_authentication_required、session_invalid、session_forbidden、session_rate_limited、product_tenant_not_configured、product_tenant_forbidden、iam_admission_unavailable；沿现retryable/合法有界Retry-After；零Platform调用 |
| 本地query/body/key非法；owner有效400 capability.invalid_request（含坏cursor）                 | 400 invalid_query_parameter，retryable=false                                                                                                                                                                                                                               |
| projection配置/凭据/token失败、网络/总deadline；owner有效401/403/500/503                      | 503 mcp_connection_dependency_unavailable，retryable=true；不把workload拒绝当资源不存在/假empty                                                                                                                                                                            |
| owner坏JSON/media/schema/headers/request-id/no-store、超限、未知status-code组合或其他意外状态 | 502 mcp_connection_response_invalid，retryable=false                                                                                                                                                                                                                       |
| caller取消、response destroyed/writableEnded                                                  | 退役本次结果/取消等待，不向已结束response补成功或错误                                                                                                                                                                                                                      |

映射owner错误前也核fixed generated error envelope、exact owner request-id/no-store及status-code匹配；畸形400返回502而非400，未在此operation声明的404也不是本人资源不存在。不透传owner message/detail。单次总预算覆盖token+owner headers/body/parse（默认5000ms），owner上限1MiB，按TECH收敛；无自动重试，retryable仅支持用户显式新GET。非GET及未登记别名保持现fail-closed，不新增写operation；GET /v1/mcp/servers的资源含义、shape与错误契约不变，不alias/fallback到新接口。
后继机器/断言/生成集见TECH，Root审D0后另行准入；本节不是已发布机器或真实用户验收。

<!-- R257-MCP-BFF-D0-API-END -->

## R255：ScheduledTask anchor/next public contract（2026-10-05；仅设计）

当前 public `/v1`、operationId、成功/错误 envelope 与 IAM admission 不变；唯一可编辑机器源仍是 `contract/openapi/v1/openapi.yaml`。在 8.0.0 发布前 clean-slate 更新同一版本，不增加 `/v2`、alias或双轨：

- `CreateScheduledTaskRequest` 与 `ScheduledTaskPatchRequest` 删除输入 `next_run_at`，新增可选 `recurrence_anchor_at: string(date-time)`。create省略时由BFF冻结当次锚点；weekly继续沿现算法取该锚点在任务IANA timezone中的weekday，daily不增加日期规则。patch省略保原anchor；显式提供才改变anchor并形成新revision。旧`next_run_at`输入作为未知字段拒绝，不能静默解释成anchor。
- `ScheduledTask.next_run_at` 保持required成员，但其schema允许 `string(date-time) | null`。它只表示当前task revision已由Scheduler成功receipt确认的`next_due_at`；不是caller输入、创建/更新时间、cache TTL或执行保证。`enabled=false`或`status=paused|failed`时固定null；`enabled=true,status=active`且null表示新建/修改后待Scheduler确认、依赖失败或当前投影未知，不表示即将立即执行。现`enabled/status`已足以区分paused，不新增sync状态字段。
- create/patch先提交BFF任务与versioned outbox，故同步200可合法返回null。register/replace receipt经异步fenced settlement投影后，后续GET/list才返回确认instant；delete没有next projection。Scheduler timeout、畸形body、身份/rule/timezone/version/paused漂移不得产生next或把outbox标为成功。

receipt正控必须来自固定generated Scheduler response，并逐值核Schedule name/rule/timezone/paused及callback body中的tenant/task/owner与本outbox command请求exact；`next_due_at`须为合法UTC instant，且active成功时存在。Scheduler `version`是Scheduler owner自己的正整数版本，只验证形状并绑定同一receipt，不要求或暗示它等于BFF task `revision`。只有outbox `aggregate_revision`匹配锁内task当前revision且lease owner/token/fence仍有效的settlement可更新投影。旧revision、迟到ACK、重放旧receipt或删除后响应均不得覆盖当前row；修改schedule字段或anchor的本地事务在revision+1时先清`next_run_at`。

本契约只覆盖create/replace后的确认值。持续执行后Scheduler推进next的事实仍需其后继受认证、tenant-scoped Schedule read契约（或等价owner事件）先发布，再由BFF固定版本消费；该后继契约必须单独定义返回Schedule与BFF task当前revision/command identity的可信绑定，不能直接复用历史receipt的revision结论。现command receipt不得描述为live read；无owner来源时不通过Web/BFF计算、重复replace或callback加周期补值。

后继机器范围仅现OpenAPI、semantic validator、operation inventory与contract tests，版本仍为预发布8.0.0；实现/SQL/生成/消费范围以TECH当前节为准。错误闭集与权限不扩大，不新增public endpoint、header或管理员能力。

---

## R255-BILLING-CONSUMER-D0：个人 Credit public read 合同（目标，尚未发布）

BFF public `8.0.0` 尚未正式发布，目标在同一clean-slate发布内删除旧float `BillingSummary {balance,currency,period,usage}`，不保兼容字段。固定Billing owner依赖为commit `244b2810c0cc043d29fffb2b3301eebf2d390b3d`、target artifact `3.0.0-experimental.3`、v2 source SHA-256 `ecaceefd3fd09d5106b364593dd513506622ca011bb0436b74f0928ffd8dcf00`；owner artifact当前仍标注未发布/部署/消费，正式consumer activation必须等Root固定owner runtime验收。

### public operations与闭集DTO

- `GET /v1/billing/summary`：保路径/operationId，成功data严格改为 `{credit_account_id:uuid,status:"active"|"disabled",available_micros:nonnegative decimal integer string,held_micros:nonnegative decimal integer string}`。
- `GET /v1/billing/ledger?limit=&cursor=`：新增唯一read operation；`limit`缺省50、范围1..100且仅十进制整数，`cursor`为owner opaque字符串、长度1..2048、不得解码/重编码。成功data严格为 `{items:[{journal_id:uuid,sequence:nonnegative decimal integer string,delta_micros:signed decimal integer string,balance_after_micros:nonnegative decimal integer string,source_kind:string,source_ref:string,created_at:UTC ISO-8601 Z}],page:{next_cursor:string|null}}`。

两者继续使用BFF `{data,meta:{request_id}}` envelope，响应含有界 `x-request-id` 与 `Cache-Control:no-store`。所有micros/sequence保持字符串；1 Credit = 1,000,000 micros只用于显示单位，不授权BFF/Web计算金额、费率或余额。BFF不把`journal_id`改成entry_id、不把source_kind改成reason、不把instant改成epoch，也不合成quota/period/plan/free/daily字段。Web必须随固定public artifact更新，不能以本地旧Zod shape反向定义BFF事实。

summary无body/query；ledger无body，拒重复/未知query、非法limit、空或过长cursor。tenant/subject只来自每次现IAM session admission的可信RequestContext；public caller不提供owner u1 header、service identity或Billing credential。两operation沿现authenticated-session admission，public治理metadata统一复用已定义的 `billing.summary.read`；它表示同一个人账务读取面，不新造ledger/admin权限。该OpenAPI治理标记不等于IAM已登记逐operation grant：当前IAM没有对应`billing.*` policy事实，实际授权仍是现session admission加owner本人u1运输，必须以IAM准入/撤权组合正负控放行，不能凭metadata假定grant。

### owner transport与错误映射

BFF内部只调用owner `GET /v2/billing/me/credit-account` 与 `GET /v2/billing/me/credit-ledger`，用固定五因素：`web-bff`、internal secret、独立Billing BFF service bearer、tenant u1、subject u1。用户Bearer不下传，partial machine profile不降级。owner 200先按固定generated schema验证再重包，owner request-id只作观测且不替换BFF public request-id。

| 条件                                                      | public结果                                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| IAM session缺失/拒绝/限流/不可用                          | 保现401/403/429/503与Retry-After语义，且不调用Billing                        |
| public ledger query非法                                   | 400稳定invalid request，零owner调用                                          |
| Billing本人账户不存在                                     | 404 `billing_account_not_found`；不返回零余额或空流水                        |
| Billing 200不符合固定schema                               | 502 `upstream_response_invalid`，不透传部分数据                              |
| Billing credential缺失、401/403、timeout、不可达、500/503 | 503 `billing_unavailable`、retryable true；不把服务认证失败误报为用户401/403 |

错误仍遵API05的本仓唯一实际error envelope（具体字段以现public机器合同为准），不得透传owner内部message/header/credential。GET read-only、无Idempotency-Key、无BFF receipt；no-store适用于成功与错误。

### 真实验收矩阵

Root先对固定Billing runtime做直接owner HTTP：合法本人账户与至少两条正负delta流水200、decimal/sequence/UTC/cursor逐值一致；missing wallet 404；错tenant/subject不能读另一身份；非法limit/cursor400；所有响应no-store。u1须逐项验证无padding canonical base64url tail、严格UTF-8：191/255 code points与最长四字节编码后1022/1363 header边界正控，padding、noncanonical tail bits、非法UTF-8、空值、编码NUL、孤立surrogate及任一超限负控。认证分支须精确断言：任一 `x-kokoro-service`/`x-kokoro-internal-secret`/`x-kokoro-subject` machine marker或service bearer出现即选择machine，缺/错任一五因素为403且不回退user；完全无machine marker与service bearer且无user bearer为401；合法user bearer为200，撤权/无效user bearer按owner user分支拒绝。每个拒绝前后Billing账户/ledger事实摘要相等。该矩阵必须含真实Billing进程与PostgreSQL，mock JWT/local test signer只证明测试profile，不冒正式IAM签发。

组合E2E再以同一真实用户：Web硬刷新→现IAM session→BFF summary/ledger→Billing；余额卡等于owner `available_micros`，held单独显示，分页按owner cursor无重复/遗漏，刷新仍一致。撤session在Billing调用前失败；跨subject/tenant、missing wallet、Billing停机/坏credential、畸形owner响应均显示错误且绝不出现旧假100/零余额/其他用户数据。浏览器开发者网络不得出现Billing URL、service token或u1内部头。payment/top-up、quota/grant、计价、hold/capture/release不在本片，不能用它们的缺失判本两读失败或冒其成功。

当前只修改D0；public YAML、operation inventory、generated consumer、route和Web均未改，也未执行上述验收。

## R251-SKILLS-V2-CONSUMER：public 8.0.0 值域切换（目标，尚未发布）

Validate请求字段与路径不变，调用者仍不自报manifest identity、asset、tenant或subject。成功响应字段shape不变，但`manifest_identity`唯一pattern由`zip-v1`替换为`zip-v2:sha256:<64 lowercase hex>`；旧V1、错误长度、uppercase及前后缀均拒绝。`/v1`资源路径保持，唯一public OpenAPI升`8.0.0`；这是发布前同步breaking replacement，不是7.x兼容扩展，也不创建`/v2`或fallback。

BFF generated Platform client与来源证明必须固定producer `494b118ae7c29f1fc1005122d72c6c2bbf2640b6`：V7 aggregate `3384a88f31be1fdd3e15bcbceb33e4fd7d62b04dfbfef65fcc35c24ce7afbb72`→V6 `0d728881ba1046dc566131d63de71f6821ec636cf45837b5d937fee9872d5f91`→V5 `3f97b3c98fd8e7ce46e4a8ea73237ddb85e764849d2b15dd28d0a3a58a69e42f`，并保持39/20/24与descriptor检查。V7的inactive状态只作机器证明，不等于产品activation。错误、IAM/session、command/retry语义不变；Validate ACK不等于Publish或Install ACK。

正式BFF 8.0.0发布后，Web才可固定该commit/version/digest并正常生成；不得提前手改consumer生成物。当前未修改机器OpenAPI、route或generated client。

## R241 Project name PATCH 当前已实现候选（2026-10-05；未发布）

本节覆盖下方 R240“仅机器合同/尚未接入”的旧时态；当前源码已实现 `PATCH /v1/projects/{projectId}/name` / `renameProject`，唯一 OpenAPI 候选为 public `7.2.0`、91 operations，原 90 项和 instruction PATCH 保持。Root 精确 Git 交付及发布身份待定，未更新 Web 消费 pin，未启用 3310。

最小闭集 ACK、rename 专属闭集错误及 request-ID/no-store 已贯通正常 route 和 IAM admission 拒绝分支；名称 trim/UTF-16/NUL、raw Host 正确的 65536/65537 body 边界、strict key/header/JSON、缺配置 tenant 的 503 等在真实 BFF HTTP/PG 基础五组验证。IAM 在这些 owner 测试中仍为边界 double，不冒正式认证组合。

旧 key 只回原 ACK、权威 GET/list/旧 slug 与重建 store/server 持久读回均已验证；ACK 不承诺覆盖其它随后合法提交。所选并发/故障/取消矩阵遵守同一机器合同，准确27父子统计及完整244资源门见 CURRENT。已断开 HTTP 不伪造成功，100ms PG检查不增加网络分区检测或取消时延公开承诺。

机器合同仍为未发布候选；消费者只在 Root 实际交付 immutable commit/version/digest 后接入。用户页面 ACK→GET→刷新、正式 IAM、未选失败窗口和公开 DELETE 仍待后继，不因本后端通过自动关闭。

## R240 public 7.2.0 Project name PATCH（2026-10-05；合同候选）

R241 取消窄修（待 Root 复测）：TECH 当前节的事务内 `client_connection_check_interval=100ms` 只改断连检测，Linux/macOS 研发与 CI 为本轮平台边界、其它 OS 未验证，既有 ACK/错误/header 与未知 COMMIT 后重新准入对账合同不变，也不向已断开的 HTTP socket 伪造成功。

唯一机器事实源 `contract/openapi/v1/openapi.yaml` 由正式 `cdad0ad6580dcbca18b75fdfbdbac4aa61f750d2` 的 public 7.1.0 加法演进到候选 7.2.0：91 operations，保全部原 90 项。只有 `PATCH /v1/projects/{projectId}/name` / `renameProject`，使用专用 RenameProject 参数/请求/ACK/错误组件；原 instruction PATCH 与 ID/slug GET 不变，无 alias。

闭集输入、canonical ID、raw header/body 边界、trim 后 UTF-16 名称规则、NUL→400、八状态错误码/重试性与每响应 request ID/no-store 都只在机器合同维护。ACK 是首次成功的最小 name receipt，不是当前整资源；旧 key 返回旧 ACK 后应 GET 当前资源。503 保现有 `product_tenant_not_configured`，不重写 IAM 来源码；旧 operation 的 meta/envelope 不迁移。

后继服务端必须在现 server 精确分流及 IAM 拒绝 envelope 分类中接入该 route；统一 request ID header 已由 active 前置提供，但不等于新 route 或准入错误已实现。receipt 及当前授权先于重放见 DATA/TECH 当前节。

本片只进行无资源合同检查；真实 HTTP/PG RED、原子失败和授权矩阵、完整 owner 门及 Root 审查另行准入。只有 Root 发布 immutable version/commit/digest 后消费者才 repin；本候选不宣称 rename 可用、公开 DELETE、Web 刷新或正式 IAM 全链通过。

## R239 Project资格与HTTP响应边界当前态（2026-10-05）

本节为当前已验证候选事实；下方R236为实施前设计记录，其“未实施/未验证”时态由本节替代，位置及边界说明仍有效。基线main 7289b3a4ae8f2df5c249350d59b9405c33fb4083，本地交付身份以本仓Git与Root收据为准，尚未启用用户3310组合。

现public7.1.0、机器OpenAPI、错误码、身份、operation、generated均不变。现25资格查询排除墓碑Project并保原tenant/owner；统一x-request-id使原错误响应具备既有required标识，IAM专属验证分流不改。真实HTTP/PG矩阵含active/Direct正控、同tenant foreign/跨tenant/墓碑拒绝、零副作用、六父锁竞争及既有Message/Move重放。

SessionAdmissionDouble只证明BFF HTTP/PG，不是正式IAM/浏览器整链。无生产Project tombstone writer/DELETE/name PATCH；公开Share与后台Run完整生命周期继续待验。完整资源证据见CURRENT R239。

## R236 Project active 资格前置（2026-10-04；现public7.1.0不变）

正式HEAD `7289b3a4ae8f2df5c249350d59b9405c33fb4083` 无Project.deleted_at；Root已选最小active前置，当前仅文档。唯一机器OpenAPI、operation/version、现错误/envelope、IAM契约、ID/slug读取语义不改；R234 `PATCH /v1/projects/{projectId}/name` 仍是独立后继，未因本片成为正式能力。

目标在既有25处Project资格条件上增加active过滤：每次现IAM准入后只用可信tenant/subject，详情/写入按原不可见错误语义拒绝墓碑/foreign，不泄漏其存在；集合沿原协议排除不可见项。现父锁查询在锁内检查active，Message不增加HTTP owner预读；重复请求/Move重放保持各自已发布协议，不发明新status/code或统一改变receipt语义。Project资源上传/列表经原projects.find继承资格，不另加route/alias。

**后继真实HTTP＋PG矩阵：** 本人active P/墓碑D、同tenant其他owner、跨tenant；分别以既有ID/slug引用测试Project list/get/instruction/revisions/skill/tasks、Task创建关联、Conversation list/detail/messages/snapshot/process/rename/share、Artifact列表、Move源/目标/重放及首次/既有Message准入。P与Direct正控保持，D/foreign按原协议拒绝或集合排除，拒绝后Project/子事实/Message/dispatch/receipt全量快照零差；不以“返回404”或字符串predicate计数代替正负业务oracle。

资格矩阵放现 `test/business-store.integration.mjs`，schema放现 `test/schema-governance.test.mjs`；保HEAD全部R217测试。HTTP使用SessionAdmissionDouble时只证明BFF HTTP/PG，正式IAM组合另由Root验证，不能冒真人认证全链通过。先Root独审D0，再真实RED→最小GREEN→完整门；本片未运行测试。

本片没有生产墓碑writer/公开DELETE；Share公开能力与后台Run原有Conversation/stream生命周期不因单列自动终止。独立Task政策、Storage释放、Run收口仍OPEN；无新增Service/port/installer、删除三表、generated/lock、兼容路径或新公共API。

## R217 Message 准入当前候选（2026-10-04；wire不变）

公开Message请求/202 receipt、404与503 envelope、`Idempotency-Key`、`x-request-id`和`no-store`均未变；OpenAPI版本、operation inventory、generated与错误码无差异。候选只把Message owner授权/写事务纳入单一4.5秒内部期限，并在checked-out PostgreSQL连接断开时稳定返回既有retryable 503而非进程级uncaught。COMMIT已执行但ACK丢失仍只返回503，不猜成功；同key/body重试从immutable dispatch读取原`run_id/user_message_id/assistant_message_id`并返回202，异body仍冲突。通知失败不反转已提交receipt。

Root真实HTTP/PG四故障矩阵4/4和完整182资源门已通过，API独审0P0/P1/P2。Message有限准入切片已获Root验收；准确交付commit、Root gitlink与启用状态由Root CURRENT/progress维护，当前3310仍是旧组合。Web/UI、Agent接收和收费链不因本节成立。

以下R213段是实现前的历史D0；现实现与验收状态以上方R217段为准。

## R213 Message 单一准入错误与次序（2026-10-04；目标，未实施）

`POST /v1/sessions/{sessionId}/messages`的wire、响应envelope和公开错误集合不变。IAM/session与strict JSON/query仍在数据库之前；invalid Message为400，缺Idempotency-Key为现400，Agent disabled/unconfigured为现503，且后二者不触库。随后单个有界Message事务决定资源事实：client-created首次Message的显式Project不可见返回现404`project_not_found`；foreign tenant/subject、deleted Conversation及非client-created legacy/missing ID返回现404`session_not_found`；same-key异body仍409，同key/body在Move后仍返回原receipt，新key stale Project仍404且零写。多个同时非法条件采用上述静态门优先，但该交叉优先级不新增为契约保证。

本D0不新增endpoint、header、body字段、alias、兼容路径或机器契约版本。pool/SQL期限耗尽继续使用现503`business_store_unavailable`、`cache-control: no-store`与`x-request-id`，不得用超时后迟到读取猜202。

## R205/R189 Message replay 的外部不变边界（2026-10-04；无机器契约差异）

现Message path/body/key/status/envelope与public OpenAPI保持原字节。每次请求仍先IAM session admission；same-key同body可在Conversation已Move后返回原结果，因为授权读取当前本人Conversation而不是把旧caller Project当当前归属。same-key不同body冲突；新key显式旧Project或不可见Project失败，不产生Message、dispatch或receipt。省略Project时，新命令绑定锁内Conversation当前canonical Project或direct；首次client-created Conversation只接受当次可见Project。

本片不增加Project DELETE operation、permission、route、兼容alias或HTTP状态，不把`project.delete`引入IAM。

## R176 Storage scope-release internal consumer（2026-10-03；public机器契约冻结）

BFF 已固定 Storage 正式发布 `e8b9928418924812587b7ac07900aee4be5bc27f` / digest `c22b5c10ee698d579753dcac370be371d8dba1df8fead1a12883f5443fbad18a` 的两个 release RPC wire shape。它只是 `internal-owner` consumer artifact，不新增或修改 BFF public OpenAPI operation/version；Project DELETE route、状态查询、permission/error与Web仍未发布。

## R152 Move 内部拆分的 public 契约边界（2026-10-03；仅文档，未实施）

**当前态/目标态。** 已发布的 BFF `main 0333cd7c515846e977b1b05d8349e8c04d2a49dd` 仍以唯一 `contract/openapi/v1/openapi.yaml` 发布 public `7.1.0` `POST /v1/sessions/{id}/move`；源码身份为 `284b5e04c4c09759787ef239b1a19fcdcd5ed8fa`。R152 只把已存在的 PostgreSQL Move 事务、连接租约与 receipt Row 映射按职责归位，**不修改** operation/version、canonical path/body、permission、Idempotency-Key、200 与错误 code/envelope/header、每次 IAM 准入、unknown COMMIT 返回或 Web 可见时序。Move 的 final receipt 仍与归属同事务，same-key 重放仍在当次准入后返回原结果；不能以内部模块拆分建立第二条外部/内部协议。

**验证与开放边界。** 机器契约、operation inventory、semantic checker、generated/pin 本片均保持原字节；后继 Root 须在源码落地后重跑原 public contract/负例、741 纯测试基线及 9 项真 HTTP/PG Move、完整 173 项集成，确认等价而不是单靠文档。BFF producer 已发布不代表 Web 已固定 BFF commit/digest 或浏览器消费；Project DELETE、Storage release 消费、T-C05 与原用户界面仍开放。下节 R146 描述现已发布的业务协议，本节仅更新内部放置目标。

## R146 Conversation Move 公共契约（2026-10-03；7.1.0 BFF producer 已发布）

**当前态。** 已提交并推送的 `main 284b5e04c4c09759787ef239b1a19fcdcd5ed8fa` 包含 public `7.1.0` 唯一 canonical `contract/openapi/v1/openapi.yaml`、具名 Move operation 与 HTTP/PG 实现；此前 public `7.0.0` 基线无 Move。Root Node22 `pnpm check && pnpm format:check` exit 0（741 pass、1 个既有资源 skip；contract 4 条已知 warning），真 HTTP/PG Move 9/9、完整八文件 PG/Redis integration 173/173；BFF producer 已发布，Web 固定 commit/digest 与浏览器消费尚待验，不能称用户界面可用。Move 是 Project DELETE 的“保留会话先移出”独立前置能力，不替 DELETE 搬会话。Storage 的 Conversation/Project release 依赖、Project DELETE 原两 P1、独立 ScheduledTask 关联规则及 T-C05 仍未闭合。

**单一命令。** `POST /v1/sessions/{id}/move`（`id` 必须是 canonical Conversation ID，不接受 slug），`public`/`beta`、`x-kokoro-owner: kokoro-bff`、`x-kokoro-permission: chat.session.update`、必填单值有效 `Idempotency-Key`，无 query。JSON body 严格闭集且 required `target_project_id`：值仅为 canonical Project ID 或 `null`，不接受 target slug、源 Project、自报 tenant/actor、`project_ref` query、额外字段、空串/空白或错误类型。`null` 为移出到 direct；非空为 direct→Project 或 A→B，一次命令不产生可见中间 direct 状态。具体 canonical ID 词法、key 长度和统一 envelope 以本仓当前 OpenAPI 与直接语义门为准，不由文档另造兼容格式。

**成功与重放。** 本地归属及最终 receipt 在同一 BFF PostgreSQL 事务提交后同步 `200`，安全最小响应 `{"data":{"session_id":"<canonicalConversationId>","project_ref":"<canonicalProjectId>"}}`，移出时 `project_ref:null`；不公开源 slug、owner 内部行或运行上下文。成功/错误均返回现有有界 `x-request-id`、`Cache-Control:no-store`，错误保持唯一 `{error:{code,message,retryable}}`。同 key/同 target 在**当次重新 IAM 准入与本人会话可见性检查后**返回原 200；同 key/不同 target 409 `idempotency_conflict`；另一新 key/已在该目标仍为 200、自己的新 receipt。服务重启或成功 ACK 丢失不得再移动到别处；事务失败不得先存成功 receipt。Move 没有 Storage/Scheduler/Agent 后继命令，故不返回202。

**可见性与状态码。** 400：非法 canonical ID/key、重复 key、缺/非法/额外 body 字段、任意 query；401：无效/失效用户会话；403：可信 service/tenant admission 拒绝；404：不存在/已删/非本人/跨 tenant 会话、不可见或已删的源/目标 Project，不暴露哪个资源失败；409：同 key 异目标或确定的并发冲突；429：限流，若有 `Retry-After` 必须有界；503：本地事务结果不可判定，不能猜成功或将未知 ACK 映成 200。Move 的Pool/SQL/锁/重试总等待预算不超过5秒，目标Project被他人持锁时应在预算内返回本操作已有 typed retryable 503，不能仅以“四轮重试”掩盖单轮无限等待；此为已发布 BFF 源码实现的 C5 预算，聚焦真PG锁等待/连接回收及完整八文件集成已验，Web 消费者仍待验。错误 code 应在本 operation 机器 schema 中按状态收紧、复用现已发布语义，不能通过共享 schema 放宽旧 operation。所有身份取 current IAM 和受信路径，不转发用户 Bearer 给其他 owner。

**运行中语义。** Move不改变 Conversation ID/Message/Share/AG-UI cursor、当前 Run、stream 或 Artifact association，也不取消/重启；已 admitted Run 可按原 Project context 继续，**只有 Move 提交后的下一次 message/Run admission**读取新 `project_ref`。源/目标 Project 与 Conversation 在同一事务锁后重查，当前仅存在性 fence；未来 Project tombstone 发布后两边均要求 active。Move先提交则 Project DELETE 成员快照排除该 Conversation；DELETE先提交则 Move 返回404，不存在“删后成功移出”。现 DELETE 仍是未实施目标，API 文档不得称该竞态已验。

**R146 D0 原机器/行为门（历史阶段）。** 先在唯一 OpenAPI 增 operation/closed schema/专属成功错误与五项 `x-kokoro-*` metadata，同步 operation inventory、`scripts/verify-openapi.ts`及正反 contract tests，不放宽既有 Chat/Project operation；然后真 HTTP+PG RED/GREEN 覆盖 canonical-only、同/异key重启、撤权重放、两连接锁/DELETE竞态和 running Run 原样。BFF owner 发布 commit/version/digest 后 Web 才固定 consumer 并验同源 adapter；机器门、聚焦 Move 真 HTTP/PG 9 项及完整八文件集成已有候选证据；本清单中的 DELETE 竞态及其他未跑矩阵不因此算通过，Git 发布和 Web 消费仍未完成。

## R145 Project DELETE 目标公共契约（2026-10-03；仅文档门）

**R145 设计时基线与当前候选。** 已提交 public `7.0.0` 时 `/v1/projects/{projectId}` 仅 GET/PATCH、operation inventory 无 DELETE，当时也无正式 Conversation Move。当前工作树机器契约已有未发布 `7.1.0` Move 候选，但 Project DELETE 仍无 operation 或运行时。下述目标不是已发布operation或运行时能力。Storage `main 2f855816347b56b3b8dd594366b001548441e0dc`已发布现Project release；具名`ReleaseConversationScope`与Project合法Artifact graph安全释放只是已审D0目标，BFF尚未pin/生成/调用这些在途能力。现GET/PATCH与其他Project路径的可见slug语义保持，**仅新DELETE限canonical `project_id`**，不造slug alias。

**原两项P1的owner发布/行为阻断。** 现Project release ACK不覆盖成员Conversation scope；BFF清关联也不等于Storage释放。已审Storage目标为具名`ReleaseConversationScope`（受信`web-bff + conversation`，body仅CommandIdentity），与增强Project release分别在精确scope锁内验证完整Artifact graph；合法图同事务永久fence、释放Upload/Asset/Blob并排入durable cleanup，Artifact保审计身份清title，损坏图整笔`FAILED_PRECONDITION`回滚。BFF只在Storage正式机器/行为发布及固定commit/digest后消费，D0文本不算关闭P1。最终公开状态的logical released须由N个成员Conversation加1个Project scope全部权威ACK证明；损坏图是显式`blocked` integrity anomaly而非成功/物理GC，不发明remediation RPC、第二owner字段或事务外预检。未满足时不能将下文202/状态草案发布或称T-C05完成。

目标具名 `DELETE /v1/projects/{projectId}`，BFF/public/beta，permission `project.delete`，必填唯一可打印且有界 `Idempotency-Key`；无 body、无 query。可信tenant/owner来自每次 current IAM session/fixed tenant，不能从 path 以外的普通header/body自报。不存在、非本人/跨tenant、已删而使用另一新key统一404且不探测Storage；同键异语义/重复header/非法path分别按固定409/400。当前身份撤销即使同键也先401/403，不从本地receipt重放越权成功。Project确认页目标说明项目及成员会话/指令/仅项目文件不可恢复，独立Library与ScheduledTask保留；若需保会话须先经**独立、已实现但尚未发布的 Move API**移出，不能在当前产品宣称“先移出再删”已可用，也不靠删除自动迁移。

**202只确认本地durable提交。** 目标初次/同键重放安全表示草案为`{data:{project_id,state:"deleting",storage_release_state:"pending"}}`；`x-request-id`只在header，`Cache-Control:no-store`。它由同事务本地receipt返回，不表示任何Storage scope已释放或物理对象已回收，不能返回假204“全部删除”。推荐另一个受信本人只读`GET /v1/projects/{projectId}/deletion`（canonical ID only）读最小墓碑/持久命令状态；`storage_release_state=pending|released|blocked`在公开契约落地时须为**N+1 scope聚合**：任一未知/未ACK为pending，任一完整图异常为blocked，仅全部权威logical ACK才released，不能用单一Project ACK掩盖成员scope。`physical_cleanup_state=pending`另表示**未取得物理终态证明**，即使Storage计数为0也不造完成。Root在机器门固定最终状态route/字段、Location或等价发现机制，不发明owner响应字段；不能发布202却没有结果/失败查询途径。

同一Project deletion固定N个锁定成员Conversation-scope `ReleaseConversationScope`与1个Project-scope `ReleaseProjectScope`稳定durable命令，各自只用Storage正式发布版v2机器契约；BFF不得凭Project ACK推断全体完成。各调用以独立workload credential与受信`web-bff`、tenant、subject、request ID、相应`scope_kind`及canonical `scope_id` metadata传身份，body仅CommandIdentity，用户Bearer不转发。BFF逐scope只接受权威`scope_released=true`及非负uint64计数，未知ACK重投原scope同一command/digest；三个计数仅logical事务观测，非物理清理证明。合法Project/Conversation Artifact图由Storage原子释放；损坏图`FAILED_PRECONDITION`显式标`blocked` integrity anomaly，不吞错、不把它当永久成功或普通pending；非授权/坏owner响应失败关闭，timeout/ACK未知保持pending重投。不得以ListAssets+逐项删除或message文本推断成功。状态查询对其他owner统一404，不公开对象key、签名URL、owner内部堆栈或凭据。

错误目标为状态专属稳定code：400无效path/key/body/query，401未登录/失效，403 service/tenant拒绝，404不可见或不同新key已删，409同键异语义或同时处理中，429限流（可选有界Retry-After），503 BFF持久层/owner依赖不可判定；Storage已接收但ACK丢失时对**已本地提交**的DELETE仍返回前述202与pending状态，不把未知当完成。所有成功/错误均返回有界 `x-request-id` 与`no-store`，错误用唯一 `{error:{code,message,retryable}}`。机器门需一次更新OpenAPI version/operation inventory/semantic checker/negative tests，不放宽旧GET/PATCH/Chat operation；Web只在BFF正式发布后pin。

**独立ScheduledTask关联**只确认“不级联删除”，后续规则尚待用户异步答复：推荐删除事务使任务脱离P并暂停，保task ID、Scheduler replace与revision fence；另一方案要求用户先处理关联任务才接受DELETE。二者不可同时作为已定public语义，最终公开DELETE前须选一，但Storage机器/Chat/持久命令切片不因此停工。已admitted Scheduled Run仍由Agent终结，不能由任务状态伪造terminal。Conversation Move另有独立API/事务/测试门，不因本DELETE候选而宣称T-C05.D02通过。

## R133 当前切片 Root 验收事实（2026-10-03）

HTTP5 正式消费、public7 过程契约、两 canonical process 表、同事务 RR 快照、immutable anchor 分页、START 与分批 GC 完整性切片已由 Root 复验。真实 PG/HTTP：15 焦点和完整 74 项全部通过、0 skip；完整默认纯门 736 pass/1 既定 PG schema resource skip，四 pure 149 pass；format（含全部变更 TS/MJS）、lint、typecheck、build、全 contract pipeline 与 233 contract tests 通过。最新证据：资源19016f31、纯门7c8284b1、contract f7e3519c；两独立限定源码审0/0/0。

两个 fixture 的时间戳/umask 假前置及 public7 Snapshot 示例缺字段已修并真实复测。当前 contract lint 剩4条 warning：3条 conditional-schema局部 required-properties提示、1条既有特殊操作无2xx提示；不称零warning或整个owner集成通过。下方“5条全既有/待Root”是历史阶段，不作为最新状态。集成提交身份以本仓 Git 与 Root progress E108 为准；Web7消费、当前真实浏览器、外部模型、正规积分及完整BFF其他资源/镜像验收仍未完成。

以下为此前阶段与已批准技术方案。

## R132 snapshot example 更正候选（2026-10-03，待 Root 复验）

Root 复核确认下方把 5 条 contract lint warning 全记为既有并不准确：其中一条来自 public7 `SessionSnapshotResponse.example.data` 缺少新增 required `execution_process`。本片已为 active head 的同一 Run 补齐 `run_id`、`todos`、`activities`、`next_cursor` 四字段闭集示例，未改变机器 schema、版本或 API；实际剩余 warning 数与通过状态等待 Root 重跑后记录。

## R132 public7 本片 Root 验收事实（2026-10-03，Git 发布待 Root）

Agent HTTP5 安全过程消费与 public `7.0.0` snapshot/Run process 单轨契约已完成本片有限验收，包含授权 RR、immutable anchor 分页以及既定 400/403/404/410/503 错误语义。证据绑定资源 `19016f31`（15 焦点与完整 74 全通过）、pure/default `3b926e2d`（149 pure；default 736 pass + 1 既定 PostgreSQL schema resource skip）及完整 format/contract `4811c5e9`（233 contract pass / 0 skip，保留 5 条既有 lint warning）；两次 R131 独立源码终审均为 0/0/0，原 timestamp 与 permission fixture 失败也已由 Root 窄修复测关闭。BFF7 Git 提交/推送仍待 Root；这些结果不代表全部 BFF 业务、其余资源、镜像、用户 Web/浏览器、真实 provider/外部模型或正式积分已验。

## R129 过程完整性错误语义候选（2026-10-03，待 Root 资源验收）

public `7.0.0` 字段与 route 不变：已授权历史 Run 的 START 若有 durable tombstone/floor 回收证据则返回既有 410 `process_cursor_expired`；compact↔ledger/source/frame 或 Run/activity identity 损坏且没有回收证据时返回既有 503 `process_projection_unavailable`；未知 Run 保持 404。未新增 cursor 状态、发行链、secret、alias 或兼容响应。

## R126-GREEN-C 当前契约候选（2026-10-02，待 Root 资源验收）

机器契约已切单轨 public `7.0.0`：snapshot required nullable 四字段 `execution_process`，Run process route 返回含同一 required watermark 的五字段锚定页。无 public6 alias、旧过程协议或 raw tool payload；正式不可变发布仍等待 Root 完整资源门。

## R123-GREEN-A 当前契约事实（2026-10-02，待 Root 最终全门）

内部 Agent consumer 已单轨固定正式 HTTP `5.0.0` owner artifact，严格接纳 Todo 与三类安全 activity，并只投影 `kokoro.todo.updated` / `kokoro.activity.updated`；旧 HTTP4 raw activity 不再兼容。BFF public machine 仍为 `6.0.0`，本片未修改 public snapshot、process route、分页或错误契约；下方 public `7.0.0` 仍是已批准后继目标。

## R123-BFF-HTTP5-D0：public `7.0.0` / Agent5 契约目标（2026-10-02，未实施）

当前机器仍是 BFF public `6.0.0` / Agent HTTP4；本节只冻结后继单轨目标。Agent owner固定
`79bf98c5aa63b9bace207afdf42d8c7aefee4fe8`、HTTP `5.0.0` OpenAPI SHA-256
`bca8e4f4fd613e4325f594266893d5b089168cf14f2ad7a7df03f3f116af85f2`、provenance
`12c0f7ad3e6f7de6ff2183410fdae986119e99bd6975e9f07ee71f23dc2d22ca`。只复制owner artifact并生成窄client；不import Agent source，不把distribution2/proof1当HTTP5。

### 内部 owner decode 与公开安全映射

- HTTP5 `ChatEvent`九值和decoded mapping是唯一wire闭集。外壳及Todo/activity payload必须 exact presence、`additionalProperties=false`、safe integer/epoch、Unicode scalar与原始payload UTF-8 byte门；unknown discriminator、旧raw shape和extra key整条source fail closed，不能map null后推进HWM。
- Todo是完整有序替换；缺事件公开为`todos:null`，`[]`为已观察清空。CUSTOM固定`kokoro.todo.updated`，value只含`todos[{content,status}]`。
- activity CUSTOM固定`kokoro.activity.updated`。tool/subagent只含opaque activity/segment、status与固定display_code；Skill只含opaque activity/preflight、source_refs、phase及failed条件error_code。raw name/args/result/description/error原文/path/stack/tool_id/subagent_id/hidden reasoning均禁止。
- BFF只按source sequence采用每个合法closed值；Agent5未发布phase/status单向transition，因此不得拒合法回退、terminal后新状态或同activity新preflight。source identity+digest仍负责replay no-op与漂移冲突。

### `GET /v1/sessions/{sessionId}`（public `7.0.0`）

`execution_process`在response中required且nullable；从未有durable START时为null。非null对象的四字段全部required：

```json
{
  "run_id": "run_opaque",
  "todos": null,
  "activities": [],
  "next_cursor": null
}
```

- `todos`为`null | ChatTodo.todos`：null=selected Run尚未观察Todo；`[]`=owner明确清空。
- `activities`只是该snapshot anchor下的**第一页**，不是Run总量；最多100项，且`execution_process`对象本身（Todo、activities、cursor等）的序列化bytes≤1 MiB，稳定按activity首次public顺序、再`activity_id`排序。该page预算不包含同一session snapshot的Message、Delivery等其他字段，长聊天正文不因此拒绝。
- `next_cursor` required nullable；非null表示仍有锚定activities，只有null表示耗尽。
- 顶层`event_watermark`继续required nullable opaque `agui_...`。非null process必有非nullwatermark；四process字段与Message、execution_head、HITL、Delivery均来自同一授权RR snapshot。
- `execution_head`与`execution_process`可指向不同Run：terminal process在successor仅queued时保留，直到successor durable `RUN_STARTED`才切换。

### `GET /v1/sessions/{sessionId}/runs/{runId}/process`

这是认证session owner的锚定page，不是share API。它既能恢复snapshot所选Run的后续页，也能读取任意已授权历史Run在指定anchor的第一页。exact query仅：

- `watermark` required：opaque snapshot `event_watermark`，也是本次历史视图anchor；
- `cursor` optional：省略表示该path Run在anchor下的第一页；存在时必须是上一页opaque `next_cursor`，表示continuation；
- `limit` optional，默认100，范围1..100。

200 data字段全部required：`run_id,todos,activities,next_cursor,event_watermark`。`run_id`等于path Run，`event_watermark`逐页等于请求anchor；Todo和每activity值都按该anchor还原。每页≤limit，且序列化process response对象（Todo、activities、cursor等）≤1 MiB；达到任一界即给next_cursor，不截断单条。单条无法装入空页返回typed `503 process_page_item_too_large`，不返回空成功页。

cursor在wire只是不透明ID；不得含可见source seq/public sequence/digest/fence。服务在每次RR内验证tenant、subject、active session、run、anchor cursor、after-activity cursor与稳定keyset属于同一scope。malformed/unknown/foreign anchor或position为`400 invalid_process_cursor`；session/run不可授权按现404防枚举；anchor/position已被retention回收且有tombstone为`410 process_cursor_expired`并要求重取snapshot；ledger/compact/provenance损坏为`503 process_projection_unavailable`。不得从0、mutable latest Row或新snapshot静默续旧页。

### 一致性、权限与breaking策略

- 页从不可变safe CUSTOM ledger在`public_sequence <= anchor`取每activity最后revision；anchor之后的source不会污染旧页。compact row只核当前完整性与GC引用，不单独证明as-of。
- 每次page重新执行与snapshot相同tenant+subject+Conversation授权；project membership按现规则；public share不授process route。
- AG-UI replay仍以opaque Last-Event-ID strictly-after、1000 frames/1 MiB运行，和process page cursor不同；HTTP5不改变HITL resume/cancel幂等与Delivery identity。
- `7.0.0`是唯一后继public machine identity；删除public6过程旧形状，不留alias、双版本或fallback。canonical编辑点仅`contract/openapi/v1/openapi.yaml`；Agent bytes仅放commit命名vendor并由唯一generator产出client。

### 准入次序与当前事实

先行GREEN只更新Agent owner pin/vendor/generated、strict decoder和安全projector，使现四RED穿过真实reader；**不**在该片修改public7 YAML、SQL、snapshot或分页。之后先追加public/SQL/RR/分页/GC RED，再一次实现machine+route+SQL。完整文件集与§8比较见TECHNICAL_DESIGN。

Root独立RED现状：Node22 build exit0；四pure文件148 tests / 120 pass / 28行为fail / 0skip；既有106正控通过。失败证明当前HTTP4 wire、旧mapper和Skill fail-closed缺口，未证明任何HTTP5/public7能力已实现。本D0未运行测试或资源命令。

---

## R83-BFF-DIRECT：`GET /v1/sessions` direct filter / public6 D0（机器契约未修改）

当前唯一 canonical `contract/openapi/v1/openapi.yaml` 仍是已发布 public `5.0.0`，其 bytes/digest 本阶段冻结；当前 runtime 仍把 `scope=direct` 与 omitted/empty 合并，本节只记录 Root 已裁定的 public `6.0.0` 目标，不冒称实现、发布或消费者升级。该可见结果收窄不在 public5 原位换 digest、不提供 5/6 双读、alias、fallback 或兼容层，路径仍为唯一 `/v1`。

目标仅对 `GET /v1/sessions`：省略 `scope` 且无 project_ref 返回 admitted owner 的全部可见 active Conversation；`scope=` 同值；`scope=direct` 且无 project_ref 只返回 `project_ref IS NULL`；省略/空 scope 配非空 `project_ref=P` 只返回同 tenant/subject 的 P；显式 `scope=direct` 配任一非空 `project_ref` 在 Project lookup/repository read 前返回 400、稳定 code `invalid_scope`。重复 scope/project_ref、其他 scope、Project 404、IAM admission、limit/cursor错误继续沿现规则。

共享 `DirectScopeQuery` 当前也被 resource operations 引用；后继 canonical 必须给 `listSessions` operation-specific 机器语义，不能用全局描述暗示 detail/message/events/control/title/delete/share 也要求 `project_ref IS NULL`。所有 resource path 的 omitted/empty/direct 与 project_ref 授权行为保持 public5 现状；本片不新增 move/archive/delete-project 或 Project ACL。

响应 schema、status 200 envelope、排序 `updated_at DESC, conversation_id ASC`、limit 1..100 与 opaque cursor wire 均不变。cursor 不授予权限、不新增 filter digest/version；消费者改变 all/direct/project filter 时丢弃旧 cursor 并从首页读取，这是消费行为而非新 cursor protocol。静态集合验收无漏项/重复；跨页并发更新仍不承诺 snapshot。

后继 canonical 同片更新 OpenAPI info.version=`6.0.0`、listSessions 精确说明/参数、400 `invalid_scope` 可见性、contract README 与机器治理测试；生产与机器事实必须同 commit 验收。发布后 Web 才可复制新 canonical 并更新 exact BFF owner commit、version、SHA-256 pins；当前 Web `479d4e8`/`5.0.0` pin 不自动兼容。当前文件、canonical、generated 与消费者均未修改。

## R74：ScheduledTask create / public5 源码 GREEN 候选（未发布）

R75 当前更正：CreateScheduledTaskRequest.required 精确为 title、prompt、frequency、time、timezone；project_id、next_run_at、expires_at、auto_approve 仍optional。两个现 POST 继续引用这一个机器schema；requestBody.required 只约束body存在，不能代替属性presence。Root已确认原缺失是发布阻塞P1，批准同一未发布 public5.0.0 的机器事实规范化；不改其他值域/default、版本、路径、immutable baseArtifact4或生成输入。现EOF机器exact-set RED及production合法/逐项缺字段/空对象controls锁定本结论。Root修复前真实149pass、supported Node22完整offline全部exit0与native冻结0审已完成；日志 `/tmp/kokoro-bff-r75-root-supported-node22.log`。本次新hash的最终复验/提交/发布仍属Root，不声称public5已发布。

基线 main / d695fcbc0cd3f0376c34f64f6217d9d8e74c1b3c；Root 已复验 R73 纯 RED 83=51pass/32fail/0skip，以及 owned canonical fixture 上真实 HTTP+PG+Redis 53=14pass/39fail/0skip（含父/嵌套 failure，不是 39 个独立缺陷）。资源已由 Root 回收。本节覆盖下方 R73 的「版本待裁定/生产未修改」阶段描述；全部下方原正文保留，不作为当前完成证据。

Root 本轮明确批准唯一 canonical artifact 升 public5.0.0、保 /v1 namespace；这是本片限定 pre-release breaking，不延伸为兼容承诺。create 删除 enabled/status，保 PATCH；project_id optional string/minLength=1 且禁止边缘空白；未知 body/query（含重复）、非法 auto_approve 在 receipt/项目查询前 400；可见 ID/slug 或无项目成功，隐私404/身份403/冲突409/重放与撤权语义沿 R73。机器补 create 的既有 404，description 明示 no-query 和默认 active/enabled=true。

只修改当前 info.version 及其两条现测试期待；immutable baseArtifact4/vendor/生成输入/十项安全 failure tuple 保持。R71 旧 property 全集断言仅删 enabled/status 并改准确文案，其 closed/optional/nonnullable/独立/关联断言保持。contract/README.md 记录本次批准例外与正式发布后版本策略。

发布顺序锁定 BFF source/contract/三D0/tests 一致＋Root真实资源门→Root发布精确 public5 commit/digest→Web当前R74切片验收后独立repin/生成/回归。本阶段不改 Web 已固定 artifact，不伪造发布commit或消费者已升级。当前public5机器与源码候选已形成，纯契约222/222通过；未发布且资源验收仍待Root。

## R73：ScheduledTask create closed admission（当前目标，机器未修改）

基线 `main / d695fcbc0cd3f0376c34f64f6217d9d8e74c1b3c`，R71 已由 Root 发布。本节为 R73 ScheduledTask create 的唯一当前目标；下方全部旧正文逐字节保留，其 R71「待发布」和宽松输入描述仅是历史阶段，不覆盖本节。当前阶段仅 D0 + tests RED，生产实现、canonical contract、SQL、package/pin/generated 尚未修改。

唯一公开机器事实源仍为 `contract/openapi/v1/openapi.yaml`；本节记录 Root 已裁定目标，不复制第二可编辑 schema。仅 create operation，其他方法/PATCH/权限/路由与全站幂等保持。

- Body 只保留既有 title/prompt/frequency/time/timezone/next_run_at/expires_at/auto_approve，加 optional project_id；移除 create enabled/status，不接受它们的任何值。初始状态固定 active/enabled=true，PATCH 继续负责暂停/启用，不允许 create failed。
- project_id 可省略、非 nullable；提供时精确非空 string，禁非 string、数组、空串、纯空白、前后空白；保现可见 Project ID/slug，绝不 trim 后授权另一值。机器后继须以 minLength/type/pattern 明示相同边缘空白语义。
- Body 未声明字段、auto_approve 非 boolean 返回 400；项目关联不扩展为 conversation_id/session_id。tenant/subject 不从 body 接收。
- Root 明确 create 禁止所有 query 参数（含重复/空值/看似 project_id）；400 先于 receipt。这是本片明确新目标，不从 no-query OpenAPI 反推通用规则。
- 有效输入＋可见项目或无项目返回 200；其他 owner、缺失或另一 tenant 的项目返回同 `project_not_found` 404。调用者 tenant 本身未准入仍保持原 403。
- 保 required Idempotency-Key。相同合法请求在重启后重放原 200；同 key 改另一可见项目 409；撤权后原 body/key 404，禁止先返回旧 terminal receipt。拒绝输入/预检时不新增 task/outbox/receipt，不把 body 注入身份视为 authority。

当前 runtime 仍忽略 unknown keys/query、非 string project 静默无关联，schema 仍含 enabled/status 且 create 无 404；这些是 RED 基线而非已修复事实。后继 contract 同片删除两个 create 字段、添加引用边界与 404，原 PATCH contract/parser 不扩写。

### Breaking / consumer 前置门

本次删除已广告字段与收紧输入属于 breaking，不冒称 R71 additive 修复。现 contract/README.md 要求新 API 版本，历史 public4 /v1 corrective 是先前限定例外。Root 必须先裁定本片唯一版本/路径策略，才进入正式机器/源码 GREEN；本阶段不自行设新版本或并列双轨。R71 精确 property 集合断言仍原样保留；后继授权仅机械删其 enabled/status 期待，保其独立/关联/type/minLength/closed 保障。发布顺序为 BFF source/contract/tests/三 D0 一致并完整验收→Root 发布不可变 artifact→Web 独立 repin/正规生成/回归；现固定 Web blob 不改。

验证入口：本仓 `test/contract/openapi-contract.test.mjs` 的新增 R73 schema 断言与 `test/scheduled-input.test.ts` 纯输入；真实 HTTP/PG 的 `test/business-store.integration.mjs` 仅由 Root 在 owned fixture 执行。当前机器/源码未改，不宣称 D0+RED 即契约门通过。

## R71：CreateScheduledTaskRequest 可选 project_id（待发布）

基线 main / 3928043ec243eaec28af32c231a0bbf75a8b19ec。唯一机器事实源 `contract/openapi/v1/openapi.yaml` 的 `CreateScheduledTaskRequest.properties.project_id` 补为 `type: string, minLength: 1`；字段可省略、非 nullable，不加入 required。`additionalProperties: false`、全部既有字段、operation、版本边界保持；不添加 Conversation/session 关联。此为既有可选 Project 创建行为的契约对齐，不改变身份来源、权限或错误处理。

本片没有新增运行时 closed validation：现 production parser 的输入处理与 owner 校验保持原实现，不能据此宣称所有非法字段均在 HTTP 入口拒绝。Web 仍消费固定的旧 published blob；新 owner artifact 发布后再独立更新消费者，不读取此在途契约。下文历史正文完整保留。

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

| state    | pending_pauses          | 事实依据                                                                                                                                                            |
| -------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| queued   | 空数组                  | matching RUN_STARTED 尚未投影，pending/leased/retryable/admitted 差异私有，不是从 parser 失败推断空                                                                 |
| active   | 空数组                  | matching started 且从未出现有效 interaction 的连续源初始态；有 revision 后必须是 owner phase active/terminal 的明确空集合；terminal interaction 不是 Run terminal   |
| waiting  | 恰一条完整 PendingPause | 该 Run 当前 owner phase waiting，含全部 groups/items；新 pause/re-pause/validation_failed 均整体替换                                                                |
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

| HTTP    | stable code                                            | 含义                                                                         |
| ------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 400     | `invalid_retry_request`                                | body 不是精确 `{}`，或 path/query 不符合契约。                               |
| 400     | `idempotency_key_required` / `invalid_idempotency_key` | key 缺失，或 raw header 不是唯一合法值。                                     |
| 401/403 | 现 IAM session/service codes                           | online admission 失败；不读取 retry 事实。                                   |
| 404     | `session_not_found` / `message_not_found`              | Conversation/target 不存在或对当前 tenant/owner/project 不可见；跨权不区分。 |
| 409     | `idempotency_conflict`                                 | 同 key 已绑定不同 operation/target/digest。                                  |
| 409     | `retry_not_allowed`                                    | 新 key 的 target/profile/source/tail/run/HITL 状态不满足完整重试前置。       |
| 413     | `request_body_too_large`                               | 超过现 BFF mutation body 上限；不进入 Chat 事务。                            |
| 429     | 现 IAM rate-limit code                                 | online admission 限流，保留受控 `Retry-After`。                              |
| 503     | `agent_not_configured` / `business_store_unavailable`  | 依赖未配置或 BFF 业务存储不可用；无部分重试事实。                            |

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

| Method/path                                             | 输入与语义                                                                                     | 成功                                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `POST /v1/skill-installations`                          | strict body 只含原样 canonical `source_ref`；单个 Idempotency-Key；显式安装，不由 Publish 触发 | 200 owner receipt ACK                                                                 |
| `GET /v1/skill-installations`                           | optional `enabled`/`installed` 保留 presence；optional `limit`/`cursor` 不 trim                | 200 当前本人页                                                                        |
| `GET /v1/skill-installations/{installation_id}`         | canonical exact ID；无 body/query/idempotency key                                              | 200 当前本人表示                                                                      |
| `DELETE /v1/skill-installations/{installation_id}`      | canonical exact ID；单个 Idempotency-Key；不接 body                                            | 200 receipt；installation 为 `installed=false`、`enabled=false`、`removed_at` present |
| `PUT /v1/skill-installations/{installation_id}/enabled` | strict body 只含 required boolean `enabled`；单个 Idempotency-Key                              | 200 owner receipt ACK                                                                 |

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

## T-K03.4 Validate canonical identity 同 wire 闭集（2026-10-09）

`POST /v1/skills/{skill_id}/validate` 的 method、path、请求、状态和 response shape 不变。成功 `manifest_identity` 接受且只接受 `^(?:skill-md-v1|zip-v2):sha256:[a-f0-9]{64}$`：`skill-md-v1` 是当前根 `SKILL.md` canonical identity，`zip-v2` 仅为已正式声明的 legacy identity。两者都来自 Platform owner 结果，调用者不能提交。

不接受 trim、大小写变体、长度错误、额外前后缀、`zip-v1` 或未知 profile；非法 owner 200 仍映射既有 502 `skill_response_invalid`。IAM、tenant/subject、Idempotency-Key、command digest、attempt/CAS、预算/取消、unknown recovery及所有错误结构不变。AI import handoff 使用同一闭集，不建立另一种响应或 fallback；vendor/artifact 已含该事实，本片不 repin、不改 generated client。

<!-- T-K03.4-BFF-CANONICAL-IDENTITY-END; complete original body follows -->
## R357-BFF-BOUNDARY-AND-ORACLE D0：应用规则与 wire façade 边界（2026-10-09；wire 不变）

本切片不改变 public/browser-private/internal request、response、status、permission 或 operation。canonical public OpenAPI 保持 exact `12.0.0`，不以 regex 放宽。现 infrastructure 下的 `skill-specification.types.ts` 单源移动到 application，route source/context wire seam本身不变。Platform façade 只把固定 generated/Connect/HTTP owner wire 解码为 application 所需的单一 structural owner port窄事实；Skill specification application service继续拥有跨来源一致性、过滤、聚合和下载确认，route 的 `SkillSpecificationSource` 合同不变。

四个 mock oracle 只校正当前事实：quota/list 使用当前 closed envelope；Public12 docs coverage使用 canonical machine path/census并不恢复 `/v1/skills/pool`；deprecated compatibility 在 fresh admission 后验证未实现 operation fail-closed。MCP mutation 用例必须改名为 fresh-admission fail-closed，并断言无 owner I/O；它不证明 register/toggle/list/delete CRUD，GET能力仍由独立现有测试证明。不得以 IAM unavailable、旧路由、skip 或宽 schema 取绿。Billing 75ms默认并发波动保留对照证据，不改 timeout/error contract。

<!-- R357-BFF-BOUNDARY-AND-ORACLE-API-D0-END -->
## T-K03.4 `GET /v1/me` fresh profile extension (2026-10-09)

The existing public beta `getCurrentUser` operation and `identity.self.read` permission remain the sole current-identity endpoint. Its closed `data` object adds one required `profile` discriminated union; no top-level or profile unknown fields are accepted:

```text
profile =
  { status: "found", display_name: string, image_url: string | null }
| { status: "missing" }
```

`user_id`, `tenant_id` and `platform_admin` remain required and unchanged. The `found` values are the fresh IAM result for the single exact current `user_id` in the admitted tenant. An empty or null name is not synthesized; BFF preserves the owner string as contracted, and `image_url: null` means IAM has no image. `missing` is a legitimate 200 state and omits both `display_name` and `image_url`; clients display an explicit no-profile state rather than brand, email, id or initials presented as an owner name. Unknown status, fields or result identity are invalid owner responses, not forward-compatible fallback.

The operation still accepts no query, body, transfer encoding or idempotency key, and returns `Cache-Control: no-store` plus `x-request-id`. Existing admission failures retain their 401/403/429/503 meanings. After successful admission, any publisher-profile permission, dependency, timeout, cancellation, header/media/size/decode or strict-shape failure returns the existing 503 service-unavailable envelope and no identity payload. Such a 503 does not assert that the Product session is invalid; Web refresh preserves its last authenticated session and may retry or ask the user to sign in explicitly. Profile `missing` never maps to an error, while owner failure never maps to `missing` or a partial 200.

The machine source of truth will be the existing `contract/openapi/v1/openapi.yaml`: extend `CurrentUserIdentity.required`, add a closed `CurrentUserProfile` oneOf/discriminator shape, and retain the exact operation count/path/method/operationId. Contract checks must reject optional profile, nullable profile, extra fields, weakened union branches and undocumented success/error responses. Publication produces a new immutable BFF public contract version, commit and SHA-256 digest; Web updates only after that owner artifact is released, regenerates its client/schema, and verifies session GET plus refresh against the pinned digest. No compatibility alias or unknown-field fallback is published.

## R357 Admin IAM bridge contract boundary（已实施的首个 read slice）

该 slice 的唯一对外事实是上方三个 exact v1 operations。BFF 使用当前已固定并生成的 IAM Team client；每个 owner result 都经严格 wire decode 后转出，不接收调用方指定 tenant、owner method 或额外查询字段。BFF 不持久化、缓存或重排 IAM 的 membership、invitation、role 事实。

Audit、全局用户目录、用户生命周期、session revoke、角色 grant 与任何 mutation 不属于本 contract。新增它们前必须先发布相应 IAM owner operation，固定 vendor artifact、再生成 BFF client 和版本化 public schema；不得通过 internal URL、手写 wire type 或 generic relay 绕过 owner。

<!-- R357-ADMIN-IAM-BRIDGE-API-D0-END -->


## Connector command browser-private 恢复错误（2026-10-16，候选）

本片修正历史计划“接public OpenAPI”的表述：现/browser/v1/mcp/*、/browser/v1/connectors/custom-apis*不是public139 operations，Public14.8原字节保持。唯一code-first窄错误policy在src/infrastructure/clients/platform/connector-command-fault.ts，正规生成contract/connector-command-errors-v1.json；与local-import private policy一致，不新增外部operation或错误envelope。

只有Platform固定receipt metadata/code组合才能映射本仓恢复错误，RPC的unknown/expired/conflict/ownership-lost不表示未提交。无marker按原领域处理，畸形/未知/重复/错code/混合detail及read上的marker统一response_invalid/502。MCP三项既有PersonalMcpErrorDetail原因独立可辨，不能按message猜。具体HTTP code/status/retryable/recovery以本仓生成profile为准；成功/CAS/key/no-store/x-request-id/human准入不变。所有恢复指引都不授自动执行、新command或新key许可，未消费App前不声称UX闭环。

本片核实 needs_client/auth_method_unsupported 来自原生 OAuth 服务，故共享 typed 前置条件分类也承接 Begin/Reconnect/Complete/CreateConnection，而不限 Prepare。URL server 分支仍要求已有 typed detail；原生 OAuth 无 detail 的合法 CAS 前置失败保持 generic412，未知/混合 detail 则502。原生 OAuth 不添加 Idempotency-Key；只移动错误职责至窄 connector-command-fault 模块，删除旧 server-response 中的错误 export，不留 alias。

## 已合主线阶段记录（与上述当前模型配对状态区分）

## 2026-10-21 skill.list 项目并集修复（Public19.0.1 候选）

`GET /v1/skill.list` 无 `project_id` 时维持个人安装列表；提供时返回个人与已授权项目的并集。同一稳定 series ID 只返回一条，采用项目安装完整的精确来源表示（含名称、描述、归属/获取来源、作者及原版本时间），不按新旧/启用状态选取或逐字段合并。disabled 安装仍在列表，列表读取不改变执行资格。公开顺序保留个人安装原序，重叠项目项替换原位置，项目独有项按其 owner 顺序追加；并非最新修订排序或跨 owner 原子快照。

请求字段、响应形状、状态码、权限及 165 操作保持。当前仅 Product 人类准入，不能冒称 API Key/Open App/trusted 三身份已闭环。两范围分页/同一总预算与取消、项数上限、出口项目资格复核照旧，任一路失败不返回部分结果。唯一机器源补 GET description 与 patch version；旧 Public19 全文和双父历史证明保持，不新增兼容入口。


## Project resource item operations (2026-10-26, approved implementation candidate)

Existing collection GET/POST stay unchanged. New public beta operations are GET /v1/projects/{projectId}/resources/{asset_id} (getProjectResource), GET the same item /download (downloadProjectResource), and DELETE the item (deleteProjectResource). GET uses existing project.resource.read; DELETE uses existing project.update, implemented by fresh Product Session plus current private Project ownership, not a new IAM permission string. Metadata is a closed data.resource object with asset_id, filename, mime_type, size_bytes (decimal string), content_sha256 and scan_state=clean; no upload_id/URL/internal locator. The binary response is an attachment with validated length/MIME, safe filename, no-store/nosniff/no-referrer and x-request-id; it supports the existing verified spool bound of 1GiB, not a new 1MiB restriction.

DELETE accepts exactly one existing-format Idempotency-Key and an empty request with no query; it returns data={asset_id,deleted_at,replayed} only after validating the Storage logical-deletion receipt. It is irreversible project Asset deletion, not unlink or guaranteed physical object removal. A lost ACK resumes the identical scoped owner command; its original key can replay after the Asset is no longer visible. A different key on an absent Asset yields 404. No automatic new command or signed URL persistence is allowed. GET is idempotency=none; DELETE idempotency=required. All operations retain current public ErrorEnvelope/RequestMeta conventions.

400 malformed selector/query/framing/key; 401/403 current admission; 404 invisible Project/scoped Asset; 409 trusted owner conflict/digest mismatch (untrusted or in-progress conflict is not a confirmed rejection); 413 declared download above the existing spool capacity; 429 rate limit; 502 invalid owner response/reference/integrity; 503 dependency/deadline/unknown. Existing 300-second presigned URL validity is not an immediate-revocation promise. Metadata does not itself prove downloaded bytes. Actual browser preview formats remain a later consumer decision, never raw active HTML/SVG execution.
