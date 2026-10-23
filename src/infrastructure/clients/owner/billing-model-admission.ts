import { isDeepStrictEqual } from "node:util"
import type { BffConfig } from "../../../config/runtime.js"
import type { RequestContext } from "../../../domain/request-context.js"
import { createClient } from "../../../generated/billing-http/client/client.gen.js"
import { createAdmission } from "../../../generated/billing-http/sdk.gen.js"
import type { AdmissionCreateRequest, AdmissionResponse } from "../../../generated/billing-http/types.gen.js"
import { zAdmissionResponse } from "../../../generated/billing-http/zod.gen.js"
import { billingModelTransport, billingModelDenial } from "./billing-model-transport.js"
import { billingPersonalIdentity } from "./billing-personal-read.js"

type Failure = Readonly<{ ok: false; status: 400 | 403 | 404 | 409 | 422 | 502 | 503; code: string }>
export type BillingModelAdmissionResult = Readonly<{ ok: true; data: AdmissionResponse }> | Failure
const fail = (status: Failure["status"], code: string): Failure => ({ ok: false, status, code: `model_admission_${code}` })

/** Fixed, single-send owner command; an unknown result is never retried here. */
export async function requestBillingModelAdmission(
  config: BffConfig,
  context: RequestContext,
  body: AdmissionCreateRequest,
  key: string,
  proof: string,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<BillingModelAdmissionResult> {
  const identity = billingPersonalIdentity(context),
    origin = config.upstreams.billing,
    token = config.billingServiceToken,
    secret = config.upstreamSecret
  if (!identity || !origin || !token || !secret || token === secret || signal.aborted || Date.now() >= deadlineAt) return fail(503, "unavailable")
  const { transport, check, invalid } = billingModelTransport(config, context, signal, deadlineAt)
  try {
    const result = await createAdmission({
      client: createClient({ baseUrl: origin, fetch: transport }),
      signal,
      body,
      headers: {
        authorization: `Bearer ${token}`,
        "x-kokoro-internal-secret": secret,
        "x-kokoro-service": "web-bff",
        "x-kokoro-tenant-id": identity.tenant,
        "x-kokoro-subject": identity.subject,
        "x-request-id": context.requestId,
        "idempotency-key": key,
        "x-billing-execution-proof": proof,
      },
    })
    check()
    if (result.response?.status === 201) {
      const parsed = zAdmissionResponse.safeParse(result.data)
      if (!parsed.success || !isDeepStrictEqual(parsed.data, result.data)) return fail(502, "upstream_invalid")
      const data = parsed.data.data
      if (
        Object.entries(body).some(([key, value]) => data[key as keyof typeof data] !== value) ||
        data.status !== "held" ||
        data.created_at !== data.updated_at ||
        new Date(data.created_at).toISOString() !== data.created_at
      )
        return fail(502, "upstream_invalid")
      return { ok: true, data: parsed.data }
    }
    if (!result.response) return fail(invalid() ? 502 : 503, invalid() ? "upstream_invalid" : "unavailable")
    const denial = billingModelDenial(result.response.status, result.error)
    return fail(denial.status, denial.code)
  } catch {
    return signal.aborted || Date.now() >= deadlineAt || !invalid() ? fail(503, "unavailable") : fail(502, "upstream_invalid")
  }
}
