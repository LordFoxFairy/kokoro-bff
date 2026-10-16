import assert from "node:assert/strict"
import test from "node:test"
import { Code, ConnectError } from "@connectrpc/connect"
import { createBffServer } from "../src/bootstrap/server.ts"
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
  authorization: "Bearer session",
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "secret",
  "content-type": "application/json",
  "idempotency-key": "readmit-1",
}

import { create, toBinary, fromBinary } from "@bufbuild/protobuf"
import * as wire from "../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts"
test("Admin owner machine admission rejection is terminal service authentication failure", async (t) => {
  for (const ownerCode of [Code.Unauthenticated, Code.PermissionDenied]) {
    await t.test(Code[ownerCode], async () => {
      let calls = 0
      const server = createBffServer(correctionConfig, {
        businessStore: null,
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
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      try {
        const headers = { ...correctionHeaders }
        delete headers["idempotency-key"]
        delete headers["content-type"]
        const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/admin/skills`, { headers })
        assert.equal(response.status, 403)
        const body = await response.json()
        assert.equal(body.error.code, "service_auth_failed")
        assert.equal(body.error.retryable, false)
        assert.equal(JSON.stringify(body).includes("private owner admission detail"), false)
        assert.equal(calls, 1)
      } finally {
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
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
      const server = createBffServer(correctionConfig, {
        businessStore: null,
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
            return { skill: received }
          },
          command: async () => {
            calls++
            return { skill: received, eventId: "event", replayed: false }
          },
        },
      })
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      try {
        const mutation = fault === "ack" || fault === "input",
          headers = { ...correctionHeaders }
        if (!mutation) {
          delete headers["idempotency-key"]
          delete headers["content-type"]
        }
        const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/admin/skills/s${mutation ? "/audience" : ""}`, {
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
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
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
  const server = createBffServer(correctionConfig, {
    businessStore: null,
    sessionAdmission: { verify: async () => ({ ok: true, identity: { namespace: "tenant", userId: "admin" }, platformAdmin: true }) },
    skillAuthorization: {
      check: async (input) => {
        authorizations.push(input.action)
        return { ok: true }
      },
    },
    skillAdminClient: {
      get: async () => ({ skill: received }),
      command: async (operation, context, members) => {
        calls.push({ operation, context, members })
        return { skill: received, eventId: "event-1", replayed: false }
      },
    },
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const request = (body, headers = {}) =>
      fetch(`http://127.0.0.1:${server.address().port}/v1/admin/skills`, {
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
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("machine credentials never replace the current session and fresh Skills admin action", async (t) => {
  for (const denied of ["session", "action"])
    await t.test(denied, async () => {
      let ownerCalls = 0
      const actions = []
      const server = createBffServer(correctionConfig, {
        businessStore: null,
        sessionAdmission: {
          verify: async () =>
            denied === "session"
              ? { ok: false, status: 403, code: "session_forbidden" }
              : { ok: true, identity: { namespace: "tenant", userId: "user" }, platformAdmin: true },
        },
        skillAuthorization: {
          check: async (input) => {
            actions.push(input.action)
            return denied === "action" ? { ok: false, status: 403, code: "skill_permission_denied" } : { ok: true }
          },
        },
        skillAdminClient: {
          list: async () => {
            ownerCalls++
            throw new Error("denied read reached owner")
          },
          command: async () => {
            ownerCalls++
            throw new Error("denied command reached owner")
          },
        },
      })
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      try {
        for (const method of ["GET", "POST"]) {
          const headers = { ...correctionHeaders }
          if (method === "GET") {
            delete headers["content-type"]
            delete headers["idempotency-key"]
          }
          const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/admin/skills`, {
            method,
            headers,
            ...(method === "GET" ? {} : { body: JSON.stringify({ metadata: { display_name: "Denied", summary: "", tags: [] } }) }),
          })
          assert.equal(response.status, 403)
        }
        assert.equal(ownerCalls, 0)
        assert.deepEqual(actions, denied === "session" ? [] : ["admin_read", "admin_create_draft"])
      } finally {
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
      }
    })
})
