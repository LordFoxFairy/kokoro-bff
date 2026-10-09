import assert from "node:assert/strict"
import test from "node:test"
import { createServer } from "node:http"
import { once } from "node:events"
import { createHash } from "node:crypto"
import { Code, ConnectError } from "@connectrpc/connect"
import { skillDownloadHandleRoute } from "../src/http/routes/skill-download.ts"
import { SkillDownloadHandles } from "../src/application/skill-download-handles.ts"

test("Package proxy verifies all bytes then re-admits exact revision and session before disclosure", async () => {
  const bytes = Buffer.from("immutable-package"),
    hash = createHash("sha256").update(bytes).digest("hex")
  let changed = false,
    readmitted = 0,
    calls = 0,
    revoked = false,
    bytesSent = false
  const object = createServer((_req, res) => {
    bytesSent = true
    res.writeHead(200, { "content-type": "application/zip", "content-length": bytes.length })
    res.end(bytes)
  })
  object.listen(0, "127.0.0.1")
  await once(object, "listening")
  const origin = `http://127.0.0.1:${object.address().port}`
  const handles = new SkillDownloadHandles()
  const entry = handles.issue({
    tenantId: "tenant",
    subjectId: "user",
    skillId: "series",
    versionUid: "s",
    filename: "skill.zip",
    sizeBytes: bytes.length,
    contentSha256: hash,
    expiresAt: Date.now() + 60000,
    transfer: { url: `${origin}/object`, method: "GET", requiredHeaders: {}, expiresAt: Date.now() + 60000 },
  })
  const composition = {
    skillDownloadHandles: handles,
    sessionAdmission: {
      async verify() {
        readmitted++
        return revoked && bytesSent
          ? { ok: false, status: 401, code: "session_authentication_required" }
          : { ok: true, identity: { namespace: "tenant", userId: "user" }, platformAdmin: false }
      },
    },
    skillSpecificationSource: {
      async confirmDownload(binding) {
        calls++
        assert.equal(binding.versionUid, "s")
        if (changed && calls % 2 === 0) throw new ConnectError("Exact revision changed", Code.NotFound)
      },
    },
  }
  const config = { tenantId: "tenant", sharedSecret: "test", storageObjectOrigin: origin }
  const proxy = createServer(
    (request, response) => void skillDownloadHandleRoute(request, response, config, composition, "request", ["skill-downloads", entry.handle]),
  )
  proxy.listen(0, "127.0.0.1")
  await once(proxy, "listening")
  try {
    const url = `http://127.0.0.1:${proxy.address().port}/skill-downloads/${entry.handle}`,
      headers = { authorization: "Bearer human", "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test" }
    let response = await fetch(url, { headers })
    assert.equal(response.status, 200)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
    assert.equal(readmitted, 2)
    changed = true
    bytesSent = false
    response = await fetch(url, { headers })
    assert.equal(response.status, 404)
    assert.equal(readmitted, 3)
    changed = false
    revoked = true
    bytesSent = false
    response = await fetch(url, { headers })
    assert.equal(response.status, 401)
    assert.equal(readmitted, 5)
    assert.equal(calls, 6)
  } finally {
    object.closeAllConnections()
    proxy.closeAllConnections()
    await Promise.all([new Promise((resolve) => object.close(resolve)), new Promise((resolve) => proxy.close(resolve))])
  }
})
