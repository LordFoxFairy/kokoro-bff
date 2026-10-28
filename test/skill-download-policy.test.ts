import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { SKILL_DOWNLOAD_POLICY } from "../src/http/routes/skill-download.policy.js"

test("exact Skill download private policy is the single strict generated contract", async () => {
  const generated = JSON.parse(await readFile(new URL("../contract/skill-download-policy.json", import.meta.url), "utf8"))
  assert.deepEqual(generated, SKILL_DOWNLOAD_POLICY)
  assert.deepEqual(
    SKILL_DOWNLOAD_POLICY.operations.slice(0, 3).map(({ method, path, qualifier, parameter }) => ({ method, path, qualifier, parameter })),
    [
      { method: "POST", path: "/browser/v1/skill-installations/{installation_id}/download", qualifier: "installation", parameter: "installation_id" },
      { method: "POST", path: "/browser/v1/skills/{version_id}/download", qualifier: "managed", parameter: "version_id" },
      { method: "POST", path: "/browser/v1/skill-shares/{share_id}/download", qualifier: "share", parameter: "share_id" },
    ],
  )
  for (const operation of SKILL_DOWNLOAD_POLICY.operations) {
    assert.deepEqual(operation.request, {
      query: "forbidden",
      idempotencyKey: "forbidden",
      payload: "exactly-zero-bytes",
      contentLength: ["absent", "0"],
      transferEncoding: "forbidden",
    })
    assert.deepEqual(operation.responses[200].properties.data.required, ["source_ref", "revision", "download_info"])
    assert.deepEqual(
      operation.responses.errors.map(({ status }) => status),
      [400, 401, 403, 404, 405, 429, 502, 503, 504],
    )
  }
})

test("Project exact private policy adds only its dual selector operation and preserves all old operations", async () => {
  assert.equal(SKILL_DOWNLOAD_POLICY.version, 2)
  assert.equal(SKILL_DOWNLOAD_POLICY.operations.length, 4)
  const operation = SKILL_DOWNLOAD_POLICY.operations[3]!
  assert.equal(operation.path, "/browser/v1/projects/{projectId}/skill-installations/{installation_id}/download")
  assert.equal(operation.qualifier, "project_installation")
  assert.equal(operation.projectParameter, "projectId")
  assert.deepEqual(operation.projectParameterSchema, operation.parameterSchema)
  assert.deepEqual(operation.request, SKILL_DOWNLOAD_POLICY.operations[0]!.request)
  assert.deepEqual(operation.responses, SKILL_DOWNLOAD_POLICY.operations[0]!.responses)
})
