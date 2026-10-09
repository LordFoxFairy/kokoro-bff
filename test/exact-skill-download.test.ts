import assert from "node:assert/strict"
import test from "node:test"
import { Code, ConnectError } from "@connectrpc/connect"
import {
  ExactSkillDownloadService,
  exactInstallationRecord,
  exactManagedRecord,
  type ExactSkillDownloadRecord,
} from "../src/application/exact-skill-download.js"
import { SkillDownloadHandles } from "../src/application/skill-download-handles.js"

const context = { requestId: "request", identity: { namespace: "tenant", userId: "human" }, humanBearer: "bearer" }
const signal = new AbortController().signal
const deadline = performance.now() + 10_000
const fact = (sourceRef: string, revision: string) => ({
  sourceRef,
  revision,
  filename: "skill.zip",
  sizeBytes: 3n,
  contentSha256: "a".repeat(64),
  transfer: { url: "http://objects.test/blob", method: "GET", requiredHeaders: {}, expiresAt: new Date(Date.now() + 60_000).toISOString() },
})

test("fresh installation and managed projections must match their exact requested IDs and source", () => {
  assert.deepEqual(exactInstallationRecord("install-1", { installation_id: "install-1", source_ref: "skill:old", revision: "1", installed: true }), {
    sourceRef: "skill:old",
    revision: "1",
  })
  assert.equal(exactInstallationRecord("install-1", { installation_id: "install-1", source_ref: "skill:old", revision: "1", installed: false }), null)
  assert.throws(
    () => exactInstallationRecord("install-1", { installation_id: "other", source_ref: "skill:old", revision: "1", installed: true }),
    /skill_installation_response_invalid/u,
  )
  assert.deepEqual(exactManagedRecord("version-1", { skill_id: "version-1", source_ref: "skill:version-1", revision: "4", status: "active" }), {
    sourceRef: "skill:version-1",
    revision: "4",
  })
  assert.equal(exactManagedRecord("version-1", { skill_id: "version-1", source_ref: "skill:version-1", revision: "4", status: "withdrawn" }), null)
  assert.throws(
    () => exactManagedRecord("version-1", { skill_id: "other", source_ref: "skill:other", revision: "4", status: "active" }),
    /skill_response_invalid/u,
  )
  assert.throws(
    () => exactManagedRecord("version-1", { skill_id: "version-1", source_ref: "skill:other", revision: "4", status: "active" }),
    /skill_response_invalid/u,
  )
})

test("old installation and new catalog current remain distinct exact bindings", async () => {
  let downloads = 0
  const service = new ExactSkillDownloadService({
    handles: new SkillDownloadHandles(),
    objectOrigin: "http://objects.test",
    installation: async () => ({ sourceRef: "skill:old", revision: "1" }),
    managed: async () => null,
    share: async () => null,
    download: async (sourceRef) => {
      downloads++
      return fact(sourceRef, sourceRef === "skill:old" ? "1" : "2")
    },
  })
  const entry = await service.prepare({ kind: "installation", installationId: "install-1" }, context, signal, deadline)
  assert.equal(entry.binding.sourceRef, "skill:old")
  assert.deepEqual(entry.binding.qualifier, { kind: "installation", installationId: "install-1" })
  await service.confirm(entry.binding, context, signal, deadline)
  assert.equal(downloads, 2)
})

test("removed installation, inactive managed version and revoked share do no download work", async () => {
  let downloads = 0
  const service = new ExactSkillDownloadService({
    handles: new SkillDownloadHandles(),
    objectOrigin: "http://objects.test",
    installation: async () => null,
    managed: async () => null,
    share: async () => null,
    download: async () => {
      downloads++
      return fact("skill:bad", "1")
    },
  })
  for (const qualifier of [
    { kind: "installation", installationId: "removed" } as const,
    { kind: "managed", versionId: "inactive" } as const,
    { kind: "share", shareId: "revoked" } as const,
  ])
    await assert.rejects(service.prepare(qualifier, context, signal, deadline), (error) => error instanceof ConnectError && error.code === Code.NotFound)
  assert.equal(downloads, 0)
})

test("handle confirmation binds the preparing subject and exact owner hash", async () => {
  let changed = false
  const service = new ExactSkillDownloadService({
    handles: new SkillDownloadHandles(),
    objectOrigin: "http://objects.test",
    installation: async () => null,
    managed: async () => null,
    share: async () => ({ sourceRef: "skill:shared", revision: "7" }),
    download: async () => ({ ...fact("skill:shared", "7"), contentSha256: (changed ? "b" : "a").repeat(64) }),
  })
  const entry = await service.prepare({ kind: "share", shareId: "share-1" }, context, signal, deadline)
  await assert.rejects(
    service.confirm(entry.binding, { ...context, identity: { namespace: "tenant", userId: "other" } }, signal, deadline),
    (error) => error instanceof ConnectError && error.code === Code.PermissionDenied,
  )
  await assert.rejects(
    service.confirm(entry.binding, { ...context, identity: { namespace: "other", userId: "human" } }, signal, deadline),
    (error) => error instanceof ConnectError && error.code === Code.PermissionDenied,
  )
  changed = true
  await assert.rejects(service.confirm(entry.binding, context, signal, deadline), (error) => error instanceof ConnectError && error.code === Code.NotFound)
})

test("historic managed version remains exact and cancellation fences a late record before download", async () => {
  let downloads = 0
  const controller = new AbortController()
  let release!: (value: ExactSkillDownloadRecord) => void
  const late = new Promise<ExactSkillDownloadRecord>((resolve) => {
    release = resolve
  })
  const service = new ExactSkillDownloadService({
    handles: new SkillDownloadHandles(),
    objectOrigin: "http://objects.test",
    installation: async () => null,
    managed: async () => late,
    share: async () => null,
    download: async (sourceRef) => {
      downloads++
      return fact(sourceRef, "3")
    },
  })
  const pending = service.prepare({ kind: "managed", versionId: "historic-version" }, context, controller.signal, performance.now() + 10_000)
  controller.abort(new Error("cancelled"))
  release({ sourceRef: "skill:historic-version", revision: "3" })
  await assert.rejects(pending, /cancelled/u)
  assert.equal(downloads, 0)
})
