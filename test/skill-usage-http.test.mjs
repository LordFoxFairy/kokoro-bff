import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { skillUsageResult } from "../src/application/agui/skill-usage.ts"
test("Public usage source uses B1 unavailable union, not empty-row zero or installation count", async () => {
  const module = await import("../src/http/routes/skill-usage.ts").catch(() => ({}))
  assert.equal(typeof module.skillUsageRoute, "function")
  assert.deepEqual(skillUsageResult("unavailable", 10n), { status: "unavailable" })
  assert.doesNotMatch(readFileSync(new URL("../src/http/routes/skill-usage.ts", import.meta.url), "utf8"), /successful_run_count:\s*0/u)
})

import { createServer } from "node:http"
import { once } from "node:events"
import { skillUsageRoute } from "../src/http/routes/skill-usage.ts"
test("Usage HTTP batches bounded exact refs and preserves unavailable versus complete zero", async () => {
  let calls = 0
  const server = createServer(
    (request, response) =>
      void skillUsageRoute(request, response, { requestId: "request", identity: { namespace: "tenant", userId: "user" } }, async (tenant, refs) => {
        calls++
        assert.equal(tenant, "tenant")
        return new Map(refs.map((ref) => [ref, ref === "skill:unknown" ? { status: "unavailable" } : { status: "available", successfulRunCount: "0" }]))
      }),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const url = `http://127.0.0.1:${server.address().port}/v1/skills/usage`
    const post = (body, extra = {}) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(body) })
    const valid = await post({ source_refs: ["skill:unknown", "skill:complete"] })
    assert.equal(valid.status, 200)
    assert.deepEqual(await valid.json(), {
      data: {
        items: [
          { source_ref: "skill:unknown", status: "unavailable" },
          { source_ref: "skill:complete", status: "available", successful_run_count: "0" },
        ],
      },
    })
    for (const body of [{ source_refs: [] }, { source_refs: ["skill:one", "skill:one"] }, { source_refs: ["skill:one"], tenant: "foreign" }])
      assert.equal((await post(body)).status, 400)
    assert.equal((await post({ source_refs: ["skill:one"] }, { "idempotency-key": "invalid-read-key" })).status, 400)
    assert.equal(calls, 1)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
