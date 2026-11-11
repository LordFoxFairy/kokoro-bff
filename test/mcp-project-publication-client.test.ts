import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { once } from "node:events"
import { createServer } from "node:http"
import { create, toJson, type Message } from "@bufbuild/protobuf"
import { timestampFromDate } from "@bufbuild/protobuf/wkt"
import { Code, ConnectError, type HandlerContext } from "@connectrpc/connect"
import { connectNodeAdapter } from "@connectrpc/connect-node"
import * as p from "../src/generated/platform-connect/kokoro/platform/v1/mcp_project_publication_pb.js"
import {
  publicationCommand,
  publicationFault,
  type PublicationCall,
  type PublicationMutation,
} from "../src/infrastructure/clients/platform/mcp-project-publication.js"
import { McpProjectPublicationConnectClient } from "../src/infrastructure/clients/platform/mcp-project-publication-connect.js"

const identity = { tenant: "tenant-publication", subject: "subject-publication", requestId: "request-1" }
const publish: PublicationMutation = {
  kind: "publish",
  commandId: "command-1",
  input: {
    server_id: "server-1",
    connector_id: "connector-1",
    expected_source_state_version: "7",
    targets: [
      { project_id: "project-2", expected_pin: { current: { pin_id: "pin-2", state_version: "3" } } },
      { project_id: "project-1", expected_pin: { absent: true } },
    ],
  },
}
const remove: PublicationMutation = { kind: "remove", commandId: "command-2", input: { project_id: "project-1", pin_id: "pin-1", expected_state_version: "3" } }
test("command digest matches both exact owner vectors, canonicalizes target order and freezes scope/CAS, not request ID/key", async () => {
  const vectors = JSON.parse(
    await readFile(
      new URL("../contract/vendor/kokoro-platform/dd8d536a28059cbdbe0674debc47bf28d039fb47/mcp-project-publication/v1/request-vectors.json", import.meta.url),
      "utf8",
    ),
  )
  for (const [index, call] of [publish, remove].entries()) {
    const digest = publicationCommand(identity, call).requestDigest
    assert.equal(digest, vectors[index].request_digest)
    assert.equal(publicationCommand({ ...identity, requestId: "other" }, { ...call, commandId: "other" }).requestDigest, digest)
    assert.notEqual(publicationCommand({ ...identity, subject: "other" }, call).requestDigest, digest)
    assert.notEqual(publicationCommand({ ...identity, tenant: "other" }, call).requestDigest, digest)
  }
  assert.equal(
    publicationCommand(identity, { ...publish, input: { ...publish.input, targets: [...publish.input.targets].reverse() } }).requestDigest,
    vectors[0].request_digest,
  )
})
const timestamp = () => timestampFromDate(new Date("2026-10-25T00:00:00.000Z"))
const revision = () =>
  create(p.McpUrlRevisionSummarySchema, {
    revisionId: "revision-1",
    serverId: "server-1",
    connectorId: "connector-1",
    contentDigest: "a".repeat(64),
    sourceStateVersion: 7n,
    displayName: "URL definition",
    createdAt: timestamp(),
  })
const pin = (id = "1", removed = false) =>
  create(p.McpProjectPinSchema, {
    pinId: `pin-${id}`,
    projectId: `project-${id}`,
    revision: revision(),
    stateVersion: id === "1" && !removed ? 1n : 4n,
    removed,
    updatedAt: timestamp(),
    executionReady: false,
  })
const published = () => create(p.PublishMcpUrlToProjectsResponseSchema, { revision: revision(), pins: [pin("1"), pin("2")], replayed: false })
async function fixture(t: import("node:test").TestContext) {
  const state = { mode: "valid", token: "fixture-token-1", credentials: 0 },
    calls: { method: string; input: unknown }[] = []
  let startedResolve = () => {}
  const started = new Promise<void>((resolve) => {
    startedResolve = resolve
  })
  async function response<T extends Message>(value: T, request: Message & { requestId: string }, context: HandlerContext): Promise<T> {
    assert.equal(context.requestHeader.get("authorization"), `Bearer ${state.token}`)
    assert.equal(context.requestHeader.get("x-kokoro-tenant"), identity.tenant)
    assert.equal(context.requestHeader.get("x-kokoro-subject"), identity.subject)
    calls.push({ method: context.method.name, input: toJson(context.method.input, request) })
    startedResolve()
    if (state.mode === "wait")
      await new Promise<void>((resolve) => {
        if (context.signal.aborted) resolve()
        else context.signal.addEventListener("abort", () => resolve(), { once: true })
      })
    context.responseHeader.set("x-request-id", state.mode === "correlation" ? "other" : request.requestId)
    if (state.mode !== "cache") context.responseHeader.set("cache-control", "no-store")
    if (state.mode === "unknown") value.$unknown = [{ no: 99, wireType: 0, data: new Uint8Array([1]) }]
    if (state.mode === "receipt-error") throw new ConnectError("secret", Code.AlreadyExists, { "x-kokoro-error-code": "command_receipt_identity_conflict" })
    return value
  }
  const server = createServer(
    connectNodeAdapter({
      routes(router) {
        router.service(p.ProductMcpProjectPublicationService, {
          publishMcpUrlToProjects(request, ctx) {
            const value = published()
            if (state.mode === "ready") value.pins[0]!.executionReady = true
            if (state.mode === "missing-ready") value.pins[0]!.executionReady = undefined
            if (state.mode === "missing-revision") value.revision = undefined
            if (state.mode === "zero-version") value.revision!.sourceStateVersion = 0n
            if (state.mode === "unknown-nested") value.pins[0]!.revision!.$unknown = [{ no: 99, wireType: 0, data: new Uint8Array([1]) }]
            if (state.mode === "timestamp") value.revision!.createdAt!.nanos = -1
            return response(value, request, ctx)
          },
          listProjectMcpPins: (request, ctx) =>
            response(create(p.ListProjectMcpPinsResponseSchema, { pins: [pin("1", true)], nextCursor: "next_cursor" }), request, ctx),
          removeProjectMcpPin: (request, ctx) => response(create(p.RemoveProjectMcpPinResponseSchema, { pin: pin("1", true) }), request, ctx),
          getMcpProjectPublicationReceipt: (request, ctx) =>
            response(
              create(p.GetMcpProjectPublicationReceiptResponseSchema, {
                result:
                  request.original.case === "publication"
                    ? { case: "publication", value: { ...published(), replayed: true } }
                    : { case: "removal", value: { pin: pin("1", true), replayed: true } },
              }),
              request,
              ctx,
            ),
        })
      },
    }),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  const client = new McpProjectPublicationConnectClient(`http://127.0.0.1:${address.port}`, {
    get: async (tenant, signal) => {
      assert.equal(tenant, identity.tenant)
      signal?.throwIfAborted()
      state.credentials++
      return state.token
    },
  })
  t.after(async () => {
    client.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  return {
    state,
    calls,
    client,
    started,
    execute: (call: PublicationCall) => client.execute(identity, call, new AbortController().signal, performance.now() + 2000),
  }
}

test("native binary client executes four named operations, sends original digest only to receipt read and reads fresh credentials", async (t) => {
  const f = await fixture(t)
  await f.execute(publish)
  f.state.token = "fixture-token-2"
  await f.execute({ kind: "list", projectId: "project-1", limit: 5, cursor: "previous" })
  await f.execute(remove)
  await f.execute({ kind: "receipt", original: publish })
  await f.execute({ kind: "receipt", original: remove })
  assert.deepEqual(
    f.calls.map((v) => v.method),
    ["PublishMcpUrlToProjects", "ListProjectMcpPins", "RemoveProjectMcpPin", "GetMcpProjectPublicationReceipt", "GetMcpProjectPublicationReceipt"],
  )
  assert.equal(f.state.credentials, 5)
  const sent = f.calls[0]!.input as Record<string, unknown>
  assert.deepEqual((f.calls[3]!.input as { publication: unknown }).publication, sent)
  assert.deepEqual(sent.command, publicationCommand(identity, publish))
  assert.deepEqual(Object.keys(sent).sort(), ["command", "connectorId", "expectedSourceStateVersion", "requestId", "serverId", "targets"])
})
for (const mode of ["ready", "missing-ready", "missing-revision", "zero-version", "timestamp", "unknown", "unknown-nested", "correlation", "cache"])
  test(`native client rejects ${mode} without granting definition/execution success`, async (t) => {
    const f = await fixture(t)
    f.state.mode = mode
    await assert.rejects(f.execute(publish), /mcp_project_publication_response_invalid/)
    assert.equal(f.calls.length, 1)
  })
test("client preserves published receipt markers for closed HTTP mapping, with no hidden retry", async (t) => {
  const f = await fixture(t)
  f.state.mode = "receipt-error"
  await assert.rejects(f.execute(publish), (error) => {
    assert.equal(publicationFault(error, true).status, 409)
    return true
  })
  assert.equal(f.calls.length, 1)
})
test("retired, aborted and exhausted clients never start owner traffic", async (t) => {
  const f = await fixture(t)
  await assert.rejects(f.client.execute(identity, publish, AbortSignal.abort(), performance.now() + 1000))
  await assert.rejects(f.client.execute(identity, publish, new AbortController().signal, performance.now() - 1))
  f.client.close()
  await assert.rejects(f.execute(publish))
  assert.equal(f.calls.length, 0)
  assert.equal(f.state.credentials, 0)
})

for (const end of ["abort", "close", "deadline"])
  test(`in-flight ${end} remains unknown and performs no retry`, async (t) => {
    const f = await fixture(t)
    f.state.mode = "wait"
    const controller = new AbortController()
    const pending = f.client.execute(identity, publish, controller.signal, performance.now() + (end === "deadline" ? 50 : 2000))
    const rejected = assert.rejects(pending)
    await f.started
    if (end === "abort") controller.abort()
    if (end === "close") f.client.close()
    await rejected
    assert.equal(f.calls.length, 1)
  })
