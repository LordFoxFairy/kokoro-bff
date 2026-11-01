import assert from "node:assert/strict"
import test from "node:test"
import { RssPollService } from "../src/application/rss-poll-service.js"
import type { RssPollLease, RssPollIdentity, RssFrozenLaunch } from "../src/domain/scheduled-task/rss-poll.types.js"
const entry = {
  identity: "a".repeat(64),
  title: "News",
  summary: "",
  content: "",
  authors: [],
  categories: [],
  link: null,
  domain: null,
  publishedAt: null,
  updatedAt: null,
  enclosures: [],
}
function fixture(initialized = true, seen: string[] = []) {
  const identity: RssPollIdentity = {
    tenantId: "t",
    subjectId: "s",
    taskId: "task",
    revision: 1,
    epoch: "1",
    scope: "scope",
    digest: "digest",
    requestId: "request",
    signal: new AbortController().signal,
    deadlineAt: performance.now() + 5000,
  }
  const lease = {
    identity,
    token: "token",
    fence: "1",
    task: { triggerKind: "rss", feedUrl: "https://feed.example.org/rss", conditions: [], prompt: "Summarize" },
    initialized,
    seen,
  } as unknown as RssPollLease
  const calls: { freeze: number; read: number; settled: unknown[]; releases: number } = { freeze: 0, read: 0, settled: [], releases: 0 }
  const deps = {
    repository: {
      release: async () => {
        calls.releases++
      },
      claim: async () => ({ outcome: "claimed" as const, lease }),
      settle: async (input: unknown) => {
        calls.settled.push(input)
        return { poll_id: "poll", outcome: "unchanged" as const, observed_count: 0, enqueued_count: 0 }
      },
    },
    read: async () => {
      calls.read++
      return new Uint8Array()
    },
    parse: () => [entry],
    freezeLaunch: () => {
      calls.freeze++
      return { item: entry } as RssFrozenLaunch
    },
  }
  return { identity, lease, calls, deps }
}
test("first baseline and previously seen content never construct a launch", async () => {
  for (const f of [fixture(false), fixture(true, [entry.identity])]) {
    await new RssPollService(f.deps).poll(f.identity)
    assert.equal(f.calls.freeze, 0)
    assert.equal(f.calls.settled.length, 1)
    assert.deepEqual((f.calls.settled[0] as { launches: unknown[] }).launches, [])
  }
})
test("all fresh matching launch projections finish before one settlement", async () => {
  const f = fixture()
  await new RssPollService(f.deps).poll(f.identity)
  assert.equal(f.calls.freeze, 1)
  assert.equal(f.calls.settled.length, 1)
})
test("parser or any launch overflow settles only closed failure, no partial entries", async () => {
  for (const stage of ["parse", "freezeLaunch"] as const) {
    const f = fixture()
    f.deps[stage] = () => {
      throw Error(stage === "parse" ? "raw external content" : "launch_too_large")
    }
    await new RssPollService(f.deps).poll(f.identity)
    const value = f.calls.settled[0] as { entries: unknown[]; launches: unknown[]; error: string }
    assert.deepEqual(value.entries, [])
    assert.deepEqual(value.launches, [])
    assert.equal(value.error, stage === "parse" ? "feed_invalid" : "launch_too_large")
  }
})
test("caller aborts noncooperative read; late bytes never parse or settle", async () => {
  const f = fixture(),
    controller = new AbortController()
  f.identity = { ...f.identity, signal: controller.signal }
  let resolve!: (v: Uint8Array) => void,
    parse = 0
  f.deps.read = () => new Promise((r) => (resolve = r))
  f.deps.parse = () => {
    parse++
    return [entry]
  }
  const pending = new RssPollService(f.deps).poll(f.identity)
  await new Promise((r) => setImmediate(r))
  controller.abort()
  await assert.rejects(pending, /cancelled/)
  resolve(new Uint8Array())
  await new Promise((r) => setImmediate(r))
  assert.equal(parse, 0)
  assert.equal(f.calls.settled.length, 0)
  assert.equal(f.calls.releases, 1)
})
test("insufficient settlement reserve or preabort performs zero repository/network work", async () => {
  const f = fixture()
  await assert.rejects(new RssPollService(f.deps).poll({ ...f.identity, deadlineAt: performance.now() + 1000 }))
  assert.equal(f.calls.read, 0)
  assert.equal(f.calls.settled.length, 0)
})
test("terminal replay never reads feed or rebuilds launch", async () => {
  const f = fixture()
  const summary = { poll_id: "original", outcome: "baseline" as const, observed_count: 1, enqueued_count: 0 }
  const service = new RssPollService({ ...f.deps, repository: { ...f.deps.repository, claim: async () => ({ outcome: "terminal" as const, summary }) } })
  assert.deepEqual(await service.poll(f.identity), { outcome: "terminal", summary })
  assert.equal(f.calls.read, 0)
  assert.equal(f.calls.freeze, 0)
})

test("admission claim resolving after caller retirement never dispatches reader", async () => {
  const f = fixture(),
    controller = new AbortController()
  f.identity = { ...f.identity, signal: controller.signal }
  f.deps.repository.claim = async () => {
    controller.abort()
    return { outcome: "claimed", lease: f.lease }
  }
  await assert.rejects(new RssPollService(f.deps).poll(f.identity))
  assert.equal(f.calls.read, 0)
  assert.equal(f.calls.settled.length, 0)
})
