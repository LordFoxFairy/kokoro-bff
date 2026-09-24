# Kokoro BFF contract

## Owner

`kokoro-bff` owns the Web-facing Product API contract. Root catalogs released artifacts but does not keep an editable
copy. IAM, System, Model, Billing, Capability, Storage, Agent, Scheduler, and Music retain their own internal contracts;
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

The current contract version is `1.0.0` on the `/v1` HTTP namespace. Its operation stability is `beta`; that marker
describes compatibility expectations, not proof that every Live adapter or persistence path is complete.

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

The IAM admission consumer pins the complete owner artifact `contract/openapi/iam.internal.v1.json`, version `0.2.0`,
IAM commit `259a66e6a569889c030734f380e99685d8b9e21c`, SHA-256
`f7a3ea2e5ae7ade82ae1a6756a2f560d3129ca1b2977c6b0905633a284bd3aab`. `openapi-ts.iam.config.ts` filters the generated
surface to `POST /internal/v1/session-authorizations/verify` without editing the vendor artifact; exact generated-file
digests and toolchain provenance are recorded in `contract/dependencies/iam-http.json`.

The Agent HTTP consumer pins the complete owner `contract/openapi/v1/openapi.json` v1.1.0 at Agent commit
`520ec181a101298b4f336aad273ce003b2735955`, SHA-256
`2b9c7aad6f38db3e20200b037e4818ae932209ba3deecabf8fc984db6bcec492`.
`openapi-ts.agent.config.ts` filters only `createRun` and `replaySessionEvents`; the full source bytes are vendored read-only
under `contract/vendor/kokoro-agent/`. `pnpm contract:check:agent` verifies the fixed digest, toolchain and manifest,
regenerates twice byte-identically, and compares every generated file. BFF validates the owner 202 receipt and 200 replay success envelopes and trusted error codes with the generated
Zod schemas; this dependency does not make BFF the Agent contract owner.
