import "./agui-public-position.test.mjs"

import assert from "node:assert/strict"
import { it } from "node:test"

import { PostgresAgUiProjectionRepository } from "../dist/infrastructure/postgres/agui-projection-repository.js"

it("resolves cursor, frame page, head, and run terminal state in one database statement", async () => {
  const queries = []
  const parameters = []
  const database = {
    pool: {
      query: async (sql, values) => {
        queries.push(sql)
        parameters.push(values)
        if (sql.includes("cursor_position")) {
          return {
            rows: [{
              head_identity_valid: true,
              cursor_valid: true,
              after_sequence: "4",
              head_sequence: "5",
              terminal_run_id: null,
              public_sequence: "5",
              cursor: "agui_55555555555555555555555555555555",
              event_type: "RUN_STARTED",
              event_payload: { type: "RUN_STARTED", threadId: "session_1", runId: "run_1", metadata: { kokoro: { event_id: "source_4", seq: 4, session_id: "session_1", run_id: "run_1", timestamp: "2026-01-01T00:00:04.000Z" } } },
            }],
          }
        }
        if (sql.includes("AND cursor = $3")) return { rows: [{ public_sequence: "4" }] }
        if (sql.includes("SELECT public_sequence, cursor")) {
          return { rows: [{ public_sequence: "5", cursor: "agui_55555555555555555555555555555555", event_type: "RUN_STARTED", event_payload: { type: "RUN_STARTED", threadId: "session_1", runId: "run_1", metadata: { kokoro: { event_id: "source_4", seq: 4, session_id: "session_1", run_id: "run_1", timestamp: "2026-01-01T00:00:04.000Z" } } } }] }
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
    4096,
  )

  assert.equal(queries.length, 1)
  assert.deepEqual(parameters, [["tenant_1", "session_1", "agui_44444444444444444444444444444444", 100, 4096]])
  assert.equal(page.kind, "page")
  assert.equal(page.atHead, true)
  assert.equal(page.terminalRunId, null)
  assert.deepEqual(page.frames.map((frame) => frame.publicSequence), [5])
})
