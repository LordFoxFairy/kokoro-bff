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


// R57: published Agent e977923 HTTP4; append-only behavior RED, no production substitutes.

function r57Waiting() {
  return {
    interaction_revision: 7,
    pause_revision: 7,
    pause_ref: "pause:run_hitl_1:7",
    phase: "waiting",
    groups: [
      {
        group_id: "group_tools",
        items: [
          {
            item_id: "item_approve",
            request_id: "request_tool_1",
            kind: "tool_approval",
            allowed_decisions: ["approve", "edit", "reject"],
            display: {
              name: "search",
              description: "Search approved index",
              editable: true,
              input_schema: { type: "object", properties: { query: { type: "string" } } },
              result_preview: null,
              truncated: null,
              source: null,
            },
          },
          {
            item_id: "item_edit",
            request_id: "request_tool_2",
            kind: "tool_approval",
            allowed_decisions: ["edit", "reject"],
            display: { name: "edit", description: "Edit parameters", editable: true, input_schema: { type: "object" } },
          },
          {
            item_id: "item_reject",
            request_id: "request_review_1",
            kind: "result_review",
            allowed_decisions: ["approve", "reject"],
            display: {
              name: "review",
              description: "Review result",
              editable: false,
              input_schema: { type: "object" },
              result_preview: "bounded result",
              truncated: false,
              source: "tool",
            },
          },
        ],
      },
      {
        group_id: "group_inputs",
        items: [
          {
            item_id: "item_respond",
            request_id: "request_question_1",
            kind: "ask_user_question",
            allowed_decisions: ["respond", "reject"],
            display: { name: "question", description: "Choose a region", editable: false, input_schema: { type: "object" } },
            validation: { code: "json_schema_invalid", instance_path: ["region", 0] },
          },
          {
            item_id: "item_submit",
            request_id: "request_input_1",
            kind: "input",
            allowed_decisions: ["submit"],
            display: { name: "form", description: "Confirm values", editable: true, input_schema: { type: "object" } },
          },
        ],
      },
    ],
    action_result: null,
  }
}
function r57Control() {
  return {
    kind: "run.resume",
    expected_pause_revision: 7,
    pause_ref: "pause:run_hitl_1:7",
    decisions: [
      { type: "approve", item_id: "item_approve" },
      { type: "edit", item_id: "item_edit", args: { count: 2, note: null } },
      { type: "reject", item_id: "item_reject" },
      { type: "respond", item_id: "item_respond", response: "continue" },
      { type: "submit", item_id: "item_submit", value: { confirmed: true, comment: null } },
    ],
  }
}

test("R57 resume requires the published pause locator and forwards all five closed decision shapes", async () => {
  const { buildAgentControl } = await import("../dist/infrastructure/clients/agent/control.js")
  const body = r57Control()
  assert.deepEqual(buildAgentControl("session_1", body), { ...body, session_id: "session_1" })
})
for (const [name, locator] of [
  ["both omitted", {}],
  ["revision omitted", { pause_ref: "pause:run_hitl_1:7" }],
  ["ref omitted", { expected_pause_revision: 7 }],
  ["zero revision", { expected_pause_revision: 0, pause_ref: "pause:run_hitl_1:7" }],
  ["unsafe revision", { expected_pause_revision: Number.MAX_SAFE_INTEGER + 1, pause_ref: "pause:run_hitl_1:7" }],
  ["fractional revision", { expected_pause_revision: 1.5, pause_ref: "pause:run_hitl_1:7" }],
  ["blank ref", { expected_pause_revision: 7, pause_ref: " " }],
] as const) {
  test(`R57 resume rejects ${name} without inventing defaults`, async () => {
    const { buildAgentControl } = await import("../dist/infrastructure/clients/agent/control.js")
    assert.equal(buildAgentControl("session_1", { kind: "run.resume", decisions: r57Control().decisions, ...locator }), null)
  })
}
for (const [name, decisions] of [
  ["unknown discriminator", [{ type: "decide", item_id: "item_approve" }]],
  ["tool_id alias", [{ type: "approve", tool_id: "item_approve" }]],
  ["approve extra key", [{ type: "approve", item_id: "item_approve", response: "private" }]],
  ["edit missing args", [{ type: "edit", item_id: "item_edit" }]],
  ["edit null args", [{ type: "edit", item_id: "item_edit", args: null }]],
  ["reject nonstring reason", [{ type: "reject", item_id: "item_reject", reason: 3 }]],
  ["respond empty response", [{ type: "respond", item_id: "item_respond", response: "" }]],
  ["submit array value", [{ type: "submit", item_id: "item_submit", value: [] }]],
  [
    "duplicate item",
    [
      { type: "approve", item_id: "item_approve" },
      { type: "reject", item_id: "item_approve" },
    ],
  ],
] as const) {
  test(`R57 strict decision rejects ${name} after a valid control positive`, async () => {
    const { buildAgentControl } = await import("../dist/infrastructure/clients/agent/control.js")
    assert.ok(buildAgentControl("session_1", r57Control()), "valid HTTP4 control must first be supported")
    assert.equal(buildAgentControl("session_1", { ...r57Control(), decisions }), null)
  })
}
test("R57 owner-fixed typed control digest preserves business null and omits delivery identity", async () => {
  const { agentControlRequestDigest } = await import("../dist/infrastructure/clients/agent/control-receipt.js")
  const body = { ...r57Control(), session_id: "session_1" }
  const expected = "sha256:68e6ec9a211ba18dc32e94876db9ac8b793339157e613b4a966ca057c9b0f1d5"
  assert.equal(agentControlRequestDigest("run_hitl_1", body), expected)
  assert.equal(agentControlRequestDigest("run_hitl_1", { ...body, command_id: "delivery_1", request_digest: "delivery-only" }), expected)
})
test("R57 owner-fixed approve args and reject reason null equal omitted without erasing nested business null", async () => {
  const { agentControlRequestDigest } = await import("../dist/infrastructure/clients/agent/control-receipt.js")
  const body = { ...r57Control(), session_id: "session_1" }
  const nullable = {
    ...body,
    decisions: body.decisions.map((decision) =>
      decision.type === "approve" ? { ...decision, args: null } : decision.type === "reject" ? { ...decision, reason: null } : decision,
    ),
  }
  assert.equal(agentControlRequestDigest("run_hitl_1", nullable), "sha256:68e6ec9a211ba18dc32e94876db9ac8b793339157e613b4a966ca057c9b0f1d5")
})
test("R57 business dictionary nulls and decision order remain distinct owner digest material", async () => {
  const { agentControlRequestDigest } = await import("../dist/infrastructure/clients/agent/control-receipt.js")
  const body = { ...r57Control(), session_id: "session_1" }
  const withoutBusinessNull = {
    ...body,
    decisions: body.decisions.map((decision) =>
      decision.type === "edit" ? { ...decision, args: { count: 2 } } : decision.type === "submit" ? { ...decision, value: { confirmed: true } } : decision,
    ),
  }
  assert.equal(agentControlRequestDigest("run_hitl_1", withoutBusinessNull), "sha256:dd32fcc73d0ee1486f06124c573cb2f583e78a2e8be312add3e6cea21ee454d5")
  assert.notEqual(agentControlRequestDigest("run_hitl_1", body), agentControlRequestDigest("run_hitl_1", withoutBusinessNull))
  assert.notEqual(agentControlRequestDigest("run_hitl_1", body), agentControlRequestDigest("run_hitl_1", { ...body, decisions: [...body.decisions].reverse() }))
  const approveNull = { ...body, decisions: [{ type: "approve", item_id: "item_approve", args: { note: null } }] }
  const approveEmpty = { ...body, decisions: [{ type: "approve", item_id: "item_approve", args: {} }] }
  assert.notEqual(agentControlRequestDigest("run_hitl_1", approveNull), agentControlRequestDigest("run_hitl_1", approveEmpty))
})
