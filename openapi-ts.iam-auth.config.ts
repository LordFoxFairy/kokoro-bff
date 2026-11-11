import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "@hey-api/openapi-ts"

const root = dirname(fileURLToPath(import.meta.url))
export default defineConfig({
  input: resolve(root, "contract/vendor/kokoro-iam/896405d146c4ff96f5f39d5c2ce1bc788d46c2c7/better-auth.v1.7.3.json"),
  output: { path: process.env.IAM_AUTH_CLIENT_OUTPUT ?? resolve(root, "src/generated/iam-auth"), clean: true, entryFile: false, module: { extension: ".js" } },
  parser: { filters: { operations: { include: ["GET /get-session"] }, orphans: false } },
  plugins: ["@hey-api/typescript", { name: "zod", compatibilityVersion: 4 }],
})
