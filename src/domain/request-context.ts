/** Transport-neutral identity and request metadata passed through BFF use cases. */
export type RequestContext = {
  requestId: string
  identity: { namespace: string; userId: string }
}
