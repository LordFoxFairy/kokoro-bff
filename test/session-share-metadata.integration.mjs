import "reflect-metadata"
import assert from "node:assert/strict"
import { test } from "node:test"
import { Test } from "@nestjs/testing"
import pg from "pg"
import { applyCanonicalSchema, loadCanonicalSchema } from "../scripts/apply-schema.mjs"
import { BFF_NEST_APPLICATION_OPTIONS } from "../dist/main.js"
import { ChatModule } from "../dist/modules/chat/chat.module.js"
import { RunSteerDispatcher } from "../dist/infrastructure/postgres/run-steer-dispatch.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { AGENT_CANCELLATION_DISPATCHER, AGENT_DISPATCH_DISPATCHER, AGUI_PROJECTOR, BFF_CONFIG, BFF_DATABASE, SESSION_ADMISSION } from "../dist/common/tokens.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const url = process.env.KOKORO_TEST_POSTGRES_URL
const integration = url ? test : test.skip

integration("real Nest and PG Session Share metadata preserves owner visibility, current lifecycle and zero-write GET", { timeout: 30000 }, async (t) => {
  assert.match(new URL(url).pathname, /^\/kokoro_bff_share_metadata_[0-9a-f]{32}$/u, "only the controller-owned fresh fixture database")
  const pool = new pg.Pool({ connectionString: url, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 4 })
  let app
  try {
    assert.equal((await pool.query("SELECT to_regclass('kokoro_bff.bff_conversation') AS relation")).rows[0].relation, null)
    await applyCanonicalSchema(url, await loadCanonicalSchema())
    const tenantId = "share-tenant",
      subjectId = "share-owner",
      projectId = "share-project"
    await pool.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,$2,$3,'Share project','share-project-slug')", [
      projectId,
      tenantId,
      subjectId,
    ])
    await pool.query(
      `INSERT INTO bff_conversation(conversation_id,tenant_id,owner_id,title,project_ref,status,deleted_at) VALUES
      ('owned',$1,$2,'Owned',NULL,'active',NULL),('project-owned',$1,$2,'Project',$3,'active',NULL),
      ('foreign-owner',$1,'someone-else','Foreign owner',NULL,'active',NULL),
      ('foreign-tenant','someone-else',$2,'Foreign tenant',NULL,'active',NULL),
      ('deleted',$1,$2,'Deleted',NULL,'deleted',CURRENT_TIMESTAMP(3))`,
      [tenantId, subjectId, projectId],
    )
    const admission = new SessionAdmissionDouble({
      session: { namespace: tenantId, userId: subjectId },
      member: { namespace: tenantId, userId: "someone-else" },
    })
    const config = {
      host: "127.0.0.1",
      port: 0,
      mode: "live",
      domain: "dev.kokoro.localhost",
      tenantId,
      iamBaseUrl: null,
      iamWebOrigin: "https://web.example.test",
      sharedSecret: "share-fixture-service-secret",
      upstreamSecret: null,
      upstreamTimeoutMs: 5000,
      upstreamMaxResponseBytes: 65536,
      schedulerServiceToken: null,
      schedulerTargetUrl: null,
      agentEnabled: false,
      postgresUrl: null,
      redisUrl: null,
      agUi: DEFAULT_AGUI_CONFIG,
      upstreams: {},
    }
    const builder = Test.createTestingModule({ imports: [ChatModule] })
      .overrideProvider(BFF_CONFIG)
      .useValue(config)
      .overrideProvider(BFF_DATABASE)
      .useValue({ pool, redis: Object.freeze({}), notifyAgUiProjection: async () => undefined })
      .overrideProvider(SESSION_ADMISSION)
      .useValue(admission)
    for (const token of [AGENT_DISPATCH_DISPATCHER, AGENT_CANCELLATION_DISPATCHER, AGUI_PROJECTOR, RunSteerDispatcher])
      builder.overrideProvider(token).useValue(null)
    const module = await builder.compile()
    app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, logger: false })
    await app.listen(0, "127.0.0.1")
    const base = await app.getUrl()
    let sequence = 0
    const request = async (path = "/v1/sessions/owned/share", method = "GET", session = "session") => {
      const id = `share-request-${++sequence}`
      const response = await fetch(base + path, {
        method,
        headers: {
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": config.sharedSecret,
          cookie: `kokoro-issuer.session_token=${session}`,
          origin: config.iamWebOrigin,
          "x-request-id": id,
          ...(method === "GET" ? {} : { "idempotency-key": id }),
        },
      })
      const body = await response.json()
      assert.equal(response.headers.get("cache-control"), "no-store")
      assert.equal(response.headers.get("x-request-id"), id)
      assert.equal(body.meta.request_id, id)
      return { status: response.status, body }
    }
    const facts = async () =>
      JSON.stringify(
        (
          await pool.query(`
      SELECT 'conversation' AS kind,to_jsonb(c) AS value,xmin::text AS revision FROM bff_conversation c
      UNION ALL SELECT 'project',to_jsonb(p),xmin::text FROM bff_project p
      UNION ALL SELECT 'share',to_jsonb(s),xmin::text FROM bff_share s
      UNION ALL SELECT 'receipt',to_jsonb(r),xmin::text FROM bff_idempotency_receipt r
      ORDER BY kind,value`)
        ).rows,
      )
    const assertReadOnly = async (read) => {
      const before = await facts()
      await read()
      assert.equal(await facts(), before, "GET does not change facts, expiry state or command receipts")
    }
    await t.test("unshared repeated GET returns null without allocating a Share or receipt", async () => {
      await assertReadOnly(async () => {
        for (let i = 0; i < 2; i++) {
          const result = await request()
          assert.equal(result.status, 200)
          assert.deepEqual(result.body.data, { share: null })
        }
      })
    })
    let shareId
    await t.test("existing POST and DELETE remain authoritative; GET discloses only active safe metadata", async () => {
      const created = await request(undefined, "POST")
      assert.equal(created.status, 200)
      shareId = created.body.data.share_id
      await assertReadOnly(async () => {
        const current = await request()
        assert.equal(current.status, 200)
        assert.equal(current.body.data.share.share_id, shareId)
        assert.deepEqual(Object.keys(current.body.data.share).sort(), ["created_at", "expires_at", "share_id"])
        assert.equal(current.body.data.share.expires_at, null)
      })
      const revoked = await request(undefined, "DELETE")
      assert.equal(revoked.status, 200)
      assert.equal(revoked.body.data.share_id, shareId)
      await assertReadOnly(async () => assert.deepEqual((await request()).body.data, { share: null }))
    })
    await t.test("expired null is read-only and current owner replacement wins over retained history", async () => {
      const created = await request(undefined, "POST")
      assert.equal(created.status, 200)
      const expiredId = created.body.data.share_id
      await pool.query("UPDATE bff_share SET created_at=CURRENT_TIMESTAMP-INTERVAL '2 days',expires_at=CURRENT_TIMESTAMP-INTERVAL '1 day' WHERE share_id=$1", [
        expiredId,
      ])
      await assertReadOnly(async () => assert.deepEqual((await request()).body.data, { share: null }))
      const replacement = await request(undefined, "POST")
      assert.equal(replacement.status, 200)
      assert.notEqual(replacement.body.data.share_id, expiredId)
      await assertReadOnly(async () => assert.equal((await request()).body.data.share.share_id, replacement.body.data.share_id))
      assert.equal(
        (await pool.query("SELECT count(*)::int AS count FROM bff_share WHERE tenant_id=$1 AND conversation_id='owned' AND revoked_at IS NULL", [tenantId]))
          .rows[0].count,
        1,
      )
    })
    await t.test("missing, other owner or tenant, deleted and mismatched scope are indistinguishable", async () => {
      await assertReadOnly(async () => {
        for (const path of ["missing", "foreign-owner", "foreign-tenant", "deleted"]) {
          const result = await request(`/v1/sessions/${path}/share`)
          assert.equal(result.status, 404)
          assert.deepEqual(result.body.error, { code: "session_not_found", message: "Session was not found" })
        }
        const wrongProject = await request("/v1/sessions/owned/share?project_ref=missing")
        assert.equal(wrongProject.status, 404)
        assert.equal(wrongProject.body.error.code, "session_not_found")
        assert.equal((await request("/v1/sessions/owned/share", "GET", "member")).status, 404)
      })
    })
    await t.test("project share requires the same Conversation and Project owner, and a live parent", async () => {
      const created = await request(`/v1/sessions/project-owned/share?project_ref=${projectId}`, "POST")
      assert.equal(created.status, 200)
      await assertReadOnly(async () => {
        assert.equal((await request(`/v1/sessions/project-owned/share?project_ref=${projectId}`)).body.data.share.share_id, created.body.data.share_id)
        assert.equal((await request("/v1/sessions/project-owned/share?scope=direct")).status, 404)
        assert.equal((await request(`/v1/sessions/project-owned/share?scope=direct&project_ref=${projectId}`)).status, 400)
        assert.equal((await request("/v1/sessions/project-owned/share", "GET", "member")).status, 404)
      })
      // Conversation ownership alone must not disclose a locator after its Project changes owner.
      await pool.query("UPDATE bff_project SET owner_id='someone-else' WHERE project_id=$1", [projectId])
      await assertReadOnly(async () => {
        const hidden = await request(`/v1/sessions/project-owned/share?project_ref=${projectId}`)
        assert.equal(hidden.status, 404)
        assert.equal(hidden.body.error.code, "session_not_found")
      })
      await pool.query("UPDATE bff_project SET owner_id=$2 WHERE project_id=$1", [projectId, subjectId])
      await assertReadOnly(async () => {
        const restored = await request(`/v1/sessions/project-owned/share?project_ref=${projectId}`)
        assert.equal(restored.status, 200)
        assert.equal(restored.body.data.share.share_id, created.body.data.share_id)
      })
      await pool.query("UPDATE bff_project SET deleted_at=CURRENT_TIMESTAMP(3) WHERE project_id=$1", [projectId])
      await assertReadOnly(async () => {
        for (const suffix of ["", `?project_ref=${projectId}`]) {
          const hidden = await request("/v1/sessions/project-owned/share" + suffix)
          assert.equal(hidden.status, 404)
          assert.equal(hidden.body.error.code, "session_not_found")
        }
      })
    })
    await t.test("retired Session cannot recover the previously active locator", async () => {
      admission.deny("session", { ok: false, status: 401, code: "session_invalid" })
      await assertReadOnly(async () => assert.equal((await request()).status, 401))
    })
  } finally {
    try {
      await app?.close()
    } finally {
      await pool.end()
    }
  }
})
