import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SubmittedAgentRunReader } from "../../application/ports/submitted-agent-run-reader.js"
import { agentModelAdmissionCredentialTenant } from "../../auth/agent-model-admission-credential.js"
import { requestBillingModelAdmission } from "../../infrastructure/clients/owner/billing-model-admission.js"
import { strictParseRawJson } from "../../infrastructure/raw-json.js"
import { agentModelAdmissionRequest } from "../model-admission.contract.js"
import { readBody, requestId } from "../request.js"
import { send } from "../response.js"

/** Agent service identity and durable submitter lookup; first consumption permission remains with IAM/Billing. */
export async function agentModelAdmissionRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  source: SubmittedAgentRunReader | null,
): Promise<void> {
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const failure = (status: number, code: string) => {
    if (!response.destroyed && !response.writableEnded)
      send(response, status, { error: { code: `model_admission_${code}`, message: "Model budget admission is unavailable", retryable: status === 503 } })
  }
  if (request.method !== "POST" || request.url !== "/internal/v1/model-admissions") {
    failure(400, "invalid_request")
    return
  }
  const file = config.agentModelAdmissionCredentialFile
  if (!file || !source) {
    failure(503, "unavailable")
    return
  }
  const single = (name: string) => {
    const values = request.rawHeaders.filter((_, i) => i % 2 === 1 && request.rawHeaders[i - 1]?.toLowerCase() === name)
    return values.length === 1 ? values[0]! : null
  }
  const auth = single("authorization")
  if (
    !auth ||
    !/^Bearer [\x21-\x7e]{32,4096}$(?![\s\S])/u.test(auth) ||
    [config.sharedSecret, config.adminWebSharedSecret, config.upstreamSecret, config.billingServiceToken, config.schedulerServiceToken].includes(auth.slice(7))
  ) {
    failure(403, "service_denied")
    return
  }
  const key = single("idempotency-key"),
    proof = single("x-billing-execution-proof"),
    mime = single("content-type")
  if (
    !key ||
    !/^[\x21-\x7e]{8,128}$(?![\s\S])/u.test(key) ||
    !proof ||
    !/^[\x21-\x7e]{1,16384}$(?![\s\S])/u.test(proof) ||
    request.headers["x-billing-consumption-token"] !== undefined ||
    mime?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" ||
    !/^[A-Za-z0-9._:-]{1,128}$(?![\s\S])/u.test(id)
  ) {
    failure(400, "invalid_request")
    return
  }
  const controller = new AbortController(),
    signal = controller.signal,
    deadlineAt = Date.now() + Math.min(10000, config.upstreamTimeoutMs)
  const close = () => {
    if (!response.writableEnded) controller.abort()
  }
  request.once("aborted", close)
  response.once("close", close)
  if (request.aborted || response.destroyed) controller.abort()
  let timer: ReturnType<typeof setTimeout> | undefined
  const check = () => {
    if (signal.aborted || Date.now() >= deadlineAt) throw new Error("model_admission_cancelled")
  }
  try {
    const work = async () => {
      const tenant = await agentModelAdmissionCredentialTenant(file, auth.slice(7), signal)
      check()
      if (tenant === null) {
        failure(403, "service_denied")
        return
      }
      let body
      try {
        const bytes = await readBody(request, 16_384)
        if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error("model_admission_invalid_json")
        body = agentModelAdmissionRequest.parse(strictParseRawJson(bytes))
      } catch {
        check()
        failure(400, "invalid_request")
        return
      }
      check()
      const origin = await source.readSubmittedAgentRun({ tenantId: tenant, runId: body.run_id, signal })
      check()
      if (!origin || origin.tenantId !== tenant || origin.runId !== body.run_id) {
        failure(404, "not_found")
        return
      }
      const result = await requestBillingModelAdmission(
        config,
        { requestId: id, identity: { namespace: tenant, userId: origin.userId } },
        body,
        key,
        proof,
        signal,
        deadlineAt,
      )
      check()
      if (!result.ok) {
        failure(result.status, result.code.replace(/^model_admission_/u, ""))
        return
      }
      send(response, 201, result.data)
    }
    await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => {
            controller.abort()
            reject(new Error("model_admission_deadline"))
          },
          Math.max(0, deadlineAt - Date.now()),
        )
      }),
    ])
  } catch {
    response.setHeader("connection", "close")
    failure(503, "unavailable")
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    request.removeListener("aborted", close)
    response.removeListener("close", close)
  }
}
