import type { SkillAiAssociation } from "../../application/skill-ai-handoff.js"
import type { ArtifactAssociation, ArtifactLibraryRepository, ArtifactPosition } from "../../application/ports/bff-business-store.js"
import type { PostgresBffDatabase } from "./client.js"

type AssociationRow = {
  conversation_id: string
  artifact_id: string
  run_id: string
  source_asset_id: string
  source_artifact_kind: ArtifactAssociation["sourceArtifactKind"]
  source_content_sha256: string
  delivered_at: Date | string
}

function association(row: AssociationRow): ArtifactAssociation {
  return {
    conversationId: row.conversation_id,
    artifactId: row.artifact_id,
    runId: row.run_id,
    sourceAssetId: row.source_asset_id,
    sourceArtifactKind: row.source_artifact_kind,
    sourceContentSha256: row.source_content_sha256,
    deliveredAt: new Date(row.delivered_at).toISOString(),
  }
}

/** BFF-owned relationship reads; Storage remains the only Artifact metadata owner. */
export class PostgresConversationArtifactLibrary implements ArtifactLibraryRepository {
  public constructor(private readonly database: PostgresBffDatabase) {}

  public async listCandidates(tenantId: string, subjectId: string, position: ArtifactPosition | null, limit: number): Promise<readonly ArtifactAssociation[]> {
    const result = await this.database.pool.query<AssociationRow>(
      `SELECT association.conversation_id, association.artifact_id, association.run_id,
              association.source_asset_id, association.source_artifact_kind,
              association.source_content_sha256, association.delivered_at
         FROM bff_conversation_artifact AS association
         JOIN bff_conversation AS conversation
           ON conversation.tenant_id = association.tenant_id
          AND conversation.conversation_id = association.conversation_id
        WHERE association.tenant_id = $1
          AND conversation.owner_id = $2
          AND conversation.status = 'active'
          AND (
            conversation.project_ref IS NULL
            OR EXISTS (
              SELECT 1 FROM bff_project AS project
               WHERE project.deleted_at IS NULL AND project.tenant_id = conversation.tenant_id
                 AND project.owner_id = conversation.owner_id
                 AND (project.project_id = conversation.project_ref OR project.slug = conversation.project_ref)
            )
          )
          AND ($3::timestamptz IS NULL OR association.delivered_at < $3
               OR (association.delivered_at = $3 AND (association.conversation_id, association.artifact_id) > ($4, $5)))
        ORDER BY association.delivered_at DESC, association.conversation_id ASC, association.artifact_id ASC
        LIMIT $6`,
      [tenantId, subjectId, position?.deliveredAt ?? null, position?.conversationId ?? null, position?.artifactId ?? null, limit],
    )
    return result.rows.map(association)
  }

  public async findCandidate(tenantId: string, subjectId: string, conversationId: string, artifactId: string): Promise<ArtifactAssociation | null> {
    const result = await this.database.pool.query<AssociationRow>(
      `SELECT association.conversation_id, association.artifact_id, association.run_id,
              association.source_asset_id, association.source_artifact_kind,
              association.source_content_sha256, association.delivered_at
         FROM bff_conversation_artifact AS association
         JOIN bff_conversation AS conversation
           ON conversation.tenant_id = association.tenant_id
          AND conversation.conversation_id = association.conversation_id
        WHERE association.tenant_id = $1
          AND conversation.owner_id = $2
          AND conversation.status = 'active'
          AND association.conversation_id = $3 AND association.artifact_id = $4
          AND (
            conversation.project_ref IS NULL
            OR EXISTS (
              SELECT 1 FROM bff_project AS project
               WHERE project.deleted_at IS NULL AND project.tenant_id = conversation.tenant_id
                 AND project.owner_id = conversation.owner_id
                 AND (project.project_id = conversation.project_ref OR project.slug = conversation.project_ref)
            )
          )
        LIMIT 1`,
      [tenantId, subjectId, conversationId, artifactId],
    )
    return result.rows[0] === undefined ? null : association(result.rows[0])
  }
  public async findSkillHandoff(tenantId: string, subjectId: string, conversationId: string, artifactId: string): Promise<SkillAiAssociation | null> {
    const result = await this.database.pool.query<
      AssociationRow & { source_event_id: string; source_sequence: string; source_digest: string; source_size_bytes: string; source_mime: string }
    >(
      `SELECT a.conversation_id, a.artifact_id, a.run_id, a.source_asset_id, a.source_artifact_kind,
              a.source_content_sha256, a.delivered_at, a.source_event_id, a.source_sequence::text,
              a.source_digest, a.source_size_bytes::text, a.source_mime
         FROM bff_conversation_artifact AS a
         JOIN bff_conversation AS c ON c.tenant_id = a.tenant_id AND c.conversation_id = a.conversation_id
         JOIN bff_skill_usage_run_terminal AS t ON t.tenant_id = a.tenant_id AND t.run_id = a.run_id
              AND t.session_id = a.conversation_id AND t.source_owner = 'kokoro-agent' AND t.status = 'completed'
        WHERE a.tenant_id = $1 AND c.owner_id = $2 AND c.status = 'active'
          AND a.conversation_id = $3 AND a.artifact_id = $4 AND a.source_owner = 'kokoro-agent'
          AND a.source_artifact_kind = 'archive' AND a.source_mime = 'application/zip'
          AND a.source_size_bytes BETWEEN 1 AND 33554432
          AND (c.project_ref IS NULL OR EXISTS (
            SELECT 1 FROM bff_project AS p WHERE p.tenant_id = c.tenant_id AND p.owner_id = c.owner_id
              AND p.deleted_at IS NULL AND (p.project_id = c.project_ref OR p.slug = c.project_ref)
          )) LIMIT 1`,
      [tenantId, subjectId, conversationId, artifactId],
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      ...association(row),
      sourceArtifactKind: "archive",
      sourceEventId: row.source_event_id,
      sourceEventSeq: row.source_sequence,
      sourceEventDigest: row.source_digest,
      sizeBytes: row.source_size_bytes,
      mimeType: "application/zip",
    }
  }
}
