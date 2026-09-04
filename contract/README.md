# Kokoro BFF contract

## Owner

`kokoro-bff` owns the Web-facing Product API contract. Root catalogs released artifacts but does not keep an editable
copy. IAM, System, Model, Billing, Capability, Storage, Agent, Scheduler, and Music retain their own internal contracts;
this repository documents only the BFF projection exposed to callers.

## Visibility

Every operation in `openapi/v1/openapi.yaml` is classified as `public`. Browser code still reaches it through the
`kokoro` same-origin server adapter; `public` describes product-contract visibility and does not expose BFF service
credentials to a browser. Health and readiness operations use the `anonymous` permission marker. Business operations
declare a stable permission identifier and require the trusted `web-bff` service envelope.

## Version

The current contract version is `0.1.0` on the `/v1` HTTP namespace. Its operation stability is `beta`; that marker
describes compatibility expectations, not proof that every Live adapter or persistence path is complete.

## Generation

The canonical OpenAPI is hand-authored at `contract/openapi/v1/openapi.yaml`; generated clients and documentation are
downstream, read-only artifacts. Validate it with:

```bash
pnpm contract:check
```

`contract/tests/v1-operations.json` is a compatibility inventory, not a second field-level schema. After an approved,
backward-compatible operation addition, regenerate that inventory with:

```bash
pnpm contract:update-baseline
```

## Breaking policy

- Additive optional fields, new error codes, and new operations may remain in `/v1` after examples and tests change in
  the same commit.
- Removing a path/method, renaming an `operationId`, making an optional input required, narrowing a response, changing
  permission or idempotency semantics, or changing an existing field's meaning is breaking and requires `/v2`.
- `pnpm contract:check` runs Redocly validation, operation metadata checks, and the frozen v1 path/method/operation-id
  baseline. Schema-level compatibility still requires review; the baseline is deliberately not represented as complete
  semantic-diff coverage.
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
