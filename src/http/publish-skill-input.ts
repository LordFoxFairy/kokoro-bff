import { createHash } from "node:crypto"

export function publishSkillCommandId(tenant: string, user: string, skillId: string, key: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(["kokoro-bff", "v1", "skill.publish", tenant, user, skillId, key]))
    .digest("hex")
  return `bff.skill.publish.v1.${digest}`
}
