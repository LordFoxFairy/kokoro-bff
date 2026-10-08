import type { IncomingMessage, ServerResponse } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"

import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { BffConfig } from "../../config/runtime.js"
import {
  SkillPackageInspectionConnectClient,
  SkillPackageInspectionDependencyError,
  SkillPackageInspectionHeaderError,
  type SkillPackageInspectionInput,
} from "../../infrastructure/clients/platform/skill-package-inspection-connect.js"
import {
  projectSkillPackageInspectionResponse,
  SkillPackageInspectionResponseError,
  validSkillPackagePath,
} from "../../infrastructure/clients/platform/skill-package-inspection-response.js"
import { queryOf } from "../request.js"
import { send } from "../response.js"

const clients = new WeakMap<BffConfig, SkillPackageInspectionConnectClient>()
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const RESPONSE_LIMIT = 1024 * 1024

type Operation = Readonly<{ kind: "managed" | "installation"; targetId: string }>

function operationFor(path: string[]): Operation | null {
  if (path.length === 4 && path[0] === "self" && path[1] === "skills" && path[3] === "package") return { kind: "managed", targetId: path[2] ?? "" }
  if (path.length === 3 && path[0] === "skill-installations" && path[2] === "package") return { kind: "installation", targetId: path[1] ?? "" }
  return null
}

function filePathOf(request: IncomingMessage): string | null | undefined {
  const rawQuery = request.url?.split("?", 2)[1] ?? ""
  for (let index = 0; index < rawQuery.length; index += 1) {
    if (rawQuery[index] === "%" && !/^[0-9A-Fa-f]{2}$/u.test(rawQuery.slice(index + 1, index + 3))) return null
  }
  const query = queryOf(request)
  if (query.size === 0) return undefined
  if ([...new Set(query.keys())].length !== 1 || !query.has("file_path")) return null
  const values = query.getAll("file_path")
  const value = values.length === 1 ? values[0] : undefined
  return value !== undefined && validSkillPackagePath(value) ? value : null
}

function whileActive<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", aborted)
    }
    const aborted = (): void => {
      finish()
      reject(signal.reason)
    }
    signal.addEventListener("abort", aborted, { once: true })
    void promise.then(
      (value) => {
        if (!settled) {
          finish()
          resolve(value)
        }
      },
      (error: unknown) => {
        if (!settled) {
          finish()
          reject(error)
        }
      },
    )
    if (signal.aborted) aborted()
  })
}

function active(request: IncomingMessage, response: ServerResponse): boolean {
  return !request.aborted && !request.destroyed && !response.destroyed && !response.writableEnded
}

function fail(response: ServerResponse, requestId: string, status: number, code: string, message: string, retryable: boolean, retryAfter?: string): void {
  response.setHeader("x-request-id", requestId)
  send(response, status, { error: { code, message, retryable } }, retryAfter)
}

function dependencyFailure(error: unknown): Readonly<{ status: number; code: string; message: string; retryable: boolean }> {
  if (error instanceof SkillPackageInspectionResponseError || error instanceof SkillPackageInspectionHeaderError)
    return { status: 502, code: "skill_package_response_invalid", message: "Skill package response is invalid", retryable: false }
  if (error instanceof SkillPackageInspectionDependencyError)
    return { status: 503, code: "skill_package_dependency_unavailable", message: "Skill package dependency is unavailable", retryable: true }
  if (error instanceof ConnectError) {
    if (error.code === Code.InvalidArgument)
      return { status: 400, code: "invalid_skill_package_request", message: "Skill package request is invalid", retryable: false }
    if (error.code === Code.NotFound) return { status: 404, code: "skill_package_not_found", message: "Skill package was not found", retryable: false }
    if (error.code === Code.FailedPrecondition)
      return { status: 412, code: "skill_package_precondition_failed", message: "Skill package precondition failed", retryable: false }
    if (error.code === Code.ResourceExhausted)
      return { status: 429, code: "skill_package_limit_exceeded", message: "Skill package limit was exceeded", retryable: false }
    if ([Code.Unavailable, Code.Canceled, Code.DeadlineExceeded, Code.Unauthenticated, Code.PermissionDenied].includes(error.code))
      return { status: 503, code: "skill_package_dependency_unavailable", message: "Skill package dependency is unavailable", retryable: true }
  }
  return { status: 502, code: "skill_package_response_invalid", message: "Skill package response is invalid", retryable: false }
}

export async function skillPackageInspectionRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admissionSource: SessionAdmission,
  requestId: string,
  path: string[],
): Promise<void> {
  const operation = operationFor(path)
  if (operation === null || !active(request, response)) return
  response.setHeader("x-request-id", requestId)

  const deadlineAt = performance.now() + 10_000
  const controller = new AbortController()
  let timedOut = false
  let callerCancelled = false
  const timer = setTimeout(
    () => {
      timedOut = true
      controller.abort(new Error("skill_package_deadline"))
    },
    Math.max(0, deadlineAt - performance.now()),
  )
  const cancel = (): void => {
    callerCancelled = true
    controller.abort(new Error("skill_package_cancelled"))
  }
  const close = (): void => {
    if (!response.writableEnded) cancel()
  }
  request.once("aborted", cancel)
  response.once("close", close)

  const expired = (): boolean => {
    if (performance.now() < deadlineAt) return false
    timedOut = true
    if (!controller.signal.aborted) controller.abort(new Error("skill_package_deadline"))
    return true
  }
  const failIfActive = (status: number, code: string, message: string, retryable: boolean, retryAfter?: string): void => {
    if (!callerCancelled && active(request, response)) fail(response, requestId, status, code, message, retryable, retryAfter)
  }

  try {
    const filePath = filePathOf(request)
    if (
      !IDENTIFIER.test(operation.targetId) ||
      filePath === null ||
      request.headers["content-length"] !== undefined ||
      request.headers["transfer-encoding"] !== undefined ||
      request.headers["idempotency-key"] !== undefined
    ) {
      failIfActive(400, "invalid_skill_package_request", "Skill package request is invalid", false)
      return
    }

    let admission
    try {
      if (expired()) throw controller.signal.reason
      admission = await whileActive(authorizeUserRequest(request, config, admissionSource, requestId, controller.signal), controller.signal)
      if (expired()) throw controller.signal.reason
    } catch {
      failIfActive(503, "skill_package_dependency_unavailable", "Skill package dependency is unavailable", true)
      return
    }
    if (!admission.ok) {
      failIfActive(admission.status, admission.code, "BFF user admission failed", admission.status === 429 || admission.status === 503, admission.retryAfter)
      return
    }

    const projection = config.platformProjection
    if (projection.baseUrl === null || projection.credentialFile === null || config.iamBaseUrl === null) {
      failIfActive(503, "skill_package_dependency_unavailable", "Skill package dependency is unavailable", true)
      return
    }
    let client = clients.get(config)
    if (client === undefined) {
      client = new SkillPackageInspectionConnectClient(projection.baseUrl, config.iamBaseUrl, projection.credentialFile, projection.timeoutMs)
      clients.set(config, client)
    }

    const common = {
      requestId,
      tenant: admission.context.identity.namespace,
      subject: admission.context.identity.userId,
      ...(filePath === undefined ? {} : { filePath }),
    }
    const input: SkillPackageInspectionInput =
      operation.kind === "managed"
        ? { ...common, operation: "managed", skillId: operation.targetId }
        : { ...common, operation: "installation", installationId: operation.targetId }

    try {
      if (expired()) throw controller.signal.reason
      const owner = await whileActive(client.inspect(input, controller.signal, deadlineAt), controller.signal)
      if (expired()) throw controller.signal.reason
      const data = projectSkillPackageInspectionResponse(owner, {
        ...(operation.kind === "managed" ? { sourceRef: `skill:${operation.targetId}` } : {}),
        ...(filePath === undefined ? {} : { selectedFilePath: filePath }),
      })
      const payload = Buffer.from(JSON.stringify({ data }))
      if (payload.byteLength > RESPONSE_LIMIT) {
        failIfActive(429, "skill_package_limit_exceeded", "Skill package limit was exceeded", false)
        return
      }
      if (expired()) throw controller.signal.reason
      if (!callerCancelled && active(request, response)) {
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "content-length": payload.byteLength,
        })
        response.end(payload)
      }
    } catch (error) {
      if (callerCancelled || !active(request, response)) return
      if (timedOut || controller.signal.aborted) {
        failIfActive(503, "skill_package_dependency_unavailable", "Skill package dependency is unavailable", true)
        return
      }
      const mapped = dependencyFailure(error)
      failIfActive(mapped.status, mapped.code, mapped.message, mapped.retryable)
    }
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", cancel)
    response.removeListener("close", close)
  }
}
