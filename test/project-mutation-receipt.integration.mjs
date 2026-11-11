import "reflect-metadata"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { test } from "node:test"
import { Pool } from "pg"
import { PROJECT_IDEMPOTENCY, PROJECT_MUTATIONS } from "../dist/common/tokens.js"
import { loadConfig } from "../dist/config/runtime.js"
import { createProjectLookup } from "../dist/infrastructure/postgres/project-store.js"
import { ProjectMutationMiddleware } from "../dist/modules/projects/project-mutation.middleware.js"
import { ProjectsModule } from "../dist/modules/projects/projects.module.js"
import { fixtureSessionHeaders, SessionAdmissionDouble, TEST_WEB_ORIGIN } from "./doubles/session-admission.ts"

const adminUrl = process.env.KOKORO_TEST_POSTGRES_ADMIN_URL
const integrationTest = adminUrl ? test : test.skip

integrationTest("Project business and completed receipt are atomic in real PostgreSQL", { timeout: 30000 }, async (t) => {
  const adminTarget = new URL(adminUrl)
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(adminTarget.hostname))
  assert.equal(adminTarget.pathname, "/postgres", "local admin connection required")
  const database = `kokoro_bff_r13_${randomUUID().replaceAll("-", "")}`
  const admin = new Pool({ connectionString: adminTarget.href, max: 1 })
  let pool, server
  try {
    await admin.query(`CREATE DATABASE ${database}`)
    const target = new URL(adminTarget)
    target.pathname = `/${database}`
    pool = new Pool({ connectionString: target.href, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 6, statement_timeout: 5000 })
    await pool.query("CREATE SCHEMA kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    // The failing trigger lives only in this unique, owned temporary database.
    await pool.query(`CREATE TABLE r13_receipt_fault (receipt_key TEXT PRIMARY KEY);
      CREATE FUNCTION r13_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status = 200 AND EXISTS (SELECT 1 FROM r13_receipt_fault WHERE receipt_key = (NEW.scope::jsonb ->> 4)) THEN
          RAISE EXCEPTION 'R13 injected completed receipt failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER r13_receipt_fault BEFORE INSERT OR UPDATE ON bff_idempotency_receipt
      FOR EACH ROW EXECUTE FUNCTION r13_fail_receipt()`)
    const tenant = `r13_${randomUUID()}`
    const secret = "r13-fixture-service-secret"
    const config = loadConfig({
      KOKORO_BFF_POSTGRES_URL: target.href + "?schema=kokoro_bff",
      KOKORO_BFF_REDIS_URL: "redis://127.0.0.1:6379/8",
      KOKORO_BFF_SHARED_SECRET: secret,
      KOKORO_IAM_WEB_ORIGIN: TEST_WEB_ORIGIN,
      KOKORO_TENANT_ID: tenant,
    })
    const admission = new SessionAdmissionDouble({ owner: { namespace: tenant, userId: "r13_owner" }, other: { namespace: tenant, userId: "other" } })
    // Reuse production module provider factories without starting unrelated features or Redis.
    const providers = Reflect.getMetadata("providers", ProjectsModule)
    let loseNextCommitAck = false
    const mutationPool = {
      query: pool.query.bind(pool),
      connect: async () => {
        const client = await pool.connect()
        return {
          query: async (sql, ...args) => {
            const result = await client.query(sql, ...args)
            if (sql === "COMMIT" && loseNextCommitAck) {
              loseNextCommitAck = false
              throw new Error("R13 injected COMMIT acknowledgement loss after real PostgreSQL commit")
            }
            return result
          },
          release: client.release.bind(client),
        }
      },
    }
    const mutations = providers.find((provider) => provider.provide === PROJECT_MUTATIONS).useFactory(mutationPool)
    const receipts = providers.find((provider) => provider.provide === PROJECT_IDEMPOTENCY).useFactory(pool)
    let pausedClaim
    const originalClaim = receipts.claimReceipt.bind(receipts)
    receipts.claimReceipt = async (scope, fingerprint) => {
      const result = await originalClaim(scope, fingerprint)
      if (result.claimed && pausedClaim?.key === JSON.parse(scope)[4] && !pausedClaim.taken) {
        const gate = pausedClaim
        gate.taken = true
        gate.entered()
        await gate.resume
      }
      return result
    }
    const pauseNextClaim = (key) => {
      let entered, release
      const waiting = new Promise((resolve) => {
        entered = resolve
      })
      const resume = new Promise((resolve) => {
        release = resolve
      })
      pausedClaim = { key, entered, resume, taken: false }
      return { waiting, release }
    }
    const middleware = new ProjectMutationMiddleware(config, admission, createProjectLookup(pool), mutations, receipts)
    server = createServer((request, response) => {
      // Drop the wire response only after the production route has committed and attempts to send it.
      if (request.headers["x-r13-drop-response"] === "true")
        response.end = () => {
          response.destroy()
          return response
        }
      middleware.use(request, response, () => {
        response.statusCode = 404
        response.end()
      })
    })
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    const call = async (method, path, key, body, session = "owner", extraHeaders = {}) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": secret,
          ...fixtureSessionHeaders(session),
          "content-type": "application/json",
          "idempotency-key": key,
          ...extraHeaders,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(7000),
      })
      return { status: response.status, body: await response.json() }
    }
    const create = (key, name) => call("POST", "/v1/projects", key, { name })
    const update = (project, key, instruction, session) => call("PATCH", `/v1/projects/${project}`, key, { instruction }, session)
    const count = async (sql, values) => (await pool.query(sql, values)).rows[0].count
    const receiptCount = (key) => count("SELECT count(*)::int AS count FROM bff_idempotency_receipt WHERE scope::jsonb ->> 4 = $1", [key])

    await t.test("failed create receipt rolls back Project and permits first successful retry", async () => {
      await pool.query("INSERT INTO r13_receipt_fault VALUES ('r13-fail-create')")
      assert.equal((await create("r13-fail-create", "Atomic create")).status, 503)
      assert.equal(await count("SELECT count(*)::int AS count FROM bff_project WHERE tenant_id=$1 AND name='Atomic create'", [tenant]), 0)
      assert.equal(await receiptCount("r13-fail-create"), 0)
      await pool.query("DELETE FROM r13_receipt_fault WHERE receipt_key='r13-fail-create'")
      const success = await create("r13-fail-create", "Atomic create")
      assert.equal(success.status, 200)
      assert.deepEqual(await create("r13-fail-create", "Atomic create"), success)
      assert.equal((await create("r13-slug-conflict", "Atomic create")).status, 409)
    })

    await t.test("failed instruction receipt rolls back current text and revision; successful old key never overwrites newer text", async () => {
      const project = (await create("r13-instruction-parent", "Instruction rollback")).body.data.project.id
      await pool.query("INSERT INTO r13_receipt_fault VALUES ('r13-fail-instruction')")
      assert.equal((await update(project, "r13-fail-instruction", "older")).status, 503)
      assert.equal((await pool.query("SELECT instruction FROM bff_project WHERE project_id=$1", [project])).rows[0].instruction, null)
      assert.equal(await count("SELECT count(*)::int AS count FROM bff_project_instruction_revision WHERE project_id=$1", [project]), 0)
      assert.equal(await receiptCount("r13-fail-instruction"), 0)
      await pool.query("DELETE FROM r13_receipt_fault WHERE receipt_key='r13-fail-instruction'")
      const first = await update(project, "r13-fail-instruction", "older")
      assert.equal(first.status, 200)
      assert.equal((await update(project, "r13-next-instruction", "newer")).status, 200)
      assert.deepEqual(await update(project, "r13-fail-instruction", "older"), first)
      assert.equal((await pool.query("SELECT instruction FROM bff_project WHERE project_id=$1", [project])).rows[0].instruction, "newer")
      assert.equal(await count("SELECT count(*)::int AS count FROM bff_project_instruction_revision WHERE project_id=$1", [project]), 2)
      assert.equal((await update(project, "r13-fail-instruction", "changed")).status, 409)
      assert.equal((await update(project, "r13-fail-instruction", "older", "other")).status, 404)
    })

    await t.test("lost success response is recovered from the committed original receipt", async () => {
      await assert.rejects(call("POST", "/v1/projects", "r13-lost-ack", { name: "Lost ACK" }, "owner", { "x-r13-drop-response": "true" }))
      const saved = (await pool.query("SELECT status,response_body FROM bff_idempotency_receipt WHERE scope::jsonb ->> 4='r13-lost-ack'")).rows[0]
      assert.equal(saved.status, 200)
      const replay = await create("r13-lost-ack", "Lost ACK")
      assert.deepEqual(replay, { status: saved.status, body: saved.response_body })
      assert.equal(await count("SELECT count(*)::int AS count FROM bff_project WHERE tenant_id=$1 AND name='Lost ACK'", [tenant]), 1)
    })

    await t.test("lost PostgreSQL COMMIT acknowledgement leaves the terminal receipt recoverable", async () => {
      loseNextCommitAck = true
      assert.equal((await create("r13-lost-commit-ack", "Lost commit ACK")).status, 503)
      assert.equal(loseNextCommitAck, false, "the real client committed before the injected exception")
      const saved = (await pool.query("SELECT status,response_body FROM bff_idempotency_receipt WHERE scope::jsonb ->> 4='r13-lost-commit-ack'")).rows[0]
      assert.equal(saved.status, 200, "ROLLBACK after completed COMMIT and outer release must not delete the terminal receipt")
      assert.deepEqual(await create("r13-lost-commit-ack", "Lost commit ACK"), { status: saved.status, body: saved.response_body })
      assert.equal(await count("SELECT count(*)::int AS count FROM bff_project WHERE tenant_id=$1 AND name='Lost commit ACK'", [tenant]), 1)
    })

    for (const changed of [false, true])
      await t.test(`60s reclaim fences an old ${changed ? "different" : "same"}-fingerprint writer`, async () => {
        const suffix = changed ? "different" : "same"
        const key = `r13-stale-${suffix}`
        const project = (await create(`r13-stale-parent-${suffix}`, `Stale ${suffix}`)).body.data.project.id
        const gate = pauseNextClaim(key)
        const old = update(project, key, "old")
        try {
          await gate.waiting
          assert.equal((await update(project, key, "old")).status, 409, "a live pending claim still rejects concurrent requests")
          await pool.query("UPDATE bff_idempotency_receipt SET created_at=CURRENT_TIMESTAMP - INTERVAL '61 seconds' WHERE scope::jsonb ->> 4=$1", [key])
          const winner = await update(project, key, changed ? "new" : "old")
          assert.equal(winner.status, 200)
          assert.equal((await update(project, `r13-after-stale-${suffix}`, "latest")).status, 200)
          gate.release()
          const stale = await old
          if (changed) {
            assert.equal(stale.status, 409)
            assert.equal(stale.body.error.code, "idempotency_conflict")
          } else assert.deepEqual(stale, winner, "an older same-intent ticket replays rather than repeating the mutation")
          assert.equal((await pool.query("SELECT instruction FROM bff_project WHERE project_id=$1", [project])).rows[0].instruction, "latest")
          assert.equal(await count("SELECT count(*)::int AS count FROM bff_project_instruction_revision WHERE project_id=$1", [project]), 2)
        } finally {
          gate.release()
          await old
        }
      })

    await t.test("a receipt lock holds off stale reclaim until business and response commit", async () => {
      const scope = JSON.stringify([tenant, "r13_owner", "PATCH", "/projects/locked", "r13-locked"])
      const fingerprint = "r13-lock-fingerprint"
      assert.equal((await receipts.claimReceipt(scope, fingerprint)).claimed, true)
      await pool.query("UPDATE bff_idempotency_receipt SET created_at=CURRENT_TIMESTAMP - INTERVAL '61 seconds' WHERE scope=$1", [scope])
      let entered, release
      const locked = new Promise((resolve) => {
        entered = resolve
      })
      const resume = new Promise((resolve) => {
        release = resolve
      })
      const project = (await create("r13-lock-parent", "Lock parent")).body.data.project.id
      const work = mutations.withReceipt({ scope, fingerprint }, async (commands) => {
        entered()
        await resume
        return { status: 200, body: { project: await commands.updateInstruction({ tenantId: tenant, subjectId: "r13_owner" }, project, "locked") } }
      })
      let reclaim
      try {
        await locked
        reclaim = receipts.claimReceipt(scope, fingerprint)
        const deadline = performance.now() + 1500
        while (true) {
          const waiting = await count(
            "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'INSERT INTO bff_idempotency_receipt%'",
          )
          if (waiting > 0) break
          assert.ok(performance.now() < deadline, "reclaim must be waiting on the active receipt transaction")
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
        release()
        const completed = await work
        assert.equal(completed.kind, "receipt")
        const reclaimed = await reclaim
        assert.equal(reclaimed.claimed, false)
        assert.deepEqual(reclaimed.receipt.body, completed.receipt.body)
        assert.equal(await count("SELECT count(*)::int AS count FROM bff_project_instruction_revision WHERE project_id=$1", [project]), 1)
      } finally {
        release()
        await work
        await reclaim
      }
    })

    await t.test("missing pending receipt does not fabricate success or execute business", async () => {
      const result = await mutations.withReceipt({ scope: "r13-missing", fingerprint: "missing" }, async () =>
        assert.fail("missing receipt must fence business"),
      )
      assert.deepEqual(result, { kind: "missing" })
    })
  } finally {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()))
    await pool?.end()
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${database}`)
    } finally {
      await admin.end()
    }
  }
})
