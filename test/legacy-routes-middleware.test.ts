import assert from "node:assert/strict"
import { test } from "node:test"
import type { IncomingMessage } from "node:http"
import { isMigratedChatRoute } from "../src/modules/legacy-routes/legacy-routes.middleware.ts"

function request(method: string, url: string): IncomingMessage {
  return { method, url } as IncomingMessage
}

test("LegacyRoutes bypasses Chat-owned migrated paths", () => {
  for (const [method, url] of [
    ["GET", "/v1/shared/share-1"],
    ["GET", "/v1/account/archived-tasks"],
    ["POST", "/v1/sessions/session-1/archive"],
    ["GET", "/v1/sessions"],
    ["GET", "/v1/sessions/session-1/messages"],
    ["PUT", "/v1/sessions/session-1/messages/message-1/feedback"],
    ["POST", "/v1/sessions/session-1/messages/message-1/regenerate"],
    ["POST", "/v1/sessions/session-1/move"],
    ["PATCH", "/v1/sessions/session-1/title"],
    ["DELETE", "/v1/sessions/session-1"],
    ["POST", "/v1/sessions/session-1/share"],
    ["DELETE", "/v1/sessions/session-1/share"],
    ["GET", "/v1/sessions/session-1/events"],
    ["PATCH", "/v1/sessions/session-1/title?project_ref=project-1"],
    ["DELETE", "/v1/sessions/session-1?project_ref=project-1"],
    ["POST", "/v1/sessions/session-1/share?project_ref=project-1"],
    ["GET", "/v1/sessions/session-1/events?project_ref=project-1"],
    ["GET", "/v1/sessions?project_ref=project-1"],
    ["GET", "/v1/sessions/session-1?project_ref=project-1"],
    ["POST", "/v1/sessions/session-1/messages"],
    ["POST", "/v1/sessions/session-1/runs/run-1/control"],
    ["GET", "/v1/sessions/session-1/runs/run-1/display"],
    ["POST", "/internal/v1/model-admissions"],
    ["POST", "/internal/v1/project-execution-bindings/verify"],
    ["POST", "/internal/v1/bff/scheduled-tasks/dispatch"],
  ]) {
    assert.equal(isMigratedChatRoute(request(method, url)), true, `${method} ${url}`)
  }
})

test("LegacyRoutes retains un-migrated Chat mutations", () => {
  for (const [method, url] of [
    ["POST", "/v1/sessions/session-1/messages/unknown"],
  ]) {
    assert.equal(isMigratedChatRoute(request(method, url)), false, `${method} ${url}`)
  }
  assert.equal(isMigratedChatRoute(request("GET", "/v1/sessions/%E0%A4%A")), false)
})
