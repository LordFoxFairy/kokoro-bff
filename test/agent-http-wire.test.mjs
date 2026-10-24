import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { describe, it } from "node:test"
import { parseAgentErrorCode, parseAgentHttpJson, parseLaunchReceipt, parseReplayPage } from "../dist/infrastructure/clients/agent/http-wire.js"

import { mapAgentEvent } from "../dist/infrastructure/clients/agent/projection.js"

const receipt = { data: { run_id: "run_1", session_id: "session_1", replayed: false }, meta: { request_id: "request_1" } }
const event = {
  chat_event_id: "event_1",
  session_id: "session_1",
  run_id: "run_1",
  source_index: 0,
  event_type: "assistant.completed",
  payload_json: '{"content":""}',
  seq: 1,
  created_at: 0,
}
const page = { data: { events: [event], next_seq: 1, watermark: 1 }, meta: { request_id: "request_1" } }

describe("Agent event-protocol provenance", () => {
  it("repins HTTP failure ownership and published provenance without reading an unfixed vendor path", async () => {
    const manifest = JSON.parse(await readFile(new URL("../contract/dependencies/agent-http.json", import.meta.url), "utf8"))
    assert.deepEqual(
      {
        repository_commit: manifest.owner.repository_commit,
        contract_version: manifest.owner.contract_version,
        contract_path: manifest.owner.contract_path,
        contract_sha256: manifest.owner.contract_sha256,
        provenance_path: manifest.owner.provenance_path,
        provenance_sha256: manifest.owner.provenance_sha256,
      },
      {
        repository_commit: "8cc975e0850ebc990c436d3f2cff544c9424cbda",
        contract_version: "7.3.0",
        contract_path: "contract/openapi/v1/openapi.json",
        contract_sha256: "c096eab9f2aa392215351a106a670692d5f58f945980a5e028b3a83d17509731",
        provenance_path: "contract/provenance.json",
        provenance_sha256: "1fe83d4ef219306df91e0c84e6d753194443d8b33f6484202ff2fdf96c00a690",
      },
    )
    assert.deepEqual(
      manifest.generated.find(({ path }) => path === "failure-profile.gen.ts"),
      {
        path: "failure-profile.gen.ts",
        source_sha256: "c096eab9f2aa392215351a106a670692d5f58f945980a5e028b3a83d17509731",
        sha256: manifest.generated.find(({ path }) => path === "failure-profile.gen.ts")?.sha256,
      },
    )
    assert.match(manifest.generated.find(({ path }) => path === "failure-profile.gen.ts")?.sha256 ?? "", /^[0-9a-f]{64}$/u)
  })

  it("uses one HTTP7 publication for process, delivery and interaction with no split source pin", async () => {
    const manifest = JSON.parse(await readFile(new URL("../contract/dependencies/agent-http.json", import.meta.url), "utf8"))
    assert.equal(Object.hasOwn(manifest, "event_protocol"), false)
    assert.equal(manifest.owner.repository_commit, "8cc975e0850ebc990c436d3f2cff544c9424cbda")
    assert.equal(manifest.generated.length, 18)
    assert.equal(
      manifest.generated.find(({ path }) => path === "process-profile.gen.ts")?.source_sha256,
      "c096eab9f2aa392215351a106a670692d5f58f945980a5e028b3a83d17509731",
    )
  })

  it("verifies the published full-state graph and rejects weakened required, closed, enum and decision schemas", async () => {
    const { assertInteractionContractSchema } = await import("../scripts/generate-agent-http-client.mjs")
    const owner = JSON.parse(
      await readFile(new URL("../contract/vendor/kokoro-agent/8cc975e0850ebc990c436d3f2cff544c9424cbda/openapi.json", import.meta.url), "utf8"),
    )
    assert.doesNotThrow(() => assertInteractionContractSchema(owner))
    for (const change of [
      (s) => {
        delete s.ChatEvent["x-kokoro-decoded-payloads"].mapping["interaction.state"]
      },
      (s) => {
        delete s.ChatEvent["x-kokoro-decoded-payloads"].mapping.activity
      },
      (s) => {
        delete s.ChatEvent["x-kokoro-decoded-payloads"].mapping["todo.updated"]
      },
      (s) => {
        s.ChatEvent.properties.event_type.enum.push("interaction")
      },
      (s) => {
        s.ChatInteractionState.required.pop()
      },
      (s) => {
        s.InteractionDisplay.additionalProperties = true
      },
      (s) => {
        s.InteractionItem.properties.allowed_decisions.uniqueItems = false
      },
      (s) => {
        s.ResumeControl.properties.expected_pause_revision.minimum = 0
      },
      (s) => {
        s.ResumeDecision.oneOf[0].additionalProperties = true
      },
      (s) => {
        s.ResumeDecision.oneOf[1].properties.type.const = "approve"
      },
      (s) => {
        s.ChatActivity.oneOf[0].additionalProperties = true
      },
      (s) => {
        s.ChatActivity.oneOf[2].properties.source_refs.uniqueItems = false
      },
      (s) => {
        delete s.ChatTodo["x-kokoro-json-byte-limit"]
      },
    ]) {
      const candidate = structuredClone(owner)
      change(candidate.components.schemas)
      assert.throws(() => assertInteractionContractSchema(candidate))
    }
  })

  it("rejects every strict failure-schema graph mutant before generation", async () => {
    const { assertFailureContractSchema } = await import("../scripts/generate-agent-http-client.mjs")
    const manifest = JSON.parse(await readFile(new URL("../contract/dependencies/agent-http.json", import.meta.url), "utf8"))
    const owner = JSON.parse(
      await readFile(new URL(`../contract/vendor/kokoro-agent/${manifest.owner.repository_commit}/openapi.json`, import.meta.url), "utf8"),
    )
    assert.doesNotThrow(() => assertFailureContractSchema(owner))
    const mutate = (change) => {
      const candidate = structuredClone(owner)
      change(candidate.components.schemas)
      return candidate
    }
    for (const candidate of [
      mutate((schemas) => {
        schemas.Failure.required = ["code"]
      }),
      mutate((schemas) => {
        schemas.Failure.properties.code.enum.push("unexpected_failure")
      }),
      mutate((schemas) => {
        schemas.Failure.properties.code.enum.push("internal_error")
      }),
      mutate((schemas) => {
        delete schemas.Failure.if
      }),
      mutate((schemas) => {
        schemas.Failure.then.properties.code.enum.push("internal_error")
      }),
      mutate((schemas) => {
        schemas.Failure.properties.retryable.const = false
      }),
      mutate((schemas) => {
        schemas.Failure.additionalProperties = false
      }),
      mutate((schemas) => {
        schemas.ChatFailure.allOf[0].$ref = "#/components/schemas/Error"
      }),
      mutate((schemas) => {
        schemas.ChatFailure.allOf[1].required = []
      }),
      mutate((schemas) => {
        schemas.ChatFailure.allOf[1].properties.status.const = "completed"
      }),
      mutate((schemas) => {
        schemas.ChatFailure.unevaluatedProperties = true
      }),
      mutate((schemas) => {
        schemas.ChatFailure.allOf[1].additionalProperties = false
      }),
      mutate((schemas) => {
        delete schemas.ChatEvent["x-kokoro-decoded-payloads"].mapping["run.failed"]
      }),
    ])
      assert.throws(() => assertFailureContractSchema(candidate))
  })
})

describe("Agent owner HTTP success envelopes", () => {
  it("rejects malformed UTF-8 before parsing an owner JSON envelope", () => {
    assert.equal(parseAgentHttpJson(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d])), undefined)
  })
  it("accepts only exact 202 launch receipt, including replay marker and meta", () => {
    assert.deepEqual(parseLaunchReceipt(202, receipt), receipt)
    for (const candidate of [
      { ...receipt, meta: undefined },
      { ...receipt, meta: { request_id: "" } },
      { ...receipt, meta: { request_id: "request_1", extra: true } },
      { ...receipt, extra: true },
      { ...receipt, data: { ...receipt.data, replayed: undefined } },
      { ...receipt, data: { ...receipt.data, extra: true } },
      receipt.data,
    ])
      assert.equal(parseLaunchReceipt(202, candidate), null)
    for (const status of [200, 201, 204]) assert.equal(parseLaunchReceipt(status, receipt), null)
  })

  it("leaves malformed success bodies untrusted so dispatch can preserve admission uncertainty", () => {
    assert.equal(parseLaunchReceipt(202, { data: { run_id: "run_1", session_id: "session_1" } }), null)
    assert.equal(parseLaunchReceipt(202, undefined), null)
    assert.equal(parseLaunchReceipt(204, receipt), null)
  })

  it("trusts only exact owner error envelopes with safe code syntax", () => {
    assert.equal(parseAgentErrorCode({ error: { code: "agent_unavailable", message: "retry" }, meta: { request_id: "request_1" } }), "agent_unavailable")
    for (const body of [
      { error: { code: "agent_unavailable", message: "retry" } },
      { error: { code: "evil\nheader", message: "retry" }, meta: { request_id: "request_1" } },
      { error: { code: "agent_unavailable", message: "retry", extra: true }, meta: { request_id: "request_1" } },
      { error: { code: "agent_unavailable", message: "retry" }, meta: { request_id: "request_1" }, extra: true },
    ])
      assert.equal(parseAgentErrorCode(body), null)
  })

  it("accepts only exact 200 replay page with owner source identity, enum and epoch time", () => {
    assert.deepEqual(parseReplayPage(200, page), page)
    for (const candidate of [
      { ...page, meta: undefined },
      { ...page, meta: { request_id: "request_1", extra: true } },
      { ...page, extra: true },
      { ...page, data: { ...page.data, extra: true } },
      ...[
        { source_index: undefined },
        { source_index: -1 },
        { source_index: "0" },
        { event_type: "unknown" },
        { created_at: "1970-01-01T00:00:00Z" },
        { created_at: -1 },
        { created_at: 1.5 },
        { seq: 0 },
        { extra: true },
      ].map((change) => ({ ...page, data: { ...page.data, events: [{ ...event, ...change }] } })),
      page.data,
    ])
      assert.equal(parseReplayPage(200, candidate), null)
    for (const status of [202, 204]) assert.equal(parseReplayPage(status, page), null)
  })
})

it("typed selection runtime and public limits match the fixed Agent machine contract", async () => {
  const { parseSkillSourceSelection } = await import("../dist/domain/chat/skill-source-selection.js")
  const manifest = JSON.parse(await readFile(new URL("../contract/dependencies/agent-http.json", import.meta.url), "utf8"))
  const owner = JSON.parse(await readFile(new URL(`../contract/vendor/kokoro-agent/${manifest.owner.repository_commit}/openapi.json`, import.meta.url), "utf8"))
  const schema = owner.components.schemas.LaunchRequest.properties.selected_skill_source_refs
  const pattern = new RegExp(schema.items.pattern, "u")
  const publicContract = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  const section = publicContract.split("    MessageCreateRequest:\n")[1].split("    MessageReceipt:\n")[0]
  assert.match(section, new RegExp(`maxItems: ${schema.maxItems}`))
  assert.match(section, new RegExp(`x-kokoro-json-byte-limit: ${schema["x-kokoro-json-byte-limit"]}`))
  assert.match(section, /uniqueItems: true/)
  const publicPattern = new RegExp(section.match(/pattern: '([^']+)'/)[1], "u")
  for (const value of [
    "skill:a",
    "skill:a.b:c-d_e",
    "skill:" + "a".repeat(191),
    "skill:" + "a".repeat(192),
    "skill:skill:a",
    "skill:a\n",
    "skill:a\r",
    "skill:a\u2028",
    "skill:a\u2029",
    "skill:中",
    " skill:a",
    "skill:a ",
    "skill:a!",
    "a",
  ]) {
    assert.equal(parseSkillSourceSelection([value]) !== null, pattern.test(value), `owner mismatch: ${JSON.stringify(value)}`)
    assert.equal(publicPattern.test(value), pattern.test(value), `public mismatch: ${JSON.stringify(value)}`)
  }
  const max = Array.from({ length: schema.maxItems }, (_, i) => `skill:a${i}`)
  assert.deepEqual(parseSkillSourceSelection(max), max)
  assert.equal(parseSkillSourceSelection([...max, "skill:extra"]), null)
  assert.equal(parseSkillSourceSelection(["skill:a", "skill:a"]), null)
  assert.equal(parseSkillSourceSelection(new Array(1)), null)
})

it("Agent receipt digest matches owner Unicode code-point ordering and JSON float representation without deleting business null", async () => {
  const { agentControlRequestDigest } = await import("../dist/infrastructure/clients/agent/control-receipt.js")
  const body = {
    kind: "run.resume",
    session_id: "session_1",
    expected_pause_revision: 7,
    pause_ref: "pause_7",
    decisions: [{ type: "submit", item_id: "item_1", value: { "\u{10000}": null, "\ue000": 1e-7, small: 1e-5 } }],
  }
  const { buildAgentControl } = await import("../dist/infrastructure/clients/agent/control.js")
  const { session_id, ...controlInput } = body
  assert.deepEqual(buildAgentControl(session_id, controlInput), body, "golden digest input first passes the pinned owner control schema")
  // Fixed owner protocol/control.py: json.dumps(ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).
  assert.equal(agentControlRequestDigest("run_unicode", body), "sha256:6144ae19555668d96796dc9fd2851aa3b79ad4ca88af35c2352003a26b39d9b3")
  const withoutNull = structuredClone(body)
  delete withoutNull.decisions[0].value["\u{10000}"]
  assert.notEqual(agentControlRequestDigest("run_unicode", withoutNull), agentControlRequestDigest("run_unicode", body))
})

it("R123 owner replay envelope accepts the published HTTP5 Todo and safe activity discriminators", () => {
  const safeEvents = [
    { event_type: "todo.updated", payload_json: JSON.stringify({ todos: [] }) },
    {
      event_type: "activity",
      payload_json: JSON.stringify({
        activity: "tool",
        activity_id: `act_${"a".repeat(64)}`,
        segment_id: `seg_${"b".repeat(64)}`,
        status: "running",
        display_code: "tool.execution",
      }),
    },
    {
      event_type: "activity",
      payload_json: JSON.stringify({
        activity: "skill",
        activity_id: `act_${"c".repeat(64)}`,
        preflight_id: `spf_${"d".repeat(64)}`,
        source_refs: ["skill:alpha"],
        phase: "ready",
      }),
    },
  ].map((fields, index) => ({ ...event, ...fields, chat_event_id: `http5_${index + 1}`, source_index: index, seq: index + 1 }))
  const envelope = { data: { events: safeEvents, next_seq: 3, watermark: 3 }, meta: { request_id: "r123_http5" } }

  assert.deepEqual(parseReplayPage(200, envelope), envelope)
})

describe("Agent HTTP7 frozen BFF project projection", () => {
  async function peer(exercise) {
    const { createServer } = await import("node:http")
    const received = []
    const server = createServer(async (request, response) => {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      received.push({ body, key: request.headers["idempotency-key"] })
      response.writeHead(202, { "content-type": "application/json" })
      response.end(JSON.stringify({ data: { run_id: body.run_id, session_id: body.session_id, replayed: false }, meta: { request_id: body.request_id } }))
    })
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    try {
      const url = `http://127.0.0.1:${server.address().port}`
      const config = { agentEnabled: true, upstreams: { agents: url }, domain: "fixture.invalid", upstreamSecret: "fixture-secret" }
      const { AgentOutboxDelivery } = await import("../dist/infrastructure/clients/agent/outbox-delivery.js")
      const { ScheduledAgentDispatchDelivery } = await import("../dist/infrastructure/clients/agent/scheduled-dispatch-delivery.js")
      await exercise(received, new AgentOutboxDelivery(config), new ScheduledAgentDispatchDelivery(config))
    } finally {
      server.closeAllConnections()
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  }
  function saved(source, project) {
    return {
      request_id: "request_1",
      run_id: "run_1",
      session_id: "session_1",
      feature_key: "chat",
      message_id: "message_1",
      content: "unchanged",
      selected_skill_source_refs: [],
      trace: { source, ...(project === undefined ? {} : { project_ref: project }) },
    }
  }
  function command(payload) {
    return {
      tenantId: "tenant",
      subjectId: "user",
      actorId: "user",
      identityAssertionRef: "assertion",
      requestId: "request_1",
      runId: "run_1",
      conversationId: "session_1",
      idempotencyKey: "same-command",
      payload,
    }
  }
  it("sends explicit nullable scope for Chat and Scheduled without rewriting the frozen command", async () => {
    await peer(async (received, chat, scheduled) => {
      for (const [delivery, source] of [
        [chat, "kokoro-bff"],
        [scheduled, "kokoro-bff-scheduler"],
      ]) {
        for (const project of [undefined, "project_frozen_original"]) {
          const launch = saved(source, project)
          if (delivery === chat) launch.project_ref = project ?? null
          const payload = delivery === chat ? { schema_version: 3, launch } : launch
          const before = JSON.stringify(payload)
          assert.deepEqual(await delivery.deliver({ ...command(payload), ...(delivery === chat ? { executionProjectRef: project ?? null } : {}) }, 2000), {
            outcome: "admitted",
          })
          const wire = received.at(-1)
          assert.equal(wire.body.project_ref, project ?? null)
          assert.equal(wire.key, "same-command")
          assert.equal(JSON.stringify(payload), before)
          assert.deepEqual(wire.body.selected_skill_source_refs, [])
        }
      }
      assert.equal(received.length, 4)
    })
  })
  it("rejects forged or malformed saved scopes before any owner request", async () => {
    await peer(async (received, chat, scheduled) => {
      for (const [delivery, source] of [
        [chat, "kokoro-bff"],
        [scheduled, "kokoro-bff-scheduler"],
      ]) {
        const base = saved(source, "project_frozen_original")
        for (const launch of [
          { ...base, project_ref: "project_forged" },
          { ...base, trace: { ...base.trace, project_ref: null } },
          { ...base, trace: { ...base.trace, project_ref: "not a project" } },
          { ...base, trace: { source: "browser" } },
          { ...base, extra: true },
        ]) {
          const payload = delivery === chat ? { schema_version: 2, launch } : launch
          assert.deepEqual(await delivery.deliver(command(payload), 2000), { outcome: "not_admitted", errorCode: "agent_launch_invalid" })
        }
      }
      const canonical = { ...saved("kokoro-bff", "observational-project"), project_ref: "project_canonical" }
      for (const payload of [
        { schema_version: 2, launch: canonical },
        { schema_version: 3, launch: { ...canonical, project_ref: "different-canonical" } },
        { schema_version: 3, launch: { ...canonical, project_ref: null } },
        { schema_version: 3, launch: { ...canonical, project_ref: undefined } },
      ])
        assert.deepEqual(await chat.deliver({ ...command(payload), executionProjectRef: "project_canonical" }, 2000), {
          outcome: "not_admitted",
          errorCode: "agent_launch_invalid",
        })
      assert.equal(received.length, 0)
    })
  })
  it("uses only the durable canonical Chat scope, never an observation trace", async () => {
    await peer(async (received, chat) => {
      const payload = { schema_version: 3, launch: { ...saved("kokoro-bff", "observation_not_authority"), project_ref: "project_canonical" } }
      assert.deepEqual(await chat.deliver({ ...command(payload), executionProjectRef: "project_canonical" }, 2000), { outcome: "admitted" })
      assert.equal(received[0].body.project_ref, "project_canonical")
      assert.equal(received[0].body.trace.project_ref, "observation_not_authority")
    })
  })
})

describe("confirmed model settlement pending", () => {
  it("projects a nonretryable model settlement pending owner event without diagnostics", () => {
    const pending = {
      ...event,
      event_type: "run.failed",
      payload_json: JSON.stringify({ status: "failed", code: "model_settlement_pending", retryable: false }),
    }
    assert.deepEqual(mapAgentEvent(pending).payload.failure, { source: "agent", code: "model_settlement_pending", retryable: false })
    for (const payload of [
      { status: "failed", code: "model_settlement_pending", retryable: true },
      { status: "failed", code: "model_settlement_pending", retryable: false, amount: "1" },
      { status: "failed", code: "made_up_settlement_status", retryable: false },
    ])
      assert.throws(() => mapAgentEvent({ ...pending, payload_json: JSON.stringify(payload) }))
  })
})
