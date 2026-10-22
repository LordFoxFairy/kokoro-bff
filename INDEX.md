## AGENT-1 内部模型预算入口（2026-10-22）

`src/http/routes/model-admission.ts`／`model-admission.contract.ts`拥有Agent专用内部HTTP，`src/auth/agent-model-admission-credential.ts`鲜读独立caller/surface/tenant；`clients/owner/billing-model-admission.ts`消费固定exp8九操作生成集。`postgres/project-execution-binding.ts`追加已提交来源读取（原live reader不改），现outbox repository／businessStore正式暴露。源码按transport／凭据／事实来源职责拆分，不建新服务或表。测试为model-admission-{http,transport,contract}及submitted-agent-run.integration；正式内契约仍由现生成器产出，实际门禁与证据边界见CURRENT首节。

## AGENT-1／CREDIT-1 计价管理消费者（2026-10-22）

`src/http/routes/billing-metering-admin.ts`拥有三具名route及fresh管理员／同主体准入；`src/infrastructure/clients/owner/billing-metering-wire.ts`消费固定生成类型／严格JSON，`billing-metering.ts`负责固定owner SDK、绝对预算／bounded EOF与完整ACK。Public23.0／Billing2d3ed0f（exp6，必填精确model_revision pair），构建期精确inverse在 `scripts/billing-metering-public-contract.mjs`；对应HTTP、transport及contract回归在 `test/billing-metering-*.test.mjs`，已注册完整门。无新SQL、通用代理或运行兼容。最终门禁／真实HTTP＋PG／未正常激活边界见 `docs/CURRENT.md`。

## MODEL-1 上游候选读取（2026-10-22）

现 `model-configuration-admin.ts` / `system-model-configuration.ts` 显式 provider upstream-models GET，固定 System6.1。只管理读取候选，无分页／正文／命令头；与准入共用10秒预算，严格回包绑定provider。`provider-model-discovery-public-contract.mjs` 仅构建期完整逆证Public22.2，无运行fallback。后继App/Admin须固定正式Public22.3后接线。

## 2026-10-21 本人积分账户初始化

Public22.2新增天然幂等PUT `/v1/billing/credit-account`，沿个人owner client与Billing正式experimental.3，GET仍只读。生成来源见billing-http manifest，构建期完整父逆证见 `scripts/billing-account-public-contract.mjs`；主路径回归在 `test/billing-personal-read.test.mjs`，未接App或正常环境。

## 发布确认快照入口（2026-10-21）

Admin既有详情的meta.publication复用skill-product-response窄mapper，核整个Proto未知字段并拒绝缺值，不猜null；当前Native pin 97b27b3（本人历史原包资格），独立HTTP6.3不变。

沿现publish-skill、skill-admin路由和skill-product-input/schema、CatalogConnectClient：用户确认的publication为空或精确pointer/version，变更进入create-skill-draft-projector原摘要。Platform固定artifact和八向量见当前vendor与platform-connect manifest；原合同历史门在personal-skill-history-public-contract接入窄发布delta。两路冲突沿既有412，无提交重读／新存储。正常配对未完成，状态见docs/CURRENT.md。

## 2026-10-20 MC-02A System5 当前入口

`src/infrastructure/clients/owner/system-model-catalog.ts` 严格消费固定 generated `getModelCatalog`，投影owner显式provider/精确身份，替代原application slash猜测。原四管理操作继续由 `system-model-routing.ts` 消费，revision无feature/label别名nullable。canonical Public21/165及 `scripts/shared-model-catalog-public-contract.mjs` 精确逆回20后委托原20/19证明；旧oracle不改、脚本不进入runtime。相关回归仍在 bff/model-routing-admin/system-http-contract 原suite，当前验证与正常未激活边界见 `docs/CURRENT.md`。

## 2026-10-20 System4 管理配对当前入口

Public20/165 的唯一wire增量在 `AdminModelRevision`；原 `src/infrastructure/clients/owner/system-model-routing.ts` 严格消费正规 `src/generated/system-http`，仍现四操作，无额外mapper。固定System4 owner artifact/provenance见 `contract/dependencies/system-http.json`；`scripts/system-model-connection-public-contract.mjs` 只做完整Public19逆证，原历史proof不变且不进入runtime。正负例留原 `test/model-routing-admin.test.ts` 与 `test/system-http-contract.test.mjs`；验收及正常未激活边界见 `docs/CURRENT.md`。下列切片按历史读取。

## MCP 当前可用性消费

原 `mcp-personal-response.ts` 负责严格enum→五态及Connector投影；原 `mcp-personal-server-response.ts` 复用同一投影并保完整安全header描述。原两个Platform生成器固定同一个已合4a4e4c4 /HTTP6.2发布物，测试仍在原MCP suites内承接，无新模块/持久事实。

## 2026-10-19 集成证明入口

唯一当前 Public19/165：`contract/openapi/v1/openapi.yaml`。`scripts/verify-closure-integration-contract.mjs` 与 `test/contract/closure-integration.test.mjs` 验证两个批准父全文/有序操作、当前wire与仅新增归档Schema；历史proof不是运行时兼容层。现有业务组件与owner不扩展。

### 2026-10-18 MCP 管理HTTP入口

`src/http/mcp-package-admin-input.ts` 负责严格wire→SDK输入与受界正文；`src/http/routes/mcp-package-admin.ts` 负责五HTTP操作、当前管理员准入和公开错误/结果。现 `bootstrap/server.ts` 共用20秒请求预算、`runtime.ts` 沿原配置装配/关闭 SDK，`auth/browser-service-credential.policy.ts` 只给 Admin 浏览服务精确新增五入口。唯一公开契约18.1及 `scripts/verify-mcp-package-admin-contract.mjs` 保留完整Public18历史逆证；`test/mcp-package-admin-http.test.ts` 覆盖端到端route行为而非源码/CSS字符串。

### 2026-10-18 MCP 受管包内部消费者

`src/infrastructure/clients/platform/mcp-package-admin-{input,response,connect}.ts` 分担严格输入/固定摘要、安全投影和 Native Connect 生命周期。单一 `scripts/generate-platform-connect-client.mjs` 从固定 Platform fa5c5e5 增独立 Proto/descriptor/profile/vectors；原 HTTP 发行物随同一 bundle 固定，旧生成业务字节不变。`test/mcp-package-admin-client.test.ts` 覆盖五操作、凭据鲜读、精确回执/两种预算错误、取消与坏响应；没有第二套上传实体、公开路由或正常装配。

### 2026-10-18 自动化规则当前读取

`src/application/scheduled/mappers.ts` 分别维护原不可变写快照与 `scheduledTaskDetails` 当前规则读取；`live-bff.ts` 仅 GET 列表/详情使用后者，`helpers.ts` 列表类型相应收敛。`contracts/scheduled.ts` 的 Details 复用原字段并要求保存的 UTC anchor，不猜下次时间。`scripts/verify-scheduled-anchor-contract.mjs` 仅验证 Public16.2 新读表示与完整16.1逆证，不是 runtime fallback。正常激活/Web星期编辑仍待后继。

### 2026-10-18 本人知识（源码候选，尚未正常激活）

- `src/http/personal-knowledge-input.ts`：固定UUIDv4、严格JSON/Unicode/正文界限与CAS输入。
- `src/http/routes/personal-knowledge.ts`：本人六operation、查询/请求生命周期和安全结果映射。
- `src/application/ports/personal-knowledge-repository.ts` 与 `src/infrastructure/postgres/personal-knowledge-repository.ts`：本人知识/独立usage、同client事务、限额锁、删除tombstone及未知COMMIT；不增加转发service。
- `database/schema.sql`：本owner两事实表；`scripts/verify-personal-knowledge-contract.mjs`：Public16.1新增面与完整16.0父逆。fresh资源测试不等于正常库演进。

### 项目安装当前入口（2026-10-17）

Platform5ec8538／Public15.1.0项目六operation复用 `src/http/routes/skill-installations.ts` 与 `src/infrastructure/clients/platform/skill-installation-{connect,projector,response}.ts`；原 personal-installation-* 已重命名，无alias。server核当前项目资格，skill-specification-facade项目读取使用正式Project RPC；实际验证与未接的选择/执行见docs/CURRENT.md。

### S2 来源事实与公开 skill.list 当前入口（2026-10-17）

Public15.0.0/139 operations 与 Platform e172838 的 RPC/HTTP6.1.0 使用唯一当前固定 bundle；窄安装事实由 personal-installation-response 解码，skill-specification 仅对公开列表投影八类。网站及分享保原归属词表，真实数据 owner、精确版本与鉴权不变。SDK if/then 补全在既有 generate-platform-http-client 流程，projection-http 在 generated strip 前检验原始 product；测试仍复用现有 suite。实际验证、正常未激活及项目/Agent 后继见 docs/CURRENT，不以当前枚举代替 Device/App producer 或完整执行。

### 2026-10-16 Skill Share 活动版本资格

`src/http/routes/skill-share.ts` 复用 `SkillSpecificationSource.revisionSummary` 的精确 active/valid 元数据资格、strict schema 与 source_ref/UID 绑定；POST 持久化前/返回前及 Resolve 重新检查。本人可预览已撤回/草稿包不代表可生成分享，原包检查仍保留。DELETE 只沿原 creator/tenant，不因撤回阻断；没有新协议或 SQL。`test/skill-share-http.test.mjs` 原用例承接拒绝零创建、已有链接重核、迟到取消与提交后撤回，不假称跨 owner 原子回滚。

## SET47 Conversation归档实现候选

`src/http/archived-tasks-input.ts`、`routes/archived-tasks.ts`、`src/infrastructure/postgres/archived-tasks.ts`与`archive-sql-lease.ts`沿既有Chat/HTTP入口实现本人归档列表/状态/命令；唯一事实为Conversation.archived_at，当前canonical15.4/150。`scripts/archived-tasks-public-contract.mjs`完整逆恢复15.3后委托原门。纯门/真实PG待验及发行状态以`docs/CURRENT.md`为准，不将归档当删除、取消Run或撤分享。

## 本人姓名与登录设备

姓名 PATCH：`src/http/account-profile-input.ts` 负责原始输入；`src/http/routes/account-profile.ts` 负责正常准入与单总预算；`src/infrastructure/clients/iam-account-profile.ts` 负责固定IAM generated请求与绑定ACK，`.types.ts`承载结果类型。唯一public事实源是 `contract/openapi/v1/openapi.yaml` 15.2.0；`scripts/account-profile-public-contract.mjs` 精确恢复完整15.1后委托旧治理。BFF不持久化姓名。

登录设备仍由 `src/http/routes/account-sessions.ts` 与 `src/infrastructure/clients/iam-account-sessions.ts` 消费IAM本人会话；当前验证与尚未闭环的Web/browser项见 `docs/CURRENT.md`。

<!-- T-K03.13-BFF-MCP-PERSONAL-CRUD -->
本人 MCP：`src/http/mcp-personal-command-input.ts` 解析四命令，`src/infrastructure/clients/platform/mcp-personal-command-binding.ts` 冻结正式 owner JCS/key/CAS；现 `mcp-personal` route/client 承接六读取与四命令，Provider 目录不代表连接授权。

### T-K03.13 本人 MCP 四读运行接线候选

`src/http/routes/mcp-personal.ts` 精确承接已发行四GET；`src/infrastructure/clients/platform/mcp-personal-{credential,token,connect,response}.ts` 分担独立资格/token/固定generated RPC/安全投影。`bootstrap/runtime.ts` composition创建并close退役client/token，server保留写/provider guard与原active六字段投影。测试入口为 `test/mcp-personal-{read.test.ts,http.test.mjs}`；正常surface/IAM激活及完整CRUD仍由Root后继验收。

### R353-B2 Skills当前源码候选入口

现 http/routes skill-drafts/admin/cover/download/ai-import/github-import/share/usage及server/runtime组成Public9/132；clients/platform skill-product-{connect,response,schema}与skill-admin专用credential/token，IAMpublisherbatch、Storagetransfer复用正式owner。GitHub metadata单普通文件使用正式js-yaml4.3.2，从固定SHA真实SKILL.md解析；没有browser自报metadata或URL代理。源卡及补卡固定，正常配对/真实provider/browser/queryowner修正见CURRENT，S01–S10仍OPEN。以下为既往切片入口，不替代此当前状态。

### R343 Skills 本人原文读取当前入口

两public GET运行由 `src/http/routes/skill-package-inspection.ts`、`src/infrastructure/clients/platform/skill-package-inspection-{connect,response}.ts`承接，server在generic前exact分流。目录与原文仅真实owner读取，绝对10s/1MiB与可信本人身份每次重验。真实四GET/九边界Root通过，UI仍未完成；详见docs/CURRENT.md当前R343收据。

<!-- R343-PACKAGE-RUNTIME-MAP-END -->

## R342 Skills 包正文公开契约入口

当前 `contract/openapi/v1/openapi.yaml` 为8.8.0/111，两本人package GET；`scripts/verify-skill-package-inspection-contract.mjs`具名审查新增closed表示/请求响应绑定/安全path，并保护旧109完整parsed面。主verify/check调用此入口，现contract-governance含漂移负控；不从runtime import scripts。当前没有对应生产HTTP路由或Web详情，下一仍沿三D0既定实现与真实用户验收。实际失败和结果见CURRENT R342。

## R341 当前 Skills 包详情接线前置（2026-10-08）

当前唯一固定Connect来源1f6f764/52输入/current45RPC，历史V8/V9各43不改；common/platform正规生成、旧e83a固定vendor已替换。`src/infrastructure/protobuf-text-encoding.ts`同步幂等wire设置在`src/bootstrap/server.ts`composition之前，保留原正文BOM并维持strict非法UTF8拒绝。完整Root check/format通过仅说明工程前置；public仍8.7/109，两正文GET/真正查看详情/示例与正常进程尚未接入。实际结果/失败/未验见CURRENT R341；下列R323/R319按历史时点读取，不是当前固定点。

## R323 本人 MCP 四读机器契约已发布，运行接线尚未实现（2026-10-07）

当前唯一public OpenAPI **8.7.0 / 109 operations**，新增四 `/v1/self/mcp/*` GET（本人connector列表/详情、connector下connection列表、connection详情），固定metadata、安全closed shape/参数/错误与no-store。原105 operations/88path items/456components Root独立完整document剥增量后deepEqual，Platform固定vendor/generated、runtime/source/Schema/正常身份完全未动。旧R320三面中“尚未写机器契约”的阶段现由本节替代；五普通TS、正规OAuth HTTP到owner组合及正常激活仍目标，不把contract发行当已存在HTTP路由。没有新数据库/credential或兼容层。

Root实际四缺口RED 77旧PASS/4新FAIL；首机器contract73381 302PASS/1FAIL为旧R240闭集包含新path，最窄排除仅四新path/四ID，原hash/92不变。独审发现新Retry-After范围P2，现尾负控2PASS/1FAIL拒86401；只新header/verifier两行修canonical1..86400/绝对末尾、不容LF。原四RED组全文exact，旧response不改。专用checker和11漂移负控保闭集；scope JSONSchema字符计数不同于UTF-16 JS string.length，描述明确后继mapper仍须真实运行补强，不能单靠maxLength冒同规则。

Root显式Node22.22.2最终71468完整pnpm check自然exit0：contract304PASS/0SKIP、default879中877PASS/0FAIL/2原资源SKIP，lint/typecheck/build；13002 format:check自然exit0。只辅助机器验收，未运行全资源integration、真实本人四读HTTP/E2E或正常用户连接器CRUD，不把两skip计为通过。独审最终1fa085a4无确定阻断，七机器freeze加三已批准D0/本CURRENT/INDEX精确十二paths由Root独占提交；539其它tracked exact，原var保留。完整70/个人33不升级，支付最后，后继按既定实际IAM HTTP/Platform/BFF系统RED再授runtime五文件。

## R319 固定 Platform V8 消费已通过 Root 工程验收（未正常激活）

BFF 现消费 owner e83a2ad3a7c7d333ad0b0b8e7f3d3f64e497bc42 的38个固定发布对象；唯一vendor迁移，V8→V7→V6→V5 provenance逐byte固定、当前43 RPC/父39描述剥除四本人读精确回父版。实际生成只common/platform；Storage第三proto保留完整固定来源而不生成第三业务模块。现generator删除原未调用的request-bindings读取，正式V5来源与对应GetSkillPackageUpload描述/字段守卫可达；四provenance本身的摘要也固定。public 8.6/105、Schema、runtime消费者、服务身份和正常进程均不变，仍 generated-not-activated，不能把本片当四本人读用户流程完成。

Root完整check第一正确Node22尝试contract 289PASS/9FAIL：六既有test旧vendor路径ENOENT；只9处40字符commit字面更新，所有原断言/版本/计数inverse exact，不恢复旧vendor或放松门。最终Node22.22.2完整pnpm check句柄54243自然exit0：contract298PASS、default873中871PASS/0FAIL/2原资源SKIP，lint/typecheck/build/固定生成验证通过；format:check句柄92634自然exit0。此前48723子进程Node24被固定guard拒绝单列。所有日志保Root r319-bff-root-*.log，辅助门不替用户浏览器验收。

82路径freeze55c03a99精确、其余499tracked byte一致；原独审f40caa91无确定新阻断、六引用inverse与三D0历史suffix exact。Root仅再加本CURRENT与INDEX前缀，Git独占显式路径。真实OAuth client_credentials HTTP→owner introspection→BFF四本人读、正常8086接入/资格和完整CRUD仍OPEN；本轮只只读核官方IAM HTTP接缝，未启动测试fixture/扩权/重启资源。

---
## R291 Project scope release worker 候选入口

- `src/application/ports/project-scope-release-outbox.ts`：具名 claim/lease/settle 与 required 单调观察。
- `src/application/project-scope-release-outbox-dispatcher.ts`：共享原始lease deadline、单cycle、有限执行预算与停止/排空。
- `src/infrastructure/postgres/project-scope-release-outbox-repository.ts`：BFF自有outbox领取、有限恢复slot与Project聚合lease/fence CAS。
- `src/infrastructure/clients/storage/scope-release-client.ts`：固定generated Storage两RPC/正规错误tuple；无owner模型复制。
- `test/business-store.integration.mjs`：当前真实PG资格与受控wire，真实Storage/正常浏览器资格见CURRENT未验项。

---
## R268 个人生命周期运行候选入口（未发行）

- `src/http/{create-personal-skill-version-input,withdraw-personal-skill-input}.ts`：两个命令的严格原始输入与稳定 command ID。
- `src/http/routes/{create-personal-skill-version,withdraw-personal-skill,personal-skill-lifecycle}.ts`：具名 public route及仅两命令共用的单10秒/取消/完整错误回复后未完成body退役。
- `src/infrastructure/clients/platform/{create-personal-skill-version-projector,withdraw-personal-skill-projector}.ts`：正式 owner 3.0 canonical digest；现 `catalog-connect.ts` 两具名调用，现 `platform-service-credential.ts` 逐请求读取直接服务凭据并保持单调 deadline/取消 fence；内部 OAuth token source 已删除。
- `test/personal-skill-lifecycle-http.test.mjs`：受控 HTTP、真正 generated Connect binary、两固定 owner 向量及错误/资源边界；不冒真实 IAM/PG 或用户 E2E。

当前机器103是候选，正常BFF930028b/101与Web不变；完整验收与后继见 `docs/CURRENT.md`。

# kokoro-bff repository index

`kokoro-bff` 是 Kokoro 唯一 public HTTP Product API owner。本文是代码与边界地图；当前完成度只看
[`docs/CURRENT.md`](./docs/CURRENT.md)。

## 入口

| 路径                                                                     | 职责                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------- |
| [`README.md`](./README.md)                                               | 五分钟启动、边界与验证入口                         |
| [`docs/INDEX.md`](./docs/INDEX.md)                                       | 当前文档阅读顺序                                   |
| [`contract/openapi/v1/openapi.yaml`](./contract/openapi/v1/openapi.yaml) | 唯一 canonical public OpenAPI                      |
| [`contract/README.md`](./contract/README.md)                             | owner、visibility、version、breaking 与 provenance |
| [`database/schema.sql`](./database/schema.sql)                           | 本仓唯一 canonical PostgreSQL schema               |
| [`src/main.ts`](./src/main.ts)                                           | 当前 HTTP 组合根与请求管线                         |
| [`package.json`](./package.json)                                         | 本仓可执行质量门禁                                 |

R62 interaction 持久化职责位于 `src/infrastructure/postgres/agui-interaction-projection.ts`；projection/chat repository 调用，父锁、lease、CAS 与事务提交留原 repository。当前候选未发布，真实资源门由 Root 验证。

## 当前源码地图

```text
src/
├── auth/                          # service + Bearer + pinned IAM session admission；只产出可信 RequestContext
├── bootstrap/                     # production/test composition、HTTP admission 顺序与 worker 生命周期
├── config/                        # 严格 runtime configuration（含 IAM origin）
├── contracts/                     # BFF public transport envelope/projection types
├── domain/                        # BFF-owned policy 与 identity/value objects
├── application/
│   ├── agui/                      # durable projection use case、纯映射与 repository port
│   └── ...                        # Project/ScheduledTask use case、输入解析与 ports
├── infrastructure/
│   ├── clients/                   # Agent、Scheduler、Mori 等出站边界
│   ├── postgres/                  # BFF facts、receipt、AG-UI ledger 与 consumer/GC repositories
├── interfaces/http/agui/          # schema-valid SSE 编码；只输出已持久化 frame
├── http/routes/                   # Product routes；runtime-manifest 是独立 service-only handler
├── generated/iam-http/            # 从完整固定 IAM vendor 过滤 admission、Skill check、Team/invitation 的只读生成物
└── main.ts                        # composition root
```

## 本仓事实

当前 PostgreSQL 保存 Project、instruction revision、project skill、project task、ScheduledTask、idempotency receipt、
Conversation/Message/Share canonical facts，以及 durable AG-UI stream/source-event/public-frame ledger。
完整表清单见 [`docs/DATA_MODEL.md`](./docs/DATA_MODEL.md)。

## Public API 与 owner adapter

- Public API：[`docs/API_CONTRACT.md`](./docs/API_CONTRACT.md)
- IAM admission：`src/auth/`；完整 vendor、生成配置、manifest 与 drift gate 分别位于 `contract/vendor/kokoro-iam/`、
  `openapi-ts.iam.config.ts`、`contract/dependencies/iam-http.json` 与 `scripts/generate-iam-http-client.mjs`
- Organization Skill check：`src/auth/skill-authorization.client.ts` 只持当前用户 Bearer 调 IAM；尚无 Product mutation 调用者
- Team 只读投影：`src/http/routes/team.ts` 与 `src/infrastructure/clients/iam-team.ts`；事实和分页 cursor 仍由 IAM 拥有
- 资源说明：[`docs/api/README.md`](./docs/api/README.md)
- AG-UI：[`docs/api/v1/agui-chat.md`](./docs/api/v1/agui-chat.md)
- System / Model / Billing / Capability：当前由 `src/http/routes/owner.ts` 投影
- Library：`src/http/routes/library-file-list.ts` 与 `src/http/library-file-list-input.ts` 在 IAM admission 后按 file/artifact 分流。
  personal 列表/上传/下载消费既有 Storage personal scope；Artifact 通过 BFF 自有 Conversation/Project 关系
  和 `src/infrastructure/clients/storage/final-artifact.ts` 的 conversation-scoped FINAL/CLEAN 读取保持可见性。
  Public18 搜索候选由 `src/application/library-artifact-filter.ts` 规范化 q/type 并匹配当前最终元数据，
  `src/http/routes/library-artifact-list.ts` 保存有界候选窗口/完整 query cursor，稀疏页可继续而不误报穷尽。
  canonical 发布及前版逆变门为 `scripts/verify-library-filter-contract.mjs`；语义/边界见 `docs/api/v1/library.md`。
  当前正常环境仍 Public17；未完成消费者固定/配对前不重载候选或宣称页面搜索已完成。

- System / Model / Billing / Capability：当前由 `src/http/routes/owner.ts` 投影；Billing 套餐目录经 `src/infrastructure/clients/owner/billing-catalog.ts` 消费固定 owner generated client，完整分页后投影，checkout 未开放。
- Library：IAM admission 后由 `src/http/routes/library-file-list.ts`、`src/http/library-file-list-input.ts` 与
  `src/infrastructure/clients/storage/personal-file-list.ts` 消费 Storage personal Connect 列表；`kind=file` 必填，
  只投影 CLEAN ASSET。个人上传由 `src/http/routes/personal-file-upload.ts`、
  `src/application/personal-file-upload.ts` 与 `src/infrastructure/clients/storage/personal-file-upload.ts`
  调 Storage personal Create/Complete/GetAsset；当前已真链验可见 CLEAN 上传，跨进程未知结果恢复仍待放行。
  Agent Artifact 与个人下载仍待独立切片。
- Chat facts：`src/http/routes/chat.ts` 读取/写入 BFF PostgreSQL；已发布 `src/infrastructure/postgres/chat-repository.ts` 维护 tenant、锁和 cursor。在已发布的 R155 Move 职责拆分中，该 Repository 只委派 Move；`conversation-move.ts` 持单一 Move 事务/赢家 receipt 重放，`conversation-move-lease.ts` 持有界 PoolClient 生命周期，既有 `chat-repository-mappers.ts` 做纯 receipt Row 校验；本仓 SQL、public `7.1.0`、port 与行为不变。`chat-turn-service.ts` 与 `agent-dispatch-outbox-repository.ts` 原子提交 Message/Agent command；
- Agent Chat：`src/http/routes/agent.ts` 只承接 durable AG-UI 读取和 run control；Agent launch 由后台 outbox dispatcher 投递；`src/application/agui/` 投影；
  `src/application/agui/projector.ts` 独立消费 Agent source；`agui-projection-repository.ts` 在公开发送前持久化并分配 cursor，
  `agui-consumer-repository.ts` 维护 lease/fence、重试、保留水位与 tombstone GC
- Scheduler：当前由 `src/http/routes/scheduler.ts` 注册、对账和处理 dispatch
- Mori：当前由 `src/infrastructure/clients/mori/owner-route.ts` 投影独立 Music owner

## 测试与治理

| 路径                                                                             | 覆盖                                                                               |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`test/architecture.test.ts`](./test/architecture.test.ts)                       | 目录、依赖和文档事实门禁                                                           |
| [`test/contract-governance.test.mjs`](./test/contract-governance.test.mjs)       | OpenAPI metadata 与冻结 operation surface                                          |
| [`test/business-store.integration.mjs`](./test/business-store.integration.mjs)   | 真实 PostgreSQL/Redis business store                                               |
| [`test/agui-projection.integration.mjs`](./test/agui-projection.integration.mjs) | ledger、并发幂等、consumer fencing、GC/expired cursor、tenant 隔离、Redis 非事实源 |
| [`test/agui-http.integration.mjs`](./test/agui-http.integration.mjs)             | 后台主动摄取、opaque cursor、重启 replay 与 contract error                         |
| [`scripts/check-contract.mjs`](./scripts/check-contract.mjs)                     | 本仓 contract gate                                                                 |
| [`scripts/lint-source.mjs`](./scripts/lint-source.mjs)                           | 当前静态源码规则                                                                   |

- Project single-file upload: `src/http/routes/project-resource.ts` → `src/application/project-resource-upload.ts` → `src/infrastructure/clients/storage/`; source provenance `contract/dependencies/storage-connect.json`, deterministic generator `scripts/generate-storage-connect-client.mjs`, focused tests `test/project-resource-upload.test.mjs` / `test/storage-connect-contract.test.mjs`.

- Project durable resource GET: `src/http/routes/project-resource-list.ts`, `src/http/project-resource-list-input.ts`, `src/application/project-resource-list.types.ts`; owner mapping remains in the Storage client, with `test/project-resource-list.test.mjs` as focused contract/HTTP coverage.
- Personal Library upload: `test/personal-file-upload.test.mjs` covers direct contract/application/HTTP; `test/personal-file-upload.integration.mjs` is opt-in real PostgreSQL with a controlled Connect response fault and independent BFF instances. Root separately owns true Storage/MinIO/ClamAV/browser composition evidence.

## R59 public4 实现候选（未发布）

- 唯一公开事实源为 `contract/openapi/v1/openapi.yaml` public4；Agent HTTP4 固定 e977923ea9992cbddaf0cdbc6c8f8d23b3af120e，生成来源见 `contract/dependencies/agent-http.json`。
- `src/infrastructure/clients/agent/interaction-state.ts` 严格解码固定 owner schema；`src/application/agui/interaction-state.ts` 校验完整 revision/no-op；`src/application/chat-run-control.ts` 校验当前 pause 的完整 decision 集合。
- `bff_agui_run_interaction` 是最新 run read projection；source/CUSTOM/cursor 与它同事务。`chat-repository.ts` 在授权 RR 中校验 head、完整 state 与 ledger provenance；ACK 不清除 pause。
- 本轮静态/纯测试证据与未决 fixture 见 `docs/CURRENT.md`。真实 PG/Redis/HTTP、发布及 Web 消费归 Root 后续验收，不能以源码候选代替。


### Connector command 恢复错误

Platform Connect 固定消费 receipt metadata profile；`src/infrastructure/clients/platform/connector-command-fault.ts` 是MCP/Custom API两边界的唯一窄错误映射与code-first恢复policy，独立于资源投影。`scripts/generate-connector-command-errors.mjs` 正规发布只读 `contract/connector-command-errors-v1.json`，后继App固定commit/digest消费。unknown/expired/lost不自动重放或授权新key；MCP原生OAuth的三项typed原因独立可辨，缺detail的原生CAS与URL typed约束不混淆。真实HTTP/Connect组合与未知/错码/重复/混合/read负控位于现MCP/Custom API测试，非正常IAM/DB/OAuth验收。
