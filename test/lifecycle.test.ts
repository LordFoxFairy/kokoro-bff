import assert from "node:assert/strict"
import { test } from "node:test"

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

type SignalScenario = "normal" | "worker_throw" | "worker_hang" | "pool_hang" | "redis_hang" | "init_throw" | "listen_busy" | "init_pending"

type ChildResult = { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; elapsedMs: number }
const FIXTURE_EVENT_PREFIX = "[kokoro-t17-fixture-event] "
type FixtureEvent = {
  event: string
  name?: string
  health?: number
  ready?: number
  listener_listening?: boolean
  settled_workers?: number
  control_channel_open?: boolean
  worker_stops?: number
  pool_closes?: number
  redis_closes?: number
}

function fixtureEvents(stdout: string): FixtureEvent[] {
  return stdout
    .split("\n")
    .slice(0, -1)
    .filter((line) => line.startsWith(FIXTURE_EVENT_PREFIX))
    .map((line) => JSON.parse(line.slice(FIXTURE_EVENT_PREFIX.length)))
}

/** The child runs the production graph and process owner; only managed I/O and worker boundaries are replaced. */
async function runSignalChild(signal: NodeJS.Signals | null, scenario: SignalScenario, repeatSignal?: NodeJS.Signals): Promise<ChildResult> {
  const { spawn } = await import("node:child_process")
  const dist = new URL("../dist/", import.meta.url)
  const moduleUrl = (file: string) => JSON.stringify(new URL(file, dist).href)
  const script = `
    import "reflect-metadata";
    import { Test } from "@nestjs/testing";
    import { createServer } from "node:http";
    import { AppModule } from ${moduleUrl("app.module.js")};
    import * as main from ${moduleUrl("main.js")};
    import { loadConfig } from ${moduleUrl("config/runtime.js")};
    import { PostgresBffDatabase } from ${moduleUrl("infrastructure/postgres/client.js")};
    import * as tokens from ${moduleUrl("common/tokens.js")};
    const emit = (event, fields = {}) => process.stdout.write(${JSON.stringify(FIXTURE_EVENT_PREFIX)} + JSON.stringify({ event, ...fields }) + "\\n");
    if (typeof main.startBffApplication !== "function") {
      emit("interface_missing", { name: "startBffApplication" });
      process.exit(78);
    }
    const scenario = ${JSON.stringify(scenario)};
    const config = { ...loadConfig({
      KOKORO_BFF_SHARED_SECRET: "nest-process-test-only",
      KOKORO_BFF_POSTGRES_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture?schema=kokoro_bff",
      KOKORO_BFF_REDIS_URL: "redis://127.0.0.1:1/8",
      KOKORO_IAM_BASE_URL: "http://127.0.0.1:1",
      KOKORO_AGENT_ENABLED: "false",
    }), port: 0 };
    let server;
    let workerStopCalls = 0;
    let poolCloseCalls = 0;
    let redisCloseCalls = 0;
    const settledWorkers = new Set();
    const observation = () => ({ listener_listening: server.listening, settled_workers: settledWorkers.size, control_channel_open: process.connected === true });
    const database = new PostgresBffDatabase(config.postgresUrl, config.redisUrl);
    const unexpectedIo = () => { throw new Error("SENSITIVE_UNEXPECTED_MANAGED_IO"); };
    database.pool.connect = unexpectedIo;
    database.redis.connect = unexpectedIo;
    database.redis.destroy = unexpectedIo;
    database.pool.query = async () => ({ rows: [{ schema: "kokoro_bff", installed: true }] });
    database.redis.ping = async () => "PONG";
    let redisOpen = true;
    Object.defineProperty(database.redis, "isReady", { configurable: true, get: () => redisOpen });
    Object.defineProperty(database.redis, "isOpen", { configurable: true, get: () => redisOpen });
    database.pool.end = async () => {
      poolCloseCalls += 1;
      emit("pool_close_started", observation());
      if (scenario === "pool_hang") await new Promise(() => {});
      emit("pool_closed");
    };
    database.redis.close = async () => {
      redisCloseCalls += 1;
      emit("redis_close_started", observation());
      if (scenario === "redis_hang") await new Promise(() => {});
      redisOpen = false;
      emit("redis_closed");
    };
    let releaseStop;
    let releaseInit;
    let onStartupSignal;
    const stopGate = scenario === "normal" ? new Promise((resolve) => { releaseStop = resolve; }) : null;
    const initGate = scenario === "init_pending" ? new Promise((resolve) => { releaseInit = resolve; }) : null;
    if (scenario === "normal" || scenario === "init_pending") {
      const onControl = (message) => {
        if (message !== (scenario === "init_pending" ? "release_init" : "release_stop")) return;
        process.off("message", onControl);
        if (onStartupSignal) process.off("SIGTERM", onStartupSignal);
        process.disconnect();
        setImmediate(scenario === "init_pending" ? releaseInit : releaseStop);
      };
      process.on("message", onControl);
      // Only the pending-init case needs this channel to hold its startup gate before any listener exists.
      if (scenario === "normal") process.channel.unref();
    }
    const workerNames = [
      "AGENT_DISPATCH_DISPATCHER", "AGENT_CANCELLATION_DISPATCHER", "AGUI_PROJECTOR",
      "PROJECT_SCOPE_RELEASE_DISPATCHER", "SCHEDULED_AGENT_DISPATCHER",
      "SCHEDULED_TASK_DISPATCHER",
    ];
    const workers = workerNames.map((name) => ({ name, token: tokens[name],
      start() {
        emit("worker_started", { name });
        if (scenario === "init_throw" && name === "AGENT_DISPATCH_DISPATCHER") throw new Error("SENSITIVE_INIT_START_FAILURE");
      },
      stop() {
        workerStopCalls += 1;
        emit("worker_stop_started", { name });
        const selected = name === "AGENT_CANCELLATION_DISPATCHER";
        if (selected && scenario === "worker_throw") throw new Error("SENSITIVE_WORKER_SYNC_FAILURE");
        return (async () => {
          if (selected && scenario === "worker_hang") await new Promise(() => {});
          if (selected && scenario === "normal") await stopGate;
          settledWorkers.add(name);
          emit("worker_stopped", { name });
        })();
      },
    }));
    if (scenario === "init_pending") {
      workers.find((worker) => worker.name === "AGENT_CANCELLATION_DISPATCHER").onModuleInit = async () => {
        emit("init_pending");
        await initGate;
        emit("init_settled");
      };
    }
    const builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(tokens.BFF_CONFIG).useValue(config)
      .overrideProvider(tokens.BFF_DATABASE).useValue(database);
    for (const worker of workers) builder.overrideProvider(worker.token).useValue(worker);
    const module = await builder.compile();
    const app = module.createNestApplication({ ...main.BFF_NEST_APPLICATION_OPTIONS, logger: false });
    app.useLogger({ log() {}, warn() {}, debug() {}, verbose() {},
      error(message) { process.stderr.write((message instanceof Error ? message.message : String(message)) + "\\n"); },
    });
    server = app.getHttpServer();
    server.once("close", () => emit("listener_closed"));
    server.once("listening", () => emit("listener_listening"));
    if (scenario === "init_pending") {
      onStartupSignal = () => setImmediate(() => emit("startup_checkpoint", {
        worker_stops: workerStopCalls, pool_closes: poolCloseCalls, redis_closes: redisCloseCalls, listener_listening: server.listening,
      }));
      process.on("SIGTERM", onStartupSignal);
    }
    let busy;
    if (scenario === "listen_busy") {
      busy = createServer();
      await new Promise((resolve, reject) => { busy.once("error", reject); busy.listen(0, "127.0.0.1", resolve); });
      config.port = busy.address().port;
    }
    try {
      await main.startBffApplication(app, config, { gracePeriodMs: 50, hardDeadlineMs: 300 });
      if (scenario === "init_pending") emit("startup_finished");
      else {
        const base = await app.getUrl();
        const health = await fetch(base + "/healthz", { headers: { connection: "close" } });
        const ready = await fetch(base + "/readyz", { headers: { connection: "close" } });
        await health.arrayBuffer();
        await ready.arrayBuffer();
        emit("ready", { health: health.status, ready: ready.status });
      }
    } catch {
      // Observe the owner's completed cleanup without replacing it or manufacturing its exit status.
      emit("startup_rejected");
      if (busy) await new Promise((resolve) => busy.close(resolve));
    }
  `
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
    stdio: scenario === "normal" || scenario === "init_pending" ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  let changed = deferred()
  const notify = (): void => {
    const previous = changed
    changed = deferred()
    previous.resolve()
  }
  child.stdout!.setEncoding("utf8")
  child.stderr!.setEncoding("utf8")
  child.stdout!.on("data", (chunk: string) => {
    stdout += chunk
    notify()
  })
  child.stderr!.on("data", (chunk: string) => {
    stderr += chunk
    notify()
  })
  let terminal = false
  let signalledAt = performance.now()
  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the real Nest child did not reach a bounded terminal state")), 3000)
    child.once("exit", () => {
      terminal = true
      notify()
    })
    child.once("close", (code, exitSignal) => {
      clearTimeout(timer)
      resolve({ code, signal: exitSignal })
      notify()
    })
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
      notify()
    })
  })
  const waitFor = async (event: string): Promise<boolean> => {
    while (!fixtureEvents(stdout).some((value) => value.event === event)) {
      if (terminal) return false
      await Promise.race([changed.promise, exitPromise])
    }
    return true
  }
  try {
    if (signal !== null && (await waitFor(scenario === "init_pending" ? "init_pending" : "ready"))) {
      signalledAt = performance.now()
      assert.equal(child.kill(signal), true)
      if (scenario === "normal" && (await waitFor("worker_stop_started"))) {
        if (repeatSignal !== undefined) child.kill(repeatSignal)
        if (child.connected) child.send("release_stop", () => undefined)
      } else if (scenario === "init_pending") {
        assert.equal(await waitFor("startup_checkpoint"), true, "the signal observer must reach a checkpoint while actual Nest init remains held")
        assert.deepEqual(
          fixtureEvents(stdout).find((event) => event.event === "startup_checkpoint"),
          {
            event: "startup_checkpoint",
            worker_stops: 0,
            pool_closes: 0,
            redis_closes: 0,
            listener_listening: false,
          },
        )
        if (child.connected) child.send("release_init", () => undefined)
      }
    }
    const result = await exitPromise
    assert.equal(
      fixtureEvents(stdout).some((event) => event.event === "interface_missing"),
      false,
      "startBffApplication is a planned production API not implemented yet; this is not semantic RED",
    )
    return { ...result, stdout, stderr, elapsedMs: performance.now() - signalledAt }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL")
      await new Promise((resolve) => child.once("close", resolve))
    }
  }
}

function childEvents(child: ChildResult, event: string): FixtureEvent[] {
  return fixtureEvents(child.stdout).filter((value) => value.event === event)
}

function assertIndependentCleanup(child: ChildResult): void {
  const stops = childEvents(child, "worker_stop_started")
  assert.equal(stops.length, 6, "one real application close must invoke each of the six current worker boundaries once")
  assert.equal(new Set(stops.map((event) => event.name)).size, 6)
  for (const event of ["pool_close_started", "pool_closed", "redis_close_started", "redis_closed"]) assert.equal(childEvents(child, event).length, 1)
  assert.doesNotMatch(child.stderr, /SENSITIVE_|postgresql:\/\//u)
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`main ${signal} closes the real Nest listener and resources once and exits zero despite a repeated signal`, async () => {
    const child = await runSignalChild(signal, "normal", signal === "SIGINT" ? "SIGTERM" : "SIGTERM")
    assert.equal(child.code, 0)
    assert.equal(child.signal, null)
    assert.deepEqual(childEvents(child, "ready"), [{ event: "ready", health: 200, ready: 200 }])
    assert.equal(childEvents(child, "listener_closed").length, 1)
    assert.equal(childEvents(child, "worker_stopped").length, 6)
    assertIndependentCleanup(child)
    assert.equal(child.stderr, "")
  })
}

test("main preserves a nonzero shutdown outcome after a real Nest worker throw and attempts independent cleanup", async () => {
  const child = await runSignalChild("SIGTERM", "worker_throw")
  assert.equal(child.code, 1)
  assert.equal(child.signal, null)
  assertIndependentCleanup(child)
  assert.equal(childEvents(child, "worker_stopped").length, 5)
  assert.match(child.stderr, /bff_agent_dispatch_shutdown_failed/u)
  assert.doesNotMatch(child.stderr, /shutdown deadline exceeded/u)
})

test("main waits for physical Nest initialization after termination and never begins listening", async () => {
  const child = await runSignalChild("SIGTERM", "init_pending")
  assert.equal(child.code, 0)
  assert.equal(child.signal, null)
  assert.equal(childEvents(child, "init_settled").length, 1)
  assert.equal(childEvents(child, "listener_listening").length, 0)
  assert.equal(childEvents(child, "ready").length, 0)
  assert.equal(childEvents(child, "listener_closed").length, 1)
  assert.equal(childEvents(child, "startup_finished").length, 1)
  assertIndependentCleanup(child)
  const events = fixtureEvents(child.stdout)
  assert.ok(events.findIndex((event) => event.event === "init_settled") < events.findIndex((event) => event.event === "worker_stop_started"))
  assert.equal(child.stderr, "")
})

for (const scenario of ["worker_hang", "pool_hang", "redis_hang"] as const) {
  test(`main reaches its referenced hard deadline when real Nest ${scenario} never settles`, async () => {
    const child = await runSignalChild("SIGTERM", scenario)
    assert.equal(child.code, 1)
    assert.equal(child.signal, null)
    assert.match(child.stderr, /^kokoro-bff shutdown deadline exceeded\n$/u)
    assert.ok(child.elapsedMs >= 250, "the configured 300ms hard deadline must not be replaced by an immediate exit")
    if (scenario === "worker_hang") {
      assert.equal(childEvents(child, "pool_close_started").length, 0)
      assert.equal(childEvents(child, "redis_close_started").length, 0)
    } else if (scenario === "pool_hang") {
      assert.deepEqual(childEvents(child, "pool_close_started"), [
        { event: "pool_close_started", listener_listening: false, settled_workers: 6, control_channel_open: false },
      ])
      assert.equal(childEvents(child, "pool_closed").length, 0)
      assert.equal(childEvents(child, "redis_close_started").length, 0)
    } else {
      assert.equal(childEvents(child, "pool_closed").length, 1)
      assert.deepEqual(childEvents(child, "redis_close_started"), [
        { event: "redis_close_started", listener_listening: false, settled_workers: 6, control_channel_open: false },
      ])
      assert.equal(childEvents(child, "redis_closed").length, 0)
    }
    assert.doesNotMatch(child.stderr, /SENSITIVE_/u)
  })
}

for (const scenario of ["init_throw", "listen_busy"] as const) {
  test(`main cleans partially initialized resources after real Nest ${scenario} startup failure`, async () => {
    const child = await runSignalChild(null, scenario)
    assert.equal(child.code, 1)
    assert.equal(child.signal, null)
    assert.equal(childEvents(child, "ready").length, 0)
    assert.equal(childEvents(child, "startup_rejected").length, 1)
    assertIndependentCleanup(child)
    const events = fixtureEvents(child.stdout)
    assert.ok(
      events.findIndex((event) => event.event === "redis_closed") < events.findIndex((event) => event.event === "startup_rejected"),
      "startup rejection waits for actual cleanup",
    )
    assert.doesNotMatch(child.stderr, /shutdown deadline exceeded/u)
  })
}
