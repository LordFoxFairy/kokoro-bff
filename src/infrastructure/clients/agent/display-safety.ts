import type { zSkillDisplay } from "../../../generated/agent-http/zod.gen.js"
import { AGENT_PROCESS_CONSTRAINTS } from "../../../generated/agent-http/process-profile.gen.js"
const sourceRefPattern = new RegExp(AGENT_PROCESS_CONSTRAINTS.display.skill.properties.source_ref.pattern, "u")
const revisionPattern = new RegExp(AGENT_PROCESS_CONSTRAINTS.display.skill.properties.revision.pattern, "u")
const forbidden = /[\p{Cc}\p{Cf}\p{Cs}]/u
const sensitive =
  /(?:^|[._ /-])(?:credentials?|secrets?|tokens?|passwords?|private[_-]?key)(?:$|[._ /-])|(?:^|\/)\.(?:ssh|aws|gnupg|kube)(?:\/|$)|(?:^|\/)\.env(?:[./_-]|$)|(?:^|\/)(?:\.netrc|\.npmrc|\.git-credentials|service[_-]account\.json)(?:$|\/)|(?:id_rsa|id_ed25519|\.pem$|\.p12$|\.pfx$|bearer\s|sk[-_]|gh[pousr]_|github_pat_|AKIA[A-Z0-9]{16}|-----BEGIN)|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/iu
/** Consumer-side semantic checks mirror the formal owner's published safe virtual-path domain. */
export function safeVirtualPath(value: string): boolean {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\:?#%]/u.test(value) ||
    forbidden.test(value) ||
    sensitive.test(value) ||
    value.normalize("NFC") !== value ||
    Buffer.byteLength(value) > AGENT_PROCESS_CONSTRAINTS.display.virtualPath["x-kokoro-utf8-byte-limit"]
  )
    return false
  const parts = value.slice(1).split("/")
  return (
    !parts.some((part) => !part || part === "." || part === ".." || part.startsWith("~")) &&
    !new Set(["users", "home", "private", "etc", "proc", "sys", "var"]).has(parts[0]!.toLowerCase())
  )
}
export function safeSkillDisplays(value: readonly ReturnType<typeof zSkillDisplay.parse>[], sourceRefs?: readonly string[]): boolean {
  if (new Set(value.map((item) => item.source_ref)).size !== value.length) return false
  return value.every((item) => {
    const name = AGENT_PROCESS_CONSTRAINTS.display.skill.properties.name
    return (
      sourceRefPattern.test(item.source_ref) &&
      (sourceRefs === undefined || sourceRefs.includes(item.source_ref)) &&
      item.name.trim() !== "" &&
      !forbidden.test(item.name) &&
      !sensitive.test(item.name) &&
      item.name.normalize("NFC") === item.name &&
      [...item.name].length <= name.maxLength &&
      Buffer.byteLength(item.name) <= name["x-kokoro-utf8-byte-limit"] &&
      safeVirtualPath(item.virtual_path) &&
      item.virtual_path === `/.skills/${Buffer.from(item.source_ref.slice(6), "ascii").toString("base64url")}/SKILL.md` &&
      (item.revision === undefined || (revisionPattern.test(item.revision) && BigInt(item.revision) <= 9223372036854775807n))
    )
  })
}
