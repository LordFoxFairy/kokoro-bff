import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { mcpPackageAdminCommand, type McpPackageAdminInput } from "../src/infrastructure/clients/platform/mcp-package-admin-input.js"
const identity = { tenantId: "tenant-1", subjectId: "publisher-1", requestId: "request-1" }
const source = { packageId: "package-1", uploadId: "upload-1", uploadSourceVersionId: "source-1", contentSha256: "b".repeat(64), sizeBytes: "104" }
const key = { commandId: "command-1" }
const inputs: McpPackageAdminInput[] = [
  { kind: "begin", packageId: source.packageId, filename: "fixture.zip", contentSha256: source.contentSha256, sizeBytes: source.sizeBytes, ...key },
  { kind: "complete", ...source, ...key },
  { kind: "abort", packageId: source.packageId, uploadId: source.uploadId, reason: "cancelled", ...key },
  { kind: "publish", ...source, ...key, providerKey: "fixture", assetId: "asset-1" },
]

test("matches every published owner digest vector and scopes command meaning without correlation or key changes", async () => {
  const vectors = JSON.parse(
    await readFile(
      new URL("../contract/vendor/kokoro-platform/883d7713556b8cee9d41b9c9d904931715033808/mcp-package-admin/v1/request-vectors.json", import.meta.url),
      "utf8",
    ),
  ) as { vectors: { sha256: string }[] }
  for (const [index, input] of inputs.entries()) {
    if (input.kind === "status") throw new Error("command fixture expected")
    const command = mcpPackageAdminCommand(identity, input)
    assert.equal(command.commandId, key.commandId)
    assert.equal(command.requestDigest, vectors.vectors[index]?.sha256)
    assert.deepEqual(mcpPackageAdminCommand({ ...identity, requestId: "new-request" }, input), command)
    assert.equal(mcpPackageAdminCommand(identity, { ...input, commandId: "new-key" }).requestDigest, command.requestDigest)
    assert.notEqual(mcpPackageAdminCommand({ ...identity, subjectId: "different" }, input).requestDigest, command.requestDigest)
    assert.notEqual(mcpPackageAdminCommand({ ...identity, tenantId: "different" }, input).requestDigest, command.requestDigest)
    assert.notEqual(mcpPackageAdminCommand(identity, { ...input, packageId: "different" }).requestDigest, command.requestDigest)
  }
})

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createServer } from "node:http"
import { create, toJson, type DescMessage, type Message, type MessageInitShape } from "@bufbuild/protobuf"
import { timestampFromDate } from "@bufbuild/protobuf/wkt"
import { Code, ConnectError, type HandlerContext } from "@connectrpc/connect"
import { connectNodeAdapter } from "@connectrpc/connect-node"
import * as p from "../src/generated/platform-connect/kokoro/platform/v1/mcp_package_admin_pb.js"
import { McpPackageAdminConnectClient } from "../src/infrastructure/clients/platform/mcp-package-admin-connect.js"
import { PlatformServiceCredentialSource } from "../src/infrastructure/clients/platform/platform-service-credential.js"
import { configureBffProtobufTextEncoding } from "../src/infrastructure/protobuf-text-encoding.js"
configureBffProtobufTextEncoding()
const versionId = "11111111-1111-4111-8111-111111111111",
  serverId = "22222222-2222-4222-8222-222222222222"
async function fixture(t: import("node:test").TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "owned-bff-mcp-package-")),
    file = join(directory, "credentials.json")
  const state = { token: "fixture-mcp-admin-secret-000000000000", mode: "valid", cancelled: false, reads: 0 }
  const write = async (purpose = "mcp_admin") =>
    writeFile(
      file,
      JSON.stringify({
        version: 1,
        entries: [{ credential_id: "fixture-admin", secret: state.token, caller: "kokoro-bff", surfaces: [purpose], tenant_id: identity.tenantId }],
      }),
      { mode: 0o600 },
    )
  await write()
  const calls: { method: string; body: unknown; header: Record<string, string> }[] = []
  async function respond<S extends DescMessage>(schema: S, value: MessageInitShape<S>, request: Message & { requestId: string }, context: HandlerContext) {
    assert.equal(context.protocolName, "connect")
    assert.equal(context.requestHeader.get("authorization"), `Bearer ${state.token}`)
    calls.push({ method: context.method.name, body: toJson(context.method.input, request), header: Object.fromEntries(context.requestHeader) })
    context.responseHeader.set("x-request-id", request.requestId)
    context.responseHeader.set("x-kokoro-request-id", request.requestId)
    if (state.mode !== "cache") context.responseHeader.set("cache-control", "no-store")
    if (state.mode === "receipt")
      throw new ConnectError("private secret", Code.AlreadyExists, { "x-kokoro-error-code": "command_receipt_identity_conflict", "x-private": "secret" })
    if (state.mode === "limit-content" || state.mode === "limit-transfer")
      throw new ConnectError("private secret", state.mode === "limit-content" ? Code.FailedPrecondition : Code.ResourceExhausted, {
        "x-kokoro-error-code": "package_limit_exceeded",
        "x-private": "secret",
      })
    if (state.mode === "failure") throw new ConnectError("private URL/token secret", Code.Unavailable, { "x-private": "secret" })
    if (state.mode === "wait")
      await new Promise<void>((resolve) => {
        const abort = () => {
          state.cancelled = true
          resolve()
        }
        if (context.signal.aborted) abort()
        else context.signal.addEventListener("abort", abort, { once: true })
      })
    const message = create(schema, value)
    if (state.mode === "unknown") message.$unknown = [{ no: 100, wireType: 2, data: new Uint8Array([0]) }]
    return message
  }
  const snapshot = () => ({
    uploadId: source.uploadId,
    state: p.McpPackageUploadState.COMPLETED,
    contentSha256: source.contentSha256,
    sizeBytes: 104n,
    uploadSourceVersionId: source.uploadSourceVersionId,
    assetId: "asset-1",
    scanState: p.McpPackageScanState.PENDING,
  })
  const adapter = connectNodeAdapter({
    routes: (router) =>
      router.service(p.McpPackageAdminService, {
        beginMcpPackageUpload: (request, context) =>
          respond(
            p.BeginMcpPackageUploadResponseSchema,
            {
              packageId: state.mode === "wrong" ? "wrong" : request.packageId,
              uploadId: source.uploadId,
              transferReference: {
                method: "PUT",
                url: "https://objects.example.test/object?signature=" + (state.mode === "large" ? "x".repeat(32769) : "fixture"),
                expiresAt: timestampFromDate(new Date(Date.now() + (state.mode === "expired" ? -1000 : 60_000))),
                requiredHeaders: state.mode === "header" ? { "x-kokoro-internal-secret": "secret" } : { "content-type": "application/zip" },
              },
            },
            request,
            context,
          ),
        completeMcpPackageUpload: (request, context) =>
          respond(
            p.CompleteMcpPackageUploadResponseSchema,
            { upload: { ...snapshot(), uploadSourceVersionId: state.mode === "wrong" ? "wrong" : source.uploadSourceVersionId } },
            request,
            context,
          ),
        getMcpPackageUploadStatus: (request, context) =>
          respond(
            p.GetMcpPackageUploadStatusResponseSchema,
            { upload: { ...snapshot(), scanState: state.mode === "enum" ? 99 : p.McpPackageScanState.PENDING } },
            request,
            context,
          ),
        abortMcpPackageUpload: (request, context) =>
          respond(p.AbortMcpPackageUploadResponseSchema, { uploadId: request.uploadId, state: p.McpPackageUploadState.ABORTED }, request, context),
        publishMcpPackage: (request, context) =>
          respond(
            p.PublishMcpPackageResponseSchema,
            { packageVersionId: state.mode === "uuid" ? versionId + "\n" : versionId, serverId, replayed: false },
            request,
            context,
          ),
      }),
  })
  const server = createServer(adapter)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("listener missing")
  const credentials = new PlatformServiceCredentialSource(file, "mcp_admin")
  const client = new McpPackageAdminConnectClient(`http://127.0.0.1:${address.port}`, {
    get: async (...args) => {
      state.reads++
      return credentials.get(...args)
    },
  })
  t.after(async () => {
    client.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  })
  const execute = (input: McpPackageAdminInput, signal = new AbortController().signal, deadlineAt = performance.now() + 5000) =>
    client.execute(identity, input, signal, deadlineAt)
  return { state, calls, write, client, execute }
}

test("uses five exact Native mappings, current credentials and original command retry without uploading or persisting bytes", async (t) => {
  const f = await fixture(t)
  for (const input of inputs) {
    const result = await f.execute(input)
    assert.equal(result.kind, input.kind)
    if (result.kind === "begin") assert.equal(result.transfer_reference.method, "PUT")
    if (result.kind === "complete") assert.equal(result.upload.scan_state, "pending")
    if (result.kind === "publish") assert.deepEqual(result, { kind: "publish", package_version_id: versionId, server_id: serverId, replayed: false })
  }
  const status: McpPackageAdminInput = { kind: "status", packageId: source.packageId, uploadId: source.uploadId }
  const result = await f.execute(status)
  assert.equal(result.kind, "status")
  assert.equal(f.calls.length, 5)
  for (const call of f.calls) {
    assert.equal(call.header["x-kokoro-tenant"], identity.tenantId)
    assert.equal(call.header["x-kokoro-subject"], identity.subjectId)
    assert.equal(call.header["x-kokoro-request-id"], identity.requestId)
    assert.equal("tenantId" in (call.body as object), false)
  }
  f.state.token = "fixture-mcp-admin-rotated-000000000000"
  await f.write()
  await f.execute(status)
  f.state.mode = "failure"
  await assert.rejects(f.execute(inputs[0]!), (error) => {
    assert.ok(error instanceof ConnectError)
    assert.equal(error.code, Code.Unavailable)
    assert.equal(error.metadata.get("x-private"), null)
    assert.doesNotMatch(error.rawMessage, /secret|private URL/u)
    return true
  })
  const count = f.calls.length
  f.state.mode = "valid"
  await f.execute(inputs[0]!)
  assert.equal(f.calls.length, count + 1)
  const last = f.calls.slice(-2).map((call) => (call.body as { command: { commandId: string } }).command.commandId)
  assert.deepEqual(last, [key.commandId, key.commandId])
  f.state.mode = "receipt"
  await assert.rejects(
    f.execute(inputs[3]!),
    (error) =>
      error instanceof ConnectError &&
      error.code === Code.AlreadyExists &&
      error.metadata.get("x-kokoro-error-code") === "command_receipt_identity_conflict" &&
      error.metadata.get("x-private") === null,
  )
  for (const [mode, code] of [
    ["limit-content", Code.FailedPrecondition],
    ["limit-transfer", Code.ResourceExhausted],
  ] as const) {
    f.state.mode = mode
    await assert.rejects(f.execute(inputs[3]!), (error) => {
      assert.ok(error instanceof ConnectError)
      assert.equal(error.code, code)
      assert.equal(error.metadata.get("x-kokoro-error-code"), "package_limit_exceeded")
      assert.equal(error.metadata.get("x-private"), null)
      assert.doesNotMatch(error.rawMessage, /private|secret/u)
      return true
    })
  }
  f.state.mode = "valid"
  const mutable = {
    kind: "begin" as const,
    packageId: source.packageId,
    commandId: key.commandId,
    filename: "fixture.zip",
    contentSha256: source.contentSha256,
    sizeBytes: "104",
  }
  const pending = f.execute(mutable)
  mutable.filename = "changed.zip"
  await pending
  assert.equal((f.calls.at(-1)?.body as { filename: string }).filename, "fixture.zip")
})

test("rejects bad owner bindings, unknown fields, transfer material and credential purpose without fabricating state", async (t) => {
  const f = await fixture(t)
  const status: McpPackageAdminInput = { kind: "status", packageId: source.packageId, uploadId: source.uploadId }
  for (const [mode, input] of [
    ["wrong", inputs[0]!],
    ["expired", inputs[0]!],
    ["header", inputs[0]!],
    ["wrong", inputs[1]!],
    ["enum", status],
    ["unknown", status],
    ["cache", status],
    ["uuid", inputs[3]!],
  ] as const) {
    f.state.mode = mode
    await assert.rejects(f.execute(input), (error) => error instanceof ConnectError && error.code === Code.DataLoss)
  }
  f.state.mode = "large"
  await assert.rejects(f.execute(inputs[0]!), (error) => error instanceof ConnectError && error.code === Code.ResourceExhausted)
  const before = f.calls.length
  await f.write("catalog")
  await assert.rejects(f.execute(status), (error) => error instanceof ConnectError && error.code === Code.Unavailable)
  assert.equal(f.calls.length, before)
  await assert.rejects(
    f.execute({ ...inputs[0]!, tenantId: "forged" } as never),
    (error) => error instanceof ConnectError && error.code === Code.InvalidArgument,
  )
  assert.equal(f.calls.length, before)
})

test("inherits the caller deadline and propagates abort/close without late owner writes", async (t) => {
  const f = await fixture(t),
    status: McpPackageAdminInput = { kind: "status", packageId: source.packageId, uploadId: source.uploadId }
  f.state.mode = "wait"
  await assert.rejects(
    f.execute(status, new AbortController().signal, performance.now() + 60),
    (error) => error instanceof ConnectError && error.code === Code.DeadlineExceeded,
  )
  for (let i = 0; i < 100 && !f.state.cancelled; i++) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(f.state.cancelled, true)
  const controller = new AbortController()
  controller.abort()
  const before = f.calls.length
  await assert.rejects(f.execute(status, controller.signal), (error) => error instanceof ConnectError && error.code === Code.Canceled)
  assert.equal(f.calls.length, before)
  f.state.cancelled = false
  const inFlight = f.execute(status)
  for (let i = 0; i < 100 && f.calls.length === before; i++) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(f.calls.length, before + 1)
  f.client.close()
  await assert.rejects(inFlight, (error) => error instanceof ConnectError && error.code === Code.Unavailable)
  await assert.rejects(f.execute(status), (error) => error instanceof ConnectError && error.code === Code.Unavailable)
  assert.equal(f.calls.length, before + 1)
})
