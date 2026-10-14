import assert from "node:assert/strict"
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test, { afterEach } from "node:test"
import { PlatformServiceCredentialSource } from "../dist/infrastructure/clients/platform/platform-service-credential.js"
const roots = new Set()
const TENANT = "tenant-product-local"
const entry = (secret = "bff-projection-secret-000000000000") => ({
  credential_id: "bff-projection",
  secret,
  caller: "kokoro-bff",
  surfaces: ["projection"],
  tenant_id: TENANT,
})
const fixture = async (contents, mode = 0o600) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "projection-credential-"))
  roots.add(dir)
  const file = path.join(dir, "credentials.json")
  await writeFile(file, JSON.stringify(contents), { mode })
  return file
}
afterEach(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })))
  roots.clear()
})
test("reads one exact fixed-tenant projection credential and re-reads rotation", async () => {
  const file = await fixture({ version: 1, entries: [entry()] })
  const source = new PlatformServiceCredentialSource(file, "projection")
  assert.equal(await source.get(TENANT), entry().secret)
  const rotated = "bff-projection-rotated-0000000000"
  await writeFile(file, JSON.stringify({ version: 1, entries: [entry(rotated)] }))
  assert.equal(await source.get(TENANT), rotated)
})
test("rejects insecure, duplicate, broad and wrong-tenant profiles", async () => {
  const file = await fixture({ version: 1, entries: [entry()] }, 0o644)
  const source = new PlatformServiceCredentialSource(file, "projection")
  await assert.rejects(source.get(TENANT), /insecure/u)
  await chmod(file, 0o600)
  for (const contents of [
    { version: 1, entries: [entry(), { ...entry(), credential_id: "other" }] },
    { version: 1, entries: [{ ...entry(), surfaces: ["projection", "catalog"] }] },
    { version: 1, entries: [{ ...entry(), tenant_id: "123e4567-e89b-42d3-a456-426614174001" }] },
    { version: 1, entries: [{ ...entry(), credential_id: 42 }] },
  ]) {
    await writeFile(file, JSON.stringify(contents))
    await assert.rejects(source.get(TENANT), /invalid/u)
  }
  for (const tenant of ["", "tenant local", "tenant\nlocal", "t".repeat(256), "😀".repeat(128)]) {
    await writeFile(file, JSON.stringify({ version: 1, entries: [{ ...entry(), tenant_id: tenant }] }))
    await assert.rejects(source.get(tenant), /invalid/u)
  }
})
test("bounds credential reads even when the file exceeds the pre-read stat", async () => {
  const file = await fixture({ version: 1, entries: [entry()] })
  await writeFile(file, "x".repeat(65_537))
  await assert.rejects(new PlatformServiceCredentialSource(file, "projection").get(TENANT), /invalid/u)
})
test("rejects symlinks and preserves cancellation", async () => {
  const file = await fixture({ version: 1, entries: [entry()] })
  const link = `${file}.link`
  await symlink(file, link)
  await assert.rejects(new PlatformServiceCredentialSource(link, "projection").get(TENANT))
  const abort = new AbortController()
  abort.abort(new Error("caller_cancelled"))
  await assert.rejects(new PlatformServiceCredentialSource(file, "projection").get(TENANT, abort.signal), /caller_cancelled/u)
})
test("aborts a pending open and closes its late handle", async () => {
  let release
  let closed = 0
  const opening = new Promise((resolve) => {
    release = resolve
  })
  const source = new PlatformServiceCredentialSource("ignored", "projection", () => opening)
  const abort = new AbortController()
  const pending = source.get(TENANT, abort.signal)
  abort.abort(new Error("caller_cancelled"))
  await assert.rejects(pending, /caller_cancelled/u)
  release({ close: async () => void (closed += 1) })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(closed, 1)
})
test("deadline interrupts a pending read and closes without waiting", async () => {
  let closed = 0
  const source = new PlatformServiceCredentialSource("ignored", "projection", async () => ({
    stat: async () => ({ isFile: () => true, uid: process.getuid?.(), mode: 0o600, size: 1 }),
    read: async () => new Promise(() => undefined),
    close: async () => void (closed += 1),
  }))
  await assert.rejects(source.get(TENANT, undefined, performance.now() + 10), /deadline/u)
  assert.equal(closed, 1)
})
test("consumes a started I/O rejection when cancellation wins before handlers attach", async () => {
  const abort = new AbortController()
  const lateFailure = Promise.reject(new Error("late_stat_failure"))
  const source = new PlatformServiceCredentialSource("ignored", "projection", async () => ({
    stat: () => {
      abort.abort(new Error("caller_cancelled"))
      return lateFailure
    },
    close: async () => undefined,
  }))
  await assert.rejects(source.get(TENANT, abort.signal), /caller_cancelled/u)
  await new Promise((resolve) => setImmediate(resolve))
})
test("fails a valid credential read when closing the file fails", async () => {
  const raw = Buffer.from(JSON.stringify({ version: 1, entries: [entry()] }))
  let offset = 0
  const source = new PlatformServiceCredentialSource("ignored", "projection", async () => ({
    stat: async () => ({ isFile: () => true, uid: process.getuid?.(), mode: 0o600, size: raw.byteLength }),
    read: async (target, targetOffset, length) => {
      const bytesRead = Math.min(length, raw.byteLength - offset)
      raw.copy(target, targetOffset, offset, offset + bytesRead)
      offset += bytesRead
      return { bytesRead, buffer: target }
    },
    close: async () => {
      throw new Error("close_failed")
    },
  }))
  await assert.rejects(source.get(TENANT), /close_failed/u)
})

for (const purpose of ["projection", "mcp_personal", "mcp_admin"]) {
  test(`requires exact ${purpose} purpose, caller and current file without OAuth fallback`, async () => {
    const profile = { ...entry(), surfaces: [purpose] }
    const file = await fixture({ version: 1, entries: [profile] })
    const source = new PlatformServiceCredentialSource(file, purpose)
    assert.equal(await source.get(TENANT), profile.secret)
    for (const invalid of [
      { ...profile, caller: "kokoro-agent" },
      { ...profile, surfaces: [purpose, "catalog"] },
      { ...profile, surfaces: [purpose === "projection" ? "mcp_personal" : "projection"] },
    ]) {
      await writeFile(file, JSON.stringify({ version: 1, entries: [invalid] }))
      await assert.rejects(source.get(TENANT), /invalid/u)
    }
    await writeFile(file, JSON.stringify([{ tenantId: TENANT, clientId: "old", clientSecret: "old" }]))
    await assert.rejects(source.get(TENANT), /invalid/u)
    await writeFile(file, JSON.stringify({ version: 1, entries: [profile] }))
    assert.equal(await source.get(TENANT), profile.secret)
  })
}
test("canceling one concurrent caller leaves another independent read usable", async () => {
  const file = await fixture({ version: 1, entries: [entry()] })
  const source = new PlatformServiceCredentialSource(file, "projection")
  const abort = new AbortController()
  const first = source.get(TENANT, abort.signal)
  const rejected = assert.rejects(first, /caller_cancelled/u)
  const second = source.get(TENANT)
  abort.abort(new Error("caller_cancelled"))
  await rejected
  assert.equal(await second, entry().secret)
})
