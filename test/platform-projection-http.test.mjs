import assert from "node:assert/strict"
import { chmod, mkdtemp, writeFile } from "node:fs/promises"
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
  }
})
