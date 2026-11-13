import { readCurrentConversation } from "../src/infrastructure/postgres/chat-conversation-access.js"
import assert from "node:assert/strict"
import { test } from "node:test"
import { parseProjectGrantBody, parseProjectAccessVersion, projectAccess } from "../src/domain/project/access.js"

const now = Date.parse("2026-11-13T00:00:00.000Z")
const parent = {
  projectId: "project_fixture",
  tenantId: "tenant",
  ownerId: "owner",
  accessVersion: "5",
  deleted: false,
}
const actor = { tenantId: "tenant", subjectId: "recipient" }
const grant = {
  tenantId: "tenant",
  projectId: parent.projectId,
  subjectId: actor.subjectId,
  role: "viewer" as const,
  expiresAt: null,
  revokedAt: null,
}

test("Project access is a currently admitted stable subject and exact grant, never a same-tenant or copied-URL privilege", () => {
  assert.equal(projectAccess(parent, actor, null, now), null)
  assert.equal(projectAccess(parent, { ...actor, tenantId: "other" }, grant, now), null)
  assert.equal(projectAccess({ ...parent, deleted: true }, actor, grant, now), null)
  assert.equal(projectAccess(parent, actor, { ...grant, subjectId: "other" }, now), null)
  assert.equal(projectAccess(parent, actor, { ...grant, projectId: "other" }, now), null)
  assert.equal(projectAccess(parent, actor, { ...grant, tenantId: "other" }, now), null)
})

test("viewer reads, editor edits, and only the actual Project owner manages grants and deletion", () => {
  assert.deepEqual(projectAccess(parent, actor, grant, now), {
    project_id: parent.projectId,
    role: "viewer",
    expires_at: null,
    access_version: "5",
    capabilities: ["read"],
  })
  assert.deepEqual(projectAccess(parent, actor, { ...grant, role: "editor" }, now)?.capabilities, ["read", "edit"])
  assert.deepEqual(projectAccess(parent, { ...actor, subjectId: "owner" }, null, now)?.capabilities, ["read", "edit", "manage"])
})

test("expiry and revocation are evaluated at the read boundary, without GET-side mutation or implicit renewal", () => {
  assert.equal(projectAccess(parent, actor, { ...grant, expiresAt: new Date(now).toISOString() }, now), null)
  assert.equal(projectAccess(parent, actor, { ...grant, expiresAt: new Date(now - 1).toISOString() }, now), null)
  assert.equal(projectAccess(parent, actor, { ...grant, expiresAt: "invalid" }, now), null)
  assert.equal(projectAccess(parent, actor, { ...grant, revokedAt: new Date(now).toISOString() }, now), null)
  assert.equal(projectAccess(parent, actor, { ...grant, expiresAt: new Date(now + 1).toISOString() }, now)?.role, "viewer")
})

test("grant input is closed, explicit-null expiry is distinct from omission, and owner cannot be granted", () => {
  assert.deepEqual(parseProjectGrantBody({ role: "editor", expires_at: null }, now), { role: "editor", expires_at: null })
  const expiry = new Date(now + 60_000).toISOString()
  assert.deepEqual(parseProjectGrantBody({ role: "viewer", expires_at: expiry }, now), { role: "viewer", expires_at: expiry })
  for (const body of [
    null,
    [],
    {},
    { role: "viewer" },
    { role: "owner", expires_at: null },
    { role: "viewer", expires_at: "yesterday" },
    { role: "viewer", expires_at: "2028-02-30T00:00:00Z" },
    { role: "viewer", expires_at: new Date(now).toISOString() },
    { role: "viewer", expires_at: null, tenant_id: "forged" },
    { role: "viewer", expires_at: null, member_id: "forged" },
  ])
    assert.equal(parseProjectGrantBody(body, now), null)
})

test("Project access CAS accepts one exact positive quoted int64 and rejects weak, duplicate and overflowing tags", () => {
  assert.equal(parseProjectAccessVersion('"1"'), "1")
  assert.equal(parseProjectAccessVersion('"9223372036854775806"'), "9223372036854775806")
  for (const value of [undefined, ['"1"'], "*", 'W/"1"', '"1","2"', "1", '"01"', '"0"', '"9223372036854775807"'])
    assert.equal(parseProjectAccessVersion(value), null)
})

test("Project Conversation read keeps creator, reader and Project owner distinct; a private direct Conversation never inherits grant", async () => {
  const row = {
    conversation_id: "conv_fixture",
    tenant_id: "tenant",
    owner_id: "creator",
    project_ref: "project_fixture",
    title: "Shared conversation",
    status: "active",
    created_at: new Date(now),
    updated_at: new Date(now),
    deleted_at: null,
    canonical_project_id: "project_fixture",
    project_owner_id: "project-owner",
    access_version: "5",
    grant_subject_id: "reader",
    grant_role: "viewer",
    grant_expires_at: null,
    grant_revoked_at: null,
    evaluated_at: new Date(now),
  }
  let selected: any = row
  const client = { query: async () => ({ rows: Array.isArray(selected) ? selected : [selected] }) } as never
  const read = () => readCurrentConversation(client, "tenant", "reader", "conv_fixture", "project_fixture", false)
  const shared = await read()
  assert.equal(shared?.projectAccess?.role, "viewer")
  assert.equal(shared?.conversation.owner_id, "creator")
  selected = { ...row, grant_expires_at: new Date(now) }
  assert.equal(await read(), null)
  selected = { ...row, grant_revoked_at: new Date(now) }
  assert.equal(await read(), null)
  selected = { ...row, project_ref: null, canonical_project_id: null }
  assert.equal(await read(), null)
  selected = [row, { ...row, canonical_project_id: "ambiguous" }]
  assert.equal(await read(), null)
  selected = { ...row, tenant_id: "other" }
  await assert.rejects(read, /BINDING_INVALID/)
})
