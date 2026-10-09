import type { IncomingMessage, ServerResponse } from "node:http"
import type { JsonValue } from "@bufbuild/protobuf"
import { Code, ConnectError } from "@connectrpc/connect"
import type { RequestContext } from "../../domain/request-context.js"
import type { SkillProductConnectClient } from "../../infrastructure/clients/platform/skill-product-connect.js"
import {
  assertSkillWireKnown,
  projectSkillProductRecord,
  projectSkillCover,
  skillTimestamp,
} from "../../infrastructure/clients/platform/skill-product-response.js"
import { readSkillCoverBytes } from "../../infrastructure/clients/storage/skill-product-transfer.js"
import { skillIdSchema, parseSkillProductInput } from "../skill-product-input.js"
import { runSkillRoute, assertSkillReadRequest, skillCommandId } from "./skill-drafts.js"
import { readSkillBody as readBody } from "./skill-drafts.js"
import { send } from "../response.js"
export async function skillCoverRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  skillId: string,
  operation: "cover" | "get" | "begin" | "complete",
  client: SkillProductConnectClient | null,
  objectOrigin: string | null,
  readmit?: (signal: AbortSignal) => Promise<void>,
) {
  await runSkillRoute(request, response, context, async (signal, deadlineAt) => {
    skillIdSchema.parse(skillId)
    const common = { requestId: context.requestId, tenant: context.identity.namespace, subject: context.identity.userId }
    if (!client) throw new ConnectError("Skill cover dependency missing", Code.Unavailable)
    if (operation === "cover") {
      assertSkillReadRequest(request)
      if (!objectOrigin) throw new ConnectError("Cover origin missing", Code.Unavailable)
      const owner = await client.cover({ ...common, sourceRef: `skill:${skillId}` }, signal, deadlineAt)
      assertSkillWireKnown(owner)
      if (owner.sourceRef?.value !== `skill:${skillId}`) throw new Error("skill_response_invalid")
      const cover = projectSkillCover(owner.cover)
      const bytes = await readSkillCoverBytes(owner.transferReference, owner.cover, objectOrigin, signal)
      const after = await client.cover({ ...common, sourceRef: `skill:${skillId}` }, signal, deadlineAt)
      assertSkillWireKnown(after)
      if (after.sourceRef?.value !== owner.sourceRef.value || JSON.stringify(projectSkillCover(after.cover)) !== JSON.stringify(cover))
        throw new ConnectError("Skill cover changed", Code.NotFound)
      await readmit?.(signal)
      signal.throwIfAborted()
      response.writeHead(200, {
        "content-type": cover.mime_type,
        "content-length": bytes.length,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      })
      response.end(bytes)
      return
    }
    if (operation === "get") {
      assertSkillReadRequest(request)
      const owner = await client.getCoverUpload({ ...common, skillId }, signal, deadlineAt)
      assertSkillWireKnown(owner)
      if (
        owner.skillId?.value !== skillId ||
        owner.stateVersion < 1n ||
        owner.stateVersion > 9_223_372_036_854_775_807n ||
        !["none", "intent", "upload_pending", "completed", "aborted"].includes(owner.phase)
      )
        throw new Error("skill_response_invalid")
      signal.throwIfAborted()
      send(response, 200, {
        data: {
          skill_id: skillId,
          phase: owner.phase,
          state_version: owner.stateVersion.toString(),
          attempt_epoch: owner.attemptEpoch.toString(),
          ...(owner.attemptId === undefined ? {} : { attempt_id: owner.attemptId }),
          ...(owner.uploadId === undefined ? {} : { upload_id: owner.uploadId }),
          ...(owner.sourceVersionId === undefined ? {} : { source_version_id: owner.sourceVersionId }),
          ...(owner.cover === undefined ? {} : { cover: projectSkillCover(owner.cover) }),
        },
      })
      return
    }
    if (new URL(request.url!, "http://bff.local").search || request.headers["content-type"]?.split(";", 1)[0] !== "application/json")
      throw new ConnectError("Request invalid", Code.InvalidArgument)
    const commandId = skillCommandId(request, context, operation === "begin" ? "beginCoverUpload" : "completeCoverUpload")
    const input = parseSkillProductInput(operation === "begin" ? "beginCover" : "completeCover", await readBody(request, 65_536))
    const members = { ...input, skill_id: { value: skillId }, size_bytes: String(input.size_bytes) } as Record<string, JsonValue>
    const owner = await client.command(
      operation === "begin" ? "beginSkillCoverUpload" : "completeSkillCoverUpload",
      { ...common, commandId },
      members,
      signal,
      deadlineAt,
    )
    assertSkillWireKnown(owner)
    if (operation === "begin" && "transferReference" in owner) {
      const transfer = owner.transferReference
      if (
        owner.skillId?.value !== skillId ||
        !owner.attemptId ||
        !owner.uploadId ||
        owner.attemptEpoch < 1n ||
        owner.stateVersion < 1n ||
        !transfer ||
        !objectOrigin ||
        new URL(transfer.url).origin !== objectOrigin ||
        !["http:", "https:"].includes(new URL(transfer.url).protocol) ||
        !!new URL(transfer.url).username ||
        !!new URL(transfer.url).password ||
        !!new URL(transfer.url).hash ||
        transfer.method !== "PUT" ||
        Object.keys(transfer.requiredHeaders).length !== 1 ||
        transfer.requiredHeaders["content-type"] !== (input as { mime_type: string }).mime_type
      )
        throw new Error("skill_response_invalid")
      const expiresAt = skillTimestamp(transfer.expiresAt)
      if (Date.parse(expiresAt) <= Date.now() || Date.parse(expiresAt) > Date.now() + 901_000) throw new Error("skill_response_invalid")
      signal.throwIfAborted()
      send(response, 201, {
        data: {
          skill_id: skillId,
          attempt_id: owner.attemptId,
          attempt_epoch: owner.attemptEpoch.toString(),
          upload_id: owner.uploadId,
          state_version: owner.stateVersion.toString(),
          transfer_reference: { url: transfer.url, method: "PUT", required_headers: transfer.requiredHeaders, expires_at: expiresAt },
          replayed: owner.replayed,
        },
      })
      return
    }
    if (
      !("skill" in owner) ||
      !("scanState" in owner) ||
      owner.attemptId !== (input as { attempt_id: string }).attempt_id ||
      owner.uploadId !== (input as { upload_id: string }).upload_id ||
      owner.attemptEpoch < 1n ||
      ![1, 2, 3, 4].includes(owner.scanState)
    )
      throw new Error("skill_response_invalid")
    signal.throwIfAborted()
    send(response, 200, {
      data: {
        skill: projectSkillProductRecord(owner.skill, skillId),
        attempt_id: owner.attemptId,
        attempt_epoch: owner.attemptEpoch.toString(),
        upload_id: owner.uploadId,
        scan_state: ["unspecified", "pending", "clean", "infected", "unknown"][owner.scanState],
        replayed: owner.replayed,
      },
    })
  })
}
