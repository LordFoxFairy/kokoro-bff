import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, mkdir, writeFile, rm, access, realpath } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { restoreAgent84ActivityDetailsRaw, restoreAgent83ToolFactsRaw, restoreAgent82DisplayRaw } from "../scripts/generate-agent-http-client.mjs"
const vendor = new URL("../contract/vendor/kokoro-agent/b80d68337c6643992cc2920aa18c70d9cc783488/", import.meta.url)
test("formal Agent8.5 details,8.4 raw tool facts and8.3 display deltas restores the complete original8.2 including int64 lexemes and numeric response order", async () => {
  const raw = await readFile(new URL("openapi.json", vendor), "utf8"),
    parent = restoreAgent82DisplayRaw(restoreAgent83ToolFactsRaw(restoreAgent84ActivityDetailsRaw(raw)))
  assert.equal(createHash("sha256").update(parent).digest("hex"), "8a0b9973661205b8e29020934c39e5c7ab629b4c42db4e79c845a410d96efa2a")
  for (const bad of [parent, raw + "\n", raw.replace('"maxItems": 128', '"maxItems": 129'), raw.replace('"virtual_path": {', '"unreviewed_path": {')])
    assert.throws(() => restoreAgent82DisplayRaw(restoreAgent83ToolFactsRaw(restoreAgent84ActivityDetailsRaw(bad))), /drift/)
})
test("both current generator modes reject a full legacy owner blob rather than publishing a ghost display client", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "kokoro-agent83-ghost-")))
  try {
    await mkdir(join(dir, "scripts"), { recursive: true })
    await writeFile(
      join(dir, "scripts/agent-final-answer-contract.mjs"),
      await readFile(new URL("../scripts/agent-final-answer-contract.mjs", import.meta.url)),
    )
    const dest = join(dir, "contract/vendor/kokoro-agent/b80d68337c6643992cc2920aa18c70d9cc783488")
    await mkdir(dest, { recursive: true })
    await writeFile(join(dir, "scripts/generate-agent-http-client.mjs"), await readFile(new URL("../scripts/generate-agent-http-client.mjs", import.meta.url)))
    await writeFile(
      join(dest, "openapi.json"),
      restoreAgent82DisplayRaw(restoreAgent83ToolFactsRaw(restoreAgent84ActivityDetailsRaw(await readFile(new URL("openapi.json", vendor), "utf8")))),
    )
    await writeFile(join(dest, "provenance.json"), await readFile(new URL("provenance.json", vendor)))
    for (const mode of ["--write", "--check"]) {
      const out = spawnSync(process.execPath, [join(dir, "scripts/generate-agent-http-client.mjs"), mode], { encoding: "utf8", timeout: 5000 })
      assert.equal(out.status, 1)
      assert.match(out.stderr, /vendored Agent HTTP contract digest drifted/)
    }
    await assert.rejects(access(join(dir, "src/generated/agent-http")))
    await assert.rejects(access(join(dir, "contract/dependencies/agent-http.json")))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("Public tool adjunct delta restores every original Public28.10 byte, including feedback and regeneration", async () => {
  const { restorePublic2810ToolFactsContract } = await import("../scripts/project-pin-public-contract.mjs")
  const raw = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  const parent = restorePublic2810ToolFactsContract(raw)
  assert.equal(createHash("sha256").update(parent).digest("hex"), "9e6a8dddea847ecfd2905f378f4f76022b6cc49a1a4352a2e7abb4e73b3f1328")
  for (const bad of [
    raw + "\n",
    raw.replace("getMessageFeedback", "changedFeedback"),
    raw.replace("maxItems: 128", "maxItems: 129"),
    raw.replace("  version: 28.16.0", "  version: 28.17.0"),
  ]) {
    assert.notEqual(bad, raw)
    assert.throws(() => restorePublic2810ToolFactsContract(bad), /drift/)
  }
})

test("formal Agent tool facts restore the complete HTTP8.3 before the older strict inverse", async () => {
  const raw = await readFile(new URL("openapi.json", vendor), "utf8")
  const parent = restoreAgent83ToolFactsRaw(restoreAgent84ActivityDetailsRaw(raw))
  assert.equal(createHash("sha256").update(parent).digest("hex"), "be642c2313fbaf447d4e37bda2a7920f867c3a06d39f7e0e82efaf212e7080d6")
  for (const bad of [
    parent,
    raw + "\n",
    raw.replace('"tool_facts": {', '"unexpected_facts": {'),
    raw.replace('"enum": [\n                    "failed"', '"enum": [\n                    "completed"'),
  ]) {
    assert.notEqual(bad, raw)
    assert.throws(() => restoreAgent83ToolFactsRaw(restoreAgent84ActivityDetailsRaw(bad)), /drift/)
  }
})

test("private activity details restore the exact complete Public28.11 parent, without broadening Chat or Share", async () => {
  const { restorePublic2811ActivityDetailsContract } = await import("../scripts/project-pin-public-contract.mjs")
  const raw = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  assert.match(raw, /^  version: 28\.16\.0$/mu)
  const parent = restorePublic2811ActivityDetailsContract(raw)
  assert.equal(createHash("sha256").update(parent).digest("hex"), "4d93ec15e2931768afafffb2101039b1da64757ea48c760d16ef88aa8753db16")
  for (const bad of [raw + "\n", raw.replace("getMessageFeedback", "changedFeedback"), raw.replace("activity_details:", "other_details:")])
    assert.throws(() => restorePublic2811ActivityDetailsContract(bad), /drift/)
})

test("formal Agent8.7 details and Public28.13 use the same closed private schema and exact raw8.4 parent", async () => {
  const { load } = await import("js-yaml")
  const raw = await readFile(new URL("openapi.json", vendor), "utf8")
  const owner = JSON.parse(raw)
  const published = load(await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8"))
  assert.deepEqual(published.components.schemas.RunDisplay.properties.activity_details, owner.components.schemas.RunDisplay.properties.activity_details)
  const parent = restoreAgent84ActivityDetailsRaw(raw)
  assert.equal(createHash("sha256").update(parent).digest("hex"), "239219e5a80427a74f8d89363c5a7a4fe2753f99c6b469b02bab7fba9ba44f52")
  for (const bad of [
    parent,
    raw + "\n",
    raw.replace('"activity_details": {', '"unreviewed_details": {'),
    raw.replace('"maxLength": 2048', '"maxLength": 2049'),
  ]) {
    assert.notEqual(bad, raw)
    assert.throws(() => restoreAgent84ActivityDetailsRaw(bad), /drift/)
  }
})

test("action title and capability description retain exact previous public and Agent contracts", async () => {
  const { restorePublic2812ActionDisplayContract } = await import("../scripts/project-pin-public-contract.mjs")
  const { restoreAgent85ActionDisplayRaw } = await import("../scripts/generate-agent-http-client.mjs")
  const { load } = await import("js-yaml")
  const raw = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  const agentRaw = await readFile(new URL("openapi.json", vendor), "utf8")
  const agent = JSON.parse(agentRaw),
    pub = load(raw)
  assert.deepEqual(pub.components.schemas.RunToolActivity.properties.action_title, agent.components.schemas.ChatActivity.oneOf[0].properties.action_title)
  assert.equal(
    createHash("sha256").update(restorePublic2812ActionDisplayContract(raw)).digest("hex"),
    "86638da86d786e91c81da9e5dd891dee88ef2ca033579866f5ebc6dd6113c00f",
  )
  assert.equal(
    createHash("sha256").update(restoreAgent85ActionDisplayRaw(agentRaw)).digest("hex"),
    "b000f24e88bf5e4f20718ae7f6b29c94ef96b2c6fe42f73ef7231695f438e897",
  )
  for (const bad of [raw + "\n", raw.replace("action_title:", "action_other:"), raw.replace("maxLength: 256", "maxLength: 257")])
    assert.throws(() => restorePublic2812ActionDisplayContract(bad), /drift/)
  for (const bad of [agentRaw + "\n", agentRaw.replace('"action_title":', '"action_other":'), agentRaw.replace('"maxLength": 256', '"maxLength": 257')])
    assert.throws(() => restoreAgent85ActionDisplayRaw(bad), /drift/)
})
