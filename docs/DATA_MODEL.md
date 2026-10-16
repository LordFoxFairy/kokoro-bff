## SKILLS-UPDATE U3：无 BFF 数据模型变更（2026-10-16，本地源码已实现）

更新安装的唯一 writer 是 Platform。BFF 不新增表/列、余额/安装副本、command receipt 或可编辑包事实；canonical `database/schema.sql` 保持。可信 tenant/user 与 path installation ID、两个明确 pin 构成 command digest；相同用户/安装/operation/key 生成同 command ID，body 变化由 owner receipt 检测为冲突，不因换 pin 生成第二 command。

结果未知重试复用原 A→B/key，不能从当前回读 B 构造 B→B 或新 command；回读只供恢复展示。owner 在同一 Serializable transaction 保同安装行、installed_at 和事务 enabled，原子提交 pin/receipt/outbox；BFF 不用外部读写编排模拟原子性。已提交消息/Run 的版本引用不被安装更新改写。无 DB 安装、迁移或共享数据操作，本片集成测试采用受控 owner wire，正常产品写验收由后继显式旅程执行。

## CV-SVC MCP内部服务凭据边界（D1，2026-10-13；无数据库变化）

BFF 源码候选已切换两 MCP service surface 的直读凭据；无数据修改，正常运行配对验收仍待 Root。

本切片不新增/修改BFF或Platform Schema、业务row、receipt、outbox、Redis/cache事实。三用途的本地credential是私有部署配置，不是业务秘密持久化模块；每次有界重读当前完整版本1文件，严格caller/purpose/tenant绑定，各用途独立secret，不存机器token缓存。凭据文件/key内容与机器路径仅留本地ignored/私有区，不进源码、测试receipt、日志或文档。轮换只保证后续service准入，不能代替现用户撤权与Agent Run取消/租约边界，也不声明已在途请求瞬时撤回。canonical数据库原字节保持。

## T-K03.20 本人 MCP 可连接目标投影数据边界（BFF 已实施，待 Web 消费）

本切片不新增 BFF 表、SQL、Redis、receipt、缓存或 callback state。`connection_server_id` 是 Platform 在一次 Provider 读取中从自身 `mcp_server` 的唯一匹配结果推导的短暂投影；BFF 既不持久化、也不回填、缓存或跨 owner 查询该 ID。进程重启不影响 owner 的 Server/Connection 事实。

## T-K03.19 本人 MCP OAuth/Connection adapter 数据边界（BFF 已实施，待 Web/Agent 端到端验收）

本切片不修改 `database/schema.sql`，不创建 BFF SQL、Redis、receipt、缓存、callback state 或 credential 表。Platform 唯一拥有 authorization state hash、PKCE verifier、token 密文、credential rotation、connector/connection/CAS 与 command receipt；IAM 唯一拥有登录和当前权限。BFF 只在单请求 deadline 内传递受信 identity、校验闭集并投影 owner ACK；进程重启不会恢复 OAuth/Connection 业务事实。

<!-- T-K03.19-BFF-MCP-OAUTH-DATA-D0-END -->

## T-K03.19 D3 Provider 管理数据边界（2026-10-11；实施中）

BFF 不为 Provider 管理创建或读取任何数据库表、Redis key、receipt、审核副本或静态目录。`kokoro_platform.mcp_provider`、state version、soft delete、command receipt 与 provider catalog cache 仍完全由 Platform owner 管理。BFF 的 browser session 与当前 platform-admin 资格来自 IAM；client credential 只保存在受限本地文件并只产生短期内存 token。进程重启不恢复、构造或改变任何 Provider 事实。

<!-- BEGIN:T-K03.13-BFF-MCP-PERSONAL-CRUD-D0 -->
## T-K03.16 Connector V1 数据边界（已实施）

本片无 BFF SQL、迁移、Redis key、receipt 或缓存。Platform 继续唯一保存 Connector、Provider、授权、Connection 与状态版本；IAM 继续唯一保存登录/主体/权限。BFF 在一个请求 deadline 内读取当前主体的 Connector 与 Provider owner 投影，按 Connector 的 `provider_key` 关联，只输出已证明完整的 Manus V1 五字段。BFF 不保存关联结果、不在缺 Provider 时保留旧快照、不用 display name 或 category 推导安全/授权状态；服务重启不产生或恢复任何 Connector 数据。

<!-- T-K03.16-CONNECTOR-V1-DATA-D0-END -->

## T-K03.13 本人 MCP 管理公开边界 D0（目标，未实施）

Platform独占本人 connector/provider/connection/currentCAS，以及现有 durable command receipt/准入事务；IAM独占身份和资格。BFF无SQL/表/列/索引/receipt/Redis/store新增，不读owner数据库；fixed75/vendor/generated原字节保持。

原真实 state_version 以1..MAX_SAFE_INTEGER decimal字符串跨公开边界；optional metadata严格owner presence，缺省omit，不造空值/日期。status、enabled、approved_scopes与connection授权事实独立；创建connector可能pending，不合成已连接。Provider目录只正式事实，不复制静态推荐。

命令JCS指纹精确owner方法/当前tenant_id/subject_id/input，type正规enum数值、CAS原字符串，原body/key/CAS冻结。ownerreceipt负责replay、changedbody冲突和并发；BFF不再造receipt。取消/unknown/返回前准入失败不冒回滚，显式重试保原意图，GET当前事实不是原命令ACK。token只短期workload内存缓存，轮换/close仍原生命周期，不缓存人资格。14.0本地配对breaking例外及Web先验后Root runtime切换见API/contractREADME；其他137历史逆恢复、原active、SQL与全部任务外字节保护。
<!-- END:T-K03.13-BFF-MCP-PERSONAL-CRUD-D0 -->

<!-- BEGIN:T-K03.13-BFF-MCP-PERSONAL-READ-D0 -->
## T-K03.13 本人 MCP 四读数据边界（目标，2026-10-10）

当前 public13.3.0/137 已有四本人 GET，但 BFF guard 实际 503；目标沿 TECH/API 与 R320，只消费固定 Platform vendor `91bc3655ebd3648cb8f8ccddfacb5628bdeb1c5c` current75 的 ProductMcpPersonalService。Platform 仍是 connector/connection/provider 与资格事实 owner；IAM 拥有 session/action/workload 资格；BFF 只做严格本人安全投影，不访问 owner SQL，不加表、migration、receipt、Redis 或持久缓存。

列表/详情依正式 PersonalMcp schema/nullable 页尾投影与 ID/tenant/subject 绑定，不拿 active 六字段连接列表充当管理全状态，不把静态推荐当已连接。token 仅短期 tenant/credential identity 内存缓存，轮换/取消退役；每次请求当前准入与返回前复核，用户资格不由缓存替代。缺配置、正常 `mcp-personal` surface 未启用或资格失败闭合，不合成数据、安装、授权或 connection 成功。

这只是整体 CRUD 链首个读取切片；无新 public/owner wire、generated 或 SQL 变化。后继正常 workload/surface 激活由 Root 负责，完整本人命令/授权与后台管理仍待 owner 与消费者逐片准入，不恢复旧 Web/Admin 路径。
实现放置同步：`src/bootstrap/runtime.ts` 已纳入本片允许集，composition 创建/close 退役个人 client 与 token（含在途取消）；不采用原 R320 的 WeakMap/static client 生命周期，其他原文保留为历史。
<!-- END:T-K03.13-BFF-MCP-PERSONAL-READ-D0 -->

<!-- BEGIN:T-K03.14-BFF-SHARE-REVISION-D0 -->
## T-K03.14-BFF-SHARE-REVISION D0（目标，2026-10-10）

当前 BFF main `c9e8fab`，public13.2/136 operations；本片是目标设计，尚未改业务/机器/生成。Platform 正式 `91bc3655ebd3648cb8f8ccddfacb5628bdeb1c5c` 已发布 exact `ProductSkillReadService/GetSkillRevision`（skill-product-revision-read-v1/1.0.0，75/39/24）。现 SkillSpecification detail 仍由 series current 取得，不能供共享旧 revision 摘要；现 Resolve 六字段不含 metadata。

目标 public13.3.0/137 operations 新增受准 `GET /v1/skill-shares/{share_id}/skill`；原 Resolve 六字段、Create 禁 Idempotency-Key/无自动重试、DELETE creator 资格与 GetSkill current 语义不变。分享不授予资源权限，浏览器仍 Web同源→BFF→Platform/IAM，无 owner SQL/管理员替代入口。

无SQL/schema/表/列/索引/Redis/cache/receipt改变；BFF已有SkillRevisionShare记录仍唯一share事实（share_id/tenant/creator/sourceRef/resourceKind/URL/created/expiry/revoked）。新增只读组合不冻结metadata或权限、不写Share快照；源revision与IAM作者实时通过owner正式contract读取，不跨ownerSQL/JOIN/ORM、不复制姓名库。再次findActive解决本次远程投影期间撤销/过期，仍按读取时事实，不宣称跨owner原子事务。

Platform exact skill_id、series_id、decimal revision由同一真实record提供，不按MAX/current/安装pin猜元数据。source_kind真实闭集、creator引用/IAM found决定可见作者；cover只真实exactUID绑定。Web安装状态不来自此projection，不凭读ACK合成安装成功。正文仍Storage包UTF8 reader，HTML脚本/外部引用不执行。

contract vendor/provenance为build-time固定发行证据，不是业务持久化owner。new75与历史74父分别验证，历史V10 payload/aggregate原bytes保持，旧vendor同职责由正式91bc3655单pin替换。canonical database/schema.sql、全部owner数据与原share repository写行为保持；本D0只三设计前缀、原正文suffix字节不变，未执行SQL/生成/服务或工程验收。

<!-- END:T-K03.14-BFF-SHARE-REVISION-D0; original body follows -->

## T-K03.14-BFF-GITHUB-ADMISSION（目标，2026-10-10）

当前共享 AI/GitHub handoff 在 admitted 后重放 Create 获取初始 CAS，实际 owner 返回当前版本导致 Begin412。目标仅修现 BFF 私有 receipt：frozen→created（真实 Create ACK 的 skillId/initialStateVersion 已持久）→admitted（同创建身份、初始CAS及真实 Begin attempt/upload/epoch/stateVersion）→selected（真实 PUT版本与原 Complete 意图）→completed（真实 Complete ACK stateVersion）→terminal。created 持久成功/精确读回后才 Begin；Begin 和获取 transfer 均使用原 key/body/初始CAS，PUT 不再 Create。Create ACK 丢失且尚未 Begin时只同键重放；created/admitted checkpoint ACK 丢失通过精确 readback 或保留原阶段恢复，不推算版本或替换意图。

completed 持久成功/精确读回后才 Validate；Validate提交后ACK丢失或terminal CAS失败，从completed同原Validate key/body/冻结Complete CAS恢复，不重复Complete、不读最新CAS替代。

非terminal checkpoint严格携带私有proofVersion:2，旧200无版本（包括旧frozen）零owner写入并失败闭合，避免重放当前CAS伪造初始proof；terminal201保持原样。阶段成员、frozen/fingerprint及 owner 身份严格绑定；旧缺创建proof的 admitted/selected receipt保持原数据并失败闭合，terminal201原结果可重放，不宣称旧 intent已恢复。取消/claim/CAS败者及未知ACK语义保持，AI与GitHub共享调用均测试。无新增 public字段/API/contract、SQL/schema、依赖或 owner权限变更；现两源码、两测试实施后工程门与真实链仍待 Root 验收。

## T-K03.14-BFF-GITHUB-PATH-CONTRACT D0（2026-10-10；仅文档，待机器切片）

当前13.1机器path2048与现parser256漂移，目标13.2仅纠正五处GitHub输入/Preview输出声明；无新增持久事实、SQL/schema/ORM/Redis/receipt变更，不访问Platform或其他owner数据库。BFF现handoff仍冻结真实commit/path和包digest，后继Publish/Install与owner事务不变。

既有历史GitHub provenance读取path2048保留；数据库存储上限不是当前GitHub导入API支持证据。archive UTF8 relative文件路径≤256 bytes含文件名仍原样执行，机器字符约束不替代该安全预算。manifest历史pattern保持独立未决项，不迁移/回填或清理数据。四文档仅新增当前前缀，下文历史原字节保留；后继contract/checker/tests必须显式inverse恢复固定13.1父字节并核canonical schema、外部owner artifact保护hash，无生产旧协议fallback。当前未执行数据或工程门。

## T-K03.14-BFF-ADMIN-PACKAGE D0（2026-10-10，待实现）

本片无任何SQL/schema/Redis namespace变化，不新增或复制Platform/Storage事实。包阶段、CAS和对象版本继续由现owner事务维护；BFF准入只决定服务路由可达性，不读跨owner数据库、不清旧数据。新Admin version ownerScope仍当前subject，另一管理员不因平台管理身份获得上传权限。

## T-K03.14-BFF-CAS D0：Public13 无新增持久事实（2026-10-10；仅设计）

当前 public 12.0.0 → 目标13.0.0（URL仍/v1）仅收紧 Begin/Complete/Validate mandatory expected_state_version。Platform 仍独占 Skill product.state_version、package attempt、receipt、锁内 CAS、publication及事件；Storage 仍独占 Upload/Asset/ObjectVersion/scan。BFF不新增表、列、索引、canonical schema、migration、SQL、Redis key/namespace、持久化 receipt/outbox、CAS cache或owner镜像；不读取任何 owner DB，也不以跨库预读冒充 owner 同事务。

Create/Version ACK、package GET、Begin/Complete/Validate/Publish ACK的真实state_version仅作为当次请求及浏览器冻结意图的版本证据。PUT真实x-amz-version-id仅作为Complete source_version_id；Skill revision/attempt_epoch/upload_id/content hash都不是CAS或对象版本。metadata/封面/Withdraw/Admin现有required CAS与record product.state_version保持。普通CreateVersion创建独立draft、不修改base，因此不建立对base的CAS请求。

first send与same-key恢复绑定原key/body/CAS/digest/身份与资源；不由BFF durable cache代替Platform receipt，GET较新版本不改写旧command。未知ACK/取消/期限/迟到允许owner已提交，保原意图恢复；新的用户操作显式重新观察且owner在锁内比较版本。浏览器必要恢复状态服从既有session/subject-generation/非敏感intent边界，不保存bearer、machine凭据、原始bytes或签名URL为长期事实；本BFF设计不授Web存储实现。

正常Web3c59071与release c9b02b6分叉，不迁移数据、不回填猜测版本、不整体复制release或其替代Admin。原Admin是唯一后台基座，后继接正式contract与IAM publisher资格；非空读取/真实CRUD仍需当前网络验收。当前保留Root真实draft、原幂等键及正常服务，不删除失败事实、不清库或新建基础设施。

本阶段仅现三设计，不执行schema/数据/服务/Git/测试命令。后继schema byte-diff与schema:check证明零数据变化；missing/stale/correct/replay/unknownACK及真实owner事务回归证明并发与恢复，纯contract或文档不替代该证据。

<!-- T-K03.14-BFF-CAS-DATA-D0-END; historical body retained -->

## T-K03.14-BFF-PIN 当前 Platform 固定发行（2026-10-10；待 Root 验收）

当前 Connect/HTTP 消费输入唯一固定 Platform `32666c1c18360e707048a1104efe6b50e375002f`；物理 owner 为 `apps/kokoro-capability`。从该正式 Git 对象逐项核对，87 项必要 publication 与原 `84262b...` 字节完全一致，Proto/descriptor、HTTP 5.3.0、execution V5–V10、historical qualification 及所有 artifact 摘要不变；active/routable V10 aggregate 仍为 `dddb0d194af44dbf0b83a0a0443d774f3dee63f8cb03c364ad529c4c230fb85b`。当前说明覆盖下文历史 pin，不改历史验收事实。

本切片无 SQL/schema、事务、receipt、缓存、Redis namespace 或数据变化；Platform/Storage 保持唯一事实 writer。固定发行与机器生成不产生 BFF 持久化事实。

<!-- T-K03.14-BFF-PIN-CURRENT-END; historical body retained -->

## R357-BFF-ADMIN-INGRESS-D0：Admin Identity read 无持久化变化（已实施）

本片不新增或修改 SQL、表、索引、Redis key、session、receipt、授权缓存或审计镜像。Admin Web 的 session/state/PKCE/refresh 仍由独立 Admin Web 拥有；IAM 继续唯一拥有 OAuth client、user session、tenant、platform-admin、membership、invitation 与 role。BFF 只在请求期校验闭合 service credential，执行 fresh human admission，并投影当前已准入 tenant 的三项 IAM read；不得把成功 admission 或 owner response 持久化为用户或管理员资格。

Admin service secret 是进程配置，不进入数据库、contract、日志、响应或浏览器。它必须与 User Web shared secret 明确不同且无默认回退；未配置时 Admin入口安全关闭，同时 User Web 原路径与数据生命周期保持。canonical schema及其 hash 不变。

<!-- R357-BFF-ADMIN-INGRESS-DATA-D0-END -->

## T-K03.4 精确 Skill 下载数据边界（源码候选，无持久化变化）

BFF不复制Platform的Skill revision、installation、package、scan或transfer事实。installation exact selector来自当次Platform Get；managed version exact selector来自当次managed owner读取；share selector来自现有`bff_share`的`tenant_id/creator_subject_id/source_ref/revoked_at/expires_at`，但本片不加列、索引、表或新share类型。Platform现exact-source download RPC是唯一package/transfer owner读取；BFF不查owner SQL、不用series current或MAX(revision)重建旧版本。

三个候选prepare POST不产生receipt、outbox、审计镜像、URL缓存或授权缓存。唯一短暂状态继续是现进程内`SkillDownloadHandles`，后继binding使用closed qualifier：`catalog_current+series_id`、`installation+installation_id`、`managed+version_id`或`share+share_id`，并共同绑定tenant/subject、exact source_ref/revision、filename/size/hash/expiry/transfer；各ID不得混入通用skillId。这不是新canonical事实；过期、容量淘汰或重启即丢失，不能从handle反建record。重复prepare重新读取owner并可在完整exact binding相同的现规则下复用句柄，但不延长TTL或跳过资格。

零payload POST的空stream读取只存在于请求内存与同一绝对预算，不落“已读body”状态、receipt或恢复事实。`Content-Length:0`不代表可跳过实际EOF确认；非null零字节stream也不被误判有payload。abort/deadline first-winner后不等待底层cancel完成，迟到字节/EOF/owner结果不得创建handle。

同series的installation旧pin与publication新current是两个不同事实：前者保持installation source/revision，后者继续由参考DownloadSkill读取publication current。不得自动升级installation、把current写回handle、或在旧version不可见时fallback。share撤销/到期、installation移除、managed version不可见及身份变化都使prepare和既有handle再确认失败；已取到的内部transfer引用不覆盖该终态。

canonical SQL、Redis namespace、public contract/generated、Platform artifact与正常数据均不变。本源码候选没有执行schema、正常数据、服务或正常句柄写入。

<!-- R357-BFF-EXACT-SKILL-DOWNLOAD-DATA-D0-END -->

## T-K03.4 本地 Skill import BFF 数据边界（仅设计，无持久化）

BFF 不拥有 `SkillImportIntent`、Upload、scan、Skill、publication、installation 或 command receipt；这些事实分别由 Platform/Storage 拥有。BFF 不新增 SQL表、Redis key、URL缓存、恢复队列、idempotency receipt、Storage proof镜像或授权快照。四个 browser-private 请求只在单次内存预算内携带 strict wire 值并投影 owner结果。

24小时 intent、phase、预分配 skill ID、immutable upload proof和terminal结果均只从 Platform Get/command receipt取得；900秒 PUT URL及headers不落盘。same-key replay前重新做 current session及`create_draft AND install`，receipt不成为权限缓存。只有未到期 `upload_pending` intent 且 Storage upload 仍 pending 可由原 Begin 重签同一 upload；`uploaded`、`completed`、`rejected` 或 expired 后的旧 Begin 只接 owner phase/precondition 错误并由 Get 恢复，不产生新 upload/reference。Finalize completed 的原 key 由 owner receipt 至少 30 天精确重放，BFF不复制该事实。Web已有 PUT响应 `x-amz-version-id` 是 Complete 的 `source_version_id` 来源；BFF不读取Storage、不猜值。

public OpenAPI、数据库schema、现有BFF receipt/outbox、GitHub/AI Draft事实及Admin Publish事实全不变。后继本地文件UI停止建立假Draft，但不清理或迁移既有Draft、Asset、installation，也不删除合法失败历史。当前候选的正式 owner A6 pin/generation与隔离 typed seam 不改变本数据边界；owner inactive 阶段生产不注入 client、不产生 intent 或任何 BFF 持久事实。无schema/数据命令。

<!-- T-K03.4-BROWSER-PRIVATE-LOCAL-IMPORT-DATA-END -->

## T-K03.3 短期句柄回收（候选，无新存储）

原128容量/60秒上限不扩大；进程内到期回收、完整exact绑定复用、最老淘汰，不新库/队列/持久权限或数据镜像。被淘汰句柄永不复绑定；有效新句柄仍前后当前IAM/owner资格与实际SHA/size校验。

<!-- T-K03.3-DOWNLOAD-CORRECTION-END; complete previous body follows -->

## T-K03.3 后继读取无新增存储（源码候选，待Root验证）

本片不改SQL/表/schema/Project旧skill_name关联；只用ProjectService.find原当前owner授权与Platform project target exact安装。
原安装skillId/revision/enabled/Asset/digest不变；创建时间/owner来自绑定exact Skill，经正规Proto读取，不保存镜像。shuffle seed/cursor由owner管理，不在BFF持久化排名/游标/权限快照。
原短期下载handle绑定tenant/subject/stable/exact版本及事实，仍前后当前资格与全SHA/size；正常资源与浏览器验证仅Root。

<!-- T-K03.3-SUCCESSOR-END; complete previous body follows -->

## T-K03.2 Skills 全表示的数据边界（2026-10-09；设计目标，无新增存储）

基线 adcdac3；现 database/schema.sql不变。本片无新表/列/索引/Schema/迁移/Role，不建立Skills镜像或跨owner SQL；新面向页面字段由唯一owner正式事实提供，三设计与整片机器发行同步。
Platform保原Skill、series/revision、包ref、安装、状态/CAS/receipt；IAM保creator/publisher身份和当前权限，Storage保Asset/Blob/版本/scan，Agent保真实Run/source事件。BFF仅原Project关联、typed Share、durable usage与自身receipt，不重复持有owner canonical字段。
Root B明确原seriesId→稳定skillId，现Skill.id→versionUid；owner显式current发布引用而非MAX(revision)/latest。安装精确旧version引用保持；普通skillId读/download选显式current，本人安装视图按原installation绑定。缺新owner字段/selector/授权支持或未发行正式artifact就失败，不假pin/HEAD补齐；原ID/版本/安装/37Asset保，不自动重装/升级或伪造sourceVersion。
公开created_at/updated_at按真实owner instant转Unix秒int64，网站UTC字符串分别保存Skill/currentVersion/source/加入等既有含义；不得把Skill更新时间充当创建/版本/源commit时间。JSON数值int64与字符串大数分别按契约校验，不能统一Number()降精度。
creator_info使用creator IAM ref/name，publisher资料沿真实publisher ref；作者缺失/权限失败按正式接口规则处理，不填publisher冒creator、默认官方账号或假verified。defaultEnable/defaultAdd/sortOrder/visibility/type等无事实者列owner缺口，不用当前enabled/audience推导冒同字段。
Hub archiveSize/checksum/fileCount必须对应同一实际currentVersion包；tags.values/tagOptions来源由owner当前规范给出，不拿旧category_keys任意分类或预置标签当响应；current与license/sync/source观察不在BFF发明持久真源。
现usage projection保持distinct successful Run/重复与乱序/冲突处理及coverage；只有经批准等价的统计口径才能发usageCount。无证明仍是明确缺口，不返回虚构零，不新建统计表或从当前页面条数计算。
Share仍使用现bff_share事实和撤销/到期，链接不替当前tenant主体/exactrevision授权。文件树/正文与安装package直接消费正式owner，不缓存为BFF Skill镜像；读列表包括停用项且零启用写。
downloadInfo是请求期metadata；downloadUrl指向browser-private GET /skill-downloads/{handle}（Web/api），非Manus公开接口。小TTL/容量有界内存句柄固定tenant/subject、exact versionUid/owner包句柄、原下载资格、真实filename与expiry，TTL不超ownerexpiry；无新持久库/表/密钥/框架，重启丢句柄410后重取metadata，不恢复为最新。
每次字节请求当前H准入及ownerexact资格/scan、IO后重验；到期410、撤权403或安全404，句柄缺失同410，scan/依赖稳定失败；不保存/返回signed内部URL、cookie/token，不按handle拥有者免鉴权，不从unknown/HEAD/current read追认版本。
创建/上传/cover/import/publish/version/withdraw/Admin沿现幂等receipt、固定规范化输入与digest/CAS；只替wire表示，原command事务/unknown重放和final locator事实保留。一般新version不修改base，Withdraw/Admin真实写仍核实际CAS。
BFF对自己的AI artifact/event关联与usage/share事实继续本仓查询，跨owner仅固定contract读取；request projection/IAM姓名不扩为新持久化owner。非Skills/Team/AGUI/现Schema与其它资源不在切片内。
验证：三完整父suffix SHA必须等卡，canonical Schema byte保持；后继pure contract/类型/负控与Root真实PG/Redis/Storage配对分别记录。数据修复/正常资源升级与完整普通/Admin浏览器由Root另核，不因文档门通过冒已实施。

<!-- T-K03.2-BFF-DATA-MODEL-END; complete original body follows -->

## R357-H1 当前人类 MCP 准入（2026-10-09）

本切片归 BFF auth 与既有 MCP projection；IAM 唯一拥有身份/成员权限。只消费正式 IAM 55befe5092f96d617088549df3166e1d381e6b1c / 0.11.0 / SHA47011671cf2c3631c5ff914db4b40a8a9f9cdecc9b2b6fcd13a359a45b0882d3。
既有 bounded session transport 承接 /internal/v1/authorization/check；两个普通 auth 文件分别定义类型与 HTTP 编排，不新建模块/框架、不复制 Skills 预算。mcp_personal read/manage 必须是当前人类 current_membership，匹配已验证 tenant/subject；workload client_scope 不授浏览器管理权。
普通 session → MCP action checker → 已有两 projection 共用入口起始的 monotonic 10s 预算与取消；false=403，invalid=401，rate=429，依赖/身份/协议错配=503。no-store、closed envelope、request-id 严格校验，取消/到期后的迟到响应不得成功。
现四个 self MCP GET 尚无正式 owner adapter，授权后仍503；未实现非GET仍503且无 owner 副作用。不得消费 Platform 候选 wire，真实目录/详情/CRUD/授权/执行/admin、正常scope与登录激活仍OPEN。
旧15个 IAM generated operations / Team / Skills 协议保留；唯一 vendor 正规替换及生成，不并存旧pin。生产无mock，显式测试 composition seam 只用于隔离行为验证。

<!-- R357-MCP-H1-END; original suffix retained -->

DATA_MODEL：本片无SQL/表/Schema/持久化事实，MCP request deadline只用请求生命周期WeakMap；IAM决定不缓存。

## R353-B2 当前源码候选（2026-10-08；待Root冻源审查/真实配对）

唯一 BFF writer 为 bff_skills_product_source_r353；工作树 HEAD d2695c47bca64a8e83168aa259e2366f7cee3ea8。当前唯一 Platform固定fa185ed2b25c3e81946cfdcd12d7665d02b8bad3、Product1.2/HTTP5.2/63RPC/32commands/24proofs、完整81正式publication；aggregate ce7708d7e2a15d7e3a77b7b9ea45905ab3fbe90093e343d0be9b3140ca03e2d6、descriptor 453f275b6e95052437072c3f52bbe74675271400526680003569b6bd09196fb1、HTTP 6d4abae68cd5cc6e2d8676ac34a48f7ea3564196ec6215ea1531b3cfedd3c3d7。HTTP直接读同Platform vendor/openapi；原701候选72副本移除，无双pin。IAM7c62e759760448e127b21200f87adeefdc6016f7/0.10、Storage d13f33a/v3继续原正规固定生成；不升级其它owner。

Public唯一9.0.0/132operations，具名Product checker先核完整当前closed blocks，再剥本片还原完整Public8.10字节SHA640f47f9c70341aa49934eec319a4dcc5bab76bba83e4407d6a9e0c3ab0ac389并运行全部旧父证明。机器/纯门只证明本源码；正常Storage旧源版本资格、真实IAM/Platform/Storage/Agent配对、provider、普通/管理员浏览器与S01–S10由Root继续验证，仍OPEN。未运行数据库/资源/服务/正常激活，不以fixture为integration或UI完成。

### 自有事实与事务

本片不创建Skill镜像、owner数据库连接、table、journal或evolution；B1已正式typed bff_share/usage projection沿原repository/AGUIsource事务，Platform/IAM/Storage/Agent事实只RPC/HTTP读取。旧conversationShare读取不返Skill；SkillShare每次fresh exactrevision授权，链接本身不授匿名/跨tenant资格。usage completed distinctrun、乱序/重复/digest冲突/覆盖proof遵循既有B1，缺proof unavailable。

现bff_idempotency_receipt复用完整fingerprint/status/bodyJSONB expected→replacement单行CAS；keep-first冻结输入、admitted实际attempt/upload/epoch/CAS、selected原样opaqueVersion/Completecommand/digest，201实际结果。ACK未知精确读回，不从owner拼造checkpoint、不重复PUT、不引入泛workflow层。已有个人/项目上传v3只在正式ownercompleted时读旧receipt，不fallback生成v2。AI重读自身bff_conversation_artifact及completed来源event关联，不跨ownerSQL；Storage包全SHA/size与IO后关联资格。GitHubmetadata从真实固定SHA/path包导出，repo_stats观察keep-first、与immutable业务fingerprint分离；preview没有持久新表/阶段。

Cover/目录/IAMpublisher当次投影不缓存持久事实。Projectassociation写前freshPlatform inspect，但准入→本地写间存在跨owner竞态，不宣分布事务；existinguse-time资格继续验证。正常旧30包/blob/Skill引用的source-version资格缺口由Rootread-only审计与最小资格裁决，本writer不DDL/repair/rebind/activate。

安装source_kind是既定field5消费，BFF透传及closedvalidation已实现，owner当前正式P4已修typed/raw/RPC filter与query游标绑定；BFF安装/owned查询按同Unicode标量/trim/closedpresence规则透传，筛选在owner分页前执行；不在BFF复制owner查询事实/新table。GitHub解析依赖仅js-yaml4.3.2与types4.0.9必要锁定hunk，旧开发Redocly传递4.2图保持。真实隔离PG测试test/skill-product.integration.mjs仅Root在显式isolatedURL+flag运行，未执行不宣integration通过。

P4仅既有installed与owned列表可选query消费，Public9.0/132不另发版本，不新增方法/Schema/依赖。原52e副本76删净，仅fa185ed正式81机器；新增query6从独立parent完整逆向剥离后保所有历史父SHA，生成物只正规生成。P1/P2已含source I/O后required当前session同tenant/subject重验及owner坏响应502；原浏览器input400保持。仍非正常激活/配对/页面或S01–S10完成。

<!-- R353-B2-CURRENT-PREFIX-END; immutable historical baseline follows -->

## R353-BFF-D0：Skills Share、Usage 与 owner 数据边界（目标，尚未实现）

Platform 继续唯一保存 Skill revision/series/source/creator/audience/draft/admin/package/cover 与 update；IAM 保存身份、publisher display 和权限；Storage 保存 Blob/Asset/scan；Agent 保存 Run 与 source event。BFF 不镜像这些 owner 表，只新增自己的 typed Share 与 durable usage projection。AI/GitHub bytes 进入现 draft/package owner 流程，不形成第三份 Skill metadata。

### Native BFF SQL 扩展

`bff_share` 增 closed `resource_kind = conversation | skill_revision`，`conversation_id` 改 nullable，新增 nullable bounded `skill_source_ref` 与 Skill link `creator_subject_id`；CHECK 要求两种 target exactly-one。旧行原地保持为 conversation，不重写 URL/expiry/revoke。保旧 conversation active partial unique/index；新增 partial unique `(tenant_id,creator_subject_id,skill_source_ref) WHERE revoked_at IS NULL` 与 active resolve 索引。expiry 不进入动态索引谓词；创建事务先锁同键，把已到期未撤行标记 revoked，再插入，重放返回同一未到期 active。create/resolve 请求前必须 fresh Platform read；revoke 只要求当前 IAM 登录同 tenant，并在同事务满足 `creator_subject_id` 谓词，因此 source 已 withdraw/quarantine 后创建者仍可撤自己的 link。

Usage 最小三事实：`bff_skill_usage_run_terminal` 以 `(tenant_id,run_id)` 为主键，保存 session、closed terminal status、source owner/event id/sequence/digest/occurred_at；`bff_skill_usage_observation` 以 `(tenant_id,run_id,source_ref)` 为主键，保存 trusted ready source identity 与 nullable `counted_at`；`bff_skill_usage_coverage` 以 tenant 为键，保存 closed `unavailable|complete`、可信 checkpoint/proof identity 和时间。terminal-first 先写 terminal，后到 ready 查同 run；ready-first 后到 completed 批量闭合该 run。只有 completed 写 `counted_at`，failed/cancelled 永不计数。

三元主键、source event 唯一身份与 digest 漂移检查保证重复/乱序不双计；同一 AG-UI source ingestion 数据库事务同时插 source fact 与 usage 变化，失败整体回滚。`(tenant_id,source_ref)` 的 counted partial index支持单次 bounded source 集合聚合。usage/terminal/coverage retention 独立于 `bff_agui_event` frame GC；删除 conversation/frame 不删除计数证明。无可信全历史 backfill/checkpoint 的既有 tenant 保持 unavailable；不得由 `started_at`、session high-watermark 或 count(*)=0 升级 complete。

Share URL 不是 Platform 权限事实，creator id 只是撤销/审计键；每次 resolve 仍由当前 subject 对 exact revision fresh check。withdraw/quarantine 不跨 owner 写 BFF 行，读取失败即失效。Package/cover、publisher profile、draft/admin和 `available_update` 均只作当次严格投影，不落 BFF 缓存或复制表；owner 缺失/坏值失败关闭。

### Expand、rollback 与验证

后继 expand 只在 BFF canonical `database/schema.sql` 增列/约束/索引和 usage 三表：短事务、固定 schema/search_path、shadow 拒绝、advisory lock、existing table/constraint/index exact 校验、statement/lock timeout、提交前 cancel fence、COMMIT unknown 不猜成功。先 nullable/backfill旧 share kind/加 CHECK，再收敛目标约束；rollback 只有确认无 Skill rows/usage rows且旧 conversation facts完整时才可删增量，禁止丢新事实以强退。

集成验证必须覆盖旧 conversation bytes/匿名读取不变、两 target/零 target 拒绝、active/expired/revoke并发、跨 tenant/creator、Platform 撤回后 read fail；ready/terminal 两种顺序、重复与 digest 冲突、failed/cancelled、事务回滚、frame GC、coverage unavailable/complete 与单查询聚合。不得访问 owner SQL、重置共享 PG/Redis或以 mock 计数冒历史覆盖。

### R353-B1 implementation boundary

The canonical target now contains the typed Share discriminator and the three usage fact tables described above. Runtime ingestion may only preserve `unavailable`; `complete` remains a schema-supported, tested state for a future trusted checkpoint producer and has no normal promotion path in B1. The named expand command is the only legacy transition; normal startup does not mutate schema.

<!-- R353-BFF-D0-SKILLS-DATA-END -->

## R350-B2：Skill 示例消费数据边界

`example_prompts` 是 Platform Skills revision 的非 nullable、有序 string-array 事实；BFF 不拥有、不持久化、不补全。CreateDraft/CreateVersion 只把 public optional presence 传入 owner：absence 继续 canonical 省键，present `[]` 表示显式空数组；CreateVersion absence 不从 base revision 继承。四类读响应只投影 owner 返回的精确 revision 数组，并保留原文、顺序和重复。

本片对 `database/schema.sql`、PostgreSQL/Redis、repository、receipt、outbox、cache、幂等键、tenant 与权限事实均零变化。安装响应的 examples 必须来自当前精确来源 revision 的 tag15 message；成功、replay、list 与 detail 均使用该值，缺失或非法失败关闭，不从 metadata JSON、summary、安装时间或前端状态恢复。

作者、usage、封面、正式 taxonomy 与固定三例仍无事实来源，不在本片新增。Platform 持久化实现与固定 `94bd0ea…` 机器匹配后才允许配对激活；此前这里只是消费者实现，不是正常数据或 UI 验收。

<!-- R350-B2-SKILL-EXAMPLE-PROMPTS-END -->

## R345-B-D0：Skill 更新时间消费数据边界（已定设计，尚未实现）

本片不新增 BFF 持久化事实。唯一 owner 仍是 Platform Skills 的精确 `Skill.updatedAt`；Platform D0 commit `dcc2102e41a677b52367f2cc1a18b6283bbda2e6` 已裁决来源关系，但正式 3.4.0 machine/runtime commit 与 digest 尚待 owner 冻结。BFF 基线 `411e6906f651087dbbd8ff8afd96d53e38b352c0` 仍运行 public 8.8.0/111；目标 public 8.9.0 仍保持111 operations且仅增四处required展示字段，本节不把目标写成当前已上线事实。

### 唯一事实与关系语义

- catalog/pool/list、本人 managed 与本人 published 直接消费 Platform 所投影当前精确 Skill 行的 `skill_updated_at`，不由 BFF 重新查询或计算。
- 安装投影的 `skill_updated_at` 必须来自已经 tenant、skill id、series id、revision 关系校验的精确来源 Skill；不得取系列最新版、安装者时间、receipt时间或 BFF 当前时间。
- Proto tag7 `installed_at`、tag8 `updated_at` 和新 tag14 `skill_updated_at` 是三个独立 instant：tag8继续只表示安装记录启停/移除等变化，不改字段号、排序约束或重放身份。BFF mapper只做严格 Timestamp→UTC `Z` 编码，不比较Skill时间与安装时间。
- Platform receipt replay/写 ACK 以当前精确来源安全 metadata 覆盖 Skill 时间的 owner 语义由 Platform 保持；BFF 不把该展示时间加入 idempotency digest、receipt、事件或本地状态。

### 零持久化变化

`database/schema.sql`、PostgreSQL表/列/index/transaction、Redis namespace、cache、receipt、outbox、幂等键、权限decision与租户模型全部零变化。BFF 不保存 `skill_updated_at`，不读 Platform 数据库，不创建 presentation/metadata 表，不缓存正文或 owner projection；字段仅存在于当次固定 owner response、严格内存映射与 public response。缺失/非法/额外 owner 数据失败关闭，不能从 `installed_at`、`updated_at`、文件时间、前端状态或默认值恢复。

后继文件仅为正式 vendored owner artifact及其 dependency manifest/generator/generated输出、`projection-http.ts`、`personal-installation-response.ts`、public OpenAPI/具名 checker和现有contract/mapper测试；无需 SQL migration、Prisma、repository、service state、配置或数据回填。真实PG数据无需更新，因为事实列已由 Platform 持有；Root只在配对版本ready后恢复入口，并由Web读取真实响应验收。

作者/publisher、example prompts、真实封面、usage与固定“全部/个人/官方/第三方”分类仍没有本片批准的BFF事实。`tags` 是来源自由标签并保留真实内容/顺序，不能改造成固定分类；`R255` 等现验收资源是实际数据，不自动改名、删除或以占位数据替换。

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

## R340 Skills 包正文消费的数据与生命周期边界（2026-10-08；目标，尚未实施）

本仓基线c91fee642c5bac79d5beab90b15a1eaf97637047/public8.7.0/109/Connect e83a2ad43，当前无正文public route；目标完整固定Platform1f6f764当前45/20/24、后继public8.8/111。本轮只三个现D0前缀，原全文suffix保留，未改canonical SQL/机器/source/正常配置。精确API/错误/1MiB规则见API R340，文件放置/52固定输入/三双父/阶段授权见TECH R340。

### 唯一事实与零新增持久化

Platform继续唯一拥有Skill/series/revision/status、本人安装removed/enabled、validated package绑定与目录正文资格；Storage唯一Blob/Asset/CLEAN及bytes；IAM唯一current Session与机器资格。BFF只保当次已准入identity、typed请求/响应和安全公开表示，不新增表、列、索引、migration、FK、package镜像、receipt/outbox、Redis业务key、正文/目录cache或权限decision cache；database/schema.sql完整零diff。不访问owner SQL/Redis/ORM，不保存资产或下载凭据，不让Web成为owner事实源。

两GET无command/digest/idempotency key。重复调用各自当前admission与对应本人inspection，不从已安装列表或catalog personal/installed标记推导授权，不把absence当已证无资格，不自动安装或猜installation ID。本人来源直接精确skill ID；本人安装直接已知精确installation ID，来源/ref/revision由Platform绑定，不能换成series latest。active/disabled/withdrawn且validated与installed的读取资格不同于执行enabled；可查看不代表可执行，removed/draft/quarantined拒绝保持owner规定。

Platform初末在各自短事务读取本人来源/安装/package一致快照，Storage/ZIP网络在事务外，末端再在线身份/绑定/CLEAN核验；BFF不复制这些事务、pool/permit或校验器，不宣不同owner间原子快照。出现变化按owner闭集失败，不用早先metadata/缓存返回；选中原文只在当次成功响应生命周期存在，取消/期限退役丢弃，不持久写入。

### 认证优化不是业务数据

现projection credential正规文件用途与scope不扩大。内存token/flight仅短期传输优化，key含tenant/generation/ref/client/resource/scope/secret-hash，文件读取有界/安全权限，get与flight完成重核rotation；取消/轮换迟到值不得缓存或返回，owner机器401/403退役相关token/flight。不得以token cache替current用户准入或Platform fresh决定。此安全强化后继runtime另授，不凭本设计声称旧projection已实现；不造新身份、持久token表、Redis授权镜像或后台刷新任务，不写正常凭据/secret/资金。

唯一10秒单调绝对预算覆盖输入、admission、凭据、实际OAuth HTTP、RPC、有界decode/strictprojection和publicJSON实际编码/末端fence；逐层耗remaining，不重计。caller断开与owner取消/本地deadline分开，迟到I/O被观察/丢弃、零后继，不宣物理settlement10秒完全回收。包目录/原文public实际UTF-8 JSON≤1MiB，超过429/no retry/no截断；selected null与空text明确区别，原BOM/换行保留。

### 发行记录与历史保护

唯一Connect vendor由e83a替换1f6f764完整52正式Git输入；V5–V9历史bytes/provenance完整固定，历史V8/V9各43/20/24与最新45/20/24明确区别，三compiled/generated双父剥新增回父、完整generated等compiled；旧V8→parent39保持。固定输入manifest/hash不是业务事实，不建立Root可编辑contract中心，也不把inactive/generated-not-activated或文档准入当runtime激活。独立Platform HTTP vendor与有效旧projection/Skills/public109不变；不为clean-slate删除仍有效业务，删除只限被替代Connect固定点与重复alias。

### 实际验收和资源边界

按TECH既定机器→public→真实系统RED→runtime→系统GREEN→正常受控切换→WebE2E串行；缺资源明确未验，辅助门不替用户测试。后继test/skill-package-inspection.integration.mjs置现test根，Root提供受保护正式IAM Session/OAuth HTTP与真实Platform/Storage/MinIO/ClamAV/PG资格；BFF不导入owner SQL seed或IAM私有fixture，不重新造包冒已有真实引用，不native预签token代实际HTTP。每主体/source/installation、目录/正文、foreign/missing/removed、disabled/withdrawn、原文空/BOM、路径/超限、错误header/no-store、取消/撤权/轮换与零mutation均独立证据。

测试只Root隔离资源/清理本次自有资源，不reset共享PostgreSQL/Redis/ObjectStore、不重启正常预览，不扩大原包清理资格。当前正常配对由Root后继受控维护；本文无新连接器/MCP/Agent/Admin/Billing写入。作者/usage/真实cover、series收敛、可见非本人未安装catalog正文资格以及Skills管理员前后台同步仍OPEN，完整Skills与Wave0–7范围不缩小。

<!-- R340-SKILLS-INSPECTION-DATA-END -->

## R323 本人 MCP 四读机器契约已发布，运行接线尚未实现（2026-10-07）

当前唯一public OpenAPI **8.7.0 / 109 operations**，新增四 `/v1/self/mcp/*` GET（本人connector列表/详情、connector下connection列表、connection详情），固定metadata、安全closed shape/参数/错误与no-store。原105 operations/88path items/456components Root独立完整document剥增量后deepEqual，Platform固定vendor/generated、runtime/source/Schema/正常身份完全未动。旧R320三面中“尚未写机器契约”的阶段现由本节替代；五普通TS、正规OAuth HTTP到owner组合及正常激活仍目标，不把contract发行当已存在HTTP路由。没有新数据库/credential或兼容层。

Root实际四缺口RED 77旧PASS/4新FAIL；首机器contract73381 302PASS/1FAIL为旧R240闭集包含新path，最窄排除仅四新path/四ID，原hash/92不变。独审发现新Retry-After范围P2，现尾负控2PASS/1FAIL拒86401；只新header/verifier两行修canonical1..86400/绝对末尾、不容LF。原四RED组全文exact，旧response不改。专用checker和11漂移负控保闭集；scope JSONSchema字符计数不同于UTF-16 JS string.length，描述明确后继mapper仍须真实运行补强，不能单靠maxLength冒同规则。

Root显式Node22.22.2最终71468完整pnpm check自然exit0：contract304PASS/0SKIP、default879中877PASS/0FAIL/2原资源SKIP，lint/typecheck/build；13002 format:check自然exit0。只辅助机器验收，未运行全资源integration、真实本人四读HTTP/E2E或正常用户连接器CRUD，不把两skip计为通过。独审最终1fa085a4无确定阻断，七机器freeze加三已批准D0/本CURRENT/INDEX精确十二paths由Root独占提交；539其它tracked exact，原var保留。完整70/个人33不升级，支付最后，后继按既定实际IAM HTTP/Platform/BFF系统RED再授runtime五文件。

## R320 本人 MCP 四读 Product 消费设计（目标，尚未实现）

基线 `a3e9a7ed6615e35bcf722d5d20bddd997dcf7e86` / `codex/r257-bff-normal-current`；当前551 tracked、仅原var。已固定Platform owner `e83a2ad3a7c7d333ad0b0b8e7f3d3f64e497bc42` 与V8 aggregate `4a5ed2ca1a25673967ac2ee05a43c5f568bdd19c9ff768d8e606fdac94b9542f`；43 RPC/20 command/24 proof和历史parent39/完整V8→V7→V6→V5继续冻结。本设计新增BFF公开本人管理读，不改owner wire，不把机器消费标记当正常runtime已启用。原105 operations/public8.6.0尚无本节四GET；目标独立additive public8.7.0/109，正常服务当前版本另以Root维护证据为准。

事实owner仍Platform；IAM拥有准入与机器资格；BFF拥有public安全投影；Web仅同源adapter。四读不是完整CRUD，secret宿主/privateServer/创建编辑/启停撤销重连及mutation幂等恢复仍OPEN。本次只三D0前缀，禁止先写contract/src/test/config/credentials/Schema；Root文档通过后再按下面顺序另授。

### 零数据库与无第二业务事实源

BFF canonical `database/schema.sql`及全部表/列/索引/retention不变；不新增MCP镜像表、个人查询receipt、游标表、Redis业务cache或权限缓存。Platform仍唯一Connector/Connection/authorization事实owner，BFF仅经固定generated RPC，不读取Platform/IAM数据库或复制ORM。四GET无command/digest/业务幂等key；重复GET每次当前admission与owner查询，没有已完成响应replay捷径。

当前固定V8四read的owner本人SQL与状态/分页语义不重设计：trusted tenant+user来自本次IAM session，Platform按tenant+user owner谓词先于mapper；foreign/absent统一404，owned corrupt映安全依赖错误。每页仍独立当前授权和owner过滤；cursor绑定tenant/subject/filter/connector及固定surface，limit不进入owner绑定，不承诺多页数据库快照。BFF只传opaque cursor，owner拒绝不退首页，不构造可以越权的新游标。详情和connection关联的安全public形状以API本节为准，不包含执行grant/secret/真实连接健康。

独立七字段credential file不是数据库canonical业务事实；用途由IAM官方managed client/purpose/scope事实拥有，BFF只读取本tenant一项。新增credential/token/connect/response四文件+http/routes一文件总5普通TS，配置/server只必要接缝、无新runtime worker或目录模板。内存token/flight仅短期传输优化，key含tenant/generation/ref/client/resource/scope/secret-hash，每次credential复核、过期/撤权/轮换/取消后退役，不落表/Redis、不缓存MCP结果或用户授权。零正常凭据/权限写，secret值不入错误、日志、报告或测试断言。

绝对10秒覆盖route结构/当前user admission、文件读取、实际OAuth tokenHTTP、ownerRPC、strictdecode/安全projection及return前fence；不每层重新计时。文件迟到read被观察丢弃、HTTP读body按byte上限和signal退役、无后继请求/自动fallback。Root真实fixture使用现共享PG/Redis的隔离自有资源，测试cleanup仅本次创建资源，不清理正常owner或其他人namespace。

保留旧execution projection：active connection全本人聚合/provider筛选与server catalog均有当前消费者；新管理四GET是不同事实投影，不替代这些用途。Platform HTTP vendor/generated/旧scope、BFF旧数据契约均冻结，避免以clean-slate名义删除有效行为。

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

### 零持久化变化与历史事实保护

本片只有固定机器输入/生成物，无BFF表、列、索引、迁移、receipt/outbox/cache事实或SQL变化；`database/schema.sql`完整冻结。Platform MCP Connector/Connection/authorization事实仍由Platform自有owner处理，BFF不访问其数据库、不复制ORM/model/schema，也不创建MCP镜像表或为四read增加command回执。

vendor发行记录不是业务数据owner：新唯一e83a目录保存Root正式Git对象38输入，含当前/parent39两descriptor及完整V8/V7/V6/V5。provenance逐文件长度/hash和aggregate只证明发行字节；旧V5–V7历史bytes按同值承接，不回填历史状态、不把最新43倒灌历史39。删除只限被替代旧Connect vendor固定点，不删除独立HTTPprojection发行记录、业务projection或历史有效Skills协议。

消费链尚未新增查询或凭据读取；不存在本片授权的tenant/subject来自body/浏览器头路径。后继四read需要BFF当前IAM session得tenant/user、独立personal机器资格及可信metadata，仍每页由owner做本人谓词/绑定cursor；这些运行事实不由此次生成证明。OAuth token获取缓存、安全secret政策和正常资格维护均不写入本仓Schema，也不在本片实现。

### 验证与后继边界

先在现 `test/platform-connect-contract.test.mjs` 追加固定V8缺口期望并取得自然机器RED，再按Root另授写集更新输入/pin并正规生成。Node22、本地现Buf/Protobuf-ES/Connect精确版本不升级；`pnpm contract:generate:platform` 和 `pnpm contract:check:platform` 继续两次独立生成byte一致、精确源/树/包/配置/hash/manifest门；common输出应保持原bytes，platform输出由工具增加四方法/11messages。原V5 census39保持历史输入，最新43与parent39分开验证，不把旧断言全改43。Root负责最终contract/default/architecture/build与范围审查/Git；作者已在Node22执行正规生成/check/build及现contract单文件16 PASS/0 SKIP；Root最终工程门与独审尚待，不宣用户功能通过。

当前机器范围无新的owner/Schema/字段/密钥政策未决。后续BFF四本人读public契约、独立personal客户端资格、真实用户session与OAuth token HTTP获取→Platform introspection、Web消费和正常进程维护另切片；R317 native issuer证据不能冒BFF HTTP token链通过。privateServer/secret宿主/编辑启停重连及全mutation政策仍未决，不在此裁决。正常projection、Skills、权限与服务保持不动。

Root完整contract首轮298项中289 PASS/9 FAIL，六个既有测试仍硬编码旧vendor路径造成ENOENT，属于本次cutover遗漏而非历史baseline。现 `test/contract/openapi-contract.test.mjs`、`test/skill-installation-http.test.mjs`、`test/skill-package-begin-http.test.mjs`、`test/skill-package-complete-http.test.mjs`、`test/skill-publish-http.test.mjs`、`test/skill-validate-http.test.mjs` 仅旧40字符commit→新40字符commit字面替换；原V5 bytes与全部断言/版本/count不变，同唯一固定点继续校验。完整门待Root重跑。

<!-- R319 fixed V8 consumer design end; prior document follows byte-exact. -->

## R291 Project release 数据实现候选（2026-10-07）

canonical两表和约束未变，新增实现只操作 BFF 自有 Project deletion/outbox。claim 在短事务选一冷却恢复、普通补剩余总配额；SQL实际 clock_timestamp 建 lease，原 identity/fence/attempt 保持。settle 先串行锁 Project 聚合，再使用 clock_timestamp 未过期条件 CAS；lease 丢失/晚 ACK/unknown COMMIT 不猜写结果。内部单调观察不入数据库或公开契约，不读取 Storage/IAM SQL。

Root 自有 r285 资格库15真PG通过且结束26表0行/0其它客户端；未运行正常DDL或清理共享数据库。实际Storage事实、正常schema组合、全部用户删除生命周期仍OPEN，下面R284/R282为历史时点。

---

## R284 Project scope release worker 数据边界（目标，尚未实施）

当前 commit `6f20f81a8d15992b35bc07e76ac8808d7072bee8` 的 canonical schema 已包含 `bff_project_deletion` 与 `bff_project_scope_release_outbox`，本地删除事务、N+1冻结、约束、rollback、receipt replay与status完整性已通过Root隔离PostgreSQL 16/0。R284不新增表、列、索引、兼容DDL或第二receipt；正常schema组合仍未激活，真实Storage worker/ACK unknown尚未验证。

repository只在短事务中领取due pending或过期leased row，成对写lease owner/expiry并增加fence；网络调用在事务外。settle按tenant+command+state leased+lease owner+fence+未过期lease做CAS，并以Project聚合行作为同Project结算序列化点，从冻结的唯一Project scope与完整Conversation scope集合重算状态。lost lease/晚ACK/取消后返回均零写；每次settle清理lease pair。原deletion receipt、response_data、response_status与Location永不随worker更新。

`attempt_count`只用于观测/退避，不能在8次或任意次数后把unknown写成blocked/failed。transport unknown与可信retryable继续原command/digest pending；可信terminal写blocked。唯一资格恢复标记仍落现行state/error/available_at/lease字段：固定owner正规`UNAUTHENTICATED`至少冷却300秒、每轮最多一条、同identity/command的新fence一次RPC；不得新增repair表、换key或由用户session重建身份。PermissionDenied、InvalidArgument、digest mismatch、precondition和损坏row保持blocked；普通claim不得覆盖。

ACK不含scope identity，不能把响应counts当关联键。持久字段`tenant_id`、`owner_subject_id`、`actor_id`、`scope_kind/scope_id`、`command_id`、`request_digest`，以及由`scope_kind`固定派生的两种operation，是唯一可信调用上下文；`actor_id = owner_subject_id`的既有约束保持，且不发送actor header。operation不是持久列：project固定`storage.release_project_scope:v1`、conversation固定`storage.release_conversation_scope:v1`，并已纳入保存的digest；投递不得替换digest。`released`只表示Storage接受逻辑release，物理状态不入本仓新事实且公开仍为pending。

后继真实PG门须覆盖双worker过期fence、晚ACK CAS0、同Project并发settle、blocked不被普通claim吞、300秒资格恢复选择上限、shutdown取消与重启samecommand；再与固定Storage owner验证receipt/replay。完整DELETE并发与COMMIT-unknown、正常schema组合仍单独OPEN。

## R282 Project 删除数据当前态（本地候选）

当前 canonical 候选已包含 Project deletion receipt 与 N+1 scope release outbox，BFF 本地同事务聚合删除、约束、回滚、重放与完整性读取已通过 Root 隔离 PostgreSQL 验证。正常运行实例仍未激活该候选；Storage release worker 与物理清理证据尚不存在，因此 logical 状态之外的 physical cleanup 始终视为 pending，T-C05 不得标记 PASS。下方 R276 数据方案仍为字段与事务语义权威。

## R276-PROJECT-DELETE-D0：Project 墓碑、聚合 receipt 与 N+1 release outbox（本地数据/runtime 已实现；worker 未实现）

> API shape 见 [API_CONTRACT.md](./API_CONTRACT.md) 同名章节，锁序、worker 与模块放置见
> [TECHNICAL_DESIGN.md](./TECHNICAL_DESIGN.md) 同名章节。当前正式已发布 contract 与正常 runtime 仍为
> `8.5.0 / 103 operations`；当前工作树已有 `8.6.0 / 105 operations` 机器候选，但尚未发行或生成消费者。当前 `6f20f81a` canonical
> schema、两张新增表/约束与本地 runtime 已实现并通过隔离验证；Storage worker、正常schema组合激活及owner/browser链仍是目标。

### 当前事实与不变边界

- `bff_project` 已持久化 `deleted_at TIMESTAMPTZ(3)`；active list/read/Move 使用 deletion fence。墓碑继续占有 slug，禁止
  删除行后复用。无需新增第二个 Project deletion flag。
- Conversation、Message、Share、AG-UI、ScheduledTask 均是 BFF owner 内事实，可以在同一数据库事务中按既定 repository
  规则更新；Storage scope/blob 与 Scheduler 执行事实不得通过 SQL 读取或联表。
- Storage 固定 owner contract 已有 Project/Conversation scope release；BFF 只持久可信 scope identity、command digest、
  ACK 投影和 lease/fence，不复制 Storage 对象清单或物理 cleanup 状态。

### 当前 `6f20f81a` 已实现的 canonical 关系

#### `bff_project_deletion`

一 Project 一行的聚合删除 receipt/status：

- identity：`tenant_id`、`project_id`、`owner_subject_id`；`project_id` 唯一并与 tombstone identity 逻辑一致；
- idempotency：`operation`、`idempotency_key`、`request_fingerprint`、规范 `response_data`、`response_status = 202` 与
  Location；request ID 从不落 JSON/receipt，每次 replay 只生成本次 `x-request-id` header；
- frozen summary：`conversation_count`、`release_command_count = conversation_count + 1`；不保存可漂移 JSON 成员副本；
- projection：`logical_release_state CHECK IN ('pending','blocked','released')`、`physical_cleanup_state CHECK = 'pending'`；
- audit：`created_at`、`updated_at`、可空 `blocked_code`。不存 token、授权结果、Storage payload 或任意敏感 message 内容。

约束：`UNIQUE (tenant_id, project_id)`；`UNIQUE (tenant_id, owner_subject_id, project_id, operation, idempotency_key)`；同
Project/key 异 fingerprint 只能冲突，不能覆盖 receipt；同 key 跨 Project 独立。聚合行与 Project tombstone/current owner 必须
在每次 replay/status read 中重新校验。墓碑 Project 的新 key 统一 404，而不是与既有 receipt 形成新冲突。

#### `bff_project_scope_release_outbox`

冻结成员集合与 owner command 一体化的具名 outbox：

- identity：`command_id`、`tenant_id`、`project_id`、`owner_subject_id`、`actor_id`、`scope_kind IN ('project','conversation')`、`scope_id`；既有约束要求`actor_id = owner_subject_id`；
- owner request：持久`request_digest`；owner operation不是列，而是由`scope_kind`固定派生为`storage.release_project_scope:v1`或`storage.release_conversation_scope:v1`且已纳入digest；Project 一条、每个冻结 Conversation 一条；
- delivery：`state IN ('pending','leased','released','blocked')`、`attempt_count`、`available_at`、`lease_owner`、
  `lease_expires_at`、`fence`、`last_error_code`、`created_at`、`updated_at`、`released_at`；
- `UNIQUE (tenant_id, project_id, scope_kind, scope_id)` 与 `UNIQUE (command_id)`；Project command 必须恰好一条，
  Conversation 行集合本身就是冻结成员证明。

领取索引仅覆盖 `state='pending'` 且到期可用行；lease acquire/reclaim/ACK 均带 fence CAS。`blocked` 不由普通 claim
自动重置；同 command 的明确恢复判断可把它重新置 pending，不生成新 command，也不开放人工修复表/API。

### 单事务写入与固定锁序

一个沿现 repository 策略的 `READ COMMITTED`、同 client 事务按以下顺序：

1. 按 `(tenant_id, project_id)` 锁定包含墓碑的 Project 行，验证 current owner；锁定/读取完整 namespace 的 deletion receipt；
2. 有匹配 receipt 时先校验 digest/current tombstone：合法 replay 返回保存的原始 202 pending data；异 digest 409。无匹配 receipt
   才要求 Project active；墓碑新 key、不存在或非 owner均 404；receipt/墓碑不一致为 store failure；
3. Project 锁取得后用 fresh statement snapshot 查询并按 canonical conversation id 升序锁定当前成员，再按 task id 升序锁定
   关联 ScheduledTask；
4. 按 `(scope_kind, scope_id)` 升序建立 Project + Conversation 的 N+1 release outbox；
5. 对已锁且集合绑定的 Conversation 调 same-client 删除核心；该核心不复用外部单删的 active-Project predicate，外部入口仍保
   原授权。核心不删除 Message/immutable AG-UI ledger，也不伪造 Agent terminal；
6. 写 `bff_project.deleted_at`，逐 ScheduledTask 写 paused/disabled、`next_run_at = NULL`、revision+1 与现
   `scheduler.replace` outbox；
7. 写不含 request-level meta 的规范 202 pending receipt data、Location 和 frozen counts后提交。

任何一步失败整体回滚。事务内禁止 IAM/Storage/Scheduler 网络调用。Move 现按 source/target Project 排序取锁后再锁 Conversation；
DELETE 单 Project→成员保持同方向。所有能新增/迁移/恢复成员或 task 的 writer 均须先持对应 Project admission lock 并重验 active。
不得靠 `SERIALIZABLE` 旧快照、最终扫描或静默 detach 代替这个共同锁协议。

### 状态投影、unknown 与保留

- 聚合 `logical_release_state` 只由固定 outbox 集合投影：任一 blocked→blocked；全部 released→released；否则 pending。
  worker ACK 与聚合更新处于同一 BFF 事务并以 lease fence 防晚写。
- timeout/断连/未知 ACK 保持 pending 并用相同 `command_id`/digest 重试；owner replay success 才 released。Project deletion
  HTTP receipt 只证明 BFF 本地事务已提交，不证明 Storage 已收到命令。
- `physical_cleanup_state` 在本 schema 版本恒为 pending。不得用 owner 404、队列为空、时间经过或 logical released 推断物理完成；
  未来若 Storage 发布终态证据，须另起 contract/schema slice。
- Project/Conversation 墓碑的精确 retention 与最终 purge 时限尚未批准。当前不新增 purge DDL/job；Message 与 immutable
  ledger 依现 retention 保留，compact/share revoke/durable cancel 沿单 Conversation 删除事实。本切片不开放 Project slug
  复用，但不把 retention 未决写成永久保存承诺。

### Fresh install、迁移与验证停止线

- 后继 DDL 必须同时更新本仓唯一 canonical schema 与 installer/fresh-install oracle。本仓 SQL V1 当前没有 migration 链；
  正常已有库的受控演进须另立 ADR 和明确执行/备份/停止线，本片不新建 migration runner/链、兼容表、启动时建表或双写路径。
- 在机器契约、canonical DDL、repository/source 和真实 PG 测试同片审查前，目标保持“未实现”。真实门必须证明：零成员、
  多成员、Move/Delete 两种胜序、Scheduled revision 晚 callback、N+1 精确冻结、同 key replay/异 body 冲突、事务回滚、
  lease 丢失晚 ACK、blocked→同 command 恢复、Storage unknown，以及跨 tenant/subject 零泄露。
- 不访问或清理正常数据库；实现期使用独立随机 tenant/隔离数据库，核 catalog 起终一致并只清自己创建的数据。

## R267-SKILLS-LIFECYCLE-D0：零BFF持久化的版本/撤回消费（仅设计）

Platform唯一拥有Skill行、series/revision/status、package绑定、installation、event/outbox和command receipt。BFF仅持有单次请求的可信admission context、严格解析值、command投影与短暂结果；不新增/修改PostgreSQL表、列、索引、约束、migration、Redis key、receipt、outbox、snapshot或授权cache，`database/schema.sql`保持零diff。Web后继只保存当次未知intent/key，不成为业务事实源。

CreateVersion不更新base：Platform在其短事务内重读同tenant/owner的精确base，要求active/disabled和不可变display_name，按series分配下一revision，插入新ID draft并提交receipt；新draft有自己的package生命周期。并发安全由owner `(tenant,series,revision)`等约束、事务和receipt证明，BFF不先读max或生成revision。旧active/disabled及其安装保持。

Withdraw在Platform事务内重读精确source、校验active/disabled、窄状态CAS为withdrawn，并原子写事件/receipt。installation继续绑定原revision；撤回不级联remove、Blob/Asset删除、package清理或latest迁移。本人管理读和安装metadata可反映source_status，但installed/enabled不等可执行，执行仍需fresh active gate。

public key只用于稳定派生owner command identity；semantic digest绑定tenant、method、subject owner scope、Product context、path identity和完整body。command ID命名空间沿现publish形状绑定operation+tenant+subject+path ID+key；同path同key异body冲突，不同path为不同namespace。BFF不持久化key、digest、请求正文或owner response。同key回放仍先当前admission与owner current replay guard；同path同key异body冲突，不同path为独立namespace。COMMIT/ACK未知后不在BFF补偿或写“pending”行，原key显式重放或权威GET由调用方恢复；CreateVersion新draft状态已漂移时owner current guard可使原key412，并不保证永久返回原201；GET当前状态不是receipt因果证明。

单一10秒deadline和AbortSignal是request生命周期，不是数据库lease。取消可能发生在owner已经提交后；BFF不得声称rollback。token内存cache/shared flight保持现credential版本键控机制，但不新增业务、持久token或授权结果cache；用户admission每次重验。

数据完整性验证要求BFF schema/catalog前后exact、无新SQL/Redis/receipt调用；Platform真PG验证同owner/跨owner/跨tenant、并发revision、同key重放/异义、terminal新key、事件一次与事务回滚；BFF真HTTP验证严格映射、撤权零owner调用、超时/迟到不返回成功。当前未运行任何门，D0不等于实现。

未发行Storage删除的版本占位改为8.6/105只是发布排序；其Asset/Blob/cleanup数据规则完全独立且不在本片迁移。无第二owner、双写、兼容表或历史回填。

<!-- R267-SKILLS-LIFECYCLE-D0-DATA-END -->

## R266-SKILLS-BFF-D0：本人 Skill 管理读取数据边界（零BFF持久化）

本切片不新增或修改BFF表、列、索引、约束、canonical SQL、Redis namespace、receipt、outbox、cache或后台worker；`database/schema.sql`逐字保持。Skill、series、revision、metadata、五状态与管理分页cursor的唯一owner是kokoro-platform `3d4ba6c…`。BFF只在单次已准入请求中把可信tenant/subject投影到固定Platform HTTP3.3，并把严格安全响应映射为public envelope；不保存Skill镜像、本人历史或列表快照，不新增业务/持久token或授权缓存；现credential版本键控machine token内存cache/shared flight保持，当前用户admission仍每次重验。

### 状态、分页与一致性

`draft|active|disabled|withdrawn|quarantined`是Platform当前行事实，不是BFF状态机。每个revision独立返回，BFF不按series合并、不选latest、不从旧ACTIVE discovery或installation记录补全管理历史。`source_ref`必须绑定返回`skill_id`；detail还绑定path ID。owner cursor绑定tenant、subject、status/all和稳定排序；BFF对合法非空cursor原样有界传递与回传，owner合法省略next_cursor时只在public envelope归一为null；其它shape拒绝。BFF不解码、不跨subject复用、不把它当权限凭据。分页是每页当前读，不宣称跨页snapshot。

当前Session/IAM admission、Platform token和owner读都在请求生命周期内；不得写授权cache来绕过重验。10秒绝对预算/取消是传输生命周期，不形成持久lease或恢复状态。GET无业务副作用，不申请idempotency receipt；失败或未知结果允许调用方重新GET，但BFF不自动重试或把旧200缓存为当前状态。

### owner边界与删除规则版本顺序

本次public8.4/101只新增两条读取，不改变Storage任何数据或删除流程。下方R261单Asset删除D0的旧`8.4/101`文字是当时未发行占位；按Root实际顺序，其后继机器目标为8.5/103，原personal/project scope、引用冲突、owner receipt、logical delete与physical cleanup规则全部保留。两个能力不共享表、receipt或cursor。

### 事务、失败与验证

BFF无事务/锁序/补偿：Platform在其owner边界保证本人谓词、metadata一致性和keyset；BFF严格验证成功/错误shape并fail closed。坏owner数据或未知错误tuple为502，不落地“待修复”行；owner/IAM不可用或绝对deadline为503，不返回缓存/部分列表。取消后迟到owner数据被丢弃并清理stream/listener。

后继数据门只验证`database/schema.sql`与现表manifest零差异、无新增SQL/Redis key/receipt调用；真实测试另证跨tenant/subject、status/cursor绑定、分页中更新、owner malformed/timeout/cancel不会产生任何BFF持久化。当前未运行schema或资源门，三D0不是实现证据。

<!-- R266-SKILLS-BFF-D0-DATA-END -->

## R261-BFF-FILE-DELETE-D0：唯一Storage删除事实、零BFF数据演进（仅设计）

基线为正式 BFF `/Users/nako/.codex/worktrees/kokoro-r257-bff-normal`、Root给定 HEAD `7269e97`。本轮只三文档新增前缀，原全文suffix逐字节保留；未修改源、机器、生成物、配置、Schema、正常数据或untracked var。现公开8.3.0/99 operation没有单文件删除；目标8.4.0/101尚未发布。Storage现pin仍`e8b9928418924812587b7ac07900aee4be5bc27f` / combined `c22b5c10ee698d579753dcac370be371d8dba1df8fead1a12883f5443fbad18a`；17 RPC候选combined `9b602259c3b777e31deb63563467ae160c04bde415e841851aefae760902f34f`不是正式新发布，最终owner commit待定。Storage正式源/机器发布后才准repin及正规生成，禁止先消费mutable工作树。

BFF不新增或修改表、列、索引、约束、Schema、Redis keyspace、receipt/outbox/授权cache。`database/schema.sql`保持原样。唯一持久删除事实在Storage的Asset.deleted_at、最后live引用Blob.retired_at、exact object cleanup与同事务completed command receipt；BFF不保存Asset镜像、删除标记或自制“物理已清”状态。personal与project只是同owner ordinary Asset的两种受信scope，不建立新Library实体。

Project读取仍只属于BFF本仓：当前tenant+subject的owner_id及deleted_at IS NULL，取canonical ID；组织Member/admin/平台admin不是替代谓词。Storage不查BFF表，BFF不读Storage表。Artifact、skill_package、Conversation、ReleaseScope、整Project删除与本两个单Asset操作分开；Artifact有效引用冲突不级联，不动包/会话/其他共享Blob的Asset。

唯一幂等主权在Storage：tenant/scope/caller/subject/operation/command域，public key稳定派生commandId且不含asset，digest含asset。同scope同key异asset409；回放前重新当前准入，合法receipt不被预GetAsset已删谓词挡掉。无BFF二次事务跨库协调、Map或上传checkpoint复用。响应只稳定asset/time/replayed，request ID是本次header，不持久化进owner receipt。

删除成功只表示逻辑提交及durable清理安排，旧对象版本identity与同digest新代隔离由Storage独立事务/partial unique/provider门保证。BFF不以列表缺行证明物理删除、不请求任意object key；既发URL可能自然有效至300秒。未知ACK后同key核定可恢复，换key不是恢复；取消不是回滚。Web保存的仅当次intent/状态，撤准入/切人必须退役，持久业务事实从owner重新读。

Project授权读取的**目标生命周期已裁决，实现待验**：当前无signal的pool.query没有源级连接/statement/query预算，不能据现源宣称目标10秒成立。目标现 `application/ports/project-repository.ts`、`application/project-service.ts`、`infrastructure/postgres/project-repository.ts` 新具名 `findActiveResourceProjectId(scope, idOrSlug, signal: AbortSignal, deadlineAt: number): Promise<string | null>`，必填signal/绝对deadline，唯一原owner谓词，只回canonical ID/null；旧findProject、数据模型不变。连接生命周期不塞入row CRUD：比较直接repository方法后采用现目录新普通 `infrastructure/postgres/project-resource-access.ts`，exact checkout、late acquire释放、取消/超时精确destroyClient(true)，本读取事务内设置statement_timeout/lock_timeout/client_connection_check_interval与剩余预算，清理监听及timer。无跨owner事务、无写receipt、无新service/模块/通用SQL平台；授权结果不缓存。

真实pool saturation、held SQL取消、迟到取得释放、连接故障、事务结束与资源回收是上线条件，取消后零Storage IO；业务等待终止不等底层connect已取消，不能只race裸pool.query或冒称无遗留。具体无法满足时报告Root，不放宽预算或扩改全局query/statement。TECH放置表记录五新普通source及三现接缝；本轮只有D0写入，零实现授权。

后继数据验证：BFF原catalog/facts不变；真实Storage同key重放/异义/并发/引用/最后引用/新代/旧cleanup不伤新代由owner证明；BFF真实授权取消/超时无泄漏及只调用本scope；Root用户确认→DELETE→权威列表/硬刷新独立验收。正常删除数据、授资格、DDL、进程切换均非本D0授权；原suffix与untracked var保护。

Root最终补充裁决：现 `src/infrastructure/postgres/client.ts` 唯一Pool仅增加 `connectionTimeoutMillis: 1000`，有限约束底层connect与pending队列，堵住仅race/late-release仍可能无界等待；不改全局query_timeout/statement_timeout、max、credentials，不创建新Pool。此为D0目标并非源码已支持。保留五新普通文件和三现port/service/repository接缝；真实完整旧回归及pool饱和、SQL锁、取消、late acquire/连接故障门必须验证无泄漏及取消后零Storage IO。

<!-- R261-BFF-FILE-DELETE-DATA-END -->

## R259-SKILLS-METADATA-BFF-D0：数据边界（2026-10-06；D1冻结候选待Root验收）

D1候选保持`database/schema.sql`零diff；机器与投影实现不新增任何BFF持久事实，真实owner资源验证仍由Root执行。

Platform `skills/installation`继续唯一拥有安装行、精确Skill revision逻辑关联、`display_name`、`summary`、`source_status`及command receipt。BFF仅在单次五个既有RPC响应中严格校验并投影三字段；`display_name`须非空白且JS `length<=255`，`summary`允许空串且JS `length<=65535`、原样不trim；Proto省略合法空summary由固定decoder得到`""`，不构成缺关联或坏数据。不创建安装或元信息表、缓存、snapshot、receipt、outbox、Redis key、索引、FK、migration或跨owner JOIN。`database/schema.sql`必须零diff。

owner当前实现以逻辑关联校验tenant/skill/series/revision并fail closed；BFF不复制该关系或从本仓Project/Skill关联推导。元信息随后变化时GET/LIST和合法replay可见owner当前值，但安装enabled/removed、change/event/replayed仍按owner事实，不形成BFF双写。缺关联、错tenant/series/revision、draft/未知status在owner或BFF strict边界关闭，不能用旧九字段缓存继续服务。

repin只更换单一vendor commit与最新Proto/descriptor/generated；旧`494b118a…`目录删除，BFF vendor V5–V7实际27文件原字节/aggregate保持，owner V1–V7历史总量93文件保持，不能因最新字段变化重算历史artifact或造V8。fresh schema、现BFF表数与数据生命周期均不变；验证要求`git diff -- database/schema.sql`为空、schema治理门通过，Root真实组合前后BFF/Platform各自数据基线精确恢复。

<!-- R259-SKILLS-METADATA-BFF-D0-DATA-END -->

## R257 管理路由 HTTP 实施验收（2026-10-06 16:16 UTC）

四个已发布public8.2操作现有具名route/client实施，System3.0固定artifact与全部旧operation不变；无BFF DDL/新owner/兼容proxy。

Root92682 Node22 check+format exit0：contract264/0、主829PASS/0FAIL/2既有skip、lint/types/drift/build0；Root50905正式IAM CLI资格/Audit/CodePKCE/current admission→BFF四具名操作→System真实PG官方seed/三读/visible CAS保存/权威回读/原key重放/异body与旧版本409/坏Session401通过。资源PG77→77/IAM前缀keys0→0、cleanup passed；独审ea30e379，route8f59/clientb308/test3aeae1冻结。

正常BFF仍旧进程，本次未重启/授正常管理员；Web管理页面仍占位，合法普通Session403/管理员撤权后重放、普通models visible投影、浏览器保存确认、推理和资金未验。仅owner子链及本切片工程通过，旧404/400/502/取消抖动证据保留；下方阶段描述为历史exact suffix，不作当前否认实现的依据。

- 机器契约/generated 阶段不改变本结论：public 8.2/99 与固定 System 3.0 client 不引入 BFF DDL、缓存或 owner 数据副本；生产接线仍属后继切片。

## R256-ADMIN-03.D0：模型路由管理数据边界（2026-10-06；零 BFF DDL）

System 唯一拥有 ModelLabel、ModelRevision、RoutingPolicy、版本/CAS、tenant scope 与 command receipt；BFF 只保存当前请求内的受信 admission context、冻结命令与解析结果，不复制 owner row、资格、routing 快照、receipt 或 cursor。本片不改 `database/schema.sql`，不建表/列/索引/触发器/迁移、Redis key、审计副本或 credential/permission 总表；BFF 仍禁止跨 owner SQL/JOIN。

### 写入、并发与恢复不变量

- 单 label PUT 的完整 body、label_id、可信 tenant/actor、条件头与 Idempotency-Key 由 BFF 原样语义映射到 System。System 在自己的事务内校验 label/revision/feature/product、锁定 routing、比较 version、写固定列、推进 version并与 durable receipt 同事务提交；BFF 不在本地事务包 owner HTTP。
- 创建使用 `If-None-Match: *`，更新使用原 `If-Match: "version"`；两窗口同 version 最多一笔成功，另一笔409且不覆盖。System 现行单-label PUT 的四合法字段规范不变，BFF 不为第一轮 UI 验收增加字段级拒绝、旧 row 预读、merge、重复写规约或权限缓存；首轮 UI 只改变 `visible` 并提交其已读完整快照。不存在 partial PATCH、字段默认或顺序双 PUT。
- System 现唯一 `(tenant, feature) WHERE is_default` 约束会拒两个默认；单行 PUT 不自动清另一行。本片不实现跨两行原子 default 切换，也不以先后两 PUT 模拟。label/revision publish/retire/provider/删除仍由 System 其他合同和权限拥有。
- owner command receipt 以 tenant+key 锁并绑定 operation、actor、path、body、precondition digest；原 key同请求重放原终态，同 key异请求拒绝。BFF 内存 MutationTicket 不是权威且不得参与。COMMIT 已发后断链/timeout可已写入；客户端保持 unknown，以有界 routing list只读核实，不能新 key盲写或用普通 catalog 猜因果。
- 三个列表只处理 owner opaque cursor与单页最多100；BFF不持久化、解码、重签或跨 tenant/operation复用。分页在更新中不承诺snapshot；达到有界页数仍未找到即保持 unknown/未定位，不宣称不存在或回滚。

### 放置、删除与验证

数据层方案一是在 BFF 新表缓存 routing/receipt，因制造第二事实源、失去 owner CAS 与恢复权威而淘汰；方案二（采用）是具名 System generated client + request-scope 状态，成功/失败均不落 BFF DB。另建通用 admin credential/permission 表同样淘汰：current资格属于 IAM，实际操作权限与资源事实属于 System。

后继生产写集仅 `src/http/routes/model-routing-admin.ts`、`src/infrastructure/clients/owner/system-model-routing.ts` 与 Root 集成的 `src/bootstrap/server.ts`；generated/pin/机器文件及测试精确清单见 TECH 当前前缀。`database/schema.sql`、现 PostgreSQL repositories、personalization演进、Redis及 normal 数据均须保持字节/事实不变。

真实验证必须以 System 自有隔离 PG fixture 证明：首轮 UI 合法单 row visible 更新只改变目标 owner row/version与一条对应 receipt，并以 backend contract case 证明 System 其余合法字段变化没有被 BFF 新增拒绝；普通 false、伪 header、跨 tenant/global、wrong feature、draft/retired revision、缺/错条件、同 key异body、CAS输家均零写；丢 ACK 后同 key权威恢复只提交一次；分页回读与普通 `/models` 分别验证完整 routing 和 visible projection。BFF schema catalog/fresh安装前后 exact 不变。Root 才能运行资源门、核库集合并配对 normal；本 D0未运行。

**未决项。** 只剩正式 System 3.0 immutable commit/digest pin 与 Web 最终 HEAD 文件冻结；均不改变“零新DDL/唯一System owner”结论。跨两行默认切换需要未来 System 原子命令与独立数据设计，不能扩本片。

<!-- R256-ADMIN-03-D0-DATA-END -->

## R257-PERSONALIZATION-EVOLUTION-D0：单表语义判据（2026-10-06；待实施）

399e70dfd97004c4c75cfb1e83c571a38c749437 已有 canonical bff_personalization 与本人 CAS；下面“无表/仅设计”为保留历史。此片不改 canonical，不读正常数据库；正常完整 catalog/旧数据尚待 Root 核实。唯一 SQL 真源仍 database/schema.sql；[ADR-003](./ADR/ADR-003-personalization-schema-evolution.md) 只准这次有数据 additive 例外，不生成第二份可编辑 DDL。

**legacy。** 必须已有 kokoro_bff schema 和原部署必需普通核心表 bff_project、bff_conversation、bff_scheduled_task、bff_idempotency_receipt、bff_agui_event；空库/缺 schema 不创建也不视为 legacy。目标 relation/同名 type、pk_bff_personalization 索引名无碰撞。normal 原部署还须 Root 实际 catalog 审准，以上最小锚点不等完整旧结构证明；未知旧漂移停止，不以当前原 mixed canonical 追补旧列/表，不捏造旧表 count。

**current。** 精确普通永久表，无分区/继承/RLS/用户 trigger/rule；恰九列、顺序/类型/typmod/NOT NULL/默认/identity/generated 均符合唯一 canonical：tenant_id、owner_id、nickname、occupation、about、instructions 为 TEXT；revision 为 BIGINT；created_at/updated_at 为 TIMESTAMPTZ(3) 且唯一默认 CURRENT_TIMESTAMP(3)，其余无默认。恰具名复合 PK(tenant_id,owner_id) 与有效 btree 唯一 PK 索引；具名 scope 非空、四 char_length≤128/256/2000/8000、revision 1..9007199254740991 CHECK，均 validated/非 deferrable；无额外约束/FK/索引。catalog 比较规范化语义而非源码空白/仅对象存在，更强的额外约束也不合格；重跑保所有已存资料/revision，不读出正文。

**invalid 零修复。** 同名 view/foreign table/type、部分结构、列/类型/精度/默认/可空/索引/约束差异、RLS/trigger 等拒绝。读取 pg_catalog 的启用 DDL event-trigger 元数据，存在可能影响本次 CREATE 的 hook 则停止交 Root 另审；无跳过检查开关，不执行其他 owner SQL。唯一目标 CREATE 从 loadCanonicalSchema 提取，严格拒缺块/多块/额外 SQL，具名执行去掉 IF NOT EXISTS 以显露同名竞争；完整后置 catalog 必需。fresh 与演进目标的语义 catalog 等价由隔离测试证明，不靠手写 predicate 自证。

同 owner advisory lock 下观察/创建/后置校验同事务；只新增目标及其 canonical PK/约束衍生对象，旧 owner catalog 摘要前后 exact，维护窗口旧业务事实保持。跨 owner 表、原 Project mixed、fresh 空 owner 拒绝、当前业务 SQL 都不动。check 无 DDL/数据写，current apply 无 ALTER/DROP/清表。失败、COMMIT unknown、新连接同锁核实与有限清理按 TECH/API；不越锁把暂时缺表判成最终未提交。

Root 正常只读前置、owner 备份/实际恢复演练和配对是独立放行门，不能从自有临时库结果推导正常已安全。验收要求原事实不变、current 重跑保已保存偏好、并发一 applied 一 already_current、每类漂移零写、有限锁/取消、真实 TCP ACK 未知后同锁 check；测试受控 hook 仅辅助。无 down/自动 restore/全库 reset，备份只在确有损坏且 Root 明确裁决时恢复，不覆盖其他 owner。

<!-- R257-PERSONALIZATION-EVOLUTION-DATA-END -->

## R257-PERSONALIZATION-D0：BFF 本人四字段单行事实（2026-10-06；仅设计）

基线 ac3cd1da4f13e9e22320efbd4dbf4009aa0a2e29；当前 canonical database/schema.sql 无 personalization。目标只在本 owner kokoro_bff schema 增 bff_personalization，不改 IAM.User.name/System/Project 或其他 owner 表。原19 mixed及以下全文bytes保留，本轮无DDL/数据读写/资源执行。

### 唯一表与本人查询

| 列/约束                                      | 目标与理由                                                                                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tenant_id / owner_id                         | TEXT NOT NULL且非空，已验namespace/userId；具名复合PRIMARY KEY(tenant_id,owner_id)。没有独立外部ID/生命周期的本人singleton采用自然owner key，无额外UUID。                        |
| nickname / occupation / about / instructions | 各TEXT NOT NULL，无隐式默认。空串是明确清除；具名CHECK char_length上限128/256/2000/8000，与HTTP code point一致。严格wire拒坏UTF-8/孤立surrogate/NUL，PG TEXT自身不接受NUL。      |
| revision                                     | BIGINT NOT NULL，具名CHECK 1..9007199254740991；wire为精确safe integer。0是未建行条件，不落库；首次1，每次成功CAS+1，上限拒写不回绕。PG int8字符串须验证合法安全范围才转number。 |
| created_at / updated_at                      | TIMESTAMPTZ(3) NOT NULL，创建时同事务时间，替换只更新updated_at，UTC。时间不当并发令牌，内部列不公开。                                                                           |
| 索引/完整性                                  | 复合PK覆盖唯一的本人精确读/条件写；无冗余index/FK/JSONB/软删除/status/关系表。无跨IAM FK/JOIN；当前Session在SQL前准入。                                                          |

全部SELECT/INSERT/UPDATE带受信tenant+owner，无跨人列表、搜索或Admin :any。缺行GET null/0且零写；损坏/越界Row报错，不以默认修补。只存当前四字段/版本，不保原文历史、请求正文receipt、语义hash或Redis副本。

### CAS、预算与未知提交

复用现PostgresBffDatabase.pool，一次有界leased client、事务LOCAL超时；不新池/全局预算框架。读用有界只读事务snapshot。首次expected=0用INSERT ... ON CONFLICT(tenant_id,owner_id) DO NOTHING RETURNING，一winner、零行409；expected>0用UPDATE ... WHERE tenant_id/owner_id/revision全匹配且未封顶 RETURNING，零行409，不read-then-write、不upsert覆盖。四字段/版本/时间同事务原子提交，无他表写入，generic receipt不参与；相同内容也不绕stale CAS。

route准入后单5s预算包含body/租用/SQL/提交/清理；LOCAL lock_timeout≤1s且statement_timeout随剩余收紧；迟到租用归还、取消/超时exact client退役、failed rollback销毁、listener/timer清理见TECH。Promise.race超时不等DB已停止；COMMIT发出后不明，不在旧连接查/重试，另fresh GET核实。成功必须COMMIT确认；response丢失不补写/偷用新revision重试。

冲突不附正文，无新审计表。结构化日志只记service/operation/request_id/trace_id/result/duration和安全版本/分类；禁四字段、完整request/response、parser/SQL原始错误与参数、token、正文digest（低熵hash亦泄露）。正常自有数据取证只交脱敏状态/版本/相等结果，不贴正文。

### 清除、保留与正常演进

显式PUT四空串清除当前四项正文，保单行/单调revision避免删除重建ABA；不声称物理擦除WAL/备份。无TTL/导出/批量后台读/账号删除流程；本事实保留至本人覆盖/清空或后继正式账号删除处理。IAM账号/租户删除后的orphan清理、备份retention/擦除承诺仍独立OPEN，不跨owner SQL扫User或假DELETE。本片不新增Agent读取/应用路径。

canonical用于新隔离owner schema fresh install，schema-governance同片新增表/约束；installer不改成自动ALTER。正常已有数据须Root按SQL手册另批具名additive演进例外/备份恢复/前置schema摘要/漂移拒绝/后置保全后受控创建本表；不对正常重跑fresh installer、reset/seed、私SQL或启动自建表。具体演进入口/ADR另卡，本轮不新迁移目录/第二canonical SQL；新源ready要求本表，缺表明确拒绝而非接口空成功。现IAM0.8/normal Web协调切换门同时保持。

Root后继真实PG验首次竞争/旧revision冲突/原子性/跨tenant+owner/重启读/清空/损坏失败/取消与COMMIT unknown/客户端回收；fresh catalog验schema归属/PK/check/时间精度/无FK及其他owner untouched。schema.sql/schema-governance原mixed只准本表窄增量，原删除候选不顺带集成。文档、单元替身、fresh install不证明正常演进与用户保存刷新通过。

<!-- R257-PERSONALIZATION-D0-DATA-END -->

## R257-ADMIN-BFF-D0：当前资格只读投影，无新数据事实（2026-10-06）

基线BFF6d46ec8；原19 mixed与以下旧正文保持。本轮只三D0前缀；database/schema.sql、SQL/Project候选、Redis与正常资源不变。

IAM User.platformAdmin/platformAdminVersion拥有资格及CAS；管理authority、当前User/Session、同tx Audit与具名CLI也归IAM。固定消费IAM0.8.0/d24aa2b697de59a350e8588720620df331bc5da5/internal artifact SHA256 0153a16f5c2779803d73d93d5533caf1b377d21299cefe01613d7cd1b2cbb194；BFF只得到当次成功会话的required boolean，不复制User表或跨owner读SQL。Root已报告owner隔离34/0与verify939/0，不等于正常schema已升级/帐号已授予。

- 本片无新增表/列/索引/外键/迁移/Redis键/receipt/outbox/retention，不增加权限持久化或授权结果缓存，不把platform_admin存入Conversation/Project/Session/Token身份副本。既有业务DB仍各自owner，不能因平台管理员绕过个人scope。
- SessionAdmissionResult成功显式required platformAdmin；现基础RequestContext不扩权限，具名AdmittedUserRequestContext在每次普通在线准入成功时承载必填布尔。service-only context没有后台资格，不以optional/默认false伪造owner判断，也不要求所有业务fixture机械带权。
- 管理入口投影限定fixed Web client+Product tenant；全局User资格不意味着任意tenant资源管理许可。组织Member只是原普通会话检查；角色/email/operator/financial不是来源。公开/me只加boolean，不暴露资格版本/管理者集合/审计。
- BFF每次从IAM current snapshot读取；无跨请求true缓存，无管理员JWT解析真源。Web显示状态须按subject隔离并在换人/退出/重核失败退休，迟到response不复活旧true；显示存储不授后台路由或命令权。
- 资格grant/revoke/Audit/unknown ACK均IAM管理用例负责，BFF读取不写Audit或补写资格。撤权后新检查false；此前snapshot可能先准入，不提供跨owner执行原子撤权或权限租约。
- 正常IAM已有User/Session的两字段演进是IAM/Root独立部署门：不使用fresh installer/reset/seed，不由BFF启动自动DDL。正常新旧严格schema必须按TECH同步consumer窗口切换；0.7/0.8缺/多字段均不做兼容回退。
- MCP本人Connection、Skills、Billing/financial、AG-UI与现所有数据生命周期不动。未来/admin各页CRUD/命令仍逐owner定义目标scope、权限检查、审计与事务，当前读投影不关闭这些业务任务。

本轮无source/schema/contract/generated/测试执行或正常帐号写入。后继验证现HTTP真假/撤权/并发窗口/取消与固定生成门，Root另做正常普通/管理员入口及每owner业务验收；本D0不是产品PASS。

<!-- R257-ADMIN-BFF-D0-DATA-END -->

## R257-MCP-BFF-D0：本人 Connection读取无本仓数据变化（2026-10-06；仅设计）

BFF ef2d3062e7503cb443d88a972804a98e9158a321；本轮仅三D0当前前缀，原文全部bytes及19项mixed保护，Project删除/SQL/installer候选不在此片。

Platform唯一拥有Connector/Connection/current authorization/全局Server。固定消费已提交9ab3b653360d04fb498a238659edeec01e72f62d的HTTP3.2.0，contract/openapi/platform-http.openapi.json SHA256 4b42dd161c972b3447cfea3a6f80a949bbdb573c46213dbf8ef4c3ecb58e72da；后继vendor与生成固定该完整commit。BFF只在单次GET /v1/mcp/connections验证和投影六字段，不建立本人Server表/Connection缓存，不复制owner predicate/SQL。

- database/schema.sql完全不变；无新表/列/索引/FK/迁移/事务/receipt/outbox/retention/Redis key，不安装/迁移owner库。
- tenant/subject只来自当次IAM已验RequestContext及owner受信请求，不从body/query/browser marker/日志取权，不存另一权限snapshot。既有workload token cache是运输，不缓存Connection资格；每次列表读current事实。
- connection_id不同于connector_id/server_id，同Server多个Connection保多项；registered Server不能推导某人已连接。不存假name/authorized/enabled、URL/secret handle/token/scope或原始错误体。
- cursor由owner绑定tenant/subject/surface/filters，以serverId+connectionId稳定keyset排序；BFF不解码/重签/二次排序。每页独立current snapshot，不宣跨页一致；跨actor/filter旧cursor拒绝，不假连续页。
- owner有界RepeatableRead中完整eligibility后分页；预算耗尽/损坏/未知失败，不partial200。BFF取消/timeout不写业务事实，不承诺瞬停owner在途SQL；迟到结果不得公开。
- Conversation/Message/Project/Skill/Server投影/AG-UI原数据生命周期不动。selected_mcp_connection_refs、创建/授权/启用/撤销/secret交付与Agent执行另卡；本人GET不写这些事实，不凭active暗示invoke授权。

资源验收由Root以真实Session A/B及owner关联/撤销/分页读证据确认；纯fixture/生成schema不是持久关联与完整用户连接功能证明。无合法自有连接只验empty，不正常seed/私SQL/preview造正控。本D0无DDL/source/资源/验证命令执行，旧suffix与其历史阶段保持，不冒已完成。

<!-- R257-MCP-BFF-D0-DATA-END -->

## R255：ScheduledTask anchor 与可空 next 投影数据边界（2026-10-05；仅设计）

BFF canonical目标只改现`bff_scheduled_task`两项：新增 `recurrence_anchor_at TIMESTAMPTZ(3) NOT NULL`，把 `next_run_at TIMESTAMPTZ(3) NOT NULL` 改为 nullable。anchor是规则选择输入；next是Scheduler对当前revision的确认投影。两者不得互填，next null不得以anchor、`created_at`、`updated_at`或应用时钟补齐。无migration/compat列/alias；fresh install与正规派生同片更新。

create在同一BFF事务冻结显式或缺省anchor、令next为null、revision=1，并写register outbox；patch只有显式anchor才替换它，任何frequency/time/timezone/anchor/enable/status变化均revision+1并先令next为null，再写replace outbox。disabled/paused/failed任务公开next固定null；恢复enabled+active仍须新revision的Scheduler确认。delete按现生命周期删除/墓碑与delete command处理，不接受迟到receipt复活。

不新增`next_run_revision`或sync状态列：现task `revision`与outbox `aggregate_revision`已经提供最小fence。register/replace成功settlement在一个BFF事务内同时：锁定exact outbox lease owner/token/fence，严格解析Scheduler receipt，锁task并要求tenant/task/current revision等于command aggregate revision，逐值验证Schedule name/rule/timezone/paused/next与callback body中的tenant/task/owner等于本命令请求，再写`next_run_at`并把outbox置succeeded。Scheduler `version`仅须是正规正整数并绑定该receipt；它是Scheduler owner版本，不与BFF revision直接相等。任一不匹配、过期lease、旧revision、畸形/缺失next或SQL失败整组不写；旧command可以按现失败恢复收束，但不能覆盖新revision。

outbox canonical payload把原`next_run_at`规则输入改为`recurrence_anchor_at`；它仍保存完整task revision、request lineage与幂等身份，不保存另一份日期算法。现ready/task/lease索引足够本查询，不新增表、索引、Redis key、跨ownerFK/JOIN或定时reconciler。Scheduler网络继续在事务外；BFF只在settlement事务存经验证projection。

首片持久事实的含义是“最近一次匹配当前BFF revision的command-confirmed next”，不是永久live Schedule。每次occurrence后的持续next仍待Scheduler受认证Schedule read/事件契约，并须在该后继契约中另行定义Schedule状态与BFF task当前revision/command identity的可信绑定，不能把历史receipt或Scheduler自身version当作这个绑定。合同未发布前不从callback加周期、不读Scheduler数据库、不发replace查询，也不宣称刷新后的值始终实时。持续读取与失效语义另卡，不在首片预建sync平台。

后继数据写集仅`database/schema.sql`、现schema installer/governance与生成检查、现scheduled repository/domain/ports/client/dispatcher及相关真实PG测试；公开机器字段同步唯一OpenAPI与正规contract门。当前无DDL、源码或资源验证完成。

---

## R255-BILLING-CONSUMER-D0：个人 Credit 读取无本仓数据变化（目标，尚未实施）

Billing唯一拥有Credit account与ledger；BFF只对固定owner v2响应做合同验证并投影到public read，不复制余额、流水、sequence、hold、grant、quota、价格或现金事实。本片不修改 `database/schema.sql`，不新增表/列/索引/receipt/outbox/缓存/Redis key/事务或retention，也不读取 `kokoro_billing` schema。

`available_micros`、`held_micros`、`delta_micros`、`balance_after_micros`与`sequence`始终作为owner decimal integer string保存在线路内，禁止转JavaScript Number、浮点或现金单位；`created_at`保持owner UTC ISO `Z`，cursor保持opaque。BFF不从ledger重算余额，不用空ledger推断零余额，不由404创建钱包，不以当前Web quota/free/daily字段补NULL或默认值。每次请求在IAM准入后由可信RequestContext生成tenant/subject u1，只存在于单次owner调用内，不持久化映射或凭据。

现BFF Project/Conversation/Message/Share/ScheduledTask、AG-UI、业务receipt与删除生命周期均不受影响。真实PostgreSQL验收只对Billing owner事实做请求前后只读摘要相等，并验证跨tenant/subject不可见；BFF schema fresh-install/hash必须保持。本D0没有SQL、资源或数据迁移动作。

## R251-SKILLS-V2-CONSUMER：无数据模型变化（目标，尚未实施）

Platform拥有manifest/profile与Validate事实；BFF只在owner响应和public wire边界严格校验、透传`zip-v2` identity，不持久化V1/V2映射、不从ZIP计算identity、不读取Platform数据库。此次consumer cutover不修改`database/schema.sql`，不新增表、列、索引、migration、receipt/outbox、Redis projection、权限或事务。

Conversation、Message、Share、Project、ScheduledTask及durable AG-UI的现有owner、锁、retention与幂等事实全部不变。当前Project删除等混合工作与本片无关，不得夹带；真实实现仍待后继源码/contract切片与资源验收。

## R241 rename 原子数据当前实现（2026-10-05；零 DDL）

本节替代下方 R240“没有生产 name writer/尚未实施”的旧时态：当前候选已实现具名 name writer，仍没有生产墓碑/DELETE writer；唯一 canonical schema、installer、ID/slug/instruction与其它关联模型保持不变。准确候选身份及 Root 资源收据见 CURRENT R241。

同一 checked-out client 事务现在执行可信 tenant/owner/canonical active Project FOR UPDATE→receipt→必要 name/updated_at 定列更新→终态200 receipt→COMMIT；scope/fingerprint沿已批定义。no-op不改任何Project字段含updated_at，旧key不覆盖新名，资格失败先于receipt。所选真双连接锁序、墓碑/owner×新旧key、receipt触发器异常、backend终止、真实COMMIT后调用者ACK丢失及同key恢复已验收，full-owner facts oracle限定只有合法目标变化。

取消窄修仅transaction-local100ms断链检查；原L6长SQL取消后PID消失/全回滚/精确client销毁与listener卸载/替换查询/同key恢复通过。事务结束恢复配置属于local=true语义，当前未直接实测同PID后继checkout的setting零外泄；不将其写成新增实证，也不承诺静默网络分区SLA。

本片无新表/列/version/CAS/DDL或跨owner SQL。C4/C5/F3/L4/L5/L7仍OPEN；Task/Storage/Run/Share/stream完整删除生命周期和真实用户组合仍待对应owner后继。

## R240 Project rename 数据设计（2026-10-05；零 DDL）

R241 取消窄修（待 Root 复测）：现 rename 的 BEGIN 后 timeout SQL 增加 `set_config('client_connection_check_interval','100ms',true)`，仅本事务生效、不污染 pool 后继事务且零 DDL，沿 exact-client 销毁回滚未提交事实；平台边界限 Linux/macOS 研发与 CI，其它 OS 未验证，未知 COMMIT 对账与原预算不变。

正式 `cdad0ad6580dcbca18b75fdfbdbac4aa61f750d2` 已有 nullable `bff_project.deleted_at` 与 owner_list partial index；该 active 前置满足 rename，无 canonical SQL/installer/表/列/索引变化。本片没有生产 name 或墓碑 writer。

后继用现 `bff_project` 与 `bff_idempotency_receipt` 的一个 client/事务：BEGIN→可信 tenant/subject/canonical ID/active 的 Project FOR UPDATE→receipt→必要 name/updated_at 定列更新→终态 200 receipt→COMMIT。保 ID/slug/instruction/所有关联；normalized name 相同则 Project 全列含 updated_at 不变，新 key 仍写一 receipt。不同 key 按锁串行的最后合法提交生效，无 version/ETag/CAS。

scope 为 JSON `[tenant,subject,"project.rename:v1",projectId,key]`；fingerprint 为 UTF-8 SHA-256(JSON `["project.rename:v1",projectId,normalizedName]`)。不调用事务外 claim/put/pending helper，不建 Map fallback。当前 active/owner 资格总在 receipt 前；同 key 异 normalized name 409，旧 key 只回原 ACK，绝不覆盖后来名称。腐坏/错资源/非 200 receipt 为存储 503，不重写事实。

未知 COMMIT 允许事实已提交而 HTTP 503；后续新请求重验授权并按原 receipt 对账，零额外 UPDATE。有限预算/连接处置见 TECH 当前节。Root 后继真 PG oracle：no-op 只多 receipt；重放/权限/非法输入失败全 owner 事实零差；中段异常全回滚；COMMIT ACK 丢失后只一提交；父锁改变 owner/墓碑后拒绝；rename 与 instruction 并发各自保字段。

本次未运行数据库测试；旧 active 的 217 资源门不是 rename 证据。Task/Storage/Run/Share/stream 的完整删除生命周期未完成，不引入删除三表、外 owner SQL 或公开 DELETE。

## R239 Project active canonical当前态（2026-10-05）

本节为当前已验证候选事实；下方R236为实施前设计记录，其“未实施/未验证”时态由本节替代，位置及边界说明仍有效。基线main 7289b3a4ae8f2df5c249350d59b9405c33fb4083，本地交付身份以本仓Git与Root收据为准，尚未启用用户3310组合。

唯一database/schema.sql现增bff_project.deleted_at TIMESTAMPTZ(3) nullable且无default，原owner_list同列序改partial WHERE deleted_at IS NULL；其它列、两唯一索引、slug/ID语义及表不变。六repository共25条件在现租户/owner和事务父锁边界内校验active；无外键、migration、新schema/版本表或删除三表。

Root真fresh catalog完整schema12项及完整真实集成217项通过；schema指定owner共存/安装失败回滚保留。fixture写墓碑不构成生产删除能力；独立Task、Storage、Run/Share/stream引用释放仍待后继。完整资源收据见CURRENT R239。

## R236 Project active canonical数据前置（2026-10-04；仅设计，未改SQL）

当前正式HEAD `7289b3a4ae8f2df5c249350d59b9405c33fb4083` 的bff_project没有deleted_at；20mixed已有未交付删除候选，不能由其存在推导正式schema具备该列。Root选择R235路径A，在HEAD基底的唯一 `database/schema.sql` 只新增 `bff_project.deleted_at TIMESTAMPTZ(3) NULL`（无非空默认），并把现 `ix_bff_project_owner_list(tenant_id,owner_id,created_at ASC,project_id ASC)` 改为 `WHERE deleted_at IS NULL`。这是同一索引的active查询范围，不新建重复索引；slug unique、name、ID及所有原事实/receipt保持。

业务资格为可信tenant+owner且deleted_at为空；非空仅用于资格排除，本片不提供生产状态writer/restore API。TECH R236所列6个现TS位置共25处现Project资格查询/更新加active：Project6、Chat10、Artifact2、Move3、ScheduledTask1、正式chat-turn-commit3。父锁查询在原同client事务锁内重验，更新保定列与原affected-row/错误语义；不改变锁序、事务隔离、重放或R217有限预算。Message仍沿正式outbox委派，保4.5秒总界及精确client listener/unknown销毁，不接mixed旧内联事务。

**数据验证：** 现 `test/schema-governance.test.mjs` 限定Project表块，并以真fresh安装后的catalog核列所属表、timestamptz(3)/nullable、原索引列序和partial表达式；证明其他owner schema保留、安装失败回滚、无FK/删除三表。HEAD安装器已读取唯一canonical schema，无需增加删除表存在要求；不建migration/第二SQL、缺列fallback、version、新状态表或Service/port。

现 `test/business-store.integration.mjs` 只在自有fixture Project行设置墓碑，验证API R236的HTTP/PG正负与权限零差；该fixture不是生产删除流程。保全部HEAD七个R217故障case，Root重跑fresh catalog、Message/Move回归与全owner门。锁后资格检查不等于已实现完整Project删除并发协议；未来生产writer仍须独立收口Conversation/Share/stream/dispatch。当前Task/Storage/Run删除生命周期和receipt内容保留治理未完成，不通过给所有后台表加EXISTS假装闭环。

本片仅独立active前置：零删除三表/command、installer改动、公开DELETE、机器合同/version/lock变更；R234 rename的name+receipt事务另片。源码与SQL尚未实施，当前无资源或测试通过证据。

## R217 Message 原子事实与失败窗口（2026-10-04；schema不变）

本切片不改canonical SQL、表、列、索引、约束或retention。单个Message事务继续原子写`bff_agent_dispatch_outbox`、两条`bff_message`、`bff_agui_stream`/queued投影与Conversation更新时间；`bff_idempotency_receipt`不是Message命令receipt且保持零增量。same-key authority是dispatch唯一键、`request_digest`及冻结Run/Message IDs。

中段SQL异常、真实backend终止、pool等待超时和四次scope变化耗尽总期限时，未提交事务事实为零；断链由PostgreSQL终止事务并销毁exact client，不向坏连接追加rollback。真实COMMIT成功但ACK丢失时已提交事实不可逆，坏client销毁后same-key读取同一canonical dispatch，不重复Message/AG-UI。Redis通知throw/late只影响best-effort wakeup，不回滚数据库事实。Root真实矩阵与完整182 PG/Redis门已验证上述窗口。Message有限准入切片已获Root验收；准确交付commit、Root gitlink与启用状态由Root CURRENT/progress维护，当前3310仍是旧组合。Project DELETE和跨owner最终投递不在本数据切片。

以下R213段是实现前的历史D0；现实现与验收状态以上方R217段为准。

## R213 Message 授权事实与事务边界（2026-10-04；目标，未实施）

Message admission不再在HTTP authorization层读取Conversation/Project。唯一事实判断位于现`commitChatTurn`事务：可信tenant/subject与active Conversation predicate，无锁pre-read只用于确定candidate/current Project；随后canonical Project去重排序并`FOR SHARE`，再锁Conversation `FOR UPDATE`重验current scope。故锁序为Project→Conversation，pre-read不构成相反锁序。首次client-created Conversation的Project必须在同事务解析且可见，否则rollback并报告内部Project-not-found；foreign/deleted/legacy Session为not-found。same-key immutable dispatch、Message、AG-UI registration、queued projection与Conversation更新时间仍原子提交，失败/期限耗尽全回滚且不得留下receipt或迟到写。

本片不改canonical schema、表、列、索引、DDL、retention或跨owner关系，也不增加授权缓存/影子表。

## R205/R189 Message scope 的事务数据边界（2026-10-04；零DDL）

唯一Conversation `project_ref`仍是归属事实；Message/dispatch payload在同一现有事务中冻结锁内canonical Project，receipt继续使用既有`bff_idempotency_receipt`。锁序为canonical Project ID排序`FOR SHARE`→Conversation `FOR UPDATE`，Move保持Project→Conversation，从而Message/Move两序线性化；失败全部rollback，same-key replay零新写。

本片基于`8e33bc0`唯一canonical schema，不读取`deleted_at`、不新增Project删除表/索引/Storage command，也不保slug fallback为第二归属事实。Project DELETE active fence与墓碑串行是后继独立切片。

## R176 Storage scope-release pin 的数据边界（2026-10-03；零 schema 差异）

固定 Storage `e8b9928` / `c22b...` 只新增生成的 wire 类型，不新增或修改 BFF 表、索引、receipt、Redis key或跨 owner关系。Storage仍独占 Asset/Blob/object lifecycle；BFF后继仅在自己的 command事实中保存稳定身份、投递生命周期和有界ACK计数，不复制Storage数据模型。

## R152 Move 持久化实现拆分的数据边界（2026-10-03；仅文档，未实施）

**当前事实与目标位置。** BFF `main 0333cd7c515846e977b1b05d8349e8c04d2a49dd` 的唯一 `database/schema.sql` 与 public `7.1.0` 已发布；`src/infrastructure/postgres/chat-repository.ts` 当前 979 行，内含 Move 租约/事务/重放，越 Root 800 行标准门（原 `a68cbe55` 为 671 行），这是本 Move 引入的架构 P1。目标在同一 `postgres/` 目录把 Move 事务与赢家重放归 `conversation-move.ts`，有界 PoolClient 生命周期归 `conversation-move-lease.ts`，严格 receipt Row 解析归现 `chat-repository-mappers.ts`；原 Chat Repository 仅委派，Application port 不暴露 pg。此为文件职责移动，不新增第二事实源、数据库表、migration、receipt 状态或外部 owner 查询。

**事务与物理不变量。** 继续使用同一 checked-out `PoolClient` 完成受信 tenant/owner/canonical Conversation 可见性与源 Project 解析、canonical Project ID 排序 `FOR UPDATE`→Conversation `FOR UPDATE`、归属更新与既有 `bff_idempotency_receipt` final 200 同事务提交。严格保持当前 SQL 字面值、参数绑定、source ID/slug 现行受信事实解释、scope/fingerprint 与 receipt Row 结构校验；同键冲突输家完整回滚后短事务重读赢家，no-op 不改 Conversation `updated_at`，UNKNOWN COMMIT 只返回 retryable 503 并销毁该租约、原 key 可由权威 receipt 恢复。Pool 获取、锁、每句 SQL、取消、迟到 client 归还及 rollback 均保现私有期限；目标不放宽 4500ms 内部预算/对外 5 秒、每轮锁 1 秒或最多 4 轮，不改变其他 Chat 操作的 Pool 行为。

**Schema/门禁。** canonical `database/schema.sql`、索引、列、owner/tenant 边界均不改；Root 后继须在等价源码上先核架构 800 行门，再重跑本仓 schema/contract/check/format 与同一完整真 PG/Redis 173 项、Move 真 HTTP/PG 9 项，检查锁等待、same-key 竞争、SQL 故障全回滚、unknown COMMIT backend discard/恢复和无资源泄漏。R146 下节是现已发布业务数据语义，R152 只是尚未实施的内部归位；它不关闭 Project DELETE、Storage release、Web 消费或原用户界面缺口。

## R146 Conversation Move 数据边界（2026-10-03；BFF producer 已发布，canonical SQL 未改）

**当前事实。** 已提交并推送的 BFF `main 284b5e04c4c09759787ef239b1a19fcdcd5ed8fa` 沿用唯一 `database/schema.sql`；此前 `main a68cbe55cde709f9b21f3d5803bfbd3ca5d14e2b` 是 public `7.0.0` 基线。canonical SQL 未改：`bff_conversation.project_ref TEXT NULL`，现可为本人 Project canonical ID、slug 或 NULL；`bff_project`以 `project_id` 为 PK、`(tenant_id,owner_id,slug)` 唯一，仍无删除墓碑；`bff_idempotency_receipt(scope TEXT PRIMARY KEY,fingerprint TEXT,status INTEGER,response_body JSONB,created_at)`承载最终200。已发布 Move 源码已用单一 `PoolClient` 将归属与最终 receipt 同事务提交；其他操作的外层 generic claim/put 不等于 Move 事务。Root 真 HTTP/PG Move 9/9、完整八文件 PG/Redis integration 173/173、Node22 `pnpm check && pnpm format:check` exit 0（741 pass、1 个既有资源 skip；contract 4 条已知 warning）；BFF producer 已发布，Web pin 与浏览器消费仍待验。本切片无 DDL 或新表，不冒称 Project DELETE 已实现。

**唯一 owner 与状态转移。** Conversation 归属由BFF写；Move仅把同一行 `project_ref` 从 NULL/本人源 Project（含历史 slug）置为本人目标 canonical `project_id` 或 NULL，并在值实际变化时更新 `updated_at`；同一 canonical 目标的新 key no-op 不改 row 时间或历史事实，只写新 receipt。成功触及旧 slug 的行规范为目标 canonical ID/NULL；不批量修其他行、不造 slug API alias 或兼容表。Conversation ID、Message、Share、Run/AG-UI ledger/cursor、Artifact association、已 admitted Run context均不改，无 Storage outbox、跨 owner SQL、复制 Asset/Blob或新索引。已有 `ix_bff_conversation_owner_project_updated` 可服务目标成员读取；最终性能要经真 PG 检查，非 D0 承诺。

**原子事务与锁序。** 单 checked-out `PoolClient` `BEGIN…COMMIT`：可信 tenant/owner/canonical Conversation ID预读 active 行，只为发现源 `project_ref`；将源 slug 解析为同 owner canonical Project ID；源/目标 Project ID 去重、按字典序逐一 `SELECT…FOR UPDATE`并核同tenant/owner（Project DELETE 墓碑落地后加`deleted_at IS NULL`）；再锁 Conversation `FOR UPDATE`，重验 active、tenant/owner以及当前源归属。若预读期间被另一 Move 改变，回滚并基于相同 key 做有界整命令重试；不得在 Conversation 锁后再拿 Project 锁。单事务更新归属/时间并写 `bff_idempotency_receipt` 的同一 scope/fingerprint/final 200 JSON，事务失败两者均不提交。receipt scope仍以现受信 identity+method+canonical route+key 的单一规则生成，不在 HTTP/SQL 各写不同拼法；目标值必须进入 fingerprint。同键重放先重新 IAM、核当前本人会话可见性，再锁/读 final receipt；异目标409，不使用 generic 事务外pending claim/after-response put。当前 receipt schema 无阻止此用途的 CHECK/唯一键，所以不推荐新 receipt 表或 SQL schema 修改；实现门仍应以真 PG 验证冲突与rollback。

**同PK并发。** 两个初次Move均看不到 receipt 时，不能靠预查防重；终态 INSERT 同 `scope` 主键发生 unique wait/conflict 后，输家必须回滚**整个**事务，绝不保留自己已写的 `project_ref` 或 `updated_at`。另开短事务，在重新 IAM/会话可见性确认后读取赢家 final receipt并比较精确 fingerprint：同义重放原200，异义409；若赢家回滚而无 final row，按原 key 有界重试整个命令。ACK 丢失也走此 final row；不新增 pending 状态、表或 schema。真 PG 双连接 RED 覆盖同/异 target、赢家回滚、ACK 丢失与输家零额外写入，source GREEN 前必须通过。

**C5 私有预算已实现并聚焦验真。** Move 的同一业务命令以单调总期限限定Pool等待、Project/Conversation锁、receipt唯一键等待、statement与最多4轮整事务重试，总计不超过5秒；每轮在`BEGIN`后、拿业务锁前设置transaction-local `lock_timeout`/`statement_timeout`，本地锁最多1秒且所有statement不超过剩余期限。超时事务完整回滚，既不更新`project_ref`也不留pending/final receipt；未知COMMIT只能按同key重读权威final row恢复，不能猜200。目标Project独立blocker的真PG RED/GREEN、连接回收及完整八文件集成已有Root证据，BFF producer 已发布；Web 消费仍待验，不改全局Pool或canonical SQL。

**Project DELETE 交错。** Move与后继 DELETE 都先锁 canonical Project 再锁 Conversation：Move先提交时成员集不再含原 Project；DELETE先提交时 Move 检查源 Project墓碑/Conversation active失败，不能返回成功。当前没有 Project墓碑，Move片不得假称已验证最终DELETE竞态；DELETE片发布时必须把 Project active fence 加到所有相关读写、Move锁内重查和双连接 RED/GREEN。反向 A→B/B→A 的多行 Move 对 Project 按ID排序，整事务有界retry；与发消息的归属读取必须在同一会话线性化边界，不能取请求body/query伪造项目。所有 SQL 限本仓 BFF schema，0跨owner FK/JOIN；无新表/列/索引/migration，现 canonical schema及 fresh install drift 门只用于证实保持原样。

**R146 D0 原先行真 PG RED 清单（历史阶段；下列并非全部已验）。** 三方向 A→direct、A→B、direct→B以及 no-op、旧slug源、same/different key与ACK丢失、会话/源/目标隐藏或删除、两个逆向 Move、Move×Project DELETE、Move×message提交、Project锁/Conversation更新/receipt写故障全回滚；检查 Message/Run/Share/AG-UI/Artifact行和 cancel outbox全字节/行数不变。当前 Move 候选已完成机器/source、聚焦真 HTTP/PG 9/9及完整八文件集成173/173，canonical SQL 未改；清单中的 Project DELETE 交错与其他未跑矩阵不因此算通过，Web 消费另门。

## R145 Project DELETE 目标数据边界（2026-10-03；未改canonical SQL）

**当前态。** `database/schema.sql`仍仅有可见`bff_project`，无`deleted_at`/Project删除receipt/Storage release outbox；`bff_conversation`已有`active|deleted`与`project_ref`，单会话删除事务维护Share、AG-UI、Agent cancel；`bff_scheduled_task.project_id`可空但任务独立。`bff_idempotency_receipt`通用claim/put不与Project业务写同事务，不能直接用作Project DELETE已提交凭据。Storage `main 2f855816347b56b3b8dd594366b001548441e0dc`已发布现Project scope生命周期/cleanup；具名Conversation release和Project合法Artifact graph安全释放仍是已审D0目标，未正式发布，BFF不能复制其Prisma/SQL或预钉工作树。

**原两项P1仍为producer行为/发布阻断，不由D0关闭。** 已审Storage目标是具名`ReleaseConversationScope`复用现永久scope lifecycle、全部Upload staging cleanup、Asset deleted/Blob retired与receipt；Project release增强为scope锁内完整Artifact graph验证。两个scope的合法Artifact都保最小审计身份清title，全部读/写/replay受released fence；损坏图`FAILED_PRECONDITION`整事务回滚。Storage尚未发布该行为、机器contract及真PG/Connect正反证明，BFF不得先写生成consumer或声称Project Artifact异常有新remediation RPC/表。下述BFF Project receipt与Project-scope row不能代替N个成员Conversation-scope稳定命令；BFF清关联/单Project ACK不证明全部资源logical released。机器门要按Storage正式身份确定N+1命令与可恢复聚合状态，图损坏显式blocked integrity anomaly，不冒物理GC；T-C05仍未验。

**目标唯一BFF事实。** 最小方案在现 `bff_project` 增 `deleted_at TIMESTAMPTZ(3) NULL`：删除时同事务清项目instruction/name/description内容，仅保可信tenant/owner/canonical project ID/原slug的不可恢复墓碑；原slug在该owner下继续保留预约，禁止重用后旧链接误指新项目。所有正常Project/成员/上传/发Run/ScheduledTask建关联的查询与写事务统一 `deleted_at IS NULL`；只有专门同keyDELETE重放/状态查询可以在受信scope内看墓碑。无FK/跨owner表引用/可编辑第二schema，不建migration兼容层。原slug保留的隐私与retention是Root机器/SQL门审核点，若不采纳则必须有等价持久预约，不能单纯删除行并允许复用。

建议Project聚合receipt承载**同事务固定HTTP 202结果**，并为锁定成员N个canonical Conversation scope及1个canonical Project scope各持久化独立稳定Storage后继命令。此前一条`bff_project_storage_release_outbox`只能描述Project scope，不能伪装包含N个Conversation命令；正式SQL的聚合/命令表粒度、唯一约束与索引在Storage发布后由Root机器/SQL门固定，不提前发明第二张可编辑owner schema或RPC字段。Project聚合每canonical `(tenant_id,project_id)`至多一份，封存owner/actor、原HTTP key/fingerprint、初次202安全响应及N成员ID集合；每scope命令固定受信scope/operation/command ID/digest、request lineage、`pending|leased|retryable|released|blocked`、attempt/available_at/lease/fence与稳定错误。`response_body`不含签名URL/文件名/对象key/用户Bearer；计数仅Storage真ACK后写并校验uint64。Project墓碑、固定receipt、冻结成员集合和**准确N+1命令**必须用同一`PoolClient`的`BEGIN…COMMIT`原子产生，缺任一方视损坏并失败关闭；同键重放先重验当次IAM并取原202，异义冲突，新key不建第二套。worker claim/settle用DB时钟、短lease/fence/CAS与有界重试，网络不持锁；崩溃/ACK未知逐scope复用原命令，全N+1真ACK才聚合logical released。

Conversation删除成员集合以锁定Project的canonical ID与原slug精确匹配同tenant/owner `project_ref`，按ID稳定排序加锁并在事务中冻结；已通过独立Move先行移出者`project_ref IS NULL`不入集合，Move 仅有未发布候选，不把 Project DELETE 或 Web 先移出能力当现功能。复用现单会话同`PoolClient` SQL完整生命周期不变量，避免只改`bff_conversation.status`遗漏Share/AG-UI/dispatch/cancel。Project instruction revision、Project skill与Project task同事务删除；Message、不可变AG-UI ledger按现retention保留且不可公开读；`bff_conversation_artifact`只是BFF交付关联，不是Storage文件owner。Storage Project scope是`tenant+project+canonical ID`，每个成员Conversation另有独立scope；同hash personal/其他project Blob是不同scope事实。BFF不写Storage Asset/Blob、不能推断跨scope引用或用逐条ListAssets代替Release。

独立ScheduledTask仍是BFF自身事实，不能随Project row删。**待用户异步答复**的两规则是推荐同事务对`project_id=P`任务清关联、暂停、revision+1并写现Scheduler`replace`outbox，或要求用户先处理关联任务才接受Project DELETE；不可假定前者已定。task/历史都保留，旧callback须由project context/revision/active fence拒绝，已admitted Run不能据此标terminal。该答复只挡最终关联事务/public DELETE，不挡Storage机器、Chat helper及N+1持久后继的独立切片。

Storage每个scope目标logical release若获真ACK，相应命令才记`released`，**N+1全部ACK**后Project聚合logical状态才released；任一坏graph blocked或未知ACK pending均不掩盖。Storage已签PUT/GET的有效窗口与晚对象清理可保持owner durable`pending_observation`，所以BFF对外`physical_cleanup_state=pending`只表示未获物理终态证明，不写虚假physical-complete。无BFF对象cleanup表、Blob refcount复制、跨owner事务或第二角色。fresh安装/漂移门需核新增列/表/唯一键/CHECK/索引、0FK、Project/Conversation/Task rollback、并发锁序、N+1完整性及outbox重启重投；本节没有执行这些测试。

## R133 当前切片 Root 验收事实（2026-10-03）

HTTP5 正式消费、public7 过程契约、两 canonical process 表、同事务 RR 快照、immutable anchor 分页、START 与分批 GC 完整性切片已由 Root 复验。真实 PG/HTTP：15 焦点和完整 74 项全部通过、0 skip；完整默认纯门 736 pass/1 既定 PG schema resource skip，四 pure 149 pass；format（含全部变更 TS/MJS）、lint、typecheck、build、全 contract pipeline 与 233 contract tests 通过。最新证据：资源19016f31、纯门7c8284b1、contract f7e3519c；两独立限定源码审0/0/0。

两个 fixture 的时间戳/umask 假前置及 public7 Snapshot 示例缺字段已修并真实复测。当前 contract lint 剩4条 warning：3条 conditional-schema局部 required-properties提示、1条既有特殊操作无2xx提示；不称零warning或整个owner集成通过。下方“5条全既有/待Root”是历史阶段，不作为最新状态。集成提交身份以本仓 Git 与 Root progress E108 为准；Web7消费、当前真实浏览器、外部模型、正规积分及完整BFF其他资源/镜像验收仍未完成。

以下为此前阶段与已批准技术方案。

## R132 snapshot example 更正候选（2026-10-03，待 Root 复验）

Root 复核确认下方把 5 条 contract lint warning 全记为既有并不准确：其中一条是 public7 snapshot example 缺少 required 安全过程，而非数据模型或 canonical SQL 缺口。本片已补同一 active Run 的四字段 example，schema、事务与 GC 语义不变；实际剩余 warning 数与通过状态等待 Root 重跑后记录。

## R132 canonical process 数据本片 Root 验收事实（2026-10-03，Git 发布待 Root）

两张 canonical RunProcessProjection 表、同 source/frame/HWM 事务投影、RR immutable as-of page、START successor 保留与 provenance/partial-GC 已完成本片有限验收。证据绑定资源 `19016f31`（15 焦点与完整 74 全通过）、pure/default `3b926e2d`（149 pure；default 736 pass + 1 既定 PostgreSQL schema resource skip）及完整 format/contract `4811c5e9`（233 contract pass / 0 skip，保留 5 条既有 lint warning）；两次 R131 独立源码终审均为 0/0/0，原 timestamp 与 permission fixture 失败经窄 ACK 后已复测关闭。BFF7 Git 提交/推送仍待 Root；本片不构成全部 BFF 业务、其余资源、镜像、用户 Web/浏览器、真实 provider/外部模型或正式积分验收。

## R129 provenance / GC 当前候选（2026-10-03，待 Root 资源验收）

canonical schema 不变。读取在同一 RR snapshot 中核 compact 的全部 current provenance 与不可变 ledger/source 双向集合；旧 anchor 只决定返回值版本，不跳过 current provenance 完整性。GC 沿现锁后重查与 retention 规则保留仍有任一同 Run ledger frame 的 process/activity compact；全部同 Run frames 回收后才清 compact，START 的既有 cursor+tombstone 与 stream retention floor 提供中间态 410 证据，不新增表或长期 pin。

## R126-GREEN-C 当前数据候选（2026-10-02，待 Root 资源验收）

canonical SQL 已加入 `bff_agui_run_process` 与 `bff_agui_run_activity`，安全 Todo/activity 与 source/frame/HWM 在同一 projection 事务写入；immutable ledger 负责 as-of page，compact rows 负责当前完整性与 GC provenance。退役 `tool_call_ids` 已删除。静态schema门已通过；fresh schema、并发 rollback 与 GC locked-requery 仍待 Root 真实 PostgreSQL 验收。

## R123-GREEN-A 当前数据事实（2026-10-02，待 Root 最终全门）

Agent HTTP5 safe process 已在 reader/decoder/projector 边界实现，但本片没有修改 canonical SQL、事务、compact process rows、锚定分页或 GC。public machine 仍为 `6.0.0`；下方两表、同事务 CAS、immutable ledger as-of 与 retention 保护仍是已批准后继目标，不是当前数据库事实。

## R123-BFF-HTTP5-D0：RunProcessProjection 与锚定 ledger page canonical SQL目标（2026-10-02，未实施）

当前唯一canonical `database/schema.sql` SHA-256仍为
`e5538a55d3d851b011e5c330632133bf94838b7cac88c4bdedcb36089f666b75`，本D0未改SQL。Agent DB、Redis和browser都不是BFF read model；禁止跨owner SQL/JOIN/FK。目标只增加两个BFF表，不建cursor表、revision表、migration目录、连接池或worker。

### 两个具名表与精确列

**`bff_agui_run_process`**（一Run一Row；durable START与Todo）：

- scope/identity：`tenant_id TEXT NOT NULL, session_id TEXT NOT NULL, run_id TEXT NOT NULL, subject_id TEXT NOT NULL`，PK `(tenant_id,session_id,run_id)`；`projection_schema_version INTEGER NOT NULL DEFAULT 1`。
- START provenance（全部NOT NULL）：`start_source_owner TEXT, start_source_event_id TEXT, start_source_sequence BIGINT, start_source_digest TEXT, start_source_occurred_at TIMESTAMPTZ(3), start_public_sequence BIGINT, start_public_cursor TEXT`。
- Todo：`todo_observed BOOLEAN NOT NULL DEFAULT FALSE, todos JSONB NULL, todo_digest TEXT NULL`；nullable provenance列为`todo_source_owner TEXT, todo_source_event_id TEXT, todo_source_sequence BIGINT, todo_source_digest TEXT, todo_source_occurred_at TIMESTAMPTZ(3), todo_public_sequence BIGINT, todo_public_cursor TEXT`。
- audit：`created_at,updated_at TIMESTAMPTZ(3) NOT NULL`。`todo_observed=false`强制todos/digest/provenance全NULL；true强制todos为array且完整provenance非NULL。应用层再做100项/Unicode scalar/65536 raw JSON精确门。

**`bff_agui_run_activity`**（一Run/activity当前安全Row）：

- scope/identity：`tenant_id,session_id,run_id,activity_id,subject_id TEXT NOT NULL`，PK `(tenant_id,session_id,run_id,activity_id)`；`projection_schema_version INTEGER NOT NULL DEFAULT 1`。
- current value：`activity_kind TEXT NOT NULL, safe_payload JSONB NOT NULL, payload_digest TEXT NOT NULL`。
- first provenance全部NOT NULL：`first_source_owner TEXT, first_source_event_id TEXT, first_source_sequence BIGINT, first_source_digest TEXT, first_source_occurred_at TIMESTAMPTZ(3), first_public_sequence BIGINT, first_public_cursor TEXT`。
- latest provenance全部NOT NULL：`latest_source_owner TEXT, latest_source_event_id TEXT, latest_source_sequence BIGINT, latest_source_digest TEXT, latest_source_occurred_at TIMESTAMPTZ(3), latest_public_sequence BIGINT, latest_public_cursor TEXT`；另有`created_at,updated_at TIMESTAMPTZ(3) NOT NULL`。
- index `(tenant_id,session_id,run_id,first_public_sequence,activity_id)`服务当前态稳定顺序。CHECK只约束类型/ID/payload object/positive safe integer/first≤latest；closed union/presence/Unicode由唯一decoder复验，不在SQL复制第二套复杂schema。

不把Todo拆item表，因为owner是完整表原子替换；不把activity集合塞process JSON，因为会无界整行重写；不新增activity revision表，因为as-of历史的唯一事实已是不可变`bff_agui_event`。

### 写事务、replace与START选择

- `commitProjection`沿Conversation→stream→dispatch锁序，锁stream并核version/lease/fence。对连续source：strict decode→source identity→safe frames→process/activity helper→Message/HITL/Delivery；最后CAS推进HWM/version。任一失败整批rollback；Agent网络在事务外。
- `RUN_STARTED`在同事务insert/upsert process START anchor并更新stream最新START；Todo整表replace；activity按activity_id覆盖current value并保first provenance。相同source+digest replay no-op；相同identity异digest冲突。
- 不设activity transition CHECK/reducer：later合法source可以改变phase/status、terminal后再发合法status、同activity换preflight或其他union字段；只保持first provenance用于排序，latest provenance/value替换。
- `agui-consumer-registration.ts`接受successor queued时不得把上一`latest_run_start_sequence`清NULL；只有新Run的durable START提交才覆盖。原version/fence/lease/failure/subject条件不变。

### 授权RR与锚定page查询

snapshot RR先读Conversation授权与ledger head anchor，再分别读FIFO head和`start_public_sequence <= anchor`的最近process；因此从未START为null，terminal及successor queued仍选旧process，新START才切换。process START/Todo/activity provenance必须同scope/run、≤source HWM且≤anchor，并匹配source ledger与safe CUSTOM frame；safe frame存在但row缺失为503。

历史Run第一页与continuation的activities都不从mutable latest rows直接分页。`agui-process-page.ts`在同一RR内：

1. 在`bff_agui_event`筛选当前scope、selected run、`CUSTOM/kokoro.activity.updated`且`public_sequence <= anchor`；
2. 按activity_id求first public sequence并取截至anchor最后revision；
3. 以`(first_public_sequence,activity_id)`稳定排序；optional cursor省略时从该历史Run第一页开始，存在时在当前scope/run解析到after activity并复得其first position；
4. 拉`limit+1`并累计序列化process page对象（Todo、activities、cursor等）的bytes，最多100项/1 MiB；该预算不含session snapshot的Message/Delivery等其他字段。返回最后已发activity对应的opaque ledger cursor；anchor后的update不参与；单条超限typed 503。

request必须给opaque watermark；previous opaque cursor可省略（第一页）或提供（continuation）。DB内部可以解析其public sequence，但wire不返回/编码source sequence、public sequence、digest或fence。unknown/foreign/malformed为400；cursor/anchor tombstone或低于retention floor为410；缺frame/compact/provenance为503。Todo按同anchor选最后revision，不能拿anchor后的current process值冒充。

### GC引用、retention与删除

不发明保留天数，也不设客户端永久refcount。现GC locked candidate/requery必须使用同一effective boundary并建立projection reference集合：

- 当前selected Run（包括terminal且successor仅queued）的START；
- selected process截至current anchor的最新Todo和每个current activity provenance/frame；
- 现HITL、Delivery、Message和其他既有安全引用。

locked requery对上述引用集合计算逻辑refcount；refcount非零的frame/source不可删，不新增易漂移的计数列或第三张引用表。新Run START后，旧Run只有在不再selected/live/queued且其source/frame越过已批准retention boundary时，才在同一受锁GC切片删除compact row并回收ledger；不得删share事实。public page cursor不无限延长retention：被回收cursor写/保现tombstone并返回410，绝不改读最新Row、从0 replay或猜空。

### schema门与后继切片

先行GREEN-A不改本SQL。SQL/public切片必须同步`database/schema.sql`、schema governance、fixture表清单、installer/catalog drift；生产写集为现`agui-projection-repository.ts`、`agui-consumer-registration.ts`、`agui-consumer-repository.ts`、`chat-repository.ts`及新`agui-process-projection.ts`、`agui-process-page.ts`，不另建postgres模块。Root用fresh空`kokoro_bff` schema验证列/NULL/CHECK/index/零跨owner FK、rollback、两个连接CAS、101 activity锚定分页、terminal→queued→START、GC locked requery与精确资源回收。

当前Root RED为build 0及四pure 148/120 pass/28行为fail/0skip，只证明待修缺口；未新增表、未运行schema/PG/Redis，不能声称public7或projection完成。

---

## R83-BFF-DIRECT：Conversation collection filter / public6 数据 D0（无 DDL，未实施）

Owner 是 BFF Conversation。当前 `listConversations` 在 tenant+owner+active 与可见 Project EXISTS 后使用 `($3 IS NULL OR project_ref=$3)`；authorization 丢弃 direct，故 undefined 同时表示 owner-wide 与 direct。目标以显式 collection filter 消除该歧义，不改变 `bff_conversation.project_ref` 事实、NULL 含义、Project owner 关系、删除 tombstone、排序或 cursor 编码。

目标查询语义：all 不增加 project_ref 限制；direct 增加 `project_ref IS NULL`；project(P) 增加参数化 `project_ref=P`，并保非空 project_ref 必须解析到同 tenant/owner active可见 Project 的现 EXISTS/前置授权。任何分支都保 `tenant_id`、`owner_id`、`status='active'`；其他 subject、其他 tenant、deleted、引用非本人/缺失 Project 的行不进入结果。direct+非空 project_ref 在 SQL 前由 HTTP 400 `invalid_scope` 拒绝，不定义数据库优先级。

过滤必须先于既有 continuation：`updated_at < cursor_timestamp OR (updated_at = cursor_timestamp AND conversation_id > cursor_id)`，随后 `ORDER BY updated_at DESC, conversation_id ASC LIMIT limit+1`；next_cursor 只从过滤后多取的一行决定。all/direct/project 换过滤器时消费者弃 cursor；数据库与 wire 不存 filter identity，不新增 snapshot 承诺。

唯一 canonical `database/schema.sql` 全字节保持；现 active owner 与 owner+project keyset indexes 先保留，无 table/column/CHECK/index/migration/data repair、跨 owner SQL、Redis key 或 cache。后继只有真实 PostgreSQL EXPLAIN/门禁显示目标查询不满足预算时，才另立数据设计，不在本局部修复预建索引。

真实 PG RED/GREEN 使用同 owner D1/D2、Project P 的 P1/P2、Project Q 的 Q1，另建同 tenant 其他 subject 的 direct/project 行、其他 tenant direct 行、deleted 与无本人 Project 行；跨 D/P/Q 固定同毫秒 tie。limit=1/2 遍历 direct 只得 D，omitted/empty 得 owner-wide D+P+Q，P/Q 各自隔离，末页 null 且无重复/漏项；故障/清理只操作 Root 自有临时数据库，不清 Redis DB8 或共享数据。

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

| 字段组（后继canonical目标）                                                       | 类型/NULL/职责与约束                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tenant_id、session_id、run_id、subject_id                                         | TEXT NOT NULL；前三列 PK；subject 来自已锁 active Conversation/stream/dispatch 一致身份，不从 source payload自报                                                                                                                            |
| projection_schema_version                                                         | INTEGER NOT NULL，值1，命名 CHECK；表示 BFF projection envelope，非 Agent HTTP/public版本                                                                                                                                                   |
| interaction_revision、pause_revision、pause_ref、phase                            | BIGINT NOT NULL 正 interaction revision/非负 pause revision；pause_revision<=interaction_revision，pause_ref TEXT仅在revision0为NULL，其余非空；phase TEXT NOT NULL CHECK active/waiting/resuming/terminal                                  |
| groups                                                                            | JSONB NOT NULL array，保存固定owner版本的原序 full collection，display/input_schema为受限外部schema；phase waiting/resuming要求非空、pause_revision>0，active/terminal明确空                                                                |
| action_command_id、action_pause_revision、action_kind                             | TEXT/BIGINT/TEXT 同空同非空；kind为owner accepted/native_consumed/validation_failed/unknown/cancelled，action revision正且<=pause_revision；resuming须accepted/unknown且action revision=当前pause；waiting validation_failed须引用更早pause |
| interaction_digest                                                                | TEXT NOT NULL lowercase64hex命名 CHECK；对完整六字段规范化JSON计算SHA-256，对象键递归排序、数组保序、optional字段存在性保留；同revision内容冲突不因不同source ID放行                                                                        |
| source_owner、source_event_id、source_sequence、source_digest、source_occurred_at | NOT NULL；owner固定kokoro-agent，source ID非空/sequence BIGINT正/digest lowercase64hex/UTC TIMESTAMPTZ(3)，与现source ledger同事务绑定，不复制 private source payload                                                                       |
| public_sequence、public_cursor、created_at、updated_at                            | BIGINT正/TEXT opaque cursor/UTC TIMESTAMPTZ(3)；每个接受的更高full revision绑定一个CUSTOM frame，created_at不覆盖，updated_at仅真实replace更新，no-op不改                                                                                   |

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

| 事实                   | 原行                                                                                  | 新行 / 改写                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| user Message           | 保留原 `message_id`、原 `run_id`、content/status/sequence                             | 无新 user，不改写原 run                                                                                                                                    |
| failed assistant       | 保留原 assistant/run/content/verified safe failure                                    | 不改写，仍可审计                                                                                                                                           |
| retry assistant        | 无                                                                                    | 新 `message_id`、新 `run_id`、`role='assistant'`、`status='pending'`、空 content，failure 两列 NULL，`message_seq=MAX+1`                                   |
| source dispatch outbox | 必须绑定原 user/assistant/run，`status='succeeded'`，严格 payload                     | 保留不变                                                                                                                                                   |
| retry dispatch outbox  | 无                                                                                    | 新 outbox/run/assistant/request/identity；`user_message_id` 复用原 user；`status='pending'`；`conversation_dispatch_seq` 等于新 assistant 的 `message_seq` |
| AG-UI stream           | `expected_run_id=terminal_run_id=old_run_id`；`latest_run_id` 可为 NULL/其他旧 marker | 同事务 register 新 expected run，version/fence 增长，terminal/start marker 按现 registration 清空，旧 lease 清理                                           |

新 outbox 冻结原 payload 的 content、requested model、agent、thinking、ordered Skill source refs、MCP
servers、project 和原 user ID，只生成新 request/run/assistant/outbox/identity。Agent owner 发布后，launch 还必须带
typed `retry_of_run_id=source.run_id`。BFF 严格解析原 persisted payload，不从 Message content 反推配置，
不从 HTTP body 重建冻结选项。Agent `4.0.0` 已是 owner 四文档冻结的目标设计候选，但尚未
实施/发布，当前仍无可 pin 的 artifact；不得在 BFF schema 中预埋未发布语义。

### 持久 envelope v3 与双 producer lineage

零 DDL 不等于持久 JSON 不升版。Agent 4.0 的 `retry_of_run_id` 是 required nullable，所以 BFF 两个
Agent launch producer 必须在同一 consumer cutover 升级：

| persisted fact                                                        | 当前                                                       | 目标 v3 不变式                                                                                                                                                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bff_agent_dispatch_outbox.payload`                                   | `schema_version=2`；launch 无 parent                       | `schema_version=3`；顶层仍 exact `{schema_version,launch}`；`launch.retry_of_run_id` required，normal 为 JSON null，retry 为非空 target run；canonical digest/parser/row lineage 都包含该值；v2 fail closed |
| `bff_idempotency_receipt.response_body` 的 Scheduler dispatch receipt | envelope `schema_version=2`；Snapshot Agent body 无 parent | envelope `schema_version=3`；envelope/snapshot/launch/body/trace/receipt 全部 exact closed；Scheduler 是 normal producer，所以 `retry_of_run_id` 必须存在且恰为 null；v2 fail closed                        |

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

| writer                                          | status   | failure 列                                  |
| ----------------------------------------------- | -------- | ------------------------------------------- |
| strict verified Agent `run.failed`              | `failed` | 同一 source projection transaction 写二元组 |
| Agent `run.completed(status=cancelled)`         | `failed` | 两列保持/显式设为 NULL                      |
| BFF dispatch permanent failure                  | `failed` | 两列保持/显式设为 NULL                      |
| Conversation delete 对 mutable assistant 的终止 | `failed` | 两列保持/显式设为 NULL                      |

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

## T-K03.4 Validate identity 无数据变更（2026-10-09）

本片只纠正 BFF 对 Platform owner 返回的 canonical identity 值域：当前 `skill-md-v1:sha256:<64 lowercase hex>` 与正式 legacy `zip-v2:sha256:<64 lowercase hex>`。BFF 不计算、不转换、不 trim、不持久化该 identity，也不新增表、列、索引、migration、receipt、缓存或镜像；现 package、Skill、安装、Share/usage 与非 Skills 数据均不变。

<!-- T-K03.4-BFF-CANONICAL-IDENTITY-END; complete original body follows -->
## R357-BFF-BOUNDARY-AND-ORACLE D0：无数据变化（2026-10-09；修订边界）

`SkillSpecificationService` 的跨owner一致性、过滤、聚合及下载确认继续是 BFF application规则；application types 单源移动不产生持久 DTO；Platform façade只做transport解码，不新增持久事实。无表、列、索引、schema、migration、SQL、Redis key、receipt、缓存、owner或retention变化；不得为职责拆分建立Skill镜像、持久DTO或第二套wire模型。

<!-- R357-BFF-BOUNDARY-AND-ORACLE-DATA-D0-END -->
## T-K03.4 current-user profile has no BFF persistence (2026-10-09)

This extension creates no BFF-owned identity fact. IAM remains the only writer for User display name and image. Each admitted `GET /v1/me` resolves exactly one current-user ref from IAM and projects either the fresh `found` values or the explicit owner `missing` state in request memory only. BFF does not store the profile in PostgreSQL, Redis, a process cache, Conversation/Project rows, an outbox/receipt, or a Web session/cookie, and it does not derive a replacement from user id, email, tenant, site brand or prior responses.

Therefore `database/schema.sql`, all existing tables/columns/indexes, transactions, retention and fresh-install checks remain byte-for-byte unchanged. There is no migration, backfill, cache invalidation, consistency window or new data deletion path. Tenant and subject are still taken only from online IAM admission; the resolver request is fixed to that same tenant and exact subject, and strict identity equality prevents a returned profile from being attached across users or tenants. `missing` is an owner observation for that request, not a persisted tombstone. Dependency failure yields no profile snapshot and no write.

## R357 Admin IAM bridge data boundary（已实施的首个 read slice）

IAM remains the authoritative owner of tenant membership, invitations and roles. The three Admin Identity reads create no BFF table, SQL query, schema change, Redis entry, cache, local audit mirror, outbox or receipt. The only per-request data is the already admitted actor context, fixed request metadata and bounded owner response. Denied, aborted, timed-out, malformed or authorization-failed reads write nothing locally.

<!-- R357-ADMIN-IAM-BRIDGE-DATA-D0-END -->
