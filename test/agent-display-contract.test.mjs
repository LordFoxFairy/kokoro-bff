import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, mkdir, writeFile, rm, access, realpath } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { restoreAgent82DisplayRaw } from "../scripts/generate-agent-http-client.mjs"
const vendor = new URL("../contract/vendor/kokoro-agent/669fd4e7656f4fdc384eee40ef1fc3155e87d966/", import.meta.url)
test("formal Agent8.3 raw display delta restores the complete original8.2 including int64 lexemes and numeric response order", async () => {
  const raw = await readFile(new URL("openapi.json", vendor), "utf8"),
    parent = restoreAgent82DisplayRaw(raw)
  assert.equal(createHash("sha256").update(parent).digest("hex"), "8a0b9973661205b8e29020934c39e5c7ab629b4c42db4e79c845a410d96efa2a")
  for (const bad of [parent, raw + "\n", raw.replace('"maxItems": 128', '"maxItems": 129'), raw.replace('"virtual_path": {', '"unreviewed_path": {')])
    assert.throws(() => restoreAgent82DisplayRaw(bad), /drift/)
})
test("both current generator modes reject a full legacy owner blob rather than publishing a ghost display client", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "kokoro-agent83-ghost-")))
  try {
    await mkdir(join(dir, "scripts"), { recursive: true })
    const dest = join(dir, "contract/vendor/kokoro-agent/669fd4e7656f4fdc384eee40ef1fc3155e87d966")
    await mkdir(dest, { recursive: true })
    await writeFile(join(dir, "scripts/generate-agent-http-client.mjs"), await readFile(new URL("../scripts/generate-agent-http-client.mjs", import.meta.url)))
    await writeFile(join(dest, "openapi.json"), restoreAgent82DisplayRaw(await readFile(new URL("openapi.json", vendor), "utf8")))
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
