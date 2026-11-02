import assert from "node:assert/strict"
import { test } from "node:test"
import { getEventListeners } from "node:events"
import { assetDownloadRemaining, withinAssetDownloadBudget } from "../src/application/asset-download-budget.ts"

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test("ASSET budget rejects pre-abort/expired/invalid deadlines without starting IO", async () => {
  const aborted = new AbortController()
  aborted.abort()
  for (const [signal, deadline] of [
    [aborted.signal, performance.now() + 1000],
    [new AbortController().signal, performance.now() - 1],
    [new AbortController().signal, NaN],
  ]) {
    let starts = 0
    await assert.rejects(
      withinAssetDownloadBudget(signal, deadline, async () => {
        starts++
        return 1
      }),
    )
    assert.equal(starts, 0)
  }
})

test("ASSET budget fences non-cooperative work and retires its late success exactly once", async () => {
  const pending = deferred(),
    controller = new AbortController(),
    retired = []
  const work = withinAssetDownloadBudget(
    controller.signal,
    performance.now() + 1000,
    () => pending.promise,
    (value) => retired.push(value),
  )
  controller.abort()
  await assert.rejects(work)
  assert.equal(getEventListeners(controller.signal, "abort").length, 0)
  pending.resolve("lease")
  await new Promise(setImmediate)
  assert.deepEqual(retired, ["lease"])
})

test("ASSET budget absorbs late rejection and releases listeners after ordinary failure/success", async () => {
  const controller = new AbortController(),
    pending = deferred()
  const work = withinAssetDownloadBudget(controller.signal, performance.now() + 1000, () => pending.promise)
  controller.abort()
  await assert.rejects(work)
  pending.reject(Error("late private failure"))
  await new Promise(setImmediate)
  for (const failure of [false, true]) {
    const signal = new AbortController().signal
    const current = withinAssetDownloadBudget(signal, performance.now() + 1000, async () => {
      if (failure) throw Error("failed")
      return 17
    })
    if (failure) await assert.rejects(current)
    else assert.equal(await current, 17)
    assert.equal(getEventListeners(signal, "abort").length, 0)
  }
  const signal = new AbortController().signal
  assert.equal(
    await withinAssetDownloadBudget(signal, performance.now() + 1000, () => Promise.reject(null)).then(
      () => "wrong success",
      (error) => error,
    ),
    null,
  )
  assert.equal(getEventListeners(signal, "abort").length, 0)
})

test("ASSET stages share one deadline rather than replenishing their budget", async () => {
  const signal = new AbortController().signal,
    deadline = performance.now() + 100
  await withinAssetDownloadBudget(signal, deadline, () => new Promise((resolve) => setTimeout(resolve, 65)))
  assert.ok(assetDownloadRemaining(signal, deadline) < 60)
  const started = performance.now(),
    pending = deferred()
  await assert.rejects(withinAssetDownloadBudget(signal, deadline, () => pending.promise))
  assert.ok(performance.now() - started < 90)
  pending.resolve()
  await new Promise(setImmediate)
  assert.equal(getEventListeners(signal, "abort").length, 0)
})
