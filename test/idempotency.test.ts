import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { mutationTicket, type IdempotencyEntry } from "../dist/application/idempotency.js"
import { mutationFingerprint } from "../dist/http/request.js"

function context(subjectId: string) {
  return { requestId: `request-${subjectId}`, identity: { namespace: "tenant-a", userId: subjectId } }
}

function request(url: string, contentType = "application/json; charset=utf-8") {
  return {
    method: "PATCH",
    url,
    headers: { "content-type": contentType },
  } as import("node:http").IncomingMessage
}

describe("outer mutation idempotency", () => {
  it("scopes an identical route and key by the trusted subject", async () => {
    const receipts = new Map<string, IdempotencyEntry>()
    const first = await mutationTicket("same-key", "PATCH", "/sessions/session-a/title", context("owner-a"), "same", receipts)
    const second = await mutationTicket("same-key", "PATCH", "/sessions/session-a/title", context("owner-b"), "same", receipts)

    assert.ok(first.ticket)
    assert.ok(second.ticket)
    assert.equal(second.replay, null)
    assert.equal(second.conflict, false)
  })

  it("fingerprints canonical route semantics including effective query values", () => {
    const compact = mutationFingerprint(
      request("/v1/sessions/session-a/title?project_ref=project-a&scope=tenant-a"),
      ["sessions", "session-a", "title"],
      { title: "  Renamed  " },
      Buffer.from('{"title":"  Renamed  "}'),
    )
    const reordered = mutationFingerprint(
      request("/v1/sessions/session-a/title?scope=tenant-a&project_ref=%20project-a%20"),
      ["sessions", "session-a", "title"],
      { title: "Renamed" },
      Buffer.from('{ "title": "Renamed" }'),
    )
    const drifted = mutationFingerprint(
      request("/v1/sessions/session-a/title?scope=tenant-a&project_ref=project-b"),
      ["sessions", "session-a", "title"],
      { title: "Renamed" },
      Buffer.from('{"title":"Renamed"}'),
    )

    assert.equal(compact, reordered)
    assert.notEqual(compact, drifted)
  })
})
