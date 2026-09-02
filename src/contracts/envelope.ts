/** Shared v1 response envelope. */
export type RequestMeta = { request_id: string }

export type BffEnvelope<T> = {
  data: T
  meta: RequestMeta
}

export type BffErrorBody = {
  error: {
    code: string
    message: string
  }
  meta: RequestMeta
}

export function ok<T>(data: T, requestId: string): BffEnvelope<T> {
  return { data, meta: { request_id: requestId } }
}

export function failure(code: string, message: string, requestId: string): BffErrorBody {
  return { error: { code, message }, meta: { request_id: requestId } }
}
