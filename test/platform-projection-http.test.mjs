import assert from "node:assert/strict"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { PlatformProjectionHttpClient } from "../dist/infrastructure/clients/platform/projection-http.js"
test("projection client sends tenant/subject bearer and rejects missing no-store", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "projection-")),
    file = path.join(dir, "c.json")
  await writeFile(
    file,
    JSON.stringify([
      {
        tenantId: "t",
        generation: 1,
        credentialRefVersion: "v",
        clientId: "id",
        clientSecret: "s",
        resource: "https://kokoro.dev/resources/platform-internal",
        scope: "platform:projection.read",
      },
    ]),
  )
  await chmod(file, 0o600)
  const original = globalThis.fetch
  let ownerHeaders
  globalThis.fetch = async (input, init) =>
    String(input).includes("/iam/oauth2/token")
      ? new Response(JSON.stringify({ access_token: "token", token_type: "Bearer", scope: "platform:projection.read", expires_in: 60 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      : ((ownerHeaders = new Headers(input instanceof Request ? input.headers : init.headers)),
        new Response(JSON.stringify({ data: { skills: [] } }), { status: 200, headers: { "content-type": "application/json", "x-kokoro-request-id": "r" } }))
  try {
    const result = await new PlatformProjectionHttpClient("http://platform.test", "http://iam.test", file).read("skills", "t", "u", "r")
    assert.deepEqual(result, { ok: false, status: 502, code: "skill_response_invalid", retryable: false })
    assert.equal(ownerHeaders.get("authorization"), "Bearer token")
    assert.equal(ownerHeaders.get("x-kokoro-subject"), "u")
  } finally {
    globalThis.fetch = original
    await rm(dir, { recursive: true, force: true })
  }
})

test("projection client rejects an oversized stream before full buffering", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "projection-"))
  const file = path.join(dir, "c.json")
  await writeFile(
    file,
    JSON.stringify([
      {
        tenantId: "t",
        generation: 1,
        credentialRefVersion: "v",
        clientId: "id",
        clientSecret: "s",
        resource: "https://kokoro.dev/resources/platform-internal",
        scope: "platform:projection.read",
      },
    ]),
  )
  await chmod(file, 0o600)
  const original = globalThis.fetch
  let cancelled = false
  let pulls = 0
  globalThis.fetch = async (input) => {
    if (String(input).includes("/iam/oauth2/token"))
      return new Response(JSON.stringify({ access_token: "token", token_type: "Bearer", scope: "platform:projection.read", expires_in: 60 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    const body = new ReadableStream({
      pull(controller) {
        pulls += 1
        if (pulls <= 2) controller.enqueue(new Uint8Array(16))
        else controller.close()
      },
      cancel() {
        cancelled = true
      },
    })
    return new Response(body, { status: 200, headers: { "content-type": "application/json", "x-kokoro-request-id": "r", "cache-control": "no-store" } })
  }
  try {
    const result = await new PlatformProjectionHttpClient("http://platform.test", "http://iam.test", file, 5000, 8).read("skills", "t", "u", "r")
    assert.deepEqual(result, { ok: false, status: 502, code: "skill_response_invalid", retryable: false })
    assert.equal(cancelled, true)
    assert.ok(pulls <= 2)
  } finally {
    globalThis.fetch = original
    await rm(dir, { recursive: true, force: true })
  }
})

async function withProjectionOwner(ownerFetch, run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "projection-"))
  const file = path.join(dir, "c.json")
  await writeFile(
    file,
    JSON.stringify([
      {
        tenantId: "t",
        generation: 1,
        credentialRefVersion: "v",
        clientId: "id",
        clientSecret: "s",
        resource: "https://kokoro.dev/resources/platform-internal",
        scope: "platform:projection.read",
      },
    ]),
  )
  await chmod(file, 0o600)
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) =>
    String(input).includes("/iam/oauth2/token")
      ? new Response(JSON.stringify({ access_token: "token", token_type: "Bearer", scope: "platform:projection.read", expires_in: 60 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      : ownerFetch(input, init)
  try {
    return await run(new PlatformProjectionHttpClient("http://platform.test", "http://iam.test", file))
  } finally {
    globalThis.fetch = original
    await rm(dir, { recursive: true, force: true })
  }
}

const ownerHeaders = { "content-type": "application/json", "x-kokoro-request-id": "r", "cache-control": "no-store" }

test("projection client does not leak owner auth/error codes to Product API", async () => {
  for (const [ownerStatus, ownerCode, publicStatus, publicCode] of [
    [404, "capability.route_not_found", 404, "skill_not_found"],
    [401, "capability.service_auth_failed", 503, "skill_dependency_unavailable"],
    [403, "capability.tenant_mismatch", 503, "skill_dependency_unavailable"],
    [429, "capability.rate_limited", 502, "skill_response_invalid"],
  ]) {
    const result = await withProjectionOwner(
      async () =>
        new Response(JSON.stringify({ error: { code: ownerCode, message: "internal", retryable: false } }), { status: ownerStatus, headers: ownerHeaders }),
      (client) => client.read("skill", "t", "u", "r", { skillId: "skill-one" }),
    )
    assert.equal(result.status, publicStatus)
    assert.equal(result.code, publicCode)
  }
  const network = await withProjectionOwner(
    async () => {
      throw new Error("network down")
    },
    (client) => client.read("skill", "t", "u", "r", { skillId: "skill-one" }),
  )
  assert.deepEqual(network, { ok: false, status: 503, code: "skill_dependency_unavailable", retryable: true })
})

test("projection by-ID response must bind requested identity and exact public fields", async () => {
  const base = { skill_id: "skill-one", source_ref: "skill:skill-one", revision: "1", status: "active", name: "Name", summary: "Summary", tags: [] }
  for (const data of [
    { ...base, skill_id: "skill-other" },
    { ...base, source_ref: "skill:skill-other" },
    { ...base, status: "draft" },
    { ...base, package_asset_ref: "private" },
  ]) {
    const result = await withProjectionOwner(
      async () => new Response(JSON.stringify({ data }), { status: 200, headers: ownerHeaders }),
      (client) => client.read("skill", "t", "u", "r", { skillId: "skill-one" }),
    )
    assert.deepEqual(result, { ok: false, status: 502, code: "skill_response_invalid", retryable: false })
  }
})
