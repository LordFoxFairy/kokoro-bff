import "reflect-metadata"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { Test } from "@nestjs/testing"
import { Pool } from "pg"
import { BFF_CONFIG, BFF_DATABASE, SESSION_ADMISSION } from "../dist/common/tokens.js"
import { loadConfig } from "../dist/config/runtime.js"
import { BffExpressAdapter } from "../dist/http/bff-express-adapter.js"
import { BFF_NEST_APPLICATION_OPTIONS } from "../dist/main.js"
import { ProjectsModule } from "../dist/modules/projects/projects.module.js"
import { fixtureSessionHeaders, SessionAdmissionDouble, TEST_WEB_ORIGIN } from "./doubles/session-admission.ts"

test("A06 real Project websites HTTP and PostgreSQL protect CAS, ownership and deletion without receipts", { timeout: 30_000 }, async (t) => {
  const postgres = new URL(process.env.KOKORO_TEST_POSTGRES_URL ?? "about:blank")
  const redis = new URL(process.env.KOKORO_TEST_REDIS_URL ?? "about:blank")
  for (const target of [postgres, redis]) assert.ok(["127.0.0.1", "[::1]", "localhost"].includes(target.hostname) && !target.hash)
  assert.ok(["postgres:", "postgresql:"].includes(postgres.protocol))
  assert.match(postgres.pathname, /^\/kokoro_bff_project_websites_[0-9a-f]{32}$/u, "dedicated A06 fixture database required")
  assert.deepEqual(postgres.searchParams.getAll("schema"), ["kokoro_bff"])
  assert.equal(redis.protocol, "redis:")
  assert.match(redis.pathname, /^\/(?:[1-9]|1[0-5])$/u)
  assert.equal(redis.search, "")
  const observer = new Pool({ connectionString: postgres.href, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 2 })
  const tenant = `a06_${randomUUID()}`
  const project = `project_${randomUUID()}`
  const owner = `owner_${randomUUID()}`
  const secret = "a06-project-websites-fixture-secret"
  let app
  t.after(async () => {
    try {
      await app?.close()
    } finally {
      await observer.end()
    }
  })
  assert.deepEqual((await observer.query("SELECT current_database() AS database,current_schema() AS schema")).rows, [
    { database: postgres.pathname.slice(1), schema: "kokoro_bff" },
  ])
  const config = loadConfig({
    KOKORO_BFF_POSTGRES_URL: postgres.href,
    KOKORO_BFF_REDIS_URL: redis.href,
    KOKORO_BFF_SHARED_SECRET: secret,
    KOKORO_IAM_WEB_ORIGIN: TEST_WEB_ORIGIN,
    KOKORO_TENANT_ID: tenant,
    KOKORO_AGENT_ENABLED: "false",
  })
  const admission = new SessionAdmissionDouble({
    "a06-owner": { namespace: tenant, userId: owner },
    "a06-other": { namespace: tenant, userId: "other" },
    "a06-other-tenant": { namespace: tenant + "_elsewhere", userId: owner },
  })
  const module = await Test.createTestingModule({ imports: [ProjectsModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(SESSION_ADMISSION)
    .useValue(admission)
    .compile()
  app = module.createNestApplication(new BffExpressAdapter(), { ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  await app.get(BFF_DATABASE).ready()
  await app.listen(0, "127.0.0.1")
  const base = await app.getUrl(),
    parent = `/v1/projects/${project}`,
    path = `${parent}/websites`
  const site = "https://docs.example.test/guide"
  await observer.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,$2,$3,'A06 project',$1)", [project, tenant, owner])
  const row = async () =>
    (await observer.query("SELECT website_urls,websites_state_version,deleted_at,updated_at,xmin::text FROM bff_project WHERE project_id=$1", [project]))
      .rows[0]
  const countReceipts = async () => (await observer.query("SELECT count(*)::int AS count FROM bff_idempotency_receipt")).rows[0].count
  const beforeReceipts = await countReceipts()
  let requestIndex = 0
  async function call(method = "GET", value, session = "a06-owner", destination = path) {
    const requestId = `a06-websites-${++requestIndex}`
    const response = await fetch(base + destination, {
      method,
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": secret,
        "x-request-id": requestId,
        ...fixtureSessionHeaders(session),
        ...(method === "PUT" ? { "content-type": "application/json" } : {}),
        ...(method === "DELETE" ? { "idempotency-key": "a06-delete-project" } : {}),
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      signal: AbortSignal.timeout(6000),
    })
    const body = await response.json()
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(response.headers.get("x-request-id"), requestId)
    return { status: response.status, body }
  }
  const put = (websites, expected_state_version, session) => call("PUT", { websites, expected_state_version }, session)
  const current = (websites, state_version) => ({ status: 200, body: { data: { project_id: project, websites, state_version } } })
  const unavailable = (reply, status, code) => {
    assert.equal(reply.status, status)
    assert.equal(reply.body.error.code, code)
    assert.equal(Object.hasOwn(reply.body, "data"), false)
    assert.ok(!JSON.stringify(reply.body).includes(site))
  }
  assert.deepEqual(await call(), current([], "1"))
  assert.deepEqual(await put(["HTTPS://DOCS.example.test:443/a/../guide"], "1"), current([site], "2"))
  assert.deepEqual(await call(), current([site], "2"))
  const saved = await row()
  assert.deepEqual(await put([site], "2"), current([site], "2"))
  assert.deepEqual(await row(), saved, "same canonical value does not rewrite the Project row or timestamp")
  unavailable(await put([site], "1"), 412, "project_websites_precondition_failed")
  unavailable(await call("GET", undefined, "a06-other"), 404, "project_not_found")
  unavailable(await put([], "2", "a06-other"), 404, "project_not_found")
  unavailable(await call("GET", undefined, "a06-other-tenant"), 403, "product_tenant_forbidden")
  const candidates = [["https://a.example.test/"], ["https://b.example.test/"]]
  const race = await Promise.all(candidates.map((urls) => put(urls, "2")))
  assert.deepEqual(race.map((result) => result.status).sort(), [200, 412])
  const winner = candidates[race.findIndex((result) => result.status === 200)]
  assert.deepEqual(await call(), current(winner, "3"))
  assert.deepEqual(await put([], "3"), current([], "4"))
  assert.deepEqual(await call(), current([], "4"))
  assert.equal(await countReceipts(), beforeReceipts, "the website write does not create a receipt")
  assert.deepEqual(await put([site], "4"), current([site], "5"))
  assert.equal((await call("DELETE", undefined, "a06-owner", parent)).status, 202)
  const tombstone = await row()
  assert.ok(tombstone.deleted_at instanceof Date)
  assert.deepEqual(tombstone.website_urls, [])
  unavailable(await call(), 404, "project_not_found")
  unavailable(await put([site], "5"), 404, "project_not_found")
})
