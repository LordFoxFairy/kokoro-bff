## R356 普通 Skills 生命周期 Public11 预激活纠正（2026-10-09）

唯一当前契约为 Public11.0.0，同 `/v1`、132 operations。普通 CreateVersion 只接 strict metadata，不接收或转发 expected_state_version；Platform 在事务内核当前主体/owner与 active/disabled base，分配新 revision 并创建独立 draft/stateVersion=1，不改 base。普通 Withdraw 实际修改原 Skill，严格要求当前 expected_state_version；原 key/body、digest、receipt、current IAM、取消与绝对预算保持。Admin version、Publish 及其他真实 CAS 不变。

Root 将未正常激活的 beta 以唯一 corrective major 修正；首次公开激活后的 breaking 策略保持。当前机器只改这两个普通输入与 version，先精确逆回完整 Public10.0.0 SHA2f98f529bda413912b5c15e6de45db7cdadf0e0bc51fd5de44818db9727efbb8，再运行全部原 Public9.0.1/8.10 历史门。无 owner 契约、表、Schema、依赖或新框架；DATA_MODEL/canonical schema 原字节保持。消费者等待 Root 正式提交再固定生成；源码验证不代表真实组合、正常激活或 Skills 页面完成。

<!-- R356-LIFECYCLE-PUBLIC11-END -->

## R356 Publish Public10 预激活 corrective cut（2026-10-09）

首次正常对外激活前，Root裁决将未正常激活的 beta Public9 Publish 修正为唯一 Public10.0.0，同 `/v1`、132 operations，无 `/v2` 或零body fallback。Publish 严格 required application/json `{audience, expected_state_version}`，复用既有 SkillAudienceRequest；ordinary current IAM/tenant、fixed PERSONAL、固定 command/key/digest/CAS、取消预算和 strict response/header 保持。正式对外发行后的 breaking-major 策略不变，本裁决不授权以后静默破坏客户端。

Platform仍唯一拥有 Skill状态/receipt/发布；BFF只转当前正式wire，不读取owner数据库、不新建表/Schema/依赖。DATA_MODEL现有零持久变化边界与本技术/API门一致，原数据设计字节保持。机器 current10先核完整 Publish，再逆为exact Public9.0.1 SHA4ad3a0553d3b45a78fdd53c857ad66c25b1baa3d53c3af619333d70fefcad5db，继续原Public8.10及历史父证明。消费者必须等Root正式commit后正规固定生成；正常服务、真实组合、浏览器和S01–S10仍待Root，不以pure结果宣完成。

<!-- R356-PUBLISH-PUBLIC10-DESIGN-END -->

## R353-B2 当前源码候选（2026-10-08；待Root冻源审查/真实配对）

唯一 BFF writer 为 bff_skills_product_source_r353；工作树 HEAD d2695c47bca64a8e83168aa259e2366f7cee3ea8。当前唯一 Platform固定fa185ed2b25c3e81946cfdcd12d7665d02b8bad3、Product1.2/HTTP5.2/63RPC/32commands/24proofs、完整81正式publication；aggregate ce7708d7e2a15d7e3a77b7b9ea45905ab3fbe90093e343d0be9b3140ca03e2d6、descriptor 453f275b6e95052437072c3f52bbe74675271400526680003569b6bd09196fb1、HTTP 6d4abae68cd5cc6e2d8676ac34a48f7ea3564196ec6215ea1531b3cfedd3c3d7。HTTP直接读同Platform vendor/openapi；原701候选72副本移除，无双pin。IAM7c62e759760448e127b21200f87adeefdc6016f7/0.10、Storage d13f33a/v3继续原正规固定生成；不升级其它owner。

Public唯一9.0.0/132operations，具名Product checker先核完整当前closed blocks，再剥本片还原完整Public8.10字节SHA640f47f9c70341aa49934eec319a4dcc5bab76bba83e4407d6a9e0c3ab0ac389并运行全部旧父证明。机器/纯门只证明本源码；正常Storage旧源版本资格、真实IAM/Platform/Storage/Agent配对、provider、普通/管理员浏览器与S01–S10由Root继续验证，仍OPEN。未运行数据库/资源/服务/正常激活，不以fixture为integration或UI完成。

### 放置与依赖（沿既有整体设计，不建新计划）

|项|当前决定|
|---|---|
|Owner|BFF既有Skills public编排；Platform唯一Skill生命周期/来源/包/封面owner，IAM身份与publisher，Storage对象，Agent执行。|
|当前事实/目标|现server/runtime/auth/clients/routes承接完整Product消费，保B1 Share/usage和durable AG-UI；手工draft、AI真实artifact、GitHub真实包归一既有owner命令。|
|目录/粒度|选择现http/routes与infrastructure/clients具名普通文件；淘汰通用workflow/metadata模块、跨ownerRepository和镜像表。github-skill-metadata.ts仅真实frontmatter解析，github-skill-import.ts仅网络/ZIP。|
|依赖|Browser→Web→BFF→正式owner；无ownerSQL/ORM引用，无浏览器直连GitHub或Storage身份冒充。|
|数据/API|既有BFF receiptCAS/Share/usage/artifact association；Public9一次消费、普通/专用admin machine凭据隔离，无flag/fallback/alias。|
|删除|无正式owner的quota/revisions与替代旧wire/v2运行生成、老71Platform+1HTTP候选副本。|
|验证|Node22.22.2 lint/typecheck/build/format、固定生成check、默认与contract测试、父逆向负控；真实配对与隔离PG/Redis/ObjectStore/provider/browser由Root执行。|

请求首await前建立唯一monotonic绝对预算，IAM admission、凭据/token、owner RPC、body、I/O与enrichment共用剩余时间；取消/超限closed response，无迟到响应覆盖。目录/安装/managed/published严格requiredcategory/product/examples/updated_at，IAM每页批量去重profile解析、missing显式、不凭raw id猜名。admin专用platform:skills-admin.manage且当前IAM skill.admin，普通catalog/projection凭据不授管理员。

AI必须重读BFF自身completed来源event与immutableconversation-artifact关联、Storage final/CLEAN真实包spool全SHA/size，IO后复核同关联/资产/session。GitHubpreview仅canonical公开https://github.com/owner/repository与可选path；固定api.github.com公开repo/default_branch→真实fullSHA→固定codeload同SHA有界ZIP，禁止redirect/private token/任意host。根SKILL.md优先，否则唯一合法目录；多候选明确选path。js-yaml4.3.2（MIT）正式runtime、@types/js-yaml4.0.9，FAILSAFE_SCHEMA、字节/深度/节点界限，duplicate/customtag/cycle拒绝。真实frontmatter name/description→display_name/summary，真实可选tags/examples/category，不从仓名/正文猜。Preview返immutable selector/metadata/hash/size，Import只收selector、再次fetch同SHA/path并重新解析metadata，不信browser metadata；复用原receipt闭集，不增加阶段。

包handoff现receipt frozen→admitted→selected→201；first snapshot/CAS完整身份，PUT返回原样opaqueVersion，Complete之前selected持久化；ACK不确定精确readback，不从owner locator重建缺失checkpoint。GitHub创建provenance省asset_ref，实际draft包upload后产生；AI原artifact asset_ref仍required。Begin重放使用Create真实CAS，不猜1，不重复PUT。GitHubrepo_stats只是keep-first观察，不因重放时star变化换不可变命令身份。

Cover沿正式fresh Platform transfer/exactlocator；有界MIME/尺寸、同sourceRef/cover资产与IO后身份重验。PNG结构/CRC/inflate/filter检查，JPEG仅结构/尺寸，不宣完整JPEG像素decode或ownerdigest全spool证明；下载包仍完整SHA/size。Project现association仍BFF唯一事实，写前fresh inspect currentIAM/exactrevision；准入与本地写非跨owner事务，保既有use-time资格复核。

source_kind使用已正式Protofield5，BFF闭集personal/official/third_party、缺省省略，cursor原样。Root发现ownerhandler/rawvalidator漏映射且无query，真实跨页来源/搜索待最小owner正式修正；15loopback仅BFF传参证据。record入口/payload未核定，不加伪空payload或录屏替代。


P4仅既有installed与owned列表可选query消费，Public9.0/132不另发版本，不新增方法/Schema/依赖。原52e副本76删净，仅fa185ed正式81机器；新增query6从独立parent完整逆向剥离后保所有历史父SHA，生成物只正规生成。P1/P2已含source I/O后required当前session同tenant/subject重验及owner坏响应502；原浏览器input400保持。仍非正常激活/配对/页面或S01–S10完成。

<!-- R353-B2-CURRENT-PREFIX-END; immutable historical baseline follows -->

## R353-BFF-D0：Skills 完整 Product 消费设计（目标，尚未实现）

本片基线为 BFF `88fe38733d1147bb61b3edbf2c66374725ddacb6`。Platform R353-D1 设计已正式提交 `8e869ded1f58354297217af1db13e5b9ade3a447`，源码与机器 publication 尚未冻结；后继只能固定正式 Git owner source commit、完整 provenance/digest 与 generated 输出，不从动态工作树复制。目标一次消费 Platform Product 63 RPC/32 command/24 proof、IAM 0.10 与 Storage v3，再发布唯一 Public 9；本节不表示机器、运行、正常凭据或页面已经可用。

### Owner、模块与调用边界

Platform 唯一拥有 Skill revision、creator/source/audience/draft/admin、package/cover 引用及 `available_update`；IAM 唯一拥有 current subject、publisher display profile 与 admin admission；Storage 唯一拥有 package/cover bytes、scan 和生命周期；Agent 唯一拥有 Run/ready activity/terminal；BFF 拥有 Product contract、Share、durable AG-UI projection 与 usage 聚合。Web 只经同源 adapter，不直连 owner、不自报 creator/source/admin/usage。

继续扩现 Skills route/client/projector、现 Share 和 AG-UI source 摄取，不建 workflow、metadata 或 handoff 一级模块。Share 采用现表 typed resource，淘汰独立 `skill_share` 对 URL/expiry/revoke receipt 的复制。Usage 是 BFF 自有投影而非 Platform 安装数或 Agent 新协议。AI 复用 immutable conversation-artifact association 与 Storage spool；浏览器只传 selector。GitHub 仅新增受限公开仓库 adapter，拒任意 URL、私有 token 和 body 自报来源。

### 准入、事务与失败恢复

Conversation share 的匿名 reader 永远只读 `conversation`，旧行为保持。Skill share 创建需要当前登录用户在同 tenant 对 exact `source_ref` 可见，键为 `(tenant,current creator subject,exact source_ref)` 且最多一个 active；到期旧行先撤再建。创建者只撤自己的。resolve 必须登录、同 tenant，并每次 fresh 调 Platform precise revision/read；链接不扩大 audience。Platform 后续 owner/admin withdraw 或 quarantine 使所有 resolve 失败，不为此新增 IAM 管理动作。

Usage 从 trusted Agent source event 投影显式接收 ready `source_refs` 与严格 `run.completed(status=completed)`，在 `agui-projection-repository.commitProjection` 插入 source fact 的同一事务写 durable observation/terminal；唯一身份 `(tenant,run_id,source_ref)`，重复、乱序和 terminal-first 均闭合一次。失败/取消 terminal 不计数。事实及 coverage 不随 public frame GC。每 tenant 另存最小可信覆盖证明/水位；启动时刻、session high-watermark 或当前无行均不是历史完整证明，缺 owner 授权回补或可信 checkpoint 时公开 `unavailable`，禁止返回 0。bounded `source_ref` 集合由单查询聚合，不逐项查询。

Package/cover 仍经 BFF 代理 owner I/O；响应前重验 current identity、exact revision、Asset purpose/scan/bytes。两 Create 保 optional presence，草稿持久恢复/废弃、防重复和 admin mutation 只转正式 Platform command；`available_update` 仅提示，绝不隐式换源或升级。Publisher profile 按本页 refs 去重后一次 IAM 有界批量解析，missing 不用 owner id/安装者猜名。

AI handoff 只接受 BFF 可重读的 exact immutable association、Storage bytes 与对应成功 completed Run；缺一失败关闭，不接浏览器自由 JSON。GitHub adapter 固定允许的 public host、owner/repository/ref/path、大小、timeout、hash 与响应类型，再进入同一 draft/package 输入；没有生产 route 前保持 OPEN。record 入口与 payload 仍未核定，禁止用录屏、插件或空 payload 缩小目标。

### 发行顺序、文件集与停止线

1. 三设计通过后，先固定 Platform 正式 D1、IAM 0.10 与 Storage v3 的 contract/dependency/vendor/generated；正规 generator 与完整 parent inverse 后再发布 Public 9，旧有效操作不双 pin、不 optional fallback、不手改 generated。
2. Share 后继：`database/schema.sql`、`src/domain/chat/share.ts`、`src/application/{ports/public-share-repository,public-share-service}.ts`、`src/infrastructure/postgres/{chat-repository,chat-repository-mappers,public-share-repository}.ts`、具名 authenticated Skill route/contract/tests；旧 `/v1/shared/:id` conversation 分支保持。
3. Usage 后继：Agent projection、`src/application/agui/ports/agui-projection-repository.ts`、`src/infrastructure/postgres/agui-projection-repository.ts`、canonical SQL、Product projector/contract与 unit/integration；不从 `bff_agui_event` frame 反推。
4. 完整 Skills 消费后继沿现 Platform/IAM/Storage clients、Create/admin/catalog/personal/package routes、public OpenAPI/checkers/tests；AI 沿 artifact reader/spool，GitHub 仅一个 owner-specific adapter。单模块普通文件，不建通用 workflow。

停止线：正式 owner source/publication/pins、IAM/Storage 准入与真实 package/cover、AI association+completed、GitHub route 任一缺失都不得激活对应 public shape。历史 coverage proof 缺失时 usage 必须激活正式 `unavailable` 分支，但不阻断目录或其余已具备依赖的 Public 9 shape。机器/工程门不等于正常 HTTP、浏览器、后台或 S01–S10 完成。

### R353-B1 implementation boundary

B1 implements only the BFF-owned typed Share repository and durable usage facts inside the existing AG-UI source transaction. It deliberately adds no Product HTTP route, owner pin, coverage promotion, background job, or Agent protocol. Existing tenants remain `unavailable`; Skill link HTTP activation still waits for formal Platform exact-revision admission.

<!-- R353-BFF-D0-SKILLS-PRODUCT-END -->

## R350-B2：Skill 示例固定消费与 Public 8.10

Platform Skills 继续唯一拥有 revision 的 `example_prompts`。BFF 固定消费 owner commit `94bd0ea94aabc60c666fdb2cfa8784baf194e24b`、HTTP `3.5.0` 与完整 60-file publication，只负责严格校验、两条 Create 命令转发和四类 Product 读投影；不读取 owner 数据库、不新增本地状态，也不扩权限或 Admin API。

实现沿现 `contract/vendor`、Platform Connect/HTTP generator、两个 Create input/route/projector、`catalog-connect.ts`、`projection-http.ts` 与 `personal-installation-response.ts`。唯一新运行文件 `src/infrastructure/clients/platform/skill-example-prompts.ts` 是 owner-specific 纯校验器，供 HTTP 输入与 owner 读写适配器复用；不建立通用 validation framework。唯一新 contract checker `scripts/verify-skill-example-prompts-contract.mjs` 负责 Public 8.10 增量及完整 8.9 parent 逆变换。

两 Create 的 `example_prompts` 可省略；省略时 canonical metadata 继续省键并保持旧 digest，present `[]` 或非空数组时保键。原文、顺序和重复项不变。四类读表示 `Skill`、managed、published 与 installation 都必须返回该数组；缺失、null、超限或非法文本失败关闭，不从 summary、metadata JSON、安装记录或旧 receipt 推断。Proto installation message 必须 present，即使数组为空。Publish 仍严格零请求体。

Public 升为 `8.10.0 / 111 operations`，不新增 path、permission、status 或 error。机器生成物只由现 generator 正规产生；旧 `af38…` 两 vendor 目录删除，不保双 pin。历史 V5–V9、45 RPC/20 command/24 proof 与旧 parent 字节保持。Platform runtime 持久化完成并与固定机器匹配前不激活新 BFF；工程门通过不代表 Web 示例或 Manus 页面完成。

三种 Skill HTTP shape 只在 existing mapper 内用同一纯校验器替换 generated Zod 的 example_prompts UTF-16 maxLength 推导；六个具名 Skills SDK 调用显式使用完整 strict response validator，其余字段及 MCP 验证保持。这样接受 1000 个 astral Unicode scalar，同时拒绝合计 UTF-8 超界、NUL、孤立代理及缺失字段，不手改 generated 输出。

<!-- R350-B2-SKILL-EXAMPLE-PROMPTS-END -->

## R345-B-D0：Skill 更新时间固定消费与 Public 8.9（已定设计，尚未实现）

基线为 BFF `411e6906f651087dbbd8ff8afd96d53e38b352c0`、canonical public `8.8.0 / 111 operations`；Platform 只完成 D0 `dcc2102e41a677b52367f2cc1a18b6283bbda2e6`，正式 3.4.0 机器、运行和发布 commit/digest 尚未冻结。本片只固定后继设计，不把 Platform 当前工作树或未提交 digest 当依赖，也不声明正常进程、Web 或浏览器已经出现更新时间。

### Owner、放置与停止线

| 项 | 已裁决方案 |
|---|---|
| Owner | `apps/kokoro-capability` / Platform `modules/skills` 继续唯一拥有 `Skill.updatedAt`；BFF 只固定版本消费并发布 Product 安全表示。 |
| 当前事实 | Platform D0 已决定 HTTP 三个 closed schema 增 `skill_updated_at`，安装 Proto 增 `ProductSkillInstallation.skill_updated_at = 14`；BFF 当前仍固定旧 owner bytes，公开 8.8.0/111 不含该字段。 |
| 目标职责 | catalog/pool/list、本人 managed、本人 published 与安装 Product 表示都输出所绑定精确 Skill revision 的更新时间；不改变查询资格、状态机、分页、错误、幂等或写命令。 |
| 目录方案 | 沿现 `contract/vendor`、两个 Platform generator/generated client、`projection-http.ts` 与 `personal-installation-response.ts`；公开约束放一个普通具名 `scripts/verify-skill-updated-at-contract.mjs`。不建 presentation/metadata 模块，也不把规则塞进 Web。 |
| 粒度 | 扩展既有固定消费者和 mapper；生成物只由现 generator 正规生成。新 checker 单独负责四个公开 schema 与完整 8.8 parsed 还原，避免继续扩大通用 checker。 |
| 依赖 | 只消费 Root 已审查提交的 Platform 3.4.0 正式 commit、digest、provenance、OpenAPI 与 Proto/FDS；禁止从 Platform 工作树复制候选、读取 owner 数据库或用 Web/安装事实补值。 |
| 数据/API | Public 升 `8.9.0`，operation 仍精确 111；只给四个既有 closed schema 增加 required `skill_updated_at`。Proto tag 8 `updated_at` 仍是安装更新时间，tag 14 才是 Skill 更新时间。 |
| 删除项 | 无旧业务路径；禁止 optional fallback、unknown-field strip、双读、alias、以 `installed_at/updated_at` 冒充、默认时间或空占位。 |
| 验证 | 固定 artifact/digest、正规双生成、完整图剥 tag14 还原、HTTP 父契约差分、public 8.8 parsed 还原、mapper强负控、contract/architecture/format/lint/typecheck/build；最终由 Root 成对激活并做真实浏览器验收。 |

### 后继具名文件集

1. 固定 HTTP 消费：`contract/vendor/kokoro-platform-http/<正式 owner commit>/platform-http.openapi.json`、`contract/dependencies/platform-http.json`、`scripts/generate-platform-http-client.mjs`，以及该 generator 既有 16 文件 allowlist：`src/generated/platform-http/client.gen.ts`、`client/{client.gen,index,types.gen,utils.gen}.ts`、`core/{auth.gen,bodySerializer.gen,params.gen,pathSerializer.gen,queryKeySerializer.gen,serverSentEvents.gen,types.gen,utils.gen}.ts`、`sdk.gen.ts`、`types.gen.ts`、`zod.gen.ts`。`openapi-ts.platform-http.config.ts`、依赖版本和 lockfile 不变。
2. 固定 Connect 消费：`contract/vendor/kokoro-platform/<正式 owner commit>/` 中正式 provenance 列出的完整 publication、`contract/dependencies/platform-connect.json`、`scripts/generate-platform-connect-client.mjs`、`src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts`。`common_pb.ts` 应保持内容不变；旧 V5–V9 与旧 parent 字节不改，不建 V10。
3. 运行映射：`src/infrastructure/clients/platform/projection-http.ts` 对 skills/pool/catalog、published、managed 使用 generated required 字段并保持 success envelope/resource strict；`src/infrastructure/clients/platform/personal-installation-response.ts` 把 tag14 映为 `skill_updated_at`，不把它纳入 tag7/tag8 安装生命周期排序。
4. Public 机器与校验：`contract/openapi/v1/openapi.yaml`、`scripts/verify-skill-updated-at-contract.mjs`、`scripts/verify-openapi.ts`、`scripts/verify-skill-package-inspection-contract.mjs`、`scripts/check-contract.mjs`、`contract/README.md`；`contract/tests/v1-operations.json` 必须 byte-exact 不改。
5. 测试：`test/platform-http-contract.test.mjs`、`test/platform-connect-contract.test.mjs`、`test/platform-projection-http.test.mjs`、`test/platform-projection-route.test.mjs`、`test/skill-installation-http.test.mjs`、`test/contract/openapi-contract.test.mjs`、`test/contract-governance.test.mjs`、`test/architecture.test.ts`。缺失、额外字段、非法非 UTC `Z`、tag14 缺失/坏 Timestamp 与把 tag8 当来源时间都必须失败关闭。

### 成对发布与真实验收

新旧 closed consumer 没有混跑兼容交集。先提交但不激活 Platform 3.4.0 正式机器/运行，再提交但不激活固定该 commit/digest 的 BFF 8.9.0。Root 暂停并 drain BFF Skills 入口后，先启动并确认新 Platform ready，再启动并确认新 BFF ready，最后恢复入口；回滚也必须暂停/drain 后成对恢复旧 Platform 与旧 BFF，双方 ready 才开放。禁止 HMR、滚动混版、先发 unknown 字段或 optional compatibility。

Web 后继固定 BFF 8.9 后，以真实 catalog/preview/detail/我的技能和 focus 路径验收；不得用空白 spacer 凑布局。作者/publisher、example prompts、真实封面、usage 和未安装 catalog 正文资格仍未完成，不能拿 owner/安装者、固定例子、安装数或占位图片伪造。现 `tags` 是来源自由标签，不是 Manus 固定分类；真实 `R255` 等验收资源不得由前端改名或自动删除来美化。

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

## R340 Skills 本人包正文消费设计门（2026-10-08；目标，尚未实施）

基线 `c91fee642c5bac79d5beab90b15a1eaf97637047` / `codex/r257-bff-normal-current`。当前 BFF public **8.7.0 / 109 operations**，Connect 固定 `e83a2ad3a7c7d333ad0b0b8e7f3d3f64e497bc42` / 43 RPC，未生成两个 inspection 方法，公开正文 route 尚不存在。Platform 已提交 **1f6f764bc4bcf09d235e086ae7fe137acf16d63d**，最新45 RPC/20 command/24 proof；正常进程启用另以 Root 实际维护证据为准。下面目标不表示本仓机器、运行或浏览器详情已经通过。本轮只新增三个现 D0 前缀，原全文后缀逐字节保留，Root 批准后另授切片。

### §8 放置与边界

| 项 | 已裁决方案 |
|---|---|
| Owner / writer | BFF 唯一 public 安全投影；Platform 唯一包资格、来源/安装绑定与目录正文规则；Storage 唯一 bytes；IAM 唯一身份与机器准入。Root 指定一名 BFF writer，Root 独占审查/Git/资源 |
| 当前事实 | 551 tracked、仅原 untracked var；原 projection scope 可用，但 credential 读取上限及 token rotation/取消后 cache 必须后继实际强化，不能以旧实现推断已合格 |
| 目标职责 | 两个本人包 GET：目录、指定文件真实 UTF-8 原文；不以简介、伪 SKILL.md 或 UI 假入口替代 |
| 位置比较 | 采用现 http/routes 与 infrastructure/clients/platform 的三普通文件；淘汰把 RPC 塞入 projection-http 的 HTTP union，或把读生命周期塞进 installation command client；无新顶层模块/通用框架 |
| 粒度 | route 管 public 准入/预算；connect 管两个固定 RPC/正规 token/transport；response 管 strict 安全投影与错误。现 server 仅具名路由接线，WeakMap 配置生命周期复用，不机械改 runtime/config |
| 依赖 | Browser → Web 同源 → BFF → Platform 固定生成 client → owner 自有 Storage 接缝；禁止 BFF owner SQL、源码相对 import、直 Storage 或借 catalog/execution token |
| 数据 / API | 零 SQL/Redis/receipt/outbox，当前 session tenant/subject 受信；目标 public8.8.0/111，两个本人 RPC 当前授权绑定，不以 catalog scope/installed 标记推导资格 |
| 删除项 | 固定消费时仅删除被替代 e83a Connect vendor，唯一 1f6f764 pin；完整历史 V5–V9 只校验、不路由，不保 alias/fallback/双 pin；独立 Platform HTTP vendor 与有效旧 Skills 操作保留 |
| 验证 | Node22.22.2 正规两次生成 byte equal、完整固定源/descriptor/provenance/负控、旧操作保护、contract/lint/types/build/default/format；后继实际 IAM HTTP/Platform/Storage/PG/BFF 系统链和浏览器才判功能完成 |

后继三个普通源文件为 `src/http/routes/skill-package-inspection.ts`、`src/infrastructure/clients/platform/skill-package-inspection-connect.ts`、`src/infrastructure/clients/platform/skill-package-inspection-response.ts`。现 `src/bootstrap/server.ts` 先于通用路径准确分流两个 GET，每请求在同预算内仅调用一次现 authorizeUserRequest。使用现 config.platformProjection/baseUrl/credentialFile/iamBaseUrl，缺配置返回503，不新增 credential 身份或 scope；client 沿 WeakMap<BffConfig, Client>。现 `projection-credential.ts` / `projection-token.ts` 有界读取、共享 flight 轮换及取消退役强化属于另授 runtime 切片，保护原消费者，不先写。不创建 ORM、package 数据库镜像或第二安全 schema；public 参数/输出只由唯一 OpenAPI 定义。

### 完整固定输入与三组双父证明

固定 owner **1f6f764bc4bcf09d235e086ae7fe137acf16d63d**；Root 受保护传递的52输入为 proto3、descriptor8、execution V5–V9 共39、provenance与HTTP共2，整输入 aggregate **e4201bc8674c470bf49c840712f87c34e869b96e59a0e96ba83eb3e4df19446a**，摘要记录路径采用 owner 仓相对路径（含 `contract/` 前缀）；该传递清单不替正规固定 raw SHA/provenance manifest。来源必须正式 Git 对象，ignored bundle 只传递，不成为可编辑 contract 中心。完整升级包含 V9 registration、installation tags13 和新两服务/六消息，不摘两个符号后保旧 pin。

三对 compiled/generated 父描述分别为 `platform-v9-parent43{,-generated}.binpb`、`platform-installation-tags-parent{,-generated}.binpb`、`platform-package-read-parent{,-generated}.binpb`，加最新 platform-v1 与历史 platform-v8-parent39 共8个 descriptor。最新 generated 图必须与当前 compiled 完全同图；剥新 inspection 两服务/六消息回 package-read 两父；剥 installation tags13 回 tags 两父；剥 V9 registration8 与 McpServerRegistration 回 V9 两父；旧 V8 剥四本人 MCP 读/11消息回 parent39。编译与生成父差别按 owner 精确保护，不合并成一个猜测父图、不宽泛删除旧字段/options。V5–V9 artifacts/provenance 原字节逐个保护；V8 与 V9 历史 census 始终43/20/24，当前45/20/24分开，inactive/unroutable与generated-not-activated是阶段metadata，不等实际进程启用。

机器候选仅现 `buf.platform.json`、`scripts/generate-platform-connect-client.mjs`、`test/platform-connect-contract.test.mjs`，完整单 pin vendor/正式 generated 两输出与 dependency manifest；common/platform 由既有 Buf/Protobuf-ES 工具生成，不手改 generated，不升级 dependency/lock/buf template。现6个旧测试涉及 vendor SHA 时仅正规 pin 字面更新，旧断言保持。原 HTTP projection、public、runtime、正常资格与 Schema 全不改。

### 单预算、认证与失效退役

route 首 await 前建立 performance.now()+10000 唯一绝对 deadline，覆盖输入/current session admission、credential 文件、正规 OAuth token HTTP、两个 RPC、strict decode/安全投影、实际 public JSON 编码与 return fence；每步使用剩余，不层层重新十秒。可信 tenant/subject 仅来自当前 admission，用户 Bearer 只发送 IAM；Platform Connect 调用沿现 personal-installation-connect metadata 构造正规 projection workload Bearer、x-tenant-ref/x-kokoro-subject；tenant/caller 的 authority 仍唯一来自 IAM 当前 token 资格，x-tenant-ref 不被当独立身份依据。原 request_id 放 typed 请求字段，owner 原 x-kokoro-request-id 响应头必须匹配，BFF 对浏览器回 x-request-id；不从 body 接身份。本人来源与安装各调用自己的 inspection，Platform 每次在线准入和初末绑定/CLEAN复核；不自动安装、不借 catalog credential 或 Agent proof。

复用精确 platform:projection.read / https://kokoro.dev/resources/platform-internal 资格：credential regular file、O_NOFOLLOW、0400/0600、当前 uid、实际读取有界；token HTTP redirect:error、有界正文与安全异常。缓存只短期 token、不缓存用户授权或正文；共享 flight 每 waiter 独立取消，末 waiter 取消实际 HTTP；完成后重新检查 credential identity/rotation，取消/轮换后的迟到值不得缓存或返回。owner 机器401/403退役相关 token/flight，当次失败，不 fallback/自动重试。旧 projection 的有效读取仍保护，安全强化须真实回归，不把新 D0 当现实现保证。

caller 实际 abort/disconnect 才停止写回复；owner Canceled/DeadlineExceeded 或本地预算届满而 caller live 返回 closed503依赖错误，不能把合成 deadline signal 当 caller 已断。对不即时可取消 I/O 观察迟到 settlement、丢弃结果，零后继 token/RPC/回复，不宣称物理连接/已发送字节即时回收。Connect 二进制 typed 输入、单文件 optional presence、read/write上限与剩余timeout；headers 同 request-id/no-store 必检。public 真 JSON 字节≤1MiB另验，不借 owner 两 codec 限额代替。

### 阶段与真实业务验收

顺序固定：三 D0一致 → fixed consumer/正规生成并由 Root 提交 → 两 GET canonical public8.8/111与旧109完整保护 → 正式系统 RED → runtime/credential安全强化 → 系统 GREEN → 正常受控配对激活 → Web 固定 BFF artifact/查看详情与 E2E。每段另授写集，不把机器生成当功能，不重启正常服务或 reset 共享资源。

后继普通 `test/skill-package-inspection.integration.mjs` 置现 test 根，由 Root 给 protected IAM session/正规 OAuth HTTP配置及真实 Platform/Storage/MinIO/ClamAV/隔离 PG资源；不导入 owner SQL或私有 fixture、不 native 预签 token冒 HTTP。先实际四读 RED；本人来源/安装目录→SKILL.md准确原文、两主体 foreign/absent/removed404、disabled/withdrawn可读、draft/quarantined拒、空/BOM/path、missing/binary/超限、no-store/request-id/完整error、慢请求/取消/轮换/撤权与零 mutation分别核。共享资源只 Root 操作，缺资源为未验，不冒通过。

最终 Web 路径须真实卡片→预览→查看详情→文件列表/原文切换→错误显式重试→取消/返回保 query/focus、异步不跳动；本文不造提前按钮。任意可见非本人且未安装目录的正文资格、作者/usage/真实cover、series收敛、Skills管理员与前后台同步仍 OPEN；两本人读不缩小完整 Skills/Wave0–7目标。

<!-- R340-SKILLS-INSPECTION-TECH-END -->

## R323 本人 MCP 四读机器契约已发布，运行接线尚未实现（2026-10-07）

当前唯一public OpenAPI **8.7.0 / 109 operations**，新增四 `/v1/self/mcp/*` GET（本人connector列表/详情、connector下connection列表、connection详情），固定metadata、安全closed shape/参数/错误与no-store。原105 operations/88path items/456components Root独立完整document剥增量后deepEqual，Platform固定vendor/generated、runtime/source/Schema/正常身份完全未动。旧R320三面中“尚未写机器契约”的阶段现由本节替代；五普通TS、正规OAuth HTTP到owner组合及正常激活仍目标，不把contract发行当已存在HTTP路由。没有新数据库/credential或兼容层。

Root实际四缺口RED 77旧PASS/4新FAIL；首机器contract73381 302PASS/1FAIL为旧R240闭集包含新path，最窄排除仅四新path/四ID，原hash/92不变。独审发现新Retry-After范围P2，现尾负控2PASS/1FAIL拒86401；只新header/verifier两行修canonical1..86400/绝对末尾、不容LF。原四RED组全文exact，旧response不改。专用checker和11漂移负控保闭集；scope JSONSchema字符计数不同于UTF-16 JS string.length，描述明确后继mapper仍须真实运行补强，不能单靠maxLength冒同规则。

Root显式Node22.22.2最终71468完整pnpm check自然exit0：contract304PASS/0SKIP、default879中877PASS/0FAIL/2原资源SKIP，lint/typecheck/build；13002 format:check自然exit0。只辅助机器验收，未运行全资源integration、真实本人四读HTTP/E2E或正常用户连接器CRUD，不把两skip计为通过。独审最终1fa085a4无确定阻断，七机器freeze加三已批准D0/本CURRENT/INDEX精确十二paths由Root独占提交；539其它tracked exact，原var保留。完整70/个人33不升级，支付最后，后继按既定实际IAM HTTP/Platform/BFF系统RED再授runtime五文件。

## R320 本人 MCP 四读 Product 消费设计（目标，尚未实现）

基线 `a3e9a7ed6615e35bcf722d5d20bddd997dcf7e86` / `codex/r257-bff-normal-current`；当前551 tracked、仅原var。已固定Platform owner `e83a2ad3a7c7d333ad0b0b8e7f3d3f64e497bc42` 与V8 aggregate `4a5ed2ca1a25673967ac2ee05a43c5f568bdd19c9ff768d8e606fdac94b9542f`；43 RPC/20 command/24 proof和历史parent39/完整V8→V7→V6→V5继续冻结。本设计新增BFF公开本人管理读，不改owner wire，不把机器消费标记当正常runtime已启用。原105 operations/public8.6.0尚无本节四GET；目标独立additive public8.7.0/109，正常服务当前版本另以Root维护证据为准。

事实owner仍Platform；IAM拥有准入与机器资格；BFF拥有public安全投影；Web仅同源adapter。四读不是完整CRUD，secret宿主/privateServer/创建编辑/启停撤销重连及mutation幂等恢复仍OPEN。本次只三D0前缀，禁止先写contract/src/test/config/credentials/Schema；Root文档通过后再按下面顺序另授。

### §8 具名文件与单一职责

新普通TS **合计5个：现platform目录4个 + 现http/routes目录1个**，不是platform五个再加route。不存在名为mcp-personal的现route，`src/http/routes/mcp-personal.ts`是新增普通文件，目录本身已有。

| 新文件 | 唯一职责 / 依赖与淘汰方案 |
|---|---|
| src/infrastructure/clients/platform/mcp-personal-credential.ts | 独立credential严格文件读取/形状/rotation身份；不扩大projection/catalog固定scope parser，不加credential通用层 |
| src/infrastructure/clients/platform/mcp-personal-token.ts | 当前tenant专属资格实际OAuth HTTP获取、过期cache/共享flight与waiter取消；不借旧token源、不新SDK框架 |
| src/infrastructure/clients/platform/mcp-personal-connect.ts | 四固定generated方法/metadata/剩余timeout与wire有界读取；不复制owner DTO/ORM，不新增Connect wrapper模块 |
| src/infrastructure/clients/platform/mcp-personal-response.ts | 严格safe public projection/enum与nullable页尾、typed错误映射；与credential/transport变化原因分离 |
| src/http/routes/mcp-personal.ts | 四具名GET、输入闭集、当前user admission、绝对budget及公共envelope；不塞旧projection操作union/fallback |

现 `src/config/runtime.ts` 增加可选组合 `mcpPersonal`：共用现KOKORO_PLATFORM_BASE_URL值但独立 `KOKORO_BFF_PLATFORM_MCP_PERSONAL_CREDENTIALS_FILE`；缺新配置默认不启用四读、匹配请求返回503 mcp_personal_dependency_unavailable，半配置启动拒绝。timeout固定上限10000ms与请求取消信号，不新增任意配置中心。现 `src/bootstrap/server.ts` 只精确识别四GET交具名route；route沿当前managed-personal-skills模式在本次budget内调用一次现authorizeUserRequest，不先做第二次全局admission。client沿现WeakMap<BffConfig,Client>生命周期，不增后台worker；因此 **src/bootstrap/runtime.ts不列必需写集**，若后继确有生命周期缺口先报Root，不机械添加。三D0/CURRENT/INDEX事实更新按Root任务分工。

### 身份、取消与单预算

route入口首await前创建performance.now()+10000绝对deadline和deadline/客户端disconnect合成signal，结构检查与当前user admission也耗同预算。顺序：strict request→service envelope+当前IAM session→可信tenant/user→credential→actual OAuth HTTP→generated RPC→strict decode/project→return前fence。所有await使用同剩余，不每段重新10000；文件readFile即便不可即时中断也只有限大小，取消后的迟到结果必须被观察并丢弃，零后继token/RPC。tokenHTTP/owner response均有byte上限与重定向拒绝，取消时retire reader/socket，所有异常不输出secret/body；最终project后再次检查deadline。该保证是业务return边界，不承诺物理网络serialization即时结束，不增加writeHead通用wrapper。

独立IAM tenant_machine client：purpose `platform_ingress_mcp_personal`、scope `platform:mcp-personal.manage`、resource `https://kokoro.dev/resources/platform-internal`、caller kokoro-bff。BFF当前admission namespace/userId映射tenant/subject，忽略外来legacy身份头；用户Bearer仅给IAM session，不转Platform。机器token header与subject metadata由BFF构造，无proof/command；Platform每次实际introspection不由BFFtoken cache代替。

credential使用同既有七字段数组形状 tenantId/generation/credentialRefVersion/clientId/clientSecret/resource/scope，严格闭集、选tenant恰好一项、正safe整数generation、可见非空字符串；owner本人常规文件O_NOFOLLOW、0400或0600、≤65536B，路径只在server配置。purpose由官方IAMclient事实约束，不伪加credential字段。token cache key包含tenant/generation/ref/client/resource/scope与secret SHA，不缓存授权decision或MCP业务数据。每次get及flight完成后重读credential核一致，轮换后迟到flight不进入新cache/返回；waiter取消独立退出，最后waiter取消共享HTTP，expiry留安全余量；token过期重新官方HTTP获取。owner机器401/403退役相关token/flight，当前请求fail closed不fallback或无限重试，下一请求重新核credential；官方撤权即使缓存未过期仍被owner拒绝。

旧 `/v1/mcp/connections` 的active execution projection全本人聚合/provider过滤及 `/v1/mcp/servers` catalog仍有不同有效用途，保留原HTTP artifact/client/routes/scope及用户，不暗改到四管理读。无新失败回旧的双轨。

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

### §8 具名放置与依赖

| 项 | 当前裁决 |
|---|---|
| Owner / writer | Platform拥有Proto/artifact；BFF是唯一固定consumer，Root任务卡指定单writer，Root独占集成提交 |
| 输入 | 仅Root从正式e83a Git对象物化的38文件及其逐SHA清单；ignored bundle只是传递媒介，不是Root可编辑contract中心，禁止复制在编owner工作树 |
| 位置比较 | 采用既有 `contract/vendor/kokoro-platform/<exactcommit>` + 现generator；拒绝新SDK层、Root contract镜像、手写DTO及直接拷owner generated，避免第二事实源 |
| 普通文件/粒度 | 不增运行模块或目录层；新增唯一commit目录承接proto、两descriptor与V5/V6/V7/V8完整固定发行物 |
| 依赖 | 本地生成仅消费固定只读vendor与现精确工具；业务继续只通过本仓generated窄client，不import owner源码/ORM/SQL |
| 删除 | 删除旧c949 Connect vendor目录，原V5–V7 bytes承接至新e83a目录；不删除语义不同的Platform HTTP projection vendor/generated/routes或旧有效Skills链 |
| 冻结 | package/lock、buf.platform.gen.json、public OpenAPI、Schema、credentials、client/runtime、正常服务全不改 |

代码准入候选仅现 `buf.platform.json`、`scripts/generate-platform-connect-client.mjs`、`test/platform-connect-contract.test.mjs`；正规生成 `contract/dependencies/platform-connect.json` 与 `src/generated/platform-connect/kokoro/common/v1/common_pb.ts`、`src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts`，加唯一新vendor38输入/删除旧vendor。CURRENT/INDEX由Root最终事实更新。Root已依同任务卡另授机器实现；写入范围仍仅本表机器文件，不延伸四读运行。

### 验证与后继边界

先在现 `test/platform-connect-contract.test.mjs` 追加固定V8缺口期望并取得自然机器RED，再按Root另授写集更新输入/pin并正规生成。Node22、本地现Buf/Protobuf-ES/Connect精确版本不升级；`pnpm contract:generate:platform` 和 `pnpm contract:check:platform` 继续两次独立生成byte一致、精确源/树/包/配置/hash/manifest门；common输出应保持原bytes，platform输出由工具增加四方法/11messages。原V5 census39保持历史输入，最新43与parent39分开验证，不把旧断言全改43。Root负责最终contract/default/architecture/build与范围审查/Git；作者已在Node22执行正规生成/check/build及现contract单文件16 PASS/0 SKIP；Root最终工程门与独审尚待，不宣用户功能通过。

当前机器范围无新的owner/Schema/字段/密钥政策未决。后续BFF四本人读public契约、独立personal客户端资格、真实用户session与OAuth token HTTP获取→Platform introspection、Web消费和正常进程维护另切片；R317 native issuer证据不能冒BFF HTTP token链通过。privateServer/secret宿主/编辑启停重连及全mutation政策仍未决，不在此裁决。正常projection、Skills、权限与服务保持不动。

Root完整contract首轮298项中289 PASS/9 FAIL，六个既有测试仍硬编码旧vendor路径造成ENOENT，属于本次cutover遗漏而非历史baseline。现 `test/contract/openapi-contract.test.mjs`、`test/skill-installation-http.test.mjs`、`test/skill-package-begin-http.test.mjs`、`test/skill-package-complete-http.test.mjs`、`test/skill-publish-http.test.mjs`、`test/skill-validate-http.test.mjs` 仅旧40字符commit→新40字符commit字面替换；原V5 bytes与全部断言/版本/count不变，同唯一固定点继续校验。完整门待Root重跑。

<!-- R319 fixed V8 consumer design end; prior document follows byte-exact. -->

## R291 Project scope release worker 实现候选（2026-10-07）

现具名四文件及 runtime/store 接线已实现，下面 R284 为批准设计的历史时点。repository 以短事务领取/结算，dispatcher 在事务外调用固定 Storage 两 RPC；stop 同步停止领取并排空，数据库随后关闭。每批最多一条冷却300秒正规 UNAUTHENTICATED 恢复，占总 batch 内一 slot，普通队列不再导致恢复饥饿；其它 terminal 仍 blocked。内部 required `leaseObservedAtMs` 在 checkout/BEGIN 后、实际 claim SQL 前共同取单调时钟，配实际 SQL clock_timestamp 剩余形成保守 deadline 下界；无每项新租期或 claim elapsed 双扣。十秒执行/结算同预算、取消、未知 COMMIT、锁后真时刻 lease/fence CAS 保持。

Root Node22 build/check/format 均0，当前15真PG行为通过（Storage wire/ACK为受控正式 generated Connect fixture，不是真Storage进程）；独审当前十hash a4cc4484 无新增确定阻断。固定producer/pin/Schema/public8.6/105未变。正常BFF仍39db/public8.5，候选未发行或激活；真实Storage/IAM组合、正常schema与17浏览器删除子例仍OPEN。

---
## R284 Project scope release worker 文档门（目标，尚未实施）

当前 commit `6f20f81a8d15992b35bc07e76ac8808d7072bee8` 已提交 Project 删除的 BFF 本地事务、两张 canonical 表与 `8.6.0 / 105` 机器候选，并由 Root 在隔离 HTTP/PostgreSQL 中验证 16/0；正常 BFF 仍运行 `39db` / public `8.5.0`，本候选未激活。下一切片只补提交后 Storage 逻辑 scope release 的具名 worker；不改原始 DELETE `202 pending` receipt、公开状态 shape、Schema、generated Storage pin 或 Web。Storage worker、正常 schema 组合、Web 17 条用户链、完整 DELETE 并发/COMMIT-unknown 与真实 Storage ACK-unknown 恢复均未验。

### §8 局部放置门

| 项 | 结论 |
| --- | --- |
| Owner | `kokoro-bff` 唯一拥有 `bff_project_scope_release_outbox` 的 claim/lease/settle 与 Project deletion 聚合投影；`kokoro-storage` 固定 `e8b9928418924812587b7ac07900aee4be5bc27f` / combined `c22b5c10ee698d579753dcac370be371d8dba1df8fead1a12883f5443fbad18a` 唯一拥有 scope release 与物理对象生命周期。 |
| 当前事实 | `project-delete.ts` 已原子写入稳定 N+1 command/digest/可信 tenant、subject、actor、scope；两表已有 pending/leased/released/blocked、lease/fence/available_at/attempt/error。generated client 已含 `ReleaseProjectScope`/`ReleaseConversationScope`，ACK 只有 `scope_released`、`replayed` 与 uint64 counts，不回显 scope。尚无 worker。 |
| 目标职责 | 四个具名普通文件：`src/infrastructure/clients/storage/scope-release-client.ts` 只调用两条固定 RPC；`src/application/project-scope-release-outbox-dispatcher.ts` 管单 worker 生命周期；`src/application/ports/project-scope-release-outbox.ts` 定义该业务的 claim/settle port；`src/infrastructure/postgres/project-scope-release-outbox-repository.ts` 执行同 Project 串行的 lease/CAS/聚合结算。 |
| 目录比较 | **采用**上述 client + dispatcher + port + repository，分别隔离 owner wire、调度、业务接口和 SQL 生命周期；**淘汰**把 release 错误塞入 upload `client.ts`、把 Project outbox并入 Agent/Scheduler worker或建通用 command bus，这些都会混淆错误/终态与 owner。 |
| 粒度 | 只有一个新业务 worker，不建新模块、进程、表或 repair API；四文件各有一个持续变化原因。现四装配入口仅接线：`src/application/ports/bff-business-store.ts`、`src/infrastructure/postgres/repositories.ts`、`src/bootstrap/runtime.ts`、`src/bootstrap/server.ts`。 |
| 依赖 | dispatcher→具名 port/client；client只依赖固定 generated Storage Connect 与现运行配置。禁止读 Storage DB、复用 Catalog token、事务内网络、发送 actor header、Web直连owner或修改 upload 错误政策。 |
| 数据/API | 复用现两表与原 N+1 rows；不新增 DDL、public operation、receipt或缓存。原 DELETE receipt永远重放初始202 pending；GET从固定命令集合投影 logical状态，physical恒pending。 |
| 删除项 | 不保留第二套 claim/settle、次数耗尽→failed、换 command/key、人工改表恢复、泛用 proxy/bus 或 scope ACK回显假字段。 |
| 验证 | 先具名 client/dispatcher failure-first tests，再真实 BFF PostgreSQL lease/CAS/聚合测试，再固定 Storage owner 真 RPC/丢ACK/恢复资格，最后正常 Browser→Web→BFF。建议后继门：`pnpm contract:check:storage`、定向 tests、`pnpm check`、`pnpm format:check`；本 D0 未运行命令。 |

### Claim、投递、结算与恢复

1. 普通 claim 只领取 due `pending` 或 lease 已过期的 `leased`，用 `SKIP LOCKED` 设置 owner/expiry、新 fence 与 attempt；`blocked` 不得被普通 claim 吞回 pending。缺 Storage 配置时 worker 不启动 claim，并输出不含凭据的明确观测。
2. 网络在事务外。每次 lease 最多一次固定 RPC；同一个有界 attempt 使用不超过 10 秒且小于 lease 剩余时间、预留 settlement 的绝对预算，signal贯穿 credential/transport/decode。shutdown先停claim，再取消并有界等待在途attempt。取消、deadline、断连、未知ACK都不代表owner回滚。
3. metadata只取持久可信 tenant/subject/scope kind/scope id；service=`web-bff`，不发送actor header。调用使用原 command ID/digest，禁止重算、换key或从当前浏览器补身份。ACK不回显scope，归属由精确RPC、当前leased row与lease fence绑定；`scope_released=true`才是成功，counts保uint64且不表示物理完成。
4. settle用 tenant+command+leased owner+fence+未过期lease CAS；先以Project聚合为同一序列化点，再更新command并从固定N+1集合重算。晚ACK、过期fence或lost lease均零写；原202 receipt/body/location永不改。
5. transport unknown、无ACK、合法retryable tuple继续同命令退避，不因attempt次数（包括8次）冒充终态。可信terminal tuple进入`blocked`。PermissionDenied、InvalidArgument、digest mismatch、precondition与结构损坏保持blocked，等待owner/代码修复，不自动恢复。
6. 唯一自动恢复例外是固定Storage owner正规 `UNAUTHENTICATED` 资格错误：至少300秒冷却、每轮最多一条、重新持有同原命令/可信identity/新lease fence后只作一次可能写的RPC；不改token/scope/actor，不借新key或用户重新登录。恢复仍须走相同ACK校验与CAS；unknown永远不能凭次数标failed。

### 后继真实 failure-first 范围

后继仅可写上述4个新业务文件、4个现装配入口，以及Root另行批准的具名测试；不改Schema、public contract/generated、`project-delete.ts`命令生成或原HTTP receipt。真实矩阵至少覆盖：普通claim不动blocked；无配置零claim；同command丢ACK/重启replay；双worker过期lease与晚ACK CAS0；正规CONFLICT/Unavailable保持pending；资格UNAUTHENTICATED进入受限恢复而PermissionDenied/InvalidArgument/digest/precondition不进入；坏ACK不released；shutdown/timeout无悬挂；Project+Conversation N+1全ACK后logical released/physical pending。必须调用固定Storage owner/受控wire与真实PostgreSQL，不以source mock替代owner。


## R282 Project 删除本地实现状态（候选，未发行）

R276 方案的 BFF 本地边界已在当前工作树实现：专用 DELETE/status 路由、单事务 Project→Conversation→ScheduledTask 锁序、同 client Conversation 删除核心、Scheduler replace outbox、Project deletion receipt 与 N+1 Storage release outbox。Root 隔离 HTTP/PostgreSQL 16/0 与工程门通过；正常 runtime 仍为 `39db` / public `8.5.0`。`8.6.0 / 105` 机器和 runtime 候选未正式发行，Storage worker、Web 与 17 条用户链仍待后继。下方 R276 设计语义继续为本实现的权威方案。

## R276-PROJECT-DELETE-D0：Project 删除与逻辑释放状态（本地 runtime/SQL 已实现；Storage worker 未实现）

> 当前事实源与边界：API 面见 [API_CONTRACT.md](./API_CONTRACT.md) 的同名章节，持久化、事务与 outbox 面见
> [DATA_MODEL.md](./DATA_MODEL.md) 的同名章节。当前正式已发布 contract 与正常 runtime 仍为 `8.5.0 / 103 operations`；
> 当前工作树已有包含 `DELETE /v1/projects/{projectId}` 与 `GET /v1/projects/{projectId}/deletion` 的
> `8.6.0 / 105 operations` 机器候选及本地 runtime/SQL 已在 `6f20f81a` 实现，但尚未发行、生成消费者、接入 Storage worker 或完成 owner/browser 链。
> Storage 单 Asset 删除的 provider 资格仍未闭合，不占用本目标的 `8.6.0 / 105` 版本。

### 当前态与目标态

- 当前 BFF `6f20f81a` 已有 `bff_project.deleted_at`、active-project 查询 fence、Project/Conversation owner 校验、正式 Conversation Move、
  ScheduledTask revision/CAS 与 `scheduler.replace` outbox，以及公开删除/status route、聚合 receipt、成员冻结与 N+1 Storage release outbox；
  尚缺的是 Storage release worker、正常运行激活与最终 owner/browser 验收。
- BFF 已固定 Storage 正式提交 `e8b9928418924812587b7ac07900aee4be5bc27f` 与 combined digest
  `c22b5c10ee698d579753dcac370be371d8dba1df8fead1a12883f5443fbad18a`，其中已有
  `ReleaseConversationScope`、`ReleaseProjectScope`。本地 Project 删除编排已实现；这仍不证明 Storage release worker 或真实 owner 投递已实现。
- 目标是一次提交 BFF 本地权威删除：冻结成员、按单 Conversation 删除规范执行本地 tombstone/compact、撤销分享与写入
  durable cancel 意图，暂停而不级联删除 ScheduledTask，写入一条 Project scope 加 N 条 Conversation scope 的 owner
  command outbox，并返回可重放的原始 `202 pending`。Message 与 immutable AG-UI ledger 仍按现 retention 保留，Agent Run
  真实终态仍由 Agent owner 决定。
  Storage 调用在提交后异步执行；`pending | blocked | released` 仅表示逻辑 scope release，物理回收一律保持 `pending`，
  直到 Storage 未来发布可验证的终态物理证据。

### §8 局部放置门

| 项 | 结论 |
| --- | --- |
| Owner | `kokoro-bff` 的 Project 聚合唯一写入本地 Project/Conversation/Share/ScheduledTask 关系、删除 receipt 与 command outbox；`kokoro-storage` 仍唯一拥有 scope/blob/physical cleanup；`kokoro-scheduler` 仍拥有调度执行事实。 |
| 当前事实 | 入口为 `src/bootstrap/server.ts`；应用编排为 `src/application/project-service.ts`；端口为 `src/application/ports/project-repository.ts`；同一 PostgreSQL owner 内实现为 `src/infrastructure/postgres/project-repository.ts`、`chat-repository.ts`、`scheduled-task-repository.ts` 与 `conversation-move.ts`。现 generated Storage client 已有两条 release RPC。 |
| 目标职责 | 新增两个具名 public operation、Project 删除聚合事务、具名 deletion-status read、Project deletion receipt/outbox 及有界 worker；不新增通用删除框架、command bus、修复 API 或第二 admin 服务。 |
| 目录比较 | **采用**扩展现 `ProjectService`/`ProjectRepository`，并把单 Conversation 删除的 same-client 原语提取为现 PostgreSQL 目录内 helper：一个事务可锁定并处理完整集合。**淘汰** route 循环调用现 HTTP/service（会形成部分提交与 N 次独立事务）；**淘汰**新建通用 saga/bus 模块（只有一个具名业务编排且会掩盖 owner/锁序）。 |
| 粒度 | route/schema、应用 input、repository contract、same-client transaction、Storage release worker 各自只有一个变化原因；Project 与 Conversation outbox 共用本聚合的具名表和 worker，不机械复制 DTO 层。 |
| 依赖 | Browser→Web→BFF；BFF 仅通过固定 Storage generated client 和现 Scheduler dispatch outbox 调 owner。禁止读 Storage/Scheduler DB、禁止事务内网络、禁止 Web 直连 owner。 |
| 数据/API | 新增 Project deletion 聚合 receipt 与 N+1 scope-release outbox；不新增 Project 字段、不复用通用幂等表、不开放 slug。公开 API 目标为 `8.6.0 / 105`，详见 API 面。 |
| 删除项 | 后继实现应删除/收敛任何“route 内逐 Conversation 调 service”“提交后直接调用 Storage”“静默把 ScheduledTask 的 project_id 置空”的候选；不保 fallback、alias 或双轨状态。 |
| 验证 | 先机器契约 RED；再真实 PostgreSQL 证明锁序、回滚、Move/Delete 竞态、N+1 冻结与 receipt；再 Storage/Scheduler 受控 owner 证明重放、unknown、blocked 恢复；最后 Browser→Web→BFF 真链。建议门：`pnpm contract:check`、`pnpm contract:semantic`、`pnpm test`、`pnpm lint`、`pnpm typecheck`、`pnpm build`。本 D0 未运行这些命令。 |

### 请求生命周期与事务边界

1. route 在 body/I/O 前完成当前 session admission 与 Product tenant 校验；每次 replay 仍重新 admission。`projectId` 只取规范
   路径值，body 为空，`Idempotency-Key` 为命令必需项。repository 必须按 tenant + canonical Project 锁定包含墓碑的行并核
   current owner，随后在 active 前查询完整 namespace（operation + tenant + subject + canonical Project + key）的 receipt：
   同 key/digest 重放保存的原始 `202 pending` data，异 digest 为 409；无匹配 receipt 才要求 Project active。墓碑上的新 key、
   不存在与非 owner 一律 404；receipt/墓碑不一致闭合为 store failure，不伪造结果。
2. `ProjectRepository.deleteProject(...)` 沿现事务策略使用一个连接上的 `READ COMMITTED` 事务。固定锁序为：Project 一行；
   receipt；Project 锁取得后的新语句快照中，按 canonical conversation id 升序锁定全部现成员；按 task id 升序锁定全部关联
   ScheduledTask；按 `(scope_kind, scope_id)` 升序写 release outbox。集合在 Project fence 下确定，禁止遍历中重新发现成员。
3. 并发 Move 已按 source/target Project id 排序锁 Project，再锁 Conversation；DELETE 锁单 Project 后锁成员，方向一致。
   Move 先提交则 DELETE 取得 Project 锁后的 fresh snapshot 纳入其结果；DELETE 先持锁则 Move 在 active 复核失败。所有可新增、
   迁移、恢复成员或关联 task 的其他 writer 都必须补同 Project admission lock + active fence，不能冒称现已全部具备。
4. 每个冻结 Conversation 调用“已锁定且已验证为本聚合成员”的 same-client 删除核心，不重跑外部单删的 active-Project SQL；
   外部单 Conversation 入口继续保留原 active/owner fence。核心沿当前事实清理 interaction/activity/process 与 Artifact links、
   撤销 share、停止 stream/consumer、结算未完成 assistant，并写 durable cancel 意图；不删除 Message/immutable AG-UI ledger，
   不伪造 Agent Run 已 cancelled。Project tombstone 可在成员核心之后写入，或核心显式接受冻结成员资格，绝不能因零命中仍提交。
5. 关联 ScheduledTask **不级联删除也不 detach**。事务内把 BFF 权威 task 置为 paused/disabled、`next_run_at = NULL`，
   按当前 revision fence 递增 revision，并写既有 `scheduler.replace` outbox；晚到旧 revision callback 无权恢复执行。
   用户后续对已删除 Project 下 task 的 resume/replace 必须 closed fail，保留关联与审计事实。
6. 同事务写一条 Project scope 与每个冻结 Conversation 一条 release command（N+1），以及聚合 receipt 的规范 `202`
   body。提交前没有 owner 网络调用；任一 SQL/约束失败回滚 Project、成员、Schedule、receipt 与全部 outbox。

### 异步释放、重放与恢复

- worker 按稳定 `command_id`、完整 request digest、lease owner/expiry/fence 和 CAS 领取每条命令；调用固定 Storage
  `ReleaseProjectScope`/`ReleaseConversationScope` 时传入可信 tenant/subject/scope identity，不从公共 body 自报。
- owner 成功或可信 replay ACK 才把该命令置 `released`；timeout、断连和未知 ACK 保持可重试 `pending`，不得换 key；明确
  terminal owner 冲突/资格失败置 `blocked` 并保存非敏感稳定 code。lease 丢失或旧 fence 的晚结果不得落库。
- status GET 是冻结命令集合的权威当前投影：存在 blocked→`blocked`；否则全部 released→`released`；其余→`pending`。
  DELETE 的同 key replay 永远返回 receipt 保存的原始 `202 pending` data，不会随 worker 状态漂移；request ID 只在本次响应
  `x-request-id` header 生成，不进入 JSON/receipt。后台 worker 继续按同 command 重试，不新增人工 repair endpoint。
- `released` 只表示 Storage 接受逻辑 scope release。现契约没有“全部对象物理删除完成”的终态证据，因此公开
  `physical_cleanup_state` 在本切片恒为 `pending`；不得根据 GET/404、队列为空或经过时间推断完成。

### 墓碑、retention 与后继准确写集

- 本切片保留 Project tombstone 与 slug 且不开放 slug 复用；列表、详情和 Move target 使用 active fence，而 slug 创建冲突检查
  明确覆盖墓碑。是否永久保留由后继 retention 裁决决定，本 D0 不将当前未定 retention 写成永久承诺。Conversation 的
  compact/历史保留严格沿现单 Conversation 删除事实。
- 精确 retention/最终 Project 与 Conversation 墓碑物理 purge 时限尚无批准事实，保持未决；本切片不猜期限、不加 purge
  worker，也不以 retention 未定阻塞逻辑删除。
- 后继 machine/source/test 最窄集合：`contract/openapi/v1/openapi.yaml`、契约 provenance/checker/既有 contract tests；
  `src/http/routes/project-delete.ts`、`src/http/routes/project-deletion-status.ts`、`src/application/project-service.ts`、
  `src/application/ports/project-repository.ts`、`src/infrastructure/postgres/project-repository.ts`、现 Conversation same-client
  helper、现 Scheduler repository/outbox 接缝、具名 Storage release worker 与 `src/bootstrap/server.ts`；canonical SQL 与真实 PG/
  HTTP/owner tests。任何额外文件须在实现前重新过放置门。

## R267-SKILLS-LIFECYCLE-D0：本人 Skill 创建新版本与撤回（目标 public 8.5.0 / 103 operations，尚未实施）

### 当前事实、owner 与范围

正式基线为 BFF `930028b9721587e9c21535eff1e78ce361b82df9`，当前公开机器为 `8.4.0` / 101 operations；本人五状态 list/detail 已发布，但 CreateVersion/Withdraw 尚无 public operation、route 或 client 方法。Platform `6e5c28487651541fffdabe63624fb997536bd3d2` 是 Skill/series/revision/status 与 command receipt 唯一 owner；其 Connect contract 已有 `CreateSkillVersion` 与 `WithdrawSkill`，Platform HTTP 3.3 仍保持只读。本片只增加三设计前缀，不修改机器、源码、生成物、Schema、测试或运行服务。

Root 裁定下一 additive public release 为 `8.5.0` / 103 operations：`POST /v1/self/skills/{skill_id}/versions`（`createPersonalSkillVersion`）与 `POST /v1/self/skills/{skill_id}/withdraw`（`withdrawPersonalSkill`）。未发行 Storage 单 Asset 删除保持原权限、receipt与生命周期语义，但顺序后移为目标 `8.6.0` / 105 operations；本片不抢先实现它。

CreateVersion 以 path 的精确本人 active/disabled revision 为 base，沿同 series 生成新 ID/revision 的 draft；display_name 不可修改，不复制旧 package/scan/validate 证明，不原地替换 active，不自动升级安装。新 draft 继续走既有 upload→scan→validate→publish。Withdraw 只撤回 path 指定的精确 active/disabled revision，转为 withdrawn；安装继续绑定该 revision，权威 `source_status` 改变但不自动 remove、升级或选择 latest。

### §8 放置裁决

|项|结论|
|---|---|
|Owner|kokoro-bff 拥有 public HTTP、当前用户 admission、公开错误与响应；kokoro-platform 独占 lifecycle事实、版本分配、事件和 durable receipt。Browser/Web 仅在正式BFF发行后消费。|
|当前事实|`src/http/routes/create-skill-draft.ts`、`publish-skill.ts`承接相邻命令；`src/infrastructure/clients/platform/catalog-connect.ts`承接现Catalog Connect；`src/bootstrap/server.ts`具名分派。`managed-personal-skills.ts`只读，不承载mutation。generated Connect已有两RPC，但production未调用。|
|目标职责|两个具名public command把可信tenant/subject固定为个人owner context，将path skill ID和严格body映射到owner命令；响应严格验证owner identity/status/replay。无市场、admin、组织owner或latest selector。|
|目录比较|A：塞入`managed-personal-skills.ts`或建通用Skill command proxy——淘汰；会混淆read/mutation预算与扩大任意RPC。B（采用）：新增相邻普通`create-personal-skill-version.ts`、`withdraw-personal-skill.ts` route，扩现`catalog-connect.ts`两具名方法；各自投影/command-id helper按现一变化原因相邻放置。bootstrap只作两个exact dispatch。|
|粒度|两个命令的body、成功shape与precondition不同，route不合成万能handler；Connect transport/token复用单一现client，不建第二client/module/进程。若现投影器需新普通文件，分别限定CreateVersion/Withdraw且由后继卡批准。|
|依赖|Browser→Web same-origin→BFF current Session admission→Platform Connect。Catalog client必须接受同一signal与absolute deadline/remaining budget并关闭transport自动retry；route依赖现request/envelope/admission与Catalog client；禁止读Platform DB/源码、调用Platform HTTP mutation、共享ORM、跨owner事务。|
|数据/API|public owner=`kokoro-bff`、visibility=`public`、stability=`beta`；治理permission=`product.skill.manage_personal`（治理元数据，不新造IAM grant）。tenant/subject/owner scope只来自当前admission；body不能自报。零BFF DDL/cache/receipt/outbox。|
|删除项|无旧public API可兼容；不增加alias、PATCH/in-place edit、latest版本、自动retry/rekey、第二receipt或managed-read内mutation。Connect现单pin若与owner正式Proto/wire逐字节等价则保持；Root已只读逐字节核当前6e5的common.proto SHA `65025b…`与platform_runtime.proto SHA `e5fd71…`均等于现c949 vendor/pin，因此不因source commit变化repin；descriptor/generator仍须机器片重跑确认，不手改generated。|
|验证|先机器/HTTP有效RED，再正规生成与contract门；Platform真PG receipt/并发门、BFF owner真链、Web same-origin与正常浏览器分层验收。D0不算功能通过。|

### 信任、单一预算与取消

两route必须在exact path识别后、`authorizeUserRequest`前建立唯一单调 `deadlineAt=start+10_000ms` 与Abort scope；同一signal/剩余deadline覆盖admission、credential/token、Connect请求、response解析、序列化和回复。每个await前后及回复前检查过期/response关闭；早取消零IAM/owner IO，晚admission/token/owner结果被消费但不采纳，timer/listener/stream在finally清理。不得由Catalog client另起完整预算，亦不得用裸race留下后台命令。取消或timeout不等owner未提交，不能返回成功或自动换key重试。

准入取得可信 `tenant=context.identity.namespace`、`subject=userId`；BFF构造 `owner_scope={kind:user,id:subject}` 与同值ProductCatalogContext。path `skill_id`必须是单一opaque ID；CreateVersion body严格为`{display_name,summary,tags}`：`display_name`是Web从当前本人detail显示的只读不可变名称断言，原值进入owner完整metadata与digest；BFF不额外GET、不缓存或猜值，Platform在事务内以`base.displayName === metadata.displayName`强检。这不是rename授权，任何不同值为412。summary/tags沿现CreateDraft约束。Withdraw body严格为`{reason}`，reason须1..2048 code points且至少含一个非空白字符，原样不trim进入digest。

两个请求都要求恰一枚 printable 1..128 `Idempotency-Key`，拒重复/逗号合并/空值。CreateVersion要求JSON body（64KiB上限、fatal UTF-8、重复键/未知键关闭）；Withdraw同样为严格JSON reason。任意query、Transfer-Encoding/冲突framing拒绝；无ETag/If-Match语义，不借条件头实现revision选择，path本身就是精确版本身份。

### owner receipt、未知结果与错误闭集

public key按版本化operation域、tenant、subject、path skill ID稳定派生Platform command ID；owner command digest由正式3.0 projector绑定tenant/method、owner scope、Product context、base/source identity及完整body，排除request ID/command identity。同一path下同key同body可在owner current replay guard仍成立时恢复receipt，同一path下同key异body为409；不同path属于不同command namespace，不要求冲突。每次replay前仍做当前Session/owner授权，撤权后不因历史receipt放行。

CreateVersion成功须严格验证合法`skill_id`与`series_id`、新skill ID不等于path base、正十进制string revision且>=2、`status=draft`、boolean replayed；无额外base预读，BFF不得声称将series_id与预读base事实比较，series归属由Platform事务保证。Withdraw成功须严格验证`source_ref=skill:<path skill_id>`、`status=withdrawn`、匹配`^evt:[a-f0-9]{64}$`的event_id与boolean replayed。BFF不以managed list/detail预检查替代owner命令，否则会挡住withdraw终态后的合法同key replay。

closed mapping沿现Skill command profile：400 `invalid_skill_request|idempotency_key_required|invalid_idempotency_key`；401 `session_authentication_required|session_invalid`；403 `service_auth_failed|session_forbidden|product_tenant_forbidden`；404 `skill_not_found`（owner NotFound/PermissionDenied目标统一防枚举）；409 `skill_idempotency_conflict|skill_command_in_progress`；412 `skill_precondition_failed`；413 `request_body_too_large`；429 `session_rate_limited|skill_rate_limited`且Retry-After严格1..86400；502 `skill_response_invalid`；503 `product_tenant_not_configured|iam_admission_unavailable|skill_dependency_unavailable`。新命令成功沿`{data,meta:{request_id}}`，错误固定`{error:{code,message},meta:{request_id}}`，无`retryable`；header request-id与body一致且no-store。旧101 operations的既有envelope与字段完全不改。未知Connect code、错tuple、坏identity/额外字段一律502，Unavailable/Deadline/Canceled/Unauthenticated为503；不泄漏owner message。 当前owner `skill-rpc.service.ts:241` 的 `assertCatalogAdmission` 在命令/receipt前重读current resource：不存在为NotFound、owner不符为PermissionDenied；`:317` 的 `assertCatalogReplayCurrent`还校验CreateVersion返回的新draft当前status/revision。BFF可把NotFound/PermissionDenied统一404，但必须保留current owner/replay校验，不能为命中receipt而绕过。CreateVersion新draft后来已发布等发生状态漂移时，原key重放可返回412，不承诺永远重放原201；Withdraw终态同key重放仍沿owner现规则。

丢ACK后Web保留原intent/key/body并由用户显式同键重放。CreateVersion仅看list出现draft不能证明该command；Withdraw权威回读为withdrawn只证明当前状态，不证明本次ACK。刷新丢失key时只重新读权威状态并让用户决定，不能自动新key。新的key对终态withdraw与非法base稳定412，不伪装replay。

### 精确后继候选集与停止线

机器阶段：`contract/openapi/v1/openapi.yaml`、`contract/tests/v1-operations.json`、`contract/README.md`、`scripts/verify-openapi.ts`、`scripts/check-contract.mjs`及现contract/governance/architecture tests；若Connect正式bytes不同才准依现`contract/dependencies/platform-connect.json`、vendor、generator及generated更新，否则保持现wire。public版本升8.5/103，并只改Storage尚未发行占位为8.6/105。

runtime阶段候选：新增`src/http/routes/create-personal-skill-version.ts`、`withdraw-personal-skill.ts`；扩`src/infrastructure/clients/platform/catalog-connect.ts`；现`src/bootstrap/server.ts` exact dispatch；相邻两个command-id/input/projector普通文件以机器shape实际需要为准，须先入任务卡。测试扩现Skill command/http/Connect/contract tests；需要新专属test先报告。`database/schema.sql`、token cache/shared flight、managed read、Platform源码与Web不在本片写集。

当前未实现、未运行门、未重载服务，也未验证正常浏览器。Root已裁定CreateVersion body显式携带只读`display_name`断言、BFF不额外GET；机器片必须把该字段、长度/不可变负控、digest与owner current replay guard锁为正式schema后才可进入runtime，这不再是架构未决。

<!-- R267-SKILLS-LIFECYCLE-D0-TECH-END -->

## R266-SKILLS-BFF-D0：本人 Skill 管理读取（目标 public 8.4.0 / 101 operations，尚未实施）

### 当前事实与固定 owner

本节为当前目标方案，覆盖下方 Storage 删除 D0 的旧版本占位但不改其删除语义；下方全文保持历史字节。正式 BFF 基线是 `/Users/nako/.codex/worktrees/kokoro-r257-bff-normal`、HEAD `42ac39ee1fadc0fc1c2a4eadfad16569bd42dee7`，当前 public OpenAPI `8.3.0` / 99 operations。当前 Platform HTTP consumer仍固定 `9ab3b653…` / 3.2.0，运行时只有 ACTIVE discovery、published detail与MCP读取，没有本人五状态管理读取。本片只写三设计前缀，没有实现、生成或发布能力。

唯一 producer 已正式发布 Platform commit `3d4ba6c3462e3896481f902adf47e0713c4187e4`、HTTP `3.3.0`、raw SHA256 `b6e5d0e0118207ee37933e5c22e94c86d95d74307b22a44e26e8974fede82acf`、combined SHA256 `9ad2c4286f8b2e933450c7a81dda10f7580d1421bf64516dec1231d42d237d19`。它新增 internal-owner `GET /v1/self/skills` 与 `GET /v1/self/skills/{skill_id}`；Platform Connect pin `c94909f1…`及Proto/execution历史独立不变。BFF后继必须一次替换旧HTTP vendor目录与pin并正规生成16个既有output，不保3.2/3.3双轨、不手写DTO。

Root裁定本次公开顺序为 additive `8.4.0` / 101 operations。尚未发行的Storage单Asset删除设计继续保留全部权限、预算、owner receipt和数据规则，但其历史`8.4/101`占位由本次实际顺序替代，后继目标改为`8.5.0` / 103 operations；这不是本片抢先发布Storage能力。

### §8 放置裁决

|项|结论|
|---|---|
|Owner|公开HTTP与当次用户准入唯一owner是kokoro-bff；Skill/series/revision/status事实owner仍kokoro-platform。唯一writer按Root任务卡，Git/index/资源由Root。|
|当前事实|`src/http/routes/platform-projection.ts`和`src/infrastructure/clients/platform/projection-http.ts`承接旧六owner GET；`src/bootstrap/server.ts`在通用user admission后才分派旧projection，旧handler重新建取消scope，不能证明“准入起算10秒”。现vendor 3.2与generated16不含新operation。|
|目标职责|只新增public `GET /v1/self/skills`与`GET /v1/self/skills/{skill_id}`，投影本人五状态/八安全字段；每次重新做当前Session admission并调用固定Platform owner。它们不是安装/执行资格，也不承载CreateVersion/Withdraw。|
|目录方案|A：继续塞入`platform-projection.ts`并改通用准入生命周期——淘汰，会扩大旧六取消/错误面且handler起表无法覆盖admission。B：采用新普通`src/http/routes/managed-personal-skills.ts`，在bootstrap通用admission前对两个exact GET分派，由该route持唯一绝对预算并调用现`authorizeUserRequest`；现`projection-http.ts`只扩两个具名generated operation与严格映射。无新模块、auth框架、proxy或进程。|
|粒度|新route只因“两条管理读共享完整准入预算、closed input与public envelope”变化；owner transport/token/响应读取仍扩现`projection-http.ts`，避免第二credential/token client。`src/bootstrap/server.ts`只作exact早分派；`owner.ts`与旧`platform-projection.ts`不承接新path。|
|依赖|Browser→Web same-origin→BFF managed route→IAM admission→Platform HTTP3.3。route可依赖现auth、config、response/envelope和窄client；client可依赖generated16、projection credential/token。禁止读Platform DB/源码、Connect替代HTTP、通用owner proxy、BFF SQL/Redis/cache/receipt。|
|数据/API|公开metadata：owner=`kokoro-bff`、visibility=`public`、stability=`beta`、idempotency=`none`、permission=`product.skill.read_managed_personal`。tenant/user只取当前admission context；owner只接受BFF machine credential和显式tenant/subject headers。无DDL/receipt/cache。|
|删除项|repin时删除旧`contract/vendor/kokoro-platform-http/9ab3…`，唯一新vendor目录固定`3d4ba6c…`；不保alias/fallback/旧新generated并存。旧ACTIVE discovery路径与语义保留，不删除。|
|验证|先public/owner pin/generated/route测试在旧源形成业务RED，再正规`node scripts/generate-platform-http-client.mjs --write`与`pnpm contract:check:platform-http`；随后focused contract/HTTP/credential/timeout测试、format/lint/typecheck/contract/architecture/full test/build。真实IAM→BFF→Platform、取消/慢admission/慢body由Root隔离运行。|

### 单一绝对预算、取消与失败闭合

`managed-personal-skills.ts`在exact路径识别后、调用`authorizeUserRequest`前用单调时钟固定`deadlineAt = start + 10_000ms`，安装一个AbortController及request-aborted/response-close监听。相同signal与剩余期限依次覆盖IAM admission、credential file、token flight、owner fetch、1MiB有界response stream、UTF-8/JSON/generated strict解析和BFF回复；任何阶段不得重新起10秒。入口在该专属finally清timer/listener并消费所有已启动Promise的迟到resolve/reject；过期、取消或response关闭后不得采纳late admission/token/owner结果为200。早已abort/过期应在IAM或owner I/O前终止。不是裸`Promise.race`，不留下后台读流或unhandled rejection。

新GET任意`Content-Length`（包括`0`）、`Transfer-Encoding`、`Idempotency-Key`或实际body一律400；无body的普通`Content-Type: application/json`合法。ETag/If-Match不是本read的前置条件，若出现不改变无条件读取结果，也不新增条件头拒绝规则。list query只允许单值`limit/cursor/status`，limit缺省50且1..100、cursor 1..2048、status仅`draft|active|disabled|withdrawn|quarantined`；重复、空、未知键/状态拒绝。detail不接受任何query，path id用owner生成schema。原六读取的body/query/预算行为不因本片改变。

client必须调用generated `listSelfManagedSkills` / `getSelfManagedSkill`（名称以后继实际generator输出为准，不手写函数），并以generated Zod为第一层、BFF绑定为第二层：closed八字段、五状态、正十进制revision、`source_ref=skill:<skill_id>`、detail path ID一致，list cursor形状严格；owner tenant/subject不从body/query自报。响应只接受JSON、request-id与no-store，body上限1MiB；owner省略合法`next_cursor`时BFF归一为public null，其它非法cursor shape拒绝。owner code机器字段只是string，closed tuple由固定runtime+BFF政策显式验证：`capability.subject_invalid`即使owner报400也映503依赖失配；machine auth、未知status/code/retryable组合、错identity/额外字段/坏UTF-8均失败关闭，不返回部分列表或猜状态。

### 精确后继写集

机器/生成阶段：`contract/openapi/v1/openapi.yaml`、`contract/tests/v1-operations.json`、`contract/README.md`、`scripts/verify-openapi.ts`、`scripts/check-contract.mjs`、`contract/dependencies/platform-http.json`、`openapi-ts.platform-http.config.ts`、`scripts/generate-platform-http-client.mjs`，删除旧vendor并新增固定`contract/vendor/kokoro-platform-http/3d4ba6c…/platform-http.openapi.json`，正规生成`src/generated/platform-http/**`现16文件。版本只改public8.4/101及本HTTP pin；Platform Connect依赖不动。

runtime阶段：新增`src/http/routes/managed-personal-skills.ts`；修改`src/bootstrap/server.ts`作exact早分派；扩`src/infrastructure/clients/platform/projection-http.ts`的两个具名operation/strict mapping。只有实际实现发现现token source不能接受同一signal/剩余deadline时，才由Root另准`projection-token.ts`；D0不预授权泛重构。测试优先扩现`test/platform-http-contract.test.mjs`、`test/platform-projection-http.test.mjs`、`test/platform-projection-route.test.mjs`、`test/platform-projection-credential.test.mjs`、`test/contract/openapi-contract.test.mjs`、`test/contract-governance.test.mjs`、`test/architecture.test.ts`；需要新增专属文件须先入任务卡。

### 未决与停止线

当前能力尚未实现：BFF未repin/generate，public8.4/101未发行，正常进程未重载，Web未消费，两条公开路径及真实用户五状态/分页/刷新均未验证。CreateVersion/Withdraw及完整CRUD属于后继生命周期切片。owner机器已发布不代表BFF能调用；三D0通过也不代替真实RED、工程门或用户验收。

<!-- R266-SKILLS-BFF-D0-TECH-END -->

## R261-BFF-FILE-DELETE-D0：两具名单 Asset 删除（仅设计，具名预算接缝已由Root裁决）

基线为正式 BFF `/Users/nako/.codex/worktrees/kokoro-r257-bff-normal`、Root给定 HEAD `7269e97`。本轮只三文档新增前缀，原全文suffix逐字节保留；未修改源、机器、生成物、配置、Schema、正常数据或untracked var。现公开8.3.0/99 operation没有单文件删除；目标8.4.0/101尚未发布。Storage现pin仍`e8b9928418924812587b7ac07900aee4be5bc27f` / combined `c22b5c10ee698d579753dcac370be371d8dba1df8fead1a12883f5443fbad18a`；17 RPC候选combined `9b602259c3b777e31deb63563467ae160c04bde415e841851aefae760902f34f`不是正式新发布，最终owner commit待定。Storage正式源/机器发布后才准repin及正规生成，禁止先消费mutable工作树。

### 当前事实与目标

现 `src/bootstrap/server.ts` 已装配个人 `GET /v1/library?kind=file` / `POST /v1/library/files` / `GET /v1/library/files/{asset_id}/content`、项目 `GET/POST /v1/projects/{projectId}/resources`；普通Asset唯一由Storage写，Artifact另走Conversation授权组合。目标只新增 `DELETE /v1/library/files/{asset_id}` 与 `DELETE /v1/projects/{projectId}/resources/{asset_id}`，无body/query、新实体或兼容alias。

每次先原service envelope＋唯一Bearer＋IAM当前Session＋固定Producttenant。personal scope等于当前subject；project复用本仓 `tenant_id + owner_id + deleted_at IS NULL` 的本人active Project语义，解析ID/slug后只传canonical project.id。现 `ProjectService.find` / `PostgresProjectRepository.findProject` 并非成员/action ACL；Org Member/admin、平台admin、上传者、同digest都不自动扩大权限。permission metadata仅本operation治理名，不伪称IAM新增grant。

### §8 放置与依赖

|项|明确选择|
|---|---|
|Owner|BFF拥有两个public操作/本人准入/响应；Storage唯一拥有Asset逻辑删除、Blob退役、cleanup与receipt；Web拥有action-time确认和瞬时UI。|
|采用位置|现 `src/http/routes/file-delete.ts` 处理两个具名HTTP入口；现 `src/infrastructure/clients/storage/asset-delete.ts` 新普通文件处理typed RPC/稳定command/strict映射；现 `src/application/file-delete.types.ts`、`file-delete.error.ts` 各新普通文件分别定义业务边界类型和错误。目录均已存在。|
|淘汰位置|不把单RPC删除塞入多阶段upload/checkpoint，不增加泛owner proxy、删除模块/服务、第二权限或通用receipt层。个人/项目共享具名consumer而不伪造projectId=subjectId。|
|现入口|`src/bootstrap/server.ts` 在当前admission后、generic body/JSON/mutationTicket前exact分派；项目授权必须在此具名路径重新执行，不能因提前return绕过原generic检查。前置admission失败也进入新closed header-only错误profile。|
|依赖|handler→本仓project授权读取/窄Storage client→固定generated；generated不穿透业务类型，无跨ownerSQL/ORM/source import。普通99操作与上传多阶段receipt保持。|
|授权读取放置比较|直接在现PostgresProjectRepository内管理独立连接生命周期会混入row CRUD变化；采用现 `src/infrastructure/postgres/project-resource-access.ts` 新单普通helper，独占本人active Project授权读取、有限checkout/SQL及精确连接退役。repository仅委托，既有目录内无新模块/服务。|
|现三处接缝|`src/application/ports/project-repository.ts` → `src/application/project-service.ts` → `src/infrastructure/postgres/project-repository.ts` 新具名 `findActiveResourceProjectId(scope, idOrSlug, signal: AbortSignal, deadlineAt: number): Promise<string | null>`；signal及绝对毫秒deadline必填，无optional/default。复用原owner谓词且仅返回canonical ID/null，旧find/findProject不变。|
|数据/删除项|零BFF表/列/索引/Redis票据/outbox/缓存；不增加Map成功缓存。无旧单删实现可兼容，不加alias。|
|验证|机器闭集/正规生成；具名HTTP有效RED→实现；真实PG/Storage组合及Web确认/刷新/撤权分别验，工程数量不替代用户链。|

### 唯一命令与恢复

public key原样且唯一。command ID用版本化域分隔、tenant、subject、scope kind、canonical scope ID、public key确定，**不含asset_id**；semantic digest含同域和asset_id。于是同scope同key异asset为409，不通过换command ID绕异义；不同scope/subject隔离。request ID、时钟与随机attempt不进command身份。Storage认证/operation/scope与BFF当前授权每次先于replay；不得预GetAsset/List检查已删状态再调DeleteAsset，否则合法同键重放会误404。首次与replay都直接交owner唯一receipt，无BFF第二票据。

200只表示owner逻辑删除及必要退役/cleanup/receipt已提交。客户端取消/timeout/丢ACK不等未提交：保同intent原key，可显式同键请求核定，无自动retry/rekey；或fresh GET只报告当前事实，单页缺行不是此次提交证明。ACK后现列表从首cursor刷新；分页/错误不得假空。旧预签URL可能至300秒自然到期，不承诺即时撤销或物理bytes已清。Artifact引用409而非级联，包/Conversation/ReleaseScope/整项目删除不是这两个入口。

### 10秒与具名Project授权读取（目标已裁决，实现待验证）

目标从本次admission开始到授权读取及RPC/响应处理共享10秒绝对预算，原始取消和剩余时间逐层传递，每await fence，早已aborted/destroyed零后续owner IO。**当前尚不具备Project读取取消能力**：`application/project-service.ts:26–27` / `application/ports/project-repository.ts` 无signal/deadline；`infrastructure/postgres/project-repository.ts:91–99`直接pool.query；`infrastructure/postgres/client.ts:15`未指定connectionTimeoutMillis/query_timeout/statement_timeout。锁定pg默认query/statement timeout为false，pg-pool无connectionTimeoutMillis的pending队列无本地timer；不能依赖未读取的外部URL/数据库设置声称已有界。

Root已裁决：只新增上述具名方法与 `project-resource-access.ts`，不改全局query/statement或旧findProject，不复制权限事实。required signal+绝对deadline从handler贯穿，helper每步按剩余预算执行；借现rename的exact checkout、late acquisition释放、abort/timeout精确 `release(true)` / destroyClient语义，并在本次读取事务内设置有限 `statement_timeout`、`lock_timeout`、`client_connection_check_interval`，正常结束回滚/提交并释放，所有监听和timer清理。不是照搬4.5秒常量/写事务/receipt，也不是对裸pool.query做race；取消后即使取得连接/返回行，也先退役或释放且零Storage IO。事务只读取现本人active Project，无新事实或锁定后跨owner事务承诺。

连接等待的实现及验证仍是上线条件：pending checkout超时/取消须立即终止本次业务等待，并对每个迟到取得的确切client释放；已取得或执行中client超时/取消须精确销毁而不回池留SQL。不得把取消业务等待当底层connect已终止、或把late-release当已经证明池无残留。真实PG必须覆盖pool saturation、held SQL取消、迟到获取、连接故障，确认请求有界、无后续Storage IO、资源最终回收；这些尚未运行，不以本D0声称成立。如现pg接口不足以在仅固定Pool连接期限的约束下兑现这些门，先向Root报告具体机制阻塞，不擅增第二pool或平台。

### 后继精确集与门

除原四新普通source，新增已裁决的第五普通文件 `src/infrastructure/postgres/project-resource-access.ts`；现bootstrap及上述Project port/service/repository三处为目标必改，旧findProject不改；现Pool仅下述连接期限目标。这是D0目标集，不构成源码准写。机器候选为现 `contract/openapi/v1/openapi.yaml`、`contract/dependencies/storage-connect.json`、`buf.storage.json`、`scripts/generate-storage-connect-client.mjs`必要pin、正规vendor/`src/generated/storage-connect`和contract README；固定版本与exact变更再列，不改依赖版本或历史artifact。测试新增现目录 `test/file-delete.test.mjs`；真实组合建议 `test/file-delete.integration.mjs`另准；现storage-connect-contract、contract/openapi-contract、contract-governance及必要check脚本准确更新。现personal-file-upload.integration只有BFF PG是真、Storage为Connect double，不冒owner真组合。INDEX/docsINDEX/CURRENT待实际实现证据再更。

Root门包括普通current Session、本人/他人/跨tenant/已删项目、同键回放/异asset409/异键404、引用409、非法query/body/key、错误tuple、超时/取消/迟到、pool等待/数据库锁与连接黑洞无遗留、真实确认→一次DELETE→权威列表刷新/下载拒→hardreload。未知结果保持intent，撤准入或切人退役私有UI。永久删除必须用户action-time确认；本设计不执行删文件、seed或授资格。

Root最终补充裁决：现 `src/infrastructure/postgres/client.ts` 唯一Pool仅增加 `connectionTimeoutMillis: 1000`，有限约束底层connect与pending队列，堵住仅race/late-release仍可能无界等待；不改全局query_timeout/statement_timeout、max、credentials，不创建新Pool。此为D0目标并非源码已支持。保留五新普通文件和三现port/service/repository接缝；真实完整旧回归及pool饱和、SQL锁、取消、late acquire/连接故障门必须验证无泄漏及取消后零Storage IO。

<!-- R261-BFF-FILE-DELETE-TECH-END -->

## R259-SKILLS-METADATA-BFF-D0：安装元信息消费（2026-10-06；D1冻结候选待Root验收）

**D1候选状态。** 已按本设计完成单pin机器、public8.3与十二字段strict投影；有效RED与focused GREEN已留证，但正常进程、真实owner和Web仍未发布，须Root独审及Node22/真实组合后方可改变当前事实。

**当前事实与固定 owner。** Platform 已由 Root 发布 `c94909f1c593f2b7ffd5f325786739da744ff31f`，contract digest `4fe862adba0d460fa23713c124ba747d457f23f777043926739d16e35d350e07`；`ProductSkillInstallation` 在原九字段后 additive 增加 required `display_name=10`、`summary=11`、`source_status=12`。owner V1–V7历史共93文件；其中BFF vendor V5–V7为27文件，三者 aggregate `3384a88f…`、`0d728881…`、`3f97b3c9…` 仍 byte-exact，不造 V8、不重算历史 pin。当前 BFF `bac0cbf` 仍固定 Platform `494b118a…`、旧 descriptor `ae268313…` 和九字段 projector/public 8.2，因此正常进程保持不重载，且不得先向 Web 声称元信息可用。

### §8 放置与发布边界

|项|决定|
|---|---|
|Owner / writer|Platform `skills/installation` 是安装、固定 revision 关联及 name/summary/status 的唯一 owner；BFF 只做受信 current-session 后的严格消费和 public 投影；Web 后继只展示。无 BFF 数据 writer。|
|当前入口|现 `scripts/generate-platform-connect-client.mjs` 固定单一 vendor commit并正规生成 `src/generated/platform-connect/**`；`personal-installation-connect.ts` 调五个具名 Product RPC；`personal-installation-response.ts` 当前只校验/投影九字段；public OpenAPI 8.2 的 `SkillInstallation` 也只有九字段。|
|目标职责|一次 clean repin 到 owner `c94909f…`，由正规 generator 得到 required 三字段；response projector 对 name/summary/status 做闭集、长度与 unknown 校验，五个 read/mutation ACK 均投影同一十二字段；public schema additive 升 8.3，operation 数仍 99。|
|位置比较|采用现 `personal-installation-response.ts` 扩展既有唯一安装响应映射，并同步现生成/contract门。另建通用 Platform mapper 会复制现职责；在 route/Web 补字段会绕过 owner strict 边界，均淘汰。|
|依赖|只依赖固定 Platform Proto/generated enum与现 owner client；禁止相对 import Platform 源、手写 Proto DTO、读取 Platform DB、缓存元信息、BFF N+1 catalog 查询或从 source_ref 猜名称。|
|数据/API|无 BFF DDL、Redis、receipt、事务或 cursor变化。public 三字段均 required，但这不等于 Proto implicit scalar 有独立 wire presence：`display_name`须非空白且 JS `length<=255`；`summary`允许空串且 JS `length<=65535`，原样保留、不 trim，owner省略空 scalar 时固定 decoder 得到`""`亦合法；`source_status`只允许active/disabled/withdrawn/quarantined。display越界/空白、summary越界、UNSPECIFIED/draft/未知enum才是owner-response-invalid→既有502。removed installation仍可携带权威元信息，status不授权执行。|
|删除项|repin 同一切片删除旧 `contract/vendor/kokoro-platform/494b118a…`；不得双 vendor、双 descriptor、optional字段、fallback、V8或历史 artifact 重写。|
|验证|先新 pin/十二字段 machine与projector测试形成有效 RED，再正规 generate/check；随后 unit/HTTP/contract/architecture/full check。Root 最后用真实 IAM→BFF→Platform read与 mutation replay，Web 再固定 BFF 8.3。|

### 精确后继范围（本 D0 不授权实现）

- owner机器/vendor：删除旧 `contract/vendor/kokoro-platform/494b118ae7c29f1fc1005122d72c6c2bbf2640b6/**`，新增同布局 `contract/vendor/kokoro-platform/c94909f1c593f2b7ffd5f325786739da744ff31f/**`；最新 Proto/descriptor取发布 commit，`execution-operations-v5/v6/v7`的27个vendor文件须与既有目录逐字节一致。现generator第165–173行不得继续用latest `sourceDigests`/`descriptorDigest`核V6 `sourcePins`：目标把V6发布时五个historical pins独立固定并逐一比较，latest Proto/descriptor另用新pin严格校验；保aggregate和逐文件byte门，不改V6 manifest/safeFields9，也不复制owner checker框架。修改 `contract/dependencies/platform-connect.json`、`scripts/generate-platform-connect-client.mjs`，正规生成 `src/generated/platform-connect/**`；不手改 generated。
- BFF source：仅现 `src/infrastructure/clients/platform/personal-installation-response.ts` 增严格十二字段投影；`personal-installation-connect.ts`、route、credential/projector、bootstrap无需新职责，除非 RED 证明真实类型接线缺失并先报 Root。
- public机器：`contract/openapi/v1/openapi.yaml` additive 8.3.0、99 operations不变；按现工具要求同步 `contract/README.md`、`scripts/verify-openapi.ts`、`scripts/check-contract.mjs`、`contract/tests/v1-operations.json` 中精确版本/字段 oracle，不改路径与状态码。
- 测试：现 `test/platform-connect-contract.test.mjs` 固定新commit/digest/generated、V5–V7 vendor 27文件不变，并验证owner历史总量93的发布证据；现 `test/skill-installation-http.test.mjs` 覆盖五RPC十二字段、合法空summary、display空白/长度边界、summary长度边界、UNSPECIFIED/draft/未知status；现 `test/contract/openapi-contract.test.mjs`、`test/contract-governance.test.mjs`、`test/architecture.test.ts` 仅同步8.3与required schema。若需新独立 response test，须先由 Root 加任务卡，不在本 D0发明。

**有效 RED 与发布顺序。** tests-only先把 owner commit改为`c94909f…`并断言tag10–12、public required与projector三字段；在旧源码上应分别因旧 pin/生成类型缺字段、public8.2九字段、projector遗漏而失败，不能用404、缺环境或未启动服务冒充。之后 owner机器→BFF source/public8.3→Root真实三层→Web consumer 串行发布；任一步未绿均不重载正常进程。

**停止线。** 当前无契约歧义；Root仍须在实现门固定新 Proto/descriptor实际SHA和新 dependency manifest digest，并实跑旧/新vendor tree差异只包含最新Proto/descriptor/provenance与目录commit变化、BFF vendor V5–V7共27文件原字节不变且owner V1–V7历史总量93不变。真实用户页面、removed/disabled展示文案与Web空态属消费者阶段，不在BFF D0提前裁UI。

<!-- R259-SKILLS-METADATA-BFF-D0-TECH-END -->

## R257 管理路由 HTTP 实施验收（2026-10-06 16:16 UTC）

四个已发布public8.2操作现有具名route/client实施，System3.0固定artifact与全部旧operation不变；无BFF DDL/新owner/兼容proxy。

Root92682 Node22 check+format exit0：contract264/0、主829PASS/0FAIL/2既有skip、lint/types/drift/build0；Root50905正式IAM CLI资格/Audit/CodePKCE/current admission→BFF四具名操作→System真实PG官方seed/三读/visible CAS保存/权威回读/原key重放/异body与旧版本409/坏Session401通过。资源PG77→77/IAM前缀keys0→0、cleanup passed；独审ea30e379，route8f59/clientb308/test3aeae1冻结。

正常BFF仍旧进程，本次未重启/授正常管理员；Web管理页面仍占位，合法普通Session403/管理员撤权后重放、普通models visible投影、浏览器保存确认、推理和资金未验。仅owner子链及本切片工程通过，旧404/400/502/取消抖动证据保留；下方阶段描述为历史exact suffix，不作当前否认实现的依据。

- 机器阶段已固定 System 3.0.0 immutable artifact `955bd587f46a771e43a4330d202d90a7d2d67262` / SHA-256 `94ed91655741cbba66ce80a4c41717b9179cc509cb6858534e0b78aa3e6dc059`，仅生成四具名 owner operations；public 8.2/99 为本阶段机器候选，生产 route/client/bootstrap 未进入本切片。
## R256-ADMIN-03.D0：当前 tenant 模型路由管理（2026-10-06；仅设计，待 Root 放行）

**证据与当前态。** 本文基于只读报告 `var/dev/r255-preserve/r257-admin-management-next-slice.md`（SHA256 `a376743747b454e1a95040ef2af7932a44056b177aa48efe07325a03a9527a1f`）及 BFF `975a2d8a538dfb1f4b83b33b98bc9262a77c00f2`。当前 BFF 已消费 IAM 0.8 的 required `platformAdmin`，但 `/system` 明确 fail closed，`/models` 只有普通 catalog read；不存在管理写路由。System 是 ModelLabel、ModelRevision、RoutingPolicy 与 command receipt 唯一 owner；其 runtime-Zod 机器源为 3.0.0、OpenAPI SHA256 `94ed91655741cbba66ce80a4c41717b9179cc509cb6858534e0b78aa3e6dc059`。本轮只增加三份文档前缀，零源码、机器合同、generated、DDL、配置、资源或资格变化；下方原文保持历史后缀。

### 已裁决授权、职责与状态

- current IAM `platform_admin === true` 只在 BFF 固定 Product tenant 内授四个具名 public 操作；每次请求仍先完成 current Session admission，缺失/错型/依赖失败不按 false 或旧 true 继续。false 返回管理 403，普通产品能力不受影响。tenant/actor 只取受信 `context.identity.namespace/userId`，Browser 自报 tenant、actor、permission、service 一律忽略。
- BFF 使用既有 `web-bff` service credential，只为三 read 生成 `system:read`、为一 PUT 生成 `system:write`。System 继续验证 service、固定 tenant、actor、permission、资源状态与 CAS，才是最终守门人。该映射不授 `system-admin`、global、publish、provider、delete 或组织成员权限；org admin 与 platform admin 互不推导。
- 首片状态只有当前 tenant 的单 label routing：有界分页读 routing/labels/revisions，显式 PUT 冻结 label、原 version、System 现行合法四字段、原 Idempotency-Key 与条件头，随后从 routing list 有界分页权威回读。第一轮用户验收/UI 只编辑 `visible` 并回送其余当前值；这不是 BFF backend 对 System 其他合法字段变化新增限制，BFF 不为此先读旧 row、合并字段或缓存权限。之后刷新普通 `/models` 核可见效果。PUT ACK 不是读模型，catalog 也不证明全部 routing 字段。
- 保存状态为 `idle -> saving -> verifying -> confirmed | conflict | unknown | failed`。保存/核实绑定 tenant、subject、admission generation、草稿 generation 与单一 10 秒总预算；取消只退役等待，不证明 System 写入撤销。CAS 冲突保草稿并回读新 version；丢 ACK/期限/断网为 unknown，只读核实且不自动换 key 重写。分页找不到、读失败、同值或更高版本均不得伪造本命令因果确认。
- System receipt 是写幂等唯一事实。BFF 不进入内存 `MutationTicket`/receipt 分支，不造第二 receipt、admin service、兼容 alias、通用 command executor 或 `/system` 万能代理。首片不做跨两行默认切换、label/revision/provider CRUD、publish/retire、推理与计费。

### §8 放置表与依赖边界

|项|决定|
|---|---|
|Owner|System 唯一写 ModelLabel/ModelRevision/RoutingPolicy/receipt；BFF 只拥有 public 管理用例、current-session 授权与 wire 映射；Web 后继只拥有交互。无新数据库 writer。|
|当前事实|`src/bootstrap/server.ts` 已 fresh admission；`src/http/routes/owner.ts` 对 `/system` 返回 503；`src/upstream.ts` 不保 If-Match/If-None-Match/AbortSignal；现 owner identity 不生成 permission。普通 `/models` 仅投影 visible catalog。|
|目标职责|四个具名 public route 只代理 System 3.0 的 `listRoutingPolicy`、`listModelLabel`、`listModelRevision`、`putRoutingPolicy`，strict 解析并映射稳定 public 结果/错误；不公开任意 upstream path。|
|位置方案|采用新增 `src/http/routes/model-routing-admin.ts`（public route/授权/映射）与 `src/infrastructure/clients/owner/system-model-routing.ts`（System wire、期限、header、strict parse）。另一方案扩 `owner.ts`/`liveOwnerRequest` 会扩大万能代理和条件头权限，淘汰；另建 admin module/service 只有单用例且制造第二管理边界，也淘汰。|
|粒度|两个普通职责文件，不建新一级模块/目录树/CQRS；`src/bootstrap/server.ts` 只在通用 mutation 之前精确分派。共享入口由 Root 集成。|
|依赖|route 依赖 admitted context 与具名 client；client 依赖现 HTTP primitive、固定 generated System 3.0 类型。禁止相对导入 System 源、手写重复 DTO、DB/Redis、generic proxy permission 扩张、跨 owner SQL。|
|数据/API|Public OpenAPI 从 8.1.0/95 operations additive 升 8.2.0/99 operations；System 3.0 固定 commit/digest artifact 正规生成。无 BFF canonical schema、事务、cache、receipt 或 credential 总表变化。|
|删除项|无既有管理实现可删。禁止保留未发布别名、旧 System pin 双读、optional generated shape、fallback 或第二 admin 服务。|
|验证|先合法 current-admin→真实 System owner/PG 的目标 route 业务 RED；再 machine/generated drift、unit、真实 HTTP/PG、architecture、完整 check；最后 Root normal 配对和真实浏览器。|

### 后继精确实施与测试写集（本 D0 不授权写入）

- 生产：新增 `src/http/routes/model-routing-admin.ts`、`src/infrastructure/clients/owner/system-model-routing.ts`；现 `src/bootstrap/server.ts` 仅具名早分派，配置文件仅在实际生成 client 接线需要且须先报 Root。`src/http/routes/owner.ts`、`src/upstream.ts`、generic identity 默认不改。
- 机器/generated：`contract/openapi/v1/openapi.yaml`、`contract/README.md`、`contract/tests/v1-operations.json`、`scripts/verify-openapi.ts`、`scripts/check-contract.mjs`；新增 `contract/dependencies/system-http.json`、固定 `contract/vendor/kokoro-system/<COMMIT>/system.openapi.json` 与 provenance、`openapi-ts.system.config.ts`、`scripts/generate-system-http-client.mjs`、正规 `src/generated/system-http/**`；`package.json` 只登记生成/check/窄格式。generated 由工具生成，不手改。
- 测试：新增 `test/model-routing-admin.test.ts`、`test/system-model-routing-client.test.ts`、`test/system-http-contract.test.mjs`；现 `test/user-admission.test.ts`、`test/contract/openapi-contract.test.mjs`、`test/contract-governance.test.mjs`、`test/architecture.test.ts` 仅按实际必要追加。真实 owner PG/TCP 组合由 Root 隔离装配，不用 doubles、伪 token、404 或缺方法冒业务 RED。
- shared `bootstrap/server.ts`、`package.json`、public OpenAPI/operation inventory 与生成入口由 Root 串行集成；writer 不接触 Git index。后继 RED 必须证明：合法 current platform-admin + 固定 tenant + 正式 service identity 到目标 public read/PUT，当前因 route 不存在而失败，并且 System fixture 有真实 routing row；普通 false/跨 tenant/global/伪 header 仍零写。

**未决项/停止线。** 实施开工前 Root 只需把 System 3.0 artifact 的正式 immutable commit 与 BFF 8.2 发布 digest 写入 dependency pin；当前只读 System checkout HEAD 不作为发布 pin。Web 文件集须按 Root 最终 Web HEAD 再冻结。本 D0 不运行测试、服务或资源，不授账号；正常管理员身份、真实路由改写、Web 页面、推理与 Billing 继续 OPEN。

<!-- R256-ADMIN-03-D0-TECH-END -->

## R257-PERSONALIZATION-EVOLUTION-D0：已有数据具名演进（2026-10-06；待 Root 审准实施）

**当前与目标。** 本人四字段源码已由 Root 验收并提交 399e70dfd97004c4c75cfb1e83c571a38c749437（真实 11 PG 用例通过，完整 check 809 PASS/0 FAIL/1 skip）；正常 BFF 仍 6d46ec8，尚未配对激活。以下原全文保留为历史阶段，旧“未实施/无表”不描述本次源码。正常完整 catalog 尚未核查，不声称旧表总数或正常演进通过。本轮仅设计，具名例外见 [ADR-003](./ADR/ADR-003-personalization-schema-evolution.md)。

### §8 最窄放置与实施边界

|项|决定|
|---|---|
|Owner / 位置比较|BFF 唯一 writer；采用现 scripts 下三个普通具名文件。扩展 apply-schema.mjs 虽可复用入口，却会混淆 fresh 空 owner 与有数据演进，淘汰；不建通用 migration runner/ledger/新服务。|
|三文件职责|evolve-personalization-schema.mjs 仅 strict CLI/check/apply/脱敏结果；personalization-schema-evolution.mjs 仅本次连接、事务、期限、COMMIT 与清理；personalization-schema-catalog.mjs 仅目标语义 catalog 和 canonical 唯一 CREATE 提取。无新目录/依赖。|
|依赖 / 删除|只复用现 apply-schema.mjs 的 loadCanonicalSchema/assertBffSchemaUrl；绝不调用 applyCanonicalSchema 或执行整份 canonical。fresh、运行时 source、schema、其他 owner/Project 原 mixed 不改；无旧入口要删，不建 alias/双轨/启动 DDL。|
|后继精确写集|上述三 scripts；新 test/personalization-schema-evolution.integration.mjs；现 package.json 仅具名命令及窄验证入口、test/schema-governance.test.mjs 仅追加提取一致性/fresh 非空拒绝保护。此表是下一阶段范围，本轮未获源码实施许可。|
|独立测试位置|新 integration 承载有数据旧 shape/锁/unknown 生命周期，不再扩展 business-store 大文件；复用 Root 自有临时库及既有业务入口，禁止 normal reset/跨 owner SQL。|

### 操作生命周期与受控配对

Root 停止/drain BFF 写入与 worker，在无并发手工 DDL 的窗口执行；只一个自有 PG 连接。显式连接上限 5s、整操作 20s、事务 LOCAL lock_timeout 2s/statement_timeout 5s/idle_in_transaction_session_timeout 5s 均为待演练目标，各阶段受剩余总预算限制。BEGIN 后固定 owner search_path/UTC，取与 fresh 相同的 pg_advisory_xact_lock(hashtext(current_database()),hashtext('kokoro_bff'))；判据、唯一 CREATE 与后置校验同事务。current 先确认关系种类、有限锁住目标再验；不锁旧业务表做长时间 ACCESS EXCLUSIVE。check 不执行 DDL/数据写，apply 仅 legacy 创建目标；前后旧 owner catalog 摘要不变（剔除本次目标衍生对象），不把混合 canonical 当旧表 oracle。

COMMIT 前失败在剩余预算 rollback，保 primary，清理失败单列；超时/取消必须退役 exact connection，不以 Promise.race 当 SQL 已取消。COMMIT 发出后失联、超时或未完成安全收尾均 unknown，不声称已 rollback、不自动 apply 重试；新连接同锁 check 才裁当前 schema 状态，旧 backend 未释放锁就有限等待/停止。只有 Root 确认 serialized legacy、旧连接终止且原因解除才再显式 apply；无 down/自动恢复备份。应用启动失败保留 additive 表，按匹配版本回退应用，不删已保存资料。

normal 准入：Root 先核实际 owner catalog/旧事实聚合，停写后完成 kokoro_bff 一致备份（目录私有、备份文件 0600）及自有临时库恢复验证；记录旧 Project/Conversation/Message/Share/Scheduled/receipt/AGUI 事实保全，不打印正文。只演进本 owner。IAM 正常 schema+0.8、BFF /me+public8.1+本人表、Web strict /me/后继本人保存消费受控配对；不混发新 required shape，不重置帐号/Session/OAuth/历史。不等待支付等独立业务；无可用 Web 消费者时不宣称用户保存已完成。

验证顺序：node --check 三 scripts、窄格式/治理门；Root 自有 PG 旧 shape→check legacy→apply→check current，已有事实/已存偏好重放保全、双并发、漂移零写、锁/取消、真实 TCP COMMIT ACK 未知恢复；随后完整 check。现 tsc 不覆盖这些 mjs。测试方法 hook 的 after-COMMIT 错误不冒充真实 TCP。最后 Root normal 配对与用户保存/ACK/回读/刷新/切账号/冲突验收；本轮未执行任何资源或工程测试。

<!-- R257-PERSONALIZATION-EVOLUTION-TECH-END -->

## R257-PERSONALIZATION-D0：本人四字段显式保存（2026-10-06；设计待 Root 放行，未实施）

**当前态。** 基线为 Root 已发布 ac3cd1da4f13e9e22320efbd4dbf4009aa0a2e29；原 19 mixed 保留。本节以下全部原文为历史阶段的 exact suffix；管理员消费源码已发布的当前事实见 CURRENT，不再以旧段落“待实现”描述它。正常 BFF 仍旧实例，IAM/schema/Web 同步激活停止线不变。

现 Web settings-sections.tsx:373–421,492–497 的四字段为 nickname、occupation、about、instructions：normal 无 GET，blur 发未发布 PATCH 且忽略非 2xx；preview localStorage 不是真保存。Root 已有正常 PATCH 404 的业务证据。BFF bootstrap/server.ts:369–372 无对应 owner 路由，canonical 无表/operation。PRD FR-14 要求正式设置保存、读回、刷新、切账号隔离；本片只闭合四字段，Knowledge、导入和 Agent 实际采用指令仍 OPEN。

### §8 放置表

|项|当前设计决定|
|---|---|
|Owner / writer|BFF Product 唯一拥有本人四字段；Web 拥有草稿与显式保存交互。Root 审批/集成/正常资源，本轮唯一 writer 仅三 D0 前缀。IAM 只提供 current Session identity，不用 User.name；System 不代存任意偏好。|
|现入口|service+Bearer → IAM admission → bootstrap → businessStore.services；PostgresBffRepositories 复用唯一 PostgresBffDatabase.pool/search_path=kokoro_bff。现 generic mutation 管线有 receipt；本资源精确分派后提前返回，不进入它。|
|目标|同一受信 tenant+subject 的 singleton GET 与 required expected_revision 的 PUT 全量替换；四字段真实 PG，不建任意 key/value 配置或动态字段注册。|
|位置比较|采用现 application/ports 的窄 PersonalizationRepository 与 infrastructure/postgres 实现，挂入现 services 聚合，并使用小 input/route。另一可行方案为新 PersonalizationService 包装 port；本片没有额外编排，淘汰纯转发 wrapper。也不塞 ProjectService/IAM 或新 prefs 服务。|
|粒度|新增四个普通文件，无新目录/框架。port 只定义 scope、四字段 snapshot、CAS 结果和两方法；PG 文件只负责本表 SQL/连接生命周期；input 只解析 wire；route 负责 HTTP 映射。无机械 DTO/Command/Row 五套复制。|
|依赖|HTTP 只使用已验 context.identity.namespace/userId；platformAdmin 不参与本人资格。port 不泄漏 pg/framework，PG 复用 pool，严格 raw JSON 复用现 parser。禁止跨 owner SQL、Web 直读 DB、自报 actor、Admin :any、Redis 权威缓存或跨服务事务。|
|数据/API|唯一 database/schema.sql 增本人表，public 唯一 OpenAPI 增 GET/PUT；CAS、冲突、未知 ACK 见 API/DATA。无 receipt、outbox、审计正文副本。|
|删除/保留|后继 Web 删除 normal blur PATCH、吞错和假本地持久化；不发布旧 PATCH alias/双读 fallback。独立 preview、Knowledge/导入边界保留，正式能力仍 OPEN，不以隐藏或假成功关闭。|
|验证|先合法保存 HTTP/PG 业务 RED，再机器、真实 PG/并发/取消/unknown 与工程门；最后 Root 正常合法 Session 保存/刷新/切人。doubles/源码门不代正常 E2E。|

### 装配、状态与失败恢复

现 BffApplicationServices 新增 required personalization: PersonalizationRepository 及 constructor 参数；PostgresBffRepositories 构造同 pool adapter 并注入（当前唯一 new BffApplicationServices 调用点）。不增 optional repository/fallback；BffBusinessStore.services 自动承载。bootstrap 在 IAM 准入后、generic receipt/body/proxy 分支前精确分派；不把整个 preferences 前缀开放。缺 store 真 503；GET 不 insert，PUT 不调用其他 owner/Redis。

GET 为不存在 revision=0/null 或当前完整 snapshot。编辑只改内存草稿；显式保存冻结 expected_revision+四字段，PUT committed ACK 后 GET 核当前 revision/内容。两标签页同 revision 仅一笔提交成功，另一笔409，不自动覆盖/合并。未知 PUT 回执只读核实、不盲重发：GET 旧版本可能先于在途提交，不能据此断言未写；新版本不同为冲突，读失败仍 unknown。Web 后继按 tenant+subject 及 admission generation 绑定请求，pending/退出/切人同步隐藏旧私有值、取消并退役迟到响应；不同人不继承草稿/revision，不用 localStorage/sessionStorage 保存 normal 正文。

准入保持现 IAM 独立有界预算；新资源从准入后进入 route 起另设单一 5s 总预算，覆盖 body、pool 排队、SQL、commit/回滚，各阶段不重置，不宣称含 IAM 的整请求仅 5s。aborted/未结束 response close 传播 signal。PG 随剩余预算设置事务内 statement_timeout，lock_timeout≤1s 且不超剩余；排队迟到取得即 release，不启动 SQL；在途 SQL/COMMIT 超时或取消销毁 exact client，不归池复用，不用假 ROLLBACK 证明未知提交失败。已知失败 rollback 也在同预算内，耗尽销毁；清理 timer/listener，不吞 primary；不写已结束响应，无自动重试。现 Project rename 有界语义只作参考，不抽新共享框架或改受保护源码。

### 后继精确范围（本次只设计，须 Root 另准）

- 新 source 四个：src/application/ports/personalization-repository.ts、src/infrastructure/postgres/personalization-repository.ts、src/http/personalization-input.ts、src/http/routes/personalization.ts；无新目录/process/dependency/lockfile。
- 现 source：src/application/services.ts、src/infrastructure/postgres/repositories.ts、src/bootstrap/server.ts（精确分类/admission 错误 envelope/早分派）、src/infrastructure/postgres/client.ts（ready 最小本表要求，不改全局 pool/Redis）。routing.ts 保原分类，精确分派前返回；BffBusinessStore 不另加 optional 属性。
- 机器/治理：database/schema.sql、contract/openapi/v1/openapi.yaml、scripts/verify-openapi.ts、scripts/check-contract.mjs、contract/tests/v1-operations.json（正规 baseline 命令）、contract/README.md、package.json（仅注册窄测试/格式门）。check-contract/verify 只为精确 PUT+path+operationId 的 CAS 例外判 none，并反向断言 required expected_revision；旧 mutation 的 required-key 负控不放宽。内部 owner pin/vendor/generated 不变，Web 后继固定新 public artifact。
- 现测试：test/business-store.integration.mjs（真实 HTTP+PG/原 lifecycle fixture）、test/schema-governance.test.mjs、test/contract/openapi-contract.test.mjs、test/contract-governance.test.mjs、test/architecture.test.ts。新增 test/personalization-input.test.ts 只承载 strict wire 边界。其他 aggregate doubles 若实际类型失败，先列调用点再扩集，不放 optional/default。
- schema.sql 与 schema-governance 是原 mixed：Root 先冻结已有字节，后继只追加本表/具名 case，不接收原 Project/删除/installer 候选；其余 mixed、CURRENT、normal env 保持。
- 后继已有命令：pnpm build；node --test test/personalization-input.test.ts test/contract/openapi-contract.test.mjs test/contract-governance.test.mjs；node --test --test-concurrency=1 test/business-store.integration.mjs test/schema-governance.test.mjs（仅 Root 分配自有 PG/Redis）；pnpm contract:update-baseline（派生阶段）、pnpm contract:check、pnpm lint、pnpm typecheck、pnpm test:architecture、pnpm check。窄 format 与原 protected 全局 format 失败分开记录。本轮未运行。

**发布停止线。** canonical/fresh integration 不等正常演进。Root 另审 BFF owner 具名 additive 演进、备份/恢复、schema drift 拒绝与原数据保全后才能上线；禁止正常库 fresh reset/seed、启动自动 DDL 或私 SQL。当前基线还带 IAM0.8 required /me，不能为偏好重载不兼容正常 IAM/Web 的半边。工程片可独立进行，normal 激活需现 admin 组合门与本表正规演进；不等待支付/Knowledge/Agent 应用/完整后台 CRUD 才做本片研发。

<!-- R257-PERSONALIZATION-D0-TECH-END -->

## R257-ADMIN-BFF-D0：当前管理员资格消费（2026-10-06；设计待实施）

**基线/事实。** 本仓基线为 Root 已提交的 6d46ec8，原19 mixed全部保留；MCP本人Connection片已由Root full check 795 PASS/1 skip、独审后发布，与本片独立。本次仅三D0新前缀，下面原字节不变。BFF当前仍消费IAM0.7.0/e3c035b99cf9479ac8357c7d38147f1541dcbcac；session-admission只返回identity，GET /v1/me仅user_id/tenant_id，不存在已实现的管理员投影或后台CRUD。

IAM owner已发布 d24aa2b697de59a350e8588720620df331bc5da5，internal0.8.0，contract/openapi/iam.internal.v1.json SHA256 0153a16f5c2779803d73d93d5533caf1b377d21299cefe01613d7cd1b2cbb194；本次只读重算exact。Root报告真实两integration34/0、完整verify939/0及独审；不是BFF/Web或normal管理员验收。IAM正常旧实例未重载、正常帐号未grant；旧三D0的基线目标文字按其历史时点阅读，不否认此已提交owner实现。

### 唯一 owner 与最窄位置

|项|当前决定|
|---|---|
|资格|IAM User.platformAdmin唯一事实；受控独立manager Session/CAS/Audit授撤；BFF不写资格、不解释组织role/email/OAuthoperator/financial名单。|
|准入|现POST /internal/v1/session-authorizations/verify返回required platform_admin；IAM已限定fixed Product Web client+fixed tenant+当前User资格及全部原Session/Member/client/resource/binding。BFF保固定tenant检查，不复制owner client资格判定或新增scope。|
|放置比较|采用现auth/session-admission client/types → user-admission → bootstrap /me；拒另建admin service/endpoint/角色引擎、解析JWT管理员claim或信自报header。|
|受信类型|现session-admission.types.ts成功分支新增required platformAdmin:boolean；现domain/request-context.ts增具名AdmittedUserRequestContext = RequestContext & {platformAdmin:boolean}，user-admission成功context必填。基础RequestContext及service-only身份不机械扩权限字段，无optional或生产默认false。|
|公开展示|扩现GET /v1/me的required platform_admin；false仍普通登录200。Web后片同源/admin、Settings与管理API各自消费当前投影；本BFF片不创造管理CRUD或假后台列表。|
|数据/删除|不增加DB/Redis键/资格缓存/receipt/权限表。旧IAM0.7 active pin与generated输入替换为唯一0.8，不双读旧shape、不alias/fallback；现MCP/Team/Skill/财务边界保持。|

### fresh资格、取消与正常切换停止线

现SessionAdmissionClient每次verify都请求owner，没有肯定资格缓存；保持现transport最大5秒/1MiB、取消/迟到退役、no-store、错误与受控request ID边界。新布尔只能从固定generated完整strict响应取得；缺失/null/字符串/额外字段/依赖失败为iam_admission_unavailable，不假false或沿用旧true。普通false不阻普通产品路由。

Web后继Settings显示只是提示：/admin每次server准入和每条管理API请求都fresh核定，明确true才准入；普通false为后台403，依赖错误保持503等真实失败，不伪装普通用户。A→B/退出/重核pending或失败立即去旧管理显示/迟到结果；Cookie/JWT/localStorage/先前页面true不授权。每个管理命令仍需目标owner当前权限/范围/审计，平台true不授跨tenant :any、财务scope或MCP调用权。撤销提交后开始的新IAM snapshot必须false；不宣称撤销原子取消早已准入的跨服务在途操作。

上线门：0.7严格consumer拒0.8多字段，0.8严格consumer也拒旧响应缺字段，禁止先部署任一半边或添加兼容默认。Root先批准IAM正常有数据schema演进/备份恢复与校验（不得fresh installer/reset/seed），准备新IAM、BFF与Web固定artifact消费者，统一受控切换窗口并记录中间失败闭合/最终本人读；正常BFF仍按旧IAM配对运行，未过此门不重载。不靠本D0执行任何配置/帐号grant。

### 后继精确文件与验证（须Root另准source）

- 生产现5文件：src/auth/session-admission.client.ts、src/auth/session-admission.types.ts、src/auth/user-admission.ts、src/domain/request-context.ts、src/bootstrap/server.ts；现src/auth/session-admission.transport.ts仅原样回归，除非实际失败另报扩集。不动业务RequestContext调用方/普通owner routes。
- 固定生成：contract/dependencies/iam-http.json、openapi-ts.iam.config.ts、scripts/generate-iam-http-client.mjs、contract/vendor/kokoro-iam/d24aa2b697de59a350e8588720620df331bc5da5/iam.internal.v1.json与现src/generated/iam-http/**正规16文件；退役旧active0.7 vendor。normalizer随新required字段精确更新strict嵌套匹配/计数，不手改产物、不扩原14operation过滤。
- Public：contract/openapi/v1/openapi.yaml、scripts/verify-openapi.ts、contract/README.md；仅CurrentUserIdentity新增required boolean，operation数保持93；contract/tests/v1-operations.json应保持原字节，不无故重建。Public发布前8.0.0交新immutable commit/digest，MCP已交Web的6d46ec8原blob不改。
- 先现行为RED/后回归：test/iam-admission-client.test.ts、test/user-admission.test.ts、test/contract/openapi-contract.test.mjs、test/contract-governance.test.mjs、test/architecture.test.ts；test/doubles/session-admission.ts和test/doubles/server.ts只补明确普通false成功fixture，保原拒绝/调用计数，不把测试缺字段兼容带入生产。其他inline admission fixture只在实际类型/行为失败后列具体扩集，不授权批量改所有tests或受保护19mixed。
- RED应是合法IAM0.8响应/本人true-false未被正确投影，不是缺vendor/不存在方法/编译错误。覆盖普通false、true→撤权false同token每次owner调用、A/B隔离、header/query伪资格无效、固定tenant拒绝、owner字段缺失/错型/额外、timeout/body/取消/旧true不回补；保Team/Skills/MCP普通回归。
- 后继已有命令：pnpm contract:generate:iam / contract:check:iam；pnpm build后node --test test/iam-admission-client.test.ts test/user-admission.test.ts test/contract/openapi-contract.test.mjs test/contract-governance.test.mjs；pnpm typecheck / lint / format:check / contract:check / test:architecture / check。Root真实normal IAM→BFF→Web普通/管理员入口、直链、撤权/刷新另验；本轮文档不运行命令/资源。

<!-- R257-ADMIN-BFF-D0-TECH-END -->

## R257-MCP-BFF-D0：正式本人 MCP Connection 读取（2026-10-06；设计候选，未实施）

**基线。** BFF main ef2d3062e7503cb443d88a972804a98e9158a321，19项原 mixed（含文档与未跟踪删除候选）由Root保护。本前缀以下旧文件全部bytes保持。正常新增页仍读全局Server而非本人Connection，Root已记录wrong-resource业务RED；不是新接口已实跑RED。BFF当前HTTP consumer仍pin Platform3.1.0/6a09913a96c686b316bfe707b823d039e625607a。Root本轮已核Platform已提交main 9ab3b653360d04fb498a238659edeec01e72f62d的 contract/openapi/platform-http.openapi.json 为3.2.0，与工作树全文SHA256 4b42dd161c972b3447cfea3a6f80a949bbdb573c46213dbf8ef4c3ecb58e72da exact。后继生成必须固定该提交完整SHA及digest，不消费移动工作树；Connect版本/aggregate不是本HTTP来源。Root已核正常Platform启用surface尚缺mcp-connection，正规启用/原句柄重载由Root独立处理；这是发布后运行前置，不改成旧Server fallback，也不由本片操作配置。

### 放置与边界

| 项 | 当前决定 |
|---|---|
| Owner | Platform拥有Connector/Connection/current authorization/Server；BFF只发布public读取，Web消费投影。Root独占后继放行、资源、Git；本轮只准三D0前缀。 |
| 唯一增量 | GET /v1/mcp/connections，operationId=listSelfMcpConnections，六字段本人active连接；不是连接命令/Server注册/enable或Agent执行。 |
| 位置比较 | 采用现 src/http/routes/platform-projection.ts 的明确operation分支与 src/infrastructure/clients/platform/projection-http.ts 固定generated调用；淘汰Web过滤Server、独立服务/第二HTTP栈/BFF Connection表。 |
| 身份 | 现service+当前IAM Session admission → context.identity.namespace/userId → 独立projection workload → Platform。caller header/body/query不赋tenant/subject；不借Skill权限、不新加人类MCP-read权限。 |
| 权限 | public capability.mcp.read沿现治理分类，不证明新增IAMgrant；实际是当前Session+认证BFF workload+Platform完整same-tenant/user-self/current资格。投影不是invocation grant。 |
| 数据 | 无表/列/索引/SQL/Redis投影/receipt/outbox/事务，不读Platform数据库。 |
| 删除/保留 | active HTTP3.1输入/pin换成唯一固定3.2并正规生成，旧vendor按生成来源替换；原Skill/Server操作保持。GET /v1/mcp/servers不重解释、不alias或双读fallback；Web展示切换另卡。 |
| 排除 | 19原mixed、Project删除、MessageCreate/selected_mcp_connection_refs、Agent、IAM权限、Provider/secret、Admin、所有MCP非GET与normal配置/启动不在本片。 |

### 读取/失败生命周期

每次先IAM admission，失效/撤权/异租户拒绝且零Platform调用。owner tenant/subject headers只由受信RequestContext生成，普通用户Bearer不下传Platform；现projection credential/token负责独立workload。Platform在有界RepeatableRead中核同tenant active connection、active user/self connector、其current approved authorization、registered且provider一致的streamable_http server，资格后分页；BFF不重算predicate、不筛漏为空成功，同Server多个Connection不合并。

新operation在现client建立单次总预算：沿 platformProjection.timeoutMs（默认5000ms）覆盖credential/token等待、owner headers/body及解析，不在拿到token后重置。owner body仍1MiB，token body沿现64KiB；复用single-flight，取消单waiter不杀其他waiter，最后waiter取消可中止flight。request aborted/response close贯穿取消；已取消/销毁/结束response不再写，迟到token/body不得启动下一调用或回写。超时终态失败，无自动重试/预取；取消不宣称瞬时停止owner在途SQL，读取也不是授权租约。

现client原实现token与owner各阶段分别计时、route只派发servers；新operation总预算/取消/400映射是待实现目标，不冒旧测试已覆盖。局部约束新operation，不重写旧Skill/Server/token缓存框架。owner固定generated schema、JSON media、exact request-id/no-store全核后才投影；错误见API本节。empty仅代表本次无可见active连接，不证明安装/enable/工具执行。

### 后继精确写集与门（Root另行放行）

- 先现测试RED：test/platform-http-contract.test.mjs、test/platform-projection-http.test.mjs、test/platform-projection-route.test.mjs、test/contract/openapi-contract.test.mjs、test/contract-governance.test.mjs。保原断言，补pin/唯一operation/六字段拒Server、query/subject映射、分页400、空/错/取消/总deadline/body cap；原credential测试不改但回归。
- 机器/固定生成：contract/openapi/v1/openapi.yaml、contract/tests/v1-operations.json、scripts/verify-openapi.ts、contract/README.md；contract/dependencies/platform-http.json、openapi-ts.platform-http.config.ts、scripts/generate-platform-http-client.mjs；按批准完整commit替换现contract/vendor/kokoro-platform-http来源目录，src/generated/platform-http/**只由正规generator写。无依赖/lockfile升级。
- 生产最小两文件：src/http/routes/platform-projection.ts、src/infrastructure/clients/platform/projection-http.ts。owner.ts:126已有dispatch、bootstrap现admission/非GET拒绝保持；projection-token/credential原职责复用，非必要不改。发现须扩大文件集先交Root，不自行新建模块。
- Node22.22.2/pnpm11.25既有命令：node scripts/generate-platform-http-client.mjs --write（后继生成阶段）；pnpm contract:check:platform-http；pnpm build && node --test test/platform-http-contract.test.mjs test/platform-projection-credential.test.mjs test/platform-projection-http.test.mjs test/platform-projection-route.test.mjs test/contract/openapi-contract.test.mjs test/contract-governance.test.mjs；再pnpm format:check / lint / typecheck / contract:check / test:architecture / test / build。本D0未执行命令/资源。
- doubles证明wire/映射，不算真实IAM/Platform PG。Root后验正规Session A/B、本人连接/撤销/精确过滤/分页，再Web正常新增页/刷新/切人；缺合法自有连接只验empty，不seed/私SQL/preview造正控。完整创建授权/enable/Agent invoke/撤销旅程仍OPEN，不阻本人读取片，也不被读取PASS覆盖。

<!-- R257-MCP-BFF-D0-TECH-END -->

## R255：ScheduledTask recurrence anchor 与 Scheduler-confirmed next 投影（2026-10-05；仅设计）

**当前态与目标。** 正常用户创建 weekly 08:00 America/New_York 任务后，BFF 把省略的 `next_run_at` 填为创建瞬时点并持久化，公开列表因而显示 21:16；Scheduler 实际 command receipt 已返回 owner 计算的 `next_due_at`，但现 BFF delivery 将 2xx 降成无内容 `succeeded`。目标保持 BFF 为 ScheduledTask 产品 owner、Scheduler 为 recurrence/`next_due_at` owner：把规则日期锚点 `recurrence_anchor_at` 与可空的 Scheduler-confirmed `next_run_at` 分开，复用现 task/outbox receipt 的 lease/fence/revision settlement 原子投影。本文不表示机器契约、源码、SQL或真实 Scheduler 验收已经完成。

### §8 放置与后继范围

| 项 | 当前裁决 |
|---|---|
| Owner | BFF 写任务、锚点、公开投影与 outbox；Scheduler 计算 recurrence/`next_due_at`。Web 只显示公开值，不计算日期。 |
| 当前事实 | `application/scheduled/input.ts` 以 `new Date()` 伪成 next；task/SQL 强制 next 非空；`scheduler/schedule.ts` 又借该值选择 weekly weekday；Scheduler client 已接收 receipt，但 delivery/dispatcher/settlement 丢弃其 Schedule。 |
| 目标职责 | create/patch 只把 `recurrence_anchor_at` 用作现 weekly weekday 选择；`next_run_at` 仅保存当前 task revision 经 Scheduler receipt 确认的 instant。pending、disabled/paused/failed 或修改后待确认时为 null，不把创建/更新时间冒成执行时刻。 |
| 位置比较 | **采用**现 ScheduledTask outbox delivery→dispatcher→Postgres fenced settlement：网络仍在事务外，receipt projection 与 outbox 成功同事务提交。**淘汰**同步网络塞入创建事务、Web/BFF 新建 cron/date 算法或靠 callback 加周期；它们会破坏本地原子提交、重复 DST 语义或产生双写。 |
| 粒度 | 扩现 scheduled 普通类型、port、client、dispatcher、repository；不建 sync 平台、新模块或通用 receipt framework。Scheduler 持续状态 read 是后续 owner 契约，不塞进首片。 |
| 依赖 | 允许固定 generated Scheduler response、现 DB clock/lease/fence/revision 与 public OpenAPI；禁止 Scheduler SQL、Web 日期计算、跨 owner transaction、IP/target 绕过。正常 localhost 可沿 Scheduler 既有 exact allowlist/SSRF guard由Root配置验收，本片不改该机制。 |
| 数据/API | public 8.0.0 发布前 clean-slate 把 create/patch 输入 `next_run_at` 替换为 `recurrence_anchor_at`，不留 alias；输出 `next_run_at` 仍为必有成员但允许 null。SQL 新增非空 anchor、next 改可空；不新增状态列/表/索引。 |
| 并发 | register/replace 成功必须校 receipt 的Schedule name/rule/timezone/paused/next及callback body中的tenant/task/owner与本命令请求exact；Scheduler `version`只验证为正规正整数并绑定同一receipt，它是Scheduler owner版本，绝不与BFF task `revision`直接比较。同一 lease owner/token/fence 下，仅当outbox `aggregate_revision`等于锁内task当前revision才写next并settle。旧revision或迟到/旧lease ACK可按现规则失败或收束自身命令，但不得覆盖新任务、删除后复活或写入旧next。 |
| 删除项 | 删除“now即next”、输入`next_run_at` alias及“任意2xx即丢body成功”；不删原幂等、Project/tenant admission、outbox或Scheduler SSRF保护。 |
| 验证 | contract/schema fresh install；create/replace receipt正负、pending/null、paused/null、旧revision/lease ACK、unknown ACK、worker restart与原子rollback；最后Root真实 weekly 08:00创建→确认→刷新、编辑失效/再确认、暂停。 |

后继准确源码/机器写集限于现 `contract/openapi/v1/openapi.yaml`、`scripts/verify-openapi.ts`、`contract/tests/v1-operations.json`及对应contract tests；`database/schema.sql`、现schema apply/governance测试；`src/application/scheduled/{input,mappers}.ts`、`src/domain/scheduled-task/{task,outbox}.ts`、`src/application/ports/scheduled-task-{repository,outbox-delivery,outbox-repository}.ts`、`src/application/scheduled-task-outbox-dispatcher.ts`、`src/infrastructure/clients/scheduler/{schedule,control-client,outbox-delivery}.ts`、`src/infrastructure/postgres/scheduled-task-repository.ts`及现scheduled/contract/真实PG测试。生成物只由现正规脚本重建，不手改；Web pin另卡。

首片只保证 register/replace receipt 对当前BFF revision 的确认投影。Scheduler每次 occurrence 后会推进自己的 `next_due_at`，现无受认证 Schedule read/事件，所以首片receipt不是永久实时事实；持续刷新准确next仍以前置 Scheduler 在现 Schedule 边界发布最窄tenant-scoped受认证读契约为条件，且该新契约必须另行定义Schedule当前状态与BFF task当前revision/command identity的可信绑定，不能复用“曾有匹配receipt”的结论。此前BFF不得通过replace充当read、从callback推算周期或把已过期投影称为永久正确。

---

## R255-BILLING-CONSUMER-D0：个人 Credit 只读链（目标，尚未实施）

### 当前事实与唯一方向

BFF `f3c64d90` 的 public `8.0.0` 仍声明 `GET /v1/billing/summary`，但其 `balance/currency/period/usage` 为浮点/现金样式旧合同；live owner route 只接 Billing v1 catalog/checkout，summary 仅由 test double 返回假余额，ledger 没有 public operation。Web 当前却请求同源 summary/ledger，并按十进制字符串 `*_micros` 展示 Credits；其 quota、赠送与daily refresh字段没有当前 Billing owner 事实。旧两端都不是可兼容保留的权威实现。

目标只接 Billing `244b2810c0cc043d29fffb2b3301eebf2d390b3d` 的内部 v2 本人两读：固定 `contract/openapi/v2/openapi.yaml`、artifact `3.0.0-experimental.3`、SHA-256 `ecaceefd3fd09d5106b364593dd513506622ca011bb0436b74f0928ffd8dcf00`，调用 `/v2/billing/me/credit-account` 与 `/v2/billing/me/credit-ledger`。owner README仍明确该artifact未发布/部署/消费，因此 pin、生成和源码GREEN不能代替Root对该固定owner runtime的发布/启动验收；BFF不得从移动工作树动态读取合同。

public保持现资源路径 `/v1/billing/summary`，但在尚未正式发布的public `8.0.0` 内clean-slate替换旧float DTO为owner语义的decimal-string Credit DTO，并新增唯一 `/v1/billing/ledger`。不保旧字段、alias、dual read或假零余额；不把Credit换算成现金。Web后继须同步固定BFF发布artifact并使用 `available_micros/held_micros` 与owner ledger字段，删除无owner依据的quota/free/daily展示分支；这不是BFF本片实现范围。

### 放置与依赖裁决

| 项 | 裁决 |
|---|---|
| Owner/调用方向 | Billing唯一拥有余额与流水；Browser→Web same-origin→BFF→Billing。BFF只投影已验证owner结果，不读Billing数据库、不创建wallet、不计算费率/赠送/充值。 |
| contract pin/generated | 沿现Agent HTTP consumer模式：vendor固定owner YAML、dependency manifest、独立固定生成脚本/config及只读 `src/generated/billing-http/`；只过滤上述2个operation并使用现有 `@hey-api/openapi-ts 0.99.0`/Zod4/fetch client。淘汰手抄owner DTO与运行时跨仓import。 |
| 普通源码位置 | 采用现 `src/infrastructure/clients/owner/billing-personal-read.ts` 单文件：只负责该两读的u1身份编码、五因素请求、generated response校验和有限错误分类；两个GET共享同一合同/身份/credential生命周期，当前无需新目录。向 `routes/owner.ts` 继续混入认证codec或另建`billing/`目录都会制造第二变化中心，均淘汰。若实现使该文件超过TS08职责预算，再由Root另卡拆codec，不预建空层。 |
| HTTP route | 现 `src/http/routes/owner.ts` 只做public path/query准入、调用client及BFF envelope；不复用现 `liveOwnerRequest/proxyUpstream`，因为其单一bearer与plain identity不满足Billing专用五因素/u1。 |
| config | `src/config/runtime.ts` 增具名 `KOKORO_BILLING_BFF_SERVICE_TOKEN` 字段；与现internal secret必须分别存在且不得相等。配置Billing upstream时缺任一因素fail closed，不退到用户JWT、plain header或v1。 |
| 数据/API | BFF数据库、receipt、幂等、Redis和事务零变化；公开wire见API R255。读响应始终`no-store`。 |
| 删除项 | 删除旧 `BillingSummary` float type与test double假100余额；public YAML原float schema原位替换，不留deprecated兼容。现plans/checkout与其v1链不随本片扩展或宣称可用。 |

可信身份只来自每次现IAM session admission后的 `RequestContext.identity.namespace/userId`；分别按Billing `personal-identity-u1`执行严格UTF-8、无paddingbase64url编码，绝不接受浏览器body/query/header自报tenant/subject。owner调用恰带 `x-kokoro-service:web-bff`、internal secret、独立service bearer、编码tenant与subject；partial/malformed credential不降级。public query只接受ledger的`limit` 1..100与单一opaque `cursor`（最多2048字符），原值一次转发；summary不接query/body。

owner 200必须通过固定generated schema后才由BFF重包 `{data,meta}`；不改decimal string、sequence、source或UTC instant。owner 404映射本人账户不存在；Billing 401/403是服务装配故障而非已准入用户的新鉴权结果，fail closed为BFF dependency unavailable；owner 500/503、timeout与不可达同为可重试503；畸形200为502。不得把404变空账户、把错误变200或缓存private结果。

### 精确后继写集与阶段门

1. **固定合同/生成RED→GREEN：** `contract/vendor/kokoro-billing/244b2810c0cc043d29fffb2b3301eebf2d390b3d/openapi.yaml`、`contract/dependencies/billing-http.json`、`openapi-ts.billing.config.ts`、`scripts/generate-billing-http-client.mjs`、`src/generated/billing-http/{client.gen.ts,client/{client.gen.ts,index.ts,types.gen.ts,utils.gen.ts},core/{auth.gen.ts,bodySerializer.gen.ts,params.gen.ts,pathSerializer.gen.ts,queryKeySerializer.gen.ts,serverSentEvents.gen.ts,types.gen.ts,utils.gen.ts},sdk.gen.ts,types.gen.ts,zod.gen.ts}`、`package.json`，以及新 `test/billing-http-contract.test.mjs`。不新增依赖/lock变更。
2. **consumer/config：** `src/config/runtime.ts`、`src/infrastructure/clients/owner/billing-personal-read.ts`、`src/http/routes/owner.ts`、`src/contracts/account.ts`；测试只用现 `test/config.test.ts`、`test/bff.test.ts`，新增 `test/billing-personal-read.test.mjs`。`src/bootstrap/server.ts`现已统一进入owner route，不预改；若实际接线证明必须修改，先报Root扩集。
3. **public合同：** `contract/openapi/v1/openapi.yaml`、`scripts/verify-openapi.ts`、`test/contract/openapi-contract.test.mjs`、`test/contract-governance.test.mjs`、生成的 `contract/tests/v1-operations.json`，并移除/改写 `test/doubles/bff-store.ts`、`test/doubles/mock-route.ts` 的旧假summary分支。public仍为预发布 `8.0.0`；若Root发现该artifact已对外发布，须先裁新的major，不能在已发布8.0.0内静默破坏。
4. **Web串行后继（非本仓写集）：** 固定BFF commit/version/digest后改同源adapter contract/client与Credits UI，移除fake zero及无owner字段；不得由BFF先造quota/free/daily DTO迁就当前UI。

tests-first须先证明旧实现对合法owner五因素/u1及两真实route失败、旧float/fake合同被拒；不能用缺vendor ENOENT、未配置环境或404入口冒深层RED。现 `test/billing-personal-read.test.mjs` 与 `test/bff.test.ts` 的table必须覆盖：tenant/subject语义边界191/255 code points合法、192/256拒绝，最长四字节字符编码后header分别1022/1363字符；空值、NUL、孤立high/low surrogate在owner调用前拒绝且零调用；owner transport另验带padding、noncanonical tail bits、非法UTF-8、编码后空/NUL及超限u1均拒绝，不得回退plain identity。认证选择精确为：任一machine marker或service bearer出现即选择machine，缺/错任一五因素为403且不回退user；所有machine marker与service bearer均无且无user bearer才是401，合法user bearer与撤权/无效user bearer另走owner user分支正负控。Root随后运行生成可重复性、contract/architecture、lint/typecheck/test/build及真实owner HTTP组合。本D0没有运行测试、启动服务或修改机器合同。

## R251-SKILLS-V2-CONSUMER：Platform V7 到 BFF public 8.0.0（目标，尚未实施）

当前 BFF 的 Platform Connect consumer 仍固定旧 owner/V5，Validate route 与 public OpenAPI 只接受 `zip-v1`；Platform producer 已固定为 `494b118ae7c29f1fc1005122d72c6c2bbf2640b6`，V7 `7.0.0` aggregate `3384a88f31be1fdd3e15bcbceb33e4fd7d62b04dfbfef65fcc35c24ce7afbb72`，但该 artifact 仍 inactive/unroutable，不能写成已激活。目标沿现 `generate-platform-connect-client.mjs` 的唯一生成方向固定该owner source，并验证 V7→V6→V5 immutable证明链、原39 RPC/20 commands/24 proofs与descriptor；不新建通用artifact框架或第二runtime。

BFF现Validate边界只把manifest identity值域切为`^zip-v2:sha256:[a-f0-9]{64}$`，保skill/series/valid/content digest/replayed、IAM、幂等、错误与取消边界。public资源路径保持`/v1`，唯一OpenAPI同步升major `8.0.0`并切V2 pattern；这是Root批准的首次正式发布前clean-slate例外，不保7.x、`/v2`、双读、alias或fallback，也不泛化post-release policy。Platform Proto字段shape不因本切换变化，但public值域仍是breaking contract，必须正常生成、验证并由Web后续精确repin。

本片无数据库、SQL、权限、receipt/outbox、缓存、服务或路由新增；BFF不解析或重写ZIP，不读取Platform数据库。当前只是D0：consumer源码、public contract、生成物、正式发布和真实页面均未实施。

## R241 Project rename 已实现候选与限定验收（2026-10-05；待 Root Git 交付）

当前候选已实现 Project name PATCH；本节替代下方 R240“仅合同/尚未实施/待复测”的阶段时态，旧正文原样保留作为历史。正式基线仍为 `cdad0ad6580dcbca18b75fdfbdbac4aa61f750d2`，本次尚无新的交付 commit，不代表 Web 消费或用户 3310 已启用。

现具名输入解析、rename route、ProjectService/port 与 Project PostgreSQL 事务已接通，server 在当前 IAM 后、generic mutation/upstream 前分流；raw JSON/header/名称边界在 rename 职责内处理，未修改通用 create 规则或引入 Move helper/第二 writer。receipt 原子性与资格先重放见 DATA 当前节，唯一公开 wire 见 API 当前节。

4.5 秒 acquire 起算绝对预算、每锁至多 1 秒及 exact-client error/release 生命周期已经纳入所选真实矩阵；BEGIN 后同 SQL 的 transaction-local `client_connection_check_interval=100ms` 配合客户端连接销毁，通过原 L6 1500ms PID 消失 oracle。100ms 是内核已报告断链后的检查间隔，不是所有取消或静默 network partition 的 SLA；Linux/macOS 是本轮研发/CI平台边界，未宣称两种 OS 都已实跑或其它 OS 已验证。

Root 所选矩阵与完整 owner 门证据、准确 source/test SHA、尚未选择的 C4/C5/F3/L4/L5/L7及发布边界统一见 CURRENT R241；完整 CRUD、生产删除生命周期、真实 IAM/Web 全链仍非本片已完成范围。

## R240 Project rename 合同候选与后继实现边界（2026-10-05）

R241 取消窄修（待 Root 复测）：rename 的 BEGIN 后同一 timeout SQL 仅以 transaction-local `client_connection_check_interval=100ms` 配合 exact-client 销毁，使长查询能检测已关闭连接，4.5 秒总预算/1 秒锁界不变；本轮平台边界为 Linux/macOS 研发与 CI，其它 OS 未验证，不修改全局/pool/role 或引入 CancelRequest/fallback。

正式 active 前置已本地交付于 `cdad0ad6580dcbca18b75fdfbdbac4aa61f750d2`；以下旧阶段时态以此为准。本片只发布设计/机器合同候选，不实施或启用 rename。原 20 mixed 不进入切片。

BFF Project 唯一 owner；采用既有目录内 `src/http/project-rename-input.ts`、`src/http/routes/project-rename.ts` 与 `src/infrastructure/postgres/project-rename.ts` 的后继具名职责，优于把严格输入/原子 receipt 混进 live-bff 或 Row mapper。现 ProjectService/port/repository 仅增加具名委派；不建 mutation 框架、新目录、第二 writer 或兼容 alias。

唯一入口及 wire 细节由 API 当前节和 OpenAPI 定义。后继复用 `projectName`、`strictParseRawJson` 与现 trusted IAM scope；NUL 只在 rename 输入拒绝，不改变 create 规则。每次当前 IAM→同 client 锁内 active/tenant/owner/canonical ID 资格→receipt；重放不跳过授权。最小 name 事实 LWW，无 version/CAS；事务及 no-op/旧 key 对账见 DATA 当前节。

后继 PG 总预算从 pool acquire 前开始为 4.5 秒，每锁至多 1 秒，SQL/rollback/COMMIT 共享剩余时间，无自动业务重试。沿 R217 exact-client error 生命周期；未 BEGIN 晚到连接归还，不确定 rollback 或已发 COMMIT 异常销毁 client 并返回 503，下一新请求重新准入对账，不猜成功。

本阶段只有十个合同/文档/静态门路径。Root 独审后另授真实 HTTP/PG RED 与实现：合法改名→最小 ACK→GET/list/旧 slug 权威新名→重建服务后保持；覆盖授权零差、旧 key、真并发、父锁竞争、原子 rollback、unknown COMMIT 与预算，保全 R217/active 旧门。当前不代表用户页刷新旅程、正式 IAM 组合或 Project DELETE 已完成。

## R239 Project active前置实施事实（2026-10-05）

本节为当前已验证候选事实；下方R236为实施前设计记录，其“未实施/未验证”时态由本节替代，位置及边界说明仍有效。基线main 7289b3a4ae8f2df5c249350d59b9405c33fb4083，本地交付身份以本仓Git与Root收据为准，尚未启用用户3310组合。

沿原业务位置实施：canonical Project nullable deleted_at及原owner-list partial index，六既有repository共25条active资格谓词；新增bootstrap/server.ts非IAM已缓存requestId后一行统一响应标识。事务、排序父锁、Message委派、4.5秒预算、精确client释放和既有API不变。无新文件/模块/状态写入口；无兼容层。

实现与两既有测试形成唯一切片，Root真实schema12、完整HTTP/PG/Redis217项无失败/跳过，工程check及format通过，独审零发现。完整Project rename/delete、Task政策、Storage释放与Run/Share收口仍独立后继，资格过滤不等于完整删除协议。

## R236 Project active 最小前置（2026-10-04；docs-only，待独审/真实RED）

Root选择R235路径A：在正式 `7289b3a4ae8f2df5c249350d59b9405c33fb4083` 上独立交付Project墓碑列与现有资格查询的active条件，为R234改名及完整删除后继提供前置；不缩减完整CRUD目标。HEAD尚无Project.deleted_at；现20mixed包含未交付候选及会回退R217的旧实现，不作为可整体接入的基线。

| 放置/范围 | 唯一目标 |
|---|---|
| Owner/依赖 | BFF拥有Project资格；现IAM准入→可信tenant/subject→本仓repository，保持现事务与父Project→Conversation锁序，不新增HTTP身份协议。 |
| `database/schema.sql` | 唯一canonical：仅Project nullable墓碑列及原owner-list索引partial predicate；数据语义见DATA_MODEL R236。 |
| `src/infrastructure/postgres/project-repository.ts` | 6处：list、find、instruction UPDATE、revision父EXISTS、skill父锁、tasks父EXISTS。 |
| `src/infrastructure/postgres/chat-repository.ts` | 10处：list/find/snapshot/process、messages两查、rename/delete、create/revoke share的Project EXISTS；保HEAD内联Conversation生命周期。 |
| `src/infrastructure/postgres/conversation-artifact-library.ts` | 2处：列表与空页授权Project EXISTS。 |
| `src/infrastructure/postgres/conversation-move.ts` | 3处：winner当前Project、源解析、排序Project锁；保Move原lease/receipt。 |
| `src/infrastructure/postgres/scheduled-task-repository.ts` | 1处：ownedProjectId父FOR SHARE，不改Task生命周期。 |
| `src/infrastructure/postgres/chat-turn-commit.ts` | 3处：resolveActiveProject、首次Project锁、既有Conversation排序Project锁；保持正式R217有界事务。 |
| 粒度/比较 | 共7生产/schema位置、25处资格predicate；采用现文件窄增量，淘汰整体接入mixed、删除lifecycle先片及第二schema/fallback，不建文件/目录/框架。 |

后继tests-first只用现 `test/schema-governance.test.mjs` 与 `test/business-store.integration.mjs` 的HEAD增量；前者真fresh catalog，后者真实HTTP/PG正负矩阵，详见API/DATA R236。Root冻结clean artifact后另授代码，原20mixed字节保留。保全部HEAD测试，尤其R207/R209/R211/R215共7个Message期限/断链/unknown case及request-id断言；保outbox对chat-turn-commit委派、Message合法解析后早返回，禁止恢复mixed无界内联事务/owner预读。

本片无生产tombstone writer、公开DELETE、删除三表、Service/port/installer变更、兼容路径或机器合同变更。Project/Task/Storage/Run删除生命周期仍未完成；单置墓碑不等于撤Share/停止后台Run。R234 name合同与实现保持独立后继，本设计不预报任何门通过。

## R217 Message 有界准入与断链租约（2026-10-04；隔离候选已验收）

隔离clean候选已把正式Message POST的owner读取、Project→Conversation锁、dispatch/Message/AG-UI写入与COMMIT收进同一个4.5秒绝对期限；Pool取得、最多四次scope变化、每条SQL、rollback、COMMIT与50ms通知均共享剩余期限。HTTP仍先完成可信IAM/session admission与严格wire/静态配置门，其他Chat读写授权路径不变。client-created缺Project沿既有404，foreign/deleted/legacy Conversation仍404；same-key/body只从canonical dispatch恢复原Run/Message identity，不新增generic receipt、协议或schema。

`commitChatTurn`现在拥有checked-out exact `PoolClient`的error-event生命周期。`pg-pool` checkout移除idle listener后，本函数安装具名operation listener；真实断链只标记client必须销毁，query rejection仍保primary failure。finally同步先`release(destroy)`把生命周期交还Pool，再精确卸载operation listener；普通SQL错误仍有界rollback，实际派发后的unknown COMMIT仍503并由same-key canonical事实恢复。没有global error handler、共享Pool配置、第二deadline、通用UoW或敏感错误日志。

Root真实门：先得到backend terminate的uncaught真实RED，再以exact PID/client listener、`release(true)`、旧PID消失、replacement backend及全facts零差转GREEN；四故障矩阵4/4通过（含真实COMMIT后ACK丢失、四scope总物理延迟大于4.5秒、notify throw/late）。最终完整owner门182个真实PG/Redis测试0失败0跳过，743默认测试/1既定资源skip、236 contract与schema/format/lint/typecheck/build均通过；独审0P0/P1/P2。Message有限准入切片已获Root验收；准确交付commit、Root gitlink与启用状态由Root CURRENT/progress维护，当前3310仍是旧组合。主动HTTP AbortSignal贯通、Project DELETE及完整用户链仍是后继。

以下R213段是实现前的历史D0；现实现与验收状态以上方R217段为准。

## R213 Message 单一有界准入设计门（2026-10-04；仅D0，源码未实施）

当前Message POST在正式IAM/session admission和严格wire解析之后，仍由`authorizeChatRequest()`执行无期限的Conversation/Project数据库预读，再进入`commitChatTurn()`自己的4.5秒期限。Root真实pool饱和RED为5225.8ms/202，证明HTTP请求尚未进入有界事务。目标删除**仅Message POST**的授权数据库预读：HTTP仍先完成可信IAM身份、query/body闭集解析；缺`Idempotency-Key`和Agent未配置继续作为不触库的静态400/503门。其他Chat read、Move、PATCH、DELETE、collection授权全部保持现路径。多个同时非法条件的静态错误优先级不是公开契约保证，不为维持资源探测顺序保留第二次DB读取。

Message唯一数据库准入由现`chat-turn-commit.ts`完成：在同一4.5秒绝对期限内获取PoolClient，先无锁预读Conversation/current Project引用以确定候选，再按canonical Project ID升序`FOR SHARE`，最后锁Conversation `FOR UPDATE`；因此正式锁序是**Project→Conversation**，不能把pre-read描述成Conversation行锁。锁内以可信tenant/subject、`status='active'`、canonical current Project与caller Project完成授权，新命令不得把Move前scope重新绑定；same-key/body重放仍读取immutable dispatch并在caller/current mismatch拒绝前返回原receipt。client-created首次Message所带Project不存在/越权时，事务rollback后抛具名内部`CHAT_TURN_PROJECT_NOT_FOUND`，HTTP只映射既有404`project_not_found`；foreign/deleted/legacy Conversation仍统一404`session_not_found`。不新增wire code、schema、receipt、服务、deadline或通用repository port。

§8采用现`src/http/routes/chat-authorization.ts`（Message wire-only authorization）、`src/infrastructure/postgres/chat-turn-commit.ts`（唯一owner/project/active/replay事实）与`src/http/routes/chat.ts`（既有错误映射）三文件窄改；淘汰server/普通ChatRepository贯通deadline的方案，后者会复制锁外授权并保留TOCTOU。tests只允许现R211 block及既有first-message/Message-Move真实HTTP邻例的必要加强；其他原301测试字节冻结。主动HTTP AbortSignal贯通仍是独立后继，不在本片虚称完成。

## R205/R189 Message scope snapshot 与 replay 前置（2026-10-04；独立提取候选）

本切片只收敛现Message admission与Move并发/replay：在单个dispatch事务内先解析caller可见Project，再按canonical Project ID排序取`FOR SHARE`，随后锁Conversation；既有Conversation以锁内current `project_ref`为唯一执行scope，caller显式Project只作新命令前置与same-key fingerprint，不覆盖已Move后的权威scope。client-created首次Message在同事务创建Conversation、冻结canonical Project并写Message/dispatch/idempotency事实。same-key重放每次仍先现IAM session admission与本人Conversation可见性，Move后旧caller Project可恢复原receipt，但新key不得把旧Project重新绑定。

采用现`agent-dispatch-outbox-repository.ts`事务和`chat-authorization.ts`边界，纯payload规范化留在`domain/chat/agent-dispatch.ts`；不新建模块、receipt、schema或协议。该切片基于正式`8e33bc0`，明确不依赖`bff_project.deleted_at`或Project DELETE表/active fence；Project墓碑与DELETE/Message串行由后继R203事务切片加入。

## R176 Storage scope-release pin 放置（2026-10-03；无运行时实现）

Storage 是 scope/object lifecycle contract owner；BFF 只在既有 `contract/vendor/kokoro-storage/<commit>/proto` 保存已发布 `e8b9928` immutable source snapshot，并由现有 generator 生成隔离的 `src/generated/storage-connect` wire 类型。采用现有 artifact 目录而不新建 Project DTO，是因为 release request/response 与 upload/list 同属一个 Storage v2 owner contract/lifecycle；手写类型或并存旧 snapshot 会形成第二事实源。本片不改 Project/Chat/SQL/runtime。

## R152 Conversation Move 持久化职责拆分设计门（2026-10-03；仅文档，未实施）

**当前态与触发证据。** BFF `main 0333cd7c515846e977b1b05d8349e8c04d2a49dd` 已发布 public `7.1.0` Move（源码提交 `284b5e04c4c09759787ef239b1a19fcdcd5ed8fa`），当前源码无未提交变更。`src/infrastructure/postgres/chat-repository.ts` 从先前 `a68cbe55` 的 671 行增至 979 行，超过 Root 标准门的 800 行上限；Root 全仓标准门实际 153 项失败中，本 Move 新引入的这一项是独立 P1，不能拿已通过的 BFF 741 纯测试/1 个既有资源 skip、173 真 PG/Redis integration 或 9 项 Move 真 HTTP/PG 行为门冒充架构合规。现同一文件同时含 Move 的有界连接租约、整事务/赢家重放及其他 Chat Repository 查询写入；既有 `chat-repository-mappers.ts` 已负责纯 Row 映射，但尚未承接 Move receipt Row 的严格解码。Web 固定契约与浏览器消费、Project DELETE、Storage release 消费和原用户界面验收不属于本拆分。

| §8 项 | R152 已裁决的目标与边界 |
|---|---|
| Owner/唯一 writer | BFF Conversation Move 的 PostgreSQL 实现；原 `PostgresChatRepository` 保留现有 ChatRepository port 的具名 `moveConversation(command)` 入口，不产生第二个业务 writer。 |
| 方案 A（采用） | 在现 `src/infrastructure/postgres/` 新建 `conversation-move.ts`，独占当前 Move 整事务、本人可见性重查、排序 Project→Conversation 锁、final receipt 写入、赢家读取及有界重试；新建 `conversation-move-lease.ts`，独占 Move 私有 deadline、PoolClient 获取/迟到归还、SQL/rollback/取消预算与未知 COMMIT 时销毁租约；现 `chat-repository-mappers.ts` 增纯同步 receipt Row 校验/转换。原 Chat Repository 方法只具名委派，不复制 SQL 或重放分支。 |
| 方案 B（淘汰） | 仅外移 lease 而把事务/赢家读取留在 979 行 Chat Repository，或按行数拆成 `chat-part-N`：前者未解除业务变化耦合，后者没有稳定 owner/测试边界。也不新增目录、port、service、BaseRepository 或运行进程。 |
| 粒度/依赖 | 两个新文件各有单一变化原因并复用现 `postgres/` 目录。`conversation-move.ts` 仅依现 port 的 `MoveConversationCommand/Result`、`PostgresBffDatabase`、本仓 pg lease 与既有 mapper；lease 只依现 DB/pg 和取消时钟，不含 Chat 授权/receipt 语义；mapper 无 I/O。Application/HTTP 不见 `pg` 或 `PoolClient`，不引入循环依赖。 |
| 数据/API/删除项 | 不改 `database/schema.sql`、OpenAPI `7.1.0`、operation inventory、generated/pin、现 port 形状或任何表/索引。原文件中的 Move lease、事务、receipt 解码移走且删原实现，不留 alias、双路径或 fallback；SQL 字面值、受信 tenant/owner 与 current IAM 准入、scope/fingerprint、排序锁、4500ms 内部预算及对外 5 秒门、同键重放/冲突、unknown COMMIT `release(true)` 均须逐项保持。 |
| 验证与阶段门 | 本 D0 不改源码或重跑资源。Root 已取得原文件 979 行越 800 的真实架构 RED；后继做等价迁移，Root 在同一最终源码上重跑该 800 行标准门、Node22 `pnpm check && pnpm format:check`、OpenAPI/Schema drift、本仓完整八文件 173 项真实 PG/Redis integration 与 9 项 Move 真 HTTP/PG（锁预算、same-key、故障回滚、未知 COMMIT 销毁/恢复）。所有受影响旧 Chat 查询及测试保持；独立审与 Root 集成通过后才提交。 |

**不变性与未决。** R146 下节是已发布业务契约/原实现设计，不是要求永久把 Move SQL 留在 `chat-repository.ts`。R152 只变更内部文件边界；任何因提取而出现的 SQL/错误/预算语义差异应先作为行为缺陷修正，不借架构切片扩展 Project DELETE 或收敛其他标准门失败项。新文件具体导出名、测试增补的最小范围由后继源码门依真实 import/architecture 结果固定，当前不预先创造新公开 API。

## R146 Conversation Move 独立切片（2026-10-03；BFF producer 已发布）

**当前态/边界。** 已提交并推送的 `main 284b5e04c4c09759787ef239b1a19fcdcd5ed8fa` 是 public `7.1.0`、包含 Move 的 BFF producer；`main a68cbe55cde709f9b21f3d5803bfbd3ca5d14e2b` 是此前 public `7.0.0`、无 Move 的基线。唯一 OpenAPI 已加 `7.1.0` Move operation，并在独立 `src/http/routes/move-session.ts`、Chat service/repository 实现本人 Conversation 归属与同事务最终 receipt。既有其他操作的通用 `mutationTicket()` 仍在业务事务外，Move 专属路径不使用它。`database/schema.sql` 未改，`bff_conversation.project_ref` 可空且现有读写事实可为本人 Project ID 或 slug。Root Node22 `pnpm check && pnpm format:check` exit 0（741 pass、1 个既有资源 skip；contract 4 条已知 warning），聚焦真 HTTP/PG Move 9/9、完整八文件真 PG/Redis integration 173/173，详见 `docs/CURRENT.md` 的 R150 最终日志；Web pin 与浏览器消费尚待验，故 BFF producer 发布不等于用户界面可用。它不消费 Storage；Project DELETE 的 Storage 依赖、ScheduledTask 产品选择与 T-C05 继续开放。

| §8 项 | Move 独立切片的放置裁决 |
|---|---|
| Owner/职责 | BFF Conversation 唯一写会话归属；Project 是同仓被校验的源/目标事实，Agent Run、Storage Asset、Scheduler Schedule 均非 Move writer。 |
| 设计时入口/当前扩展 | 原 Chat route/authorization、Chat service/port/repository 与 `src/bootstrap/server.ts` 保持各自职责；当前实现另有 `src/http/move-session-input.ts` 和专用 `src/http/routes/move-session.ts`。外层 query `project_ref` 授权和通用事务外 receipt 均不充当 Move 权威。 |
| 方案 A（采用） | 在现 Chat route/service/port 增具名 Move，在现 Chat repository 用一个 checked-out `PoolClient` 锁 Project→Conversation、更新归属并写现 receipt；HTTP 只解析和传递受信上下文。Conversation 是唯一被移动 aggregate。 |
| 方案 B（淘汰） | 放入 Project repository 或 HTTP 先查源/目标再调用 Chat 更新：两 repository/route 难共享同一 client，出现 TOCTOU、反向锁和 receipt 分裂；不为 Move 新建一级模块、通用 bus、Storage outbox或机械 `chat/` 目录。 |
| 粒度/依赖/删除项 | 扩现文件即可；Move 输入解析独立于路由，既有 strict JSON 原字节解析器移至中立 `src/infrastructure/raw-json.ts` 并机械更新消费者，不让 Chat 依赖 Platform client。禁止跨 owner SQL、复制 owner Proto、旧 API alias 或双轨 generic receipt；只对本操作绕开 `mutationTicket()` 的事务外 claim/after-response put，其余操作保持原路。 |
| 数据/API | 单个 `POST /v1/sessions/{id}/move`，`id` 限 canonical Conversation ID；闭集 body 的 `target_project_id` 为 canonical Project ID 或 `null`；同事务更新 `project_ref`、最终 200 receipt，无新表/列/索引推荐。详见本仓 API_CONTRACT/DATA_MODEL 的 R146 段。 |
| 验证 | OpenAPI/operation inventory/语义负例、Node22 纯门与 format 已通过；聚焦真 HTTP/PG Move 9/9、完整八文件 PG/Redis integration 173/173，contract 仍有 4 条已知 warning。BFF producer 已提交推送；Web consumer 仍是独立门。 |

**命令与运行中语义。** 当前 IAM 对首次及每次同键重放都先重新准入；tenant、actor、owner仅取受信上下文。Move 可在 Run streaming 时执行，但只改变后续 message/Run admission 看到的 Project 归属；既有 Run 继续原 admission context。Conversation ID、Message、Share、AG-UI stream/cursor、Run 与 Artifact association 原样保留；不得复用 `deleteConversation()`，不发 cancel、不停 consumer、不重启 stream、不复制 Storage 或 Agent 事实。新 key 且已在目标归属是合法 no-op，写该 key 的稳定 receipt，但不改 Conversation `updated_at` 或历史事实。

**唯一事务线性化点。** `PostgresChatRepository.moveConversation()` 用单个 `PoolClient`：先按可信 tenant/owner/canonical Conversation ID 预读 active 行以发现源 `project_ref`（可能是历史 slug），再解析本人源 Project 的 canonical ID；源、目标 Project 去重并按 canonical ID 升序逐个 `FOR UPDATE`，锁内重验 tenant/owner/active；随后锁 Conversation `FOR UPDATE`，重新验证 active/owner/tenant、当前源仍与预读一致。预读竞争失败则整事务回滚、以相同幂等身份有界重试；不能以外层 `authorizeChatRequest()` 的 query lookup 代替锁内检查，也不能先 Conversation 后 Project，避免与未来 DELETE 反序。更新 `project_ref` 为 canonical target 或 NULL（成功触及历史 slug 即收敛），同一事务以既有 receipt 表的同一 scope/fingerprint 规则写最终 `{data:{session_id,project_ref}}` 200 响应，最后 COMMIT；任一步失败归属和 receipt 均不改变。每次重放先 IAM，再从受信scope读取 final receipt；同 key 异 target 409，不在外层先 claim 一条 pending。现 receipt 表的 `scope TEXT PRIMARY KEY`、`fingerprint`、`status`、`response_body JSONB` 足以存 final 200；无需编造新表或放宽旧 receipt CAS。

**同键并发终态 receipt 冲突收口（独立审 P1）。** 两个首次请求可同时读到“无 receipt”并在尾部争抢现 `scope` PK；终态 INSERT 的 unique 冲突绝不能被当成可提交的 replay。输家必须**整笔回滚**其 Project/Conversation/归属更新时间与 receipt 写入，随后以新的短事务，在当次 IAM/会话可见性再次确认后的受信scope读取赢家 final receipt并严格比较 fingerprint：相同语义返回赢家原始200，异 target 返回409；若赢家回滚导致该 row 不存在，保持原 key 做有界整命令重试。DB竞争/结果未知不得猜成功或生成 pending 双轨；达到重试上界按不可判定故障返回。真 PG RED须用双连接证明同key同target仅一笔归属写且响应相同、同key异target仅赢家归属且输家不改 `updated_at`、赢家在 unique wait 后回滚可恢复、成功 ACK 丢失重试取同一 final receipt。

**Move 私有等待预算（C5 已实现并聚焦验真，随 BFF producer 发布）。** 单次正式 HTTP 命令从获取 PoolClient、每轮事务锁与SQL、重试到最终结算总计须在5秒内结束；每轮本地 Project/Conversation/receipt 锁等待最多1秒，transaction-local `lock_timeout` 与 `statement_timeout` 均不得超过剩余总预算，最多4轮。连接池等待和客户端断开也必须受控释放，不留下占用Client/事务；锁超时/序列化冲突可在剩余预算内整命令重试，耗尽返回 typed retryable 503，未知COMMIT只报503并由原key恢复，不猜成功。仅Move私有设置，不放宽全局Pool或其他Chat行为；真PG由独立blocker PID与`pg_blocking_pids`证明目标Project锁下有界失败、归属和receipt零变化。

**删除/提交竞态。** Move先拿源 Project 锁并提交，则旧 Project DELETE 锁定成员快照不含已移出的会话；DELETE先锁并提交墓碑，则 Move 锁内 active fence 返回不可见 404。当前 Project 尚无 `deleted_at`，Move 源码片须用当前存在性/owner检查，未来 DELETE SQL 片必须把 `deleted_at IS NULL` 同步加在源/目标与新 admission 的事务谓词，并以双连接验证。两个 Project 逆向 Move 按 ID 排序防死锁；与发消息并发以 Conversation row 线性化，新消息不得从不受信 body/query取归属。Move 不删除独立 ScheduledTask，亦不关闭 Project DELETE 的 Storage N+1 release、损坏图 blocked 或 T-C05。

**R146 D0 原 tests-first 写集（历史阶段，非当前授权）。** 机器门：`contract/openapi/v1/openapi.yaml`、`scripts/verify-openapi.ts`、`test/contract/openapi-contract.test.mjs`、`test/contract-governance.test.mjs`、`test/bff.test.ts`；业务门：现 `src/http/request.ts`、`src/http/routes/chat-authorization.ts`、`src/http/routes/chat.ts`、`src/bootstrap/server.ts`、`src/application/chat-service.ts`、`src/application/ports/chat-repository.ts`、`src/infrastructure/postgres/chat-repository.ts`及直接 `test/chat-service.test.ts`、`test/chat-facts.integration.mjs`、必要的现解析单测/替身。若 SQL/receipt schema 实际变动，才纳入 `database/schema.sql` 和 schema governance；当前不推荐变动。真 PG RED 覆盖 A→direct/A→B/direct→B、运行中Run零取消、同/异key和ACK丢失、撤权/越权、历史slug源、双Move/DELETE与message竞态、故障全回滚；Root应在机器/source正式发布后再让Web消费。

## R145 Project DELETE 文档门：当前态、目标态与放置（2026-10-03；未实施）

**R145 设计时基线与当前候选。** BFF 已提交 `main a68cbe55cde709f9b21f3d5803bfbd3ca5d14e2b` 的 Project path 只有 GET/PATCH；`ProjectService`/`ProjectRepository` 无 DELETE，当时 Chat 无正式 Move。当前工作树已有未发布的独立 Move 候选，但仍没有 Project DELETE。`bff_project` 无删除墓碑，现通用 mutation receipt 的 claim 与最终 put 不和 Project 写事务同提交。`PostgresChatRepository.deleteConversation()` 只处理单个 Conversation，虽有 tombstone、Share revoke、AG-UI consumer fence、compact/Artifact关联清理、Agent dispatch settlement 与 durable cancellation outbox，却不能循环调用来宣称整 Project 原子删除。Storage `main 2f855816347b56b3b8dd594366b001548441e0dc`已发布现有`ReleaseProjectScope`，但具名`ReleaseConversationScope`及Project合法Artifact graph安全释放仍只是Storage已审D0目标、尚未发布行为/机器产物；BFF不能pin该在途候选。本节不改机器契约、schema、源码或生成物，T-C05仍未验。

**原两项P1的Storage owner后继依赖，D0文本不算关闭。** Project-scope logical release**不会**释放成员Conversation的`conversation` scope Agent Artifact/Asset/Blob，清BFF `bff_conversation_artifact`关联也只关闭产品可见性。已审Storage目标新增具名`ReleaseConversationScope`：只受信`web-bff + conversation`、body仅`CommandIdentity`，同事务复用既有永久scope fence、全部Upload/staging cleanup、Asset/Blob lifecycle与receipt；合法Artifact保最小审计身份并清title，所有读/写/replay受released fence。Project release的目标增强同样在scope锁内先验证完整Artifact graph，再原子释放合法图；损坏/孤儿/跨scope/部分状态整事务`FAILED_PRECONDITION`回滚。当前行为尚非该目标：只有Storage发布真实contract/实现与graph正反例、fence/重放证明且BFF固定commit/digest，才进入BFF机器/源码门。损坏graph是显式**blocked integrity anomaly**，不自动当成功或GC等待；后续若owner事实经合法修复，再用原命令重投，本文不发明remediation RPC/表、事务外预检或逐项ListAssets绕过。D0不宣称全部项目可删除闭环，T-C05继续未验。

| §8 项 | 本切片目标裁决 |
|---|---|
| Owner / 职责 | BFF Project 唯一写本地删除命令、Project/Conversation关系与公开 ACK；Storage 唯一写 project-scope Upload/Asset/Blob logical release；Agent/Scheduler 分别写 Run 与 Schedule。BFF 不读其他 owner SQL。 |
| 放置方案 A（采用） | 现 `src/http/routes/live-bff.ts` 做薄入口，`src/application/project-service.ts`/Project port 承载用例，`src/infrastructure/postgres/project-repository.ts` 用一个 BFF `PoolClient` 持整个事务；现 Chat 删除 SQL 抽具名同-client helper供单会话和Project批量复用。独立的 Storage release 投递有具名 port、现 postgres 目录 outbox repository 与窄 Storage generated-client adapter，复用既有 BFF worker 生命周期。 |
| 放置方案 B（淘汰） | 在 HTTP handler 内循环单会话 delete 或同步调用 Storage；这会在部分会话成功、网络超时和本地事务提交间失去原子性与恢复身份。也不新建 Project 一级模块、通用 cleanup bus、跨owner SQL或旧API fallback。 |
| 粒度 / 依赖 | Project 事务、同-client Chat lifecycle helper、Storage outbox/worker 各有独立变化原因；HTTP 不持 PG 锁做网络调用，Storage 命令只能消费其发布后固定commit/digest的 Proto/generated。 |
| 数据 / API / 删除项 | 单个 Project 墓碑、同事务 public receipt与锁定成员N条Conversation-scope加1条Project-scope稳定Storage命令；只在Storage正式发布后固定身份。会话沿现 tombstone，删除 Project instruction revisions/Project skill/task。独立 Library、ScheduledTask、Message/不可变审计 ledger 不级联删；不复制 Storage 可编辑 Proto/SQL。准确 schema、身份与 ACK 见本仓 DATA_MODEL/API_CONTRACT 新节。 |
| 验证 | 先同一 OpenAPI/operation inventory/语义负例与真 HTTP+PG RED，再实现并跑 Node22 本仓门；Storage正式发布后才pin/两轮生成check/真实Connect+PG unknown ACK；Root独立资源验收，Web最后消费。 |

**本地线性化点。** 当前 IAM/fixed tenant/user 必须在每次请求（包括同键重放）先准入；DELETE path 只接受 canonical `project_id`，现 GET/PATCH 的 slug 读写保持，不能把 slug 变成删除 alias。请求零 body、无 query、单个有效 `Idempotency-Key`；route 的前置 find 不能代替事务内授权。事务先按可信 tenant+owner+canonical ID 锁 Project `FOR UPDATE`，再按稳定 ID 顺序锁该 Project 的 Conversation 和关联 ScheduledTask，与现 Chat 首次发 Run、ScheduledTask create 的 Project `FOR SHARE`互斥。Move 是**独立前置命令**：须保原 Conversation ID/Message，源/目标授权与 Project/Conversation 锁同事务；Move 先提交则会话不属于删除集合，DELETE 先提交则 Move 失败关闭。当前仅有未发布 Move 候选，Project DELETE 仍未实现；本 DELETE 文档门不冒充删除竞态已验。

同一 BFF PostgreSQL 事务先冻结锁定成员集合N，将其Conversation通过现完整生命周期的**同一个 PoolClient helper**置 deleted、撤销其 Share、停止/加 fence 的 AG-UI consumer、清现 compact/Artifact association、按已越过 Agent 边界的 dispatch 写 durable `run.cancel`，并收敛未发 dispatch/未终 assistant；随后移除 Project instruction revisions/Project skill/task，写最小不可恢复 Project 墓碑、本地固定202 receipt、N条分别绑定各canonical Conversation scope及1条Project scope的稳定durable Storage命令，最后COMMIT。各scope命令身份、调用与回执只以Storage正式发布契约为准，不能由BFF猜测或把同一Project命令重用于Conversation。任一步失败整笔回滚；已移出会话、其他Project、独立Library不在删除集合。Agent Run的真实terminal仍由Agent，BFF只承诺现durable cancel意图与迟到投影不复活已删会话。不能删除Message/不可变ledger来伪装事务成功。

**墓碑与并发。** 建议保留 `bff_project` 原 row 作为仅受信 tenant+owner 可查的最小墓碑：`deleted_at` 非空，清 instruction/name/description 产品内容，保 canonical ID 与原 slug 作同 owner 预约，原slug不复用，防旧slug链接误指新项目。所有 Project 可见性/成员/上传/任务预检及现 `EXISTS` 统一要求 `deleted_at IS NULL`；同键 DELETE 的专门 receipt 路径可查墓碑，但正常 GET/PATCH/slug API 都返回不可见。此为 clean-slate 目标，Root 在机器/SQL门最终确认原slug保留与隐私/retention，不引入旧数据兼容层。若不保原slug，必须改用等价持久预约而非允许无声复用。

**外部恢复。** 本地receipt与N+1 Storage durable命令在上述事务一起提交；不能用现通用`mutationTicket()`的事务外claim/put制造“已删除但receipt pending”的崩溃窗口。每个scope的`command_id`对同一tenant+canonical Project删除稳定，digest绑定受信actor/精确scope/operation，不能每次HTTP重试造新命令；各命令独立有界退避、lease/fence、ACK丢失后重投。只有每个对应Storage owner响应被验证`scope_released=true`，该scope才记logical released；**N+1全部确认后**Project删除的聚合logical状态才可为released。任一scope损坏graph`FAILED_PRECONDITION`显式blocked integrity anomaly，未知/超时仍pending；不能因Project scope先ACK而掩盖成员Conversation。Storage logical ACK不证明物理GC：先签GET/PUT可能仍有效，晚PUT cleanup可能保持owner`pending_observation`，BFF不制造terminal GC状态或同步删Blob。

后台worker只执行**已由当前IAM授权并本地durable提交**的命令，不因用户随后登出或session撤销而丢弃清理意图；这与每次公开DELETE重放/状态查询仍须重新IAM准入不同。worker用已封存的受信tenant、actor、scope和workload身份，不重放用户Bearer，也不重新决定Project成员集合。

**独立任务尚待用户异步答复。** 已定仅“独立ScheduledTask不级联删除”；推荐同一BFF事务对引用P的任务清`project_id`、暂停、revision+1并写既有`scheduler.replace` outbox，保task ID/历史，旧project callback由context/revision/active fence拒绝。另一个可行产品规则是要求用户先处理关联任务再允许Project DELETE；二者不可混为已定，最终公开DELETE前必须选定并据此测试。现阶段Storage机器门、Chat helper与N+1事务设计不因此停工。已admitted Scheduled Agent Run仍由Agent终结，不因任务暂停伪造终态。

**后续实施精确写集（本 D0 不授权写入）。** 先取得正式Storage producer commit/Proto/digest与真实行为门，再由唯一writer按RED→实现→本仓验收推进；ScheduledTask用户答复只阻挡其关联规则和最终公开DELETE，不阻挡可独立验证的机器/Chat/Storage后继切片。不能先生成未发布的消费者。

| 切片 | 预期唯一写集与先行 RED |
|---|---|
| BFF 机器门 | `contract/openapi/v1/openapi.yaml`、operation inventory/`scripts/verify-openapi.ts` 及其直接 contract 负例；确认版本、202/状态查询、错误、no-store/request ID，不放宽既有操作。 |
| BFF 本地事务 | `database/schema.sql`、`src/application/project-service.ts`、`src/application/ports/project-repository.ts`、`src/infrastructure/postgres/project-repository.ts`、现 Chat repository 同-client helper、`src/http/routes/live-bff.ts`；先建真 PG 回滚、并发 Move/create/run、越权与同key重放 RED。 |
| BFF Storage 后继 | Project删除聚合receipt与N+1精确scope durable命令、窄Storage adapter/固定provenance generated artifact、现worker入口；先取得Storage owner的Conversation release与Project完整graph安全释放真实证明，再做lease/fence、重复/未知ACK、损坏graph blocked与重启恢复RED；producer未发布前不写生成物。 |
| 独立依赖片 | Conversation Move 的候选 API/事务与测试待独立发布、ScheduledTask detach/fence 与对应 Scheduler replace 测试、Web 消费；各自另有机器/实现验收门，不在本 D0 伪装完成。 |

## R133 当前切片 Root 验收事实（2026-10-03）

HTTP5 正式消费、public7 过程契约、两 canonical process 表、同事务 RR 快照、immutable anchor 分页、START 与分批 GC 完整性切片已由 Root 复验。真实 PG/HTTP：15 焦点和完整 74 项全部通过、0 skip；完整默认纯门 736 pass/1 既定 PG schema resource skip，四 pure 149 pass；format（含全部变更 TS/MJS）、lint、typecheck、build、全 contract pipeline 与 233 contract tests 通过。最新证据：资源19016f31、纯门7c8284b1、contract f7e3519c；两独立限定源码审0/0/0。

两个 fixture 的时间戳/umask 假前置及 public7 Snapshot 示例缺字段已修并真实复测。当前 contract lint 剩4条 warning：3条 conditional-schema局部 required-properties提示、1条既有特殊操作无2xx提示；不称零warning或整个owner集成通过。下方“5条全既有/待Root”是历史阶段，不作为最新状态。集成提交身份以本仓 Git 与 Root progress E108 为准；Web7消费、当前真实浏览器、外部模型、正规积分及完整BFF其他资源/镜像验收仍未完成。

以下为此前阶段与已批准技术方案。

## R132 snapshot example 更正候选（2026-10-03，待 Root 复验）

Root 复核确认下方把 5 条 contract lint warning 全记为既有并不准确：其中一条来自 public7 `SessionSnapshotResponse.example.data` 缺少新增 required `execution_process`。本片已为 active head 的同一 Run 补齐四字段安全过程示例，机器 schema、版本与 API 语义不变；实际剩余 warning 数与通过状态等待 Root 重跑后记录。

## R132 HTTP5 / public7 本片 Root 验收事实（2026-10-03，Git 发布待 Root）

Agent HTTP5 单轨消费、public `7.0.0`、两张 canonical RunProcessProjection 表、同事务投影、授权 RR snapshot/Run page、immutable anchor 分页、START successor 保留及 provenance/partial-GC 语义已完成本片有限验收。证据绑定资源 `19016f31`（15 焦点与完整 74 全通过）、pure/default `3b926e2d`（149 pure；default 736 pass + 1 既定 PostgreSQL schema resource skip）及完整 format/contract `4811c5e9`（233 contract pass / 0 skip，保留 5 条既有 lint warning）；两次 R131 独立源码终审均为 0/0/0。原 timestamp 与 permission fixture 失败经窄 ACK 修正并由 Root 复测关闭。BFF7 Git 提交/推送仍待 Root；这些证据不覆盖全部 BFF 业务、其余资源、镜像、用户 Web/浏览器、真实 provider/外部模型或正式积分。

## R129 provenance / partial-GC 候选实现（2026-10-03，待 Root 资源验收）

Run process reader 现于同一 RR client 无条件核验 compact Todo/activity 与 ledger frame、source、Run/activity identity 的双向对应；历史页仍返回 anchor 上的不可变 ledger 值，不用 mutable current 覆盖。GC 仅在某 Run 的全部 ledger frames 回收后删除其 process/activity compact；START 已回收但同 Run terminal frame 尚存时，持久 START cursor、tombstone 与 retention floor 共同产生 410，缺回收证据的坏引用仍为 503、未知 Run 仍为 404。当前仅通过 writer 静态与纯门，真实 PostgreSQL 损坏矩阵和 batch-1 GC 仍待 Root 验收。

## R126-GREEN-C 当前实现候选（2026-10-02，待 Root 资源验收）

public7、RunProcessProjection 两表、同事务安全过程写入、授权 RR snapshot/Run page、START 保留、GC compact 回收与退役 tool-call cache 删除已落到当前工作树。当前已通过 writer 的授权定点纯测试、contract/schema、lint/type/build；完整默认门的 architecture 版本断言已按 Root ACK 切至 public7；真实 PostgreSQL 并发、GC、恢复与发布仍由 Root 验收，未据此宣称正式发布。

## R123-GREEN-A 当前实现事实（2026-10-02，待 Root 最终全门）

BFF 已单轨固定 Agent main `79bf98c5aa63b9bace207afdf42d8c7aefee4fe8` 的 HTTP `5.0.0` owner artifact，并实现 strict Todo/activity decoder 与 `kokoro.todo.updated` / `kokoro.activity.updated` 安全 CUSTOM 投影；旧 HTTP4 raw Tool/subagent 网络映射已删除。Root 最终全门与提交仍待完成；public machine 仍为 `6.0.0`，canonical SQL、snapshot/process 分页、GC 与 START registration 尚未修改，继续按下方已批准目标实施。

## R123-BFF-HTTP5-D0：Agent5 消费、RunProcessProjection 与 public7 锚定分页（2026-10-02，未实施）

本节替换上一版 R123 前缀；下方历史正文保持逐字不变。基线仍为 BFF main
`02276b623f8390288fbf86d6efaa0f5152256afa`，当前 public OpenAPI 仍是 `6.0.0`（SHA-256
`75ef9f7a3b28018d9c7a3ca5899f75afe561dd40b794e7f71b0e3d078b29c129`），BFF 仍固定 Agent HTTP4
`e977923ea9992cbddaf0cdbc6c8f8d23b3af120e`。已发布 Agent main
`79bf98c5aa63b9bace207afdf42d8c7aefee4fe8` 的 canonical HTTP5 OpenAPI version `5.0.0`、SHA-256
`bca8e4f4fd613e4325f594266893d5b089168cf14f2ad7a7df03f3f116af85f2`，provenance SHA-256
`12c0f7ad3e6f7de6ff2183410fdae986119e99bd6975e9f07ee71f23dc2d22ca`；distribution2、HTTP5 与 proof1 是不同身份。

Root 已裁决独立评审的三个 P1：public 唯一目标是 breaking `7.0.0`；snapshot 的安全过程是有界第一页而非伪完整数组；`execution_process` 与 FIFO `execution_head` 独立；BFF 不从 Agent5 enum 发明 activity transition graph。本 D0 仍未修改 production、public machine、SQL、vendor/generated、lock 或 Git。

### §8 放置表、目录比较与阶段边界

| 项 | 当前裁决 |
|---|---|
| Owner | Agent 唯一写 Run、Todo、Skill/tool/subagent、HITL 与 Delivery；BFF Chat 唯一写 durable AG-UI ledger、compact `RunProcessProjection` 与授权 public read model；Web 只读 BFF。 |
| 当前事实 | HTTP4 mapper 仍读取 raw tool/subagent 且没有 Todo/Skill；public6 snapshot 的 Message/head/HITL/Delivery/watermark 已同一 RR，但没有安全过程。`agui-consumer-registration.ts` 在 `expected_run_id` 变化时把 `latest_run_start_sequence` 清 NULL，实际会在后继只 queued 时丢失上一 durable START。 |
| 目标职责 | 固定 Agent5 owner artifact；严格 decode closed Todo/activity；同 source/frame/HWM 事务写 compact；snapshot 在其 `event_watermark` 上返回 selected Run 的 Todo 与 activity 第一页；后续 `/runs/{runId}/process` 从不可变 safe CUSTOM ledger 读取同 anchor 页。 |
| 表方案 | 淘汰“扩 interaction Row”与“一个无界 JSON aggregate Row”。采用 `bff_agui_run_process`（每 Run START+Todo）和 `bff_agui_run_activity`（每 Run/activity 当前安全值）；interaction 表继续只管 HITL。 |
| 锚定页来源 | 淘汰“只读 mutable latest activity Row”：并发更新会污染下一页。采用现不可变 `bff_agui_event` 中 `kokoro.activity.updated` frames，在 `public_sequence <= anchor` 取每 activity 截止 anchor 的最后值，按其首次 public sequence + activity_id 排序；compact activity Row只做当前态/完整性/GC引用。 |
| decoder 放置 | 比较继续膨胀 `clients/agent/projection.ts` 与新 `clients/agent/process-state.ts`；采用后者，只承担 Agent5 Todo/activity 的 generated-schema 后语义门（Unicode scalar、原始 payload UTF-8、conditional presence）和 wire→安全内部值，mapper编排留原文件。单文件单变化原因，不新模块/目录。 |
| reducer 放置 | 比较把规则塞进 `project-chat-event.ts` 与新 `application/agui/process-state.ts`；采用后者做无副作用 replace/replay/conflict reducer，projector只映射安全 CUSTOM。这里“replace”不含 phase/status 单向校验。 |
| SQL helper 放置 | 比较继续加长 `agui-projection-repository.ts`/`chat-repository.ts` 与现 postgres 目录两个窄 helper；后继采用 `agui-process-projection.ts`（父事务内写/核验）和 `agui-process-page.ts`（RR anchor 查询）。helper只收 caller `PoolClient`，不建 pool、不 commit/rollback、不反向 import repository。 |
| 页输入/route/codec | route 留在现 `src/http/routes/chat.ts`，不新 router；新 `src/http/chat-process-page-input.ts` 只解析 exact query `watermark`、`cursor`、`limit`。比较复用会暴露 sequence 的 `conv/msg` base64 codec、另建持久 cursor 表、使用现 ledger opaque IDs：采用第三项；`watermark` 与 `cursor` 只接受 `agui_...` opaque wire ID，repository在当前 scope/run内解析 anchor与 after activity，不把 source/public sequence编码到wire。typed mapping留 `chat-service.ts`/port，不建新业务模块。 |
| 依赖 | owner bytes→generated client→窄 decoder→纯 reducer→现 projection port/repository；public页只读 BFF ledger/compact。禁止 Agent source import、跨 owner SQL/FK、Redis或浏览器缓存事实、raw/generated类型穿透public。 |
| 机器目标 | 公共唯一编辑点 `contract/openapi/v1/openapi.yaml`，版本一次切 `7.0.0`；SQL唯一编辑点 `database/schema.sql`。不保 public6 alias、HTTP4/5双pin或fallback。 |
| 删除项 | GREEN 同片删除 e977 HTTP4 vendor/pin、旧 raw activity mapper和 raw Tool frames；不迁移历史 raw ledger为safe，不输出 args/result/name/description/error原文/path/stack/hidden reasoning。 |

### 唯一状态、事务、幂等与故障规则

1. Agent page 继续按 consumer lease/fence、stream version CAS 与连续 source HWM接纳。每批在一个 `commitProjection` 事务中完成 exact decode、source identity、全部 frames、process/activity compact、Message/HITL/Delivery、HWM/version；任一 schema、scope/run、digest、frame correspondence、CAS/fence错误全部回滚。网络请求不持PG锁。
2. Todo只接受完整有序 `todos` 表，0..100项；content 1..1024 Unicode scalar，status三值，原始 `payload_json` UTF-8≤65536。缺事件表示 `todos:null`；显式 `[]` 才是已观察清空。每个合法后继Todo source按seq替换并保存新provenance。
3. activity只接受 Agent5三个closed union。每个合法、连续、Run绑定的后继source都替换该 `activity_id` 当前安全值；相同 source identity+digest no-op，相同identity不同digest冲突。不得拒绝合法 phase回退、terminal后合法status、kind/segment变化或同activity新preflight；若要这些不变量须Agent先发布机器规则与向量。
4. 安全网络只发 `CUSTOM kokoro.todo.updated` / `CUSTOM kokoro.activity.updated`；value是白名单payload并保完整AG-UI metadata。`segment_id`、activity/preflight都只是opaque owner identity，不伪装assistant message id。HITL/Delivery/Run标准frames语义不变。
5. `execution_head`继续描述FIFO queued/active/waiting/resuming；`execution_process`选择不依赖head是否active：选择截至snapshot anchor最近的 durable `RUN_STARTED` Run。terminal后保留；下一Run仅queued时仍返回旧Run process；只在新Run durable START与其process anchor同事务提交后切换；从未START才为null。selected `run_id`允许不同于queued head。
6. `agui-consumer-registration.ts` 后继只纠正START保存：注册新 `expected_run_id` 不清上一 `latest_run_start_sequence`，直到新 `RUN_STARTED` 原子覆盖；现version bump、consumer fence、lease清理、failure reset与subject条件保持原语义，不能为了process选择放宽。
7. snapshot仍在单个 `BEGIN ... REPEATABLE READ READ ONLY` client授权tenant+subject+active Conversation并读取Message、head、selected process、HITL、Delivery、ledger head。`event_watermark`是anchor；process START/Todo/current references须同Run且不晚于source HWM/anchor。safe ledger存在而compact缺失、foreign scope、digest/frame不符为503，不猜null/空。
8. process page每次重新做相同授权RR。`watermark`必填；`cursor`可省略：省略时读取任意已授权历史Run在该anchor的第一页，提供时必须是上一页`next_cursor`并从稳定keyset续读。anchor/position都须在当前tenant+subject+session+run内解析。unknown/foreign/malformed为400；frame或anchor已越retention且有tombstone为410并要求重取snapshot；完整性损坏为503。共享链接不授予process route。
9. snapshot内`execution_process`对象与独立process response各自按同一page预算：每页activity默认/最多100，序列化的process page对象（Todo、activities、cursor等）≤现1 MiB；该预算不包含snapshot的Message/Delivery等其他字段，不能因长聊天正文拒绝process。达到count或byte边界即返回next_cursor，不截断单条；单条无法装入空页时typed 503。分页耗尽（`next_cursor:null`）才证明该Run过程恢复完成。
10. cancel/resume ACK、Todo `[]`、Skill failed、tool/subagent status都不结算FIFO；只有owner terminal source结算head。timeout/429/5xx沿现有界重试；401/403/410/invalid/oversize阻塞。Redis publish丢失不影响DB恢复。
11. GC不发明天数或客户端永久refcount。locked discovery/requery建立内部引用集合：selected Run START、其最新Todo/current activity provenance、HITL/Delivery/Message需要的frames不得先删；terminal且后继queued仍是selected。新START后旧Run只有在不再selected/live/queued且source+frames跨既有批准retention boundary才可删compact。public cursor不无限pin；anchor/after frame被回收后以tombstone返回410，绝不从0或最新Row猜页。

### public7 已裁机器形状

- `GET /v1/sessions/{sessionId}` 的 `execution_process` 是 **required nullable**。非null时四字段全部required：`run_id`、`todos`、`activities`、`next_cursor`。`todos`为nullable完整表；`activities`是anchor下第一有界页；`next_cursor`为opaque string或null。顶层required `event_watermark`（opaque string或null）与该页共同组成snapshot anchor。
- `GET /v1/sessions/{sessionId}/runs/{runId}/process?watermark=...[&cursor=...&limit=...]` 是owner授权锚定page；`watermark` required，`cursor` optional（省略=该历史Run第一页，提供=continuation），`limit` omitted默认100且范围1..100。200返回required `run_id,todos,activities,next_cursor,event_watermark`，watermark必须与请求anchor相同。
- 页只含Todo与safe activities，不含source seq、public sequence、digest、lease/fence。replay仍是独立AG-UI cursor接口，1000 frames/1 MiB；process页不改变replay语义。

### 后继切片与精确写集（均需Root另授权）

1. **先行 GREEN-A：仅 owner wire / generated / strict decoder / projector。** 写 `contract/vendor/kokoro-agent/79bf98c.../{openapi.json,provenance.json}`、删除 e977 vendor，改 `contract/dependencies/agent-http.json`、`openapi-ts.agent.config.ts`、`scripts/generate-agent-http-client.mjs`，只由生成器写 `src/generated/agent-http/**`；生产只改 `src/infrastructure/clients/agent/{http-wire,projection,projector-source,types}.ts`、新 `process-state.ts`，以及 `src/application/agui/project-chat-event.ts`；复用本轮四RED测试。此片只让已发布HTTP5闭集安全穿过 reader→decoder→CUSTOM，不改SQL、snapshot、public7 machine、process分页或GC。
2. **RED-B：public/SQL/RR/分页/GC。** 精确测试目标：`test/contract/openapi-contract.test.mjs`、`test/contract-governance.test.mjs`、`test/chat-service.test.ts`、`test/schema-governance.test.mjs`、`test/chat-facts.integration.mjs`、`test/agui-projection.integration.mjs`、`test/agui-http.integration.mjs`。覆盖first queued process=null、terminal→successor queued仍旧process、新START切换、101 activity两页、页间新update仍as-of、anchor/scope/run/position非法、410、单条超限、全事务rollback、registration保START、GC locked requery引用保护。
3. **GREEN-C：机器/public/SQL。** 改 `contract/openapi/v1/openapi.yaml`、baseline/operations/contract README；`contracts/chat.ts`、`application/ports/chat-repository.ts`、`application/chat-service.ts`、`http/routes/chat.ts`，新 `http/chat-process-page-input.ts`；`database/schema.sql`、`infrastructure/postgres/{agui-projection-repository,agui-consumer-registration,agui-consumer-repository,chat-repository}.ts`，新 `agui-process-projection.ts` 与 `agui-process-page.ts`。bootstrap只在现composition无法接线时纳入，不预授权新模块/进程/依赖。
4. **验证顺序：** GREEN-A先跑Node22生成/四pure/build；Root审后才开RED-B。GREEN-C再跑format/lint/typecheck/contract/schema/architecture/full test/build；Root独占fresh空`kokoro_bff` schema、真实PG/RR/GC/restart与正式Agent5 HTTP。D0与RED都不算功能完成。

### 当前RED事实（不是修复证据）

Root独立以Node `v22.22.2`复现：build exit 0；四pure文件148 tests / 120 pass / 28预期行为fail / 0 skip，日志manifest位于Root临时目录。120个通过包含既有106正控，以及14个新Todo/raw/extra/required/display/identity负控与现Todo direct CUSTOM正控；28个RED分为1个HTTP5 wire、9个mapper/projector、9个真实reader合法端到端、9个旧raw/Skill strict fail-closed。四测试SHA-256依次为 `ff865fe5a1f6f1862e952870e86b8ba535f5fbe005fe7bd265e1d9cb5c2f6f1b`、`fdd557c0771fb1d126f1ac4e7cca9439128545148f531fae44c1a2642c91572c`、`195135e3e6d8a46536721a4857965cc0ff4493f38e0cfcf08f922dcdccefceb3`、`f95e592fbd2c09b731862c3dff066b4d25f8c7044ebe0d81c3a3d9e1c3b5f505`。本D0不把RED描述为已修。

---

## R83-BFF-DIRECT：Conversation collection direct scope / public6 D0（仅文档，未实施）

基线 `main / 479d4e8b0aeb438d2ec9cb3d4472130fc1a29972` clean。Root 已裁决本片只修 `GET /v1/sessions` collection：显式 `scope=direct` 只列 admitted tenant+subject 的 active 且 `project_ref IS NULL` Conversation；省略或空 `scope` 保持 owner 全集；非空 `project_ref` 保持本人项目过滤；显式 direct 与非空 project_ref 同时出现，在任何 Project 查询前返回 HTTP 400 `invalid_scope`。detail/message/events/control/title/delete/share 等 resource authorization 语义逐字节保持，不把 direct 解释扩散到资源 gate。

当前 `src/http/routes/chat-authorization.ts` 已校验 scope，但成功值只保留 `projectRef`；`src/http/routes/chat.ts`、`src/application/chat-service.ts`、`src/application/ports/chat-repository.ts` 与 PostgreSQL repository 用 `projectRef: string|undefined`，把 direct 与 owner-wide 合并。目标只在现文件沿链传递显式 `all | direct | project` collection filter：all 不加归属过滤，direct 加 `project_ref IS NULL`，project 加参数化等值；tenant、subject、active、同 owner Project EXISTS 与既有 keyset 顺序每页重验。禁止在 Web 或 application 对已分页结果后过滤。

放置结论：Owner/唯一 writer 是 BFF Conversation；扩现 authorization、route、application port/service 与 PostgreSQL repository，优于新模块、通用 scope 层或兼容 adapter。无新文件、目录、进程、依赖、缓存、事务、schema、migration 或索引；`database/schema.sql` 保持原字节，是否需要索引只能由后继真实 EXPLAIN 证明，不能预建。resource 路径继续只消费现 `projectRef`，collection filter 不成为新的授权凭据。

后继生产写集精确为 `src/http/routes/chat-authorization.ts`、`src/http/routes/chat.ts`、`src/application/ports/chat-repository.ts`、`src/application/chat-service.ts`（任务卡旧 `src/application/services/chat-application-service.ts` 路径不存在）、`src/infrastructure/postgres/chat-repository.ts`。测试写集为 `test/chat-service.test.ts`、`test/chat-facts.integration.mjs`；canonical/治理写集为 `contract/openapi/v1/openapi.yaml`、`contract/README.md`、`test/contract/openapi-contract.test.mjs`、`test/architecture.test.ts`。本 D0 未授权也未修改这些文件。

阶段门固定为：四 D0 一致并由 Root 放行 → 真实函数 pure RED（omitted/empty/direct/project 显式传播，冲突400）→ 真实 PostgreSQL D/P/Q、其他 subject/tenant、tie pagination RED → production GREEN → public6 canonical/contract tests → Node22 完整 BFF 门 → Root 独占真实 fixture 回归与资源回收 → 发布不可变 owner commit/version/digest → Web 独立正规 repin。不得以 D0、source-string 检查或旧 public5 结果宣称过滤已修。

## R74：ScheduledTask create / public5 源码 GREEN 候选（未发布）

R75 当前更正：Root final 已执行真实 full integration 149pass/0fail/0skip（23.395s）并完整回收 owned 资源；supported Node22 完整离线门全部exit0，日志 `/tmp/kokoro-bff-r75-root-supported-node22.log`，native Sol 十二路径冻结审0。其后发现发布阻塞P1：共享 CreateScheduledTaskRequest 没有属性 required，虽两个 POST 的 requestBody.required=true，空对象仍被机器schema接受，与现 production parser 不一致。本片只在同一个未发布 public5.0.0 schema 补 title/prompt/frequency/time/timezone 五项 required，保另外四属性optional；无新增业务规则、文件、依赖、clock或生产源码修改。现契约测试EOF先实际RED再补机器GREEN，不重复架构规划。Root原149/离线结果是修复前冻结证据，新hash待Root定点/contract/149复验后发布。

基线 main / d695fcbc0cd3f0376c34f64f6217d9d8e74c1b3c；Root 已复验 R73 纯 RED 83=51pass/32fail/0skip，以及 owned canonical fixture 上真实 HTTP+PG+Redis 53=14pass/39fail/0skip（含父/嵌套 failure，不是 39 个独立缺陷）。资源已由 Root 回收。本节覆盖下方 R73 的「版本待裁定/生产未修改」阶段描述；全部下方原正文保留，不作为当前完成证据。

Root 已批准 public5.0.0 作为首次公共上线前 clean-slate breaking artifact，保唯一 /v1、不建 /v2 或4/5双读；正式公共发布后仍按既有 breaking 策略。允许原 parser/route/server、canonical OpenAPI/contract README、四 D0 与三测试；本窗口唯一 writer，Root 独占 Git/资源。目录方案沿 R73：扩现输入模块优于新通用 validation 层，无新文件/进程/依赖。类型复用现 ScheduledTaskCreateInput，不建重复 DTO。

实施方案：scheduled/input.ts 负责 closed body、auto_approve boolean 和精确非空无边缘空白 project_id；server 在 create 的 query/body 预验后，把同一解析对象传给 live-bff 项目授权和 create，均先于 receipt claim/replay。route 不再对该入口重新 trim/解析。项目路径 create 现也消费同一 schema/parser，保 path 项目绑定；不扩其 query/receipt 策略。PATCH、首次 Project FOR SHARE/task+outbox 同事务、外层 receipt 与 commandAlreadyExists 恢复顺序保持。

验证顺序：既有真实 RED→本片纯定点 GREEN→Node24 format/lint/typecheck/contract/architecture/unit/schema/build→完整冻结/只读独立审→Root 全 owner 资源回归→发布 artifact→Web 后继独立 repin。当前源码候选已形成：Node24 纯定点85/85、architecture27/27、unit672pass/1skip、schema8pass/1skip；Node24 contract:check 因既定 Node22 生成器 pin 失败，保留exit1，固定Node22完整contract222/222通过。未宣称修改后的资源HTTP GREEN或整链完成。

## R73：ScheduledTask create 严格输入与项目引用（D0 / tests RED）

基线 `main / d695fcbc0cd3f0376c34f64f6217d9d8e74c1b3c`，R71 已由 Root 发布。本节为 R73 ScheduledTask create 的唯一当前目标；下方全部旧正文逐字节保留，其 R71「待发布」和宽松输入描述仅是历史阶段，不覆盖本节。当前阶段仅 D0 + tests RED，生产实现、canonical contract、SQL、package/pin/generated 尚未修改。

### 已裁定边界与放置

仅 `POST /v1/scheduled-tasks`：ScheduledTask 保持独立，可省略 `project_id`，不绑定 Conversation/Message/session。提供时必须是精确非空 string，禁止 null、非 string、数组、空串、纯空白及前后空白；不 trim 后放行、不静默降级成独立任务。合法可见 Project ID/slug 仍由 BFF 同 tenant/subject 解析。一个已校验引用供权限预检和实际 create 共用，身份只来自受信上下文。

Root 明确决定创建端无 query：任何 query 参数（含重复、空值或 project_id）均 400，这是本次产品策略，不是由 OpenAPI 未列 query 自动推导。unknown body、auto_approve 非 boolean、create enabled/status 均 400；创建固定 active/enabled=true，后续暂停/启用仍走既有 PATCH。语法拒绝和项目权限检查均先于 generic receipt claim/replay；不可见/不存在/跨租户项目统一 404，不修改全站幂等。

| 项 | 本片结论 |
|---|---|
| Owner / writer | BFF ScheduledTask；WIN02 唯一文件 writer，Root 唯一 Git/资源/集成 owner；独立审查员只读 |
| 当前事实 | src/application/scheduled/input.ts 宽松解析；src/http/routes/live-bff.ts 预检 trim、create 原值；src/bootstrap/server.ts 先项目预检后 receipt；工作树起点干净 |
| 目标职责 | 在原 create 入口关闭输入并复用一个已验证引用；不新增 API、模块、进程或跨 owner 访问 |
| 目录比较 | 采用现 parser/route/server 和现测试文件；淘汰新通用 validation 层或新 Scheduled 模块目录，避免把一次 create 修复扩为全站重构 |
| 粒度 / 依赖 | parser 只负责输入，HTTP 负责错误/准入次序，service/repository 保持事实事务；无依赖升级、框架/driver 类型上泄 |
| 数据/API | 唯一 contract/openapi/v1/openapi.yaml 与 database/schema.sql；当前均冻结。后继 contract 删除 create enabled/status、约束 project_id 边缘空白、补现有 404；不改 PATCH |
| 删除项 | 本阶段无；GREEN 删除 create silent-ignore 与重复引用解析，不增加 alias/fallback/双轨 |
| 验证 | 本窗口 build + 两纯定点、语法检查、原前缀/非目标 hash；Root owned fixture 跑 business-store integration，再执行 contract/architecture/unit/schema/build 与完整回归 |

### 事务、重放与失败恢复

首次关联创建在原 ScheduledTask repository 事务内按 tenant/owner 读取并 FOR SHARE 锁定 Project，写 task+outbox；任何 SQL 失败全回滚。terminal HTTP replay 仍先校验当前项目可见性：原 key/body 在合法引用下原响应 200；同 key 改另一可见项目 409；撤权后原请求 404，保留既有事实与 receipt。租户准入不符仍 403，与已准入者引用跨 tenant 项目 404 分开。

外层 receipt 尚未保存、task/outbox 已提交时，repository 的 commandAlreadyExists 早于 ownedProjectId，这是现实现事实，不声称该恢复分支再次锁定 Project。R73 不重写 generic idempotency 或 Scheduler accept/head。非法输入/预检拒绝证明三表零新增；真实 outbox 故障触发器证明 task/outbox 回滚及 5xx pending receipt 释放；重建 BFF 实例证明 terminal replay，无 mock HTTP response 代替数据库。

### 阶段与发布门

三 D0 已记录同一目标，但机器契约与实现保持旧态，完整文档/机器一致性门尚未通过。删除 create enabled/status 是 breaking；contract/README.md 的既有版本规则与一次性 corrective 例外不能自行延伸。正式 GREEN/发布前由 Root 裁定唯一版本策略、精确授权机器/实现写集与旧 R71 全字段断言迁移。先 owner 完整门并发布不可变 commit/version/digest，后 Web 单独 repin/生成/验收；不修改 Web 已固定旧 artifact，不声称兼容。

## R71：独立 ScheduledTask 可选项目关联契约补齐（待发布）

基线 main / 3928043ec243eaec28af32c231a0bbf75a8b19ec。本片唯一 owner 仍为 BFF ScheduledTask；沿既有 `/v1/scheduled-tasks` → scheduledTask service → repository 边界，仅在 canonical `CreateScheduledTaskRequest` 补充可选 `project_id`，对齐已存在的 parser 和同 tenant/subject Project 校验，不新建模块、进程或调用链。ScheduledTask 独立于 Conversation；省略 Project 可独立创建，引用 Project 不把任务变为会话。

本片不改运行时源码、事务、Scheduler callback、accept/head、SQL 或依赖；机器 schema 的 closed 声明不等于已增加运行时全字段严格校验。正式发布及消费者升级由 Root 后续串行处理，当前 Web 继续固定旧 published artifact。下文历史正文完整保留。

## R62 / R59 实施候选（未发布）

Root R62 已批准在现 postgres 目录抽取 interaction 持久化职责；当前 projection repository 739 行、普通 helper 165 行。R59 decoder、纯 revision/control policy、projection/RR/control 及重复 START 原子拒绝已形成工作树候选；真实资源及发布仍待 Root。基线 main / 759bfe0a8c521946cae31a74b6426f43b063bae1；以下 R48 原 body 逐字节保留，阶段状态以本前缀及 CURRENT 为准。

| 项 | R62 已批准并实施的最小放置结论 |
|---|---|
| Owner | BFF Chat / durable AG-UI projection，WIN02 唯一 writer；Root 独占集成、资源与 Git |
| 当前事实 | 现 projection/chat repository 共同读取完整 interaction；新增逻辑使原 projection repository 达 830 行，既有事务和锁边界不得搬迁 |
| 目标职责 | src/infrastructure/postgres/agui-interaction-projection.ts 只承载 interaction Row 解码、source/ledger 完整性读取及事务内写入 |
| 目录方案 | 采用现 postgres 目录普通 helper；淘汰拆旧 replay 的方案，避免扩大 cursor、分页和旧 replay 边界，不建目录/模块/进程 |
| 粒度 | interaction 持久化是本片独立变化原因；原 repository 留 739 行，未以压行或放宽门禁达标 |
| 依赖 | projection/chat repo → helper → 本仓 interaction 类型/纯 digest/严格 decoder；helper 不回 import repo，不管理 Pool 或提交事务 |
| 数据/API | 无第二 schema/contract；父锁、stream/outbox 锁、lease、CAS、source/frame 和 commit 仍由原 repository 管理；读 helper 仅在已授权 RR 或原锁内使用 |
| 删除项 | 原 projection repository 内对应 decode/read/write 函数已抽出，不保留重复实现/alias；旧 replay 保持原职责 |
| 验证 | Node22 format/lint/typecheck、contract:check、test:architecture、schema:check、test、build；Root 冻结后完整真实 PG/Redis/HTTP；本窗口未执行资源门 |

---

## R48-BFF-D0：已发布 Agent4 的完整 pause / public4 消费设计（当前目标，未实施）

本前缀是本轮唯一当前方案；下方原正文及 R27/R43/R44 的“owner 未发布/旧锁图/待实现”保留为历史阶段，不与本前缀并列作实现依据。BFF 基线 main 759bfe0a8c521946cae31a74b6426f43b063bae1；本轮仅四 doc 插入前缀，所有生产、测试、机器、SQL、pin/generated 与 Git/资源保持冻结。TS 手册 §1、4–6、8.4 与 SQL 手册为规范入口，不进行框架/目录重构。

### 已核验事实、owner 与放置门

Agent main e977923ea9992cbddaf0cdbc6c8f8d23b3af120e 已由 Root 发布。唯一 HTTP4 机器源为 Agent 的 contract/openapi/v1/openapi.json，version 4.0.0、SHA-256 763ff7a9cf668eb59ae7cfb59b2fd4f84fafde124063d9a365f138b6a30cf04f；contract/provenance.json SHA-256 e2e6cd9f2228900d0c0a8d795f19815a145bd8f0d18c785ffbe059214b5ed99a，combined_sha256 7710ec0e88b55c15279503d6d4aa9494f3ee91c5411284f255df8f107fdc5806。ChatEvent 使用 interaction.state→ChatInteractionState，不再发布旧 interaction。ResumeControl 必须携带 expected_pause_revision/pause_ref；HTTP admission 不证明 native consumption。已发布 LaunchRequest 没有 retry_of_run_id，不能把历史 retry4 草案混入本 cut。selected_skill_source_refs 的既有 required 选择语义保持，合法无外部 Skill 的显式空数组不是 pending 空集合证明。

BFF 当前 contract/dependencies/agent-http.json 仍固定 Agent3 f3be3b97/e9f0a543；生成器及 config 同样固定旧 commit，并只生成 launch/session-events，不生成 control。public canonical OpenAPI 仍为3.0.0。内部 head 候选已写 queued/交接/RR/head-aware replay，但 ChatApplicationService 仍发 active_run 与顶层固定 pending_pauses=[]，旧 mapper 仍把 interaction 当单项 awaiting，不能宣称完整 pause。

| 项 | 当前设计结论 |
|---|---|
| Owner | Agent 唯一拥有 Run/native pause/decision consumption；BFF Chat 唯一写 durable public projection、FIFO head、完整 interaction read model；Web 只消费发布的 BFF artifact |
| 当前事实 | 现 application/agui、clients/agent、postgres、Chat service/ports 与 owner canonical/vendor/generated 路径；五内部源、R46/R43 与原 dirty 测试冻结；未提交变更不覆盖 |
| 目标职责 | snapshot 四态/full pause 与 watermark 同 RR；同一 durable ledger 支撑 AG-UI/replay/restart；resume 携带整个当前 pause 的 decisions 与 required locator，不以 ACK 改状态 |
| 目录方案 | 扩展现 Chat/AG-UI/client/repository 边界，并在现目录放普通 decoder/reducer/collection validator 文件；淘汰新 modules/chat/hitl 顶层搬迁与 stream projection_state 塞任意状态，前者无必要重构、后者混淆 projector cache 与 durable run fact |
| 粒度 | 新普通文件仅承担外部 interaction decode、纯 revision transition、纯 resume collection policy 三个独立变化原因；Service 编排、Repository SQL、wire schema 各保现角色，不建新目录/进程/Repository abstraction |
| 依赖 | owner HTTP/generated→窄 decoder→内部 typed projection→本仓 Repository；Web→BFF；禁止业务 import sibling Agent 源码/数据库、框架/Pool 类型上泄、runtime import scripts、直接把 generated wire 当本仓 Row |
| 数据/API | 选本仓 run-scoped 最新完整 interaction 投影一表，唯一 canonical database/schema.sql；public4 原 /v1 corrective；tenant/subject/project 来自可信授权；既有 durable receipt/lease/fence、source ledger 与 opaque cursor 保持 |
| 删除项 | 切换片删除旧 Agent3 vendor/pin/event-protocol split pin、旧 interaction/tool.awaiting_approval adapter、active_run/ChatActiveRun/顶层固定 pending_pauses 及其消费者；不保留 alias、双枚举、旧3 fallback；保留通用 AG-UI Message/Tool 事件和历史 source guards |
| 验证 | RED→机器/pin+DDL+source 同片→Root 真 PG/HTTP/SSE/重启与旧完整投影矩阵→完整 lint/typecheck/contract/schema/architecture/test/build→独立审/Git 发布→Web repin/fresh 激活 |

### 四态、完整 revision 与事务

公开 execution_head.state 为 queued|active|waiting|resuming；active 是 UI streaming 的执行态，不另发 streaming alias/第五态。head 仍为同 tenant/Conversation 原 FIFO 最早 nonterminal outbox，snapshot 先授权 Conversation，再在一个 checked-out REPEATABLE READ READ ONLY client 读 head、stream、最新 run interaction、Message/Artifact 与 event_watermark。raw head identity/owner/subject/expected 错误 fail closed，不过滤后猜下一条。RR 内另沿现 public ledger 的 tenant/session/sequence 主键范围，从 matching START 到当前 watermark 查当前 run 最新 kokoro.interaction.state CUSTOM；其存在性/revision/digest/cursor须与 run projection 对等。无 projection 仅在该已验证前缀无任何 full-state CUSTOM 时才是合法初始态；已有 CUSTOM 却丢 Row、Row 无 frame 或落后最新 frame均 fail closed，不引入额外 has_pause boolean。

- queued：尚未匹配 RUN_STARTED，即便 leased/retryable/admitted；无当前 pause，pending_pauses 为空。有效 waiting/resuming source 必须绑定当前已 started run，非法前置/foreign revision 不被转为空。
- active：匹配 started，尚未出现任何 interaction revision 时由连续已验证 source 前缀证明初始无 pause；已有 revision 后仅其明确空集合 phase active/terminal 才无 pending。不得因 Row 缺字段、parser 忽略事件或普通 activity 默认空。
- waiting：最新完整 source phase waiting、groups 非空；新 pause/re-pause/validation_failed 仍为完整 waiting，不 merge 旧 items。
- resuming：最新 source phase resuming，groups 保留原全集，action_result 为 accepted 或 unknown 且精确当前 pause_revision；HTTP/browser ACK 不使 waiting 转移。unknown durable source 仍保留全集并阻止新 key 重复决定。
- interaction phase terminal 关闭 interaction，不单凭它发明 RUN_FINISHED、释放 dispatch 或关闭 SSE；到受信 run.completed/run.failed 再结算 FIFO。两类 source 跨 page 时已 started head 保持 active/无 pending 的 drain 中间态，待真正 run terminal；下一 queued head 与 cursor 保持同事务。

最新 interaction 以 owner interaction_revision 严格前进：较低拒绝；同 revision 同完整规范化内容不重复 frame/投影，仍按 source ledger 连续性处理合法 source；同 revision 异内容整批回滚。pause_revision 不倒退，pause_ref 与当前/新 pause 关系、groups/item 全局唯一及 action_result 交叉约束按 owner 运行时规则校验；不自行要求 interaction revision 必须 +1，也不假设两个 revision 相同。owner wire 没有可自报的 Run fence 字段；本仓以现 consumer lease/fence、stream version、raw run identity 与 source provenance CAS，不添加假 wire fence。

完整 state、source identity/digest、CUSTOM frame、public cursor/version、source watermark、Message/Artifact 与 terminal→下一 head 由现 commitProjection 同一 Conversation→stream→dispatch→tail 事务写入，任一校验/SQL/lease CAS 失败全回滚。跨 Conversation batch 仍先一次锁全排序父集合；no-parent register/GC 的 authority 修复保留。网络调用不持父锁或 RR transaction。GC 不丢当前 head 的 queued cursor、latest full-revision public frame/source 引用或原 START 边界；delete 的既有 soft-delete/取消 outbox 语义不变。GC candidate 与锁后 requery 必须共享 effective retention boundary：min(latest START、live queued sequence、live head latest full-revision sequence)，并在 LIMIT 前完成父存在/START引用/至少一条过期且sequence小于该boundary的完整 eligibility。不能先按sequence<START挑入、再在删除时用更小retainFrom，从而让无可删帧的A占满batch、永远挡B。该公平性独立于已通过的authority四例，尚待真实RED。

resume 用既有 ChatApplicationService 编排窄 readRunControlState RR 查询；纯 collection policy 在 src/application/chat-run-control.ts，不把业务规则塞 route 或 outbound decoder。BFF 在可信 Conversation/当前 head 内校验完整 item ID 集合、allowed_decisions 与 decision shape；动态 input_schema 的实际业务验证仍由 Agent 原生执行，validation_failed 通过下一完整 source 呈现，不新增第二套 JSON Schema 执行器。关闭 RR 后才发 owner control，race 最终由 Agent required revision/ref 与幂等 key 拒绝。不同 key 在 resuming 拒绝；同 key recovery 先用既有 durable receipt/digest 重放，receipt 尚未可得而已观察相同 action_result.command_id 时，只允许同 pause 的完整幂等重试并继续由 owner 验 digest，不伪造 BFF 已掌握私有旧参数。

### R56 P2：三种 digest 的不同身份与归一边界

BFF mutation fingerprint 绑定本仓外层 durable receipt scope（可信 tenant/subject/method/path/key）及现 method/path/query/canonical headers/semantic body 请求语义；它是现 stableStringify 指纹，不是 Agent request_digest，也不是 interaction_digest。不同请求表示是否在 BFF receipt 层冲突仍按本仓规则；owner 的 null/omitted 等值不自动使两份 BFF mutation fingerprint 或 receipt 可互换，不重写全站幂等策略。

Agent4 control request digest 基于固定 owner 的 RunResume typed normalization：material 含 kind/run_id/session_id/expected_pause_revision/pause_ref/decisions，排除 command_id/request_digest；只在 owner 声明的可选 nullable model 字段 approve.args、reject.reason 上将 null 与 omitted 归为同值。其余 required locator/item identity 不默认、不省略；decisions 保序；对象键排序、紧凑 UTF-8 JSON 后输出 sha256:<hex>。不得递归删除 submit.value、edit.args 或非空 approve.args 内的业务 null；业务字典中的 {"x":null} 与 {} 是不同 material。

interaction_digest 仅绑定 owner 完整六字段 full state：对象键递归排序、groups/items 等数组保序，optional 字段的实际存在性与 null 值保持；不套用 control 的 optional-null 归一规则。同 revision 的 full-state digest 相等才允许 no-op，mutation fingerprint/control digest 均不能证明 state/source 相等。

现 src/infrastructure/clients/agent/control.ts、control-receipt.ts 与 control route 仍消费旧逻辑，后继必须在已列精准写集迁移 required locator、typed normalization 和 receipt digest 对照；对应现 test/agent-control-adapter.test.ts 的 owner-fixed 向量至少覆盖 approve.args/reject.reason null↔omitted 同 digest、submit.value/edit.args/非空 approve.args 内业务 null 保留且不同 digest、排除 delivery IDs、required revision/ref 与决策顺序。full-state 同 revision optional omitted↔null 不等值的投影向量独立保留，不用 control 向量替代。当前仅修正文档，未迁移 adapter/向量，不构成 public4 完成。

### 精确后继文件集（本轮全部未授权写）

| 切片 | 精确路径与变化原因 |
|---|---|
| 最小先 RED | 现 test/agent-control-adapter.test.ts（required revision/ref、五 decision shape、整集合与 ACK 无状态效果）、test/agui-source-page.test.mjs（HTTP4 interaction.state 严格 decode/拒旧 interaction）、test/agui.test.ts（一完整 CUSTOM）、test/chat-service.test.ts（四态公开 snapshot）；现 test/agui-projection.integration.mjs、test/agui-http.integration.mjs（真实完整 revision/RR/rollback/restart/control） |
| 公共机器 | contract/openapi/v1/openapi.yaml：public4、ExecutionHead/PendingPause/ResumeDecision/RunResumeRequest/interaction CUSTOM 值与示例；contract/tests/v1-operations.json 仅批准 breaking baseline，operation/path/permission 不变；contract/README.md、README.md、INDEX.md、docs/INDEX.md 同步唯一入口 |
| Agent 固定消费 | 新 contract/vendor/kokoro-agent/e977923ea9992cbddaf0cdbc6c8f8d23b3af120e/{openapi.json,provenance.json} 只拷发布 bytes；删除两旧 commit vendor；现 openapi-ts.agent.config.ts、scripts/generate-agent-http-client.mjs、contract/dependencies/agent-http.json 同时固定 HTTP4/provenance，生成 control+launch+session-events，删除仅 delivery.created 的旧 split event pin；src/generated/agent-http/** 只由现生成器重建，不手改 |
| 窄 source decoder | 现 clients/agent/{projection,types,http-wire,control,control-receipt,index}.ts；新 src/infrastructure/clients/agent/interaction-state.ts 只做 generated schema+owner 跨字段校验；projector-source.ts 保 continuity/错误/预算接线，仅真正必要的 typed source 变化，不改 Scheduled 业务状态机 |
| 纯投影与 ports | 新 src/application/agui/interaction-state.ts 只做全量 revision 校验/替换；现 application/agui/{project-chat-event,project-session-events}.ts 与 ports/agui-projection-repository.ts 携带内部 typed interaction mutation；现 application/ports/chat-repository.ts 扩展 full head/窄 resume read，并删除 ChatActiveRun |
| 持久化 | database/schema.sql 一新 run interaction 投影表；现 postgres/{agui-projection-repository,chat-repository,agui-consumer-repository}.ts 分别原子写/RR读与delete/保护GC；不重写已冻 outbox、cancellation、artifact helper 或 Scheduled 表 |
| 公开映射/control | 现 src/contracts/chat.ts、src/application/chat-service.ts、src/http/routes/agent.ts、src/bootstrap/server.ts；新 src/application/chat-run-control.ts 是纯 policy；server 仅传现 Chat service 给 route，reuse receipt/auth/HTTP transport，不新增进程或隐式 network |
| schema/contract/回归 | 现 test/schema-governance.test.mjs、test/architecture.test.ts、test/agent-http-wire.test.mjs、test/agui-projector.test.mjs、test/agui-replay.test.mjs、test/contract/openapi-contract.test.mjs、test/contract-governance.test.mjs；三 integration fixture 的 TABLES/零写 fingerprint/own cleanup 仅补新表。Scheduled 仅检查 shared HTTP4 generated consumer，若发现必需变更先报告，不扩大 owner 业务写集 |

### R48 GC公平性最小真实RED（仅后继精准授权，当前不改测试）

只在现 test/agui-projection.integration.mjs 追加一个具名 R48 GC effective-boundary-before-LIMIT A/B 用例，保当前55cc7cfd整前缀。用真实生产 submit/claim/admitted/ingest 创建两个排序为A<B的同owner合法父：A live queued sequence1、START2且admitted，effective boundary1、没有sequence<1的可删帧；B完成旧Run后enqueue/start新Run，其live queued4/START5，旧prefix1–3过期可删。只精确成熟两owned scope的recorded_at，调用现collectGarbage batchSize=1。断言A stream/queued/source/public/tombstone完整fingerprint不变；B恰收一条合法旧prefix帧/同cursor tombstone与floor，B当前queued/START/watermark/full source不损；禁止用缺父、假返回、filter隐藏CUSTOM或all skip作为RED。Root fresh PG/Redis跑到真实删除断言后，才授 agui-consumer-repository.ts 的共享candidate/requery eligibility。新表引用到来后将同effective boundary纳入该查询，不复制第二算法。

### R48 完整旧矩阵的精准迁移门

Root 日志 /tmp/kokoro-bff-projection-r48-root-regression.log 实际21passed/9failed/0skip、1661.549ms；四 authority 例全通过。这九项是当前失败证据，非“全部 fixture”；WIN03 已交只读归因：7项 queued/head-aware 批准语义迁移、1项eligible-later缺真实父、1项publichead缺能力；仍待 Root独立审与精确写卡，未修改原断言。另发现上述GC公平性独立缺口，不把所有GC失败归fixture。下列是拟批准的语义迁移，不是本轮已修改：

| 原失败位置（test/agui-projection.integration.mjs） | 后继批准动作与仍须保持的断言 |
|---|---|
| 898 draft/tool/final replay；1311 page boundary | 把真实 queued CUSTOM 纳入精确完整 frame 列表和分页/cursor，显式核 name/value/run/sequence；原全文、Tool、RUN_STARTED/FINISHED 与丢帧/重复断言保持，不通过过滤 CUSTOM 恢复旧计数 |
| 1652 retention 长度/旧 offset；1789 interleaved 列表 | 从实际 enqueue/handoff 列表逐帧核 queued 与 START/terminal；按合法新的 sequence 校准 GC floor/tombstone/cursor；interleaved START 引用不完整仍禁止GC，不能放宽成非零任意值 |
| 1830 eligible-later 0 vs 1 | 现 fixture 无父 Conversation，按新 authority 本应不进入GC；后继仅给合法 control 建真实同 tenant parent/subject，保 inert starvation 及2帧回收，另保 R46 orphan 零写负例。该例 fixture 归因与独立 effective-boundary 算法缺口分别处理，不把所有GC失败归 fixture |
| 1939 newer-run marker | B queued 存在时有效 replay terminal 必须 null，DB 历史 A terminal 仍保留；明确新 head/cursor，原 old-source guard/正式B START/terminal断言保持，禁止清历史 marker 或提前 launch B |
| 2091 stale-projector replay | 纳入 queued frame，保原 stale lease/version commit 拒绝、source/frame/cursor零非法写；若 fence 行为也失败则先修生产，不删 fenced 断言 |
| 2285 invalid mixed batch frame_count | queued 已在故障前存在，应与故障前完整 fingerprint 相同而非硬编码0；source HWM不动、整批 source/assistant/interaction/ledger零新增全部保持 |
| 2493 R43 public head | 等真正 public4/full pause 源码映射后原 R43 assertion 原样转绿；RR barrier 与新旧 head/cursor/Message一致不降级；另外两文件 R43 queued回滚/重启后公开 head 后段同样保留 |

以上迁移须绑定发布 cut 的行为定义，先在原冻结基线记录 RED，再独立审准精确 assert/fixture/cleanup 行；不得更新快照吞掉未知失败、改 selector/skip/xfail、删除旧安全/一致性保障。

### 放行、验证与未决项

D0 只有此三面一致方案，待 Root/独立审正式放行；canonical SQL/public4/pin/generated 与测试仍未实施。未决执行项为 WIN03 九失败报告的 Root独立审/批准的精确旧测试行、GC公平性独立真实RED与修复、后继写入卡、真实 fresh catalog/完整 revision/并发锁 barrier 与 Web 消费证据；不是等待 Agent 再发布 pause，也不借本版本加入未发布 retry/MCP typed connection 目标。

后继 worker 仅 Node22 format/lint/typecheck/build/无资源纯门；Root 运行 pnpm contract:check、pnpm test:architecture、pnpm schema:check、pnpm test、pnpm build，自有空 kokoro_bff schema 的 pnpm db:apply-schema 与 catalog drift、串行 pnpm test:integration（含完整三文件/R43/R46/R48）、真实 owner control/全 pending/restart/GC/双连接精确 pg_blocking_pids barrier、SSE frame/byte/backpressure/取消门。全部结果与当前 commit/原始SHA绑定；4.0不是仅版本号升级。Root 先发布已验 BFF public4/SQL/Agent4 consumer 同一完整切片，Web 再固定 BFF commit/version/digest、删除旧消费并 fresh 组合，最后正式用户/IAM/模型多轮/费用链。无服务启动或共享资源动作在此 D0 内。

---

## BFF-SCHEDULED-D0：ScheduledTask 自有 terminal-gated dispatch 设计门（2026-10-01；源码候选，真实 PostgreSQL 待 Root 验证）

### 当前事实与目标边界

当前 Scheduler callback 以 occurrence 的幂等 key 领取 `bff_idempotency_receipt`，冻结 launch snapshot 后在 HTTP 请求内直接调用 Agent；匹配的 2xx 随即把 receipt 固化为 202。该 202 只证明一次 Agent admission HTTP 成功，不是 Run terminal。不同 occurrence 使用不同 receipt 与 run id，却共享 `scheduled:<task_id>` session；上一 occurrence 已返回 202 但 Run 仍 active 时，下一 occurrence可以再次跨 Agent。Chat 的 Conversation/Message/outbox/AG-UI gate 不拥有 ScheduledTask，不得用隐藏 Conversation、伪 Message 或 public ledger 复用来掩盖缺口。

现 `deleteScheduledTask` 在同事务先写Scheduler delete outbox、再物理 `DELETE bff_scheduled_task`；目标不得偷改为soft-delete。执行串行身份因此由独立 `bff_scheduled_agent_scope` 持久锚定，task删除后scope/head/cursor仍可恢复，且不对task建FK。BFF ScheduledTask capability唯一拥有该scope、dispatch与Agent Chat source terminal内部ledger。callback原子冻结snapshot、创建scope/入队并固化receipt202；后台复用现runtime生命周期，不新增进程、Redis权威事实、公开协议或Agent wire。只有受信durable terminal或确认从未跨Agent的failed释放active。Agent4 scope未来是第二道防线，不是当前实现前置，也不猜测未发布busy code。

### Root AGENTS 第 8 节放置表

| 项                | 结论                                                                                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner             | `kokoro-bff` ScheduledTask capability唯一写scheduled execution scope/head/source ledger；Scheduler仍拥有occurrence/outbox，Agent仍拥有Run与session级Chat source。                                                                        |
| 当前事实          | receiver `src/http/routes/scheduler.ts`；receipt现port/repository；task delete在`scheduled-task-repository.ts`物理删row；Agent reader从`/v1/sessions/{session}/events`读取session级连续seq。现callback内Agent I/O且无跨occurrence head。 |
| 目标职责          | callback只验证并原子持久接纳；scope保存task删除后仍稳定的active identity与session cursor；dispatcher发送scope active或最早待选row；terminal consumer无过滤地连续记录session source并只以精确active run terminal释放。                    |
| 目录方案A（淘汰） | 扩展Chat outbox/AG-UI：强迫Scheduled伪造Conversation/Message或污染public ledger。                                                                                                                                                        |
| 目录方案B（不足） | 仅dispatch+source两表并每次锁`bff_scheduled_task`：task物理删除后没有稳定门，restart worker无法证明同task active/head；per-run cursor也会错误跳过同session历史。                                                                         |
| 目录方案C（采用） | Scheduled专用scope anchor + dispatch + session source ledger三表；scope `(tenant,task)` 唯一、无task FK，保存active dispatch/run及session cursor/consumer lease。位于现Scheduled capability，不新一级模块/进程。                         |
| 粒度              | receipt repository继续管理callback claim；新增scheduled repository集中scope/head/source事务；launch runner与terminal runner分开，source adapter独立于AG-UI映射/过滤。                                                                    |
| 依赖              | domain/application不importPG/HTTP/generated；adapter实现port。禁止Agent DB、跨owner SQL、Chat repository、Redis head或公开AG-UI投影。                                                                                                    |
| 数据/API          | canonical BFF SQL新增三表；public OpenAPI、Scheduler webhook、Agent3 wire不变。callback202=durable acceptance。                                                                                                                          |
| 删除项            | 删除receiver同步Agent POST和按其响应settle路径；不保留双轨/fallback；task delete仍物理删除且现Scheduler delete outbox恢复不依赖新scope。                                                                                                 |
| 验证              | 精确unit/integration/architecture/schema路径如下；真实PG双连接、restart、物理delete、session source分页/rollback；完整Node22门。                                                                                                         |

### canonical SQL、active与队列顺序

`bff_scheduled_agent_scope`：`tenant_id,task_id`复合主键，稳定`session_id=scheduled:<task_id>`、`subject_id`，`active_dispatch_id/active_run_id`可空且同空同非空，session级`source_high_watermark`，consumer poll/lease/fence/failure字段及timestamps。无`bff_scheduled_task` FK。scope只由首次合法callback原子创建；重复必须精确subject/session一致。task物理删除不删除scope。

`bff_scheduled_agent_dispatch`：`dispatch_id`、tenant/task、canonical occurrence、固定九位纳秒`occurrence_order_key`、冻结identity/request/idempotency/digest/run/payload、状态`pending|leased|retryable|admitted|terminal|failed`、sticky unknown、lease/fence/attempt/backoff与时点。三张正式表均不使用 `FOREIGN KEY`/`REFERENCES`；scope存在、身份一致、active引用与orphan防护都在同一事务先锁scope后重验。唯一 `(tenant,task,occurrence)`、`(tenant,task,idempotency_key)`、`(tenant,run)`。ready/lease/head partial indexes使用tenant/task/order/id。

scope的active身份与待选排序分离：无active时，在scope锁下从已持久接纳的nonterminal rows按`(occurrence_order_key,dispatch_id)`选最早并原子固定`active_dispatch_id/run_id`；一旦A已leased/admitted/unknown，后来才到达且时间更早的B只能入队，绝不替换A。A terminal/确定never-admitted failed清active；下一次再从剩余accepted rows按纳秒顺序选择。该规则承认协议边界：不为尚未到达BFF的任意更早occurrence无限等待，但不会让迟到row抢占已经固定的active。

`occurrence_order_key`由已验证RFC3339Nano UTC构造固定`YYYY-MM-DDTHH:mm:ss.nnnnnnnnnZ`，不降为PG微秒/JS毫秒。Scheduler正常`overlap=forbid`不会并发投不同open occurrence；BFF仍严格排序已accepted集合。

### session级source cursor与ledger

Agent endpoint返回整个`scheduled:<task_id>` session的连续seq，不是per-run流。`bff_scheduled_agent_source_event`以`(tenant_id,task_id,source_sequence)`为主身份，并唯一约束同scope `source_event_id`；保存`source_run_id`（required nonempty）、owner、digest、occurred_at、event kind及完整受信payload。scope的`source_high_watermark`是session级唯一cursor。

新增精确adapter `src/infrastructure/clients/agent/scheduled-terminal-source.ts`：复用现HTTP envelope与`classifyAgentEventPage`的session/连续seq校验，但不调用`mapAgentEvent`，不做AG-UI kind/frame过滤；每一source在任何业务判断前保留`run_id/event_id/seq/payload`。terminal repository先按session cursor写完整page：历史run、active run、零public-frame kind都lossless入ledger。只有`sourceRunId===scope.active_run_id`且严格terminal payload才结算active；foreign/historical terminal只推进合法session ledger，绝不改active。event identity/digest冲突、gap或混批任一错误整批回滚cursor/ledger/dispatch。

### 事务、锁序、delete与恢复

锁序：callback receipt→task row（验证仍存在/active/frozen）→scope→dispatch；delete保持现task→Scheduler control outbox后物理删除，永不触碰execution scope，因此无反向锁。worker统一scope→dispatch按order→source按seq；不反锁task/receipt。callback与delete竞争由task row决定：callback先锁并commit则occurrence已接纳且随后delete不影响；delete先commit则callback找不到task并按现错误拒绝。

callback enqueue+receipt202同事务；回滚同生同灭。相同scope/digest重放202不重复；冲突409。pause/delete只阻止未来callback/未来Scheduler注册，已accepted的pending/leased/retryable/admitted不删除、不failed、不取消、不释放。现Scheduler delete outbox仍由其独立表快照恢复，和新scope无FK/调用依赖。

pending/leased/retryable/admitted都阻塞后继。strict 2xx仅admitted。timeout/连接中断/5xx/408/425/429/坏2xx/expired lease置sticky unknown，同run/request/key恢复；unknown后4xx不能证明历史未接纳。仅send前失败或owner明确且从未unknown的not-admitted可failed清active。terminal可早于ACK；late settlement因token/fence/status不符no-op。重启扫描scope active、pending/retryable/expired leased、admitted due poll；Redis仅wakeup。外部HTTP不持DB锁。

terminal/failed dispatch、scope、source与receipt保留用于审计/重放。TTL和task物理删除后的最终引用释放未裁决；D1-D3不purge、不cascade、不回收scope。

### 精确实现文件集

现文件：`database/schema.sql`；`src/http/routes/scheduler.ts`；`src/bootstrap/runtime.ts`；`src/infrastructure/postgres/{repositories.ts,scheduler-dispatch-receipt-repository.ts}`；`src/application/ports/{bff-business-store.ts,scheduler-dispatch-receipt-repository.ts}`；`src/infrastructure/clients/agent/{index.ts,http-wire.ts,projection.ts}`仅在抽取无过滤page parser确有必要时修改；`test/{scheduler.test.ts,scheduler-dispatch-receipt.integration.mjs,business-store.integration.mjs,schema-governance.test.mjs,architecture.test.ts,agent-http-wire.test.mjs}`；本四docs。

Root批准后新增：`src/domain/scheduled-task/agent-dispatch.ts`；`src/application/ports/scheduled-agent-dispatch-repository.ts`；`src/application/scheduled-agent-dispatcher.ts`；`src/application/scheduled-agent-terminal-consumer.ts`；`src/infrastructure/postgres/scheduled-agent-dispatch-repository.ts`；`src/infrastructure/clients/agent/scheduled-terminal-source.ts`；`test/scheduled-agent-dispatch.test.ts`；`test/scheduled-agent-dispatch.integration.mjs`；`test/scheduled-agent-terminal-source.test.mjs`。无新依赖/generated/进程/顶层目录。

### 真实 PostgreSQL RED→GREEN矩阵

1. 同occurrence双callback：同digest一dispatch/同202，冲突全rollback。2. enqueue/receipt finalize故障同生同灭。3. scope首次创建与物理task delete竞争：callback先赢则delete后scope/head仍恢复；delete先赢则无queue；Scheduler delete outbox照常恢复。4. 无active时纳秒反序accepted rows选最早。5. 已固定A leased/admitted时迟到更早B不替换A；A结算后B才可成为active。6. claim↔claim、terminal A↔next claim用精确backend PID barrier，单赢家无死锁。7. session已有old run seq1..N，新active从N继续；不从1/per-run重置。8. 一页交错historical/active/foreign run与零frame kinds全部ledger，只有active terminal释放。9. duplicate/gap/event或run identity冲突/混批整批回滚scope cursor、ledger、dispatch。10. unknown/expired同run/key恢复，unknown后4xx不释放；never-sent只fenced结束本次lease，保持active与sticky unknown并以同run/key重试。11. terminal早于ACK及late settlement no-op。12. pause/delete与pending/admitted并发不取消不释放；restart无task row仍poll/terminal/next。13. 两scope无全局HOL。14. Redis通知丢失仍由PG scan收敛。15. 无purge时无孤立source，未来purge须先裁决引用。

### R25-P1 返修冻结：跨页 drain、最终预算、并行与可观测性

R26补充唯一source digest表示：`src/application/scheduled-source-event-digest.ts`对递归排序对象键后的JSON计算SHA-256，source adapter与repository共同调用；repository在任何ledger写入前重算并比较，不保留client侧旧算法或alias。格式正确但内容错误的64位hex、重复sequence及event-id碰撞均须整批零写。

R24 的51项真实PG矩阵只证明当时用例通过，不关闭独立复审发现的五组P1。R25仍沿现Scheduled capability、三表、两个runner与两个port收口，不新增进程、公开/owner wire、目录、依赖或兼容层。精确代码面限定现文件：`scheduled-agent-dispatch-repository.ts`、两个scheduled runner、两个scheduled port、`runtime.ts`及现三个scheduled tests/已授权integration fixtures。

terminal source采用两阶段drain：page内识别active terminal后，dispatch先持久为terminal但scope继续保存该dispatch/run作为drain anchor；`exhausted=false`绝不清active。consumer允许terminal anchor继续按session cursor读取后续page，跨页foreign/history/零frame全部lossless；同active run在terminal后的source仍整批拒绝。只有受信连续页`exhausted=true`且本scope已有terminal anchor时，才在同事务清active并允许下一head；重启时即使无后继也从terminal anchor继续drain。

claim与consumer claim在COMMIT前必须同连接再次读取`clock_timestamp()`并以最初monotonic observation扣除查询/事务/reserve；预算不足回滚，不提交lease。COMMIT后到runner网络前若预算耗尽，调用Scheduled私有port的fenced `releaseNeverSent`，只对当前lease token/fence并只结束本次nonce/fence lease，恢复同run/key retryable而不伪造新的unknown；历史`admission_unknown_seen`保持sticky，never-sent不得清active/head；真正开始I/O后的timeout/坏响应继续sticky unknown，late CAS保持no-op。

runner在单进程内使用有界scope worker pool：每轮最多`concurrency`个并行claim/执行任务，repository的scope锁与active lease仍保证同scope串行；慢scope A不阻塞B。`stop()`停止新claim并等待当前有限任务drain，不创建无限Promise/interval任务。repository/runner周期错误不得空catch；用runtime注入的正式结构化log hook记录operation/result/error_code/attempt/backoff，不记录payload/token。周期失败按有界指数退避+jitter恢复。

所有`workerId/pollIntervalMs/leaseDurationMs/maxAttempts/pageSize/concurrency/retryBaseMs/retryMaxMs/retryJitterPercent/settlementReserveMs`在构造时做精确类型、safe integer、非空、上限及关系校验；`leaseDurationMs > settlementReserveMs`，page/concurrency有固定有限上限，jitter后的delay仍不超过max。

R25真实RED→GREEN必须分别覆盖：enqueue与receipt在故障注入下同回滚；callback↔delete两个锁赢家；精确backend PID的claim/terminal/consumer barrier；非零N cursor到N+1；active terminal在非末页、跨页foreign与最终exhausted释放；duplicate/gap/event id/digest/run冲突整批零写；expired lease与COMMIT后never-sent release；两个scope中慢A不挡B且同scope单赢家；周期repository失败被记录并按有界退避，stop完整drain。

## BFF-EXECUTION-HEAD-D0：首次快照的 durable execution head（R27 设计候选，未实施）

### Owner、版本与边界

BFF Chat capability唯一拥有public execution-head projection、FIFO dispatch head、queued cursor与pending集合投影；Agent仍拥有Run与HITL事实，Web只消费发布artifact。当前submit已同事务写Message/outbox，但enqueue不推进public cursor，snapshot只在`latest_run_id=expected_run_id`时返回active，故accepted到`RUN_STARTED`前身份缺失。

Root裁决首次上线前采用public **4.0.0 corrective单路径**：保留原`/v1`路径，但artifact只发布breaking新schema；ROLE2当前3.0是正式基线而非兼容版本。删除旧`active_run` schema/generated consumer，不建`/v2`、双字段、双route、fallback或Web双读。BFF owner先发布并固定artifact commit/version/digest，Web再单路径repin并做fresh组合激活。未来user retry为BFF 4.1独立目标，且必须等待Agent实际发布retry；Agent HITL 4.0候选尚未落machine contract，不能因版本号相同冒称能力完成。

head是同tenant/conversation按`(conversation_dispatch_seq,outbox_id)`最早且status为`pending|leased|retryable|admitted`的显式outbox row。queued=durable accepted且未见匹配RUN_STARTED（2xx admitted仍queued）；active=expected/latest/head一致且pending集合为空；waiting=当前完整集合非空且尚未提交decision；resuming=Agent已durable受理该revision的decision、集合仍完整保留并标记submitted，直到下一owner revision。terminal或明确never-admitted failed释放A后，同事务选择B并写B的queued CUSTOM/cursor；sticky unknown保持A。

### 真实writer锁图与唯一全局顺序

现代码不是stream-first：

- submit：`PostgresAgentDispatchOutboxRepository.commitChatTurn`先锁/创建Conversation，再写Message/outbox并注册stream；
- delete/cancel creation：`PostgresChatRepository.deleteConversation`先更新并锁Conversation，再删Artifact、停止stream、更新dispatch/Message并写cancellation outbox；
- artifact/terminal：`PostgresAgUiProjectionRepository.commitProjection`在artifact场景先调用`lockArtifactConversation`，再锁stream/dispatch并写Message/Artifact/ledger；
- claim/failure/exhaustion：`claimAgentDispatchOutbox`、`failOneExhaustedHead`、`markAgentDispatchNotAdmitted`/`markAgentDispatchFailedInTransaction`当前先stream/dispatch，失败再写Message；
- consumer/GC：`PostgresAgUiConsumerRepository.claimConsumers`,`renewConsumerLease`,`markConsumerProgress/Retryable/Blocked`,`releaseConsumer`,`collectGarbage`当前只从stream起锁；
- `markAgentDispatchAdmitted/Unknown`是纯dispatch CAS；独立`PostgresAgentCancellationOutboxRepository`只写冻结cancellation row，不回写Chat head。

目标唯一顺序为Conversation→stream→dispatch→Message/Artifact/source/public ledger。无锁发现候选后先锁Conversation。单Conversation锁已经完全串行该conversation的tail，其后无需内部排序；跨conversation claim/consumer/GC batch必须先按`(tenant_id,conversation_id)`一次锁完本批全部Conversation，再按同序进入任一stream/tail，禁止`Conversation A→stream A→Conversation B`。新Conversation由本事务INSERT持有后才创建stream。纯dispatch ACK可停在dispatch；一旦结算head/Message必须走完整顺序。网络I/O不持锁。stream-first方案会反转现submit/delete/artifact授权锚点，改面更大，淘汰。

queued CUSTOM（候选`kokoro.run.queued`）只含`run_id`和正十进制`dispatch_sequence`，event identity稳定派生自outbox。submit在一个Conversation-first事务写Message、outbox、queued frame与cursor，任一失败全回滚；重复submit/claim/handoff不重复推进。RR snapshot在授权Conversation后从同一快照读取head、stream、cursor和pending集合；非法组合fail closed。GC保护当前watermark、queued transition与pending revision引用。

### R43 FIFO/RR 收敛：Run terminal 不等于会话流结束（目标，未实施）

`terminal_run_id`是最近已投影Run的历史terminal marker，不是Conversation关闭标志。A terminal与B head/queued CUSTOM/cursor必须同事务交接；B处于pending/leased/retryable/admitted任一状态时，即使stream仍记录`terminal_run_id=A`，也不得据此结束SSE。replay在同一一致性读边界取得授权范围内的durable head、ledger watermark与历史terminal事实，向现内部page提供head-aware的有效结束结果：有head时不得返回会导致route判terminal的结果；无head且存在合法terminal事实时，先送完该页及后续已持久化frame，到ledger head才可按现规则结束。snapshot仍在授权Conversation后的同一RR事务读取head/state/watermark；不同HTTP请求不承诺共用一个数据库快照。

这是BFF现replay查询/结果投影的职责，不新增公开结束字段、Redis gate或第二协议；保留历史dispatch terminal/failed对旧run新source的拒绝与exact duplicate幂等规则，不为保持连接伪造B的RUN_STARTED、提前claim/launch B或清除历史terminal事实。刷新、重启及`Last-Event-ID`原样续读同一durable ledger；poll/byte/frame/总等待预算与取消保持有界。后继RED须用真实reader barrier与生产terminal writer证明旧快照只见A/旧cursor、新快照只见B queued/新cursor，并证明重启后从B queued opaque cursor等待正式B start/terminal、不因历史A marker提前EOF、不重复queued frame。

R44 内部第一源码片（候选，待 Root 集成验证）：本仓唯一 writer WIN02 只修改现 outbox、AG-UI projection、consumer、Chat PostgreSQL repository 与内部 ChatRepository port。submit 的 queued CUSTOM/public cursor 与 Conversation、Message、outbox 同事务；terminal/never-admitted failure 结算后在原事务选择下一 FIFO head 并投影稳定 queued identity。多 Conversation batch 先按 tenant/conversation 锁完父行，再进入 stream/tail；纯 dispatch ACK 保留现 CAS。replay 单 SQL 快照关联 raw FIFO head、owner/stream subject、watermark 与历史 terminal；有 head 时内部 page 不宣告终流。授权后 RR snapshot 增加内部 typed queued/active head，GC 保留所有 nonterminal dispatch 的 queued cursor，并仅豁免 BFF-owned queued frame 的 RUN_STARTED 引用要求。旧 source/terminal/failed、duplicate、sticky unknown、DB-clock/lease fence 守卫保持；不制造下一 Run start。本片没有完整 HITL state/revision，既有 activeRun 仅供锁定的 public3 service 使用，未新增 wire alias。Agent e977923 / HTTP4 已发布；内部冻结后由同 owner 紧接三面 D0 与完整消费，不把此片当作公开4/完整 pause 完成。

### HITL full-revision hard dependency

awaiting虽不在Agent Run CRITICAL outbox，但emitter会先`_persist_chat`，Chat projection已持久化interaction及`pending_tool_ids/schema/result`，所以durable awaiting入口存在。缺口是现source没有可证明全部pending解除的完整revision；普通tool返回/control applied、HTTP resume 2xx或任意activity均不等于resume完成。

BFF等待Agent owner发布完整、带revision的pending collection及run/session/fence语义。BFF只以每个受信revision整体替换投影，不发明逐项opened/resolved事件，不自行merge partial。浏览器ACK不改变状态；只有Agent durable source确认已受理当前revision的decision，才以revision/fence CAS从waiting进入resuming，同时保留完整集合并标记submitted，阻止对同revision重复decide。只有owner确认effective native resume已consumed并给出下一完整revision才整体替换：新集合非空表示re-pause并进入waiting，明确空且run非terminal才active；run cancel/terminal按owner事实关闭投影并结算head。unknown ACK不变，重复revision/source no-op，revision倒退、同revision异内容、foreign/stale/fence冲突整批回滚，restart从PostgreSQL最新完整revision恢复。

public `pending_pauses`必须与head/state（含resuming submitted marker）/watermark来自同一RR快照且对应最新authoritative full revision，不能固定`[]`；waiting与resuming都返回同一集合。具体item/action字段、resuming/native-consumed映射与retention等待Agent HITL artifact；该hard依赖未交付前不落BFF machine/SQL/production。

### 下一代码片精确文件集（本轮未授权写）

需要修改的精确路径：`contract/openapi/v1/openapi.yaml`、`contract/README.md`、`README.md`、`database/schema.sql`；`src/contracts/chat.ts`、`src/application/ports/chat-repository.ts`、`src/application/chat-service.ts`；`src/application/agui/project-chat-event.ts`（待Agent artifact后严格解析full revision）、`src/application/agui/project-session-events.ts`（authoritative revision/resuming projection）、`src/application/agui/ports/agui-projection-repository.ts`；`src/infrastructure/postgres/agent-dispatch-outbox-repository.ts`、`agui-projection-repository.ts`、`agui-consumer-repository.ts`、`chat-repository.ts`、`conversation-artifact-projection.ts`；`src/bootstrap/server.ts`（public-share snapshot也不能继续固定`pending_pauses:[]`）。现`src/http/routes/chat.ts`只透传ChatService snapshot，不构造旧shape，预计无需修改但须contract test证明；`src/interfaces/http/agui/sse.ts`只replay durable frames，无需修改；`agui-consumer-registration.ts`仍由Conversation-first caller包围，无需修改；`agent-cancellation-outbox-repository.ts`不触Chat事实，不修改；retry留4.1。测试精确为`test/chat-service.test.ts`、`test/chat-facts.integration.mjs`、`test/agui-projection.integration.mjs`、`test/agui-http.integration.mjs`及现contract/schema/architecture tests。

### 真实PostgreSQL RED矩阵

1. submit四事实同生同灭、重放不增cursor；2. pending/leased/retryable/admitted均为同head queued；3. matching RUN_STARTED原子active，foreign/stale start零影响；4. authoritative full revision集合、Agent durable decision受理后waiting→resuming且同revision禁止重复decide、browser/unknown ACK零影响、native-consumed后空集合active/新pause revision waiting、cancel/terminal、revision replay/fence/restart严格一致；5. A active+B queued只返回A；6. submit↔claim、delete↔terminal、artifact↔failure的Conversation持锁双连接barrier；7. 跨conversation claim/consumer/GC相反候选顺序先锁全Conversation，无死锁/错head/孤立事实；8. terminalA↔handoffB只能观察A或B及匹配cursor；9. never-admitted failed释放而sticky unknown不释放；10. late ACK/terminal/source不回退新head；11. tenant/owner/project/subject drift fail closed；12. SSE恰好一次重放、分页/byte边界与GC保护revision/queued引用。

## BFF-FIFO-ATOMIC：Conversation terminal-gated dispatch 设计门（2026-10-01；源码与真实PG门已验证）

租约时钟规则：所有可能等待行锁的 dispatch/consumer claim、续租与结算，先取得目标行锁，再在同一连接读取一次 PostgreSQL `clock_timestamp()` 作为该次决定的唯一 `db_now`，最终 CAS 以参数比较 expiry。claim 在返回前再次以数据库时钟确认剩余预算严格大于零；零预算回滚且不返回。terminal projection 只验证 durable run/subject/head/fence，不错误附加 HTTP dispatch lease expiry。

正式Agent source reader在任何UI frame过滤前保存owner `run_id`为内部`sourceRunId: string|null`；即使该source投影零frame，也以此历史dispatch terminal/failed守卫。非空event/assistant/artifact/frame run必须与sourceRunId一致；明确session级null才不按run守卫，不改变owner wire。

### 当前缺口、owner 与放置

当前 Chat admission 在 enqueue 时把新 run 写入 `bff_agui_stream.expected_run_id`；dispatcher 又把匹配 Agent HTTP 2xx
直接记为 `succeeded`，claim 只把较早 `pending/retryable/leased` 当 barrier。于是第一轮尚未 terminal 时第二轮可以跨 Agent，
并且第二轮 enqueue 已覆盖第一轮 expected fence。目标在现 public 3.0.0 和现 Agent launch/event wire 下实现每个
`tenant_id + conversation_id` 的 terminal-gated FIFO：enqueue 只持久化；claim 最早 head 时在同一 PostgreSQL 事务先安装
expected fence，commit 后才跨 Agent；2xx 只是 `admitted`；受信 terminal source 即使早于 HTTP ACK，也把精确 head 与
assistant/AG-UI/stream 原子结算为 `terminal` 并释放 expected，后继才可安装自己的 fence。

| 项 | 结论 |
| --- | --- |
| Owner | BFF Chat 唯一拥有 Conversation Message、dispatch queue 与 durable AG-UI projection；Agent 继续拥有 Run terminal source fact。 |
| 采用 | 扩展现 Chat dispatch domain/port/dispatcher、Agent delivery client、PostgreSQL outbox/consumer registration/AG-UI projection 与 canonical schema；这些已拥有 immutable launch lineage、lease fence及terminal投影。 |
| 淘汰 | 不建第二 outbox、通用 queue service、Redis gate、进程内 mutex或Web过滤；它们无法与Message/AG-UI原子结算。 |
| Scheduled | 现 `routes/scheduler.ts` 以独立 `bff_idempotency_receipt` 直接 launch `scheduled:<task_id>`，不进入Conversation/Message/Chat AG-UI gate；它仍缺同 scheduled session 的 terminal FIFO，必须作为独立P0任务由Scheduled receiver/Agent source边界闭环，本片不伪称覆盖。 |
| API | public OpenAPI、HTTP 202 receipt、Agent owner wire、generated/vendor与lockfile不变；不偷发queued/retry/required parent或Agent 4 contract。 |

### 状态、结果分类与恢复

目标 dispatch 状态为 `pending | leased | retryable | admitted | terminal | failed`，并新增 sticky
`admission_unknown_seen BOOLEAN NOT NULL DEFAULT FALSE`。delivery port 结果改为内部三分类：`admitted`（严格匹配的2xx receipt）、
`not_admitted`（请求明确未跨网络，或 owner 明确声明未接纳的严格4xx）与 `unknown`。timeout、连接中断、5xx、408/425/429、
invalid/oversized 2xx response 都是 unknown；现 client 把 invalid 2xx/oversize 归 permanent failed 是必须由RED杀死的错误。
expired leased 被重领前先把 sticky flag置true，因为旧 worker可能已跨边界。flag一旦true，任何后续4xx或本地结果都不能清除，
也不能把该 row改failed释放。

只有 `admission_unknown_seen=false` 且当前结果确定 `not_admitted` 时可 `failed`；unknown进入带退避的retryable并保持 barrier。
达到正常快速重试预算且unknown_seen=true时不得走现 `failOneExhaustedHead`。同一 durable row保持retryable barrier与expected，
`available_at`设为现 `agentDispatchRetryDelayMs` cap **30,000ms**；到期重新claim同run/idempotency并向正式owner入口最多POST一次。
现dispatcher每cycle最多16条、每claim单HTTP timeout，故这是跨cycle持久化的paced admission reconciliation，不是一个请求内无界loop。
AG-UI consumer同时按`consumer_next_poll_at`读取受信terminal；2xx可转admitted，terminal先到可直接terminal。告警只是观测，
不算恢复/放行；禁止新run、换key或释放head。unknown=false的本地never-sent若耗尽才可确定failed。

terminal允许从 `leased | retryable | admitted` 进入，但必须匹配当前 expected、最早未终态 dispatch、immutable
run/subject/conversation/assistant lineage及至少一次真实claim attempt。事务用`admitted_at=COALESCE(admitted_at, now)`补全极速run的
接纳时点，再写terminal。后到2xx、timeout、4xx或旧lease settlement都只能因status/lease/fence CAS不匹配而幂等no-op，
不得覆写terminal、重设retryable或重新阻塞。

### 分入口锁序与 source 防线

- admission/delete：先锁 Conversation；enqueue只确保stream/subject存在，不写expected；若继续接触stream/dispatch，不得随后回锁Conversation。
- claim/reclaim：耗尽head探测使用独立短事务，无论重验是否settled都先提交并释放stream锁；普通claim再无锁读取候选identity，按tenant/session确定序锁全部`bff_agui_stream`，再锁并重验最早dispatch。不得把耗尽X的stream锁带入后续A..X claim，也不得先锁dispatch再等stream。只有expected为null或同candidate才安装。
- source projection：先stream，再精确dispatch，再assistant Message；不回锁Conversation，所需owner/status用immutable lineage与已持有行验证。
- pre-admission failure projection：同样stream→dispatch→Message；普通delivery settlement只做精确lease/fence CAS，不取得stream。

terminal事务把 `expected_run_id` 清为null，同时保留 dispatch `terminal` 作为历史run证据。post-terminal保护不能依赖随后会被下一head
替换的current marker：任何source先按tenant/session/run查历史dispatch；若该dispatch已terminal，仅完全相同
owner/event-id/sequence/digest的既有source可幂等跳过，任何新identity、冲突重放或frame都在写前拒绝，且stream source/public
watermark、Message和当前next expected逐字节不变。

### 后续文件与RED矩阵

源码计划：`database/schema.sql`；`src/domain/chat/agent-dispatch.ts`；
`src/application/ports/{agent-dispatch-delivery,agent-dispatch-outbox-repository}.ts`；
`src/application/agent-dispatch-outbox-dispatcher.ts`；`src/infrastructure/clients/agent/outbox-delivery.ts`；
`src/infrastructure/postgres/{agent-dispatch-outbox-repository,agui-consumer-registration,agui-projection-repository}.ts`。
不新建模块；若需越出这些现职责先回设计门。

tests-only RED使用现 `test/agent-dispatch-outbox.test.ts`、`test/architecture.test.ts`、`test/schema-governance.test.mjs`、现 Chat
PostgreSQL/AG-UI integration文件（实际文件名由下一阶段盘点后锁定）：覆盖两轮同Conversation首轮2xx仍阻塞；terminal早于ACK从
leased/retryable原子结算且迟到settlement no-op；unknown sticky后4xx不放行；expired lease置unknown；invalid2xx/oversize为unknown；
unknown快速预算耗尽后30秒paced同run reconciliation且consumer durable wake并行；pre-send/首次严格4xx才failed；terminal清expected后次head claim；旧run terminal后
注册新expected仍拒新source且exact duplicate幂等；双worker无越序/双claim、跨Conversation并行、tenant/subject/project隔离及事务
rollback。Root负责真实PG/Redis；本阶段不运行测试、DDL或设施。

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


## BFF-RETRY-DESIGN：失败 assistant 的正式原消息重试（2026-09-30；仅设计，未实施）

### 当前态、owner 与前置阻塞

当前基线是 BFF main `ccb8e144d72e35d90f9edc23f8b3ed0c82fde98d`。public OpenAPI 仍是 `2.0.0`，
`/v1` 下只有 `POST /v1/sessions/{id}/messages` 的新消息提交；不存在
`POST /v1/sessions/{session_id}/messages/{assistant_message_id}/retry`路由、重试 application command 或重试事务。
现有 submit 会在一个 BFF PostgreSQL 事务中新建 user/assistant/run/outbox 并重置 AG-UI consumer
fence；这不是原消息重试，Web 重发相同 content 也不得冒充本命令。

BFF 继续是 Conversation、Message、Share、Agent dispatch outbox 与 durable AG-UI ledger 的唯一 writer。
Agent 是 Run、checkpoint、native chat history 与重试 attempt 语义的 owner。目标 BFF 命令必须复用原 user
Message，只新建 assistant/run/outbox；但当前 Agent `f3be3b97dd67df69ed3c6cb88c59f3bc2db97703`
尚不支持该语义。Root 的无网络复现是 `SAME_RUN_REPLAY=PASS`、
`SAME_USER_NEW_RUN=ChatIdentityConflict`、`CURRENT_NATIVE_IDS_DUPLICATE_HUMAN=2`：Agent 在 build 前保存原
`message_id`，新 run 会命中现有 `(tenant,message_id)` 全行 identity 冲突，且当前 LangGraph reducer 会为
两个 run 保留两条 native HumanMessage。`RunRequest.message_id` 存在不能证明可重试。

因此生产实施前的强前置是：Agent owner 先发布不可变的新 HTTP contract/provenance，
`RunRequest` 中用 typed `retry_of_run_id` 表达完整 attempt 重试，并保证同 scoped thread 下的稳定
user origin、native pre-turn checkpoint、新 run fence 和单一 HumanMessage 语义。具体 owner commit、版本、digest
尚未因实现而生成。Agent `4.0.0` 已是 owner 四文档冻结的目标设计候选，但尚未实施、发布，
因而没有可 pin 的 commit/OpenAPI/provenance digest，也不是当前可调用契约。
本仓不先写 fallback、不创建替代 user id、不放宽 Agent identity，
也不用“只重试部分 phase”或重分类 failure 缩小目标。

### §8 放置表

| 项 | 结论 |
| --- | --- |
| Owner | `kokoro-bff` Chat 能力是 public retry command、Message/outbox/AG-UI 事务的唯一 writer；`kokoro-agent` 唯一拥有 Run/checkpoint/native history 的 retry-attempt 语义。 |
| 当前事实 | 入口在 `src/bootstrap/server.ts` 与 `src/http/routes/chat.ts`；授权预检在 `chat-authorization.ts`；命令在 `chat-turn-service.ts`；原子写在 `agent-dispatch-outbox-repository.ts`；canonical 表是 `bff_conversation`/`bff_message`/`bff_agent_dispatch_outbox`/`bff_agui_stream`。BFF 还有第二个 Agent `/v1/runs` producer：`src/http/routes/scheduler.ts` 通过 `src/infrastructure/clients/agent/launch.ts` 生成 normal Scheduler launch，并由 `scheduler-dispatch-receipt-repository.ts` 持久化/恢复快照。现无 retry route。 |
| 目标职责 | 对当前 IAM admission 下的本人 private Conversation，把最新、已验 Agent failure 且 `retryable=true` 的 assistant 变为一个新 attempt；公开 API 只是指定 retry target 的 command，不接受内容或配置。 |
| 目录方案 | **采用**：扩展现有 Chat route/service/outbox repository/domain payload，因为它们已共同拥有 submit 的锁、序列、幂等和 worker 边界。**淘汰**：新建 `retry/` 目录或 retry 表，会复制 Chat 状态机与 receipt。**淘汰**：改写旧 run/outbox 或新建伪 user，会破坏历史、identity 与审计。 |
| 粒度 | 扩展现有文件，不新建目录。retry 是 `ChatTurnApplicationService` 的第二个 command，事务是现 repository 的第二个 atomic method；不抽象 BaseRepository/command bus/通用 retry helper。 |
| 依赖 | HTTP 只依赖 Chat application port；application 只依赖 domain/port/stable-id；PostgreSQL 实现事务；worker 事务外调用 fixed Agent generated contract。BFF 中 Chat outbox delivery 和 Scheduler receiver 是同一 Agent owner contract 的两个 sender，必须同片切换，不把 Scheduler 留给“后续其他仓”。禁止 BFF 读 Agent DB/checkpoint，禁止 Web 直连 Agent，禁止用 generic HTTP receipt 拼接业务事实。 |
| 数据/API | public `3.1.0`、HTTP `/v1` 不变；新 POST 只接受 `{}` 与唯一 `Idempotency-Key`，202 复用现 receipt。零 BFF DDL；复用 Message/outbox/stream 并在一个事务中新建 assistant/run/outbox 和 consumer fence。tenant/actor 只来自受信 admission。 |
| 删除项 | Agent 发布后，新 HTTP owner pin 在同一切片替换当前 `f3be…` HTTP vendor/generated 来源，删除旧 HTTP vendor 目录；独立 `delivery.created` 的 `486adb…` event-protocol pin 保持。不保留无 `retry_of_run_id` 的 wire，不接受旧 Chat payload v2 或 Scheduler receipt v2，不增 alias/fallback。 |
| 验证 | 先机器契约与纯测试 RED，再在固定 owner artifact 上 GREEN；Node 22 运行 contract/architecture/unit/build，Root 独占随机 PostgreSQL fixture 串行运行真事务/HTTP/worker/Agent owner 矩阵。本文档阶段不运行这些命令。 |

### 命令与状态机

目标 endpoint 是
`POST /v1/sessions/{session_id}/messages/{assistant_message_id}/retry`。它复用现 private `scope` / `project_ref`
语义和 `chat.message.create` 能力描述，不新增 IAM role/permission。当前实际 enforcement 是 Web→BFF service
boundary、Bearer online session verify、fixed tenant，以及 Conversation/project/target 的 private owner 检查；
`x-kokoro-permission` 是契约能力描述，不冒称当前 session verify 已对该 action 做独立 grant 判定。
retry 不扩大 create 授权范围。

首次接受必须同时满足：

1. target 是当前 tenant/owner/project 下 active Conversation 的最新 assistant Message，`status='failed'`，
   `run_id` 非空，且严格 Agent failure profile 为 `{source:'agent',retryable:true}`；只有现有
   `model_unavailable` / `dependency_unavailable` 可达到该状态。
2. 原 source outbox 精确绑定同 tenant/conversation/subject/user/assistant/run，状态必须是 `succeeded`；
   其严格解析后的 content、model、agent、thinking、selected Skill source refs、MCP servers、project 与原
   user Message 完全一致。请求 body 不能补值或覆盖它们。
3. 没有之后的 pending/leased/retryable dispatch，没有 pending/streaming assistant，且 stream
   `expected_run_id = terminal_run_id = target.run_id`。不要求 `latest_run_id=target.run_id`：Agent 可在
   `RUN_STARTED` 前终止；也不要求 `consumer_state='stopped'`。未终态的 HITL/approval 自然因
   expected 与 terminal 不等而 fail closed。

成功后保留原 user、旧 failed assistant、旧 run 和旧 outbox；新建一条 pending assistant、一个 run、
一条 pending outbox，并让 stream 期待新 run。新 outbox 继续指向原 `user_message_id`，但使用新
request ID、当前 admitted actor 和新 identity assertion；Agent launch 复制原严格 payload 中的冻结参数，
只替换新 request/run 字段并增加 owner 发布的 typed `retry_of_run_id=old_run_id`。网络调用仍在
commit 之后由 worker 执行，worker 每次交付都使用当前有效授权，不复用旧 Bearer/token。

### Agent 4.0 双 sender 与持久 envelope 原子切换

Agent 4.0 目标 `LaunchRequest` / `LaunchBody` / `RunRequest` 的 `retry_of_run_id` 是 **required nullable**：
normal launch 必须编码 JSON `null`，retry launch 必须编码非空 parent run ID；缺失、空串、错类型、
自引用和 unknown field 都 fail closed。BFF 当前有两个 `/v1/runs` producer，必须在一个 consumer
cutover 中同时更新：

1. Chat `AgentOutboxDelivery` 只交付已持久的严格 launch。normal `ChatTurnApplicationService.submit`
   也必须显式写 `retry_of_run_id:null`；正式 retry 写 target 旧 run ID。
2. BFF internal Scheduler receiver 的 `buildScheduledAgentLaunch` 永远是 normal producer，必须显式写
   `retry_of_run_id:null`。`src/http/routes/scheduler.ts` 的发送和恢复必须只接受该新快照，
   不能在 Agent 4.0 后继续发缺字段的 3.0 JSON。

Chat persisted payload 从 `AGENT_DISPATCH_SCHEMA_VERSION=2` 升为 **3**。v3 envelope 仍只有
`schema_version` / `launch` 两个顶层键，但 `launch.retry_of_run_id` 为 required nullable；strict parser 拒绝
v2、缺字段、extra 和非法 parent。normal/retry 的 canonical request material 都必须包含该值；仓储层再校验
request/run/session/message/content、row user/assistant/run、retry parent 与 operation-target digest。public receipt 形状不变，
但其 run/user/assistant 三个 identity 必须来自同一个已验 v3 outbox row，不从 launch response 重组。

Scheduler 的 `bff_idempotency_receipt.response_body` envelope 从实际 **2** 升为 **3**。v3 parser 对
envelope、snapshot、launch、Agent body、receipt 和 trace 每层都校验 exact key set；只接受
`retry_of_run_id:null`。恢复时必须重验 canonical occurrence identity：`run_id` / `user_message_id` /
`assistant_message_id` / `identityAssertionRef`、`session_id=scheduled:{taskId}`、`request_id`、tenant/actor 绑定与
snapshot/receipt 必须相等。v2 和“新版 parser 给缺字段补 null”都明确拒绝。

切换顺序固定为：Agent 4.0 machine/runtime/schema 发布但不 activate → BFF 在同一切片
repin/generate 并更新 Chat normal+retry、Chat v3 parser/worker、Scheduler normal sender+v3 receipt parser → 扫描
BFF 其他 `/v1/runs` sender 为零漏项 → Web 固定 public 3.1 → Root 协调运行组切换。Scheduler
在 BFF 同片，不是下一个独立仓阶段。

本设计不重写或删除共享/用户 v2 数据。Root 验收使用自有 fresh fixture；已有受管运行组在
activate 前必须另行决定“新环境 fresh”或“先有界 drain 所有非终态 Chat v2 outbox / Scheduler v2
receipt 再停机切换”。旧 v2 即使终态也不会被 v3 parser 当作可重试/replay 事实；该历史幂等/
retention 生命周期是 activate 前必须由 Root 与 owner 明确的未决依赖，不在本 docs 片擅自清理、
升级或延伸为 scope/会话删除 SQL。

### 原子幂等、并发与失败恢复

retry 使用现有 `bff_agent_dispatch_outbox` 的
`(tenant_id,conversation_id,idempotency_key)` 唯一约束做业务 receipt，不使用
`bff_idempotency_receipt`。`src/bootstrap/server.ts` 必须把新 route 加入 `durableChatAdmission`，否则 generic
receipt 的 pending/commit 崩溃窗口会在业务事务已提交后锁死恢复。不宣称 generic receipt 与 Chat
事实原子；本命令的 receipt 权威来源只是同事务的 outbox row。

语义 digest 固定包含 operation=`chat.message.retry`、admitted tenant/subject、conversation、project scope 与 target
assistant ID，不包含每次请求的 request ID/token。在 ACL、project、Conversation owner 和 target visibility
成功后，事务先查同 key：同 operation/target/digest 直接返回已提交的
`{run_id,user_message_id,assistant_message_id}`，必须早于“target 已不是最新/stream 已换成新 run”
等动态拒绝。这保证 commit 后 HTTP reply 丢失可恢复。同 key 用于 submit、另一 target
或不同 digest 返回冲突。Conversation row lock 使并发首请求串行；后到者只能看到已提交
outbox 并回收同 receipt，不会创建第二 attempt。

首次命令在单一 PostgreSQL 事务中执行详细锁序与 rollback 规则，以 DATA_MODEL 本任务章节为准。
新 assistant 只占一个 `message_seq=MAX(message_seq)+1`；新 outbox 的 `conversation_dispatch_seq` 复用该值，
不为原 user 再占序列。consumer registration 在同事务增加 version/fence、清理旧 lease 并指向新 run。

### 后续精确文件门（现在不授权源码写入）

当前可执行写集仍只是本任务四份文档。Agent 4.0 目标设计已冻结，但 owner artifact/commit/digest 未实施发布；下列只是 Root
后续可以放行的精确候选，不构成当前写入授权：

- public/owner 契约：`contract/openapi/v1/openapi.yaml`、`contract/tests/v1-operations.json`、
  `contract/README.md`、`contract/dependencies/agent-http.json`、`openapi-ts.agent.config.ts`、
  `scripts/generate-agent-http-client.mjs`，以及新 owner commit 目录中唯一 `openapi.json` / `provenance.json`。
  新 owner SHA 未发布，所以不用占位目录冒充“精确 pin”；Root 必须在授 GREEN 前把具体目录、
  版本和 SHA 写入任务卡。生成输出只允许现 17 个 manifest 路径与同目录的
  `client.gen.ts`、`sdk.gen.ts`、`types.gen.ts`、`zod.gen.ts`、`failure-profile.gen.ts`、
  `client/{client.gen.ts,index.ts,types.gen.ts,utils.gen.ts}` 和
  `core/{auth.gen.ts,bodySerializer.gen.ts,params.gen.ts,pathSerializer.gen.ts,queryKeySerializer.gen.ts,serverSentEvents.gen.ts,types.gen.ts,utils.gen.ts}`。
- runtime：`src/bootstrap/server.ts`、`src/http/request.ts`、`src/http/routes/chat-authorization.ts`、
  `src/http/routes/chat.ts`、`src/application/chat-turn-service.ts`、
  `src/application/ports/agent-dispatch-outbox-repository.ts`、`src/domain/chat/agent-dispatch.ts`、
  `src/infrastructure/postgres/agent-dispatch-outbox-repository.ts`、
  `src/infrastructure/clients/agent/outbox-delivery.ts`、`src/infrastructure/clients/agent/launch.ts`、
  `src/infrastructure/clients/agent/types.ts`、`src/http/routes/scheduler.ts`、
  `src/application/ports/scheduler-dispatch-receipt-repository.ts`、
  `src/infrastructure/postgres/scheduler-dispatch-receipt-repository.ts`。这些是 Chat/Scheduler 双 sender、
  Chat payload v3 与 Scheduler receipt v3 的同一 atomic consumer cutover；不新建 helper/目录，不修改
  `database/schema.sql`。
- tests-only RED：`test/chat-input.test.ts`、`test/chat-service.test.ts`、
  `test/agent-dispatch-outbox.test.ts`、`test/bff.test.ts`、`test/idempotency.test.ts`、
  `test/agent-http-wire.test.mjs`、`test/contract/openapi-contract.test.mjs`、
  `test/contract-governance.test.mjs`、`test/schema-governance.test.mjs`、`test/architecture.test.ts`、
  `test/chat-facts.integration.mjs`、`test/agui-projection.integration.mjs`、`test/scheduler.test.ts`、
  `test/scheduler-dispatch-identity.test.ts`、`test/scheduler-dispatch-receipt.integration.mjs`。
  先只改现有测试并得到行为 RED；
  不 import 尚未生成的文件，不用 ENOENT/缺列伪造 RED。GREEN 仅能在 Agent 前置闭环后由 Root 重新授权。

RED 必须锁定：版本/route/body/header/202 契约；缺失、重复或非法 key；非 `{}` body；
同 key 丢 reply 回收、并发只一 attempt、跨 target/submit 冲突；最新严格 retryable profile；原 outbox
binding/payload/status；无 active/HITL；冻结选项；原 user/failed assistant/run 不变；只新增 assistant/run/outbox；
stream version/fence/lease；注入点 rollback 零部分事实；跨 tenant/owner/project/target 统一隐藏；以及 generic receipt
完全不介入。还必须锁定 Chat normal/retry 与 Scheduler normal 都发 required field，Chat v3/Scheduler
v3 对旧 v2、missing/null错位/non-null Scheduler parent/extra 全部拒绝，并重验 Scheduler canonical
occurrence 与 receipt 三 identity。真 PostgreSQL + 真 Agent owner 验收还必须证明同一 original user/new run 成功、原 pre-turn
context 完整、native HumanMessage 只一条，不能只用 mock HTTP 202 替代。

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
