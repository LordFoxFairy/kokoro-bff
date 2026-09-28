# kokoro-bff 当前实现

状态：2026-09-28
适用范围：当前分支代码、`database/schema.sql` 与 `contract/openapi/v1/openapi.yaml`。历史报告不作当前证据。

## W2-BFF-PERSONAL-DOWNLOAD 文档门（2026-09-28；代码未开始）

基线 BFF main `5add506becd39715dc0a469af83e148a5a354515`：个人文件列表与上传已存在，
`GET /v1/library/files/{asset_id}/content` **不在**当前 public OpenAPI/runtime，Web 文件卡尚无正式下载动作。
本次仅把 [技术设计](TECHNICAL_DESIGN.md)、[API 契约策略](API_CONTRACT.md) 与
[数据边界](DATA_MODEL.md) 的目标方案对齐；机器契约、源码、测试、Schema、生成物均未修改，
因此此阶段不声明下载可用或跨仓通过。

已裁决下一代码片由 BFF 在每次 service+Bearer/IAM 在线准入后，先在可信 personal scope `GetAsset(asset_id)`
核对普通 ASSET/CLEAN/1 MiB 上限与摘要，再以相同 scope/摘要 `GetDownloadReference`，核对签发元数据，
仅向配置的 ObjectStore origin 安全 GET；不重定向浏览器、不暴露签名引用。完整缓冲并验证长度和 SHA-256
后才发带安全下载头的二进制 200，错误保持稳定 JSON；BFF 不新增 SQL/receipt/缓存/role。
先由 Root 审查文档门，后续 owner OpenAPI + runtime + 直接测试/Node22 全门，Root 再以真 Storage/MinIO/ClamAV
验证字节和他人私有负例；Web 精确 pin 和真 Chromium 点击属于更后续的独立切片。


## W2-BFF-LIBRARY-PERSONAL-UPLOAD-CODE（2026-09-28，已发布并通过个人文件真链纵切）

BFF main `8a90fdd9ec3809000924229bfc7b986ba8ba1522` 已发布 public OpenAPI 和 runtime
`POST /v1/library/files`、独立 personal Storage Connect adapter、个人上传 checkpoint saga 与直接合同/行为测试；
没有修改 canonical Schema 或新增角色。Root 已独立复验本仓 Node 22 的 `pnpm format:check && pnpm check && pnpm schema:check`
（342 pass/1 skip；schema 5 pass/1 skip）。Root 固定 `0a9206969b2edfcf40bb8d5f0f2d85952995fb8f`
组合的真 IAM→Chromium→Web→BFF→Storage/PG/MinIO/ClamAV 已从可见 UI 点击验个人 CLEAN 200、本人 GET/刷新、
同租户成员私有、并发同键、同键重放/异文件冲突、EICAR 422/终态重放；测试自有资源清零。

实现是一个 `files` part/1 MiB/必填 Idempotency-Key 的 Product POST：当次 IAM admission 后派生
personal scope，Storage CreateUpload→先持久 checkpoint→安全 PUT→Complete→GetAsset；只在普通
ASSET/CLEAN 且 public 终态 receipt 确认持久后返回 200。同键同文件恢复原 Upload，Complete 结果未知时
不内联 Abort 可恢复的 upload；感染 422、待扫/未知结果 503 同键重试、异文件 409。既有
`bff_idempotency_receipt` 的 public 终态和 `personal-file-upload:v1` checkpoint 用独立 scope，
无需预建新表/角色；本片已修复/测试 `putReceipt` 条件写 0 行静默成功风险。Project owner
predicate、`project-resource-upload:v1` namespace 不进入个人入口，Storage 仍唯一拥有文件事实。

上述单仓直接 HTTP fixture 使用假的 Connect 与对象 PUT；真纵切证据来自 Root 固定组合，不以单测冒充。
现有直接测试中 Complete 丢应答的“restart-style”仍在同一实例/内存 Map 上运行，尚未证明真实 PostgreSQL
checkpoint 在 BFF 停止/重启后的恢复。本次候选增加测试自有 PostgreSQL、独立 BFF 实例及受控应答丢失的
`test/personal-file-upload.integration.mjs`，只证明 BFF 持久回执/恢复与 Connect fault proxy；真实 Storage
进程已提交 Complete、BFF 重启后的当前固定组合门仍待 Root 放行。个人下载、Agent Artifact 及整条 W2 边仍未完成；
未触碰用户 3310。

## W2-LIBRARY-BFF-FILE 代码片（2026-09-28，个人文件 GET 真跨仓已验）

`GET /v1/library?kind=file` 已在 IAM admission 后调用 Storage personal scope 的 Connect `ListAssets`，OpenAPI 有严格文件 200、必填 kind
及 400/502/503；旧固定 `storage_integration_unavailable` 运行分支已删除。无 kind/未知 kind 400。
BFF Storage consumer manifest 现 pin `2d87e26`/combined SHA-256
`11edffcdd668c59ef07c7b4c47d44b38dd95c2b8aee5a4d0c6475fba58850713`；项目 GET/POST 仍用
独立 project scope，不把 `projectId=subjectId` 当个人查询。

Storage owner main `2d87e26bbaed9a70dcd91ad1e9d126d39d275f38` 已发布原 v2 `ListAssets` 的 personal
CLEAN ASSET 查询、隔离 `personal_library` cursor 与受信 `scope_id=subject_id`，combined SHA-256
`11edffcdd668c59ef07c7b4c47d44b38dd95c2b8aee5a4d0c6475fba58850713`；本仓已重钉并调用。
首片 `GET /v1/library?kind=file` 的 `kind` 必填，无参/未知 400；200 只列本人个人文件并
标 `kind:"file"`，不是 Agent 作品。未来 `kind=artifact`/`all`、下载 Product 动作和 Web
旧 `/api/session/artifacts` 迁移仍未实现。个人上传代码片的当前状态以上方为准，已通过个人文件真组合正向与私有负例；
下载另需当次 GetAsset 校验普通 ASSET/CLEAN 后再签短期引用，不能只调用 GetDownloadReference。
Storage 单仓通过不等于 BFF/Web 用户可见闭环。

本片无 Schema/role/缓存/旧 HTTP fallback；`x-request-id` header 已写，但现有 BFF JSON envelope 仍含
`meta.request_id`，与 Root API 手册 header-only 目标有既有全仓偏差，留独立 breaking 裁决。
Root 在此工作树独立使用 Node 22.22.2 复验 `pnpm format:check && pnpm check && pnpm schema:check` exit0：
全量 332 pass/1 skip、schema 5 pass/1 skip，Storage 精确来源与双次生成均 PASS；独立只读审查无 P0/P1。
新增 live Product HTTP→Storage Connect fixture 覆盖逐页重新 IAM admission、personal header、跨 subject cursor 400，
但仍不是 Storage 真进程/PostgreSQL/browser。Root 已在上方固定组合独立执行真 Storage/PG、
Web 浏览器刷新/同租户其他人不可见验收。未触碰用户 3310，不把本片称为完整 Library。

## W1E-BFF-PRODUCT-CREATE-DRAFT-DOC（2026-09-28，设计候选；尚未实现）

当前代码基线为 BFF main `55b2809b2f73addbac2b56bd8a04aa0c1706521b`。IAM 0.7 用户 admission 已存在；但 canonical
OpenAPI、runtime route、Platform Connect consumer、catalog workload credential 和 server receipt bypass 均不存在。Skill mutation
仍 fail closed，且 generic `mutationTicket` 位于业务 route 之前，terminal replay 可以跳过本次 Product 当前授权；因此当前运行态尚无
user CreateDraft 正向链。本节记录目标，不把四份 Markdown 当作实现或验收证据。

下一实现片只开放 `POST /v1/skills/drafts` 的 user owner：public body 仅含 `display_name`、`summary`、`tags`；BFF 从每次
IAM admission 的受信 tenant/subject 派生一致的 user owner 与 Product context，固定 `metadata_json` 为 UTF-8 `{}`。同一 public
idempotency key 派生稳定 Platform command，Platform v2 receipt 是唯一 durable 幂等事实；CreateDraft 精确绕开 BFF PostgreSQL/Map
generic receipt，使首次请求和 replay 每次都先重验 IAM/current owner。BFF 不新增 schema、Redis、Skill catalog 或 receipt 事实。

Platform consumer 目标固定 owner `f26d147a09350c3a041722107d277beb93eaad60`、Proto package
`kokoro.platform.v1`，`platform_runtime.proto` SHA-256
`282bf886ea9648f7ce5208abd36ab47d879b2002a036d90aada2af59e74b4020`，以及 execution artifact/digest v2
`2.0.0` aggregate SHA-256 `f0a16f8360c075e783c244284b56a1bea5aa3113cc066b25163a60b713a7df25`。调用身份是 BFF
tenant machine catalog workload；旧 Capability HTTP shared secret、用户 Bearer、手写 Proto DTO 和 v1 digest 都不是 fallback。

仍未实现且不阻塞开始实现的范围是 organization/project/session owner、其余五个 catalog mutation、Storage/package 与 Web consumer；
真实跨 owner smoke 是 user CreateDraft 首片验收门，不能略过。首片仍需 Root 审查后依次完成 public OpenAPI/contract test、generated Connect client、credential/token provider、
server admission cut、route 与测试；真实 IAM+BFF+Platform 验证必须覆盖首次 201、响应丢失 replay、撤销 session 后同 key 拒绝及
Platform 仅一条 Skill/receipt。本候选未改机器契约、代码、schema、数据库、服务或共享 3310。

## W1E-BFF-IAM-0.7-PIN（2026-09-28，仓内验证通过；跨仓待验）

基线 `9b9aff46205a7bbe486244195b81e1e87e6ec2c6`；本切片完整 vendor/manifest/generated 已固定 IAM
`4d981441d154c83b63987f284e3a82a559595870`、OpenAPI 0.7.0、SHA-256
`c8d7af8a365ad5d13eaabccf7f31133e0918ef198bdc3e7c790d90933eae91b2`，旧 0.6 vendor 删除。
现有确定性生成器新增唯一 `checkTenantSkillAuthorization`；Session/Team/invitation consumer 保持原操作。
relay policy 仍为 2.1.0，仅来源 tuple 改变，生成 JSON SHA-256 为
`e58bf3e7992c2ac40efdf386ec2e652c021f2dd92747461207dede9d2c5d2786`，没有新增 browser-private route。

窄 `SkillAuthorizationClient` 在 server auth 边界使用调用方当前 user Bearer，严格检查
allowed/tenant/subject/action、no-store/request-id/JSON，拒绝额外字段；不缓存、不重试，也没有 BFF 机器凭据回退；用户 token 语义由 IAM 当前校验。
有界 transport 只有 session verify 和 Skill check 两个具名入口，不开放任意 URL/body 透传。
本片尚未挂接 Product mutation 或四 scope 编排，不改变 SQL/基础设施；Platform 受信上下文、Storage 包绑定和
public 机器字段仍是后续实现门。下节 0.6 描述属于该设计片原始盘点，不覆盖本切片来源。

Writer Node 22.22.2 / pnpm 11.25.0 验证：format:check、lint、typecheck、contract:check（28/28）、build 通过；
最终 test 为 297 pass、1 既有 skip，schema:check 为 5 pass、1 缺数据库 fixture skip；Session/Skill 聚焦 18/18。
IAM 生成 drift 两次 byte-identical、relay drift、diff 检查通过；relay 仅 commit/version/OpenAPI digest 三个来源键变化。
Root 已独立按 Node22.22.2/pnpm11.25.0 复验 `pnpm format:check && pnpm check && pnpm schema:check`，结果与上行一致；真实 IAM/BFF/Platform 和浏览器未在本片验证，不把本地 HTTP double 记为真实 owner integration。

## W1E-BFF-SKILL-PRODUCT-DOC 历史评审基线（已被上节首片收敛）

盘点基线 BFF main `1105553cfc24d4f44a90f626132bc30323a77946`，开始时工作树 clean。
本片仅四份既有文档的设计增量；不是代码实现、IAM pin 更新、Platform consumer 接通或四 scope 验收。

- 该设计评审时，BFF `contract/dependencies/iam-http.json` 固定 IAM 0.6.0；IAM owner
  `4d981441d154c83b63987f284e3a82a559595870` 已发布 0.7.0 `checkTenantSkillAuthorization`，
  artifact SHA-256 `c8d7af8a365ad5d13eaabccf7f31133e0918ef198bdc3e7c790d90933eae91b2`，BFF 尚未消费。
- 当前 Skill/MCP facade 仍是 Capability 2.0.0 四 GET；其余 Skill route 返回 503。Platform 当前物理仓
  `apps/kokoro-capability`、盘点 `ee25c1f4d6df08be183ca10f7f5e852e0b21f641`，六 catalog mutation 的 workload+tenant
  不等于受信 Product subject/owner 当前授权；不能以这些 RPC 已存在宣称 Product mutation 完成。
- 目标四 scope 为 user/organization/project/session；BFF 负责 Product 身份与个人/Project/Conversation 当前策略，IAM 负责组织 Skill
  当前动作，Platform 负责真实 Skill owner/状态/receipt，Storage 负责 package。详细矩阵、目标 public API、数据不变量分别见三设计文档。
- 当时计划的下一片先精确 pin IAM 0.7 SDK，落实 BFF 四 scope check；Platform Product 受信上下文/资源 owner 查询/撤权与 replay 协议先发布，
  随后精确 pin consumer 并逐项实施；Storage→Platform Begin/Complete 与持久包绑定必须先闭环，才激活 Validate/Publish 成功路径，
  未就绪时两动作保持 fail closed，不宣称六 mutation 均可成功。其余 installation、Web scope/UI、Root 端到端按依赖推进；
  user-only 首片不等于全部目标。
- 未决发布门：Platform Product admission 的可验证承载与撤权竞态时点、资源 owner 查询机器契约；Storage upload/package 消费 pin；
  BFF public 六 mutation 机器 OpenAPI/错误码与 generated consumer；Root 专用真实三 owner Skill smoke runner/命令。
  这些分别归 owner/Root，不用文档或 stub 替代。无 schema 变更，无应用服务启动，无共享 3310 操作。
- 本轮四文档现状/目标评审已完成；代码前置文档门仍待 Platform owner 机器契约及 public 字段收敛，尚非完整三设计文档门通过。
  Root 独立 Node 22 新增章节 Prettier、CURRENT 整文件检查及 `git diff --check` 通过；
  schema governance 为 5 pass、1 skip（未提供真实数据库 fixture）。本片代码、机器契约与真实跨仓链路仍未实现。
  代码 lint/typecheck/test/build、真实 PG/Redis、三 owner smoke 与浏览器均未在本片执行；本节不覆盖既有历史门禁记录，
  也不提前修改 Root active dependency 库存。

## W1E-IAM-0.6-BFF-PIN 历史来源

IAM owner `a4c2b61467f1fc1772d6b6d8e98f081c090289fb` 的 internal OpenAPI `0.6.0` 原始 SHA-256 为
`392ca0e49544c0ec6e0d2fa782c46c33c1847e2c350102e7ad3b8af43f858ced`。本仓完整只读 vendor、生成配置、manifest
与 browser-private relay policy 来源 tuple 均重钉到此唯一 owner commit，旧 `0.5.0` vendor 删除。生成器仍只筛既有 session、Team、
invitation 操作；新增 Platform workload introspection 与原有 E2 verifier 都不进入 BFF generated client 或浏览器 relay。
relay policy 仍为 `2.1.0`，route/header/cookie/status 未变；派生 JSON SHA-256 为
`8f7d4f4cb6fa0ec34d2cce8702d8882d3270a316a6cbdb2d8bdaccefb9c6b4a1`。本片不改 Product API、SQL/Redis、业务逻辑。
IAM 0.6 ingress 契约与运行端点已在 IAM owner 发布；Platform owner 尚未消费该端点或完成原子 cutover，后续跨仓验证仍需独立验收。
Node 22.22.2 本仓 `pnpm format:check && pnpm check` 已由 Root 独立复跑通过：IAM 生成链无 drift，contract/全量测试
292 passed、1 既有 skip，最终 build 通过；Redocly 仅有既有 Library 无 2xx warning。Root 跨仓来源验证仍待
IAM→BFF→Web 三方组合固定；本片未启动共享服务或触碰 Web 3310。

## W1E-IAM-E2-BFF-SOURCE-PIN 历史来源

IAM owner `b720b6dc095b883237682102ca0a87ed6451a968` 的 internal OpenAPI `0.5.0` 原始 SHA-256 为
`cddfec4cd3439d98f399254911232c447582a97e9b1d4c109139e68baaf030b9`。BFF 已替换旧 vendor，固定生成配置/manifest 并重生
16 个 client 文件；生成 operation allowlist 保持原有 session、Team、invitation 集合，不生成或调用 IAM E2 verifier。
browser-private relay policy 仍为 `2.1.0`，route/header/cookie/status 与前一 pin 完全一致，只更新来源 commit/version/digest；
派生 JSON SHA-256 为 `ed476b63205c0eaf59106dc618c138df6110ef6240ce2be50b417fea8ec800e4`。
public Product API、SQL/Redis、运行时业务逻辑均未变；Web 与 Root 后续按已发布 BFF commit 串行重钉。

## W1E-IAM-PERMISSION-CONSUMER 来源更新（历史验收）

当前 IAM owner 为 `5c9cecf714c87234bbc9558665b23e09afa6e9f6`；internal OpenAPI `0.4.0` 的 SHA-256 为
`05ff7ff712ce06571ca5e092fdaf234b9ee4d1b4978c54e0d54d2b50fe51dde2`。唯一 wire 变化是角色列表响应增加
可选 `platform:["execute"]`；BFF 已重钉 owner 原始字节并重新生成 16 个 client 文件，其中只读角色类型与 Zod schema 有变化。
browser-private relay `2.1.0` 的 route/header/cookie/status 不变，policy 仅更新 IAM 来源 commit/digest，派生 JSON SHA-256 为
`7bb829c988908804d0c3cac0cb023a6c247af6b0b4a55e8baf90b39d795f7118`。BFF 不解释或授予该权限；IAM
execution authorization endpoint 与 Platform consumer 仍待后续切片。

## W1D-RELAY-PIN-BFF 来源更新（历史验收）

IAM owner 已发布 `6a55ffb4c22f0b155ddb83157735c0ace766701d`；固定 allowlist、Better Auth 1.7.3 snapshot 与
internal OpenAPI 0.4.0 的 SHA-256 分别为 `f63dacfa8a7bcec3c56efb8ffb762a3f8bd82bb380eff40a1462db1e77d61ead`、
`b2eac1919e16fdc30a40bee0f3c4300b641bd8f674214aea7731bf10299559e1`、
`a18d57172df841cb2f55aa845a3eeb519ddb5abc8bea1c2be74fbb7e0fb62416`，与先前 pin 完全同字节。
BFF 唯一手写 policy 仅重钉 `iamOwnerCommit`，派生 JSON SHA-256 变为
`b18a559d162509c3029908b2e1c77ee7e59ed6af61b82e18be6b2e7669a0ef0c`；原 commit 替换回去时的 digest 仍为
`f7a3a44d9839a0e54faffc8cf6b7ceb601d0d6b647637faf10e9070c927d93e7`，证明 route/header/cookie/status 等字段未漂移。
IAM OpenAPI vendor 已按新 commit 路径迁移，旧路径删除；配置与 generated manifest 同 pin，生成的 16 个 client 文件原始字节无变化。
本片不改 public Product API、SQL/Schema、Redis、状态机或 HTTP 行为。Node22 聚焦测试先观察 3 RED（policy commit/新 vendor/manifest），
生成后 22/22 GREEN；`pnpm format:check && pnpm check` 通过，contract 28/28、全量 291 pass/1 既有 skip、build 通过，IAM client
drift gate 为 16 文件两次字节相同。无隔离 IAM owner URL，因此未运行需外部进程的 `test:iam-relay:integration`；Web 消费与 Root 固定
SHA/跨仓验收待后续串行完成。下面 R5 段落保留当时的来源和历史验收记录，不是当前 pin。

## R5-INVITE-BFF-RELAY 当前实现与来源重钉

IAM `7215223b2ed27a0d5217f3bbaaabce547006d3bb` 只更新测试 SMTP fixture，0.4.0 OpenAPI 原始字节未变。BFF 已把 IAM owner 固定到
`7215223b2ed27a0d5217f3bbaaabce547006d3bb`、OpenAPI 0.4.0 SHA-256
`a18d57172df841cb2f55aa845a3eeb519ddb5abc8bea1c2be74fbb7e0fb62416`。vendor、dependency manifest、生成配置和 IAM client
只新增三条 browser-private invitation operation；policy `2.1.0` 的派生 JSON SHA-256 为
`f7a3a44d9839a0e54faffc8cf6b7ceb601d0d6b647637faf10e9070c927d93e7`。静态 `routes` 只从 IAM `AUTH_ROUTES` 增加精确
`POST /sign-up/email`；context/accept/reject 仍位于独立 `invitationRoutes` 与具名动态 matcher，不形成 wildcard 或静态 map 模板。

四路都在 Product admission、SQL、Redis、receipt 和业务 store 之前验证 Web 服务身份、精确 Origin 与有界 transport。动态三路另要求
配置中的固定 tenant、IAM canonical 小写 UUID、过滤后的非空 issuer Session，且无 query/body/Authorization/Idempotency-Key；
sign-up 只接受恰好 `name,email,password,callbackURL` 的 JSON、无 issuer Session，并把 callback 固定为同源单邀请 ID。其 pinned
Better Auth snapshot status 集为 200/400/401/403/404/422/429/500，不含 409/503；`requireEmailVerification=true` 的 200 必须是
`token:null` 或省略 token 且 `emailVerified:false`，string credential token 或任意 Set-Cookie 都会被脱敏为 502，确保 SMTP 验证前不跨过
issuer Session；user email/URI/date-time 也必须通过 pinned snapshot format。Web 后续不得渲染或使用 token 字段，
所有邀请 POST 的一次性 CSRF 仍由 Web 在注入 BFF 服务凭据前消费。

动态响应按 generated owner schema 严格验证 status、JSON media type、成功/error body，禁止 Location/Set-Cookie；sign-up 同样限制
snapshot status/body 并拒 3xx。动态错误额外要求 `details=[]`，只保留 generated 稳定 code/retryable 并用 code→固定安全文案重建；sign-up
错误按 snapshot 的必填/可选 message 形状验证后，改用 status 对应的固定 `IAM_SIGN_UP_*` code/message，二者都不透传 owner 原始
message/payload。全部邀请结果固定 no-store/no-referrer/request-id，429 只保留合法 Retry-After；未知、畸形或超限
上游响应不泄露原文，transport/timeout 不重试。verify-email 只新增精确同源
`/iam/interactions/invitation?id=<canonical UUID>`，失败只允许 owner 四值
`TOKEN_EXPIRED|INVALID_TOKEN|USER_NOT_FOUND|INVALID_USER` 作为唯一追加 error；其他 query/顺序/编码/外域仍 502。BFF 不新增
Product API、数据库或缓存事实。真 HTTPS SMTP/Chromium、Web interaction/CSRF 与 Root 来源 verifier 仍待跨仓串行验收。

BFF 初次实现切片的 Node 22.22.2 `pnpm format:check && pnpm check` 通过：IAM/policy/其他 generated drift gate 均为双生成字节一致，
contract test 28/28，全量 291 passed、1 skipped，最终 build 通过；Redocly 仅保留既有 Library 无 2xx warning。相邻 relay policy/真
BFF HTTP 假 IAM 测试 32/32 通过并覆盖零上游 socket 拒绝、三动态成功/error、sign-up、Location、未知 status/schema/header、大小/
deadline/取消与不重试。没有可用的 `KOKORO_TEST_IAM_BASE_URL` test-owned loopback owner，本次未启动共享 IAM/PostgreSQL/Redis，
故 `test:iam-relay:integration`、真实 SMTP/PG/Redis 与浏览器验收明确未运行。

## W1C-Team-R5 工作树目标（未获 Root 组合验收）

基线 BFF `e0663a8c85f055c2bac5af894070fea8e24ff3ce` 只有 Team 三 GET；当前工作树增加六条 IAM user-delegated Team Product mutation。IAM owner pin 为 `ad5224a9e0a3a31d1c593d214d37940d6923b2e7`，internal OpenAPI 0.3.0 SHA-256 为 `e1a023d3ae9839c345d65ec91c3674bd105a9c27f65bb6ecb10f74c965340c54`（字节与旧 pin 相同）；browser-private policy `2.0.0` 只重钉 IAM SHA，派生 artifact SHA-256 `74893ba4e566e4824a278cd3ee1548030a33435f9b37b7026a8a7e943c080037`，route/header/cookie 语义不变。Team 不落 BFF SQL/Redis；IAM write scope/权限、冲突与并发由 IAM owner 裁决。Node22 `pnpm check` 本仓通过：282 passed、1 skipped；真固定租户 Web→BFF→IAM 链待 Root 验，未获 Root 组合验收。

W1C IAM 来源重钉（2026-09-24）：IAM main `7f39193fff97dbb1398cb536ded7dca0db354213`
仅调整 test-owned Web OIDC host 与集成测试；前一 IAM main `3231d2e9b225c337a1432ffb431cd7a5269d988d`
已发布的第一方 Web client 固定 Tenant issuer 续接约束保持不变。IAM ingress allowlist 与 vendor
snapshot 原始字节未变，BFF 只更新 browser-private policy 的 owner commit 来源并保持 `2.0.0`
的 route/body/cookie 语义；派生 `contract/iam-relay-policy.json` SHA-256 为
`70cc9704ecf6f61d616011a72447ff3df8c209b3a769d5e4009692b81329e96f`。Web 须固定新 artifact digest；
本片来源重钉不单独证明浏览器 tenant 续接或 refresh 已闭环。

W1C-FIXED-TENANT-BFF-C 当前工作树候选：公开 `GET /v1/me` 仅在普通 Product service+Bearer、IAM 在线 admission、固定 tenant guard 成功后读取本次 `RequestContext`，返回 `{data:{user_id,tenant_id},meta:{request_id}}`，无 BFF/IAM 数据库或 Redis 读写。OpenAPI 与 v1 operation baseline 已从 66 增至 67，canonical OpenAPI SHA-256 `75ab482132602bd1d7ce77dbec1423b10d4ce7a8244ad284ecac78cd4e7b50ca`；其他业务/relay 契约不变。相邻真实 BFF/IAM-stub HTTP 与 contract 测试先观察 2 个 RED，额外 GET body 负例再观察 1 个 RED，实施后聚焦 24/24 GREEN；Node22 `pnpm format:check && pnpm check` 通过，contract 27/27、全量 276 pass/1 skip、build 通过。本仓候选尚需 Root 冻结 SHA 审查、Web consumer pin 与真 IAM OAuth same/foreign/revoked 组合；IAM-stub HTTP 不能冒称 IAM 实际撤权链，真实 PG/Redis integration 未运行。

W1C-FIXED-TENANT-BFF-B 当前实现：browser-private policy 已按 breaking 提升至 `2.0.0`，删除 `/organization/list`；`/organization/set-active` 仅在固定配置 tenant、精确 Web Origin/受信服务、非空 issuer session cookie、精确 JSON body 与有界 signed `oauth_query` 均通过时出站，缺/错 tenant 等负例在 IAM socket 前拒绝。policy JSON 由唯一 TS 事实源派生，SHA-256 为 `954ea40e828266488db7cd6bdf5309aab868436de665f22b9608744f51280606`。public OpenAPI、IAM 通用原生 endpoint、BFF Schema/Redis/receipt 不变。相邻 Node 22 真 HTTP 测试先观察 3 个 RED，实施及重新生成 artifact 后 24/24 GREEN；本仓 `pnpm format:check && pnpm check` 通过，contract test 26/26、全量 273 pass/1 skip、build 通过，未运行需要外部 IAM 进程的 `test:iam-relay:integration` 或真实 PG/Redis integration。下面 `1.1.0` 记录为起始已发布基线；Root 已在本仓工作树重跑完整 Node22 门，正式固定 SHA/跨仓组合待 Web 消费后验证。Web 当前仍使用 list/可选选择表单，须在 BFF 发布后原子切换；真 IAM OAuth/Root 来源 pin 尚未验收。

W1C-Team 历史来源级联（BFF-B 前基线）：IAM main `b363554d07e5b6e182160b42ae1402330e55d9db` 仅校正 Team/固定 Product Tenant 三设计与 CURRENT；ingress allowlist SHA-256 `f63dacfa8a7bcec3c56efb8ffb762a3f8bd82bb380eff40a1462db1e77d61ead`、Better Auth vendor snapshot SHA-256 `b2eac1919e16fdc30a40bee0f3c4300b641bd8f674214aea7731bf10299559e1` 均未改变。本仓 browser-private policy 仅重钉 IAM commit，version `1.1.0`、路径/方法/头/cookie/限额语义不变；派生 artifact digest `97022ea8727619bae03927027ef6a8ce87a3d2da4580ba5d211dc63b16fdc42c`。Web 消费方与 Root gitlink/库存必须在本仓提交后按固定 SHA 续钉，未完成前不能称来源组合通过。

W1C-FIXED-TENANT-BFF-A：普通 `/v1` 用户在 service + Bearer 检查后若缺 `KOKORO_TENANT_ID` 返回 `503 product_tenant_not_configured`（零 IAM I/O）；IAM 在线 admission 后若受信 tenant 不等固定配置返回 `403 product_tenant_forbidden`。两者在业务 route、body、receipt 与 owner I/O 前终止；同租户保留原有 tenant + subject 私有边界。service-only runtime manifest、Share、Scheduler callback 和 browser-private `/iam` 不经此闸；无 Team 写投影、Schema/索引或 relay policy 变更。Node 22 admission 测试先 2 RED，实施后 12/12 GREEN；Root 在冻结工作树复跑 `pnpm format:check && pnpm check`（全量 272 pass、1 skip）。Root `9f8d8d60` 已以真实 IAM Code+S256 A/C 异租户组合验证三条 Team GET 分别 200/403、自有资源0；这不等于 Web 固定 tenant 登录或 Team 写闭环。

W1D-Chat-B1 当前实现：
Web 本地 `conv_<UUID>` 首条 `POST /v1/sessions/{id}/messages` 已改为在 BFF Chat turn 同一 PostgreSQL
事务内隐式建 active Conversation，并写两条 Message、Agent outbox 与 expected-run registration；
首条内容派生标题。既有 active 会话继续追加；foreign/deleted ID、非候选缺失 ID 与不可见 Project 返回
404。没有新增表或 Agent 协议字段。
真实 PG/Redis 隔离回归与本仓完整门禁以本次执行结果为准，不以本段文字代替验收。

W1D-Chat-B2 已于 BFF main `8dedcb2510d8c5e3917561b9c979e7aa6ce8b8ae` 发布：Agent source 的 assistant delta/completed 与 run terminal 已在 BFF AG-UI
source commit 同一事务中更新 outbox/expected-run 绑定的 assistant Message；多段以最后一段权威正文
表示，中间段 completed 仍是 streaming，run 成功/失败/取消才终态。session snapshot 的 Message 与
AG-UI watermark 使用同一只读 repeatable-read 快照，Message 只取最新 100 条并按 sequence 升序呈现。
当前 run 对 active Conversation 的 outbox/assistant 绑定缺损会使 source/frame/watermark 整事务回滚，
Agent mapper 不再把非字符串 delta/content 强制为空串。Agent owner main
`520ec181a101298b4f336aad273ce003b2735955` 已发布空 `assistant.completed` 的真实 replay；
BFF 已验证草稿→工具→空最终段→run success 后 Message 正文为空，重开 snapshot 与 watermark 同快照。
Node 22 在已创建空 `kokoro_bff` schema 的自有临时数据库实跑 `pnpm test:integration` 42/42，
`pnpm test` 262 pass/1 skip、`pnpm contract:check` 26/26；上述为 B2 发布前实测门禁，不冒充 B3 的当前结果。

W1D-Chat-B3 本提交：Agent HTTP v1.1.0 固定 owner commit
`520ec181a101298b4f336aad273ce003b2735955` 与完整 OpenAPI SHA-256
`2b9c7aad6f38db3e20200b037e4818ae932209ba3deecabf8fc984db6bcec492`；两条生成 operation 的
严格 202/200 success envelope 取代宽松手写接收和裸 body 回退。Node 22 在本提交候选上经 Root 独立复验
`format:check`、`lint`、`typecheck`、`contract:check`（26/26）、`test`（267 pass/1 skip）、
`test:architecture`（27/27）、`build` 与独占临时 PostgreSQL/Redis `test:integration`（42/42）
已实跑通过；vendor 字节篡改会令 drift check 非零。该结果不替代 Root 对固定 gitlink 与真实
Agent HTTP/worker 组合的最终验收。

W1C-Team-R2 本仓源码已在 main `fd74202e69e4d40beaef9d3f9ab9b871365589a8` 发布：IAM owner `68aa0da259df1f1ea9030936b8d5a46acba8c6ab` 的内部 OpenAPI `0.3.0` 已替换旧 `0.2.0` vendor，生成链精确增加当前租户 members/invitations/roles 三 GET，旧 vendor 已删除；BFF public 三 GET、只读 Team 客户端与六项假 IAM HTTP 回归也已提交。当前 IAM `093b76513a9aa71611c65d4f210e279d3227e002` 仍保留 test-owned Web OIDC client 的三个 Team 只读 scope；本仓 relay policy 来源已跟进该 commit，IAM allowlist 与原生快照 digest 未变。Web Team 消费仍未验，不能称 Team 跨仓闭环。

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

- R2e-IAM-VERIFY-RELAY 本仓切片在 IAM `093b76513a9aa71611c65d4f210e279d3227e002` 已发布的 allowlist 内，仅向现有 browser-private relay
  增加 `GET /iam/verify-email`，policy version `1.1.0`，生成 artifact 保持只读。相邻 policy/transport 测试
  先 RED 后 GREEN，验证原始 token query、模拟 IAM 原生 302 到固定同源 `/auth/sign-in`，以及上游缺失或
  返回可缓存 header 时 BFF 强制的 `Cache-Control: no-store`、`Referrer-Policy: no-referrer`、外域
  `Location` fail closed，以及错误方法/编码别名/浏览器 Authorization 零上游 socket、Product cookie 不出站。
  BFF 不读写本地 SQL/Redis，也不拥有验证 token；IAM Better Auth 1.7.3 使用有期签名 JWT 与邮箱状态幂等语义。
  真实 IAM 邮件点击、JWT 验证、Web policy 消费、正式账号 bootstrap 与普通 IAB HTTPS 登录仍待 Root/owner
  后续组合，不表示用户当前 3310 可登录。Node 22 在本候选运行 `pnpm format:check && pnpm check` 通过，
  单元/静态测试 270 pass、1 skip；未运行真实 PG/Redis integration。
- 本次源码切片在普通 `/v1` IAM admission 之外，新增由 Web service secret 准入的精确 `/iam` 原生协议 relay；
  runtime 不签发 token、不开 IAM internal API、不读写 BFF SQL/Redis、不过 Product envelope。BFF 本地门已运行，
  仍待 Root gitlink 来源门与真实正向 OAuth 组合验收，因此不表示完整登录已可用。
- 单一 TS 准入事实源为 `src/http/routes/iam-protocol-relay.policy.ts`；`contract/iam-relay-policy.json` 由
  `pnpm contract:generate:iam-relay` 确定性派生，`pnpm contract:check:iam-relay` 拒绝生成 artifact 漂移。
  本次仅重钉 IAM test-fixture owner commit，artifact SHA-256 为
  `731735ba8ce07c578fe04fa51783a95c7ac7daf50df33cea0ef9cefedc32d032`；policy version、路径、header、limit 与运行时行为未变。
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
- 当前 OpenAPI 有 67 个 operation；每个 operation 都声明 owner、visibility、stability、idempotency 和
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

### Library / Storage 历史 degraded boundary（已被上文 W2 文件列表替代）

- 当时 `GET /v1/library` 在 service-envelope admission 后固定返回 `503 storage_integration_unavailable`；未认证请求仍返回
  `403 service_auth_failed`。BFF 不调用旧 `/internal/bff/library`，也不打开 Storage 连接。
- 当时 public OpenAPI 保留 path、method、`listLibrary` operationId 与 metadata，删除不可达 200 以及孤立的
  `LibraryResponse`/`LibraryItem` schema；该历史状态已被上文正式个人文件 success contract 替代。
- 该 503 阶段已结束，但 `EDGE-BFF-STORAGE` 在 Root 全边验收前仍按 `broken`。个人 `kind=file` 已接入
  Storage personal CLEAN ASSET 查询、本人成员准入与单 kind 分页；完整 Library/Artifact 与整边激活仍需 Agent
  trusted Run/ExecutionIdentity、相关 Capability scope、产物列表/下载与双源分页及真实组合验收，不能用
  文件列表 200 代替。

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

1. **Chat assistant message reconciliation 已发布 BFF 单仓实现，Root 组合仍待验收。** W1D-Chat-B2 BFF main `8dedcb2` 已加入 source event →
   `bff_message` 同事务回写，含 Agent owner 已发布空终帧的消费测试；Root 须在 BFF 集成版本重跑
   真实 PG/Redis、静态及契约门。AG-UI ledger 与 BFF Message 仍是不同事实，不从 ledger 临时拼出产品 Message。
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
consumer、lease/fence、retention/GC、expired cursor 与当前工作树的 assistant message reconciliation。它不拥有 Agent Run，也不扩展到
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

## Platform Connect Proto 消费准备（2026-09-28）

已从 Platform main `f26d147a09350c3a041722107d277beb93eaad60` 精确固定两份 `kokoro.platform.v1` Proto，使用本仓固定 Buf/Protobuf-ES/Connect 版本生成独立客户端类型。`contract/dependencies/platform-connect.json` 记录原始 SHA、生成器、lockfile 与 build policy；`pnpm contract:check:platform` 两次生成并核对字节。此片仅证明 wire/descriptor 可独立消费，**未实现** command digest、machine credential、public Skill route 或真实 owner 调用；既有 Capability HTTP GET 仍单独运行。Platform v3 command artifact 尚未发布，故不可把生成客户端视为 Product CreateDraft 闭环。

## W2 项目资源单文件上传（待 Root 审查/真实集成）

基线 BFF `61b8074ba0264a77496fee8bcb475def46430a63`，Storage `094847da9f4f03e5f3dbda06658430c74bc32f54`。本片替换 resources 503 stub，保持 multipart files 请求形态，限制为单文件 / 1 MiB；多文件、Library、Skill package、chat 关联不在范围，零 Schema 变化。

W2 本片已实现单文件 route、native multipart、有界 ConnectRPC/presigned PUT、terminal create checkpoint 与最终 receipt。固定 Storage owner `094847da9f4f03e5f3dbda06658430c74bc32f54` 的两个 Proto；新增唯一依赖 `@connectrpc/connect-node@2.2.0`（peer Connect 2.2.0、protobuf ^2.7.0，与 2.14.0 兼容）。配置为 `KOKORO_STORAGE_RPC_BASE_URL` + `KOKORO_BFF_STORAGE_SECRET` + `KOKORO_STORAGE_OBJECT_ORIGIN`，旧 Storage HTTP 环境变量仍被忽略。新增测试覆盖 HTTP→Connect→PUT、最终 receipt 失败恢复与当前项目权限先于 replay；测试 owner/对象服务是进程内 double，不是 Storage 集成。Node 22 format/lint/typecheck/contract/build/schema 门已执行；最终测试数量以本次交付报告为准。Root 待验真实 PostgreSQL + Storage + ObjectStore，未运行共享基础设施。

W2 审查修正：项目资源成功态收窄为 CLEAN。INFECTED 为稳定不可重试 422；PENDING/UNKNOWN 为可重试 503。Complete 和 GetAsset 都执行该检查，负例验证不返回资源/引用且同 key 不重复创建资产。

## W2 项目资源持久 GET（当前实现，待 Root 真实组合验证）

基线 `main 199a183`；固定 Storage owner `ef0fd7779bf434120ac1f8a58592222f534a7c45`，published combined SHA-256 `05c6ef390c06b512218520b44e76d2d3212630df574a4fd63b6238b05631189f`。原 vendor pin 已替换并由本仓 Buf 连续两次生成一致，旧 owner vendor 删除；无依赖升级、SQL/Schema/receipt修改。

新增 public GET `/v1/projects/{projectId}/resources`：每页先按可信tenant/subject查当前私人Project owner，canonical id入Storage project scope；未授权/不存在404且零Storage调用。默认limit50（1..100），opaque cursor上限4096；只返回ASSET/CLEAN metadata、next_cursor及既有RequestMeta，不含upload_id/URL。坏查询400、坏owner页502、依赖失败503，不降级空列表。空项目200空items。公开OpenAPI、baseline、生成drift与负例同步；POST/checkpoint保持原行为。

聚焦测试覆盖HTTP→Connect分页、跨project/subject、cursor拒绝、owner故障/坏页、当前授权与GET/POST元数据一致；owner transport在测试中是double，不算真实Storage/PG集成。Node22 format/lint/typecheck/build全部通过；contract 40/40，test 328通过/1跳过，schema 5通过/1跳过，Storage生成/check均两轮字节一致。当前未提供隔离 KOKORO_TEST_POSTGRES_URL/REDIS_URL/POSTGRES_ADMIN_URL，故未运行真实PG integration；真实Storage/PostgreSQL/ObjectStore/Web刷新组合由Root后续串行验证，Web consumer仍属后续片。
