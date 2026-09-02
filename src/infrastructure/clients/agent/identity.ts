import type { AgentIdentityHeaders, BffIdentity } from "./types.js"

export function agentIdentityHeaders(identity: BffIdentity, assertionRef: string): AgentIdentityHeaders {
  return {
    "x-kokoro-tenant-ref": identity.namespace,
    "x-kokoro-subject-ref": identity.userId,
    "x-kokoro-actor-ref": identity.userId,
    "x-kokoro-subject-kind": "user",
    "x-kokoro-actor-kind": "user",
    "x-kokoro-identity-assertion-ref": assertionRef,
  }
}

