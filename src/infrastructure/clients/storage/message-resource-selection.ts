import { createClient, Code, ConnectError, type Transport } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import type { BffConfig } from "../../../config/runtime.js"
import type { ResolveSelectedResources } from "../../../application/chat-turn-service.js"
import { parseCanonicalResourceReferences, type CanonicalStorageResourceRef } from "../../../domain/chat/resource-reference-selection.js"
import { StorageService, UploadPurpose, ScanState, AssetOrigin } from "../../../generated/storage-connect/kokoro/storage/v3/storage_pb.js"
import type { PostgresBffDatabase } from "../../postgres/client.js"
import { PostgresConversationArtifactLibrary } from "../../postgres/conversation-artifact-library.js"
import { FinalArtifactClient } from "./final-artifact.js"

/** Resolve metadata only; the Agent later reads exact bytes under its own consumer lease. */
export function createMessageResourceResolver(config: BffConfig, database: PostgresBffDatabase, transport?: Transport): ResolveSelectedResources {
  const storage = config.storage
  const client =
    storage === undefined
      ? null
      : createClient(
          StorageService,
          transport ??
            createConnectTransport({
              baseUrl: storage.baseUrl,
              httpVersion: "1.1",
              defaultTimeoutMs: 4500,
              readMaxBytes: 1024 * 1024,
              writeMaxBytes: 1024 * 1024,
            }),
        )
  const library = new PostgresConversationArtifactLibrary(database)
  return async (input, lifetime) => {
    if (!storage || !client) throw new Error("CHAT_RESOURCE_SELECTION_UNAVAILABLE")
    lifetime.signal.throwIfAborted()
    const remaining = Math.floor(lifetime.deadlineAt - performance.now())
    if (remaining < 1) throw new Error("CHAT_TURN_BUDGET_EXHAUSTED")
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(remaining)])
    const refs: CanonicalStorageResourceRef[] = []
    for (const ref of input.refs) {
      signal.throwIfAborted()
      if (ref.kind === "artifact") {
        const association = await library.findSelectedCandidate(
          {
            tenantId: input.tenantId,
            subjectId: input.subjectId,
            artifactId: ref.resource_id,
            projectId: input.projectId,
          },
          { signal, deadlineAt: lifetime.deadlineAt },
        )
        if (association === null) throw new Error("CHAT_RESOURCE_SELECTION_INVALID")
        const item = await new FinalArtifactClient(
          storage,
          {
            tenantId: input.tenantId,
            subjectId: input.subjectId,
            requestId: input.requestId,
            conversationId: association.conversationId,
          },
          transport,
        ).get(association, signal)
        refs.push({
          kind: "artifact",
          resource_id: ref.resource_id,
          asset_id: item.asset_id,
          content_sha256: item.content_sha256,
          size_bytes: item.size_bytes,
          mime_type: item.mime_type,
          filename: item.filename,
          source_scope: {
            kind: "conversation",
            id: association.conversationId,
          },
          source_run_id: item.source_run_id,
        })
        continue
      }
      const scopes: CanonicalStorageResourceRef["source_scope"][] = [
        { kind: "personal", id: input.subjectId },
        ...(input.projectId === null ? [] : [{ kind: "project" as const, id: input.projectId }]),
      ]
      let found: CanonicalStorageResourceRef | undefined
      for (const scope of scopes) {
        signal.throwIfAborted()
        let item
        try {
          item = await client.getAsset(
            { assetId: ref.resource_id },
            {
              signal,
              headers: {
                "x-kokoro-service": "web-bff",
                "x-kokoro-internal-secret": storage.secret,
                "x-kokoro-tenant-id": input.tenantId,
                "x-kokoro-subject-id": input.subjectId,
                "x-kokoro-request-id": input.requestId,
                "x-kokoro-scope-kind": scope.kind,
                "x-kokoro-scope-id": scope.id,
              },
            },
          )
        } catch (error) {
          if (error instanceof ConnectError && error.code === Code.NotFound) continue
          throw error
        }
        if (item.assetId !== ref.resource_id || item.uploadPurpose !== UploadPurpose.ASSET || item.scanState !== ScanState.CLEAN)
          throw new Error("CHAT_RESOURCE_SELECTION_INVALID")
        if (item.$unknown?.length || ![AssetOrigin.UPLOADED, AssetOrigin.GENERATED].includes(item.origin))
          throw new Error("CHAT_RESOURCE_SELECTION_UNAVAILABLE")
        found = {
          kind: "asset",
          resource_id: ref.resource_id,
          asset_id: item.assetId,
          content_sha256: item.contentSha256,
          size_bytes: String(item.sizeBytes),
          mime_type: item.mimeType,
          filename: item.filename,
          source_scope: scope,
        }
        // IDs are owner-unique. Never broaden a successful personal read into another scope.
        break
      }
      if (found === undefined) throw new Error("CHAT_RESOURCE_SELECTION_INVALID")
      refs.push(found)
    }
    signal.throwIfAborted()
    const canonical = parseCanonicalResourceReferences(refs)
    if (canonical === null || !canonical.every((ref) => ref.kind !== "final_answer")) throw new Error("CHAT_RESOURCE_SELECTION_UNAVAILABLE")
    return canonical
  }
}
