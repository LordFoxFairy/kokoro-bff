import { restorePublic20SharedModelCatalogContract } from "../../scripts/shared-model-catalog-public-contract.mjs"
import { restorePublic19SystemModelConnectionContract } from "../../scripts/system-model-connection-public-contract.mjs"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { load } from "js-yaml"
import { inspectOpenApiGovernance, operationBaseline } from "../../scripts/check-contract.mjs"
import {
  inspectClosureIntegrationContract,
  restoreClosureLocalContract,
  restoreClosureMainContract,
  closureLocalBaseline,
  closureMainBaseline,
} from "../../scripts/verify-closure-integration-contract.mjs"
const source = restorePublic19SystemModelConnectionContract(
  restorePublic20SharedModelCatalogContract(await readFile(new URL("../../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")),
)
const baseline = JSON.parse(await readFile(new URL("../../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations
const digest = (value) => createHash("sha256").update(value).digest("hex")

test("Public19 keeps both approved capabilities without reviving retired request shapes", () => {
  const document = load(source),
    schemas = document.components.schemas
  assert.equal(document.info.version, "19.0.0")
  assert.equal(operationBaseline(source).length, 165)
  assert.deepEqual(operationBaseline(source), baseline)
  assert.deepEqual(inspectOpenApiGovernance(source), [])
  for (const [path, method, id] of [
    ["/v1/account/sessions", "get", "listAccountSessions"],
    ["/v1/account/sessions/{session_id}", "delete", "revokeAccountSession"],
    ["/v1/account/profile", "patch", "updateAccountProfile"],
    ["/v1/account/shared-tasks", "get", "listOwnedSharedTasks"],
    ["/v1/account/archived-tasks", "get", "listOwnedArchivedTasks"],
    ["/v1/sessions/{session_id}/archive", "get", "getSessionArchiveState"],
    ["/v1/sessions/{session_id}/archive", "post", "archiveSession"],
    ["/v1/sessions/{session_id}/restore", "post", "restoreSession"],
  ])
    assert.equal(document.paths[path][method].operationId, id)
  assert.deepEqual(schemas.TeamRole.properties.permissions.properties.platform.items.enum, ["execute"])
  assert.ok(schemas.TeamRole.properties.permissions.properties.skill.items.enum.includes("install"))
  assert.equal(document.paths["/v1/projects/{projectId}/skills/{skill}"], undefined)
  assert.equal(schemas.ProjectSkillRequest, undefined)
  for (const name of ["ScheduledTask", "CreateScheduledTaskRequest", "ScheduledTaskPatchRequest"])
    assert.equal(schemas[name].properties.recurrence_anchor_at, undefined)
  assert.deepEqual(schemas.ScheduledTask.properties.frequency.enum, ["daily", "weekly", "monthly", "once"])
  assert.match(
    schemas.MessageCreateRequest.properties.selected_skill_source_refs.description,
    /Omission inherits current project defaults; explicit \[\] selects none/,
  )
  assert.ok(document.paths["/v1/admin/mcp/packages/{package_id}/publish"])
  assert.equal(
    Object.values(schemas).some((schema) => Object.hasOwn(schema.properties ?? {}, "availability")),
    false,
    "unverified availability consumer stays excluded",
  )
})

test("Public19 restores the complete exact two parents and their ordered inventories", () => {
  assert.deepEqual(inspectClosureIntegrationContract(source, baseline), [])
  assert.equal(digest(restoreClosureLocalContract(source)), "f1c60a24f3e78cbd4742703ff53bf3214191de00d287438da0ad4cf12561c30b")
  assert.equal(digest(restoreClosureMainContract(source)), "b4e91483e425fdcc9547eac8bcda554273cbee0863ccb0ddfb185fae18e4e267")
  assert.equal(closureLocalBaseline(baseline).length, 157)
  assert.equal(closureMainBaseline(baseline).length, 146)
})

test("integration proof rejects permissions, aliases, extra blocks and unrelated byte drift", () => {
  for (const changed of [
    source.replace("enum: [execute]", "enum: [read]"),
    source.replace("operationId: listAccountSessions", "operationId: listWrongSessions"),
    source.replace("Current IAM-admitted Product identity projections.", "unrelated drift"),
    source.replace("paths:\n", "paths:\n  /v1/unapproved:\n    get:\n      operationId: unapproved\n"),
    source.replace("additionalProperties: false", "additionalProperties: true"),
    source + "\n",
  ]) {
    assert.notEqual(changed, source)
    assert.ok(inspectClosureIntegrationContract(changed, baseline).length > 0)
    assert.throws(() => restoreClosureLocalContract(changed))
    assert.throws(() => restoreClosureMainContract(changed))
  }
  for (const changed of [baseline.slice(1), [...baseline, baseline[0]], [...baseline].reverse()])
    assert.ok(inspectClosureIntegrationContract(source, changed).length > 0)
})

test("merged canonical SQL adds exactly archive and approved execution binding facts to the intact local owner schema", async () => {
  const schema = await readFile(new URL("../../database/schema.sql", import.meta.url), "utf8")
  const parent = await readFile(new URL("../../contract/tests/closure-local.schema.sql.snapshot", import.meta.url), "utf8")
  const settings = await readFile(new URL("../../contract/tests/settings-main.schema.sql.snapshot", import.meta.url), "utf8")
  assert.equal(digest(parent), "c292decc4e962caaed14f7b92ab139cc74b4c5d5a431584f6b1c45975d48296d")
  assert.equal(digest(settings), "9bf3dd9e18bcf60ae076a9286a5eb585118f90493015c5881e7d5e8b05e6811f")
  const archiveIndexes = settings.match(/-- SET47: organization state[^]*?(?=CREATE TABLE IF NOT EXISTS bff_message \()/u)?.[0]
  assert.ok(archiveIndexes)
  const bindingColumns = "  execution_project_ref TEXT,\n  execution_context_retired_at TIMESTAMPTZ(3),\n"
  const verify = (value) => {
    assert.equal(value.split(bindingColumns).length, 2, "the exact approved execution binding columns must remain present once")
    const dispatch = value.match(/CREATE TABLE IF NOT EXISTS bff_agent_dispatch_outbox \([^]*?\n\);/u)?.[0]
    assert.ok(dispatch)
    assert.equal(dispatch.split(`  identity_assertion_ref TEXT NOT NULL,\n${bindingColumns}  payload JSONB NOT NULL,\n`).length, 2)
    assert.equal(value.split(archiveIndexes).length, 2, "the exact approved main index definitions must remain present once")
    assert.equal(value.split("  archived_at TIMESTAMPTZ(3),\n").length, 2)
    assert.equal(value.replace(bindingColumns, "").replace("  archived_at TIMESTAMPTZ(3),\n", "").replace(archiveIndexes, ""), parent)
  }
  verify(schema)
  for (const drift of [
    schema.replace("archived_at DESC", "archived_at ASC"),
    schema.replace("archived_at IS NULL", "archived_at IS NOT NULL"),
    schema.replace("CREATE TABLE IF NOT EXISTS bff_message (", "CREATE TABLE unapproved(id text);\nCREATE TABLE IF NOT EXISTS bff_message ("),
    schema.replace(bindingColumns, bindingColumns + bindingColumns),
    schema.replace("execution_project_ref TEXT,", "execution_project_ref TEXT NOT NULL,"),
    schema.replace("execution_context_retired_at TIMESTAMPTZ(3),", "execution_context_retired_at TIMESTAMP(3),"),
    schema.replace(bindingColumns, "").replace("CREATE TABLE IF NOT EXISTS bff_message (\n", `CREATE TABLE IF NOT EXISTS bff_message (\n${bindingColumns}`),
  ]) {
    assert.notEqual(drift, schema)
    assert.throws(() => verify(drift))
  }
})
