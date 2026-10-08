import { randomUUID } from "node:crypto"
import type { SkillShareRepository, SkillShareScope } from "../../application/ports/skill-share-repository.js"
import type { SkillRevisionShare } from "../../domain/chat/share.js"
import type { PostgresBffDatabase } from "./client.js"
import { shareColumns, shareFromRow, type ShareRow } from "./chat-repository-mappers.js"

const SOURCE_REF = /^skill:[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u

export function skillShareLockIdentity(scope: SkillShareScope, sourceRef: string): string {
  checkedOpaqueIdentity(scope.tenantId)
  checkedOpaqueIdentity(scope.creatorSubjectId)
  checked(sourceRef, SOURCE_REF)
  return JSON.stringify([scope.tenantId, scope.creatorSubjectId, sourceRef])
}

function checkedOpaqueIdentity(value: string): string {
  if (value.trim() === "" || value.includes("\u0000") || [...value].length > 255) throw new Error("SKILL_SHARE_IDENTITY_INVALID")
  return value
}

function checked(value: string, pattern: RegExp): string {
  if (!pattern.test(value)) throw new Error("SKILL_SHARE_IDENTITY_INVALID")
  return value
}

function skillShare(row: ShareRow): SkillRevisionShare {
  const share = shareFromRow(row)
  if (share.resourceKind !== "skill_revision") throw new Error("SKILL_SHARE_RESOURCE_INVALID")
  return share
}

export class PostgresSkillShareRepository implements SkillShareRepository {
  public constructor(private readonly database: PostgresBffDatabase) {}

  public async create(scope: SkillShareScope, sourceRef: string, urlFor: (shareId: string) => string, expiresAt: Date | null): Promise<SkillRevisionShare> {
    const lockIdentity = skillShareLockIdentity(scope, sourceRef)
    if (expiresAt !== null && !Number.isFinite(expiresAt.getTime())) throw new Error("SKILL_SHARE_EXPIRY_INVALID")
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [lockIdentity])
      const databaseClock = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")
      if (expiresAt !== null && (databaseClock.rows[0] === undefined || expiresAt.getTime() <= databaseClock.rows[0].now.getTime())) {
        throw new Error("SKILL_SHARE_EXPIRY_INVALID")
      }
      await client.query(
        `UPDATE bff_share SET revoked_at=clock_timestamp()
          WHERE tenant_id=$1 AND creator_subject_id=$2 AND skill_source_ref=$3 AND resource_kind='skill_revision'
            AND revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at<=clock_timestamp()`,
        [scope.tenantId, scope.creatorSubjectId, sourceRef],
      )
      const current = await client.query<ShareRow>(
        `SELECT ${shareColumns} FROM bff_share
          WHERE tenant_id=$1 AND creator_subject_id=$2 AND skill_source_ref=$3 AND resource_kind='skill_revision'
            AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp()) LIMIT 1`,
        [scope.tenantId, scope.creatorSubjectId, sourceRef],
      )
      if (current.rows[0] !== undefined) {
        await client.query("COMMIT")
        return skillShare(current.rows[0])
      }
      const shareId = `shr_${randomUUID().replaceAll("-", "")}`
      const inserted = await client.query<ShareRow>(
        `INSERT INTO bff_share (share_id,tenant_id,resource_kind,creator_subject_id,skill_source_ref,url,expires_at)
         SELECT $1,$2,'skill_revision',$3,$4,$5,$6::timestamptz
          WHERE $6::timestamptz IS NULL OR $6::timestamptz>clock_timestamp()
         RETURNING ${shareColumns}`,
        [shareId, scope.tenantId, scope.creatorSubjectId, sourceRef, urlFor(shareId), expiresAt],
      )
      if (inserted.rows[0] === undefined) throw new Error("SKILL_SHARE_EXPIRY_INVALID")
      await client.query("COMMIT")
      return skillShare(inserted.rows[0])
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  public async revoke(scope: SkillShareScope, shareId: string): Promise<SkillRevisionShare | null> {
    checkedOpaqueIdentity(scope.tenantId)
    checkedOpaqueIdentity(scope.creatorSubjectId)
    checkedOpaqueIdentity(shareId)
    const result = await this.database.pool.query<ShareRow>(
      `UPDATE bff_share SET revoked_at=CURRENT_TIMESTAMP(3)
        WHERE share_id=$1 AND tenant_id=$2 AND creator_subject_id=$3 AND resource_kind='skill_revision' AND revoked_at IS NULL
        RETURNING ${shareColumns}`,
      [shareId, scope.tenantId, scope.creatorSubjectId],
    )
    return result.rows[0] === undefined ? null : skillShare(result.rows[0])
  }

  public async findActive(tenantId: string, shareId: string): Promise<SkillRevisionShare | null> {
    checkedOpaqueIdentity(tenantId)
    checkedOpaqueIdentity(shareId)
    const result = await this.database.pool.query<ShareRow>(
      `SELECT ${shareColumns} FROM bff_share WHERE share_id=$1 AND tenant_id=$2 AND resource_kind='skill_revision'
       AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP(3)) LIMIT 1`,
      [shareId, tenantId],
    )
    return result.rows[0] === undefined ? null : skillShare(result.rows[0])
  }
}
