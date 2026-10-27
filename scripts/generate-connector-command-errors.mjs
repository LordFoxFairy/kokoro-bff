import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { z } from "zod"
import {
  mcpProjectPublishRequest,
  mcpProjectRemoveRequest,
  mcpProjectReceiptRequest,
  mcpProjectPublishAck,
  mcpProjectRemoveAck,
  mcpProjectList,
  mcpProjectReceipt,
  publicationId,
  publicationCursor,
  MCP_PROJECT_PUBLICATION_POLICY,
  mcpProjectPublicationError,
} from "../src/application/mcp-project-publication.contract.ts"
import { CONNECTOR_COMMAND_FAULT_POLICY } from "../src/infrastructure/clients/platform/connector-command-fault.ts"
import {
  MCP_PREPARE_RECEIPT_POLICY,
  mcpPrepareReceiptQuerySchema,
  mcpPrepareReceiptKeySchema,
  mcpPrepareReceiptResponseSchema,
} from "../src/http/mcp-prepare-receipt.contract.ts"

const target = new URL("../contract/connector-command-errors-v1.json", import.meta.url)
const bytes = JSON.stringify(CONNECTOR_COMMAND_FAULT_POLICY, null, 2) + "\n"
if (process.argv.slice(2).join(" ") === "--write") await writeFile(target, bytes)
else if (process.argv.length === 2) {
  if ((await readFile(target, "utf8")) !== bytes) throw new Error("connector command private error policy drifted")
} else throw new Error("unexpected connector error policy generator argument")

// Browser-private publication has one editable schema source; Public24 is not expanded.
const definitions = [
  [
    "/browser/v1/mcp/servers/{server_id}/project-publications",
    "post",
    "publishMcpUrlToProjects",
    mcpProjectPublishRequest,
    mcpProjectPublishAck,
    ["server_id"],
    "manage",
  ],
  ["/browser/v1/projects/{project_id}/mcp-pins", "get", "listProjectMcpPins", null, mcpProjectList, ["project_id"], "read"],
  [
    "/browser/v1/projects/{project_id}/mcp-pins/{pin_id}",
    "delete",
    "removeProjectMcpPin",
    mcpProjectRemoveRequest,
    mcpProjectRemoveAck,
    ["project_id", "pin_id"],
    "manage",
  ],
  ["/browser/v1/mcp/project-publication-receipts", "post", "getMcpProjectPublicationReceipt", mcpProjectReceiptRequest, mcpProjectReceipt, [], "manage"],
]
const json = (schema) => z.toJSONSchema(schema, { target: "draft-2020-12" })
const content = (schema) => ({ "application/json": { schema: json(schema) } })
const paths = {}
for (const [path, method, operationId, input, output, ids, action] of definitions) {
  paths[path] ??= {}
  paths[path][method] = {
    operationId,
    "x-kokoro-owner": "kokoro-bff",
    "x-kokoro-visibility": "browser-private",
    "x-kokoro-stability": "beta",
    "x-kokoro-idempotency":
      method === "get" ? "none" : operationId === "getMcpProjectPublicationReceipt" ? "read-original-owner-receipt" : "permanent-owner-command-receipt",
    "x-kokoro-permission": `mcp_personal.${action}+current_owned_projects`,
    description:
      "Current Session and all canonical owned projects are checked before owner access and before returning facts. ACK is a definition pin, never execution permission. No automatic retry or new key. A missing receipt does not prove no commit.",
    security: [{ ProductSession: [] }],
    parameters: [
      ...ids.map((name) => ({ in: "path", name, required: true, schema: json(publicationId) })),
      ...(input
        ? [{ in: "header", name: "Idempotency-Key", required: true, schema: json(publicationId) }]
        : [
            { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
            { in: "query", name: "cursor", schema: json(publicationCursor) },
          ]),
    ],
    ...(input ? { requestBody: { required: true, content: content(input) } } : {}),
    responses: Object.fromEntries(
      [200, 400, 401, 403, 404, 409, 412, 429, 502, 503].map((status) => [
        status,
        {
          description: status === 200 ? "Exact owner result" : "Closed safe failure; retain original command identity after an unknown outcome",
          headers: {
            "x-request-id": { schema: { type: "string" } },
            "cache-control": { schema: { const: "no-store" } },
            ...(status === 429 ? { "Retry-After": { schema: { type: "string", pattern: "^[1-9][0-9]{0,4}$" } } } : {}),
          },
          content: content(
            status === 200
              ? z.strictObject({ data: output })
              : mcpProjectPublicationError(
                  status,
                  method === "get" ? [CONNECTOR_COMMAND_FAULT_POLICY.mcp.invalid] : Object.values(CONNECTOR_COMMAND_FAULT_POLICY.mcp),
                ),
          ),
        },
      ]),
    ),
  }
}
const publication = {
  openapi: "3.1.0",
  info: { title: "Kokoro BFF browser-private MCP project publication", version: MCP_PROJECT_PUBLICATION_POLICY.version },
  "x-kokoro-publication-policy": MCP_PROJECT_PUBLICATION_POLICY,
  "x-kokoro-shared-command-errors": {
    path: "../../../connector-command-errors-v1.json",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    group: "mcp",
  },
  "x-kokoro-publication-error-vectors": [
    ...Object.values(MCP_PROJECT_PUBLICATION_POLICY.faults),
    ...Object.values(MCP_PROJECT_PUBLICATION_POLICY.admission_faults),
    ...Object.values(CONNECTOR_COMMAND_FAULT_POLICY.mcp).map((value) => ({ ...value, first_rejection_allows_revised_command: false })),
  ].flatMap((value) =>
    [false, true].map((prior_unknown) => ({
      operation: "publish_or_remove",
      status: value.status,
      code: value.code,
      retryable: value.retryable,
      prior_unknown,
      recovery: prior_unknown && value.recovery === "revise_command" ? MCP_PROJECT_PUBLICATION_POLICY.after_unknown_revise_command_recovery : value.recovery,
      new_command_authorized: !prior_unknown && value.first_rejection_allows_revised_command,
      ...(value.first_rejection_allows_revised_command && !prior_unknown
        ? { requires: MCP_PROJECT_PUBLICATION_POLICY.new_command_policy.first_rejection_requires }
        : {}),
    })),
  ),
  paths,
  components: {
    securitySchemes: {
      ProductSession: {
        type: "http",
        scheme: "bearer",
        description: "Existing browser service envelope plus current human Product Session; no new authentication scheme.",
      },
    },
  },
}
const publicationTarget = new URL("../contract/openapi/browser/v1/mcp-project-publication.json", import.meta.url)
const publicationBytes = JSON.stringify(publication, null, 2) + "\n"
if (process.argv.slice(2).join(" ") === "--write") {
  await mkdir(new URL("./", publicationTarget), { recursive: true })
  await writeFile(publicationTarget, publicationBytes)
} else if ((await readFile(publicationTarget, "utf8")) !== publicationBytes) throw new Error("MCP project publication private contract drifted")

// Independent read-only media publication. Existing command/publication parent bytes stay unchanged.
const { MCP_SERVER_ICON_CONTRACT: icon, mcpServerIconId } = await import("../src/application/mcp-server-icon.contract.ts")
const iconTarget = new URL("../contract/openapi/browser/v1/mcp-server-icon.json", import.meta.url)
const iconHeaders = {
  "cache-control": { required: true, schema: { const: "no-store" } },
  "x-request-id": { required: true, schema: { type: "string" } },
}
const iconErrors = (status) => ({
  "application/json": {
    schema: {
      oneOf: icon.errors
        .filter((fault) => fault.status === status)
        .map((fault) => ({
          type: "object",
          required: ["error"],
          additionalProperties: false,
          properties: {
            error: {
              type: "object",
              required: ["code", "message", "retryable"],
              additionalProperties: false,
              properties: { code: { const: fault.code }, message: { type: "string" }, retryable: { const: fault.retryable } },
            },
          },
        })),
    },
  },
})
const iconDocument = {
  openapi: "3.1.0",
  info: { title: "Kokoro BFF browser-private MCP Server icon", version: icon.version },
  "x-kokoro-media-policy": icon,
  paths: {
    [icon.path]: {
      get: {
        operationId: icon.operation_id,
        "x-kokoro-owner": icon.owner,
        "x-kokoro-visibility": icon.visibility,
        "x-kokoro-stability": "beta",
        "x-kokoro-idempotency": "none",
        "x-kokoro-permission": icon.permission,
        description:
          "No query, body or command headers. Independently verifies the complete bounded object, current exact binding and fresh human Session/MCP read before any image bytes. No signed URL is exposed.",
        security: [{ ProductSession: [] }],
        parameters: [{ in: "path", name: "server_id", required: true, schema: json(mcpServerIconId) }],
        responses: {
          200: {
            description: "Complete verified PNG or JPEG bytes, never a JSON envelope or URL",
            headers: {
              ...iconHeaders,
              "content-length": {
                required: true,
                schema: { type: "string", pattern: "^[1-9][0-9]*$" },
                description: "Exact verified binary length, at most 1048576",
              },
              "x-content-type-options": { required: true, schema: { const: "nosniff" } },
              "referrer-policy": { required: true, schema: { const: "no-referrer" } },
            },
            content: Object.fromEntries(icon.success.content_types.map((mime) => [mime, { schema: { type: "string", format: "binary" } }])),
          },
          ...Object.fromEntries(
            [...new Set(icon.errors.map((fault) => fault.status))].map((status) => [
              status,
              {
                description: "Closed existing private MCP read/admission failure; no partial image output or command authorization",
                headers: { ...iconHeaders, ...(status === 429 ? { "Retry-After": { schema: { type: "string", pattern: "^[1-9][0-9]{0,4}$" } } } : {}) },
                content: iconErrors(status),
              },
            ]),
          ),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ProductSession: {
        type: "http",
        scheme: "bearer",
        description: "Existing trusted browser service envelope and current human Product Session, never an owner service credential.",
      },
    },
  },
}
const iconBytes = JSON.stringify(iconDocument, null, 2) + "\n"
if (process.argv.slice(2).join(" ") === "--write") {
  await mkdir(new URL("./", iconTarget), { recursive: true })
  await writeFile(iconTarget, iconBytes)
} else if ((await readFile(iconTarget, "utf8")) !== iconBytes) throw new Error("MCP Server icon private contract drifted")

// The named history query is not a public API or a generic receipt surface.
const prepareReceiptTarget = new URL("../contract/openapi/browser/v1/mcp-prepare-receipt.json", import.meta.url)
const prepareReceiptDocument = {
  openapi: "3.1.0",
  info: { title: "Kokoro BFF browser-private Prepare receipt lookup", version: MCP_PREPARE_RECEIPT_POLICY.version },
  "x-kokoro-lookup-policy": MCP_PREPARE_RECEIPT_POLICY,
  paths: {
    [MCP_PREPARE_RECEIPT_POLICY.path]: {
      get: {
        operationId: MCP_PREPARE_RECEIPT_POLICY.operation_id,
        "x-kokoro-owner": "kokoro-bff",
        "x-kokoro-visibility": "browser-private",
        "x-kokoro-stability": "beta",
        "x-kokoro-idempotency": "lookup_only",
        "x-kokoro-permission": MCP_PREPARE_RECEIPT_POLICY.permission,
        security: [{ ProductSession: [] }],
        parameters: [
          { in: "path", name: "server_id", required: true, schema: json(mcpPrepareReceiptResponseSchema.shape.completed.shape.server.shape.server_id) },
          { in: "query", name: "expected_state_version", required: true, schema: json(mcpPrepareReceiptQuerySchema.shape.expected_state_version) },
          { in: "header", name: "Idempotency-Key", required: true, schema: json(mcpPrepareReceiptKeySchema) },
        ],
        responses: Object.fromEntries(
          [200, 400, 401, 403, 404, 409, 412, 429, 502, 503].map((status) => [
            status,
            {
              description:
                status === 200
                  ? "Historical completed ACK, never Current or negative execution proof"
                  : "Retain original unknown; only a repeated GET lookup is permitted",
              headers: { "cache-control": { required: true, schema: { const: "no-store" } }, "x-request-id": { required: true, schema: { type: "string" } } },
              content:
                status === 200
                  ? content(z.object({ data: mcpPrepareReceiptResponseSchema }).strict())
                  : {
                      "application/json": {
                        schema: {
                          oneOf: MCP_PREPARE_RECEIPT_POLICY.errors
                            .filter((fault) => fault.status === status)
                            .map((fault) => ({
                              type: "object",
                              required: ["error"],
                              additionalProperties: false,
                              properties: {
                                error: {
                                  type: "object",
                                  required: ["code", "message", "retryable"],
                                  additionalProperties: false,
                                  properties: {
                                    code: { const: fault.code },
                                    message: { type: "string" },
                                    retryable: { const: fault.retryable },
                                  },
                                },
                              },
                            })),
                        },
                      },
                    },
            },
          ]),
        ),
      },
    },
  },
  components: { securitySchemes: { ProductSession: { type: "http", scheme: "bearer" } } },
}
const prepareReceiptBytes = JSON.stringify(prepareReceiptDocument, null, 2) + "\n"
if (process.argv.slice(2).join(" ") === "--write") {
  await mkdir(new URL("./", prepareReceiptTarget), { recursive: true })
  await writeFile(prepareReceiptTarget, prepareReceiptBytes)
} else if ((await readFile(prepareReceiptTarget, "utf8")) !== prepareReceiptBytes) throw new Error("MCP Prepare receipt private contract drifted")
