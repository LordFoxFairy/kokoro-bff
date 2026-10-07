import { ConnectError, Code, createClient, type Client, type Transport } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"

import type {
  ProjectScopeReleaseClient,
  ProjectScopeReleaseCommand,
  ProjectScopeReleaseResult,
} from "../../../application/ports/project-scope-release-outbox.js"
import { StorageService } from "../../../generated/storage-connect/kokoro/storage/v2/storage_pb.js"
import { ErrorCode, ErrorDetailSchema } from "../../../generated/storage-connect/kokoro/common/v1/common_pb.js"

const retryableCodes = new Set([Code.Aborted, Code.ResourceExhausted, Code.Unavailable])

function terminalProfile(code: Code, detailCode: ErrorCode): boolean {
  return (
    (code === Code.InvalidArgument && detailCode === ErrorCode.INVALID_ARGUMENT) ||
    (code === Code.PermissionDenied && detailCode === ErrorCode.PERMISSION_DENIED) ||
    (code === Code.NotFound && detailCode === ErrorCode.NOT_FOUND) ||
    (code === Code.FailedPrecondition && detailCode === ErrorCode.PRECONDITION_FAILED) ||
    (code === Code.AlreadyExists && [ErrorCode.COMMAND_DIGEST_MISMATCH, ErrorCode.CONFLICT].includes(detailCode)) ||
    (code === Code.Internal && detailCode === ErrorCode.INTERNAL)
  )
}

export class StorageScopeReleaseClient implements ProjectScopeReleaseClient {
  private readonly client: Client<typeof StorageService>

  public constructor(
    baseUrl: string,
    private readonly secret: string,
    transport?: Transport,
  ) {
    this.client = createClient(
      StorageService,
      transport ??
        createConnectTransport({
          baseUrl,
          httpVersion: "1.1",
          defaultTimeoutMs: 10_000,
          readMaxBytes: 64 * 1024,
          writeMaxBytes: 64 * 1024,
        }),
    )
  }

  public async release(command: ProjectScopeReleaseCommand, signal: AbortSignal, timeoutMs: number): Promise<ProjectScopeReleaseResult> {
    const headers = {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": this.secret,
      "x-kokoro-tenant-id": command.tenantId,
      "x-kokoro-subject-id": command.ownerSubjectId,
      "x-kokoro-request-id": command.commandId,
      "x-kokoro-scope-kind": command.scopeKind,
      "x-kokoro-scope-id": command.scopeId,
    }
    try {
      const input = { command: { commandId: command.commandId, requestDigest: command.requestDigest } }
      const response =
        command.scopeKind === "project"
          ? await this.client.releaseProjectScope(input, { headers, signal, timeoutMs })
          : await this.client.releaseConversationScope(input, { headers, signal, timeoutMs })
      if (
        response.$unknown?.length ||
        response.scopeReleased !== true ||
        typeof response.replayed !== "boolean" ||
        typeof response.abortedUploadCount !== "bigint" ||
        typeof response.releasedAssetCount !== "bigint" ||
        typeof response.queuedObjectCleanupCount !== "bigint" ||
        response.abortedUploadCount < 0n ||
        response.releasedAssetCount < 0n ||
        response.queuedObjectCleanupCount < 0n
      ) {
        return { outcome: "blocked", errorCode: "storage_release_response_invalid" }
      }
      return { outcome: "released" }
    } catch (error) {
      if (!(error instanceof ConnectError)) return { outcome: "retryable", errorCode: "storage_release_transport_unknown" }
      const details = error.findDetails(ErrorDetailSchema)
      if (details.length === 0 && [Code.Canceled, Code.DeadlineExceeded, Code.Unavailable].includes(error.code)) {
        return { outcome: "retryable", errorCode: "storage_release_transport_unknown" }
      }
      const detail = details[0]
      if (
        details.length !== 1 ||
        detail === undefined ||
        detail.requestId !== command.commandId ||
        error.metadata.get("x-request-id") !== command.commandId ||
        error.metadata.get("x-kokoro-error-code") === null ||
        error.metadata.get("x-kokoro-retryable") !== String(detail.retryable)
      ) {
        return { outcome: "retryable", errorCode: "storage_release_error_untrusted" }
      }
      if (
        error.code === Code.Unauthenticated &&
        detail.code === ErrorCode.UNAUTHENTICATED &&
        detail.retryable === false &&
        error.metadata.get("x-kokoro-error-code") === "UNAUTHENTICATED"
      ) {
        return { outcome: "blocked", errorCode: "storage_unauthenticated" }
      }
      if (
        retryableCodes.has(error.code) &&
        detail.retryable === true &&
        ((error.code === Code.Aborted && detail.code === ErrorCode.CONFLICT && error.metadata.get("x-kokoro-error-code") === "CONFLICT") ||
          (error.code === Code.Unavailable &&
            detail.code === ErrorCode.DEPENDENCY_UNAVAILABLE &&
            error.metadata.get("x-kokoro-error-code") === "DEPENDENCY_UNAVAILABLE") ||
          (error.code === Code.ResourceExhausted && detail.code === ErrorCode.RATE_LIMITED && error.metadata.get("x-kokoro-error-code") === "RATE_LIMITED"))
      ) {
        return { outcome: "retryable", errorCode: `storage_retryable_${detail.code}` }
      }
      if (terminalProfile(error.code, detail.code) && detail.retryable === false && error.metadata.get("x-kokoro-error-code") === ErrorCode[detail.code]) {
        return { outcome: "blocked", errorCode: `storage_terminal_${detail.code}` }
      }
      return { outcome: "retryable", errorCode: "storage_release_error_untrusted" }
    }
  }
}
