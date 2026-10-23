import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { dump } from "js-yaml"
import { z } from "zod"
import {
  projectExecutionBindingRequest,
  projectExecutionBindingResponse,
  projectExecutionBindingError,
} from "../src/http/project-execution-binding.contract.ts"
import {
  agentModelAdmissionRequest,
  agentModelAdmissionResponse,
  agentModelAdmissionError,
  agentModelSettlementRequest,
  agentModelSettlementResponse,
  agentModelSettlementError,
} from "../src/http/model-admission.contract.ts"
const json = (schema) => z.toJSONSchema(schema, { target: "draft-2020-12" })
const content = (schema) => ({ "application/json": { schema } })
const response = (description, schema) => ({ description, headers: { "x-request-id": { schema: { type: "string" } } }, content: content(schema) })
const doc = {
  openapi: "3.1.0",
  info: { title: "Kokoro BFF internal project execution binding", version: "1.3.0" },
  paths: {
    "/internal/v1/model-admissions": {
      post: {
        operationId: "createAgentModelAdmission",
        summary: "Reserve or recover one bound model attempt budget for its durable Chat submitter",
        "x-kokoro-owner": "kokoro-bff",
        "x-kokoro-visibility": "internal",
        "x-kokoro-stability": "stable",
        "x-kokoro-idempotency": "permanent-billing-command-receipt",
        "x-kokoro-permission": "agent.model_admission",
        security: [{ AgentModelAdmissionBearer: [] }],
        parameters: [
          { in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", minLength: 8, maxLength: 128, pattern: "^[!-~]+$" } },
          { in: "header", name: "x-billing-execution-proof", required: true, schema: { type: "string", minLength: 1, maxLength: 16384, pattern: "^[!-~]+$" } },
        ],
        requestBody: { required: true, content: content({ $ref: "#/components/schemas/AgentModelAdmissionRequest" }) },
        responses: Object.fromEntries(
          [
            [201, "Original held budget receipt"],
            [400, "Invalid closed request"],
            [403, "Dedicated service or consumption authority denied"],
            [404, "Submission or owner resource not visible"],
            [409, "Permanent command identity conflict"],
            [422, "Insufficient credits, pricing or attempt ineligible"],
            [502, "Invalid upstream acknowledgement"],
            [503, "Dependency or shared deadline unavailable"],
          ].map(([code, description]) => [
            code,
            response(description, {
              $ref: code === 201 ? "#/components/schemas/AgentModelAdmissionResponse" : "#/components/schemas/AgentModelAdmissionError",
            }),
          ]),
        ),
      },
    },
    "/internal/v1/model-admissions/recover": {
      post: {
        operationId: "recoverAgentModelAdmission",
        summary: "Recover only an already committed original budget receipt; never a new reserve or execution permit",
        description:
          "Execution proof and retired consumption headers are forbidden. A 404 means only no committed receipt at the observed point; an original create may still commit later.",
        "x-kokoro-owner": "kokoro-bff",
        "x-kokoro-visibility": "internal",
        "x-kokoro-stability": "stable",
        "x-kokoro-idempotency": "permanent-billing-command-receipt",
        "x-kokoro-permission": "agent.model_admission_recovery",
        security: [{ AgentModelAdmissionBearer: [] }],
        parameters: [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", minLength: 8, maxLength: 128, pattern: "^[!-~]+$" } }],
        requestBody: { required: true, content: content({ $ref: "#/components/schemas/AgentModelAdmissionRequest" }) },
        responses: Object.fromEntries(
          [
            [200, "Original held creation receipt, including after settlement"],
            [400, "Invalid closed request; execution proof and retired consumption headers forbidden"],
            [403, "Dedicated service or original payer denied"],
            [404, "Submission hidden or no committed original receipt at this observation; not proof of cancellation"],
            [409, "Permanent command identity conflict"],
            [502, "Invalid original receipt acknowledgement"],
            [503, "Dependency or shared deadline unavailable"],
          ].map(([code, description]) => [
            code,
            response(description, {
              $ref: code === 200 ? "#/components/schemas/AgentModelAdmissionResponse" : "#/components/schemas/AgentModelAdmissionError",
            }),
          ]),
        ),
      },
    },
    "/internal/v1/model-admissions/{admission_id}/settle": {
      post: {
        operationId: "settleAgentModelAdmission",
        summary: "Apply or recover sealed usage settlement for the original durable Chat submitter; no live user token or execution permission",
        "x-kokoro-owner": "kokoro-bff",
        "x-kokoro-visibility": "internal",
        "x-kokoro-stability": "stable",
        "x-kokoro-idempotency": "permanent-billing-command-receipt",
        "x-kokoro-permission": "agent.model_settlement",
        security: [{ AgentModelAdmissionBearer: [] }],
        parameters: [
          {
            in: "path",
            name: "admission_id",
            required: true,
            schema: { type: "string", format: "uuid", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$(?![\\s\\S])" },
          },
          { in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", minLength: 8, maxLength: 128, pattern: "^[!-~]+$" } },
        ],
        requestBody: { required: true, content: content({ $ref: "#/components/schemas/AgentModelSettlementRequest" }) },
        responses: Object.fromEntries(
          [
            [200, "Original sealed settlement acknowledgement"],
            [400, "Invalid closed request; execution proof and old consumption headers are forbidden"],
            [403, "Dedicated service or original payer denied"],
            [404, "Original submission not visible"],
            [409, "Permanent command conflict"],
            [422, "Evidence or attempt ineligible"],
            [502, "Invalid upstream acknowledgement"],
            [503, "Dependency or shared deadline unavailable"],
          ].map(([code, description]) => [
            code,
            response(description, {
              $ref: code === 200 ? "#/components/schemas/AgentModelSettlementResponse" : "#/components/schemas/AgentModelSettlementError",
            }),
          ]),
        ),
      },
    },
    "/internal/v1/project-execution-bindings/verify": {
      post: {
        operationId: "verifyProjectExecutionBinding",
        summary: "Read current BFF-owned execution intent; not an execution permit",
        "x-kokoro-owner": "kokoro-bff",
        "x-kokoro-visibility": "internal",
        "x-kokoro-stability": "stable",
        "x-kokoro-idempotency": "read-only-no-receipt",
        "x-kokoro-permission": "iam.project_execution_binding",
        security: [{ IamBindingReaderBearer: [] }],
        requestBody: { required: true, content: content({ $ref: "#/components/schemas/ProjectExecutionBindingRequest" }) },
        responses: Object.fromEntries(
          [
            [200, "Current exact binding"],
            [400, "Invalid closed request"],
            [403, "Dedicated service or tenant denied"],
            [404, "Binding is not current or not visible"],
            [503, "Dependency, credential or deadline unavailable"],
          ].map(([code, description]) => [
            code,
            response(description, {
              $ref: code === 200 ? "#/components/schemas/ProjectExecutionBindingResponse" : "#/components/schemas/ProjectExecutionBindingError",
            }),
          ]),
        ),
      },
    },
  },
  components: {
    securitySchemes: {
      AgentModelAdmissionBearer: {
        type: "http",
        scheme: "bearer",
        description: "Fresh receiver-owned independent secret file: fixed kokoro-agent/model_admission/tenant; never an IAM, Web or user token",
      },
      IamBindingReaderBearer: {
        type: "http",
        scheme: "bearer",
        description: "Fresh receiver-owned secret file: fixed kokoro-iam/project_execution_binding/tenant; never a Web or user token",
      },
    },
    schemas: {
      AgentModelSettlementRequest: json(agentModelSettlementRequest),
      AgentModelSettlementResponse: json(agentModelSettlementResponse),
      AgentModelSettlementError: json(agentModelSettlementError),
      AgentModelAdmissionRequest: json(agentModelAdmissionRequest),
      AgentModelAdmissionResponse: json(agentModelAdmissionResponse),
      AgentModelAdmissionError: json(agentModelAdmissionError),
      ProjectExecutionBindingRequest: json(projectExecutionBindingRequest),
      ProjectExecutionBindingResponse: json(projectExecutionBindingResponse),
      ProjectExecutionBindingError: json(projectExecutionBindingError),
    },
  },
}
const output = fileURLToPath(new URL("../contract/openapi/internal/v1/openapi.yaml", import.meta.url))
const body = "# Generated from src/http/project-execution-binding.contract.ts; do not edit.\n" + dump(doc, { lineWidth: 140, noRefs: true })
if (process.argv.includes("--write")) {
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, body)
} else if ((await readFile(output, "utf8")) !== body) throw Error("BFF project execution contract drift")
console.log(`BFF internal1.3.0 ${createHash("sha256").update(body).digest("hex")}`)
