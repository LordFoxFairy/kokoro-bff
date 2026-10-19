import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { test } from "node:test"
import { personalKnowledgeRoute } from "../dist/http/routes/personal-knowledge.js"
test("retired knowledge requests do no repository or response I/O", async () => {
  for (const state of ["aborted", "destroyed", "writableEnded"]) {
    let calls = 0
    const req = Object.assign(new EventEmitter(), { method: "GET", url: "/v1/preferences/knowledge", headers: {}, aborted: state === "aborted" })
    const res = Object.assign(new EventEmitter(), {
      destroyed: state === "destroyed",
      writableEnded: state === "writableEnded",
      setHeader() {
        calls += 1
        throw Error("response must not be used")
      },
    })
    const store = {
      services: {
        personalKnowledge: {
          list: async () => {
            calls += 1
            return { kind: "ok", value: [] }
          },
        },
      },
    }
    await personalKnowledgeRoute(req, res, { identity: { namespace: "tenant", userId: "subject" }, requestId: "request" }, store)
    assert.equal(calls, 0, state)
  }
})
