import assert from "node:assert/strict"
import { it } from "node:test"

import { PostgresBffDatabase } from "../dist/infrastructure/postgres/client.js"

const timeout = (milliseconds) => new Promise((resolve) => setTimeout(() => resolve("timeout"), milliseconds))

function databaseWithRedis(redis) {
  const database = Object.create(PostgresBffDatabase.prototype)
  database.redis = redis
  database.connection = null
  return database
}

it("drops an AG-UI notification before Redis is ready without opening a connection", async () => {
  let connectCalls = 0
  let publishCalls = 0
  const database = databaseWithRedis({
    isOpen: false,
    isReady: false,
    connect: () => {
      connectCalls += 1
      return new Promise(() => undefined)
    },
    publish: async () => {
      publishCalls += 1
      return 1
    },
  })

  const outcome = await Promise.race([
    database.notifyAgUiProjection("tenant_1", "session_1", null).then(() => "completed"),
    timeout(100),
  ])

  assert.equal(outcome, "completed")
  assert.equal(connectCalls, 0)
  assert.equal(publishCalls, 0)
})

it("drops a stalled AG-UI publish at its hard deadline", async () => {
  let publishCalls = 0
  const redis = {
    isOpen: true,
    isReady: true,
    publish: () => new Promise(() => undefined),
    withAbortSignal: (signal) => ({
      publish: () => {
        publishCalls += 1
        return new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        })
      },
    }),
  }
  const database = databaseWithRedis(redis)

  const outcome = await Promise.race([
    database.notifyAgUiProjection("tenant_1", "session_1", "agui_11111111111111111111111111111111").then(() => "completed"),
    timeout(250),
  ])

  assert.equal(outcome, "completed")
  assert.equal(publishCalls, 1)
})
