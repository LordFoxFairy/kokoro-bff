## R126 public7 Run process candidate（待 Root 资源验收）

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

The current source candidate is public `6.0.0` on the unchanged `/v1` namespace under the explicitly approved R83 pre-release corrective cut. Only `GET /v1/sessions` changes: omitted or empty `scope` keeps the admitted owner's complete visible active set, explicit `scope=direct` returns only Conversations with `project_ref IS NULL`, and nonempty `project_ref` keeps the owned-Project filter. Combining explicit direct with a nonempty Project reference returns `400 invalid_scope` before Project lookup. Resource authorization, keyset cursor wire shape, operation inventory, ScheduledTask creation and the full execution-head contract remain unchanged. This is breaking, not backward compatible. Published public `5.0.0` bytes and digest remain immutable; this source file is the new public6 candidate rather than a compatibility branch. Root owns final resource acceptance and publication, and Web repins only the exact released public6 commit/version/digest. No consumer upgrade or managed-runtime activation is implied by this source candidate.

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

The IAM consumer pins the complete owner artifact `contract/openapi/iam.internal.v1.json`, version `0.7.0`,
IAM commit `e3c035b99cf9479ac8357c7d38147f1541dcbcac`, SHA-256
`c8d7af8a365ad5d13eaabccf7f31133e0918ef198bdc3e7c790d90933eae91b2`. `openapi-ts.iam.config.ts` filters the generated
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
