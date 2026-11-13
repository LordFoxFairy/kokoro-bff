import { isRecord } from "../json.js"

export type ProjectGrantRole = "viewer" | "editor"
export type ProjectCapability = "read" | "edit" | "manage"
export type ProjectAccess = Readonly<{
  project_id: string
  role: "owner" | ProjectGrantRole
  expires_at: string | null
  access_version: string
  capabilities: readonly ProjectCapability[]
}>
export type ProjectAccessParent = Readonly<{
  projectId: string
  tenantId: string
  ownerId: string
  accessVersion: string
  deleted: boolean
}>
export type ProjectAccessActor = Readonly<{
  tenantId: string
  subjectId: string
}>
export type ProjectGrant = Readonly<{
  tenantId: string
  projectId: string
  subjectId: string
  role: ProjectGrantRole
  expiresAt: string | null
  revokedAt: string | null
}>
export type ProjectGrantBody = Readonly<{
  role: ProjectGrantRole
  expires_at: string | null
}>

const maxAccessVersion = 9_223_372_036_854_775_807n
export function validProjectAccessVersion(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,18}$/u.test(value) && BigInt(value) <= maxAccessVersion
}
export function parseProjectAccessVersion(value: unknown): string | null {
  if (typeof value !== "string" || !/^"[1-9][0-9]{0,18}"$/u.test(value)) return null
  const version = value.slice(1, -1)
  return validProjectAccessVersion(version) && BigInt(version) < maxAccessVersion ? version : null
}
export function parseProjectGrantBody(value: unknown, now: number | null): ProjectGrantBody | null {
  if (!isRecord(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, "expires_at") || (value.role !== "viewer" && value.role !== "editor"))
    return null
  const expiresAt = value.expires_at
  if (
    expiresAt !== null &&
    (typeof expiresAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(expiresAt) ||
      !Number.isFinite(Date.parse(expiresAt)) ||
      new Date(expiresAt).toISOString().slice(0, 19) !== expiresAt.slice(0, 19) ||
      (now !== null && Date.parse(expiresAt) <= now))
  )
    return null
  return { role: value.role, expires_at: expiresAt }
}

/** Evaluate stable-subject grants only after current native Product admission; no membership mirror. */
export function projectAccess(parent: ProjectAccessParent, actor: ProjectAccessActor, grant: ProjectGrant | null, now: number): ProjectAccess | null {
  if (parent.deleted || actor.tenantId !== parent.tenantId || !actor.subjectId || !Number.isFinite(now) || !validProjectAccessVersion(parent.accessVersion))
    return null
  if (parent.ownerId === actor.subjectId)
    return {
      project_id: parent.projectId,
      role: "owner",
      expires_at: null,
      access_version: parent.accessVersion,
      capabilities: ["read", "edit", "manage"],
    }
  if (
    !grant ||
    grant.tenantId !== parent.tenantId ||
    grant.projectId !== parent.projectId ||
    grant.subjectId !== actor.subjectId ||
    grant.revokedAt !== null ||
    (grant.role !== "viewer" && grant.role !== "editor") ||
    (grant.expiresAt !== null && (!Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= now))
  )
    return null
  return {
    project_id: parent.projectId,
    role: grant.role,
    expires_at: grant.expiresAt,
    access_version: parent.accessVersion,
    capabilities: grant.role === "editor" ? ["read", "edit"] : ["read"],
  }
}
