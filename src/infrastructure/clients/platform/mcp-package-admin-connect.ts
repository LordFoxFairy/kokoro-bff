import type { Message } from "@bufbuild/protobuf"
import { Code, ConnectError, createClient } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { McpPackageAdminService } from "../../../generated/platform-connect/kokoro/platform/v1/mcp_package_admin_pb.js"
import { PLATFORM_COMMAND_RECEIPT_ERRORS } from "../../../generated/platform-connect/command-receipt-errors.js"
import { mcpPackageAdminCommand, parseMcpPackageAdminInput, type McpPackageAdminIdentity, type McpPackageAdminInput } from "./mcp-package-admin-input.js"
import { projectMcpPackageAdminResponse, type McpPackageAdminResult } from "./mcp-package-admin-response.js"
import type { PlatformServiceCredentialSource } from "./platform-service-credential.js"
const packageReasons = new Map<string, Code>([
  ...[
    "package_zip_invalid",
    "package_zip_unsafe",
    "package_manifest_invalid",
    "package_content_mismatch",
    "package_entrypoint_invalid",
    "package_identity_mismatch",
  ].map((reason) => [reason, Code.FailedPrecondition] as const),
  ["package_limit_exceeded", Code.ResourceExhausted],
  ["package_dependency_unavailable", Code.Unavailable],
])
/** Internal adapter only: callers must separately perform current human admin admission. */
export class McpPackageAdminConnectClient {
  readonly #client
  readonly #active = new Set<AbortController>()
  #closed = false
  constructor(
    baseUrl: string,
    private readonly credentials: Pick<PlatformServiceCredentialSource, "get">,
  ) {
    this.#client = createClient(
      McpPackageAdminService,
      createConnectTransport({ baseUrl, httpVersion: "1.1", useBinaryFormat: true, readMaxBytes: 32_768, writeMaxBytes: 32_768 }),
    )
  }
  close(): void {
    this.#closed = true
    for (const controller of this.#active) controller.abort()
    this.#active.clear()
  }
  async execute(
    originalIdentity: McpPackageAdminIdentity,
    originalInput: McpPackageAdminInput,
    outer: AbortSignal,
    deadlineAt: number,
  ): Promise<McpPackageAdminResult> {
    if (this.#closed) throw new ConnectError("MCP package client closed", Code.Unavailable)
    if (!Number.isFinite(deadlineAt) || performance.now() >= deadlineAt) throw new ConnectError("MCP package deadline exceeded", Code.DeadlineExceeded)
    let parsed: ReturnType<typeof parseMcpPackageAdminInput>
    try {
      parsed = parseMcpPackageAdminInput(originalIdentity, originalInput)
    } catch {
      throw new ConnectError("MCP package request invalid", Code.InvalidArgument)
    }
    const { identity, input } = parsed,
      deadline = Math.min(deadlineAt, performance.now() + 20_000),
      controller = new AbortController(),
      signal = AbortSignal.any([outer, controller.signal])
    const active = () => {
      if (this.#closed) throw new ConnectError("MCP package client closed", Code.Unavailable)
      if (performance.now() >= deadline || (signal.aborted && (signal.reason as { name?: unknown } | undefined)?.name === "TimeoutError"))
        throw new ConnectError("MCP package deadline exceeded", Code.DeadlineExceeded)
      if (signal.aborted) throw new ConnectError("MCP package request canceled", Code.Canceled)
    }
    const remaining = () => Math.max(1, Math.ceil(deadline - performance.now()))
    const timer = setTimeout(() => controller.abort(new DOMException("MCP package deadline", "TimeoutError")), remaining())
    timer.unref()
    this.#active.add(controller)
    try {
      active()
      const token = await this.credentials.get(identity.tenantId, signal, deadline)
      active()
      let requestId: string | null = null,
        canonicalRequestId: string | null = null,
        cache: string | null = null
      const options = {
        signal,
        timeoutMs: remaining(),
        headers: {
          authorization: `Bearer ${token}`,
          "x-kokoro-tenant": identity.tenantId,
          "x-kokoro-subject": identity.subjectId,
          "x-kokoro-request-id": identity.requestId,
        },
        onHeader: (headers: Headers) => {
          requestId = headers.get("x-kokoro-request-id")
          canonicalRequestId = headers.get("x-request-id")
          cache = headers.get("cache-control")
        },
      }
      const scope = { requestId: identity.requestId, packageId: input.packageId }
      let response: Message
      if (input.kind === "status") response = await this.#client.getMcpPackageUploadStatus({ ...scope, uploadId: input.uploadId }, options)
      else {
        const command = mcpPackageAdminCommand(identity, input)
        if (input.kind === "begin")
          response = await this.#client.beginMcpPackageUpload(
            { ...scope, command, filename: input.filename, contentSha256: input.contentSha256, sizeBytes: BigInt(input.sizeBytes) },
            options,
          )
        else if (input.kind === "complete")
          response = await this.#client.completeMcpPackageUpload(
            {
              ...scope,
              command,
              uploadId: input.uploadId,
              uploadSourceVersionId: input.uploadSourceVersionId,
              contentSha256: input.contentSha256,
              sizeBytes: BigInt(input.sizeBytes),
            },
            options,
          )
        else if (input.kind === "abort")
          response = await this.#client.abortMcpPackageUpload({ ...scope, command, uploadId: input.uploadId, reason: input.reason }, options)
        else
          response = await this.#client.publishMcpPackage(
            {
              ...scope,
              command,
              providerKey: input.providerKey,
              uploadId: input.uploadId,
              uploadSourceVersionId: input.uploadSourceVersionId,
              assetId: input.assetId,
              contentSha256: input.contentSha256,
              sizeBytes: BigInt(input.sizeBytes),
            },
            options,
          )
      }
      active()
      if (requestId !== identity.requestId || canonicalRequestId !== identity.requestId || cache !== "no-store")
        throw new ConnectError("MCP package response binding invalid", Code.DataLoss)
      return projectMcpPackageAdminResponse(input, response)
    } catch (error) {
      active()
      const code =
        error instanceof ConnectError && ![Code.Unauthenticated, Code.PermissionDenied, Code.Unknown].includes(error.code) ? error.code : Code.Unavailable
      const reason = error instanceof ConnectError ? error.metadata.get("x-kokoro-error-code") : null
      const receipt = Object.values(PLATFORM_COMMAND_RECEIPT_ERRORS).find((item) => item.error_code === reason)
      const safeReason =
        reason &&
        (receipt?.rpc_code === code || packageReasons.get(reason) === code || (reason === "package_limit_exceeded" && code === Code.FailedPrecondition))
          ? reason
          : undefined
      throw new ConnectError("MCP package administration request failed", code, safeReason ? { "x-kokoro-error-code": safeReason } : undefined)
    } finally {
      clearTimeout(timer)
      this.#active.delete(controller)
    }
  }
}
