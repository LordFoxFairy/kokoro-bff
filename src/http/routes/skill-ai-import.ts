import { ZodError } from "zod"
import { isDeepStrictEqual } from "node:util"
import { sha256Jcs } from "../../infrastructure/clients/platform/jcs.js"
import { skillHandoffResultSchema } from "../../infrastructure/clients/platform/skill-product-schema.js"
import type { IncomingMessage, ServerResponse } from "node:http"
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { Code, ConnectError } from "@connectrpc/connect"
import type { JsonValue } from "@bufbuild/protobuf"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import { handoffSkillPackage } from "../../application/skill-ai-handoff.js"
import type { SkillProductConnectClient } from "../../infrastructure/clients/platform/skill-product-connect.js"
import { assertSkillWireKnown, skillTimestamp } from "../../infrastructure/clients/platform/skill-product-response.js"
import { projectSkillProductCommand } from "../../infrastructure/clients/platform/create-skill-draft-projector.js"
import { FinalArtifactClient } from "../../infrastructure/clients/storage/final-artifact.js"
import { spoolVerifiedArtifact } from "../../infrastructure/clients/storage/artifact-download-transfer.js"
import { putStorageBytes } from "../../infrastructure/clients/storage/transfer.js"
import {
  skillCreationProvenanceSchema,
  skillDecimalSchema,
  skillIdSchema,
  skillMetadataInputSchema,
  skillProductInputs,
  parseSkillProductInput,
} from "../skill-product-input.js"
import { runSkillRoute, skillCommandId, skillMetadataWire } from "./skill-drafts.js"
import { readSkillBody as readBody } from "./skill-drafts.js"
import { send } from "../response.js"

/** Fresh imports still verify real bytes before the shared exact owner chain. */
export async function importSkillBytes(
  context: RequestContext,
  commandId: string,
  bytes: Buffer,
  metadata: import("zod").infer<typeof skillProductInputs.ai>["metadata"],
  provenance: import("zod").infer<typeof skillCreationProvenanceSchema>,
  client: SkillProductConnectClient,
  store: BffBusinessStore,
  origin: string,
  signal: AbortSignal,
  deadlineAt: number,
) {
  return importSkillPackage(
    context,
    commandId,
    {
      bytes,
      frozen: {
        metadata: skillMetadataWire(metadata),
        provenance,
        content_sha256: createHash("sha256").update(bytes).digest("hex"),
        size_bytes: String(bytes.length),
      },
    },
    client,
    store,
    origin,
    signal,
    deadlineAt,
  )
}

function immutableSkillImportSnapshot(value: Record<string, unknown>) {
  const parsed = skillCreationProvenanceSchema.parse(value.provenance)
  if (!("github" in parsed)) return value
  const { repo_stats: _observation, ...github } = parsed.github
  return { ...value, provenance: { github } }
}

/** Only positively selected/completed receipts contain a byte-free recovery proof. Terminal201 has no selector proof. */
export async function resumeGithubSkillImport(
  context: RequestContext,
  commandId: string,
  selector: import("zod").infer<typeof skillProductInputs.githubImport>,
  client: SkillProductConnectClient,
  store: BffBusinessStore,
  origin: string,
  signal: AbortSignal,
  deadlineAt: number,
  readmit: (signal: AbortSignal) => Promise<void>,
) {
  signal.throwIfAborted()
  let receipt
  try {
    receipt = await store.getReceipt(JSON.stringify([context.identity.namespace, context.identity.userId, "skill-import-v1", commandId]))
  } catch {
    throw new Error("skill_checkpoint_unavailable")
  }
  signal.throwIfAborted()
  if (receipt?.status !== 200) return undefined
  const body = receipt.body as Record<string, unknown> | null
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("skill_checkpoint_unavailable")
  if (body.stage !== "selected" && body.stage !== "completed") {
    if (["frozen", "created", "admitted"].includes(String(body.stage))) return undefined
    throw new Error("skill_checkpoint_unavailable")
  }
  let frozen: Record<string, unknown>, github: Extract<import("zod").infer<typeof skillCreationProvenanceSchema>, { github: unknown }>["github"]
  try {
    const value = body.frozen
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "content_sha256,metadata,provenance,size_bytes")
      throw new Error()
    frozen = value as Record<string, unknown>
    const provenance = skillCreationProvenanceSchema.parse(frozen.provenance)
    if (!("github" in provenance) || frozen.content_sha256 !== provenance.github.content_sha256 || frozen.size_bytes !== provenance.github.size_bytes)
      throw new Error()
    github = provenance.github
    const wire = frozen.metadata as Record<string, unknown> | null
    if (!wire || typeof wire !== "object" || Array.isArray(wire)) throw new Error()
    const metadata = skillMetadataInputSchema.parse({
      display_name: wire.display_name,
      summary: wire.summary,
      tags: wire.tags,
      ...(wire.example_prompts === undefined ? {} : { example_prompts: (wire.example_prompts as Record<string, unknown>)?.prompts }),
      ...(wire.category_keys === undefined ? {} : { category_keys: (wire.category_keys as Record<string, unknown>)?.keys }),
    })
    if (!isDeepStrictEqual(skillMetadataWire(metadata), wire) || sha256Jcs(immutableSkillImportSnapshot(frozen)).sha256 !== receipt.fingerprint)
      throw new Error()
  } catch {
    throw new Error("skill_checkpoint_unavailable")
  }
  // Same exact spelling as the fixed provider's original repository/commit/path validation.
  if (
    github.repository_url !== `https://github.com/${selector.owner}/${selector.repository}` ||
    github.owner_login !== selector.owner ||
    github.owner_url !== `https://github.com/${selector.owner}` ||
    github.commit !== selector.commit ||
    github.path !== selector.path
  )
    throw new Error("skill_idempotency_conflict")
  await readmit(signal)
  signal.throwIfAborted()
  return importSkillPackage(context, commandId, { frozen }, client, store, origin, signal, deadlineAt)
}

/** The shared package command chain is specific to these two provenance-bearing Skill imports. */
async function importSkillPackage(
  context: RequestContext,
  commandId: string,
  source: Readonly<{ frozen: Record<string, unknown>; bytes?: Buffer }>,
  client: SkillProductConnectClient,
  store: BffBusinessStore,
  origin: string,
  signal: AbortSignal,
  deadlineAt: number,
) {
  try {
    const { bytes, frozen } = source
    const provenance = skillCreationProvenanceSchema.parse(frozen.provenance)
    const digest = frozen.content_sha256,
      sizeBytes = frozen.size_bytes
    const facts = "ai" in provenance ? provenance.ai : "github" in provenance ? provenance.github : null
    if (
      !facts ||
      digest !== facts.content_sha256 ||
      sizeBytes !== facts.size_bytes ||
      (bytes !== undefined && (createHash("sha256").update(bytes).digest("hex") !== digest || String(bytes.length) !== sizeBytes))
    )
      throw new Error("skill_response_invalid")
    const common = { requestId: context.requestId, tenant: context.identity.namespace, subject: context.identity.userId }
    const fingerprint = sha256Jcs(immutableSkillImportSnapshot(frozen)).sha256
    const adoptFrozen =
      "github" in provenance
        ? (value: unknown): Record<string, unknown> => {
            if (
              !value ||
              typeof value !== "object" ||
              Array.isArray(value) ||
              sha256Jcs(immutableSkillImportSnapshot(value as Record<string, unknown>)).sha256 !== fingerprint
            )
              throw new Error("skill_checkpoint_unavailable")
            return value as Record<string, unknown>
          }
        : undefined
    const completeMembers = (
      admission: {
        skillId: string
        attemptId: string
        uploadId: string
        stateVersion: string
      },
      version: string,
    ): Record<string, JsonValue> => ({
      skill_id: { value: admission.skillId },
      attempt_id: admission.attemptId,
      upload_id: admission.uploadId,
      source_version_id: version,
      content_sha256: digest,
      size_bytes: sizeBytes,
      expected_state_version: admission.stateVersion,
    })
    return await handoffSkillPackage(
      {
        scope: JSON.stringify([common.tenant, common.subject, "skill-import-v1", commandId]),
        fingerprint,
        frozen,
        commandId,
        ...(adoptFrozen ? { adoptFrozen } : {}),
      },
      store,
      {
        create: async (id, selectedFrozen) => {
          if (bytes === undefined) throw new Error("skill_checkpoint_unavailable")
          const result = await client.command(
            "createSkillDraft",
            { ...common, commandId: id },
            {
              owner_scope: { kind: "user", id: common.subject },
              metadata: selectedFrozen.metadata as JsonValue,
              creation_provenance: skillCreationProvenanceSchema.parse(selectedFrozen.provenance) as JsonValue,
            },
            signal,
            deadlineAt,
          )
          assertSkillWireKnown(result)
          if (
            !("skillId" in result) ||
            !("status" in result) ||
            result.status !== 1 ||
            !("revision" in result) ||
            result.revision !== 1n ||
            !("stateVersion" in result)
          )
            throw new Error("skill_response_invalid")
          return {
            skillId: skillIdSchema.parse(result.skillId?.value),
            stateVersion: skillDecimalSchema.parse(result.stateVersion.toString()),
          }
        },
        begin: async (id, skillId, stateVersion) => {
          if (bytes === undefined) throw new Error("skill_checkpoint_unavailable")
          const result = await client.command(
            "beginSkillPackageUpload",
            { ...common, commandId: id },
            {
              skill_id: { value: skillId },
              expected_state_version: stateVersion,
              filename: "skill.zip",
              mime_type: "application/zip",
              size_bytes: sizeBytes,
              content_sha256: digest,
            },
            signal,
            deadlineAt,
          )
          assertSkillWireKnown(result)
          if (
            !("transferReference" in result) ||
            !("attemptId" in result) ||
            !("attemptEpoch" in result) ||
            !("uploadId" in result) ||
            result.skillId?.value !== skillId
          )
            throw new Error("skill_response_invalid")
          return {
            skillId,
            attemptId: skillIdSchema.parse(result.attemptId),
            uploadId: skillIdSchema.parse(result.uploadId),
            attemptEpoch: skillDecimalSchema.parse(result.attemptEpoch.toString()),
            stateVersion: skillDecimalSchema.parse(result.stateVersion.toString()),
          }
        },
        status: async (skillId) => {
          const result = await client.getPackageUpload({ ...common, skillId }, signal, deadlineAt)
          assertSkillWireKnown(result)
          return {
            skillId: skillIdSchema.parse(result.skillId?.value),
            attemptId: skillIdSchema.parse(result.attemptId),
            uploadId: skillIdSchema.parse(result.uploadId),
            attemptEpoch: skillDecimalSchema.parse(result.attemptEpoch.toString()),
            sourceVersionId: result.sourceVersionId ?? null,
          }
        },
        put: async (admission) => {
          if (bytes === undefined) throw new Error("skill_checkpoint_unavailable")
          // Replayed Begin must identify precisely the already persisted attempt; it never admits a replacement.
          const result = await client.command(
            "beginSkillPackageUpload",
            { ...common, commandId: `${commandId}.begin` },
            {
              skill_id: { value: admission.skillId },
              expected_state_version: admission.initialStateVersion,
              filename: "skill.zip",
              mime_type: "application/zip",
              size_bytes: sizeBytes,
              content_sha256: digest,
            },
            signal,
            deadlineAt,
          )
          assertSkillWireKnown(result)
          if (
            !("transferReference" in result) ||
            !("attemptId" in result) ||
            !("uploadId" in result) ||
            !("attemptEpoch" in result) ||
            result.skillId?.value !== admission.skillId ||
            result.attemptId !== admission.attemptId ||
            result.uploadId !== admission.uploadId ||
            result.attemptEpoch.toString() !== admission.attemptEpoch ||
            result.stateVersion.toString() !== admission.stateVersion ||
            !result.transferReference
          )
            throw new Error("skill_response_invalid")
          const reference = result.transferReference
          return putStorageBytes(
            {
              url: reference.url,
              method: reference.method,
              headers: reference.requiredHeaders,
              expiresAt: Date.parse(skillTimestamp(reference.expiresAt)),
            },
            bytes,
            "application/zip",
            origin,
            signal,
          )
        },
        completion: (admission, version) => ({
          sourceVersionId: version,
          commandId: `${commandId}.complete`,
          requestDigest: projectSkillProductCommand(
            JSON.stringify({
              command_digest_version: "3.0.0",
              fq_method: "kokoro.platform.v1.SkillCatalogService/CompleteSkillPackageUpload",
              tenant_ref: common.tenant,
              request: {
                ...completeMembers(admission, version),
                product_context: {
                  subject_id: common.subject,
                  owner_scope: { kind: "user", id: common.subject },
                },
              },
            }),
            true,
          ).sha256,
        }),
        complete: async (admission, selected) => {
          const result = await client.command(
            "completeSkillPackageUpload",
            { ...common, commandId: selected.commandId },
            completeMembers(admission, selected.sourceVersionId),
            signal,
            deadlineAt,
          )
          assertSkillWireKnown(result)
          if (
            !("scanState" in result) ||
            !("contentSha256" in result) ||
            result.contentSha256 !== digest ||
            result.skillId?.value !== admission.skillId ||
            result.scanState !== 2
          )
            throw new ConnectError("Package not clean", Code.FailedPrecondition)
          return {
            stateVersion: skillDecimalSchema.parse(result.stateVersion.toString()),
          }
        },
        validate: async (id, admission, stateVersion) => {
          const result = await client.command(
            "validateSkillDraft",
            { ...common, commandId: id },
            {
              skill_id: { value: admission.skillId },
              attempt_id: admission.attemptId,
              expected_state_version: stateVersion,
            },
            signal,
            deadlineAt,
          )
          assertSkillWireKnown(result)
          if (!("valid" in result) || !result.valid || result.skillId?.value !== admission.skillId || !/^[a-f0-9]{64}$/u.test(result.contentDigest))
            throw new ConnectError("Invalid package", Code.FailedPrecondition)
          return {
            skill_id: admission.skillId,
            source_ref: `skill:${admission.skillId}`,
            status: "draft",
            state_version: skillDecimalSchema.parse(result.stateVersion.toString()),
            valid: true,
            content_digest: result.contentDigest,
            manifest_identity: result.manifestIdentity,
          }
        },
      },
      signal,
    )
  } catch (error) {
    // Only trusted source/receipt/owner responses enter this chain; browser input was parsed before it.
    if (error instanceof ZodError) throw new Error("skill_response_invalid", { cause: error })
    throw error
  }
}
export async function skillAiImportRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  config: BffConfig,
  store: BffBusinessStore | null,
  client: SkillProductConnectClient | null,
  readmit: (signal: AbortSignal) => Promise<void>,
) {
  await runSkillRoute(request, response, context, async (signal, deadlineAt) => {
    if (new URL(request.url!, "http://bff.local").search || request.headers["content-type"]?.split(";", 1)[0] !== "application/json")
      throw new ConnectError("Invalid request", Code.InvalidArgument)
    const commandId = skillCommandId(request, context, "ai-import")
    const input = parseSkillProductInput("ai", await readBody(request, 65_536))
    if (!store?.services.skillAiAssociation || !client || !config.storage) throw new ConnectError("Skill dependencies unavailable", Code.Unavailable)
    const association = await store.services.skillAiAssociation(context.identity.namespace, context.identity.userId, input.conversation_id, input.artifact_ref)
    if (!association) throw new ConnectError("No successful immutable artifact", Code.NotFound)
    const storage = new FinalArtifactClient(config.storage, {
      tenantId: context.identity.namespace,
      subjectId: context.identity.userId,
      conversationId: input.conversation_id,
      requestId: context.requestId,
    })
    const item = await storage.get(association, signal)
    if (
      item.mime_type !== "application/zip" ||
      item.artifact_kind !== "archive" ||
      item.size_bytes !== association.sizeBytes ||
      BigInt(item.size_bytes) > 33_554_432n
    )
      throw new Error("skill_response_invalid")
    const spool = await spoolVerifiedArtifact(
      await storage.downloadReference(item, signal),
      Number(item.size_bytes),
      item.content_sha256,
      config.storage.objectOrigin,
      signal,
    )
    try {
      const bytes = await readFile(spool.path)
      const fresh = await store.services.skillAiAssociation(context.identity.namespace, context.identity.userId, input.conversation_id, input.artifact_ref)
      const current = await storage.get(association, signal)
      if (JSON.stringify(fresh) !== JSON.stringify(association) || JSON.stringify(current) !== JSON.stringify(item))
        throw new ConnectError("Artifact no longer admitted", Code.NotFound)
      await readmit(signal)
      signal.throwIfAborted()
      const provenance = {
        ai: {
          conversation_id: association.conversationId,
          run_ref: association.runId,
          artifact_ref: association.artifactId,
          source_event_id: association.sourceEventId,
          source_event_seq: association.sourceEventSeq,
          source_event_digest: association.sourceEventDigest,
          asset_ref: association.sourceAssetId,
          content_sha256: association.sourceContentSha256,
          size_bytes: association.sizeBytes,
          mime_type: "application/zip" as const,
        },
      }
      const result = await importSkillBytes(
        context,
        commandId,
        bytes,
        input.metadata,
        provenance,
        client,
        store,
        config.storage.objectOrigin,
        signal,
        deadlineAt,
      )
      const parsed = skillHandoffResultSchema.safeParse(result)
      if (!parsed.success) throw new Error("skill_response_invalid")
      const data = parsed.data
      signal.throwIfAborted()
      send(response, 201, { data })
    } finally {
      await spool.cleanup()
    }
  })
}
