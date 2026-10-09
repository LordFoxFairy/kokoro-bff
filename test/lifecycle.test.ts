import assert from "node:assert/strict"
import type { ServerResponse } from "node:http"
import { test } from "node:test"

import { createBffServer } from "../dist/bootstrap/server.js"
import { DEFAULT_AGUI_CONFIG, type BffConfig } from "../dist/config/runtime.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: () => {
      resolvePromise?.()
    },
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
    start: (): void => {
      events.push("worker_started")
    },
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
    close: async (): Promise<void> => {
      events.push("store_closed")
    },
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

    assert.deepEqual(events, ["worker_started", "worker_stop_requested", "request_finished", "worker_stopped", "store_closed"])
    await server.shutdown(1000)
    assert.equal(events.filter((event) => event === "store_closed").length, 1)
  } finally {
    requestGate.resolve()
    workerGate.resolve()
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

type SignalScenario = "resolve" | "reject" | "throw" | "hang"

async function runSignalChild(signal: NodeJS.Signals, scenario: SignalScenario, repeatSignal?: NodeJS.Signals) {
  const { spawn } = await import("node:child_process")
  const entry = new URL("../dist/main.js", import.meta.url).href
  const script = `
    import { installBffSignalHandlers } from ${JSON.stringify(entry)};
    const scenario = ${JSON.stringify(scenario)};
    let calls = 0;
    const keepalive = setInterval(() => {}, 1000);
    const server = { shutdown(ms) {
      clearInterval(keepalive);
      calls++;
      process.stdout.write(JSON.stringify({ event: "shutdown_started", calls, ms }) + "\\n");
      if (scenario === "throw") throw new Error("SENSITIVE_CHILD_SYNC_FAILURE");
      if (scenario === "reject") {
        return Promise.reject(new Error("SENSITIVE_CHILD_FAILURE"));
      }
      if (scenario === "hang") return new Promise(() => {});
      return new Promise((resolve) => setTimeout(() => {
        process.stdout.write(JSON.stringify({ event: "shutdown_settled", calls }) + "\\n");
        resolve();
      }, 80));
    }};
    installBffSignalHandlers(server, { hardDeadlineMs: 120 });
    process.stdout.write(JSON.stringify({ event: "ready" }) + "\\n");
  `
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], { stdio: ["ignore", "pipe", "pipe"] })
  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk) => {
    stdout += chunk
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })
  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("child did not reach a bounded terminal state")), 3000)
    child.once("exit", (code, exitSignal) => {
      clearTimeout(timer)
      resolve({ code, signal: exitSignal })
    })
    child.once("error", reject)
  })
  const waitFor = async (text: string): Promise<void> => {
    const deadline = Date.now() + 3000
    while (!stdout.includes(text)) {
      if (Date.now() >= deadline) throw new Error(`child did not emit ${text}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  try {
    await waitFor('"event":"ready"')
    child.kill(signal)
    await waitFor('"event":"shutdown_started"')
    if (repeatSignal !== undefined) child.kill(repeatSignal)
    const result = await exitPromise
    return { ...result, stdout, stderr }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL")
      await new Promise((resolve) => child.once("exit", resolve))
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`main ${signal} drains through the existing shutdown once and exits zero`, async () => {
    const child = await runSignalChild(signal, "resolve", signal === "SIGINT" ? "SIGTERM" : "SIGINT")
    assert.equal(child.code, 0)
    assert.equal(child.signal, null)
    assert.equal((child.stdout.match(/shutdown_started/gu) ?? []).length, 1)
    assert.match(child.stdout, /"ms":30000/u)
    assert.match(child.stdout, /shutdown_settled/u)
    assert.equal(child.stderr, "")
  })
}

test("main reports shutdown rejection safely and exits nonzero", async () => {
  const child = await runSignalChild("SIGTERM", "reject")
  assert.equal(child.code, 1)
  assert.equal(child.signal, null)
  assert.match(child.stderr, /^kokoro-bff shutdown failed\n$/u)
  assert.doesNotMatch(child.stderr, /SENSITIVE_CHILD_FAILURE/u)
})

test("main reports synchronous shutdown failure safely and exits nonzero", async () => {
  const child = await runSignalChild("SIGINT", "throw")
  assert.equal(child.code, 1)
  assert.equal(child.signal, null)
  assert.match(child.stderr, /^kokoro-bff shutdown failed\n$/u)
  assert.doesNotMatch(child.stderr, /SENSITIVE_CHILD_SYNC_FAILURE/u)
})

test("main reaches a bounded nonzero terminal state when shutdown never settles", async () => {
  const child = await runSignalChild("SIGTERM", "hang")
  assert.equal(child.code, 1)
  assert.equal(child.signal, null)
  assert.match(child.stderr, /^kokoro-bff shutdown deadline exceeded\n$/u)
  assert.equal((child.stdout.match(/shutdown_started/gu) ?? []).length, 1)
  assert.doesNotMatch(child.stdout, /shutdown_settled/u)
})
