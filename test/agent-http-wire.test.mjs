import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { describe, it } from "node:test"
import { parseAgentErrorCode, parseLaunchReceipt, parseReplayPage } from "../dist/infrastructure/clients/agent/http-wire.js"

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
        repository_commit: "f3be3b97dd67df69ed3c6cb88c59f3bc2db97703",
        contract_version: "3.0.0",
        contract_path: "contract/openapi/v1/openapi.json",
        contract_sha256: "e9f0a543f74dee34212f0ea4fe366d46218268462ac54dce08e41965f34d2d2c",
        provenance_path: "contract/provenance.json",
        provenance_sha256: "d116657f65027de8bd829dc0408fd86046da0ac0a1d2934bd2a87e835c897b5f",
      },
    )
    assert.deepEqual(
      manifest.generated.find(({ path }) => path === "failure-profile.gen.ts"),
      {
        path: "failure-profile.gen.ts",
        source_sha256: "e9f0a543f74dee34212f0ea4fe366d46218268462ac54dce08e41965f34d2d2c",
        sha256: manifest.generated.find(({ path }) => path === "failure-profile.gen.ts")?.sha256,
      },
    )
    assert.match(manifest.generated.find(({ path }) => path === "failure-profile.gen.ts")?.sha256 ?? "", /^[0-9a-f]{64}$/u)
  })

  it("keeps the independently published S4 delivery source pinned across the HTTP repin", async () => {
    const manifest = JSON.parse(await readFile(new URL("../contract/dependencies/agent-http.json", import.meta.url), "utf8"))
    assert.deepEqual(manifest.event_protocol, {
      owner: "kokoro-agent",
      source_commit: "486adb1539dd8a06ca90684e66f91be031aa70cf",
      provenance_combined_sha256: "cae30a40d712bce39ef33ef2dc857af4f5b69c6afd1956fda065ec77379ae02e",
      source_path: "src/kokoro_agent/protocol/events.py",
      source_sha256: "0ba59b358db00e53490555e450af060c8a728133a9cf8bfeb49361186adc0f1c",
      event_kind: "delivery.created",
    })
  })

  it("verifies the frozen owner event source bytes and exact regular-file allowlist", async () => {
    const { assertEventProtocolSource } = await import("../scripts/generate-agent-http-client.mjs")
    const source = await readFile(
      new URL("../contract/vendor/kokoro-agent/486adb1539dd8a06ca90684e66f91be031aa70cf/src/kokoro_agent/protocol/events.py", import.meta.url),
    )
    const tree = {
      files: ["src/kokoro_agent/protocol/events.py"],
      directories: ["src", "src/kokoro_agent", "src/kokoro_agent/protocol"],
    }
    assert.doesNotThrow(() => assertEventProtocolSource(tree, source))
    assert.throws(() => assertEventProtocolSource(tree, Buffer.concat([source, Buffer.from("\n")])), /digest/u)
    assert.throws(() => assertEventProtocolSource({ ...tree, files: [...tree.files, "unexpected.py"] }, source), /allowlist/u)
    assert.throws(() => assertEventProtocolSource({ ...tree, files: [] }, source), /allowlist/u)
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
