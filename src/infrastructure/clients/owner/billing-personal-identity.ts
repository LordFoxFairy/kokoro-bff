import type { RequestContext } from "../../../domain/request-context.js"

type PersonalIdentity = Readonly<{ tenant: string; subject: string }>

function u1(value: string, maxCodePoints: number): string | null {
  if (value.length === 0 || value.includes("\u0000")) return null
  let codePoints = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(index + 1)
      if (!Number.isInteger(low) || low < 0xdc00 || low > 0xdfff) return null
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return null
    codePoints += 1
    if (codePoints > maxCodePoints) return null
  }
  return `u1.${Buffer.from(value, "utf8").toString("base64url")}`
}

export function billingPersonalIdentity(context: RequestContext): PersonalIdentity | null {
  const tenant = u1(context.identity.namespace, 191)
  const subject = u1(context.identity.userId, 255)
  return tenant === null || subject === null ? null : { tenant, subject }
}
