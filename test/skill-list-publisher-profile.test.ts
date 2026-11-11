import { fixtureIamCredentials, TEST_IAM_USER_CONTEXT_SECRET } from "./doubles/iam-credentials.ts"
const credentials = await fixtureIamCredentials("tenant")
import assert from "node:assert/strict"
import test from "node:test"
import { once } from "node:events"
import { createServer } from "node:http"
import { IamPublisherProfileClient } from "../src/infrastructure/clients/iam-publisher-profile.js"

test("public author resolution uses the generated dedicated key/App endpoint; website uses the separate service+actor endpoint", async () => {
  const seen: { path?: string; authorization?: string; body: unknown }[] = []
  const server = createServer(async (request, response) => {
    if (request.url?.includes("/tenants/")) {
      assert.equal(request.headers["x-kokoro-actor-id"], "current-session")
      assert.equal(request.headers.cookie, undefined)
      assert.equal(request.headers.origin, undefined)
    } else assert.equal(request.headers["x-kokoro-actor-id"], undefined)
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    seen.push({ path: request.url, authorization: request.headers.authorization, body })
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "publisher-test" })
    response.end(
      JSON.stringify({
        data: { items: body.refs.map((ref: { kind: string; id: string }) => ({ ...ref, status: "found", display_name: "Real Author", image_url: null })) },
      }),
    )
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const client = new IamPublisherProfileClient(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      1000,
      credentials.iamUserContextServiceCredentialFile,
    )
    const refs = [{ kind: "user" as const, id: "author" }]
    const signal = new AbortController().signal
    const profiles = await client.resolvePublic("tenant", "opaque-key", "publisher-test", refs, signal)
    assert.equal(profiles.get(JSON.stringify(["user", "author"]))?.display_name, "Real Author")
    await client.resolve("tenant", "current-session", "publisher-test", refs, signal)
    assert.deepEqual(seen, [
      { path: "/internal/v1/skill-list-identities/publisher-profiles/resolve", authorization: "Bearer opaque-key", body: { refs } },
      { path: "/internal/v1/tenants/tenant/publisher-profiles/resolve", authorization: `Bearer ${TEST_IAM_USER_CONTEXT_SECRET}`, body: { refs } },
    ])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
