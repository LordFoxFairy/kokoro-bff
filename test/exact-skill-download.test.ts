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

for (const status of ["disabled", "withdrawn"]) {
  test(`personal publisher retains exact original ${status} package qualification`, () => {
    const row = { skill_id: "old-version", source_ref: "skill:old-version", revision: "4", status, product: { source_kind: "personal" } }
    assert.deepEqual(exactManagedRecord("old-version", row), { sourceRef: "skill:old-version", revision: "4" })
    for (const source_kind of [undefined, "official", "third_party"])
      assert.equal(exactManagedRecord("old-version", { ...row, product: { source_kind } }), null)
    for (const invalid of ["draft", "quarantined", "discarded"]) assert.equal(exactManagedRecord("old-version", { ...row, status: invalid }), null)
  })
}

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

test("historical publisher handle rechecks current managed eligibility before releasing bytes", async () => {
  let status = "withdrawn"
  let downloads = 0
  const service = new ExactSkillDownloadService({
    handles: new SkillDownloadHandles(),
    objectOrigin: "http://objects.test",
    installation: async () => null,
    managed: async (id) => exactManagedRecord(id, { skill_id: id, source_ref: `skill:${id}`, revision: "4", status, product: { source_kind: "personal" } }),
    share: async () => null,
    download: async (sourceRef) => {
      downloads++
      return fact(sourceRef, "4")
    },
  })
  const entry = await service.prepare({ kind: "managed", versionId: "old-version" }, context, signal, performance.now() + 10_000)
  assert.equal(entry.binding.sourceRef, "skill:old-version")
  await service.confirm(entry.binding, context, signal, performance.now() + 10_000)
  assert.equal(downloads, 2)
  status = "quarantined"
  await assert.rejects(
    service.confirm(entry.binding, context, signal, performance.now() + 10_000),
    (error) => error instanceof ConnectError && error.code === Code.NotFound,
  )
  assert.equal(downloads, 2)
})

test("Project handle selectors stay immutable and distinct from another Project and the same personal installation", () => {
  const handles = new SkillDownloadHandles(),
    expiresAt = Date.now() + 60_000
  const base = {
    tenantId: "tenant",
    subjectId: "human",
    sourceRef: "skill:old",
    revision: "1",
    filename: "skill.zip",
    sizeBytes: 3,
    contentSha256: "a".repeat(64),
    expiresAt,
    transfer: { url: "http://objects.test/blob", method: "GET", requiredHeaders: {}, expiresAt },
  }
  const qualifier = { kind: "project_installation" as const, projectId: "project-a", installationId: "install-1" }
  const entry = handles.issue({ ...base, qualifier })
  assert.deepEqual(entry.binding.qualifier, { kind: "project_installation", projectId: "project-a", installationId: "install-1" })
  assert.equal(handles.issue({ ...base, qualifier }).handle, entry.handle)
  const otherProject = handles.issue({ ...base, qualifier: { ...qualifier, projectId: "project-b" } })
  const personal = handles.issue({ ...base, qualifier: { kind: "installation", installationId: "install-1" } })
  assert.notEqual(entry.handle, otherProject.handle)
  assert.notEqual(entry.handle, personal.handle)
  qualifier.projectId = "project-b"
  assert.deepEqual(handles.resolve(entry.handle, "tenant", "human").binding.qualifier, {
    kind: "project_installation",
    projectId: "project-a",
    installationId: "install-1",
  })
  assert.ok(Object.isFrozen(entry.binding.qualifier))
  assert.throws(() => handles.resolve(entry.handle, "another-tenant", "human"), /skill_download_forbidden/u)
  assert.throws(() => handles.resolve(entry.handle, "tenant", "another-human"), /skill_download_forbidden/u)
})

test("Project handles require both exact resource selectors and never accept personal or surplus qualifiers", () => {
  const handles = new SkillDownloadHandles(),
    expiresAt = Date.now() + 60_000
  const canonical = { kind: "project_installation" as const, projectId: "project-a", installationId: "install-1" }
  const base = {
    tenantId: "tenant",
    subjectId: "human",
    sourceRef: "skill:old",
    revision: "1",
    filename: "skill.zip",
    sizeBytes: 3,
    contentSha256: "a".repeat(64),
    expiresAt,
    transfer: { url: "http://objects.test/blob", method: "GET", requiredHeaders: {}, expiresAt },
  }
  // This is structural binding validation, not an owner grant or Project admission.
  assert.doesNotThrow(() => handles.issue({ ...base, qualifier: canonical }))
  for (const qualifier of [
    { kind: "project_installation", installationId: "install-1" },
    { kind: "project_installation", projectId: "project-a" },
    { kind: "project_installation", installationId: "install-1", subjectId: "self-reported" },
    { kind: "project_installation", projectId: "project-a", sourceRef: "skill:other" },
    { ...canonical, projectId: 42 },
    { ...canonical, installationId: true },
    { ...canonical, projectId: "" },
    { ...canonical, projectId: "project/a" },
    { ...canonical, installationId: "" },
    { ...canonical, installationId: "../install" },
    { ...canonical, subjectId: "self-reported" },
    { ...canonical, sourceRef: "skill:other" },
    { ...canonical, kind: "installation" },
    { ...canonical, kind: "managed" },
  ])
    assert.throws(() => handles.issue({ ...base, qualifier: qualifier as typeof canonical }), /skill_response_invalid/u)
  for (const qualifier of [
    { kind: "catalog_current", seriesId: "series-1" },
    { kind: "installation", installationId: "install-1" },
    { kind: "managed", versionId: "version-1" },
    { kind: "share", shareId: "share-1" },
  ] as const)
    assert.doesNotThrow(() => handles.issue({ ...base, qualifier }))
})

test("unwired Project handles cannot fall through an existing personal, managed, share or generic grant resolver", async () => {
  const handles = new SkillDownloadHandles(),
    expiresAt = Date.now() + 60_000
  const entry = handles.issue({
    tenantId: "tenant",
    subjectId: "human",
    qualifier: { kind: "project_installation", projectId: "project-a", installationId: "install-1" },
    sourceRef: "skill:old",
    revision: "1",
    filename: "skill.zip",
    sizeBytes: 3,
    contentSha256: "a".repeat(64),
    expiresAt,
    transfer: { url: "http://objects.test/blob", method: "GET", requiredHeaders: {}, expiresAt },
  })
  let lookups = 0,
    downloads = 0
  const service = new ExactSkillDownloadService({
    handles,
    objectOrigin: "http://objects.test",
    installation: async () => {
      lookups++
      return null
    },
    managed: async () => {
      lookups++
      return null
    },
    share: async () => {
      lookups++
      return null
    },
    download: async (sourceRef) => {
      downloads++
      return fact(sourceRef, "1")
    },
  })
  await assert.rejects(
    service.confirm(entry.binding, context, signal, performance.now() + 10_000),
    (error) => error instanceof ConnectError && error.code === Code.PermissionDenied,
  )
  assert.equal(lookups, 0)
  assert.equal(downloads, 0)
})
