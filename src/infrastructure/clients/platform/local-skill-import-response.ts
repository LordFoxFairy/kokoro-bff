import type {
  BeginLocalSkillImportResponse,
  CompleteLocalSkillImportResponse,
  FinalizeLocalSkillImportResponse,
  GetLocalSkillImportResponse,
  PackageTransferReference,
  SkillImportUploadProof,
} from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { SkillImportPhase, SkillPackageScanState } from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { assertSkillWireKnown, projectSkillProductRecord, skillTimestamp } from "./skill-product-response.js"
import { projectInstallation } from "./skill-installation-response.js"
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u,
  SHA = /^[a-f0-9]{64}$/u,
  U64 = 18_446_744_073_709_551_615n
const id = (v: { value: string } | undefined) => {
  if (!v || !ID.test(v.value)) throw new Error("local_skill_import_response_invalid")
  return v.value
}
const phases: Partial<Record<SkillImportPhase, string>> = {
  [SkillImportPhase.UPLOAD_PENDING]: "upload_pending",
  [SkillImportPhase.UPLOADED]: "uploaded",
  [SkillImportPhase.COMPLETED]: "completed",
  [SkillImportPhase.REJECTED]: "rejected",
  [SkillImportPhase.EXPIRED]: "expired",
}
const phase = (v: SkillImportPhase) => {
  const p = phases[v]
  if (!p) throw new Error("local_skill_import_response_invalid")
  return p
}
function transfer(v: PackageTransferReference | undefined, origin: string) {
  if (!v || v.method !== "PUT" || !v.expiresAt) throw new Error("local_skill_import_response_invalid")
  assertSkillWireKnown(v)
  const u = new URL(v.url)
  if (u.origin !== origin || !["http:", "https:"].includes(u.protocol) || u.username || u.password || u.hash)
    throw new Error("local_skill_import_response_invalid")
  const expires = skillTimestamp(v.expiresAt)
  if (Date.parse(expires) <= Date.now() || Date.parse(expires) > Date.now() + 900_000) throw new Error("local_skill_import_response_invalid")
  for (const [k, x] of Object.entries(v.requiredHeaders))
    if (!/^[a-z0-9-]+$/u.test(k) || !x || /[\r\n]/u.test(x)) throw new Error("local_skill_import_response_invalid")
  return { url: v.url, method: "PUT", required_headers: v.requiredHeaders, expires_at: expires }
}
function proof(v: SkillImportUploadProof | undefined) {
  if (
    !v ||
    !ID.test(v.uploadId) ||
    !ID.test(v.assetId) ||
    !v.sourceVersionId ||
    v.sourceVersionId.length > 1024 ||
    !SHA.test(v.contentSha256) ||
    v.sizeBytes < 1n ||
    v.sizeBytes > U64
  )
    throw new Error("local_skill_import_response_invalid")
  return {
    upload_id: v.uploadId,
    asset_id: v.assetId,
    source_version_id: v.sourceVersionId,
    content_sha256: v.contentSha256,
    size_bytes: v.sizeBytes.toString(),
  }
}
export function projectLocalImportBegin(v: BeginLocalSkillImportResponse, origin: string) {
  assertSkillWireKnown(v)
  if (v.phase !== SkillImportPhase.UPLOAD_PENDING || !ID.test(v.uploadId)) throw new Error("local_skill_import_response_invalid")
  return {
    intent_id: id(v.intentId),
    skill_id: id(v.skillId),
    phase: phase(v.phase),
    upload_id: v.uploadId,
    transfer_reference: transfer(v.transferReference, origin),
    expires_at: skillTimestamp(v.expiresAt),
    replayed: v.replayed,
  }
}
export function projectLocalImportComplete(
  v: CompleteLocalSkillImportResponse,
  expected: { intentId: string; uploadId: string; sourceVersionId: string; sizeBytes: bigint; contentSha256: string },
) {
  assertSkillWireKnown(v)
  if (v.phase !== SkillImportPhase.UPLOADED || id(v.intentId) !== expected.intentId) throw new Error("local_skill_import_response_invalid")
  const scans: Partial<Record<SkillPackageScanState, string>> = {
    [SkillPackageScanState.PENDING]: "pending",
    [SkillPackageScanState.CLEAN]: "clean",
    [SkillPackageScanState.INFECTED]: "infected",
    [SkillPackageScanState.UNKNOWN]: "unknown",
  }
  const scan = scans[v.scanState]
  if (!scan) throw new Error("local_skill_import_response_invalid")
  const uploadProof = proof(v.uploadProof)
  if (
    uploadProof.upload_id !== expected.uploadId ||
    uploadProof.source_version_id !== expected.sourceVersionId ||
    uploadProof.size_bytes !== expected.sizeBytes.toString() ||
    uploadProof.content_sha256 !== expected.contentSha256
  )
    throw new Error("local_skill_import_response_invalid")
  return {
    intent_id: expected.intentId,
    skill_id: id(v.skillId),
    phase: phase(v.phase),
    upload_proof: uploadProof,
    scan_state: scan,
    expires_at: skillTimestamp(v.expiresAt),
    replayed: v.replayed,
  }
}
export function projectLocalImportFinalize(v: FinalizeLocalSkillImportResponse, expectedIntentId: string) {
  assertSkillWireKnown(v)
  if (v.phase !== SkillImportPhase.COMPLETED || id(v.intentId) !== expectedIntentId) throw new Error("local_skill_import_response_invalid")
  const skill = projectSkillProductRecord(v.skill)
  const installation = projectInstallation(v.installation)
  if (skill.source_ref !== installation.source_ref || skill.series_id !== installation.series_id || skill.revision !== installation.revision)
    throw new Error("local_skill_import_response_invalid")
  return {
    intent_id: expectedIntentId,
    phase: phase(v.phase),
    skill,
    installation,
    replayed: v.replayed,
  }
}
export function projectLocalImportGet(v: GetLocalSkillImportResponse, expectedIntentId: string) {
  assertSkillWireKnown(v)
  const p = phase(v.phase),
    actualIntentId = id(v.intentId),
    out: Record<string, unknown> = { intent_id: actualIntentId, skill_id: id(v.skillId), phase: p, expires_at: skillTimestamp(v.expiresAt) }
  if (actualIntentId !== expectedIntentId) throw new Error("local_skill_import_response_invalid")
  if (v.uploadProof) out.upload_proof = proof(v.uploadProof)
  if (v.rejectionCode !== undefined) {
    if (!ID.test(v.rejectionCode)) throw new Error("local_skill_import_response_invalid")
    out.rejection_code = v.rejectionCode
  }
  const skill = v.skill ? projectSkillProductRecord(v.skill) : undefined
  const installation = v.installation ? projectInstallation(v.installation) : undefined
  if (
    skill &&
    (skill.series_id !== id(v.skillId) ||
      (installation !== undefined &&
        (skill.source_ref !== installation.source_ref || skill.series_id !== installation.series_id || skill.revision !== installation.revision)))
  )
    throw new Error("local_skill_import_response_invalid")
  if (skill) out.skill = skill
  if (installation) out.installation = installation
  if (
    (p === "completed" ? !v.skill : !!v.skill || !!v.installation) ||
    (p === "rejected") !== (v.rejectionCode !== undefined) ||
    (p === "upload_pending" && !!v.uploadProof) ||
    (["uploaded", "completed", "rejected"].includes(p) && !v.uploadProof)
  )
    throw new Error("local_skill_import_response_invalid")
  return out
}
