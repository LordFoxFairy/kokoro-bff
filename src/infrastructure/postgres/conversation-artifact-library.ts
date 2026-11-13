import { once } from "node:events"
import type { PoolClient, QueryResult, QueryResultRow } from "pg"
import { readCurrentConversation } from "./chat-conversation-access.js"
import { withMessageReadClient } from "./message-parts-read.js"
import type { SkillAiAssociation } from "../../application/skill-ai-handoff.js"
import type {
  ArtifactAssociation,
  ArtifactDetailCandidate,
  ArtifactLibraryCandidate,
  ArtifactLibraryRepository,
  ArtifactPosition,
  SetArtifactFavorite,
} from "../../application/account/artifact-library-repository.js"
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

type LibraryRow = AssociationRow & { favorited: boolean }

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

export type SelectedArtifactInput = Readonly<{
  tenantId: string
  subjectId: string
  artifactId: string
  projectId: string | null
}>

/** Exact BFF relationship only; the caller still obtains fresh Storage metadata. */
export async function selectedArtifactInTransaction(
  client: {
    query: <Row extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) => Promise<QueryResult<Row>>
  },
  input: SelectedArtifactInput,
  lockForCommit = false,
): Promise<ArtifactAssociation | null> {
  const result = await client.query<AssociationRow>(
    `SELECT a.conversation_id,a.artifact_id,a.run_id,a.source_asset_id,a.source_artifact_kind,a.source_content_sha256,a.delivered_at
       FROM bff_conversation_artifact a
       JOIN bff_conversation c ON c.tenant_id=a.tenant_id AND c.conversation_id=a.conversation_id
      WHERE a.tenant_id=$1 AND c.owner_id=$2 AND c.status='active' AND a.artifact_id=$3 AND a.source_owner='kokoro-agent'
        AND (c.project_ref IS NULL OR EXISTS (
          SELECT 1 FROM bff_project p WHERE p.tenant_id=c.tenant_id AND p.owner_id=c.owner_id AND p.deleted_at IS NULL
            AND (p.project_id=c.project_ref OR p.slug=c.project_ref) AND p.project_id=$4
        )) LIMIT 2${lockForCommit ? " FOR SHARE OF c,a NOWAIT" : ""}`,
    [input.tenantId, input.subjectId, input.artifactId, input.projectId],
  )
  return result.rows.length === 1 ? association(result.rows[0]!) : null
}

/** BFF-owned relationship reads; Storage remains the only Artifact metadata owner. */
export class PostgresConversationArtifactLibrary implements ArtifactLibraryRepository {
  public constructor(private readonly database: PostgresBffDatabase) {}

  public findSelectedCandidate(input: SelectedArtifactInput, lifetime: { signal: AbortSignal; deadlineAt: number }): Promise<ArtifactAssociation | null> {
    return withMessageReadClient(this.database.pool, lifetime, (client) => selectedArtifactInTransaction(client, input))
  }

  public async listCandidates(
    tenantId: string,
    subjectId: string,
    position: ArtifactPosition | null,
    limit: number,
    favoritesOnly = false,
  ): Promise<readonly ArtifactLibraryCandidate[]> {
    const result = await this.database.pool.query<LibraryRow>(
      `SELECT association.conversation_id, association.artifact_id, association.run_id,
              association.source_asset_id, association.source_artifact_kind,
              association.source_content_sha256, association.delivered_at, association.favorited_at IS NOT NULL AS favorited
         FROM bff_conversation_artifact AS association
         JOIN bff_conversation AS conversation
           ON conversation.tenant_id = association.tenant_id
          AND conversation.conversation_id = association.conversation_id
        WHERE association.tenant_id = $1
          AND conversation.owner_id = $2
          AND conversation.status = 'active'
          AND (NOT $7::boolean OR association.favorited_at IS NOT NULL)
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
      [tenantId, subjectId, position?.deliveredAt ?? null, position?.conversationId ?? null, position?.artifactId ?? null, limit, favoritesOnly],
    )
    return result.rows.map((row) => ({ ...association(row), favorited: row.favorited }))
  }

  public async findCandidate(
    tenantId: string,
    subjectId: string,
    conversationId: string,
    artifactId: string,
    lifetime?: { signal: AbortSignal; deadlineAt: number },
  ): Promise<ArtifactDetailCandidate | null> {
    return withMessageReadClient(
      this.database.pool,
      lifetime ?? { signal: new AbortController().signal, deadlineAt: performance.now() + 10000 },
      async (client) => {
        const current = await readCurrentConversation(client, tenantId, subjectId, conversationId, undefined, false)
        if (!current) return null
        const result = await client.query<LibraryRow & { private_actor: boolean }>(
          `SELECT a.conversation_id,a.artifact_id,a.run_id,a.source_asset_id,a.source_artifact_kind,a.source_content_sha256,a.delivered_at,
          a.favorited_at IS NOT NULL AS favorited,
          (EXISTS (SELECT 1 FROM bff_agent_dispatch_outbox dispatch WHERE dispatch.tenant_id=a.tenant_id
            AND dispatch.conversation_id=a.conversation_id AND dispatch.run_id=a.run_id AND dispatch.subject_id=$2 AND dispatch.actor_id=$2)
           OR ($5::text=$2 AND NOT EXISTS (SELECT 1 FROM bff_agent_dispatch_outbox dispatch WHERE dispatch.tenant_id=a.tenant_id
            AND dispatch.conversation_id=a.conversation_id AND dispatch.run_id=a.run_id))) AS private_actor
         FROM bff_conversation_artifact a
         WHERE a.tenant_id=$1 AND a.conversation_id=$3 AND a.artifact_id=$4 AND a.source_owner='kokoro-agent'`,
          [tenantId, subjectId, conversationId, artifactId, current.conversation.owner_id],
        )
        const row = result.rows[0]
        if (!row) return null
        const shared = current.projectAccess !== null && !row.private_actor
        const projectRef = current.projectAccess?.project_id ?? null
        return { ...association(row), favorited: shared ? false : row.favorited, projectRef, ...(shared ? { projectAccess: current.projectAccess! } : {}) }
      },
    )
  }

  public async setFavorite(input: SetArtifactFavorite): Promise<boolean | null> {
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(4_500)])
    signal.throwIfAborted()
    const waiting = new AbortController()
    const stopped = once(signal, "abort", { signal: waiting.signal }).then(() => {
      throw signal.reason
    })
    const checkout = this.database.pool.connect()
    let client: PoolClient | undefined
    try {
      try {
        client = await Promise.race([checkout, stopped])
      } catch (error) {
        // The pool has no per-waiter cancellation; a late connection never starts SQL.
        void checkout.then(
          (late) => late.release(),
          () => undefined,
        )
        throw error
      }
      signal.throwIfAborted()
      const result = await Promise.race([
        client.query<{ favorited: boolean }>(
          `WITH active_conversation AS MATERIALIZED (
             SELECT c.tenant_id,c.conversation_id
               FROM bff_conversation c
              WHERE c.tenant_id=$1 AND c.owner_id=$2 AND c.conversation_id=$3 AND c.status='active'
                AND (c.project_ref IS NULL OR EXISTS (
                  SELECT 1 FROM bff_project p WHERE p.tenant_id=c.tenant_id AND p.owner_id=c.owner_id AND p.deleted_at IS NULL
                    AND (p.project_id=c.project_ref OR p.slug=c.project_ref)
                ))
              FOR SHARE OF c NOWAIT
           ), target AS MATERIALIZED (
             SELECT a.tenant_id,a.conversation_id,a.artifact_id,a.favorited_at
               FROM active_conversation c
               JOIN bff_conversation_artifact a ON a.tenant_id=c.tenant_id AND a.conversation_id=c.conversation_id
              WHERE a.artifact_id=$4 AND a.run_id=$5 AND a.source_asset_id=$6 AND a.source_content_sha256=$7
              FOR UPDATE OF a NOWAIT
           ), changed AS (
             UPDATE bff_conversation_artifact a
                SET favorited_at=CASE WHEN $8::boolean THEN CURRENT_TIMESTAMP(3) END
               FROM target t
              WHERE a.tenant_id=t.tenant_id AND a.conversation_id=t.conversation_id AND a.artifact_id=t.artifact_id
                AND (t.favorited_at IS NOT NULL) <> $8::boolean
             RETURNING a.favorited_at IS NOT NULL AS favorited
           )
           SELECT favorited FROM changed
           UNION ALL
           SELECT t.favorited_at IS NOT NULL AS favorited FROM target t
            WHERE (t.favorited_at IS NOT NULL) = $8::boolean`,
          [
            input.tenantId,
            input.subjectId,
            input.conversationId,
            input.artifactId,
            input.runId,
            input.sourceAssetId,
            input.sourceContentSha256,
            input.favorited,
          ],
        ),
        stopped,
      ])
      return result.rows[0]?.favorited ?? null
    } finally {
      waiting.abort()
      client?.release(signal.aborted)
    }
  }
  public async findSkillHandoff(tenantId: string, subjectId: string, conversationId: string, artifactId: string): Promise<SkillAiAssociation | null> {
    const result = await this.database.pool.query<
      AssociationRow & {
        source_event_id: string
        source_sequence: string
        source_digest: string
        source_size_bytes: string
        source_mime: string
      }
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
