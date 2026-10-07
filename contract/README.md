## R267 lifecycle machine candidate (not released)

Public 8.5.0 / 103 operations is a machine-only candidate adding `createPersonalSkillVersion` and `withdrawPersonalSkill`. Runtime routes are not implemented and Web must not consume this candidate. Existing 101 operations and Platform Connect pins remain unchanged.

## R266 reviewed public 8.4 management read source

Public 8.4.0 / 101 operations and the two exact self-management reads are now implemented and Root verified. Platform HTTP3.3 uniquely consumes immutable 3d4ba6c / raw b6e5d0e0, with regular generated artifacts and the former vendor removed. Existing 99 operations and six reads remain unchanged. Current source evidence is in docs/CURRENT.md; normal process activation and Web/user CRUD are not yet verified. Candidate wording below is historical.

Public 8.4.0 adds the two beta managed-personal Skill reads (`listManagedPersonalSkills` and `getManagedPersonalSkill`) with five management states, eight safe fields, strict request/meta/error profiles, and 101 total operations. The internal Platform HTTP dependency is uniquely pinned to owner `3d4ba6c3462e3896481f902adf47e0713c4187e4`, contract 3.3.0, raw SHA-256 `b6e5d0e0118207ee37933e5c22e94c86d95d74307b22a44e26e8974fede82acf`; the former 3.2 vendor path is removed rather than retained as a fallback. Platform Connect and all historical artifacts remain independently pinned. Runtime implementation and generated output publication remain a later gated stage.

Public 8.3.0 adds required safe installation display_name, summary, and source_status fields while retaining 99 operations and the existing envelopes. Platform owner pin is `c94909f1c593f2b7ffd5f325786739da744ff31f`; V5–V7 historical artifacts remain byte-exact.

## R256 Admin model routing public 8.2 candidate

Public 8.2.0 adds four closed tenant-scoped admin model-routing operations and pins immutable System 3.0.0 commit `955bd587f46a771e43a4330d202d90a7d2d67262` / SHA-256 `94ed91655741cbba66ce80a4c41717b9179cc509cb6858534e0b78aa3e6dc059`. The generated System client is restricted to `listModelLabel`, `listModelRevision`, `listRoutingPolicy`, and `putRoutingPolicy`; runtime routes remain a later slice.

## R257 personalization public8.1 候选（未发布/未正常激活）

基线 ac3cd1da4f13e9e22320efbd4dbf4009aa0a2e29 的public8.0/93operation新增GET/PUT /v1/preferences/personalization，目标8.1.0/95operation。四字段本人singleton、required expected_revision CAS、no-store/header request-id、未知保存只读核实；旧93项的wire语义保持。canonical仅追加本owner表，源/隔离PG/合同待Root最终验收与immutable commit/digest，当前不交移动工作树给Web生成。正常已有数据须正规演进且IAM0.8/Web配对，禁止半边重载；Knowledge/导入/Agent应用仍OPEN。

## R257 本人 MCP Connection 读取候选（未发布）

唯一 public 8.0.0 canonical 新增 GET /v1/mcp/connections / listSelfMcpConnections，旧 Server 资源不变；本次候选尚待 Root 验证与新 immutable commit/digest，下面 R255 blob 是历史交接，不再声称与当前候选相等。HTTP consumer 固定 Platform 3.2.0 / 9ab3b653360d04fb498a238659edeec01e72f62d / SHA256 4b42dd161c972b3447cfea3a6f80a949bbdb573c46213dbf8ef4c3ecb58e72da，16 generated 只由既有 generator 生成。六字段本人 active 投影不是连接创建/授权/启用或调用成功；Web 后继独立固定正式发布 artifact。

## R255 02:44 ScheduledTask 本地 immutable artifact 交接

Root已接收固定owner commit `45e67f0e783fb4bcdb086665a09b7c3c5fadbb6f` 的唯一 `contract/openapi/v1/openapi.yaml` 原字节：public发布前 `8.0.0`，git blob `1b42d49388ca26eaaef7371daf23cbf1158d5fe6`，SHA-256 `0802a31f9469a17cd8fc8b78e6d2326e0571bc93f3ac8d19811a42a1b185df95`。当前canonical与该immutable blob byte-equal；旧Web pin97a99d35/33971eaa仍冻结，不改旧commit内容。此本地交接允许后继消费者锁定新commit/version/digest，经现generator正规生成；不是remote push、registry release或正常运行激活。

相对旧Web artifact只有ScheduledTask输出必有nullable next_run_at、create的可选recurrence_anchor_at以及closed PATCH显式规则字段；92operation、身份/错误/权限/其余schema保持。三D0已批准public8.0发布前clean-slate更正且源码e603bd55落地，不引入/v2、双协议、旧字段alias。后继Web只显示owner确认next，null不以应用时钟补齐；规则anchor与next不互填。

验收绑定源tree77c81139：Root精确index真实PG/Redis175pass/0fail/0skip、fullcontract242pass/0fail与八纯门0；本轮Node22.22.2直接semantic再次0（92operation）。这些是artifact/source验收，不替代真实IAM/Scheduler/provider/浏览器；normal BFF非watch未重载、schema调整一次待答、Web consumer未改，持续next读取仍待后继，T-P02未闭环。沿现任务/QA台账与owner边界接续，不用全文历史状态覆盖本节。

## R251 发布前 Skills V2 clean-slate 例外（目标，尚未发布）

Platform producer `494b118ae7c29f1fc1005122d72c6c2bbf2640b6` 的inactive V7把Validate `manifest_identity`值域从`zip-v1`替换为`zip-v2`。BFF保持现`/v1`资源路径，但唯一public contract以major `8.0.0`同步发布；旧7.x不并存、不路由、不fallback。该例外只适用于此次首次正式发布前的clean-slate cutover，后续breaking仍遵守本README的一般版本/路径策略，除非另有明确裁决。

唯一public机器事实源仍是`contract/openapi/v1/openapi.yaml`；本README不复制字段全集。Platform dependency的单一来源、V7→V6→V5证明链、39 RPC/20 commands/24 proofs与descriptor由`contract/dependencies/platform-connect.json`及现generator/checker固定。V7 inactive证明不构成activation；当前route、OpenAPI、generated client、正式发布与Web repin尚未实施。

## R240 public 7.2.0 rename 候选（2026-10-05；未发布）

唯一可编辑 `openapi/v1/openapi.yaml` 从正式 `cdad0ad6580dcbca18b75fdfbdbac4aa61f750d2` 的 public 7.1.0 增加独立 `PATCH /v1/projects/{projectId}/name` / `renameProject`，候选 7.2.0、91 operations；原 90 项保持，inventory 由既有 `contract:update-baseline` 生成。专用 RenameProject 组件不改变旧 instruction 或 envelope。

这是 owner 合同/设计与静态门切片，不含 rename 生产实现、真实 HTTP/PG 验收或消费者 pin。Root 完成后继实施/验收并发布 immutable commit/digest 后再消费；不以候选文件 SHA 冒充已发布身份。下方 R150 为此前已发布 7.1.0 的历史记录，当前正式运行能力尚未因此增加 rename。

## R176 Storage scope-release consumer pin（2026-10-03；仅机器消费基线）

BFF 固定 Storage 已发布 `e8b9928418924812587b7ac07900aee4be5bc27f` 与 combined SHA-256 `c22b5c10ee698d579753dcac370be371d8dba1df8fead1a12883f5443fbad18a`，从该 immutable owner commit 的两份 Proto 原字节确定性生成唯一 Connect client。新增 wire 面只有 `ReleaseProjectScope`、`ReleaseConversationScope` 及各自 command-only request/有界计数 response；tenant、subject、request 与 project/conversation scope 仍只来自受信 metadata。此 pin 不实现 Project DELETE、dispatcher 或网络调用，也不证明外部 provider/跨 owner/最终用户 release 链已验收。

## R150 当前 public 7.1.0 Move BFF producer（已发布）

唯一可编辑 Product API 机器事实源为 `openapi/v1/openapi.yaml`；已提交并推送的 `main 284b5e04c4c09759787ef239b1a19fcdcd5ed8fa` 为 public `7.1.0`，在此前 public `7.0.0` 基线上新增独立 `POST /v1/sessions/{id}/move`。BFF HTTP/PG 源码已实现，Root Node22 `pnpm check && pnpm format:check` exit 0（741 pass、1 个既有资源 skip；contract 4 条已知 warning）、聚焦真 HTTP/PG Move 9/9及完整八文件 PG/Redis integration 173/173；BFF producer 已发布；Web 固定 BFF commit/digest 与浏览器消费尚未完成。Move 不代表 Project DELETE、Storage release 或 T-C05 已闭环。下面 R126/R83 段落是各阶段历史事实，不描述当前已发布版本。

## R126 public7 Run process candidate（历史阶段）

The single `/v1` source candidate is now `7.0.0`. Session snapshots require nullable `execution_process`; Run process pages use the authorized immutable watermark route, bounded safe Todo/activity projection, and no raw tool payload or compatibility alias. The canonical SQL owns the two compact provenance tables while the immutable AG-UI ledger remains the as-of page source. Root resource verification and publication remain pending.

# Kokoro BFF contract

## Owner

`kokoro-bff` owns the Web-facing Product API contract. Root catalogs released artifacts but does not keep an editable
copy. IAM, System, Model, Billing, Platform, Storage, Agent, Scheduler, and Music retain their own internal contracts;
this repository documents only the BFF projection exposed to callers.

## Visibility

`iam-relay-policy.json` 是单独的 `browser-private` BFF relay 准入机器 artifact，不进入 public Product
`openapi/v1/openapi.yaml`。唯一手写事实源是 `src/http/routes/iam-protocol-relay.policy.ts`；运行
`pnpm contract:generate:iam-relay` 派生只读 JSON，`pnpm contract:check:iam-relay` 比较字节并拒绝手改漂移。
它只记录 BFF 的 path/method/header/cookie/redirect/预算策略及固定 IAM commit/allowlist/snapshot digest，
不复制 IAM OAuth/Better Auth 字段 schema。Web consumer 必须固定 BFF 发布 commit 与此 JSON 的 blob/SHA-256，
再做自己的生成/策略测试；当前 Web 切换尚未完成。
IAM 私有 allowlist/snapshot 不在 BFF vendoring。BFF 的本地门只证明 policy TS→JSON 字节一致；Root 的
跨仓机器门从固定 IAM/BFF gitlink commit blob 校验两份 IAM digest、relay path/method 子集与 BFF artifact，
并覆盖篡改负例。Root 组合门未通过前不宣称来源已闭环。

Every operation in `openapi/v1/openapi.yaml` is classified as `public`. Browser code still reaches it through the
`kokoro` same-origin server adapter; `public` describes product-contract visibility and does not expose BFF service
credentials to a browser. Health and readiness operations use the `anonymous` permission marker. Business operations
declare a stable permission identifier and normally require the trusted `web-bff` service envelope plus an IAM-verified
user Bearer. Share and runtime manifest explicitly override the top-level user Bearer requirement with service-only
security; an irrelevant extra Authorization header does not become an additional credential requirement.

## Version

R83 历史阶段的 public `6.0.0` 在相同 `/v1` namespace 修正 `GET /v1/sessions`：省略或空 `scope` 读取本人完整可见活动集合，`scope=direct` 仅取 `project_ref IS NULL`，非空 `project_ref` 保本人 Project 过滤，两者组合返回 `400 invalid_scope`。该修正当时是 breaking corrective cut，不是当前 `7.1.0` 工作树；已发布版本的原字节与 digest 不因本次 Move 候选而修改。新 consumer 只能在 BFF 正式发布后固定精确 commit/version/digest。

`GET /v1/sessions/{id}/events` issues one opaque `agui_*` cursor per durable public frame. Agent source sequences remain
internal projection metadata and are not valid public resume cursors. Callers persist the last SSE `id` verbatim and send
it back as `Last-Event-ID`; they do not derive, decode, or reuse it across tenants or sessions.

Phase 2 deliberately corrects the beta cursor shape from an Agent numeric sequence to the BFF-owned opaque token without
a compatibility alias. Consumers must pin this contract commit and update in lockstep. After this correction, another
cursor shape or meaning change follows the breaking policy below and requires a new API version.

## Generation

The canonical OpenAPI is hand-authored at `contract/openapi/v1/openapi.yaml`; generated clients and documentation are
downstream, read-only artifacts. Validate it with:

```bash
pnpm contract:check
```

The gate runs Redocly, the frozen operation inventory, field/protocol semantic checks, and the executable Agent control
adapter contract. `contract/tests/v1-operations.json` is a compatibility inventory, not a second field-level schema. After an approved,
backward-compatible operation addition, regenerate that inventory with:

```bash
pnpm contract:update-baseline
```

## Breaking policy

### Corrective pre-release baseline

R83 adds one explicitly approved public `6.0.0` corrective boundary in the single `/v1` namespace. The Conversation collection now carries one explicit `all | direct | project` filter through authorization, application and PostgreSQL. `direct` is evaluated in SQL before keyset pagination and means `project_ref IS NULL`; `all` continues to revalidate tenant, subject, active status and owned-Project visibility on every page; `project` keeps parameterized equality after current ownership validation. `scope=direct` plus nonempty `project_ref` is rejected before Project or Conversation reads. Cursor bytes do not gain a filter field: consumers discard a cursor whenever they change filters. No resource-route authorization, schema, index, dependency, `/v2`, alias, dual read or fallback is introduced.

Release order is BFF source/contract/tests alignment, Root real PostgreSQL/Redis gates, publication of the immutable public6 commit/digest, then an independently verified Web repin. The previously published public5 artifact remains byte-for-byte frozen and is not edited in place by consumers.

R74 adds one explicitly approved first-public-launch clean-slate boundary: publish canonical artifact `5.0.0` in the single `/v1` namespace for strict ScheduledTask creation. Remove creation-only `enabled` and `status`, reject undeclared body/query parameters and malformed Project references before receipt admission, and document the existing Project 404. This approval does not introduce `/v2`, a dual public4/public5 parser, compatibility aliases, or changes to PATCH/generic idempotency. Both creation operations already share `CreateScheduledTaskRequest`; the project path retains its existing path binding, while the new no-query/pre-receipt admission flow applies to `createScheduledTask`.

Release order is BFF source/contract/design/tests alignment and Root real-resource gates, then Root publication of the immutable public5 commit/digest, then an independently verified Web repin and normal generation. Do not edit a consumer's existing immutable public4 artifact. The following post-public-release breaking policy remains in force; this exception must not be silently generalized to future changes.

For BFF-CHAT-ROLE2 only, before the first public release, public `3.0.0` may remain on `/v1` while narrowing
`ChatMessage.role` to `user | assistant`. The removed `system` value has no product producer in BFF, Agent, or Web, but
narrowing a response enum is still breaking and is not described as backward compatible. This is a one-time corrective
baseline exception; after the first public release, the `/v2` rule below applies unchanged. Existing databases are not
migrated or filtered by this publication, and source publication does not activate the managed runtime.

Before the first public release, the previously declared Library `200` response was unreachable and depended on a dead
Storage HTTP transport. The explicitly authorized clean-slate correction removes that response and its orphaned schemas,
while preserving `/v1/library`, `GET`, `listLibrary`, and the operation metadata, and publishes the exact interim
`503 storage_integration_unavailable` contract. This is a corrective baseline, not a claim of backward compatibility.
After public release, the breaking policy below applies unchanged.

The same pre-release corrective baseline removes legacy namespace/principal security schemes and makes online IAM
session admission explicit. User-protected operations publish 401/403/429/503; Library's 503 keeps both
`storage_integration_unavailable` after admission and `iam_admission_unavailable` before route execution.

- Additive optional fields, new error codes, and new operations may remain in `/v1` after examples and tests change in
  the same commit.
- Removing a path/method, renaming an `operationId`, making an optional input required, narrowing a response, changing
  permission or idempotency semantics, or changing an existing field's meaning is breaking and requires `/v2`.
- `pnpm contract:check` runs Redocly validation, operation metadata checks, the frozen v1 path/method/operation-id
  baseline, BFF semantic invariants, and the executable Agent control adapter test. General schema-level compatibility
  still requires review; the operation inventory is deliberately not represented as complete semantic-diff coverage.
- Updating the compatibility inventory to hide a removal or rename is prohibited. A versioned replacement must land
  before the old operation is retired.

## Provenance

The source artifact is `contract/openapi/v1/openapi.yaml` in this repository. Release provenance is the immutable Git
commit plus the artifact digest produced from that file:

```bash
git rev-parse HEAD
shasum -a 256 contract/openapi/v1/openapi.yaml
```

Consumers must pin the published version, source commit, and digest. They must not copy this file into Root or edit a
generated client as a substitute for changing the owner contract.

The narrow `contract/external/kokoro-agent/control-receipt.v1.json` consumer snapshot pins only the Agent-owned
`ControlReceipt` shape required by this adapter. It records Agent commit
`70a38138f42f29e8a482fde7890fe0e2d0c27e34`, source path
`contract/openapi/v1/openapi.json#/components/schemas/ControlReceipt`, and full source artifact SHA-256
`c7d80e568a39bd9f8fdae7adc165b33df98e4b45f2e5c91aea04c415d6b0158f`. The BFF validates that owner receipt before
adding public `run_id` from the trusted route parameter; the snapshot is not a second Agent contract owner.

The System consumer adapter is pinned to owner artifact `contract/openapi/system.openapi.json`, version `2.0.0`,
System commit `f5702068d4416ad90b1bd02af57d2825c32be916`, SHA-256
`f9ea76f107e1ea0fc19df20ee7c59032c0fbac66e640e9a16a1b770ab27c1f37`. This is a provenance reference only;
the owner OpenAPI is not copied into this repository.

The IAM consumer pins the complete owner artifact `contract/openapi/iam.internal.v1.json`, version `0.8.0`,
IAM commit `d24aa2b697de59a350e8588720620df331bc5da5`, SHA-256
`0153a16f5c2779803d73d93d5533caf1b377d21299cefe01613d7cd1b2cbb194`. `openapi-ts.iam.config.ts` filters the generated
surface to BFF admission, Skill authorization check, Team, and invitation operations without editing the full vendor artifact. Platform workload
introspection and execution authorization remain excluded. Exact generated-file digests and toolchain provenance are
recorded in `contract/dependencies/iam-http.json`.

The Agent HTTP consumer pins the complete owner `contract/openapi/v1/openapi.json` v4.0.0 at Agent commit
`e977923ea9992cbddaf0cdbc6c8f8d23b3af120e`, SHA-256
`763ff7a9cf668eb59ae7cfb59b2fd4f84fafde124063d9a365f138b6a30cf04f`, plus that publication's
`contract/provenance.json` bytes at SHA-256
`e2e6cd9f2228900d0c0a8d795f19815a145bd8f0d18c785ffbe059214b5ed99a`.
`openapi-ts.agent.config.ts` filters only `createRun`, `replaySessionEvents`, and `controlRun`; the full source bytes are vendored read-only
under `contract/vendor/kokoro-agent/`. `pnpm contract:check:agent` verifies the two-file fixed-commit allowlist,
published HTTP provenance, strict `ChatFailure` and full interaction/control schema graphs, toolchain and manifest, regenerates all 17 files twice
byte-identically, and compares every generated file. BFF validates the owner 202 receipt, 200 replay envelope, and
decoded `run.failed` / `interaction.state` payloads with generated runtime schemas; this dependency does not make BFF the Agent contract owner.

The Platform Connect consumer pins exact `common.proto` and `platform_runtime.proto` bytes plus the complete
`platform-execution-operations/4.0.0` artifact from Platform commit `263a28f1e55745bd1829a61f68228d775751adbc`
under `contract/vendor/kokoro-platform/`. Its aggregate SHA-256 is
`902f8f2c2fbeb95a441820c1cf16b0a9c793eadac7106f9fcd5e41e3878b7f79`; every file length/digest, Get read binding, and the aggregate record
are checked before two byte-identical Protobuf-ES generations. The artifact remains `inactive/routable=false`, and the
independent BFF CreateDraft projector/JCS plus the user-only Get runtime are default-closed candidates; no coordinated public activation is claimed.

The Storage Connect consumer now pins owner `2d87e26bbaed9a70dcd91ad1e9d126d39d275f38` (combined source SHA `11edffcdd668c59ef07c7b4c47d44b38dd95c2b8aee5a4d0c6475fba58850713`) for upload plus project-scoped and personal-scoped `ListAssets`. Individual Proto SHA pins, generated bytes and toolchain remain in `contract/dependencies/storage-connect.json`; `pnpm contract:check:storage` regenerates twice. Public `listProjectResources` and `listLibrary` remain owned only by this BFF OpenAPI. The first Library response is explicitly `kind=file`; it is not an Artifact contract.

R257 administrator admission consumes the pinned IAM 0.8.0 current qualification. Existing `GET /v1/me` adds required
`platform_admin: boolean`; ordinary false is still 200. Only the admitted-user context carries this field, not service-only
identity. Missing or malformed owner fields fail closed; no old-shape fallback or positive authorization cache. Web admin
server/API gates must obtain a fresh check; the projection does not grant downstream owner commands. Normal activation
requires coordinated IAM populated-schema evolution and strict BFF/Web consumer switching; no half deployment or startup seed.
