import assert from "node:assert/strict"
import { it } from "node:test"

import { PostgresAgUiProjectionRepository } from "../dist/infrastructure/postgres/agui-projection-repository.js"

it("resolves cursor, frame page, head, and run terminal state in one database statement", async () => {
  const queries = []
  const database = {
    pool: {
      query: async (sql) => {
        queries.push(sql)
        if (sql.includes("cursor_position")) {
          return {
            rows: [{
              cursor_valid: true,
              after_sequence: "4",
              head_sequence: "5",
              terminal_run_id: null,
              public_sequence: "5",
              cursor: "agui_55555555555555555555555555555555",
              event_type: "RUN_STARTED",
              event_payload: { type: "RUN_STARTED" },
            }],
          }
        }
        if (sql.includes("AND cursor = $3")) return { rows: [{ public_sequence: "4" }] }
        if (sql.includes("SELECT public_sequence, cursor")) {
          return { rows: [{ public_sequence: "5", cursor: "agui_55555555555555555555555555555555", event_type: "RUN_STARTED", event_payload: { type: "RUN_STARTED" } }] }
        }
        return { rows: [{ head_sequence: "5", head_event_type: "RUN_STARTED" }] }
      },
    },
  }
  const repository = new PostgresAgUiProjectionRepository(database)

  const page = await repository.replay(
    "tenant_1",
    "session_1",
    "agui_44444444444444444444444444444444",
    100,
  )

  assert.equal(queries.length, 1)
  assert.equal(page.kind, "page")
  assert.equal(page.atHead, true)
  assert.equal(page.terminalRunId, null)
  assert.deepEqual(page.frames.map((frame) => frame.publicSequence), [5])
})
