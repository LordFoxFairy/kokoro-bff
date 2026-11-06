import { createHash } from "node:crypto"
import { Code, ConnectError } from "@connectrpc/connect"
import type { z } from "zod"
import {
  MCP_PROJECT_PUBLICATION_FAULTS,
  mcpProjectList,
  mcpProjectPublishAck,
  mcpProjectRemoveAck,
  mcpProjectReceipt,
} from "../../../application/mcp-project-publication.contract.js"
import type { mcpProjectPublicationIdentity, mcpProjectRemovalIdentity } from "../../../application/mcp-project-publication.contract.js"
import { connectorCommandFault } from "./connector-command-fault.js"

export type PublicationIdentity = Readonly<{ tenant: string; subject: string; requestId: string }>
export type PublicationMutation =
  | { kind: "publish"; commandId: string; input: z.infer<typeof mcpProjectPublicationIdentity> }
  | { kind: "remove"; commandId: string; input: z.infer<typeof mcpProjectRemovalIdentity> }
export type PublicationCall =
  PublicationMutation | { kind: "list"; projectId: string; limit: number; cursor?: string } | { kind: "receipt"; original: PublicationMutation }
export interface McpProjectPublicationClient {
  execute(identity: PublicationIdentity, input: PublicationCall, signal: AbortSignal, deadlineAt: number): Promise<unknown>
  close?(): void
}

export function publicationTargets(input: PublicationCall): string[] {
  const call = input.kind === "receipt" ? input.original : input
  return call.kind === "publish" ? call.input.targets.map((target) => target.project_id) : [call.kind === "list" ? call.projectId : call.input.project_id]
}

/** Fixed owner profile tuple; IDs are trusted scope or validated original input, never caller-supplied digest. */
export function publicationCommand(identity: PublicationIdentity, call: PublicationMutation) {
  const material =
    call.kind === "publish"
      ? [
          "mcp.url.publish_projects",
          call.input.server_id,
          call.input.connector_id,
          Number(call.input.expected_source_state_version),
          [...call.input.targets]
            .sort((a, b) => (a.project_id < b.project_id ? -1 : a.project_id > b.project_id ? 1 : 0))
            .map((target) => [
              target.project_id,
              "absent" in target.expected_pin ? null : [target.expected_pin.current.pin_id, Number(target.expected_pin.current.state_version)],
            ]),
        ]
      : ["mcp.project_pin.remove", call.input.project_id, call.input.pin_id, Number(call.input.expected_state_version)]
  return {
    commandId: call.commandId,
    requestDigest: createHash("sha256")
      .update(JSON.stringify(["mcp-project-publication/v1", identity.tenant, identity.subject, ...material]))
      .digest("hex"),
  }
}

export function validatePublicationResult(call: PublicationCall, raw: unknown): unknown {
  const invalid = (): never => {
    throw new Error("mcp_project_publication_response_invalid")
  }
  try {
    if (call.kind === "receipt") {
      const result = mcpProjectReceipt.parse(raw)
      if (call.original.kind === "publish" && "publication" in result) validatePublicationResult(call.original, result.publication)
      else if (call.original.kind === "remove" && "removal" in result) validatePublicationResult(call.original, result.removal)
      else invalid()
      return result
    }
    if (call.kind === "publish") {
      const result = mcpProjectPublishAck.parse(raw),
        expected = call.input
      if (
        result.revision.server_id !== expected.server_id ||
        result.revision.connector_id !== expected.connector_id ||
        result.revision.source_state_version !== expected.expected_source_state_version ||
        result.pins.length !== expected.targets.length
      )
        invalid()
      const pins = new Set<string>(),
        projects = new Set<string>()
      for (const pin of result.pins) {
        const target = expected.targets.find((value) => value.project_id === pin.project_id)
        if (!target || pin.removed || pins.has(pin.pin_id) || projects.has(pin.project_id) || JSON.stringify(pin.revision) !== JSON.stringify(result.revision))
          invalid()
        if (
          target &&
          "current" in target.expected_pin &&
          (pin.pin_id !== target.expected_pin.current.pin_id || BigInt(pin.state_version) !== BigInt(target.expected_pin.current.state_version) + 1n)
        )
          invalid()
        if (target && "absent" in target.expected_pin && pin.state_version !== "1") invalid()
        pins.add(pin.pin_id)
        projects.add(pin.project_id)
      }
      return result
    }
    if (call.kind === "remove") {
      const result = mcpProjectRemoveAck.parse(raw)
      if (
        result.pin.pin_id !== call.input.pin_id ||
        result.pin.project_id !== call.input.project_id ||
        !result.pin.removed ||
        BigInt(result.pin.state_version) !== BigInt(call.input.expected_state_version) + 1n
      )
        invalid()
      return result
    }
    const result = mcpProjectList.parse(raw)
    if (result.pins.length > call.limit || (result.next_cursor !== null && result.next_cursor === call.cursor)) invalid()
    const ids = new Set<string>()
    for (const pin of result.pins) {
      if (pin.project_id !== call.projectId || ids.has(pin.pin_id)) invalid()
      ids.add(pin.pin_id)
    }
    return result
  } catch {
    return invalid()
  }
}

export function publicationFault(error: unknown, command: boolean) {
  const receipt = connectorCommandFault(error, "mcp", command)
  if (receipt) return receipt
  const fault = (reason: keyof typeof MCP_PROJECT_PUBLICATION_FAULTS) => {
    const { status, code, retryable } = MCP_PROJECT_PUBLICATION_FAULTS[reason]
    return { status, code, retryable }
  }
  if (error instanceof Error && error.message === "mcp_project_publication_request_invalid") return fault("request_invalid")
  if (error instanceof Error && error.message === "mcp_project_publication_response_invalid") return fault("response_invalid")
  if (error instanceof ConnectError) {
    if (error.details.length !== 0) return fault("response_invalid")
    if (error.code === Code.InvalidArgument) return fault("request_invalid")
    if (error.code === Code.NotFound) return fault("not_found")
    if (error.code === Code.PermissionDenied) return fault("forbidden")
    if (error.code === Code.FailedPrecondition) return fault("precondition_failed")
    if (error.code === Code.AlreadyExists) return fault("idempotency_conflict")
    if (error.code === Code.Aborted) return fault("in_progress")
    if (error.code === Code.ResourceExhausted) return fault("rate_limited")
    if (![Code.Canceled, Code.DeadlineExceeded, Code.Unavailable, Code.Unauthenticated].includes(error.code)) return fault("response_invalid")
  }
  return fault("dependency_unavailable")
}
