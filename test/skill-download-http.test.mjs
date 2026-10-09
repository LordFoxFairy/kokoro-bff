import assert from "node:assert/strict"
import test from "node:test"
import { createServer } from "node:http"
import { once } from "node:events"
import { createHash } from "node:crypto"
import { create } from "@bufbuild/protobuf"
import { GetSkillPackageDownloadResponseSchema } from "../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts"
import { skillDownloadRoute } from "../src/http/routes/skill-download.ts"

test("Package proxy verifies all bytes then re-admits exact revision and session before disclosure", async () => {
  const bytes = Buffer.from("immutable-package"),
    hash = createHash("sha256").update(bytes).digest("hex")
  const object = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/zip", "content-length": bytes.length })
    res.end(bytes)
  })
  object.listen(0, "127.0.0.1")
  await once(object, "listening")
  const origin = `http://127.0.0.1:${object.address().port}`
  let changed = false,
    readmitted = 0,
    calls = 0,
    revoked = false
  const client = {
    download: async () => {
      calls++
      return create(GetSkillPackageDownloadResponseSchema, {
        sourceRef: { value: "skill:s" },
        revision: changed && calls % 2 === 0 ? 2n : 1n,
        filename: "skill.zip",
        sizeBytes: BigInt(bytes.length),
        contentSha256: hash,
        transferReference: { url: `${origin}/object`, method: "GET", expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60), nanos: 0 } },
      })
    },
  }
  const proxy = createServer(
    (request, response) =>
      void skillDownloadRoute(
        request,
        response,
        { requestId: "request", identity: { namespace: "tenant", userId: "user" } },
        "s",
        "download",
        client,
        origin,
        async () => {
          readmitted++
          if (revoked) throw Error("skill_not_found")
        },
      ),
  )
  proxy.listen(0, "127.0.0.1")
  await once(proxy, "listening")
  try {
    const url = `http://127.0.0.1:${proxy.address().port}/v1/skills/s/download`
    let response = await fetch(url)
    assert.equal(response.status, 200)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
    assert.equal(readmitted, 1)
    changed = true
    response = await fetch(url)
    assert.equal(response.status, 404)
    assert.equal(readmitted, 1)
    changed = false
    revoked = true
    response = await fetch(url)
    assert.equal(response.status, 404)
    assert.equal(readmitted, 2)
    assert.equal(calls, 6)
  } finally {
    object.closeAllConnections()
    proxy.closeAllConnections()
    await Promise.all([new Promise((r) => object.close(r)), new Promise((r) => proxy.close(r))])
  }
})
