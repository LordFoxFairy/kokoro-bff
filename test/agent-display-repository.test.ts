import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { test } from "node:test"
import { PostgresChatRepository } from "../src/infrastructure/postgres/chat-repository.js"
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}
const lifetime = (controller: AbortController) => ({ signal: controller.signal, deadlineAt: performance.now() + 1000 })
test("display bounded finder abort destroys a held query instead of leaving pool work alive", async () => {
  const entered = deferred<void>(),
    held = deferred<{ rows: never[] }>(),
    releases: unknown[] = []
  const query = async (sql: string) => {
    if (sql.startsWith("SELECT conversation_id")) {
      entered.resolve()
      return held.promise
    }
    return { rows: [] }
  }
  const client = Object.assign(new EventEmitter(), { query, release: (broken?: unknown) => releases.push(broken) })
  const repository = new PostgresChatRepository({ pool: { query, connect: async () => client } } as never),
    controller = new AbortController()
  const pending = repository.findConversation("tenant", "owner", "session", undefined, lifetime(controller))
  await entered.promise
  controller.abort()
  try {
    assert.equal(
      await Promise.race([
        pending.then(
          () => "resolved",
          () => "rejected",
        ),
        new Promise((r) => setTimeout(() => r("still-pending"), 25)),
      ]),
      "rejected",
    )
    assert.deepEqual(releases, [true])
  } finally {
    held.resolve({ rows: [] })
    await pending.catch(() => undefined)
  }
})
test("display bounded finder releases a late checkout without SQL after actor lifetime retirement", async () => {
  const checkout = deferred<never>(),
    calls: string[] = [],
    releases: unknown[] = []
  const client = Object.assign(new EventEmitter(), {
    query: async (sql: string) => {
      calls.push(sql)
      return { rows: [] }
    },
    release: (broken?: unknown) => releases.push(broken),
  })
  const repository = new PostgresChatRepository({
      pool: {
        connect: () => checkout.promise,
        query: async () => {
          throw Error("unbounded finder")
        },
      },
    } as never),
    controller = new AbortController()
  const pending = repository.findConversation("tenant", "owner", "session", undefined, lifetime(controller))
  controller.abort()
  await assert.rejects(pending)
  checkout.resolve(client as never)
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(calls, [])
  assert.deepEqual(releases, [undefined])
})
