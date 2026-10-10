import assert from "node:assert/strict"
import test from "node:test"
test("Skill Share source route exists separately from anonymous conversation Share", async () => {
  const module = await import("../src/http/routes/skill-share.ts").catch(() => ({}))
  assert.equal(typeof module.skillShareRoute, "function")
})

import { createServer } from "node:http"
import { once } from "node:events"
import { create } from "@bufbuild/protobuf"
import { ConnectError, Code } from "@connectrpc/connect"
import { InspectSkillPackageResponseSchema } from "../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts"
import { skillShareRoute } from "../src/http/routes/skill-share.ts"
test("Skill Share HTTP preserves creator revoke, same-tenant login and fresh withdrawn admission", async () => {
  let share = null,
    withdrawn = false,
    reads = 0
  const repository = {
    create: async (scope, sourceRef, urlFor, expiresAt) =>
      share ??
      (share = {
        shareId: "share",
        tenantId: scope.tenantId,
        creatorSubjectId: scope.creatorSubjectId,
        resourceKind: "skill_revision",
        sourceRef,
        url: urlFor("share"),
        createdAt: new Date(),
        expiresAt,
        revokedAt: null,
      }),
    findActive: async (tenant, id) => (share && share.shareId === id && share.tenantId === tenant && !share.revokedAt ? share : null),
    revoke: async (scope, id) => {
      if (!share || share.shareId !== id || share.tenantId !== scope.tenantId || share.creatorSubjectId !== scope.creatorSubjectId) return null
      share = { ...share, revokedAt: new Date() }
      return share
    },
  }
  const client = {
    inspect: async (input) => {
      reads++
      if (withdrawn) throw new ConnectError("withdrawn", Code.NotFound)
      return create(InspectSkillPackageResponseSchema, { sourceRef: { value: input.sourceRef }, revision: 1n, files: [] })
    },
  }
  const server = createServer(
    (request, response) =>
      void skillShareRoute(
        request,
        response,
        {
          requestId: "request",
          identity: { namespace: request.headers["x-fixture-tenant"] ?? "tenant", userId: request.headers["x-fixture-subject"] ?? "creator" },
        },
        new URL(request.url, "http://bff.local").pathname.split("/").slice(2),
        repository,
        client,
        "http://127.0.0.1:3310",
      ),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const base = `http://127.0.0.1:${server.address().port}/v1/skill-shares`
    let response = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source_ref: "skill:one" }) })
    assert.equal(response.status, 201)
    assert.equal((await response.json()).data.url, "http://127.0.0.1:3310/skills/shared/share")
    assert.equal(reads, 2)
    response = await fetch(`${base}/share`, { headers: { "x-fixture-tenant": "foreign" } })
    assert.equal(response.status, 404)
    assert.equal(reads, 2)
    response = await fetch(`${base}/share`, { method: "DELETE", headers: { "x-fixture-subject": "other" } })
    assert.equal(response.status, 404)
    response = await fetch(`${base}/share`)
    assert.equal(response.status, 200)
    assert.equal(reads, 3)
    withdrawn = true
    response = await fetch(`${base}/share`)
    assert.equal(response.status, 404)
    response = await fetch(`${base}/share`, { method: "DELETE" })
    assert.equal(response.status, 200)
    assert.equal((await fetch(`${base}/share`)).status, 404)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})


test("Skill Share composition uses the validated browser origin, not an invented HTTPS domain", async () => {
  const { readFile } = await import("node:fs/promises")
  const source = await readFile(new URL("../src/bootstrap/server.ts", import.meta.url), "utf8")
  assert.match(source, /composition\.skillProductClient,\s*config\.iamRelay\?\.webOrigin,/u)
})

test("Skill Share POST without a trusted public origin fails before owner inspection or share creation", async () => {
  let effects = 0
  const server = createServer((request, response) => void skillShareRoute(
    request, response,
    { requestId: "origin-negative", identity: { namespace: "tenant", userId: "creator" } },
    ["skill-shares"],
    { create: async () => { effects++; throw new Error("unexpected write") } },
    { inspect: async () => { effects++; throw new Error("unexpected inspection") } },
    undefined,
  ))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/skill-shares`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source_ref: "skill:one" }),
    })
    assert.equal(response.status, 503)
    assert.equal(effects, 0)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
