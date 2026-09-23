import assert from "node:assert/strict"
import type { ServerResponse } from "node:http"
import { test } from "node:test"

import { createBffServer } from "../dist/bootstrap/server.js"
import { DEFAULT_AGUI_CONFIG, type BffConfig } from "../dist/config/runtime.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise: (() => void) | undefined
  const promise = new Promise<void>((resolve) => { resolvePromise = resolve })
  return {
    promise,
    resolve: () => { resolvePromise?.() },
  }
}

function config(): BffConfig {
  return {
    host: "127.0.0.1",
    port: 4300,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant_lifecycle",
    iamBaseUrl: null,
    sharedSecret: "web-secret",
    upstreamSecret: "bff-secret",
    upstreamTimeoutMs: 5000,
    upstreamMaxResponseBytes: 1024 * 1024,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: {
      system: null,
      model: null,
      capability: null,
      storage: null,
      scheduler: null,
      agents: null,
      billing: null,
      music: null,
    },
  }
}

function end(response: ServerResponse): void {
  response.writeHead(200, { "content-type": "application/json" })
  response.end('{"data":{"ok":true},"meta":{"request_id":"lifecycle"}}')
}

test("shutdown stops admission and drains HTTP plus workers before closing stores exactly once", async () => {
  const requestGate = deferred()
  const workerGate = deferred()
  const requestStarted = deferred()
  const events: string[] = []
  const worker = {
    start: (): void => { events.push("worker_started") },
    stop: async (): Promise<void> => {
      events.push("worker_stop_requested")
      await workerGate.promise
      events.push("worker_stopped")
    },
  }
  const server = createBffServer(config(), {
    businessStore: null,
    sessionAdmission: new SessionAdmissionDouble({ "lifecycle-session": { namespace: "tenant_lifecycle", userId: "user_lifecycle" } }),
    readiness: async (): Promise<void> => undefined,
    agentDispatchDispatcher: worker,
    close: async (): Promise<void> => { events.push("store_closed") },
    routeHandler: async ({ response }): Promise<boolean> => {
      requestStarted.resolve()
      await requestGate.promise
      events.push("request_finished")
      end(response)
      return true
    },
  })

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    const address = server.address()
    if (address === null || typeof address === "string") throw new Error("server did not bind")
    const responsePromise = fetch(`http://127.0.0.1:${address.port}/v1/lifecycle`, {
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "web-secret",
        authorization: "Bearer lifecycle-session",
      },
    })
    await requestStarted.promise

    assert.equal(typeof server.shutdown, "function")
    const first = server.shutdown(1000)
    const replay = server.shutdown(1000)
    assert.equal(first, replay)
    await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal(server.listening, false)
    assert.deepEqual(events, ["worker_started", "worker_stop_requested"])

    requestGate.resolve()
    await responsePromise
    assert.equal(events.includes("store_closed"), false)
    workerGate.resolve()
    await first

    assert.deepEqual(events, [
      "worker_started",
      "worker_stop_requested",
      "request_finished",
      "worker_stopped",
      "store_closed",
    ])
    await server.shutdown(1000)
    assert.equal(events.filter((event) => event === "store_closed").length, 1)
  } finally {
    requestGate.resolve()
    workerGate.resolve()
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
