import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "@hey-api/openapi-ts"

const repositoryRoot = dirname(fileURLToPath(import.meta.url))
const ownerCommit = "550d65498822d8d2e629199482de4f6990b62708"

export default defineConfig({
  input: resolve(repositoryRoot, `contract/vendor/kokoro-system/${ownerCommit}/system.openapi.json`),
  output: {
    path: process.env.SYSTEM_HTTP_CLIENT_OUTPUT ?? resolve(repositoryRoot, "src/generated/system-http"),
    clean: true,
    entryFile: false,
    module: { extension: ".js" },
    tsConfigPath: resolve(repositoryRoot, "tsconfig.json"),
  },
  parser: {
    filters: {
      operations: {
        include: [
          "GET /v1/system/model-catalog/catalog",
          "GET /v1/system/model-catalog/labels",
          "GET /v1/system/model-catalog/revisions",
          "GET /v1/system/model-catalog/routing-policies",
          "PUT /v1/system/model-catalog/routing-policies/{label_id}",
          "GET /v1/system/model-catalog/providers",
          "GET /v1/system/model-catalog/definitions",
          "GET /v1/system/features",
          "POST /v1/system/model-catalog/providers",
          "GET /v1/system/model-catalog/provider-creations",
          "POST /v1/system/model-catalog/definitions",
          "POST /v1/system/model-catalog/revisions",
          "POST /v1/system/model-catalog/revisions/{revision_id}/publish",
          "POST /v1/system/model-catalog/labels",
          "PATCH /v1/system/model-catalog/labels/{label_id}",
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
