/** Transport-neutral identity and request metadata passed through BFF use cases. */
export type RequestContext = {
  requestId: string
  identity: { namespace: string; userId: string }
}

/** Current IAM admission projection; not available to service-only callers. */
export type AdmittedUserRequestContext = RequestContext & {
  platformAdmin: boolean
}
