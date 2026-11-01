import { strictParseRawJson } from "../src/infrastructure/raw-json.ts"
import type { ScheduledRunsQuery, ScheduledTaskRunsReader } from "../src/application/scheduled-task-runs.types.ts"
import assert from "node:assert/strict"
import test from "node:test"
import { listScheduledTaskRuns as listWithParser } from "../src/application/scheduled-task-runs-service.ts"
const listScheduledTaskRuns = (reader: ScheduledTaskRunsReader, q: ScheduledRunsQuery, revalidate: () => Promise<void>) =>
  listWithParser(reader, q, revalidate, strictParseRawJson)
const query = () => ({
  tenantId: "t",
  subjectId: "s",
  taskId: null,
  limit: 20,
  position: null,
  signal: new AbortController().signal,
  deadlineAt: performance.now() + 1000,
})
const empty = { taskExists: false, rows: [] }
test("full same snapshot before and after final admission, no held lease abstraction", async () => {
  const order: string[] = []
  const page = await listScheduledTaskRuns(
    {
      readSnapshot: async () => {
        order.push("read")
        return empty
      },
    },
    query(),
    async () => {
      order.push("IAM")
    },
  )
  assert.deepEqual(order, ["read", "IAM", "read"])
  assert.deepEqual(page, { items: [], nextPosition: null })
})
test("changed eligibility fails even if both pages would appear empty", async () => {
  let n = 0
  await assert.rejects(listScheduledTaskRuns({ readSnapshot: async () => ({ ...empty, taskExists: ++n === 1 }) }, query(), async () => {}))
})
test("final admission failure or changed subject prevents second read", async () => {
  let reads = 0
  await assert.rejects(
    listScheduledTaskRuns(
      {
        readSnapshot: async () => {
          reads++
          return empty
        },
      },
      query(),
      async () => {
        throw Error("revoked")
      },
    ),
  )
  assert.equal(reads, 1)
})
test("noncooperative reader retirement absorbs late result with no final IAM or reread", async () => {
  let resolve!: (value: unknown) => void,
    calls = 0
  const pending = listScheduledTaskRuns(
    {
      readSnapshot: () =>
        new Promise((r) => {
          resolve = r
        }),
    },
    { ...query(), deadlineAt: performance.now() + 15 },
    async () => {
      calls++
    },
  )
  await assert.rejects(pending)
  resolve(empty)
  await new Promise((r) => setImmediate(r))
  assert.equal(calls, 0)
})
test("abort and expired absolute clock issue zero new IO", async () => {
  const c = new AbortController()
  c.abort()
  let calls = 0
  for (const q of [
    { ...query(), signal: c.signal },
    { ...query(), deadlineAt: performance.now() - 1 },
  ])
    await assert.rejects(
      listScheduledTaskRuns(
        {
          readSnapshot: async () => {
            calls++
            return empty
          },
        },
        q,
        async () => {
          calls++
        },
      ),
    )
  assert.equal(calls, 0)
})
