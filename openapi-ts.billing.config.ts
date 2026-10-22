import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "@hey-api/openapi-ts"

const repositoryRoot = dirname(fileURLToPath(import.meta.url))
const ownerCommit = "2d3ed0fbee9219a93f02b67b23f69492fd568917"

export default defineConfig({
  input: resolve(repositoryRoot, `contract/vendor/kokoro-billing/${ownerCommit}/openapi.yaml`),
  output: {
    path: process.env.BILLING_HTTP_CLIENT_OUTPUT ?? resolve(repositoryRoot, "src/generated/billing-http"),
    clean: true,
    entryFile: false,
    module: { extension: ".js" },
    tsConfigPath: resolve(repositoryRoot, "tsconfig.json"),
  },
  parser: {
    filters: {
      operations: {
        include: [
          "GET /v1/admin/billing/metering/pricing",
          "POST /v1/admin/billing/metering/rate-revisions",
          "POST /v1/admin/billing/metering/policy-revisions",
          "POST /v1/admin/billing/credit-grants",
          "PUT /v1/billing/me/credit-account",
          "GET /v1/commerce/catalog",
          "GET /v1/billing/me/credit-account",
          "GET /v1/billing/me/credit-ledger",
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
