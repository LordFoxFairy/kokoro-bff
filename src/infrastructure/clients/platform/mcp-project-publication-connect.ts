import { create, toJson } from "@bufbuild/protobuf"
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt"
import { createClient, type CallOptions } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import * as p from "../../../generated/platform-connect/kokoro/platform/v1/mcp_project_publication_pb.js"
import {
  publicationCommand,
  validatePublicationResult,
  type McpProjectPublicationClient,
  type PublicationCall,
  type PublicationIdentity,
  type PublicationMutation,
} from "./mcp-project-publication.js"
import type { PlatformServiceCredentialSource } from "./platform-service-credential.js"

const invalid = (): never => {
  throw new Error("mcp_project_publication_response_invalid")
}
function noUnknown(value: unknown): void {
  if (value === null || typeof value !== "object") return
  if ("$unknown" in value && Array.isArray(value.$unknown) && value.$unknown.length) invalid()
  for (const nested of Object.values(value)) noUnknown(nested)
}
function instant(value: Timestamp | undefined) {
  if (!value) return invalid()
  return toJson(TimestampSchema, value)
}
function revision(value: p.McpUrlRevisionSummary | undefined) {
  if (!value) return invalid()
  return {
    revision_id: value.revisionId,
    server_id: value.serverId,
    connector_id: value.connectorId,
    content_digest: value.contentDigest,
    source_state_version: value.sourceStateVersion.toString(),
    display_name: value.displayName,
    created_at: instant(value.createdAt),
  }
}
function pin(value: p.McpProjectPin | undefined) {
  if (!value) return invalid()
  return {
    pin_id: value.pinId,
    project_id: value.projectId,
    revision: revision(value.revision),
    state_version: value.stateVersion.toString(),
    removed: value.removed,
    updated_at: instant(value.updatedAt),
    execution_ready: value.executionReady,
  }
}
function publication(value: p.PublishMcpUrlToProjectsResponse) {
  return { revision: revision(value.revision), pins: value.pins.map(pin), replayed: value.replayed }
}
function removal(value: p.RemoveProjectMcpPinResponse) {
  return { pin: pin(value.pin), replayed: value.replayed }
}
function publishRequest(identity: PublicationIdentity, call: Extract<PublicationMutation, { kind: "publish" }>) {
  return create(p.PublishMcpUrlToProjectsRequestSchema, {
    requestId: identity.requestId,
    command: publicationCommand(identity, call),
    serverId: call.input.server_id,
    connectorId: call.input.connector_id,
    expectedSourceStateVersion: BigInt(call.input.expected_source_state_version),
    targets: [...call.input.targets]
      .sort((a, b) => (a.project_id < b.project_id ? -1 : a.project_id > b.project_id ? 1 : 0))
      .map((target) => ({
        projectId: target.project_id,
        expectedPin: {
          expected:
            "absent" in target.expected_pin
              ? { case: "absent" as const, value: true }
              : {
                  case: "current" as const,
                  value: { pinId: target.expected_pin.current.pin_id, stateVersion: BigInt(target.expected_pin.current.state_version) },
                },
        },
      })),
  })
}
function removeRequest(identity: PublicationIdentity, call: Extract<PublicationMutation, { kind: "remove" }>) {
  return create(p.RemoveProjectMcpPinRequestSchema, {
    requestId: identity.requestId,
    command: publicationCommand(identity, call),
    projectId: call.input.project_id,
    pinId: call.input.pin_id,
    expectedStateVersion: BigInt(call.input.expected_state_version),
  })
}

export class McpProjectPublicationConnectClient implements McpProjectPublicationClient {
  readonly #client
  readonly #active = new Set<AbortController>()
  #closed = false
  constructor(
    baseUrl: string,
    private readonly credentials: Pick<PlatformServiceCredentialSource, "get">,
  ) {
    this.#client = createClient(
      p.ProductMcpProjectPublicationService,
      createConnectTransport({ baseUrl, httpVersion: "1.1", useBinaryFormat: true, readMaxBytes: 1_048_576, writeMaxBytes: 1_048_576 }),
    )
  }
  close(): void {
    this.#closed = true
    for (const controller of this.#active) controller.abort()
    this.#active.clear()
  }
  async execute(identity: PublicationIdentity, call: PublicationCall, outer: AbortSignal, deadlineAt: number): Promise<unknown> {
    if (this.#closed || performance.now() >= deadlineAt) throw new Error("mcp_project_publication_unavailable")
    const controller = new AbortController(),
      signal = AbortSignal.any([outer, controller.signal])
    const remaining = () => Math.max(0, Math.floor(deadlineAt - performance.now()))
    this.#active.add(controller)
    const timer = setTimeout(() => controller.abort(), remaining())
    try {
      signal.throwIfAborted()
      const token = await this.credentials.get(identity.tenant, signal, deadlineAt)
      signal.throwIfAborted()
      if (remaining() <= 0) throw new Error("mcp_project_publication_unavailable")
      let requestId: string | null = null,
        cache: string | null = null
      const options: CallOptions = {
        signal,
        timeoutMs: remaining(),
        headers: {
          authorization: `Bearer ${token}`,
          "x-kokoro-tenant": identity.tenant,
          "x-kokoro-subject": identity.subject,
          "x-kokoro-request-id": identity.requestId,
        },
        onHeader: (headers) => {
          requestId = headers.get("x-request-id")
          cache = headers.get("cache-control")
        },
      }
      let raw: unknown, project: () => unknown
      if (call.kind === "publish") {
        const value = await this.#client.publishMcpUrlToProjects(publishRequest(identity, call), options)
        raw = value
        project = () => publication(value)
      } else if (call.kind === "remove") {
        const value = await this.#client.removeProjectMcpPin(removeRequest(identity, call), options)
        raw = value
        project = () => removal(value)
      } else if (call.kind === "list") {
        const value = await this.#client.listProjectMcpPins(
          create(p.ListProjectMcpPinsRequestSchema, { requestId: identity.requestId, projectId: call.projectId, limit: call.limit, cursor: call.cursor }),
          options,
        )
        raw = value
        project = () => ({ pins: value.pins.map(pin), next_cursor: value.nextCursor ?? null })
      } else {
        const original = call.original
        const value = await this.#client.getMcpProjectPublicationReceipt(
          create(p.GetMcpProjectPublicationReceiptRequestSchema, {
            requestId: identity.requestId,
            original:
              original.kind === "publish"
                ? { case: "publication", value: publishRequest(identity, original) }
                : { case: "removal", value: removeRequest(identity, original) },
          }),
          options,
        )
        raw = value
        project = () =>
          value.result.case === "publication"
            ? { publication: publication(value.result.value) }
            : value.result.case === "removal"
              ? { removal: removal(value.result.value) }
              : invalid()
      }
      signal.throwIfAborted()
      if (requestId !== identity.requestId || cache !== "no-store") invalid()
      try {
        noUnknown(raw)
        return validatePublicationResult(call, project())
      } catch {
        return invalid()
      }
    } finally {
      clearTimeout(timer)
      this.#active.delete(controller)
    }
  }
}
