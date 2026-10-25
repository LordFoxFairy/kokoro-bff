import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { connectNodeAdapter } from "@connectrpc/connect-node"
import { create } from "@bufbuild/protobuf"
import { timestampFromDate } from "@bufbuild/protobuf/wkt"
import { bindMcpIcon, parseMcpIcon, projectMcpIcon, projectMcpIconBinding, type McpIconOperation } from "../src/infrastructure/clients/platform/mcp-icon.js"
import { McpPersonalConnectClient } from "../src/infrastructure/clients/platform/mcp-personal-connect.js"
import {
  PersonalMcpIconIntentSchema,
  GetPersonalMcpIconIntentResponseSchema,
  ProductMcpPersonalService,
} from "../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"

const id = "12345678-1234-1234-1234-123456789abc"
const scope = { tenant: "tenant-1", subject: "subject-1", requestId: "request-1", commandId: "original-command-key" }
const bytes = (v: unknown) => Buffer.from(JSON.stringify(v))
const at = timestampFromDate(new Date("2026-10-25T05:00:00Z"))
const metadata = {
  intentId: id,
  state: 3,
  stateVersion: 2n,
  filename: "图标.png",
  mimeType: "image/png",
  contentSha256: "a".repeat(64),
  sizeBytes: 1024n,
  expiresAt: at,
  expired: false,
  width: 24,
  height: 24,
  createdAt: at,
  updatedAt: at,
}
const preview = { url: "https://storage.example/icon?signature=ephemeral", method: "GET", requiredHeaders: {}, expiresAt: at }

test("all published icon command vectors match owner JCS without trusting browser identity", async () => {
  const manifest = JSON.parse(await readFile(new URL("../contract/dependencies/platform-connect.json", import.meta.url), "utf8"))
  const vectors = JSON.parse(
    await readFile(
      new URL(`../contract/vendor/kokoro-platform/${manifest.owner.repository_commit}/execution-operations/mcp-icon-request-vectors-v1.json`, import.meta.url),
      "utf8",
    ),
  )
  const operations = {
    BeginPersonalMcpIconUpload: "beginIcon",
    CompletePersonalMcpIconUpload: "completeIcon",
    CancelPersonalMcpIconIntent: "cancelIcon",
    ImportPersonalMcpIconUrl: "importIcon",
  } as const
  for (const v of vectors.vectors) {
    const { request_id, command, intent_id, ...body } = v.request
    const operation = operations[v.method as keyof typeof operations]
    const fields = parseMcpIcon(operation, bytes(body))
    const input = {
      ...scope,
      tenant: v.identity.tenantId,
      subject: v.identity.subjectId,
      requestId: request_id,
      commandId: command.command_id,
      ...(intent_id === undefined ? {} : { intentId: intent_id }),
      ...fields,
    }
    assert.equal(bindMcpIcon(operation, input).requestDigest, v.sha256)
    assert.equal(bindMcpIcon(operation, { ...input, requestId: "other-request", commandId: "other-command" }).requestDigest, v.sha256)
    assert.notEqual(bindMcpIcon(operation, { ...input, subject: "someone-else" }).requestDigest, v.sha256)
  }
  assert.equal(vectors.vectors.length, 8)
})

test("icon input rejects lexical CAS/size drift, forged authority, duplicate members and ambiguous source versions", () => {
  const valid = { filename: "icon.png", mime_type: "image/png", content_sha256: "a".repeat(64), size_bytes: "1024" }
  for (const bad of [
    { ...valid, size_bytes: 1024 },
    { ...valid, size_bytes: "01024" },
    { ...valid, size_bytes: "1048577" },
    { ...valid, tenant_id: "other" },
    { ...valid, mime_type: "image/svg+xml" },
  ])
    assert.throws(() => parseMcpIcon("beginIcon", bytes(bad)))
  for (const bad of [
    { expected_state_version: 3, source_version_id: "one" },
    { expected_state_version: "2147483647", source_version_id: "one" },
    { expected_state_version: "3", source_version_id: "null" },
  ])
    assert.throws(() => parseMcpIcon("completeIcon", bytes(bad)))
  assert.throws(() => parseMcpIcon("cancelIcon", Buffer.from('{"expected_state_version":"2","expected_state_version":"3"}')))
  for (const image_url of ["http://images.example/icon.png", "https://user:pass@images.example/icon.png", "https://images.example/icon.png#fragment"])
    assert.throws(() => parseMcpIcon("importIcon", bytes({ image_url })))
})

test("safe intent and current binding project fresh references, reject foreign IDs and unknown wire, and never return Storage facts", () => {
  const raw = create(GetPersonalMcpIconIntentResponseSchema, { intent: create(PersonalMcpIconIntentSchema, metadata), previewReference: preview })
  const result = projectMcpIcon("getIcon", raw, { ...scope, intentId: id }) as { intent: Record<string, unknown> }
  assert.equal(result.intent.state_version, "2")
  assert.equal(result.intent.state, "ready")
  raw.intent!.stateVersion = 2147483647n
  assert.equal((projectMcpIcon("getIcon", raw, { ...scope, intentId: id }) as { intent: { state_version: string } }).intent.state_version, "2147483647")
  raw.intent!.stateVersion = 2n
  assert.throws(() => projectMcpIcon("getIcon", raw, { ...scope, intentId: "other" }))
  raw.intent!.$unknown = [{ no: 100, wireType: 2, data: new Uint8Array([0]) }]
  assert.throws(() => projectMcpIcon("getIcon", raw, scope))
  const projected = projectMcpIconBinding({ ...metadata, previewReference: preview, assetRef: "must-not-leak", sourceVersionId: "must-not-leak" })
  assert.equal(JSON.stringify(projected).includes("must-not-leak"), false)
  assert.throws(() => projectMcpIconBinding({ ...metadata, previewReference: { ...preview, method: "PUT" } }))
  assert.throws(() => projectMcpIconBinding({ ...metadata, previewReference: { ...preview, requiredHeaders: { authorization: "must-not-leak" } } }))
})

test("five native icon operations use existing trusted service envelope and cancellation budget, without touching connector RPCs", async () => {
  const seen: string[] = []
  const reply = (request: { requestId: string }, context: { requestHeader: Headers; responseHeader: Headers }) => {
    assert.equal(context.requestHeader.get("x-kokoro-tenant"), scope.tenant)
    assert.equal(context.requestHeader.get("x-kokoro-subject"), scope.subject)
    assert.equal(context.requestHeader.get("authorization"), "Bearer owner-service-token")
    context.responseHeader.set("cache-control", "no-store")
    context.responseHeader.set("x-kokoro-request-id", request.requestId)
  }
  const upstream = createServer(
    connectNodeAdapter({
      routes: (router) =>
        router.service(ProductMcpPersonalService, {
          beginPersonalMcpIconUpload(request, context) {
            reply(request, context)
            seen.push("begin")
            assert.equal(
              request.command?.requestDigest,
              bindMcpIcon("beginIcon", { ...scope, filename: "icon.png", mimeType: "image/png", contentSha256: "a".repeat(64), sizeBytes: "1024" })
                .requestDigest,
            )
            return {
              intent: { ...metadata, filename: request.filename, state: 1, stateVersion: 1n, width: undefined, height: undefined },
              uploadReference: { ...preview, method: "PUT", requiredHeaders: { "content-type": "image/png" } },
              replayed: false,
            }
          },
          completePersonalMcpIconUpload(request, context) {
            reply(request, context)
            seen.push("complete")
            assert.equal(request.sourceVersionId, "exact-upload-version")
            assert.equal(request.expectedStateVersion, 1n)
            return { intent: metadata, replayed: false }
          },
          getPersonalMcpIconIntent(request, context) {
            reply(request, context)
            seen.push("get")
            return { intent: metadata, previewReference: preview }
          },
          cancelPersonalMcpIconIntent(request, context) {
            reply(request, context)
            seen.push("cancel")
            return { intent: { ...metadata, state: 6, stateVersion: 4n }, replayed: false }
          },
          importPersonalMcpIconUrl(request, context) {
            reply(request, context)
            seen.push("import")
            assert.equal(request.imageUrl, "https://images.example/icon.png")
            return { intent: metadata, replayed: true }
          },
        }),
    }),
  )
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))
  const address = upstream.address()
  assert.ok(address && typeof address !== "string")
  const client = new McpPersonalConnectClient(`http://127.0.0.1:${address.port}`, { get: async () => "owner-service-token" })
  try {
    for (const operation of ["beginIcon", "completeIcon", "getIcon", "importIcon", "cancelIcon"] as McpIconOperation[]) {
      const input = {
        ...scope,
        intentId: id,
        filename: "icon.png",
        mimeType: "image/png" as const,
        contentSha256: "a".repeat(64),
        sizeBytes: "1024",
        expectedStateVersion: "1",
        sourceVersionId: "exact-upload-version",
        imageUrl: "https://images.example/icon.png",
      }
      const value = (await client.icon(operation, input, new AbortController().signal, performance.now() + 3000)) as { intent: { intent_id: string } }
      assert.equal(value.intent.intent_id, id)
    }
    const aborted = new AbortController()
    aborted.abort()
    await assert.rejects(client.icon("getIcon", { ...scope, intentId: id }, aborted.signal, performance.now() + 3000))
    assert.deepEqual(seen, ["begin", "complete", "get", "import", "cancel"])
  } finally {
    client.close()
    upstream.closeAllConnections()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  }
})

test("icon command ACKs respect qualified outcome and original CAS; expired or bound Begin never grants a PUT", () => {
  for (const [operation, change, fields, ref] of [
    ["cancelIcon", { state: 3 }, { expectedStateVersion: "1" }, undefined],
    ["completeIcon", { state: 1 }, { expectedStateVersion: "1" }, undefined],
    ["importIcon", { state: 2 }, {}, undefined],
    ["beginIcon", { state: 4 }, {}, { ...preview, method: "PUT" }],
    ["beginIcon", { state: 1, expired: true }, {}, { ...preview, method: "PUT" }],
    ["completeIcon", { stateVersion: 2n }, { expectedStateVersion: "2" }, undefined],
  ] as const)
    assert.throws(() =>
      projectMcpIcon(
        operation,
        { intent: create(PersonalMcpIconIntentSchema, { ...metadata, ...change }), replayed: false, ...(ref === undefined ? {} : { uploadReference: ref }) },
        { ...scope, intentId: id, ...fields },
      ),
    )
  for (const state of [3, 4, 5, 6])
    assert.doesNotThrow(() =>
      projectMcpIcon(
        "completeIcon",
        { intent: create(PersonalMcpIconIntentSchema, { ...metadata, state, stateVersion: 4n }), replayed: true },
        { ...scope, intentId: id, expectedStateVersion: "1" },
      ),
    )
})
