import type {
  InspectPersonalSkillInstallationPackageResponse,
  InspectSkillPackageResponse,
  InspectPersonalSkillPackageResponse,
} from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"

const UINT64_MAX = 18_446_744_073_709_551_615n
const SOURCE_REF = /^skill:[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u

export type SkillPackageInspectionData = Readonly<{
  source_ref: string
  revision: string
  files: ReadonlyArray<Readonly<{ path: string; size_bytes: string }>>
  selected_file: Readonly<{ path: string; text: string }> | null
}>

export class SkillPackageInspectionResponseError extends Error {
  constructor() {
    super("skill_package_response_invalid")
  }
}

export function validSkillPackagePath(path: string): boolean {
  if (path.length === 0 || path.startsWith("\uFEFF") || path.includes("\0") || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/u.test(path))
    return false
  if (path !== path.normalize("NFC") || Buffer.byteLength(path, "utf8") > 256) return false
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
}

function validUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false
  }
  return true
}

export function projectSkillPackageInspectionResponse(
  value: InspectPersonalSkillPackageResponse | InspectPersonalSkillInstallationPackageResponse | InspectSkillPackageResponse,
  expected: Readonly<{ sourceRef?: string; selectedFilePath?: string }>,
): SkillPackageInspectionData {
  const sourceRef = value.sourceRef?.value ?? ""
  if (!SOURCE_REF.test(sourceRef) || (expected.sourceRef !== undefined && sourceRef !== expected.sourceRef)) throw new SkillPackageInspectionResponseError()
  if (value.revision < 1n || value.revision > UINT64_MAX || value.files.length > 128) throw new SkillPackageInspectionResponseError()

  const seen = new Set<string>()
  const files: Array<{ path: string; size_bytes: string }> = []
  let previous: string | undefined
  for (const file of value.files) {
    if (!validSkillPackagePath(file.path) || seen.has(file.path) || file.sizeBytes < 0n || file.sizeBytes > UINT64_MAX)
      throw new SkillPackageInspectionResponseError()
    if (previous !== undefined && previous >= file.path) throw new SkillPackageInspectionResponseError()
    previous = file.path
    seen.add(file.path)
    files.push({ path: file.path, size_bytes: file.sizeBytes.toString(10) })
  }

  if (expected.selectedFilePath === undefined) {
    if (value.selectedFile !== undefined) throw new SkillPackageInspectionResponseError()
    return { source_ref: sourceRef, revision: value.revision.toString(10), files, selected_file: null }
  }

  const selected = value.selectedFile
  if (selected === undefined || selected.path !== expected.selectedFilePath || !validSkillPackagePath(selected.path) || !validUnicode(selected.text))
    throw new SkillPackageInspectionResponseError()
  const listed = value.files.find((file) => file.path === selected.path)
  if (listed === undefined || BigInt(Buffer.byteLength(selected.text, "utf8")) !== listed.sizeBytes) throw new SkillPackageInspectionResponseError()
  return {
    source_ref: sourceRef,
    revision: value.revision.toString(10),
    files,
    selected_file: { path: selected.path, text: selected.text },
  }
}
