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

The current contract version is `2.0.0` on the unchanged `/v1` HTTP namespace. Version 2 adds the closed optional
Agent-owned failure profile to durable `ChatMessage` projections; this coordinated beta break does not add a `/v2`
alias or preserve a 1.0 response fallback. Its operation stability is `beta`; that marker describes compatibility
expectations, not proof that every Live adapter or persistence path is complete.

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

The Agent HTTP consumer pins the complete owner `contract/openapi/v1/openapi.json` v3.0.0 at Agent commit
`f3be3b97dd67df69ed3c6cb88c59f3bc2db97703`, SHA-256
`e9f0a543f74dee34212f0ea4fe366d46218268462ac54dce08e41965f34d2d2c`, plus that publication's
`contract/provenance.json` bytes at SHA-256
`d116657f65027de8bd829dc0408fd86046da0ac0a1d2934bd2a87e835c897b5f`.
`openapi-ts.agent.config.ts` filters only `createRun` and `replaySessionEvents`; the full source bytes are vendored read-only
under `contract/vendor/kokoro-agent/`. `pnpm contract:check:agent` verifies the two-file fixed-commit allowlist,
published HTTP provenance, strict `ChatFailure` schema graph, toolchain and manifest, regenerates all 17 files twice
byte-identically, and compares every generated file. BFF validates the owner 202 receipt, 200 replay envelope, and
decoded `run.failed` payload with generated runtime schemas; this dependency does not make BFF the Agent contract owner.

The Platform Connect consumer pins exact `common.proto` and `platform_runtime.proto` bytes plus the complete
`platform-execution-operations/4.0.0` artifact from Platform commit `263a28f1e55745bd1829a61f68228d775751adbc`
under `contract/vendor/kokoro-platform/`. Its aggregate SHA-256 is
`902f8f2c2fbeb95a441820c1cf16b0a9c793eadac7106f9fcd5e41e3878b7f79`; every file length/digest, Get read binding, and the aggregate record
are checked before two byte-identical Protobuf-ES generations. The artifact remains `inactive/routable=false`, and the
independent BFF CreateDraft projector/JCS plus the user-only Get runtime are default-closed candidates; no coordinated public activation is claimed.

The Storage Connect consumer now pins owner `2d87e26bbaed9a70dcd91ad1e9d126d39d275f38` (combined source SHA `11edffcdd668c59ef07c7b4c47d44b38dd95c2b8aee5a4d0c6475fba58850713`) for upload plus project-scoped and personal-scoped `ListAssets`. Individual Proto SHA pins, generated bytes and toolchain remain in `contract/dependencies/storage-connect.json`; `pnpm contract:check:storage` regenerates twice. Public `listProjectResources` and `listLibrary` remain owned only by this BFF OpenAPI. The first Library response is explicitly `kind=file`; it is not an Artifact contract.
