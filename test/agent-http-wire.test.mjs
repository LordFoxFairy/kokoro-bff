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
  it("pins the S4 event source separately from the unchanged generated HTTP source", async () => {
    const manifest = JSON.parse(await readFile(new URL("../contract/dependencies/agent-http.json", import.meta.url), "utf8"))
    assert.equal(manifest.owner.repository_commit, "dd34a4800b4ce0cc61eb80dd715e528b9d4517da")
    assert.equal(manifest.owner.contract_sha256, "20398c59f42031c1b6ae2e2c3708e63ec8b5645baf741bf831bc67e14625ef99")
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
  const owner = JSON.parse(
    await readFile(new URL("../contract/vendor/kokoro-agent/dd34a4800b4ce0cc61eb80dd715e528b9d4517da/openapi.json", import.meta.url), "utf8"),
  )
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
