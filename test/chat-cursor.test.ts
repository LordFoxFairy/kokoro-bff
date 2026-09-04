import assert from "node:assert/strict"
import { test } from "node:test"

import { decodeCursor, encodeCursor } from "../dist/infrastructure/postgres/chat-repository-mappers.js"

test("Message cursors preserve PostgreSQL BIGINT sequence values without Number coercion", () => {
  const sequence = "9223372036854775806"
  const cursor = encodeCursor({ sequence, id: "message-high" }, "msg")

  assert.deepEqual(decodeCursor(cursor, "msg"), { sequence, id: "message-high" })
  assert.equal(cursor.includes("created_at"), false)
})
