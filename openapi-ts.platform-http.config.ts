import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "@hey-api/openapi-ts"

const repositoryRoot = dirname(fileURLToPath(import.meta.url))
const ownerCommit = "e17283888ae1a8cf10365dfc8dd670115d6d187c"
export default defineConfig({
  input: resolve(repositoryRoot, `contract/vendor/kokoro-platform/${ownerCommit}/openapi/platform-http.openapi.json`),
  output: {
    path: process.env.PLATFORM_HTTP_CLIENT_OUTPUT ?? resolve(repositoryRoot, "src/generated/platform-http"),
    clean: true,
    entryFile: false,
    module: { extension: ".js" },
    tsConfigPath: resolve(repositoryRoot, "tsconfig.json"),
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
