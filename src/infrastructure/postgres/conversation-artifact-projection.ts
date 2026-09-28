import type { PoolClient } from "pg"

import { AgUiSourceIdentityConflictError } from "../../application/agui/errors.js"
import type { AgUiSourceProjection } from "../../application/agui/ports/agui-projection-repository.js"

/** Lock before the AG-UI stream: Chat admission and deletion take Conversation first. */
export async function lockArtifactConversation(client: PoolClient, tenantId: string, conversationId: string): Promise<string> {
  const result = await client.query<{ owner_id: string }>(
    `SELECT owner_id FROM bff_conversation
      WHERE tenant_id = $1 AND conversation_id = $2 AND status = 'active'
      FOR UPDATE`,
    [tenantId, conversationId],
  )
  const owner = result.rows[0]?.owner_id
  if (owner === undefined) throw new Error("AGUI_ARTIFACT_BINDING_MISSING")
  return owner
}

/** The immutable Agent claim is admitted only by a BFF-owned dispatch and owner. */
export async function insertArtifactDelivery(
  client: PoolClient,
  tenantId: string,
  conversationId: string,
  ownerId: string,
  source: AgUiSourceProjection,
  expectedRunId: string | null,
  consumerSubjectId: string | null,
): Promise<void> {
  const delivery = source.artifactDelivery
  if (delivery === undefined) return
  // expectedRunId is the latest admitted run, not necessarily this historical
  // delivery's run. Its immutable dispatch row is the per-run admission proof.
  if (expectedRunId === null || consumerSubjectId === null || consumerSubjectId !== ownerId || source.sourceOwner !== "kokoro-agent")
    throw new Error("AGUI_ARTIFACT_BINDING_MISSING")
  try {
    const inserted = await client.query(
      `INSERT INTO bff_conversation_artifact
         (tenant_id, conversation_id, artifact_id, run_id, source_owner, source_event_id,
          source_sequence, source_digest, source_asset_id, source_artifact_kind,
          source_content_sha256, delivered_at)
       SELECT $1, $2, $4, $3, $5, $6, $7, $8, $9, $10, $11, $12
         FROM bff_agent_dispatch_outbox AS dispatch
        WHERE dispatch.tenant_id = $1
          AND dispatch.conversation_id = $2
          AND dispatch.run_id = $3
          AND dispatch.subject_id = $13
          AND dispatch.status <> 'failed'
       RETURNING artifact_id`,
      [
        tenantId,
        conversationId,
        delivery.runId,
        delivery.artifactId,
        source.sourceOwner,
        source.sourceEventId,
        source.sourceSequence,
        source.sourceDigest,
        delivery.assetId,
        delivery.artifactKind,
        delivery.contentSha256,
        source.sourceOccurredAt,
        ownerId,
      ],
    )
    if (inserted.rowCount !== 1) throw new Error("AGUI_ARTIFACT_BINDING_MISSING")
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      throw new AgUiSourceIdentityConflictError()
    }
    throw error
  }
}
