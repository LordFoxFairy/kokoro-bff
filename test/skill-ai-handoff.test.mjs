import test from "node:test"
import assert from "node:assert/strict"

test("AI handoff accepts the current skill-md-v1 canonical owner result", async () => {
  const { skillHandoffResultSchema } = await import("../src/infrastructure/clients/platform/skill-product-schema.ts")
  const manifestIdentity = `skill-md-v1:sha256:${"c".repeat(64)}`
  assert.deepEqual(
    skillHandoffResultSchema.parse({
      skill_id: "skill-1",
      source_ref: "skill:skill-1",
      status: "draft",
      state_version: "4",
      valid: true,
      content_digest: "a".repeat(64),
      manifest_identity: manifestIdentity,
    }).manifest_identity,
    manifestIdentity,
  )
})

test("Handoff freezes selected version before Complete and replays without another PUT", async () => {
  const module = await import("../src/application/skill-ai-handoff.ts").catch(() => ({}))
  assert.equal(typeof module.handoffSkillPackage, "function", "durable skill handoff missing")
  let row = null,
    puts = 0,
    completes = 0
  const receipts = {
    getReceipt: async () => row,
    claimReceipt: async (scope, fingerprint) => {
      if (row) return { claimed: false, receipt: row }
      row = { fingerprint, status: 102, body: {} }
      return { claimed: true, receipt: null }
    },
    compareAndSetReceipt: async (scope, fingerprint, expected, replacement) => {
      if (JSON.stringify(row) !== JSON.stringify(expected)) return { updated: false, receipt: row }
      row = replacement
      return { updated: true, receipt: row }
    },
  }
  const steps = {
    create: async () => ({ skillId: "s", stateVersion: "1" }),
    begin: async () => ({
      skillId: "s",
      attemptId: "a",
      uploadId: "u",
      attemptEpoch: "1",
      stateVersion: "2",
    }),
    status: async () => ({
      skillId: "s",
      attemptId: "a",
      uploadId: "u",
      attemptEpoch: "1",
      sourceVersionId: completes ? "OPAQUE+/=" : null,
    }),
    put: async () => {
      puts++
      return "OPAQUE+/="
    },
    completion: (begin, version) => ({
      commandId: "complete",
      requestDigest: "a".repeat(64),
      sourceVersionId: version,
    }),
    complete: async (begin, selected) => {
      assert.equal(row.body.stage, "selected")
      assert.equal(row.body.selected.sourceVersionId, selected.sourceVersionId)
      completes++
      return { stateVersion: "3" }
    },
    validate: async () => ({ skill_id: "s", valid: true }),
  }
  const input = {
    scope: "scope",
    fingerprint: "b".repeat(64),
    frozen: { source: "immutable" },
    commandId: "handoff",
  }
  assert.deepEqual(await module.handoffSkillPackage(input, receipts, steps, AbortSignal.timeout(1000)), { skill_id: "s", valid: true })
  assert.deepEqual(await module.handoffSkillPackage(input, receipts, steps, AbortSignal.timeout(1000)), { skill_id: "s", valid: true })
  assert.equal(puts, 1)
  assert.equal(completes, 1)
})

test("Handoff exact ACK readback compares JSONB values, not object insertion order", async () => {
  const { handoffSkillPackage } = await import("../src/application/skill-ai-handoff.ts")
  const reorder = (value) =>
    Array.isArray(value)
      ? value.map(reorder)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .reverse()
              .map((key) => [key, reorder(value[key])]),
          )
        : value
  let row = {
    fingerprint: "b".repeat(64),
    status: 200,
    body: { stage: "frozen", frozen: { first: "one", second: "two" } },
  }
  const receipts = {
    getReceipt: async () => reorder(row),
    claimReceipt: async () => {
      throw Error("unexpected claim")
    },
    compareAndSetReceipt: async (scope, fingerprint, expected, replacement) => {
      row = reorder(replacement)
      throw Error("ACK dropped")
    },
  }
  const steps = {
    create: async () => ({ skillId: "s", stateVersion: "1" }),
    begin: async () => ({
      skillId: "s",
      attemptId: "a",
      uploadId: "u",
      attemptEpoch: "1",
      stateVersion: "2",
    }),
    status: async () => ({
      skillId: "s",
      attemptId: "a",
      uploadId: "u",
      attemptEpoch: "1",
      sourceVersionId: null,
    }),
    put: async () => "VERSION",
    completion: () => ({
      commandId: "c",
      requestDigest: "a".repeat(64),
      sourceVersionId: "VERSION",
    }),
    complete: async () => ({ stateVersion: "3" }),
    validate: async () => ({ skill_id: "s", valid: true }),
  }
  assert.deepEqual(
    await handoffSkillPackage(
      {
        scope: "scope",
        fingerprint: "b".repeat(64),
        frozen: { first: "one", second: "two" },
        commandId: "handoff",
      },
      receipts,
      steps,
      AbortSignal.timeout(1000),
    ),
    { skill_id: "s", valid: true },
  )
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

import { createHash } from "node:crypto"
import { create } from "@bufbuild/protobuf"
import { CreateSkillDraftResponseSchema } from "../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts"
import { FinalArtifactClient } from "../src/infrastructure/clients/storage/final-artifact.ts"
test("AI real HTTP final artifact body block rechecks session before receipt or owner writes", async (t) => {
  for (const mode of ["revoke", "subject", "dependency", "abort", "unchanged", "owner-ack"])
    await t.test(mode, async (t) => {
      const bytes = Buffer.from(
          "UEsDBBQAAAAAAGOsSF2izdzjLgAAAC4AAAAIAAAAU0tJTEwubWQtLS0KbmFtZTogVGVzdApkZXNjcmlwdGlvbjogQWN0dWFsCi0tLQojIFNraWxsUEsBAhQDFAAAAAAAY6xIXaLN3OMuAAAALgAAAAgAAAAAAAAAAAAAAIABAAAAAFNLSUxMLm1kUEsFBgAAAAABAAEANgAAAFQAAAAAAA==",
          "base64",
        ),
        digest = createHash("sha256").update(bytes).digest("hex"),
        effects = []
      let release,
        started,
        identityMode = "unchanged",
        admissions = 0,
        associations = 0,
        assetReads = 0,
        row = null
      const gate = new Promise((resolve) => {
          release = resolve
        }),
        sourceStarted = new Promise((resolve) => {
          started = resolve
        })
      const source = createServer(async (_req, res) => {
        res.writeHead(200, {
          "content-type": "application/zip",
          "content-length": bytes.length,
        })
        res.write(bytes.subarray(0, -1))
        started()
        await gate
        res.end(bytes.subarray(-1))
      })
      source.listen(0, "127.0.0.1")
      await once(source, "listening")
      const origin = `http://127.0.0.1:${source.address().port}`
      const association = Object.freeze({
        conversationId: "conversation",
        runId: "run",
        artifactId: "artifact",
        sourceEventId: "event",
        sourceEventSeq: "1",
        sourceEventDigest: "a".repeat(64),
        sourceAssetId: "asset",
        sourceContentSha256: digest,
        sizeBytes: String(bytes.length),
      })
      const item = Object.freeze({
        mime_type: "application/zip",
        artifact_kind: "archive",
        size_bytes: association.sizeBytes,
        content_sha256: digest,
      })
      t.mock.method(FinalArtifactClient.prototype, "get", async () => {
        assetReads++
        return item
      })
      t.mock.method(FinalArtifactClient.prototype, "downloadReference", async () => ({
        url: `${origin}/artifact`,
        method: "GET",
        requiredHeaders: {},
        expiresAt: Date.now() + 60000,
      }))
      const server = createBffServer(
        {
          ...correctionConfig,
          storage: {
            baseUrl: "http://storage.test",
            secret: "secret",
            objectOrigin: origin,
          },
        },
        {
          sessionAdmission: {
            verify: async () => {
              admissions++
              if (identityMode === "revoke") return { ok: false, status: 401, code: "session_invalid" }
              if (identityMode === "dependency")
                return {
                  ok: false,
                  status: 503,
                  code: "iam_admission_unavailable",
                }
              return {
                ok: true,
                identity: {
                  namespace: "tenant",
                  userId: identityMode === "subject" ? "other" : "user",
                },
                platformAdmin: false,
              }
            },
          },
          skillAuthorization: { check: async () => ({ ok: true }) },
          businessStore: {
            services: {
              skillAiAssociation: async () => {
                associations++
                return association
              },
            },
            getReceipt: async () => {
              effects.push("receipt")
              if (mode === "owner-ack") return row
              throw Error("test stop before write")
            },
            claimReceipt: async (_scope, fingerprint) => {
              effects.push("claim")
              row = { fingerprint, status: 102, body: {} }
              return { claimed: true, receipt: null }
            },
            compareAndSetReceipt: async (_scope, _fingerprint, _expected, replacement) => {
              effects.push("CAS")
              row = replacement
              return { updated: true, receipt: row }
            },
          },
          skillProductClient: {
            command: async (name) => {
              effects.push(name)
              if (mode === "owner-ack") return create(CreateSkillDraftResponseSchema, { skillId: { value: "" }, status: 1, revision: 1n, stateVersion: 1n })
              throw Error("test stop before owner write")
            },
          },
        },
      )
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const controller = new AbortController()
      try {
        const pending = fetch(`http://127.0.0.1:${server.address().port}/v1/skills/ai-import`, {
          method: "POST",
          headers: correctionHeaders,
          signal: controller.signal,
          body: JSON.stringify({
            conversation_id: "conversation",
            artifact_ref: "artifact",
            metadata: { display_name: "Skill", summary: "", tags: [] },
          }),
        }).then(
          async (response) => ({
            status: response.status,
            body: await response.json(),
          }),
          (error) => ({ aborted: error.name }),
        )
        await Promise.race([sourceStarted, new Promise((_, reject) => setTimeout(() => reject(Error("source never started")), 3000).unref())])
        assert.deepEqual(effects, [])
        if (mode === "abort") {
          controller.abort()
          await pending
          await new Promise((resolve) => setTimeout(resolve, 20))
        } else identityMode = mode
        release()
        const result = await pending
        if (mode === "owner-ack") {
          assert.equal(result.status, 502)
          assert.equal(result.body.error.code, "skill_response_invalid")
          assert.equal(admissions, 2)
          assert.deepEqual(effects, ["receipt", "claim", "receipt", "CAS", "createSkillDraft"])
        } else if (mode === "unchanged") {
          assert.equal(result.status, 503)
          assert.equal(admissions, 2)
          assert.deepEqual(effects, ["receipt"])
        } else {
          if (mode !== "abort") {
            assert.equal(result.status, mode === "dependency" ? 503 : 404)
            assert.equal(associations, 2)
            assert.equal(assetReads, 2)
          }
          assert.deepEqual(effects, [], "no receipt/Create/Begin/PUT/Complete after stale admission")
        }
        assert.equal(association.sourceContentSha256, digest)
        assert.equal(item.content_sha256, digest)
      } finally {
        release()
        server.closeAllConnections()
        source.closeAllConnections()
        await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => source.close(resolve))])
      }
    })
})
