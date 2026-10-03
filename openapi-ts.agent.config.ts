import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "@hey-api/openapi-ts"

const repositoryRoot = dirname(fileURLToPath(import.meta.url))
const ownerCommit = "79bf98c5aa63b9bace207afdf42d8c7aefee4fe8"

export default defineConfig({
  input: resolve(repositoryRoot, `contract/vendor/kokoro-agent/${ownerCommit}/openapi.json`),
  output: {
    path: process.env.AGENT_HTTP_CLIENT_OUTPUT ?? resolve(repositoryRoot, "src/generated/agent-http"),
    clean: true,
    entryFile: false,
    module: { extension: ".js" },
    tsConfigPath: resolve(repositoryRoot, "tsconfig.json"),
  },
  parser: {
    filters: {
      operations: {
        include: ["POST /v1/runs", "GET /v1/sessions/{session_id}/events", "POST /v1/runs/{run_id}/control"],
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
