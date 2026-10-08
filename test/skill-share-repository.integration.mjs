import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"
import { Pool } from "pg"
import { PostgresSkillShareRepository, skillShareLockIdentity } from "../dist/infrastructure/postgres/skill-share-repository.js"

test("R353 Skill Share accepts opaque IAM identities and the formal source_ref boundary", () => {
  assert.doesNotThrow(() => skillShareLockIdentity({ tenantId: "tenant|prod", creatorSubjectId: "用户|oidc@example.com" }, "skill:a"))
  assert.doesNotThrow(() => skillShareLockIdentity({ tenantId: "tenant", creatorSubjectId: "user" }, `skill:a${"x".repeat(190)}`))
  assert.throws(() => skillShareLockIdentity({ tenantId: "", creatorSubjectId: "user" }, "skill:a"), /SKILL_SHARE_IDENTITY_INVALID/u)
  assert.throws(() => skillShareLockIdentity({ tenantId: "tenant", creatorSubjectId: "user\u0000bad" }, "skill:a"), /SKILL_SHARE_IDENTITY_INVALID/u)
  assert.throws(() => skillShareLockIdentity({ tenantId: "tenant", creatorSubjectId: "user" }, `skill:a${"x".repeat(191)}`), /SKILL_SHARE_IDENTITY_INVALID/u)
})

const url = process.env.KOKORO_TEST_POSTGRES_URL
const integration = url ? test : test.skip
integration("R353 skill links are tenant/creator/revision bound and do not enter anonymous conversation reads", async () => {
  const pool = new Pool({ connectionString: url })
  const tenantId = `tenant_${randomUUID()}`,
    creatorSubjectId = `user_${randomUUID()}`,
    sourceRef = `skill:${randomUUID()}`
  const repository = new PostgresSkillShareRepository({ pool })
  try {
    const first = await repository.create({ tenantId, creatorSubjectId }, sourceRef, (id) => `/v1/skill-shares/${id}`, null)
    const replay = await repository.create({ tenantId, creatorSubjectId }, sourceRef, (id) => `/v1/skill-shares/${id}`, null)
    assert.equal(replay.shareId, first.shareId)
    assert.equal((await pool.query("SELECT conversation_id,resource_kind FROM bff_share WHERE share_id=$1", [first.shareId])).rows[0].conversation_id, null)
    assert.equal(await repository.findActive("tenant_other", first.shareId), null)
    assert.equal((await repository.revoke({ tenantId, creatorSubjectId }, first.shareId))?.shareId, first.shareId)
    assert.equal(await repository.findActive(tenantId, first.shareId), null)
  } finally {
    await pool.query("DELETE FROM bff_share WHERE tenant_id=$1", [tenantId])
    await pool.end()
  }
})

integration("R353 lock wait crossing expiry rejects the request and leaves no active row", async () => {
  const pool = new Pool({ connectionString: url, max: 3 })
  const scope = { tenantId: `tenant_${randomUUID()}`, creatorSubjectId: `user_${randomUUID()}` },
    sourceRef = "skill:expiry"
  const blocker = await pool.connect()
  const repository = new PostgresSkillShareRepository({ pool })
  try {
    await blocker.query("BEGIN")
    await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [skillShareLockIdentity(scope, sourceRef)])
    const pending = repository.create(scope, sourceRef, (id) => `/v1/skill-shares/${id}`, new Date(Date.now() + 300))
    await new Promise((resolve) => setTimeout(resolve, 500))
    await blocker.query("COMMIT")
    await assert.rejects(() => pending, /SKILL_SHARE_EXPIRY_INVALID/u)
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM bff_share WHERE tenant_id=$1 AND creator_subject_id=$2 AND skill_source_ref=$3 AND revoked_at IS NULL",
          [scope.tenantId, scope.creatorSubjectId, sourceRef],
        )
      ).rows[0].count,
      0,
    )
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined)
    blocker.release()
    await pool.query("DELETE FROM bff_share WHERE tenant_id=$1", [scope.tenantId])
    await pool.end()
  }
})

integration("R353 expiry remains valid at the INSERT statement after an expired active-row lock wait", async () => {
  const pool = new Pool({ connectionString: url, max: 3 })
  const scope = { tenantId: `tenant_${randomUUID()}`, creatorSubjectId: `user_${randomUUID()}` },
    sourceRef = "skill:insert_clock",
    oldShareId = `shr_${randomUUID().replaceAll("-", "")}`
  const blocker = await pool.connect()
  const repository = new PostgresSkillShareRepository({ pool })
  try {
    await pool.query(
      `INSERT INTO bff_share
         (share_id,tenant_id,resource_kind,creator_subject_id,skill_source_ref,url,created_at,expires_at)
       VALUES ($1,$2,'skill_revision',$3,$4,$5,clock_timestamp()-interval '2 seconds',clock_timestamp()-interval '1 second')`,
      [oldShareId, scope.tenantId, scope.creatorSubjectId, sourceRef, `/v1/skill-shares/${oldShareId}`],
    )
    await blocker.query("BEGIN")
    await blocker.query("SELECT 1 FROM bff_share WHERE share_id=$1 FOR UPDATE", [oldShareId])
    const pending = repository.create(scope, sourceRef, (id) => `/v1/skill-shares/${id}`, new Date(Date.now() + 300))
    await new Promise((resolve) => setTimeout(resolve, 500))
    await blocker.query("COMMIT")
    await assert.rejects(() => pending, /SKILL_SHARE_EXPIRY_INVALID/u)
    const rows = await pool.query(
      `SELECT share_id,revoked_at FROM bff_share
        WHERE tenant_id=$1 AND creator_subject_id=$2 AND skill_source_ref=$3 ORDER BY share_id`,
      [scope.tenantId, scope.creatorSubjectId, sourceRef],
    )
    assert.deepEqual(rows.rows, [{ share_id: oldShareId, revoked_at: null }])
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined)
    blocker.release()
    await pool.query("DELETE FROM bff_share WHERE tenant_id=$1", [scope.tenantId])
    await pool.end()
  }
})
