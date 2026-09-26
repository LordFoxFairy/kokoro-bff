import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "@hey-api/openapi-ts"

const repositoryRoot = dirname(fileURLToPath(import.meta.url))
const ownerCommit = "6a55ffb4c22f0b155ddb83157735c0ace766701d"

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
          "POST /internal/v1/session-authorizations/verify",
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
