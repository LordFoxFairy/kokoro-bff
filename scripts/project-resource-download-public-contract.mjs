import {
  restoreScheduledRunsParent,
  scheduledRunsParentBaseline,
  isScheduledRunsContract,
  inspectScheduledRunsContract,
} from "./scheduled-task-runs-public-contract.mjs"
// The additive download operation is checked here; the owner OpenAPI remains its only schema.
import { createHash } from "node:crypto"
import { load } from "js-yaml"

const PATH = "/v1/projects/{projectId}/resources/{asset_id}/content"
const ID = "downloadProjectResource"
const PARENT_SHA256 = "955412b680bf7a2529c4c35f553ff272d7361769ea95bb441ba820b552ffc564"
const digest = (value) => createHash("sha256").update(value).digest("hex")
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const require = (condition, label) => {
  if (!condition) throw Error(`Public19.1 project resource download: ${label}`)
}
const keys = (value) => Object.keys(value ?? {}).sort()

export const isProjectResourceDownloadContract = (source) => /^  version: 19\.1\.0$/mu.test(restoreScheduledRunsParent(source))

function checkOperation(source) {
  const document = load(source)
  const path = document.paths?.[PATH]
  require(same(keys(path), ["get"]), "exactly one GET path without aliases or extra methods")
  const operation = path.get
  require(same(
    keys(operation),
    [
      "description",
      "operationId",
      "parameters",
      "responses",
      "summary",
      "tags",
      "x-kokoro-idempotency",
      "x-kokoro-owner",
      "x-kokoro-permission",
      "x-kokoro-stability",
      "x-kokoro-visibility",
    ].sort(),
  ), "closed operation fields without request body or alternate auth")
  for (const [key, value] of Object.entries({
    operationId: ID,
    "x-kokoro-owner": "kokoro-bff",
    "x-kokoro-visibility": "public",
    "x-kokoro-stability": "beta",
    "x-kokoro-idempotency": "none",
    "x-kokoro-permission": "project.resource.read",
  }))
    require(operation[key] === value, key)
  require(same(operation.tags, ["Projects"]), "Project capability tag")
  require(same(operation.parameters, [
    { $ref: "#/components/parameters/ProjectId" },
    {
      name: "asset_id",
      in: "path",
      required: true,
      schema: {
        type: "string",
        minLength: 1,
        maxLength: 191,
        pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$",
      },
    },
  ]), "only existing Project selector and bounded exact asset path selector")
  for (const marker of [
    "tenant_id, owner_id and deleted_at IS NULL",
    "canonical project ID",
    "Recheck that same Project",
    "No query, request body, alias, presigned URL or partial success",
    "20000 ms",
    "before IAM admission",
    "actual EOF",
    "no stage resets",
    "never holds a Project database lock",
    "not atomic cross-service revocation",
    "300 seconds",
  ])
    require(operation.description.includes(marker), `published boundary ${marker}`)

  require(same(keys(operation.responses), ["200", "400", "401", "403", "404", "429", "502", "503"]), "closed response catalog")
  const success = operation.responses["200"]
  require(same(keys(success), ["content", "description", "headers"]), "binary success fields")
  require(same(success.content, { "*/*": { schema: { type: "string", format: "binary" } } }), "binary-only complete success")
  const expectedHeaders = {
    "x-request-id": { schema: { type: "string" } },
    "Content-Type": { schema: { type: "string" } },
    "Content-Length": { schema: { type: "integer", minimum: 0, maximum: 1048576 } },
    "Content-Disposition": { schema: { type: "string" } },
    "Cache-Control": { schema: { type: "string", const: "no-store" } },
    "Referrer-Policy": { schema: { type: "string", const: "no-referrer" } },
    "X-Content-Type-Options": { schema: { type: "string", const: "nosniff" } },
  }
  require(same(success.headers, expectedHeaders), "complete bounded private download headers")
  for (const marker of ["ASSET and CLEAN", "asset ID, SHA-256, size and MIME", "actual EOF", "before any success", "1048576"])
    require(success.description.includes(marker), `complete verification ${marker}`)
  for (const status of ["400", "401", "403"])
    require(same(operation.responses[status], {
      $ref: `#/components/responses/${status === "400" ? "BadRequest" : "ServiceAuthFailed"}`,
    }), `original ${status} envelope`)
  for (const status of ["404", "429", "502", "503"])
    require(same(operation.responses[status].content, {
      "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } },
    }), `original ${status} error schema`)
  const retry = operation.responses["429"].headers
  require(same(keys(retry), ["Retry-After"]) && same(retry["Retry-After"].schema, { type: "string", pattern: "^[1-9][0-9]{0,4}$" }), "bounded IAM Retry-After")
  require(operation.responses["404"].description.includes("exact project-scoped ASSET"), "not-found scope")
  require(operation.responses["502"].description.includes("actual EOF or SHA-256"), "invalid object response")
  require(operation.responses["503"].description.includes("never a user login 401"), "dependency auth stays unavailable")
}

export function restoreProjectResourceDownloadParent(source) {
  source = restoreScheduledRunsParent(source)
  if (!isProjectResourceDownloadContract(source)) return source
  checkOperation(source)
  const marker = `  ${PATH}:\n`
  require(source.split(marker).length === 2, "one exact path block")
  const start = source.indexOf(marker)
  const rest = source.slice(start + marker.length)
  const next = rest.search(/^  \/v1\//mu)
  require(next >= 0, "bounded new path block")
  const end = start + marker.length + next
  const parent = (source.slice(0, start) + source.slice(end)).replace(/^  version: 19\.1\.0$/mu, "  version: 19.0.0")
  require(digest(parent) === PARENT_SHA256, "complete exact Public19 parent bytes")
  return parent
}

export function projectResourceDownloadParentBaseline(baseline) {
  baseline = scheduledRunsParentBaseline(baseline)
  const candidates = baseline.filter((entry) => entry.path === PATH || entry.operation_id === ID)
  if (candidates.length === 0) return baseline
  require(baseline.length === 166 && candidates.length === 1, "one additive operation in exact166 inventory")
  require(same(candidates[0], { method: "GET", path: PATH, operation_id: ID }), "exact download inventory tuple")
  return baseline.filter((entry) => entry !== candidates[0])
}

export function inspectProjectResourceDownloadContract(source, baseline) {
  try {
    if (isScheduledRunsContract(source)) {
      const errors = inspectScheduledRunsContract(source, baseline)
      if (errors.length > 0) throw Error(errors.join("; "))
    }
    source = restoreScheduledRunsParent(source)
    baseline = scheduledRunsParentBaseline(baseline)
    require(isProjectResourceDownloadContract(source), "current artifact must be Public19.1.0")
    restoreProjectResourceDownloadParent(source)
    require(projectResourceDownloadParentBaseline(baseline).length === 165, "complete165 parent inventory")
    require(baseline.length === 166, "current166 inventory")
    return []
  } catch (error) {
    return [error.message]
  }
}
