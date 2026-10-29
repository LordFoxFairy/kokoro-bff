import type { BffConfig } from "../../../config/runtime.js"
import type { RequestContext } from "../../../domain/request-context.js"
import { createClient } from "../../../generated/billing-http/client/client.gen.js"
import { recoverModelAdmission } from "../../../generated/billing-http/sdk.gen.js"
import type { AdmissionCreateRequest } from "../../../generated/billing-http/types.gen.js"
import { originalModelAdmissionAck } from "./billing-model-admission-ack.js"
import { billingModelTransport, billingModelDenial } from "./billing-model-transport.js"
import type { BillingModelAdmissionResult } from "./billing-model-admission.js"
import { billingPersonalIdentity } from "./billing-personal-read.js"

type Failure = Readonly<{ ok: false; status: 400 | 403 | 404 | 409 | 422 | 502 | 503; code: string }>
const fail = (status: Failure["status"], code: string): Failure => ({ ok: false, status, code: `model_admission_${code}` })

/** Read only the committed original budget receipt; a miss never authorizes reserve or execution. */
export async function recoverBillingModelAdmission(
  config: BffConfig,
  context: RequestContext,
  body: AdmissionCreateRequest,
  key: string,
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
    const result = await recoverModelAdmission({
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
      },
    })
    check()
    if (result.response?.status === 200) {
      const data = originalModelAdmissionAck(body, result.data)
      return data === null ? fail(502, "upstream_invalid") : { ok: true, data }
    }
    if (!result.response) return fail(invalid() ? 502 : 503, invalid() ? "upstream_invalid" : "unavailable")
    const denial = billingModelDenial(result.response.status, result.error)
    return fail(denial.status, denial.code)
  } catch {
    return signal.aborted || Date.now() >= deadlineAt || !invalid() ? fail(503, "unavailable") : fail(502, "upstream_invalid")
  }
}
