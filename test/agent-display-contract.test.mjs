import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, mkdir, writeFile, rm, access, realpath } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { restoreAgent83ToolFactsRaw, restoreAgent82DisplayRaw } from "../scripts/generate-agent-http-client.mjs"
const vendor = new URL("../contract/vendor/kokoro-agent/f31b60be27dd9b4dfddd7a1c3579b19e40db150d/", import.meta.url)
test("formal Agent8.4 raw tool facts and8.3 display deltas restores the complete original8.2 including int64 lexemes and numeric response order", async () => {
  const raw = await readFile(new URL("openapi.json", vendor), "utf8"),
    parent = restoreAgent82DisplayRaw(restoreAgent83ToolFactsRaw(raw))
  assert.equal(createHash("sha256").update(parent).digest("hex"), "8a0b9973661205b8e29020934c39e5c7ab629b4c42db4e79c845a410d96efa2a")
  for (const bad of [parent, raw + "\n", raw.replace('"maxItems": 128', '"maxItems": 129'), raw.replace('"virtual_path": {', '"unreviewed_path": {')])
    assert.throws(() => restoreAgent82DisplayRaw(restoreAgent83ToolFactsRaw(bad)), /drift/)
})
test("both current generator modes reject a full legacy owner blob rather than publishing a ghost display client", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "kokoro-agent83-ghost-")))
  try {
    await mkdir(join(dir, "scripts"), { recursive: true })
    const dest = join(dir, "contract/vendor/kokoro-agent/f31b60be27dd9b4dfddd7a1c3579b19e40db150d")
    await mkdir(dest, { recursive: true })
    await writeFile(join(dir, "scripts/generate-agent-http-client.mjs"), await readFile(new URL("../scripts/generate-agent-http-client.mjs", import.meta.url)))
    await writeFile(join(dest, "openapi.json"), restoreAgent82DisplayRaw(restoreAgent83ToolFactsRaw(await readFile(new URL("openapi.json", vendor), "utf8"))))
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
    raw.replace("  version: 28.11.0", "  version: 28.12.0"),
  ]) {
    assert.notEqual(bad, raw)
    assert.throws(() => restorePublic2810ToolFactsContract(bad), /drift/)
  }
})

test("formal Agent tool facts restore the complete HTTP8.3 before the older strict inverse", async () => {
  const raw = await readFile(new URL("openapi.json", vendor), "utf8")
  const parent = restoreAgent83ToolFactsRaw(raw)
  assert.equal(createHash("sha256").update(parent).digest("hex"), "be642c2313fbaf447d4e37bda2a7920f867c3a06d39f7e0e82efaf212e7080d6")
  for (const bad of [
    parent,
    raw + "\n",
    raw.replace('"tool_facts": {', '"unexpected_facts": {'),
    raw.replace('"enum": [\n                    "failed"', '"enum": [\n                    "completed"'),
  ]) {
    assert.notEqual(bad, raw)
    assert.throws(() => restoreAgent83ToolFactsRaw(bad), /drift/)
  }
})
