import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "@hey-api/openapi-ts"

const repositoryRoot = dirname(fileURLToPath(import.meta.url))
const ownerCommit = "4db7012a85752071f5fd30b9a5a3b4977e9dd4f3"

export default defineConfig({
  input: resolve(repositoryRoot, `contract/vendor/kokoro-iam/${ownerCommit}/iam.internal.v1.json`),
  output: {
    path: process.env.IAM_HTTP_CLIENT_OUTPUT ?? resolve(repositoryRoot, "src/generated/iam-http"),
    clean: true,
    entryFile: false,
    module: { extension: ".js" },
    tsConfigPath: resolve(repositoryRoot, "tsconfig.json"),
  },
  parser: {
    filters: {
      operations: {
        include: [
          "POST /internal/v1/skill-list-identities/verify",
          "POST /internal/v1/skill-list-identities/publisher-profiles/resolve",
          "POST /internal/v1/open-app-registrations/{app_id}/management-authorizations/verify",
          "GET /internal/v1/account/sessions",
          "DELETE /internal/v1/account/sessions/{session_id}",
          "POST /internal/v1/session-authorizations/verify",
          "POST /internal/v1/authorization/check",
          "POST /internal/v1/tenants/{tenant_id}/skill-authorizations/check",
          "POST /internal/v1/tenants/{tenant_id}/publisher-profiles/resolve",
          "GET /internal/v1/tenants/{tenant_id}/members",
          "GET /internal/v1/tenants/{tenant_id}/invitations",
          "GET /internal/v1/tenants/{tenant_id}/roles",
          "POST /internal/v1/tenants/{tenant_id}/invitations",
          "POST /internal/v1/tenants/{tenant_id}/invitations/{invitation_id}/resend",
          "DELETE /internal/v1/tenants/{tenant_id}/invitations/{invitation_id}",
          "PUT /internal/v1/tenants/{tenant_id}/members/{member_id}/roles",
          "DELETE /internal/v1/tenants/{tenant_id}/members/{member_id}",
          "DELETE /internal/v1/tenants/{tenant_id}/members/me",
          "GET /iam/v1/tenants/{tenant_id}/invitations/{invitation_id}/context",
          "POST /iam/v1/tenants/{tenant_id}/invitations/{invitation_id}/accept",
          "POST /iam/v1/tenants/{tenant_id}/invitations/{invitation_id}/reject",
          "PATCH /internal/v1/account/profile",
        ],
      },
      orphans: false,
    },
  },
  plugins: [
    "@hey-api/typescript",
    { name: "zod", compatibilityVersion: 4 },
    {
      name: "@hey-api/client-fetch",
      bundle: true,
      baseUrl: false,
      throwOnError: false,
    },
    {
      name: "@hey-api/sdk",
      operations: { strategy: "flat" },
      paramsStructure: "grouped",
      responseStyle: "fields",
      auth: true,
      validator: { response: "zod" },
      transformer: false,
    },
  ],
})
