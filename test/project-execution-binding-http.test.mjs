import assert from "node:assert/strict"
import test from "node:test"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { once } from "node:events"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const wire = {
  tenant_id: "tenant",
  actor_id: "user",
  subject_id: "user",
  run_id: "run",
  session_id: "session",
  identity_assertion_ref: "bff:binding",
  project_ref: "project",
  selection_digest: createHash("sha256")
    .update(JSON.stringify(["skill:exact"]))
    .digest("hex"),
}
test("Internal project binding admits only the current dedicated IAM credential and exact intent", async () => {
  const module = await import("../src/http/routes/project-execution-binding.ts").catch(() => ({}))
  assert.equal(typeof module.projectExecutionBindingRoute, "function")
  const dir = await mkdtemp(join(tmpdir(), "kokoro-binding-"))
  const file = join(dir, "credential.json")
  const secret = "IAM-ONLY-" + "a".repeat(40)
  const credentials = (value = secret) => ({
    version: 1,
    entries: [{ credential_id: "iam-reader", caller: "kokoro-iam", surface: "project_execution_binding", tenant_id: "tenant", secret: value }],
  })
  await writeFile(file, JSON.stringify(credentials()), { mode: 0o600 })
  const calls = []
  const reader = {
    async readProjectExecutionBinding(input) {
      calls.push(input)
      return { projectId: input.projectId, selectedSkillSourceRefs: ["skill:exact"], selectionDigest: input.selectionDigest }
    },
  }
  const server = createServer((req, res) => void module.projectExecutionBindingRoute(req, res, file, reader))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const url = `http://127.0.0.1:${server.address().port}/internal/v1/project-execution-bindings/verify`
  const post = (body = wire, token = secret) =>
    fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  try {
    const valid = await post()
    assert.equal(valid.status, 200)
    assert.deepEqual(await valid.json(), {
      data: { project_ref: "project", selected_skill_source_refs: ["skill:exact"], selection_digest: wire.selection_digest },
    })
    assert.equal(valid.headers.get("cache-control"), "no-store")
    assert.ok(valid.headers.get("x-request-id"))
    for (const body of [
      { ...wire, tenant_id: "foreign" },
      { ...wire, actor_id: "other" },
      { ...wire, project_ref: undefined },
      { ...wire, extra: true },
    ])
      assert.notEqual((await post(body)).status, 200)
    assert.equal((await post(wire, "web-service-secret")).status, 403)
    assert.equal((await post(JSON.stringify(wire).replace('"tenant_id":"tenant"', '"tenant_id":"ignored","tenant_id":"tenant"'))).status, 400)
    const encoded = JSON.stringify(wire)
    assert.equal((await post(encoded.padEnd(8193, " "))).status, 400)
    assert.equal(calls.length, 1, "oversized or duplicate-key input performs no owner read")
    assert.equal((await post(encoded.padEnd(8192, " "))).status, 200)
    assert.equal(calls.length, 2, "the exact 8KiB byte limit remains usable")
    await writeFile(file, JSON.stringify(credentials("NEW-" + secret)), { mode: 0o600 })
    assert.equal((await post()).status, 403)
    await writeFile(file, "{}")
    assert.equal((await post()).status, 503)
    assert.equal(calls.length, 2, "no stale credential or decision fallback")
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  }
})

test("Internal binding deadline rejects late reads without a late successful response", async () => {
  const { projectExecutionBindingRoute } = await import("../src/http/routes/project-execution-binding.ts")
  const dir = await mkdtemp(join(tmpdir(), "kokoro-binding-deadline-"))
  const file = join(dir, "credential.json")
  const secret = "IAM-ONLY-" + "d".repeat(40)
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      entries: [{ credential_id: "iam", caller: "kokoro-iam", surface: "project_execution_binding", tenant_id: "tenant", secret }],
    }),
    { mode: 0o600 },
  )
  let finished = false
  let observedSignal
  const reader = {
    async readProjectExecutionBinding(input) {
      observedSignal = input.signal
      await new Promise((resolve) => setTimeout(resolve, 3250))
      finished = true
      return { projectId: input.projectId, selectedSkillSourceRefs: ["skill:exact"], selectionDigest: input.selectionDigest }
    },
  }
  const server = createServer((req, res) => void projectExecutionBindingRoute(req, res, file, reader))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/internal/v1/project-execution-bindings/verify`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify(wire),
    })
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, "binding_unavailable")
    assert.equal(observedSignal.aborted, true)
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.equal(finished, true)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  }
})
