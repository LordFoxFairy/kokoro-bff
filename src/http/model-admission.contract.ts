import { z } from "zod"
import { zAdmissionCreateRequest, zAdmissionResponse } from "../generated/billing-http/zod.gen.js"

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
