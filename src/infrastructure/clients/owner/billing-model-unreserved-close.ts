import { isDeepStrictEqual } from "node:util"
import type { BffConfig } from "../../../config/runtime.js"
import type { RequestContext } from "../../../domain/request-context.js"
import { createClient } from "../../../generated/billing-http/client/client.gen.js"
import { closeUnreservedModelAdmission } from "../../../generated/billing-http/sdk.gen.js"
import type { AdmissionUnreservedCloseRequest, AdmissionUnreservedCloseResponse } from "../../../generated/billing-http/types.gen.js"
import { zAdmissionUnreservedCloseResponse } from "../../../generated/billing-http/zod.gen.js"
import { billingModelTransport, billingModelDenial, type ModelBillingFailure } from "./billing-model-transport.js"
import { billingPersonalIdentity } from "./billing-personal-read.js"

const fail = (status: ModelBillingFailure["status"], code: string): ModelBillingFailure => ({ ok: false, status, code: `model_admission_${code}` })
type Result = Readonly<{ ok: true; data: AdmissionUnreservedCloseResponse }> | ModelBillingFailure

/** A permanent cancellation of one original unreserved command, never a financial settlement or usage assertion. */
export async function closeUnreservedBillingModelAdmission(
  config: BffConfig,
  context: RequestContext,
  body: AdmissionUnreservedCloseRequest,
  key: string,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<Result> {
  const identity = billingPersonalIdentity(context),
    origin = config.upstreams.billing,
    token = config.billingServiceToken,
    secret = config.upstreamSecret
  if (!identity || !origin || !token || !secret || token === secret || signal.aborted || Date.now() >= deadlineAt) return fail(503, "unavailable")
  if (key !== body.request_ref) return fail(400, "invalid_request")
  const { transport, check, invalid } = billingModelTransport(config, context, signal, deadlineAt)
  try {
    const result = await closeUnreservedModelAdmission({
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
      const parsed = zAdmissionUnreservedCloseResponse.safeParse(result.data)
      if (!parsed.success || !isDeepStrictEqual(parsed.data, result.data)) return fail(502, "upstream_invalid")
      const data = parsed.data.data
      if (
        Object.entries(body).some(([name, value]) => data[name as keyof typeof data] !== value) ||
        data.status !== "unreserved_closed" ||
        new Date(data.closed_at).toISOString() !== data.closed_at
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
