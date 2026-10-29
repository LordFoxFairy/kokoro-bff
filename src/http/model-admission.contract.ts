import { z } from "zod"
import { zAdmissionCreateRequest, zAdmissionResponse, zAdmissionSettlementRequest, zAdmissionSettlementResponse } from "../generated/billing-http/zod.gen.js"

// The fixed Billing publication owns these two wire shapes; no second editable copy.
export const agentModelAdmissionRequest = zAdmissionCreateRequest
export const agentModelAdmissionResponse = zAdmissionResponse
export const agentModelAdmissionError = z.strictObject({
  error: z.strictObject({
    code: z.enum([
      "model_admission_invalid_request",
      "model_admission_service_denied",
      "model_admission_not_found",
      "model_admission_forbidden",
      "model_admission_conflict",
      "model_admission_insufficient_credit",
      "model_admission_price_unavailable",
      "model_admission_ineligible",
      "model_admission_upstream_invalid",
      "model_admission_unavailable",
    ]),
    message: z.string(),
    retryable: z.boolean(),
  }),
})

export const agentModelSettlementRequest = zAdmissionSettlementRequest
export const agentModelSettlementResponse = zAdmissionSettlementResponse
export const agentModelSettlementError = agentModelAdmissionError.extend({
  error: agentModelAdmissionError.shape.error.extend({
    code: z.enum([
      "model_settlement_invalid_request",
      "model_settlement_service_denied",
      "model_settlement_not_found",
      "model_settlement_forbidden",
      "model_settlement_conflict",
      "model_settlement_insufficient_credit",
      "model_settlement_price_unavailable",
      "model_settlement_ineligible",
      "model_settlement_upstream_invalid",
      "model_settlement_unavailable",
    ]),
  }),
})
