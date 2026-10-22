import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import test from "node:test"
import { OpenAppManagementAdmissionClient } from "../src/auth/open-app-management-admission.client.js"

async function peer(body: unknown, status = 200) {
  const seen: { path?: string; authorization?: string; body: string }[] = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    seen.push({ path: request.url, authorization: request.headers.authorization, body: Buffer.concat(chunks).toString() })
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "request-app" })
    response.end(JSON.stringify(body))
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  return {
    seen,
    client: new OpenAppManagementAdmissionClient({
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
const input = () => ({ token: "current-operator", requestId: "request-app", signal: new AbortController().signal, tenantId: "tenant", appId: "app" })
test("Open App management requires a fresh exact IAM operator registration, with no caller-supplied client or trust", async () => {
  const registration = { allowed: true, tenant_id: "tenant", app_id: "app", client_id: "managed-client" }
  const fixture = await peer({ data: registration })
  try {
    assert.deepEqual(await fixture.client.verify(input()), { ok: true, registration })
    assert.deepEqual(await fixture.client.verify(input()), { ok: true, registration })
    assert.deepEqual(
      fixture.seen,
      Array(2).fill({ path: "/internal/v1/open-app-registrations/app/management-authorizations/verify", authorization: "Bearer current-operator", body: "" }),
    )
  } finally {
    await fixture.close()
  }
})
test("Open App management rejects cross-tenant/app and incomplete or self-promoted operator responses", async () => {
  for (const data of [
    { allowed: true, tenant_id: "other", app_id: "app", client_id: "client" },
    { allowed: true, tenant_id: "tenant", app_id: "other", client_id: "client" },
    { allowed: true, tenant_id: "tenant", app_id: "app" },
    { allowed: true, tenant_id: "tenant", app_id: "app", client_id: "client", platform_admin: true },
    { allowed: false, tenant_id: "tenant", app_id: "app", client_id: "client" },
  ]) {
    const fixture = await peer({ data })
    try {
      assert.deepEqual(await fixture.client.verify(input()), { ok: false, status: 503, code: "iam_admission_unavailable" })
    } finally {
      await fixture.close()
    }
  }
})
test("Open App operator denial remains403, never inferred from platform-admin Session or body", async () => {
  const fixture = await peer({ error: { code: "PERMISSION_DENIED", message: "Operator required", retryable: false, details: [] } }, 403)
  try {
    assert.deepEqual(await fixture.client.verify(input()), { ok: false, status: 403, code: "open_app_management_forbidden" })
  } finally {
    await fixture.close()
  }
})
