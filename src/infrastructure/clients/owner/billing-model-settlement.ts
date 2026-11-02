import { isDeepStrictEqual } from "node:util"
import type { BffConfig } from "../../../config/runtime.js"
import type { RequestContext } from "../../../domain/request-context.js"
import { createClient } from "../../../generated/billing-http/client/client.gen.js"
import { settleModelAdmission } from "../../../generated/billing-http/sdk.gen.js"
import type { AdmissionSettlementRequest, AdmissionSettlementResponse } from "../../../generated/billing-http/types.gen.js"
import { zAdmissionSettlementResponse } from "../../../generated/billing-http/zod.gen.js"
import { billingPersonalIdentity } from "./billing-personal-read.js"
import { billingModelTransport, billingModelDenial, type ModelBillingFailure } from "./billing-model-transport.js"
const fail = (status: ModelBillingFailure["status"], code: string): ModelBillingFailure => ({ ok: false, status, code: `model_settlement_${code}` })
/** Recover/apply original sealed evidence, no live user authorization or provider retry. */
export async function requestBillingModelSettlement(
  config: BffConfig,
  context: RequestContext,
  admissionId: string,
  body: AdmissionSettlementRequest,
  key: string,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<Readonly<{ ok: true; data: AdmissionSettlementResponse }> | ModelBillingFailure> {
  const identity = billingPersonalIdentity(context),
    origin = config.upstreams.billing,
    token = config.billingServiceToken,
    secret = config.upstreamSecret
  if (!identity || !origin || !token || !secret || token === secret || signal.aborted || Date.now() >= deadlineAt) return fail(503, "unavailable")
  const { transport, check, invalid } = billingModelTransport(config, context, signal, deadlineAt)
  try {
    const result = await settleModelAdmission({
      client: createClient({ baseUrl: origin, fetch: transport }),
      signal,
      path: { admission_id: admissionId },
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
      const parsed = zAdmissionSettlementResponse.safeParse(result.data)
      if (!parsed.success || !isDeepStrictEqual(parsed.data, result.data)) return fail(502, "upstream_invalid")
      const d = parsed.data.data
      if (
        d.admission_id !== admissionId ||
        Object.entries(body).some(([k, v]) => d[k as keyof typeof d] !== v) ||
        new Date(d.updated_at).toISOString() !== d.updated_at
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
