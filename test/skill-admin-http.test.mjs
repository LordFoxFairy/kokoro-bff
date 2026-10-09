import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("dedicated Skills admin credential rejects ordinary catalog/projection scope and rotates secret identity", async () => {
  const module = await import("../src/infrastructure/clients/platform/skill-admin-credential.ts").catch(() => ({}))
  assert.equal(typeof module.SkillAdminCredentialSource, "function", "dedicated machine credential missing")
  const directory = await mkdtemp(join(tmpdir(), "kokoro-skill-admin-"))
  const file = join(directory, "credential.json")
  const credential = {
    tenantId: "tenant",
    generation: 1,
    credentialRefVersion: "1",
    clientId: "bff-admin",
    clientSecret: "first",
    resource: "https://kokoro.dev/resources/platform-internal",
    scope: "platform:skills-admin.manage",
  }
  try {
    const source = new module.SkillAdminCredentialSource(file)
    await writeFile(file, JSON.stringify([credential]), { mode: 0o600 })
    const first = await source.read("tenant")
    for (const scope of ["platform:projection.read", "platform:skill-catalog.manage", "platform:skills-admin.manage platform:projection.read"]) {
      await writeFile(file, JSON.stringify([{ ...credential, scope }]))
      await assert.rejects(source.read("tenant"))
    }
    await writeFile(file, JSON.stringify([{ ...credential, clientSecret: "second" }]))
    assert.notEqual((await source.read("tenant")).cacheKey, first.cacheKey)
    await assert.rejects(source.read("other"))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

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
