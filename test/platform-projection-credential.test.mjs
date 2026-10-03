import assert from "node:assert/strict"
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test, { afterEach } from "node:test"
import { ProjectionCredentialSource } from "../dist/infrastructure/clients/platform/projection-credential.js"
import { ProjectionTokenSource } from "../dist/infrastructure/clients/platform/projection-token.js"
const fixtureDirs = new Set()
const fixtureDir = async (prefix) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  fixtureDirs.add(dir)
  return dir
}
afterEach(async () => {
  await Promise.all([...fixtureDirs].map((dir) => rm(dir, { recursive: true, force: true })))
  fixtureDirs.clear()
})
const resource = "https://kokoro.dev/resources/platform-internal",
  scope = "platform:projection.read"
const item = (generation, clientId = "one") => ({
  tenantId: "tenant",
  generation,
  credentialRefVersion: "v1",
  clientId,
  clientSecret: "secret",
  resource,
  scope,
})

test("projection credential source rejects broad permissions and reads exact tenant snapshot", async () => {
  const dir = await fixtureDir("bff-catalog-")
  const file = path.join(dir, "credential.json")
  await writeFile(file, JSON.stringify([item(1)]), { mode: 0o644 })
  await chmod(file, 0o644)
  assert.equal((await stat(file)).mode & 0o777, 0o644)
  const source = new ProjectionCredentialSource(file)
  await assert.rejects(source.read("tenant"), /insecure/u)
  await chmod(file, 0o600)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.equal((await source.read("tenant")).generation, 1)
})

test("projection credential cache key changes on secret-only rotation", async () => {
  const dir = await fixtureDir("bff-projection-rotation-")
  const file = path.join(dir, "credential.json")
  await writeFile(file, JSON.stringify([item(1)]), { mode: 0o600 })
  const source = new ProjectionCredentialSource(file)
  const before = await source.read("tenant")
  await writeFile(file, JSON.stringify([{ ...item(1), clientSecret: "rotated-secret" }]))
  const after = await source.read("tenant")
  assert.notEqual(before.cacheKey, after.cacheKey)
  assert.equal(after.cacheKey.includes("rotated-secret"), false)
})

test("token exchange uses frozen IAM contract, coalesces, and invalidates on generation rotation", async () => {
  const original = globalThis.fetch
  const calls = []
  let generation = 1
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: String(init.body) })
    return new Response(JSON.stringify({ access_token: `machine-${generation}`, token_type: "Bearer", expires_in: 60, scope }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
  try {
    const credentials = { read: async (tenant) => ({ ...item(generation), cacheKey: JSON.stringify([tenant, generation, "v1", "one", resource, scope]) }) }
    const source = new ProjectionTokenSource("http://iam.example", credentials, 100)
    assert.deepEqual(await Promise.all([source.get("tenant"), source.get("tenant")]), ["machine-1", "machine-1"])
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, "http://iam.example/iam/oauth2/token")
    assert.equal(calls[0].init.redirect, "error")
    assert.equal(calls[0].body, `grant_type=client_credentials&resource=${encodeURIComponent(resource)}&scope=${encodeURIComponent(scope)}`)
    generation = 2
    assert.equal(await source.get("tenant"), "machine-2")
    assert.equal(calls.length, 2)
  } finally {
    globalThis.fetch = original
  }
})

test("token exchange rejects malformed type, scope, expiry and oversized response", async () => {
  const original = globalThis.fetch
  const credentials = { read: async () => ({ ...item(1), cacheKey: "1" }) }
  try {
    for (const body of [
      { access_token: "x", token_type: "bearer", expires_in: 60, scope },
      { access_token: "x", token_type: "Bearer", expires_in: 0, scope },
      { access_token: "x", token_type: "Bearer", expires_in: 60, scope: "wrong" },
    ]) {
      globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
      await assert.rejects(new ProjectionTokenSource("http://iam", credentials, 100).get("tenant"), /invalid/u)
    }
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ padding: "x".repeat(70000) }), { status: 200, headers: { "content-type": "application/json" } })
    await assert.rejects(new ProjectionTokenSource("http://iam", credentials, 100).get("tenant"), /too_large/u)
  } finally {
    globalThis.fetch = original
  }
})

test("token exchange does not await a response stream whose cancellation never settles", async () => {
  const original = globalThis.fetch
  const credentials = { read: async () => ({ ...item(1), cacheKey: "pending-cancel" }) }
  const unresolvedCancel = () =>
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(65_537))
      },
      cancel() {
        return new Promise(() => {})
      },
    })
  try {
    for (const status of [503, 200]) {
      globalThis.fetch = async () => new Response(unresolvedCancel(), { status, headers: { "content-type": "application/json" } })
      const result = new ProjectionTokenSource("http://iam", credentials, 100).get("tenant")
      await assert.rejects(
        Promise.race([result, new Promise((_, reject) => setTimeout(() => reject(new Error("cancel-wait-exceeded")), 250))]),
        status === 503 ? /projection_token_failed/u : /projection_token_response_too_large/u,
      )
    }
  } finally {
    globalThis.fetch = original
  }
})

test("token single-flight lets one waiter cancel while another succeeds and aborts only after all cancel", async () => {
  const original = globalThis.fetch
  const credentials = { read: async () => ({ ...item(1), cacheKey: "shared" }) }
  let underlyingAborts = 0
  globalThis.fetch = async (_url, init) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          resolve(
            new Response(JSON.stringify({ access_token: "machine", token_type: "Bearer", expires_in: 60, scope }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          ),
        20,
      )
      init.signal.addEventListener(
        "abort",
        () => {
          underlyingAborts += 1
          clearTimeout(timer)
          reject(init.signal.reason)
        },
        { once: true },
      )
    })
  try {
    const source = new ProjectionTokenSource("http://iam", credentials, 1000)
    const one = new AbortController()
    const two = new AbortController()
    const abandoned = source.get("tenant", one.signal)
    const retained = source.get("tenant", two.signal)
    await new Promise((resolve) => setTimeout(resolve, 0))
    one.abort(new Error("caller-left"))
    await assert.rejects(abandoned, /caller-left/u)
    assert.equal(await retained, "machine")
    assert.equal(underlyingAborts, 0)
    const source2 = new ProjectionTokenSource("http://iam", credentials, 1000)
    const a = new AbortController()
    const b = new AbortController()
    const pa = source2.get("tenant", a.signal)
    const pb = source2.get("tenant", b.signal)
    await new Promise((resolve) => setTimeout(resolve, 0))
    a.abort()
    b.abort()
    await Promise.allSettled([pa, pb])
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(underlyingAborts, 1)
  } finally {
    globalThis.fetch = original
  }
})

test("credential snapshot rejects symlink, non-regular, duplicate tenant and invalid generations while accepting 0400", async () => {
  const { symlink, mkdir } = await import("node:fs/promises")
  const dir = await fixtureDir("bff-catalog-negative-")
  const file = path.join(dir, "credentials.json")
  await writeFile(file, JSON.stringify([item(1)]), { mode: 0o400 })
  assert.equal((await new ProjectionCredentialSource(file).read("tenant")).generation, 1)
  const link = path.join(dir, "link.json")
  await symlink(file, link)
  await assert.rejects(new ProjectionCredentialSource(link).read("tenant"))
  const folder = path.join(dir, "folder")
  await mkdir(folder)
  await assert.rejects(new ProjectionCredentialSource(folder).read("tenant"))
  await chmod(file, 0o600)
  await writeFile(file, JSON.stringify([item(1), item(2)]))
  await assert.rejects(new ProjectionCredentialSource(file).read("tenant"), /invalid/u)
  for (const generation of ["1", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await writeFile(file, JSON.stringify([item(generation)]))
    await assert.rejects(new ProjectionCredentialSource(file).read("tenant"), /invalid/u)
  }
})
