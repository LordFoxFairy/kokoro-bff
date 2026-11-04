import "reflect-metadata"
import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { afterEach, test } from "node:test"
import { Test } from "@nestjs/testing"

import type { ChatConversationLookup } from "../dist/infrastructure/postgres/chat-conversation-lookup.js"
import type { AgUiRunControlReader } from "../dist/infrastructure/postgres/agui-run-state-read.js"
import type { IdempotencyRepository } from "../dist/application/ports/idempotency-repository.js"
import {
  AGENT_CANCELLATION_DISPATCHER,
  AGENT_CONTROL_IDEMPOTENCY,
  AGENT_DISPATCH_DISPATCHER,
  AGUI_PROJECTOR,
  AGUI_RUN_CONTROL_READER,
  BFF_CONFIG,
  BFF_DATABASE,
  CHAT_CONVERSATION_LOOKUP,
  PROJECT_SERVICE,
  PROJECT_SKILL_SELECTION_PROVIDER,
  SESSION_ADMISSION,
} from "../dist/common/tokens.js"
import { BFF_NEST_APPLICATION_OPTIONS } from "../dist/main.js"
import { AgentRunsModule } from "../dist/modules/agent-runs/agent-runs.module.js"
import { DEFAULT_AGUI_CONFIG, type BffConfig } from "../dist/config/runtime.js"
import { parseAgentControlReceipt } from "../dist/infrastructure/clients/agent/control-receipt.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const servers: Server[] = []
const closeApps: (() => Promise<void>)[] = []
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
    iamWebOrigin: "https://web.example.test",
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
    cookie: "kokoro-issuer.session_token=control-session",
    origin: "https://web.example.test",
  }
}

type ControlReaders = { findConversation?: ChatConversationLookup; readControl?: AgUiRunControlReader }

async function startAgentControlApp(
  configValue: BffConfig,
  authorized = true,
  readers: ControlReaders = {},
  receipts: IdempotencyRepository | null = null,
): Promise<string> {
  const admission = new SessionAdmissionDouble({ "control-session": { namespace: "tenant_control", userId: "user_control" } })
  const findConversation: ChatConversationLookup =
    readers.findConversation ?? (async (tenantId, subjectId, sessionId) => {
      if (!authorized || tenantId !== "tenant_control" || subjectId !== "user_control") return null
      return {
        conversationId: sessionId,
        tenantId,
        title: "Agent control",
        ownerId: subjectId,
        projectRef: null,
        status: "active",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        deletedAt: null,
      }
    })
  const builder = Test.createTestingModule({ imports: [AgentRunsModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(configValue)
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: Object.freeze({}), redis: Object.freeze({}) })
    .overrideProvider(SESSION_ADMISSION)
    .useValue(admission)
    .overrideProvider(CHAT_CONVERSATION_LOOKUP)
    .useValue(findConversation)
    .overrideProvider(AGUI_RUN_CONTROL_READER)
    .useValue(readers.readControl ?? (() => assert.fail("The control route must not read the execution head in this fixture")))
    .overrideProvider(PROJECT_SERVICE)
    .useValue({ find: async () => null })
    .overrideProvider(PROJECT_SKILL_SELECTION_PROVIDER)
    .useValue(null)
    .overrideProvider(AGENT_CONTROL_IDEMPOTENCY)
    .useValue(receipts)
  for (const token of [AGENT_DISPATCH_DISPATCHER, AGENT_CANCELLATION_DISPATCHER, AGUI_PROJECTOR]) {
    builder.overrideProvider(token).useValue(null)
  }
  const module = await builder.compile()
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, logger: false })
  closeApps.push(() => app.close())
  await app.listen(0, "127.0.0.1")
  return app.getUrl()
}

test("routes Agent control through the AgentRunsModule owner", async () => {
  const observed: string[] = []
  const agent = createServer((request, response) => {
    observed.push(request.url ?? "")
    response.writeHead(202, { "content-type": "application/json" })
    response.end(
      JSON.stringify({
        data: {
          command_id: "command_raw",
          request_digest: canonicalDigest,
          status: "pending",
          replayed: false,
        },
        meta: { request_id: "agent_request" },
      }),
    )
  })
  const agentBase = await listen(agent)
  const receipts = new Map<string, { fingerprint: string; status: number; body: unknown }>()
  const controlReceipts = {
    async claimReceipt(scope: string, fingerprint: string) {
      const prior = receipts.get(scope)
      if (prior !== undefined) return { claimed: false, receipt: prior }
      const pending = { fingerprint, status: 102, body: {} }
      receipts.set(scope, pending)
      return { claimed: true, receipt: null }
    },
    async getReceipt(scope: string) {
      return receipts.get(scope) ?? null
    },
    async putReceipt(scope: string, receipt: { fingerprint: string; status: number; body: unknown }) {
      receipts.set(scope, receipt)
    },
    async compareAndSetReceipt() {
      return { updated: false, receipt: null }
    },
    async releaseReceipt(scope: string) {
      receipts.delete(scope)
    },
  }
  const readers: ControlReaders = {
    async findConversation() {
      return {
        conversationId: "session_control",
        tenantId: "tenant_control",
        title: "Raw",
        ownerId: "user_control",
        projectRef: null,
        status: "active",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        deletedAt: null,
      }
    },
  }
  const base = await startAgentControlApp(config(agentBase), true, readers, controlReceipts)
  const response = await fetch(`${base}/v1/sessions/session_control/runs/run_control/control`, {
    method: "POST",
    headers: authHeaders("command_raw"),
    body: JSON.stringify({ kind: "run.cancel" }),
  })
  assert.equal(response.status, 202)
  assert.deepEqual((await response.json()).data, {
    run_id: "run_control",
    command_id: "command_raw",
    request_digest: canonicalDigest,
    status: "pending",
    replayed: false,
  })
  assert.deepEqual(observed, ["/v1/runs/run_control/control"])
})

afterEach(async () => {
  try {
    await Promise.all(closeApps.splice(0).map((close) => close()))
  } finally {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  }
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
      response.end(
        JSON.stringify({
          data: {
            command_id: "command_control",
            request_digest: canonicalDigest,
            status: "pending",
            replayed: false,
          },
          meta: { request_id: "agent_request" },
        }),
      )
    })
  })
  const agentBase = await listen(agent)
  const base = await startAgentControlApp(config(agentBase))

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
  assert.equal(
    parseAgentControlReceipt({
      command_id: "command_control",
      request_digest: canonicalDigest,
      status: "pending",
      replayed: false,
      run_id: "untrusted",
    }),
    null,
  )

  const agent = createServer((_request, response) => {
    response.writeHead(202, { "content-type": "application/json" })
    response.end(
      JSON.stringify({
        data: {
          command_id: "command_drift",
          request_digest: "sha256:wrong",
          status: "pending",
          replayed: false,
        },
        meta: { request_id: "agent_request" },
      }),
    )
  })
  const agentBase = await listen(agent)
  const base = await startAgentControlApp(config(agentBase))

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
  const base = await startAgentControlApp(config(agentBase), false)

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

test("immediate stop reaches the real Agent cancel path after its exact durable queued Run becomes visible", async () => {
  const { agentControlRequestDigest } = await import("../dist/infrastructure/clients/agent/control-receipt.js")
  const observed: { body: unknown; key: string | undefined }[] = []
  let cancelled = false,
    modelDispatches = 0
  const agent = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString())
      observed.push({ body, key: request.headers["idempotency-key"] as string | undefined })
      if (observed.length === 1) {
        response.writeHead(404, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: { code: "run_not_found", message: "Run was not found" } }))
      } else {
        cancelled = true
        response.writeHead(202, { "content-type": "application/json" })
        response.end(
          JSON.stringify({
            data: { command_id: "startup-stop", request_digest: agentControlRequestDigest("run_startup", body), status: "pending", replayed: false },
          }),
        )
      }
    })
  })
  const base = await listen(agent)
  let reads = 0
  const readers: ControlReaders = {
    readControl: async (tenant: string, subject: string, session: string) => {
      assert.equal(tenant, "tenant_control")
      assert.equal(subject, "user_control")
      assert.equal(session, "session_1")
      reads++
      return { executionHead: { runId: "run_startup", state: reads === 1 ? "queued" : "active", pendingPauses: [] } }
    },
  }
  const bff = await startAgentControlApp(config(base), true, readers)
  const response = await fetch(`${bff}/v1/sessions/session_1/runs/run_startup/control`, {
    method: "POST",
    headers: authHeaders("startup-stop"),
    body: JSON.stringify({ kind: "run.cancel" }),
  })
  assert.equal(response.status, 202)
  const result = (await response.json()) as { data: { run_id: string; status: string } }
  assert.equal(result.data.run_id, "run_startup")
  assert.equal(result.data.status, "pending", "actual Agent receipt is not a cancelled terminal")
  if (!cancelled) modelDispatches++
  assert.equal(cancelled, true, "controlled Agent applies the actual cancel command")
  assert.equal(modelDispatches, 0, "cancelled controlled Run never enters its model branch")
  assert.ok(reads >= 1)
  assert.equal(observed.length, 2)
  assert.deepEqual(observed[0], observed[1], "same key and body, not a new control intent")
})

for (const [name, firstHead, nextHead, ownerCode] of [
  ["missing head", undefined, undefined, "run_not_found"],
  ["different Run", { runId: "other", state: "queued", pendingPauses: [] }, undefined, "run_not_found"],
  ["already active first observation", { runId: "run_startup", state: "active", pendingPauses: [] }, undefined, "run_not_found"],
  [
    "head retires while waiting",
    { runId: "run_startup", state: "queued", pendingPauses: [] },
    { runId: "other", state: "queued", pendingPauses: [] },
    "run_not_found",
  ],
  ["owner becomes unreadable", { runId: "run_startup", state: "queued", pendingPauses: [] }, "unreadable", "run_not_found"],
  ["terminal while waiting", { runId: "run_startup", state: "queued", pendingPauses: [] }, undefined, "run_not_found"],
  ["different owner 404", { runId: "run_startup", state: "queued", pendingPauses: [] }, undefined, "session_not_found"],
] as const)
  test(`startup cancel preserves original one-call rejection for ${name}`, async () => {
    let calls = 0,
      reads = 0
    const agent = createServer((_request, response) => {
      calls++
      response.writeHead(404, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: { code: ownerCode, message: "Not found" } }))
    })
    const base = await listen(agent)
    const readers: ControlReaders = {
      readControl: async () => {
        const head = reads++ === 0 ? firstHead : nextHead
        return head === "unreadable" ? null : { executionHead: head && { ...head, pendingPauses: [] } }
      },
    }
    const bff = await startAgentControlApp(config(base), true, readers)
    const response = await fetch(`${bff}/v1/sessions/session_1/runs/run_startup/control`, {
      method: "POST",
      headers: authHeaders(`reject-${name}`),
      body: JSON.stringify({ kind: "run.cancel" }),
    })
    assert.equal(response.status, 404)
    await response.arrayBuffer()
    assert.equal(calls, 1)
  })

test("startup cancel stops waiting on caller abort without delivering a second control", async () => {
  let calls = 0
  const controller = new AbortController()
  const agent = createServer((_request, response) => {
    calls++
    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: { code: "run_not_found", message: "Run was not found" } }))
  })
  const base = await listen(agent)
  const readers: ControlReaders = {
    readControl: async () => {
      setTimeout(() => controller.abort(), 5)
      return { executionHead: { runId: "run_startup", state: "queued", pendingPauses: [] } }
    },
  }
  const bff = await startAgentControlApp(config(base), true, readers)
  await assert.rejects(
    fetch(`${bff}/v1/sessions/session_1/runs/run_startup/control`, {
      method: "POST",
      headers: authHeaders("abort-startup"),
      body: JSON.stringify({ kind: "run.cancel" }),
      signal: controller.signal,
    }),
  )
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(calls, 1)
})

test("startup cancel never renews its absolute request budget or invents a receipt", async () => {
  let calls = 0
  const agent = createServer((_request, response) => {
    calls++
    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: { code: "run_not_found", message: "Run was not found" } }))
  })
  const base = await listen(agent)
  const readers: ControlReaders = { readControl: async () => ({ executionHead: { runId: "run_startup", state: "queued", pendingPauses: [] } }) }
  const bff = await startAgentControlApp({ ...config(base), upstreamTimeoutMs: 25 }, true, readers)
  const response = await fetch(`${bff}/v1/sessions/session_1/runs/run_startup/control`, {
    method: "POST",
    headers: authHeaders("deadline-startup"),
    body: JSON.stringify({ kind: "run.cancel" }),
  })
  assert.ok([404, 502].includes(response.status), "budget expiry never fabricates an accepted command")
  await response.arrayBuffer()
  assert.ok(calls >= 1 && calls <= 2, "the absolute budget is not renewed for each owner delivery")
})
