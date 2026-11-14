import "reflect-metadata"
import assert from "node:assert/strict"
import test from "node:test"
import { createServer, request as httpRequest, type IncomingMessage } from "node:http"
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { create, toJson, type DescMessage, type Message, type MessageInitShape } from "@bufbuild/protobuf"
import { timestampFromDate } from "@bufbuild/protobuf/wkt"
import { Code, ConnectError, type HandlerContext } from "@connectrpc/connect"
import { connectNodeAdapter } from "@connectrpc/connect-node"
import { Test } from "@nestjs/testing"
import { load } from "js-yaml"
import { fromJSONSchema } from "zod"
import { BFF_CONFIG, BFF_DATABASE, MCP_AUTHORIZATION, SESSION_ADMISSION } from "../src/common/tokens.js"
import { McpModule } from "../src/modules/mcp/mcp.module.js"
import { BFF_NEST_APPLICATION_OPTIONS } from "../src/main.js"
import { BffExpressAdapter } from "../src/http/bff-express-adapter.js"
import { loadConfig } from "../src/config/runtime.js"
import { startMcpRequestBudget } from "../src/http/mcp-request-budget.js"
import * as p from "../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { configureBffProtobufTextEncoding } from "../src/infrastructure/protobuf-text-encoding.js"
configureBffProtobufTextEncoding()
const env = {
  KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/fixture?schema=kokoro_bff",
  KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
  KOKORO_BFF_SHARED_SECRET: "web-fixture-secret",
}
const headers = {
  "x-kokoro-service": "admin-web-bff",
  "x-kokoro-internal-secret": "admin-fixture-secret",
  cookie: "kokoro-issuer.session_token=admin-session",
  origin: "https://web.example.test",
  "x-kokoro-request-id": "admin-request",
}
const base = "/v1/admin/custom-apis",
  profileId = "profile-1",
  body = { expected_state_version: "3", reason_code: "security_review" }
const spec = load(await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")) as {
  components: { schemas: Record<string, object> }
}
const schema = (name: string) =>
  fromJSONSchema(
    JSON.parse(JSON.stringify({ $ref: `#/components/schemas/${name}`, $defs: spec.components.schemas }).replaceAll("#/components/schemas/", "#/$defs/")),
  )
async function fixture(t: import("node:test").TestContext, budget = 5000) {
  const dir = await mkdtemp(join(tmpdir(), "custom-api-admin-http-")),
    file = join(dir, "service.json")
  const state = {
    admin: true,
    tenant: "tenant-1",
    member: true,
    admissionCalls: 0,
    mode: "valid",
    token: "fixture-custom-api-admin-000000000000",
    cancelled: false,
    roleChecks: 0,
  }
  const write = (purpose = "custom_api_admin") =>
    writeFile(
      file,
      JSON.stringify({
        version: 1,
        entries: [{ credential_id: "fixture", secret: state.token, caller: "kokoro-bff", surfaces: [purpose], tenant_id: "tenant-1" }],
      }),
      { mode: 0o600 },
    )
  await write()
  const calls: { method: string; body: unknown; headers: Record<string, string> }[] = []
  const time = timestampFromDate(new Date("2026-11-13T00:00:00.000Z"))
  const profile = () => ({
    profileId: { value: profileId },
    ownerUserId: "owner-1",
    name: "Safe API",
    governanceStatus: "revoked",
    stateVersion: 9n,
    createdAt: time,
    updatedAt: time,
  })
  async function respond<S extends DescMessage>(desc: S, value: MessageInitShape<S>, request: Message & { requestId: string }, context: HandlerContext) {
    assert.equal(context.requestHeader.get("authorization"), `Bearer ${state.token}`)
    calls.push({ method: context.method.name, body: toJson(context.method.input, request), headers: Object.fromEntries(context.requestHeader) })
    context.responseHeader.set("x-request-id", request.requestId)
    context.responseHeader.set("x-kokoro-request-id", request.requestId)
    context.responseHeader.set("cache-control", "no-store")
    if (state.mode === "failure") throw new ConnectError("private endpoint secret instructions", Code.Unavailable, { "x-private": "secret" })
    if (state.mode === "conflict") throw new ConnectError("private", Code.AlreadyExists, { "x-kokoro-error-code": "command_receipt_identity_conflict" })
    if (state.mode === "unknown") throw new ConnectError("private", Code.Unavailable, { "x-kokoro-error-code": "command_receipt_outcome_unknown" })
    if (state.mode === "expired") throw new ConnectError("private", Code.FailedPrecondition, { "x-kokoro-error-code": "command_receipt_replay_expired" })
    if (state.mode === "bad-marker") throw new ConnectError("private", Code.AlreadyExists, { "x-kokoro-error-code": "unknown-secret-marker" })
    if (state.mode === "precondition") throw new ConnectError("private", Code.FailedPrecondition)
    if (state.mode === "missing") throw new ConnectError("private", Code.NotFound)
    if (state.mode === "wait")
      await new Promise<void>((resolve) => {
        const abort = () => {
          state.cancelled = true
          resolve()
        }
        if (context.signal.aborted) abort()
        else context.signal.addEventListener("abort", abort, { once: true })
      })
    return create(desc, value)
  }
  const ack = (governanceStatus: string) => ({
    profileId: { value: profileId },
    ownerUserId: "owner-1",
    governanceStatus,
    stateVersion: 4n,
    auditRef: "audit-1",
    replayed: true,
  })
  const owner = createServer(
    connectNodeAdapter({
      routes: (router) =>
        router.service(p.CustomApiAdminService, {
          listAdminCustomApis: (r, c) => respond(p.ListAdminCustomApisResponseSchema, { profiles: [profile()], page: {} }, r, c),
          getAdminCustomApi: (r, c) => respond(p.GetAdminCustomApiResponseSchema, { profile: profile() }, r, c),
          quarantineAdminCustomApi: (r, c) => respond(p.QuarantineAdminCustomApiResponseSchema, { ack: ack("quarantined") }, r, c),
          restoreAdminCustomApi: (r, c) => respond(p.RestoreAdminCustomApiResponseSchema, { ack: ack("active") }, r, c),
          revokeAdminCustomApi: (r, c) => respond(p.RevokeAdminCustomApiResponseSchema, { ack: ack("revoked") }, r, c),
          listAdminCustomApiAuditEvents: (r, c) =>
            respond(
              p.ListAdminCustomApiAuditEventsResponseSchema,
              {
                events: [
                  {
                    auditRef: "audit-delete",
                    profileId: { value: profileId },
                    ownerUserId: "owner-1",
                    actorId: "owner-1",
                    action: "deleted",
                    fromStatus: "revoked",
                    toStatus: "deleted",
                    fromVersion: 9n,
                    commandId: "delete-1",
                    requestId: "delete-request",
                    reasonCode: "owner_delete",
                    occurredAt: time,
                  },
                ],
                page: {},
              },
              r,
              c,
            ),
        }),
    }),
  )
  await new Promise<void>((resolve) => owner.listen(0, "127.0.0.1", resolve))
  const address = owner.address()
  assert.ok(address && typeof address !== "string")
  const config = loadConfig({
    ...env,
    KOKORO_TENANT_ID: "tenant-1",
    KOKORO_BFF_ADMIN_WEB_SHARED_SECRET: "admin-fixture-secret",
    KOKORO_IAM_WEB_ORIGIN: headers.origin,
    KOKORO_PLATFORM_BASE_URL: `http://127.0.0.1:${address.port}`,
    KOKORO_BFF_PLATFORM_CUSTOM_API_ADMIN_CREDENTIALS_FILE: file,
  })
  const databaseCall = () => assert.fail("Admin must not access PostgreSQL")
  const module = await Test.createTestingModule({ imports: [McpModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: { query: databaseCall, connect: databaseCall } })
    .overrideProvider(MCP_AUTHORIZATION)
    .useValue({
      check: async () => {
        state.roleChecks++
        assert.fail("mcp_catalog.manage is not platformAdmin admission")
      },
    })
    .overrideProvider(SESSION_ADMISSION)
    .useValue({
      verify: async () => {
        state.admissionCalls++
        if (!state.member) return { ok: false, status: 403, code: "session_forbidden" }
        return {
          ok: true,
          identity: { namespace: state.tenant, userId: "admin-1" },
          platformAdmin: state.admin,
          expiresAt: "2099-01-01T00:00:00.000Z",
          setCookies: [],
        }
      },
    })
    .compile()
  const app = module.createNestApplication(new BffExpressAdapter(), { ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  const server = app.getHttpServer()
  server.prependListener("request", (request: IncomingMessage) => startMcpRequestBudget(request, budget))
  await app.listen(0, "127.0.0.1")
  const appAddress = server.address()
  assert.ok(appAddress && typeof appAddress !== "string")
  const origin = `http://127.0.0.1:${appAddress.port}`
  t.after(async () => {
    server.closeAllConnections()
    await app.close()
    owner.closeAllConnections()
    await new Promise<void>((resolve) => owner.close(() => resolve()))
    await rm(dir, { recursive: true, force: true })
  })
  const send = (path = base, payload?: unknown, extra: Record<string, string> = {}) =>
    fetch(origin + path, {
      method: payload === undefined ? "GET" : "POST",
      headers: { ...headers, ...(payload === undefined ? {} : { "content-type": "application/json", "idempotency-key": "command-1" }), ...extra },
      ...(payload === undefined ? {} : { body: typeof payload === "string" ? payload : JSON.stringify(payload) }),
    })
  return { state, calls, send, origin, write, app }
}

test("real Nest module calls all six exact owner RPCs with fresh admin/tenant identity, safe current/immutable ACK/deleted audit and dedicated credentials", async (t) => {
  const f = await fixture(t)
  for (const [path, payload, responseSchema] of [
    [base + "?owner_user_id=owner-1&governance_status=revoked&limit=1", undefined, "AdminCustomApiListResponse"],
    [base + "/" + profileId, undefined, "AdminCustomApiDetailResponse"],
    ...["quarantine", "restore", "revoke"].map((action) => [base + "/" + profileId + "/" + action, body, "AdminCustomApiAckResponse"]),
    [base + "/" + profileId + "/audit-events", undefined, "AdminCustomApiAuditResponse"],
  ] as const) {
    const response = await f.send(path as string, payload)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("x-request-id"), "admin-request")
    assert.equal(response.headers.get("cache-control"), "no-store")
    const value = await response.json()
    assert.equal(schema(responseSchema as string).safeParse(value).success, true)
    if (responseSchema === "AdminCustomApiAckResponse") {
      const ack = value as { data: { state_version: string; replayed: boolean } }
      assert.equal(ack.data.state_version, "4")
      assert.equal(ack.data.replayed, true)
    }
  }
  assert.equal(f.calls.length, 6)
  assert.equal(f.state.admissionCalls, 6)
  assert.equal(f.state.roleChecks, 0)
  assert.equal(f.calls.at(-1)?.method, "ListAdminCustomApiAuditEvents")
  for (const call of f.calls) {
    assert.equal(call.headers["x-kokoro-subject"], "admin-1")
    assert.equal(call.headers["x-kokoro-tenant"], "tenant-1")
    assert.equal(call.headers.cookie, undefined)
    assert.equal(call.headers.origin, undefined)
  }
  f.state.admin = false
  assert.equal((await f.send(base + "/" + profileId + "/quarantine", body)).status, 403)
  f.state.admin = true
  f.state.tenant = "other"
  assert.equal((await f.send()).status, 403)
  f.state.tenant = "tenant-1"
  f.state.member = false
  assert.equal((await f.send()).status, 403)
  assert.equal(f.calls.length, 6)
  f.state.member = true
  f.state.token = "fixture-rotated-custom-api-admin-000000"
  await f.write()
  assert.equal((await f.send()).status, 200)
  await f.write("mcp_admin")
  assert.equal((await f.send()).status, 503)
})

test("closed input rejects duplicate/forged/CAS/query/header ambiguity before owner calls", async (t) => {
  const f = await fixture(t),
    path = base + "/" + profileId + "/quarantine"
  for (const payload of [
    { ...body, actor_id: "owner-1" },
    { ...body, expected_state_version: "03" },
    { ...body, expected_state_version: "2147483647" },
    { ...body, reason_code: "other" },
    '{"expected_state_version":"3","expected_state_version":"4","reason_code":"security_review"}',
  ])
    assert.equal((await f.send(path, payload)).status, 400)
  for (const query of ["?tenant_id=forged", "?limit=1&limit=2", "?governance_status=other", "?limit=01"]) assert.equal((await f.send(base + query)).status, 400)
  assert.equal((await f.send(base, undefined, { "idempotency-key": "wrong-read-key" })).status, 400)
  const raw = await new Promise<number>((resolve) => {
    const request = httpRequest(
      f.origin + path,
      {
        method: "POST",
        headers: [
          ...Object.entries(headers).flat(),
          "content-type",
          "application/json",
          "content-length",
          String(Buffer.byteLength(JSON.stringify(body))),
          "idempotency-key",
          "key-1",
          "idempotency-key",
          "key-2",
        ],
      },
      (response) => {
        response.resume()
        resolve(response.statusCode!)
      },
    )
    request.end(JSON.stringify(body))
  })
  assert.equal(raw, 400)
  assert.equal(f.calls.length, 0)
})

test("HTTP preserves receipt recovery and strips owner materials; invalid marker is 502, no automatic retry or new key", async (t) => {
  const f = await fixture(t),
    path = base + "/" + profileId + "/quarantine"
  for (const [mode, status, code, retryable] of [
    ["conflict", 409, "custom_api_admin_conflict", false],
    ["unknown", 503, "custom_api_admin_command_outcome_unknown", false],
    ["expired", 412, "custom_api_admin_command_replay_expired", false],
    ["bad-marker", 502, "custom_api_admin_response_invalid", false],
    ["precondition", 412, "custom_api_admin_precondition_failed", false],
    ["missing", 404, "custom_api_admin_not_found", false],
    ["failure", 503, "custom_api_admin_dependency_unavailable", true],
  ] as const) {
    f.state.mode = mode
    const count = f.calls.length
    const response = await f.send(path, body),
      value = (await response.json()) as { error: { code: string; retryable: boolean } }
    assert.equal(response.status, status)
    assert.equal(value.error.code, code)
    assert.equal(value.error.retryable, retryable)
    assert.doesNotMatch(JSON.stringify(value), /private|endpoint|secret|instructions/u)
    assert.equal(f.calls.length, count + 1)
    assert.equal((f.calls.at(-1)?.body as { command: { commandId: string } }).command.commandId, "command-1")
  }
})

test("shared HTTP budget cancels owner wait and incomplete body without late success", async (t) => {
  const f = await fixture(t, 100),
    path = base + "/" + profileId + "/quarantine"
  f.state.mode = "wait"
  const response = await f.send(path, body)
  assert.equal(response.status, 503)
  for (let i = 0; i < 100 && !f.state.cancelled; i++) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(f.state.cancelled, true)
  const count = f.calls.length
  const raw = await new Promise<number>((resolve) => {
    const request = httpRequest(
      f.origin + path,
      { method: "POST", headers: { ...headers, "content-type": "application/json", "content-length": "100", "idempotency-key": "command-1" } },
      (response) => {
        response.resume()
        resolve(response.statusCode!)
      },
    )
    request.on("error", () => resolve(0))
    request.write("{")
  })
  assert.equal(raw, 503)
  assert.equal(f.calls.length, count)
})

test("custom API admin configuration is opt-in, independent and never falls back", () => {
  assert.equal(loadConfig(env).customApiAdmin, null)
  assert.throws(
    () => loadConfig({ ...env, KOKORO_BFF_PLATFORM_CUSTOM_API_ADMIN_CREDENTIALS_FILE: "/fixture/admin.json" }),
    /custom_api_admin_configuration_incomplete/,
  )
  const config = loadConfig({
    ...env,
    KOKORO_PLATFORM_BASE_URL: "http://platform.invalid",
    KOKORO_BFF_PLATFORM_MCP_ADMIN_CREDENTIALS_FILE: "/fixture/mcp.json",
    KOKORO_BFF_PLATFORM_CUSTOM_API_CREDENTIALS_FILE: "/fixture/personal.json",
  })
  assert.equal(config.customApiAdmin, null)
})
