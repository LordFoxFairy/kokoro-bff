import assert from "node:assert/strict"
import test from "node:test"
import { Code, ConnectError } from "@connectrpc/connect"
import { DEFAULT_AGUI_CONFIG } from "../src/config/runtime.ts"
import { createServer } from "node:http"
import { once } from "node:events"
const correctionConfig = {
  host: "127.0.0.1",
  port: 4300,
  mode: "live",
  domain: "dev.kokoro.localhost",
  tenantId: "tenant",
  iamBaseUrl: null,
  iamWebOrigin: "https://web.example.test",
  sharedSecret: "secret",
  upstreamSecret: null,
  upstreamTimeoutMs: 100,
  upstreamMaxResponseBytes: 1048576,
  schedulerServiceToken: null,
  schedulerTargetUrl: null,
  agentEnabled: false,
  postgresUrl: null,
  redisUrl: null,
  agUi: DEFAULT_AGUI_CONFIG,
  upstreams: {},
  platformProjection: { baseUrl: null, credentialFile: null, timeoutMs: 100 },
  skillDraft: {
    enabled: false,
    platformBaseUrl: null,
    credentialFile: null,
    timeoutMs: 100,
  },
}
const correctionHeaders = {
  cookie: "kokoro-issuer.session_token=session",
  origin: "https://web.example.test",
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "secret",
  "content-type": "application/json",
  "idempotency-key": "readmit-1",
}

import { create, toBinary, fromBinary } from "@bufbuild/protobuf"
import * as wire from "../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts"
async function startSkillAdminTestApp(config, { sessionAdmission, skillAuthorization, skillAdminClient }) {
  await import("reflect-metadata")
  const { Test } = await import("@nestjs/testing")
  const { BFF_CONFIG, BFF_DATABASE, SESSION_ADMISSION, SKILL_ADMIN_CLIENT, SKILL_AUTHORIZATION } = await import("../dist/common/tokens.js")
  const { BFF_NEST_APPLICATION_OPTIONS } = await import("../dist/main.js")
  const { SkillsModule } = await import("../dist/modules/skills/skills.module.js")
  const unexpected = () => assert.fail("Skills admin HTTP fixture must not use a database")
  const module = await Test.createTestingModule({ imports: [SkillsModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: { query: unexpected, connect: unexpected }, ready: unexpected })
    .overrideProvider(SESSION_ADMISSION)
    .useValue(sessionAdmission)
    .overrideProvider(SKILL_AUTHORIZATION)
    .useValue(skillAuthorization)
    .overrideProvider(SKILL_ADMIN_CLIENT)
    .useValue(skillAdminClient)
    .compile()
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  try {
    await app.listen(0, "127.0.0.1")
    return { base: await app.getUrl(), close: () => app.close() }
  } catch (error) {
    await app.close()
    throw error
  }
}

test("Admin owner machine admission rejection is terminal service authentication failure", async (t) => {
  for (const ownerCode of [Code.Unauthenticated, Code.PermissionDenied]) {
    await t.test(Code[ownerCode], async () => {
      let calls = 0
      const app = await startSkillAdminTestApp(correctionConfig, {
        sessionAdmission: {
          verify: async () => ({ ok: true, identity: { namespace: "tenant", userId: "user" }, platformAdmin: true }),
        },
        skillAuthorization: { check: async () => ({ ok: true }) },
        skillAdminClient: {
          list: async () => {
            calls++
            throw new ConnectError("private owner admission detail", ownerCode)
          },
        },
      })

      try {
        const headers = { ...correctionHeaders }
        delete headers["idempotency-key"]
        delete headers["content-type"]
        const response = await fetch(`${app.base}/v1/admin/skills`, { headers })
        assert.equal(response.status, 403)
        const body = await response.json()
        assert.equal(body.error.code, "service_auth_failed")
        assert.equal(body.error.retryable, false)
        assert.equal(JSON.stringify(body).includes("private owner admission detail"), false)
        assert.equal(calls, 1)
      } finally {
        await app.close()
      }
    })
  }
})

test("Admin real HTTP distinguishes bad protobuf owner facts and ACK from browser input", async (t) => {
  for (const fault of ["audience", "category", "ack", "input", "valid"])
    await t.test(fault, async () => {
      let calls = 0
      const record = create(wire.SkillProductRecordSchema, {
        skillId: { value: "s" },
        sourceRef: { value: "skill:s" },
        seriesId: { value: "series" },
        revision: 1n,
        status: 1,
        packagePhase: wire.SkillPackagePhase.NONE,
        skillUpdatedAt: { seconds: 1n, nanos: 0 },
        metadata: {
          displayName: "Name",
          summary: "",
          categoryKeys: { keys: fault === "category" ? ["bogus"] : [] },
        },
        product: {
          publicationAudience: fault === "audience" || fault === "ack" ? "bogus" : "owner",
          stateVersion: 1n,
        },
      })
      const received = fromBinary(wire.SkillProductRecordSchema, toBinary(wire.SkillProductRecordSchema, record))
      const app = await startSkillAdminTestApp(correctionConfig, {
        sessionAdmission: {
          verify: async () => ({
            ok: true,
            identity: { namespace: "tenant", userId: "user" },
            platformAdmin: true,
          }),
        },
        skillAuthorization: { check: async () => ({ ok: true }) },
        skillAdminClient: {
          get: async () => {
            calls++
            return { skill: received, publication: create(wire.SkillPublicationPreconditionSchema, { expectation: { case: "absent", value: true } }) }
          },
          command: async () => {
            calls++
            return { skill: received, eventId: "event", replayed: false }
          },
        },
      })

      try {
        const mutation = fault === "ack" || fault === "input",
          headers = { ...correctionHeaders }
        if (!mutation) {
          delete headers["idempotency-key"]
          delete headers["content-type"]
        }
        const response = await fetch(`${app.base}/v1/admin/skills/s${mutation ? "/audience" : ""}`, {
          method: mutation ? "POST" : "GET",
          headers,
          ...(mutation
            ? {
                body: JSON.stringify({
                  expected_state_version: "1",
                  audience: fault === "input" ? "bogus" : "owner",
                }),
              }
            : {}),
        })
        assert.equal(response.status, fault === "valid" ? 200 : fault === "input" ? 400 : 502)
        if (!["valid", "input"].includes(fault)) assert.equal((await response.json()).error.code, "skill_response_invalid")
        assert.equal(calls, fault === "input" ? 0 : 1)
      } finally {
        await app.close()
      }
    })
})

test("Admin binary wrapper forwards transport request-id and keeps exact response integrity", async () => {
  const { createServer } = await import("node:http")
  const { once } = await import("node:events")
  const { randomUUID } = await import("node:crypto")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { SkillAdminConnectClient } = await import("../src/infrastructure/clients/platform/skill-admin-connect.ts")
  const wire = await import("../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts")
  const context = { requestId: "header-request", tenant: "tenant", subject: "user" }
  let mode = "valid"
  const seen = []
  const owner = createServer(
    connectNodeAdapter({
      routes(router) {
        router.service(wire.SkillAdminService, {
          listAdminSkills: (_request, rpcContext) => {
            const transportId = rpcContext.requestHeader.get("x-kokoro-request-id")
            seen.push(transportId)
            if (mode !== "missing-id") rpcContext.responseHeader.set("x-kokoro-request-id", mode === "wrong-id" ? "wrong-id" : (transportId ?? randomUUID()))
            if (mode !== "missing-cache") rpcContext.responseHeader.set("cache-control", mode === "wrong-cache" ? "public" : "no-store")
            return { skills: [], nextCursor: "" }
          },
        })
      },
    }),
  )
  owner.listen(0, "127.0.0.1")
  await once(owner, "listening")
  try {
    const client = new SkillAdminConnectClient(`http://127.0.0.1:${owner.address().port}`, { get: async () => "admin-token", retire() {} }, 1000)
    const signal = new AbortController().signal
    const invoke = () => client.list(context, {}, signal, performance.now() + 1000)
    await invoke()
    assert.equal(seen.at(-1), context.requestId)
    for (mode of ["missing-id", "wrong-id", "missing-cache", "wrong-cache"]) {
      await assert.rejects(invoke(), /skill_response_invalid/u)
      assert.equal(seen.at(-1), context.requestId)
    }
  } finally {
    owner.closeAllConnections()
    await new Promise((resolve) => owner.close(resolve))
  }
})

test("Admin creates one official draft without caller-chosen identity or CAS", async () => {
  const record = create(wire.SkillProductRecordSchema, {
    skillId: { value: "official-1" },
    sourceRef: { value: "skill:official-1" },
    seriesId: { value: "official-series-1" },
    revision: 1n,
    status: 1,
    packagePhase: wire.SkillPackagePhase.NONE,
    skillUpdatedAt: { seconds: 1n, nanos: 0 },
    metadata: { displayName: "Official skill", summary: "", categoryKeys: { keys: ["automation"] } },
    product: { publicationAudience: "owner", stateVersion: 1n },
  })
  const received = fromBinary(wire.SkillProductRecordSchema, toBinary(wire.SkillProductRecordSchema, record))
  const calls = []
  const authorizations = []
  const app = await startSkillAdminTestApp(correctionConfig, {
    sessionAdmission: { verify: async () => ({ ok: true, identity: { namespace: "tenant", userId: "admin" }, platformAdmin: true }) },
    skillAuthorization: {
      check: async (input) => {
        authorizations.push(input.action)
        return { ok: true }
      },
    },
    skillAdminClient: {
      get: async () => ({ skill: received, publication: create(wire.SkillPublicationPreconditionSchema, { expectation: { case: "absent", value: true } }) }),
      command: async (operation, context, members) => {
        calls.push({ operation, context, members })
        return { skill: received, eventId: "event-1", replayed: false }
      },
    },
  })

  try {
    const request = (body, headers = {}) =>
      fetch(`${app.base}/v1/admin/skills`, {
        method: "POST",
        headers: { ...correctionHeaders, ...headers },
        body: JSON.stringify(body),
      })
    const body = { metadata: { display_name: "Official skill", summary: "", tags: ["Kokoro"], category_keys: ["automation"] } }
    const response = await request(body)
    assert.equal(response.status, 201)
    assert.equal(calls.length, 1)
    assert.deepEqual(authorizations, ["admin_create_draft"])
    assert.equal(calls[0].operation, "createAdminSkillDraft")
    assert.equal(calls[0].context.commandId.startsWith("bff.skill."), true)
    assert.deepEqual(calls[0].members, {
      metadata: { display_name: "Official skill", summary: "", tags: ["Kokoro"], metadata_json: "e30", category_keys: { keys: ["automation"] } },
    })
    assert.deepEqual((await response.json()).data.skill.skill_id, "official-1")
    for (const invalid of [
      { ...body, skill_id: "caller-selected" },
      { ...body, expected_state_version: "1" },
      { metadata: { ...body.metadata, tags: ["Kokoro", "Kokoro"] } },
    ]) {
      const rejected = await request(invalid, { "idempotency-key": `invalid-${calls.length}` })
      assert.equal(rejected.status, 400)
      assert.equal(calls.length, 1)
    }
  } finally {
    await app.close()
  }
})

test("machine credentials never replace the current session and fresh Skills admin action", async (t) => {
  for (const denied of ["session", "action", "tenant"])
    await t.test(denied, async () => {
      let ownerCalls = 0
      let actionGranted = denied === "action"
      const actions = []
      const app = await startSkillAdminTestApp(correctionConfig, {
        sessionAdmission: {
          verify: async () =>
            denied === "session"
              ? { ok: false, status: 403, code: "session_forbidden" }
              : { ok: true, identity: { namespace: denied === "tenant" ? "other-tenant" : "tenant", userId: "user" }, platformAdmin: true },
        },
        skillAuthorization: {
          check: async (input) => {
            actions.push(input.action)
            return denied === "action" && !actionGranted ? { ok: false, status: 403, code: "skill_permission_denied" } : { ok: true }
          },
        },
        skillAdminClient: {
          list: async () => {
            ownerCalls++
            throw new Error("denied read reached owner")
          },
          command: async (operation, context, members) => {
            ownerCalls++
            assert.equal(actionGranted, true, "denied command reached owner")
            assert.equal(operation, "discardAdminSkillDraft")
            assert.equal(context.tenant, "tenant")
            assert.equal(context.subject, "user")
            assert.deepEqual(members, { skill_id: { value: "disposable-draft" }, expected_state_version: "1", reason: "Denied discard" })
            return {
              skill: create(wire.SkillProductRecordSchema, {
                skillId: { value: "disposable-draft" },
                sourceRef: { value: "skill:disposable-draft" },
                seriesId: { value: "series" },
                revision: 2n,
                status: wire.SkillStatus.DISCARDED,
                packagePhase: wire.SkillPackagePhase.NONE,
                skillUpdatedAt: { seconds: 1n, nanos: 0 },
                metadata: { displayName: "Disposable", summary: "", categoryKeys: { keys: [] } },
                product: { publicationAudience: "owner", stateVersion: 2n },
              }),
              eventId: "discard-event",
              replayed: false,
            }
          },
        },
      })

      try {
        if (denied === "action") {
          const first = await fetch(`${app.base}/v1/admin/skills/disposable-draft/discard`, {
            method: "POST",
            headers: correctionHeaders,
            body: JSON.stringify({ expected_state_version: "1", reason: "Denied discard" }),
          })
          assert.equal(first.status, 200)
          assert.equal((await first.json()).data.skill.status, "discarded")
          actionGranted = false
        }
        for (const [method, path, body] of [
          ["GET", "/v1/admin/skills"],
          ["POST", "/v1/admin/skills", { metadata: { display_name: "Denied", summary: "", tags: [] } }],
          ["POST", "/v1/admin/skills/disposable-draft/discard", { expected_state_version: "1", reason: "Denied discard" }],
        ]) {
          const headers = { ...correctionHeaders }
          if (method === "GET") {
            delete headers["content-type"]
            delete headers["idempotency-key"]
          }
          headers["x-kokoro-request-id"] = "admin-denial-correlation"
          const response = await fetch(`${app.base}${path}`, {
            method,
            headers,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          })
          assert.equal(response.status, 403)
          assert.equal(response.headers.get("x-request-id"), "admin-denial-correlation")
          assert.equal(response.headers.get("cache-control"), "no-store")
          assert.equal(
            (await response.json()).error.code,
            denied === "session" ? "session_forbidden" : denied === "action" ? "skill_permission_denied" : "product_tenant_forbidden",
          )
        }
        assert.equal(ownerCalls, denied === "action" ? 1 : 0)
        assert.deepEqual(actions, denied === "action" ? ["admin_discard_draft", "admin_read", "admin_create_draft", "admin_discard_draft"] : [])
      } finally {
        await app.close()
      }
    })
})

test("Admin publish preserves explicit absent/current publication as native expectation and rejects missing before owner", async () => {
  const calls = []
  const skill = create(wire.SkillProductRecordSchema, {
    skillId: { value: "s" },
    sourceRef: { value: "skill:s" },
    seriesId: { value: "series" },
    revision: 1n,
    status: 2,
    packagePhase: wire.SkillPackagePhase.NONE,
    skillUpdatedAt: { seconds: 1n, nanos: 0 },
    metadata: { displayName: "Name", summary: "", categoryKeys: { keys: [] } },
    product: { publicationAudience: "owner", stateVersion: 1n },
  })
  const app = await startSkillAdminTestApp(correctionConfig, {
    sessionAdmission: { verify: async () => ({ ok: true, identity: { namespace: "tenant", userId: "user" }, platformAdmin: true }) },
    skillAuthorization: { check: async () => ({ ok: true }) },
    skillAdminClient: {
      command: async (operation, context, members) => {
        calls.push({ operation, context, members })
        if (members.expected_publication.current?.state_version === "2")
          throw new ConnectError("stale snapshot", Code.Aborted, { "x-kokoro-error-code": "publish_snapshot_conflict" })
        if (members.expected_publication.current?.state_version === "3") throw new ConnectError("busy", Code.Aborted)
        return { skill, eventId: "event", replayed: false }
      },
    },
  })

  try {
    const body = { audience: "owner", expected_state_version: "5", publisher: { kind: "user", id: "publisher" } }
    const send = (value) => fetch(`${app.base}/v1/admin/skills/s/publish`, { method: "POST", headers: correctionHeaders, body: JSON.stringify(value) })
    assert.equal((await send(body)).status, 400)
    assert.equal(calls.length, 0)
    assert.equal((await send({ ...body, expected_publication: null })).status, 200)
    assert.equal((await send({ ...body, expected_publication: { current_version_id: "previous", state_version: "9007199254740993" } })).status, 200)
    assert.equal(calls.length, 2)
    assert.equal(calls[0].operation, "publishOfficialSkill")
    assert.deepEqual(calls[0].members.expected_publication, { absent: true })
    assert.deepEqual(calls[1].members.expected_publication, { current: { current_version_id: { value: "previous" }, state_version: "9007199254740993" } })
    assert.equal(calls[0].context.commandId, calls[1].context.commandId)
    const stale = await send({ ...body, expected_publication: { current_version_id: "previous", state_version: "2" } })
    assert.equal(stale.status, 412)
    assert.equal((await stale.json()).error.retryable, false)
    const busy = await send({ ...body, expected_publication: { current_version_id: "previous", state_version: "3" } })
    assert.equal(busy.status, 409)
    assert.equal((await busy.json()).error.retryable, true)
    assert.equal(calls.length, 4)
  } finally {
    await app.close()
  }
})

test("Admin detail projects only explicit publication snapshots; missing, malformed or unknown wire is not absence", async (t) => {
  const skill = create(wire.SkillProductRecordSchema, {
    skillId: { value: "s" },
    sourceRef: { value: "skill:s" },
    seriesId: { value: "series" },
    revision: 1n,
    status: wire.SkillStatus.WITHDRAWN,
    packagePhase: wire.SkillPackagePhase.NONE,
    skillUpdatedAt: { seconds: 1n, nanos: 0 },
    metadata: { displayName: "Retired revision", summary: "", categoryKeys: { keys: [] } },
    product: { publicationAudience: "owner", stateVersion: 1n },
  })
  for (const [label, publication, expected] of [
    ["never published", { expectation: { case: "absent", value: true } }, null],
    [
      "current is another exact version",
      { expectation: { case: "current", value: { currentVersionId: { value: "current-retired" }, stateVersion: 9007199254740993n } } },
      { current_version_id: "current-retired", state_version: "9007199254740993" },
    ],
    ["missing", undefined, undefined],
    ["empty oneof", { expectation: { case: undefined } }, undefined],
    ["false absence", { expectation: { case: "absent", value: false } }, undefined],
    ["missing current id", { expectation: { case: "current", value: { stateVersion: 1n } } }, undefined],
    ["zero current version", { expectation: { case: "current", value: { currentVersionId: { value: "current" }, stateVersion: 0n } } }, undefined],
    [
      "overflowing current version",
      { expectation: { case: "current", value: { currentVersionId: { value: "current" }, stateVersion: 9223372036854775807n } } },
      undefined,
    ],
    ["number current version", { expectation: { case: "current", value: { currentVersionId: { value: "current" }, stateVersion: 1 } } }, undefined],
    ["unknown nested wire", { expectation: { case: "absent", value: true }, $unknown: [{ no: 99, wireType: 0, data: Uint8Array.of(1) }] }, undefined],
  ])
    await t.test(label, async () => {
      let calls = 0
      const app = await startSkillAdminTestApp(correctionConfig, {
        sessionAdmission: { verify: async () => ({ ok: true, identity: { namespace: "tenant", userId: "user" }, platformAdmin: true }) },
        skillAuthorization: { check: async () => ({ ok: true }) },
        skillAdminClient: {
          get: async () => {
            calls++
            return { skill, publication }
          },
        },
      })

      try {
        const headers = { ...correctionHeaders }
        delete headers["idempotency-key"]
        delete headers["content-type"]
        const response = await fetch(`${app.base}/v1/admin/skills/s`, { headers })
        assert.equal(response.status, expected === undefined ? 502 : 200)
        const body = await response.json()
        if (expected === undefined) assert.equal(body.error.code, "skill_response_invalid")
        else {
          assert.deepEqual(body.meta, { publication: expected })
          assert.equal(body.data.skill_id, "s")
          assert.equal(body.data.status, "withdrawn")
        }
        assert.equal(calls, 1)
        assert.equal(response.headers.get("cache-control"), "no-store")
      } finally {
        await app.close()
      }
    })
})

test("Admin detail crosses the real Native Connect binary client with exact confirmation and dedicated machine identity", async () => {
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { SkillAdminConnectClient } = await import("../src/infrastructure/clients/platform/skill-admin-connect.ts")
  let calls = 0
  const owner = createServer(
    connectNodeAdapter({
      routes(router) {
        router.service(wire.SkillAdminService, {
          getAdminSkill(request, context) {
            calls++
            assert.equal(context.requestHeader.get("authorization"), "Bearer admin-machine")
            assert.equal(context.requestHeader.get("x-kokoro-tenant"), "tenant")
            assert.equal(context.requestHeader.get("x-kokoro-subject"), "admin")
            assert.equal(request.productContext?.subjectId, "admin")
            assert.equal(request.skillId?.value, "s")
            context.responseHeader.set("x-kokoro-request-id", request.requestId)
            context.responseHeader.set("cache-control", "no-store")
            return {
              skill: create(wire.SkillProductRecordSchema, {
                skillId: { value: "s" },
                sourceRef: { value: "skill:s" },
                seriesId: { value: "series" },
                revision: 1n,
                status: wire.SkillStatus.DRAFT,
                packagePhase: wire.SkillPackagePhase.NONE,
                skillUpdatedAt: { seconds: 1n, nanos: 0 },
                metadata: { displayName: "Draft", summary: "", categoryKeys: { keys: [] } },
                product: { publicationAudience: "owner", stateVersion: 1n },
              }),
              publication: { expectation: { case: "current", value: { currentVersionId: { value: "other-current" }, stateVersion: 9007199254740993n } } },
            }
          },
        })
      },
    }),
  )
  owner.listen(0, "127.0.0.1")
  await once(owner, "listening")
  const client = new SkillAdminConnectClient(`http://127.0.0.1:${owner.address().port}`, { get: async () => "admin-machine" }, 1000)
  let app
  try {
    app = await startSkillAdminTestApp(correctionConfig, {
      sessionAdmission: { verify: async () => ({ ok: true, identity: { namespace: "tenant", userId: "admin" }, platformAdmin: true }) },
      skillAuthorization: { check: async () => ({ ok: true }) },
      skillAdminClient: client,
    })
    const headers = { ...correctionHeaders }
    delete headers["idempotency-key"]
    delete headers["content-type"]
    const response = await fetch(`${app.base}/v1/admin/skills/s`, { headers })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.data.skill_id, "s")
    assert.deepEqual(body.meta, { publication: { current_version_id: "other-current", state_version: "9007199254740993" } })
    assert.equal(calls, 1)
  } finally {
    owner.closeAllConnections()
    await Promise.all([app?.close(), new Promise((resolve) => owner.close(resolve))])
  }
})

test("Admin early session/action failures preserve correlation and their original HTTP failure", async (t) => {
  for (const [kind, status, code] of [
    ["session", 401, "session_authentication_required"],
    ["session", 429, "session_rate_limited"],
    ["action", 503, "iam_admission_unavailable"],
    ["session-throw", 503, "skill_dependency_unavailable"],
  ]) {
    await t.test(`${kind}-${status}`, async () => {
      let sessionCalls = 0,
        actionCalls = 0,
        ownerCalls = 0
      const app = await startSkillAdminTestApp(correctionConfig, {
        sessionAdmission: {
          verify: async () => {
            sessionCalls++
            if (kind === "session-throw") throw new Error("private session failure")
            if (kind === "session") return { ok: false, status, code, ...(status === 429 ? { retryAfter: "7" } : {}) }
            return { ok: true, identity: { namespace: "tenant", userId: "user" }, platformAdmin: false }
          },
        },
        skillAuthorization: {
          check: async () => {
            actionCalls++
            return { ok: false, status, code }
          },
        },
        skillAdminClient: {
          list: async () => {
            ownerCalls++
            assert.fail("rejected request reached owner")
          },
        },
      })
      try {
        const headers = { ...correctionHeaders, "x-kokoro-request-id": "admin-early-correlation" }
        delete headers["content-type"]
        delete headers["idempotency-key"]
        const response = await fetch(`${app.base}/v1/admin/skills?limit=25`, { headers })
        assert.equal(response.status, status)
        assert.equal(response.headers.get("x-request-id"), "admin-early-correlation")
        assert.equal(response.headers.get("cache-control"), "no-store")
        assert.match(response.headers.get("content-type"), /^application\/json/u)
        assert.equal(response.headers.get("retry-after"), status === 429 ? "7" : null)
        assert.deepEqual(await response.json(), {
          error: {
            code,
            message: kind.endsWith("throw")
              ? "Skill admin dependency is unavailable"
              : kind === "session"
                ? "BFF user admission failed"
                : "Skill action admission failed",
            retryable: status === 429 || status === 503,
          },
        })
        assert.equal(sessionCalls, 1)
        assert.equal(actionCalls, kind.startsWith("action") ? 1 : 0)
        assert.equal(ownerCalls, 0)
      } finally {
        await app.close()
      }
    })
  }
})

test("Unmatched Admin Skill native routes leave response and dependencies untouched", async () => {
  const { handleSkillAdminRequest } = await import("../dist/http/routes/skill-admin-native.js")
  let calls = 0
  const forbidden = async () => {
    calls++
    assert.fail("unmatched route used admission or owner")
  }
  const server = createServer(async (request, response) => {
    const handled = await handleSkillAdminRequest(
      request,
      response,
      correctionConfig,
      { verify: forbidden },
      { check: forbidden },
      { list: forbidden, command: forbidden },
    )
    const untouched = { handled, headers: response.getHeaders(), ended: response.writableEnded, headersSent: response.headersSent }
    response.statusCode = 404
    response.end(JSON.stringify(untouched))
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    for (const [method, path] of [
      ["GET", "/v1/other/skills"],
      ["PUT", "/v1/admin/skills"],
      ["POST", "/v1/admin/skills/s/unknown"],
      ["GET", "/v1/admin/skills/s/extra"],
    ]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method,
        headers: { "x-kokoro-request-id": "unmatched-correlation" },
      })
      assert.equal(response.status, 404)
      assert.equal(response.headers.get("x-request-id"), null)
      assert.deepEqual(await response.json(), { handled: false, headers: {}, ended: false, headersSent: false })
    }
    assert.equal(calls, 0)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
