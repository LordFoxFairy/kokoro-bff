import type { RequestContext } from "../../../domain/request-context.js"

export function ownerIdentityHeaders(context: RequestContext): Record<string, string> {
  return {
    "x-kokoro-tenant-id": context.identity.namespace,
    "x-kokoro-subject": context.identity.userId,
    "x-kokoro-actor-id": context.identity.userId,
  }
}
