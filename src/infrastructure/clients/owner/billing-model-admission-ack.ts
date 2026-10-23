import { isDeepStrictEqual } from "node:util"
import type { AdmissionCreateRequest, AdmissionResponse } from "../../../generated/billing-http/types.gen.js"
import { zAdmissionResponse } from "../../../generated/billing-http/zod.gen.js"

/** Both reserve and recover return the original creation ACK, not today's admission head. */
export function originalModelAdmissionAck(body: AdmissionCreateRequest, value: unknown): AdmissionResponse | null {
  const parsed = zAdmissionResponse.safeParse(value)
  if (!parsed.success || !isDeepStrictEqual(parsed.data, value)) return null
  const data = parsed.data.data
  if (
    Object.entries(body).some(([key, fact]) => data[key as keyof typeof data] !== fact) ||
    data.status !== "held" ||
    data.created_at !== data.updated_at ||
    new Date(data.created_at).toISOString() !== data.created_at
  )
    return null
  return parsed.data
}
