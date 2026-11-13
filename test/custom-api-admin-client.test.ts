import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { create, toJson, type DescMessage, type Message, type MessageInitShape } from "@bufbuild/protobuf"
import { timestampFromDate } from "@bufbuild/protobuf/wkt"
import { Code, ConnectError, type HandlerContext } from "@connectrpc/connect"
import { connectNodeAdapter } from "@connectrpc/connect-node"
import * as p from "../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { bindCustomApiAdminCommand } from "../src/infrastructure/clients/platform/custom-api-admin-command-binding.js"
import { CustomApiAdminConnectClient, type CustomApiAdminInput } from "../src/infrastructure/clients/platform/custom-api-admin-connect.js"
import { PlatformServiceCredentialSource } from "../src/infrastructure/clients/platform/platform-service-credential.js"
import { configureBffProtobufTextEncoding } from "../src/infrastructure/protobuf-text-encoding.js"
configureBffProtobufTextEncoding()
const identity = { tenantId: "tenant-1", subjectId: "admin-1", requestId: "request-1" }
const command = { profileId: "profile-1", commandId: "command-1", expectedStateVersion: "3", reasonCode: "security_review" as const }
const mutations = ["quarantine", "restore", "revoke"] as const

test("matches complete owner JCS binding; correlation/key do not rewrite original command meaning", () => {
  for (const [index, kind] of mutations.entries()) {
    const action = ["quarantined", "restored", "revoked"][index]!,
      method = ["Quarantine", "Restore", "Revoke"][index]!
    const canonical = `{"actor_id":"admin-1","input":{"action":"${action}","expected_state_version":"3","profile_id":"profile-1","reason_code":"security_review"},"method":"kokoro.platform.v1.CustomApiAdminService/${method}AdminCustomApi","tenant_id":"tenant-1"}`
    const expected = createHash("sha256").update(canonical).digest("hex")
    const bound = bindCustomApiAdminCommand(identity, { kind, ...command })
    assert.deepEqual(bound, { commandId: command.commandId, requestDigest: expected })
    assert.deepEqual(bindCustomApiAdminCommand({ ...identity, requestId: "request-2" }, { kind, ...command }), bound)
    assert.equal(bindCustomApiAdminCommand(identity, { kind, ...command, commandId: "new-key" }).requestDigest, expected)
    for (const changed of [
      { ...identity, tenantId: "other" },
      { ...identity, subjectId: "owner-1" },
    ])
      assert.notEqual(bindCustomApiAdminCommand(changed, { kind, ...command }).requestDigest, expected)
    for (const changed of [
      { ...command, profileId: "other" },
      { ...command, expectedStateVersion: "4" },
      { ...command, reasonCode: "operator_request" as const },
    ])
      assert.notEqual(bindCustomApiAdminCommand(identity, { kind, ...changed }).requestDigest, expected)
  }
})

async function fixture(t: import("node:test").TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "bff-custom-api-admin-")),
    path = join(dir, "credentials.json")
  const state = { mode: "valid", token: "fixture-custom-api-admin-000000000000", reads: 0, cancelled: false }
  const write = (purpose = "custom_api_admin", tenant = identity.tenantId) =>
    writeFile(
      path,
      JSON.stringify({ version: 1, entries: [{ credential_id: "admin", caller: "kokoro-bff", surfaces: [purpose], tenant_id: tenant, secret: state.token }] }),
      { mode: 0o600 },
    )
  await write()
  const calls: { method: string; body: unknown; headers: Record<string, string> }[] = []
  const time = timestampFromDate(new Date("2026-11-01T00:00:00.000Z"))
  const profile = () => ({
    profileId: { value: state.mode === "wrong" ? "other" : command.profileId },
    ownerUserId: "owner-1",
    name: "Safe profile",
    governanceStatus: state.mode === "enum" ? "unknown" : "revoked",
    stateVersion: 9n,
    createdAt: time,
    updatedAt: time,
  })
  const ack = (status: string) => ({
    profileId: { value: command.profileId },
    ownerUserId: "owner-1",
    governanceStatus: status,
    stateVersion: state.mode === "version" ? 9n : 4n,
    auditRef: "custom-api-audit:1",
    replayed: true,
  })
  async function respond<S extends DescMessage>(schema: S, value: MessageInitShape<S>, request: Message & { requestId: string }, context: HandlerContext) {
    calls.push({ method: context.method.name, body: toJson(context.method.input, request), headers: Object.fromEntries(context.requestHeader) })
    assert.equal(context.requestHeader.get("authorization"), `Bearer ${state.token}`)
    context.responseHeader.set("x-request-id", state.mode === "request" ? "wrong" : request.requestId)
    context.responseHeader.set("x-kokoro-request-id", request.requestId)
    if (state.mode !== "cache") context.responseHeader.set("cache-control", "no-store")
    if (state.mode === "failure") throw new ConnectError("private endpoint secret instructions", Code.Unavailable, { "x-private": "secret" })
    if (state.mode === "receipt")
      throw new ConnectError("private secret", Code.AlreadyExists, { "x-kokoro-error-code": "command_receipt_identity_conflict", "x-private": "secret" })
    if (state.mode === "receipt-unknown")
      throw new ConnectError("private secret", Code.AlreadyExists, { "x-kokoro-error-code": "unknown_receipt_marker", "x-private": "secret" })
    if (state.mode === "receipt-wrong-code")
      throw new ConnectError("private secret", Code.FailedPrecondition, { "x-kokoro-error-code": "command_receipt_identity_conflict", "x-private": "secret" })
    if (state.mode === "receipt-details")
      throw new ConnectError("private secret", Code.AlreadyExists, { "x-kokoro-error-code": "command_receipt_identity_conflict", "x-private": "secret" }, [
        { desc: p.CustomApiProfileIdSchema, value: { value: "private-secret" } },
      ])
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
    if (state.mode === "nested") {
      const child = (message as Message & { profile?: Message }).profile
      if (child) child.$unknown = [{ no: 100, wireType: 2, data: new Uint8Array([0]) }]
    }
    return message
  }
  const server = createServer(
    connectNodeAdapter({
      routes: (router) =>
        router.service(p.CustomApiAdminService, {
          listAdminCustomApis: (request, context) =>
            respond(p.ListAdminCustomApisResponseSchema, { profiles: [profile()], page: { nextCursor: "next_page" } }, request, context),
          getAdminCustomApi: (request, context) => respond(p.GetAdminCustomApiResponseSchema, { profile: profile() }, request, context),
          quarantineAdminCustomApi: (request, context) => respond(p.QuarantineAdminCustomApiResponseSchema, { ack: ack("quarantined") }, request, context),
          restoreAdminCustomApi: (request, context) => respond(p.RestoreAdminCustomApiResponseSchema, { ack: ack("active") }, request, context),
          revokeAdminCustomApi: (request, context) => respond(p.RevokeAdminCustomApiResponseSchema, { ack: ack("revoked") }, request, context),
          listAdminCustomApiAuditEvents: (request, context) =>
            respond(
              p.ListAdminCustomApiAuditEventsResponseSchema,
              {
                events: [
                  {
                    auditRef: "custom-api-audit:1",
                    profileId: { value: state.mode === "audit-profile" ? "other" : command.profileId },
                    ownerUserId: "owner-1",
                    actorId: "owner-1",
                    action: "deleted",
                    fromStatus: "revoked",
                    toStatus: "deleted",
                    fromVersion: 9n,
                    ...(state.mode === "audit-version" ? { toVersion: 10n } : {}),
                    commandId: "delete-command",
                    requestId: "delete-request",
                    reasonCode: "owner_delete",
                    occurredAt: time,
                  },
                ],
                page: {},
              },
              request,
              context,
            ),
        }),
    }),
  )
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("listener missing")
  const source = new PlatformServiceCredentialSource(path, "custom_api_admin")
  const client = new CustomApiAdminConnectClient(`http://127.0.0.1:${address.port}`, {
    get: async (...args) => {
      state.reads++
      return source.get(...args)
    },
  })
  t.after(async () => {
    client.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(dir, { recursive: true, force: true })
  })
  const execute = (input: CustomApiAdminInput, signal = new AbortController().signal, deadline = performance.now() + 5000) =>
    client.execute(identity, input, signal, deadline)
  return { state, calls, write, client, execute }
}

test("consumes all six native RPCs with fresh dedicated credentials and safe distinct current/ACK/deleted-audit projections", async (t) => {
  const f = await fixture(t)
  const list = await f.execute({ kind: "list", ownerUserId: "owner-1", governanceStatus: "revoked", limit: 1, cursor: "page_1" })
  assert.equal(list.kind, "list")
  if (list.kind === "list") {
    assert.equal(list.items[0]?.governance_status, "revoked")
    assert.equal(list.next_cursor, "next_page")
  }
  const current = await f.execute({ kind: "get", profileId: command.profileId })
  assert.equal(current.kind, "get")
  if (current.kind === "get")
    assert.deepEqual(Object.keys(current.profile).sort(), [
      "created_at",
      "governance_status",
      "name",
      "owner_user_id",
      "profile_id",
      "state_version",
      "updated_at",
    ])
  for (const kind of mutations) {
    const result = await f.execute({ kind, ...command })
    assert.ok("ack" in result)
    assert.equal(result.ack.state_version, "4")
    assert.equal(result.ack.replayed, true)
    assert.equal("profile" in result, false)
    const body = f.calls.at(-1)?.body as { command: unknown; expectedStateVersion: string }
    assert.equal(body.expectedStateVersion, "3")
    assert.deepEqual(body.command, bindCustomApiAdminCommand(identity, { kind, ...command }))
  }
  const before = f.calls.length
  const audit = await f.execute({ kind: "audit", profileId: command.profileId })
  assert.equal(f.calls.length, before + 1)
  assert.equal(f.calls.at(-1)?.method, "ListAdminCustomApiAuditEvents")
  if (audit.kind === "audit") {
    assert.equal(audit.items[0]?.action, "deleted")
    assert.equal("to_version" in audit.items[0]!, false)
  }
  assert.equal(f.state.reads, 6)
  for (const call of f.calls) {
    assert.equal(call.headers["x-kokoro-tenant"], identity.tenantId)
    assert.equal(call.headers["x-kokoro-subject"], identity.subjectId)
    assert.equal(call.headers.cookie, undefined)
    assert.equal(call.headers.origin, undefined)
    assert.equal(call.headers["x-kokoro-session-ref"], undefined)
    assert.equal("tenantId" in (call.body as object), false)
  }
  f.state.token = "fixture-rotated-custom-api-admin-000000"
  await f.write()
  await f.execute({ kind: "get", profileId: command.profileId })
  const mutable = { kind: "quarantine" as const, ...command }
  const pending = f.execute(mutable)
  mutable.reasonCode = "policy_violation" as never
  await pending
  assert.equal((f.calls.at(-1)?.body as { reasonCode: string }).reasonCode, "security_review")
})

test("fails closed on owner drift, wrong bindings, unsafe metadata and purpose fallback without retry", async (t) => {
  const f = await fixture(t),
    get = { kind: "get" as const, profileId: command.profileId }
  for (const mode of ["wrong", "enum", "unknown", "nested", "cache", "request"]) {
    f.state.mode = mode
    await assert.rejects(f.execute(get), (error) => error instanceof ConnectError && error.code === Code.DataLoss)
  }
  f.state.mode = "version"
  await assert.rejects(f.execute({ kind: "quarantine", ...command }), (error) => error instanceof ConnectError && error.code === Code.DataLoss)
  for (const mode of ["audit-profile", "audit-version"]) {
    f.state.mode = mode
    await assert.rejects(f.execute({ kind: "audit", profileId: command.profileId }), (error) => error instanceof ConnectError && error.code === Code.DataLoss)
  }
  f.state.mode = "failure"
  const count = f.calls.length
  await assert.rejects(f.execute({ kind: "quarantine", ...command }), (error) => {
    assert.ok(error instanceof ConnectError)
    assert.equal(error.code, Code.Unavailable)
    assert.equal(error.metadata.get("x-private"), null)
    assert.doesNotMatch(error.rawMessage, /private|endpoint|secret|instructions/u)
    return true
  })
  assert.equal(f.calls.length, count + 1)
  f.state.mode = "receipt"
  await assert.rejects(
    f.execute({ kind: "quarantine", ...command }),
    (error) =>
      error instanceof ConnectError &&
      error.metadata.get("x-kokoro-error-code") === "command_receipt_identity_conflict" &&
      error.metadata.get("x-private") === null,
  )
  f.state.mode = "valid"
  for (const purpose of ["custom_api_personal", "mcp_admin"]) {
    await f.write(purpose)
    const before = f.calls.length
    await assert.rejects(f.execute(get), (error) => error instanceof ConnectError && error.code === Code.Unavailable)
    assert.equal(f.calls.length, before)
  }
  await f.write("custom_api_admin", "different-tenant")
  await assert.rejects(f.execute(get), (error) => error instanceof ConnectError && error.code === Code.Unavailable)
  await f.write()
  const before = f.calls.length
  for (const input of [
    { ...get, subjectId: "forged" },
    { kind: "quarantine", ...command, expectedStateVersion: "03" },
    { kind: "quarantine", ...command, expectedStateVersion: "2147483647" },
    { ...get, instructions: "secret" },
  ])
    await assert.rejects(f.execute(input as never), (error) => error instanceof ConnectError && error.code === Code.InvalidArgument)
  assert.equal(f.calls.length, before)
})

test("bounds deadline and propagates abort and close without late dispatch", async (t) => {
  const f = await fixture(t),
    get = { kind: "get" as const, profileId: command.profileId }
  f.state.mode = "wait"
  await assert.rejects(
    f.execute(get, new AbortController().signal, performance.now() + 60),
    (error) => error instanceof ConnectError && error.code === Code.DeadlineExceeded,
  )
  for (let i = 0; i < 100 && !f.state.cancelled; i++) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(f.state.cancelled, true)
  const abort = new AbortController()
  abort.abort()
  const before = f.calls.length
  await assert.rejects(f.execute(get, abort.signal), (error) => error instanceof ConnectError && error.code === Code.Canceled)
  assert.equal(f.calls.length, before)
  const inFlight = f.execute(get)
  for (let i = 0; i < 100 && f.calls.length === before; i++) await new Promise((resolve) => setTimeout(resolve, 10))
  f.client.close()
  await assert.rejects(inFlight, (error) => error instanceof ConnectError && error.code === Code.Unavailable)
  await assert.rejects(f.execute(get), (error) => error instanceof ConnectError && error.code === Code.Unavailable)
})

test("rejects terminal control characters before credentials or wire without normalizing command identity", async (t) => {
  const f = await fixture(t)
  for (const input of [
    { kind: "get", profileId: command.profileId + "\n" },
    { kind: "quarantine", ...command, commandId: command.commandId + "\n" },
    { kind: "quarantine", ...command, expectedStateVersion: "3\n" },
    { kind: "list", cursor: "cursor\n" },
  ])
    await assert.rejects(f.execute(input as never), (error) => error instanceof ConnectError && error.code === Code.InvalidArgument)
  assert.equal(f.state.reads, 0)
  assert.equal(f.calls.length, 0)
})

test("rejects malformed owner receipt classifications rather than exposing ordinary conflict/precondition codes", async (t) => {
  const f = await fixture(t)
  for (const [mode, input] of [
    ["receipt-unknown", { kind: "quarantine", ...command }],
    ["receipt-wrong-code", { kind: "quarantine", ...command }],
    ["receipt", { kind: "get", profileId: command.profileId }],
    ["receipt-details", { kind: "quarantine", ...command }],
  ] as const) {
    f.state.mode = mode
    const before = f.calls.length
    await assert.rejects(f.execute(input), (error) => {
      assert.ok(error instanceof ConnectError)
      assert.equal(error.code, Code.DataLoss)
      assert.equal(error.metadata.get("x-kokoro-error-code"), null)
      assert.equal(error.metadata.get("x-private"), null)
      assert.equal(error.details.length, 0)
      assert.doesNotMatch(error.rawMessage, /private|secret/u)
      return true
    })
    assert.equal(f.calls.length, before + 1)
  }
})
