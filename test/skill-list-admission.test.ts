import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import test from "node:test"
import { SkillListAdmissionClient } from "../src/auth/skill-list-admission.client.js"

async function peer(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const seen: { path?: string; authorization?: string; body: string }[] = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    seen.push({ path: request.url, authorization: request.headers.authorization, body: Buffer.concat(chunks).toString() })
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "request-list", ...headers })
    response.end(JSON.stringify(body))
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  return {
    seen,
    client: new SkillListAdmissionClient({
      baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      timeoutMs: 1000,
      maxResponseBytes: 4096,
    }),
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
const input = () => ({ token: "fixture-not-secret", requestId: "request-list", signal: new AbortController().signal })
test("public skill-list admission accepts only exact IAM-produced key or Open App facts on its dedicated endpoint", async () => {
  for (const principal of [
    { kind: "user_api_key", tenant_id: "tenant", user_id: "user", key_id: "key" },
    { kind: "oauth_app", tenant_id: "tenant", user_id: "user", client_id: "client", app_id: "app", trusted: false },
    { kind: "oauth_app", tenant_id: "tenant", user_id: "user", client_id: "client", app_id: "app", trusted: true },
  ]) {
    const fixture = await peer({ data: principal })
    try {
      const result = await fixture.client.verify(input())
      assert.deepEqual(result, { ok: true, principal })
      assert.deepEqual(fixture.seen, [{ path: "/internal/v1/skill-list-identities/verify", authorization: "Bearer fixture-not-secret", body: "" }])
    } finally {
      await fixture.close()
    }
  }
})
test("public skill-list admission rejects incomplete, self-promoted or stripped identity responses without a session fallback", async () => {
  for (const body of [
    { data: { kind: "oauth_app", tenant_id: "tenant", user_id: "user", client_id: "client", app_id: "app" } },
    { data: { kind: "user_api_key", tenant_id: "tenant", user_id: "user", key_id: "key", trusted: true } },
    { data: { tenant_id: "tenant", user_id: "user", platform_admin: true } },
    { data: { kind: "user_api_key", tenant_id: "tenant", user_id: "user", key_id: "key" }, extra: true },
  ]) {
    const fixture = await peer(body)
    try {
      assert.deepEqual(await fixture.client.verify(input()), { ok: false, status: 503, code: "iam_admission_unavailable" })
      assert.equal(fixture.seen.length, 1)
    } finally {
      await fixture.close()
    }
  }
})
