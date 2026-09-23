import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { afterEach, test } from "node:test"

import { AgUiSessionRuntime } from "../dist/application/agui/session-runtime.js"
import { DEFAULT_AGUI_CONFIG, type BffConfig } from "../dist/config/runtime.js"
import { parseAgentControlReceipt } from "../dist/infrastructure/clients/agent/control-receipt.js"
import { liveAgentSession } from "../dist/http/routes/agent.js"
import { createLiveTestBffServer } from "./doubles/server.ts"

const servers: Server[] = []
const canonicalDigest = "sha256:25f421bfa958a4ed2ee20e9f23f67881d6ebd0be17df1581c729b2527c50409c"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function listen(server: Server): Promise<string> {
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("server did not bind")
  return `http://127.0.0.1:${address.port}`
}

function config(agentBase: string): BffConfig {
  return {
    host: "127.0.0.1",
    port: 4300,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant_control",
    iamBaseUrl: null,
    sharedSecret: "web-secret",
    upstreamSecret: "bff-secret",
    upstreamTimeoutMs: 5000,
    upstreamMaxResponseBytes: 1024 * 1024,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: true,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: {
      system: null,
      model: null,
      capability: null,
      storage: null,
      scheduler: null,
      agents: agentBase,
      billing: null,
      music: null,
    },
  }
}

function authHeaders(commandId: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "idempotency-key": commandId,
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "web-secret",
    authorization: "Bearer control-session",
  }
}

function bffServer(configValue: BffConfig, authorized = true): Server {
  const runtime = new AgUiSessionRuntime({
    connections: {
      global: configValue.agUi.maxConnectionsGlobal,
      perTenant: configValue.agUi.maxConnectionsPerTenant,
      perSession: configValue.agUi.maxConnectionsPerSession,
    },
    ledgerWait: {
      baseDelayMs: configValue.agUi.ledgerPollBaseDelayMs,
      maxDelayMs: configValue.agUi.ledgerPollMaxDelayMs,
      jitterRatio: configValue.agUi.ledgerPollJitterPercent / 100,
    },
    replayCacheTtlMs: configValue.agUi.replayCacheTtlMs,
  })
  return createLiveTestBffServer(configValue, {
    routeHandler: ({ request, response, businessPath, context, json, mutation, idempotency }) => liveAgentSession(
      request,
      response,
      configValue,
      context,
      businessPath,
      json,
      mutation,
      idempotency,
      null,
      runtime,
      false,
      authorized ? { ok: true } : null,
    ),
  })
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

test("projects the canonical Agent receipt without trusting an upstream run_id", async () => {
  const observed: Array<{ url: string; body: unknown; headers: Record<string, string | string[] | undefined> }> = []
  const agent = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      observed.push({
        url: request.url ?? "",
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        headers: request.headers,
      })
      response.writeHead(202, { "content-type": "application/json" })
      response.end(JSON.stringify({
        data: {
          command_id: "command_control",
          request_digest: canonicalDigest,
          status: "pending",
          replayed: false,
        },
        meta: { request_id: "agent_request" },
      }))
    })
  })
  const agentBase = await listen(agent)
  const base = await listen(bffServer(config(agentBase)))

  const response = await fetch(`${base}/v1/sessions/session_control/runs/run_control/control`, {
    method: "POST",
    headers: authHeaders("command_control"),
    body: JSON.stringify({ kind: "run.cancel" }),
  })

  assert.equal(response.status, 202)
  const responseBody: unknown = await response.json()
  assert.ok(isRecord(responseBody) && isRecord(responseBody.meta))
  assert.deepEqual(responseBody.data, {
    run_id: "run_control",
    command_id: "command_control",
    request_digest: canonicalDigest,
    status: "pending",
    replayed: false,
  })
  assert.equal(typeof responseBody.meta.request_id, "string")
  assert.deepEqual(responseBody, {
    data: {
      run_id: "run_control",
      command_id: "command_control",
      request_digest: canonicalDigest,
      status: "pending",
      replayed: false,
    },
    meta: { request_id: responseBody.meta.request_id },
  })
  assert.equal(observed.length, 1)
  assert.equal(observed[0]?.url, "/v1/runs/run_control/control")
  assert.deepEqual(observed[0]?.body, { kind: "run.cancel", session_id: "session_control" })
  assert.equal(observed[0]?.headers["idempotency-key"], "command_control")
  assert.equal(observed[0]?.headers["x-kokoro-tenant-ref"], "tenant_control")
  assert.equal(observed[0]?.headers["x-kokoro-subject-ref"], "user_control")
  assert.equal(observed[0]?.headers["x-kokoro-identity-assertion-ref"], "bff:session:tenant_control:session_control")
})

test("rejects receipt identity drift and extra owner fields", async () => {
  assert.equal(parseAgentControlReceipt({
    command_id: "command_control",
    request_digest: canonicalDigest,
    status: "pending",
    replayed: false,
    run_id: "untrusted",
  }), null)

  const agent = createServer((_request, response) => {
    response.writeHead(202, { "content-type": "application/json" })
    response.end(JSON.stringify({
      data: {
        command_id: "command_drift",
        request_digest: "sha256:wrong",
        status: "pending",
        replayed: false,
      },
      meta: { request_id: "agent_request" },
    }))
  })
  const agentBase = await listen(agent)
  const base = await listen(bffServer(config(agentBase)))

  const response = await fetch(`${base}/v1/sessions/session_control/runs/run_control/control`, {
    method: "POST",
    headers: authHeaders("command_drift"),
    body: JSON.stringify({ kind: "run.cancel" }),
  })

  assert.equal(response.status, 502)
  const body: unknown = await response.json()
  assert.ok(isRecord(body) && isRecord(body.error))
  assert.equal(body.error.code, "upstream_response_invalid")
})

test("does not call Agent control when private Chat authorization is absent", async () => {
  let calls = 0
  const agent = createServer((_request, response) => {
    calls += 1
    response.writeHead(500).end()
  })
  const agentBase = await listen(agent)
  const base = await listen(bffServer(config(agentBase), false))

  const response = await fetch(`${base}/v1/sessions/session_control/runs/run_control/control`, {
    method: "POST",
    headers: authHeaders("command_denied"),
    body: JSON.stringify({ kind: "run.cancel" }),
  })

  assert.equal(response.status, 404)
  const body: unknown = await response.json()
  assert.ok(isRecord(body) && isRecord(body.error))
  assert.equal(body.error.code, "session_not_found")
  assert.equal(calls, 0)
})
