import { createHash } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { ProjectExecutionBindingReader } from "../../application/ports/project-execution-binding-reader.js"
import { projectExecutionCredentialTenant } from "../../auth/project-execution-credential.js"
import { projectExecutionBindingRequest, projectExecutionBindingResponse } from "../project-execution-binding.contract.js"
import { readBody, requestId } from "../request.js"
import { send } from "../response.js"

export async function projectExecutionBindingRoute(
  request: IncomingMessage,
  response: ServerResponse,
  credentialFile: string | null,
  reader: ProjectExecutionBindingReader | null,
): Promise<void> {
  response.setHeader("x-request-id", requestId(request))
  const failure = (status: number, code: string) => {
    if (!response.destroyed && !response.writableEnded)
      send(response, status, { error: { code, message: "Project execution binding is unavailable", retryable: status === 503 } })
  }
  if (request.method !== "POST" || request.url !== "/internal/v1/project-execution-bindings/verify") {
    failure(400, "binding_request_invalid")
    return
  }
  if (credentialFile === null || reader === null) {
    failure(503, "binding_unavailable")
    return
  }
  const raw = (name: string): string | null => {
    const values = request.rawHeaders.filter((_, i) => i % 2 === 1 && request.rawHeaders[i - 1]?.toLowerCase() === name)
    return values.length === 1 ? values[0]! : null
  }
  const authorization = raw("authorization")
  if (authorization === null || !/^Bearer [\x21-\x7e]{32,4096}$/u.test(authorization)) {
    failure(403, "binding_service_denied")
    return
  }
  if (raw("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" || request.headers["idempotency-key"] !== undefined) {
    failure(400, "binding_request_invalid")
    return
  }
  const abort = new AbortController()
  const closed = () => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", closed)
  response.once("close", closed)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const work = async () => {
      const tenant = await projectExecutionCredentialTenant(credentialFile, authorization.slice(7), abort.signal)
      if (tenant === null) {
        failure(403, "binding_service_denied")
        return
      }
      let input
      try {
        input = projectExecutionBindingRequest.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBody(request, 8192))))
      } catch {
        abort.signal.throwIfAborted()
        failure(400, "binding_request_invalid")
        return
      }
      if (tenant !== input.tenant_id) {
        failure(403, "binding_service_denied")
        return
      }
      if (input.actor_id !== input.subject_id) {
        failure(400, "binding_request_invalid")
        return
      }
      abort.signal.throwIfAborted()
      const binding = await reader.readProjectExecutionBinding({
        tenantId: tenant,
        actorId: input.actor_id,
        subjectId: input.subject_id,
        runId: input.run_id,
        sessionId: input.session_id,
        identityAssertionRef: input.identity_assertion_ref,
        projectId: input.project_ref,
        selectionDigest: input.selection_digest,
        signal: abort.signal,
      })
      abort.signal.throwIfAborted()
      if (binding === null) {
        failure(404, "binding_not_found")
        return
      }
      const body = projectExecutionBindingResponse.parse({
        data: { project_ref: binding.projectId, selected_skill_source_refs: binding.selectedSkillSourceRefs, selection_digest: binding.selectionDigest },
      })
      if (
        binding.projectId !== input.project_ref ||
        binding.selectionDigest !== input.selection_digest ||
        createHash("sha256").update(JSON.stringify(binding.selectedSkillSourceRefs)).digest("hex") !== input.selection_digest
      )
        throw new Error("binding_response_mismatch")
      send(response, 200, body)
    }
    await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort.abort()
          reject(new Error("binding_timeout"))
        }, 3000)
      }),
    ])
  } catch {
    response.setHeader("connection", "close")
    failure(503, "binding_unavailable")
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    request.removeListener("aborted", closed)
    response.removeListener("close", closed)
  }
}
