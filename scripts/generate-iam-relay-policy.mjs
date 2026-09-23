import { readFile, writeFile } from "node:fs/promises"

import { IAM_RELAY_POLICY } from "../src/http/routes/iam-protocol-relay.policy.ts"

const target = new URL("../contract/iam-relay-policy.json", import.meta.url)
const bytes = `${JSON.stringify(IAM_RELAY_POLICY, null, 2)}\n`
const mode = process.argv[2]

if (mode === "--write") {
  await writeFile(target, bytes)
} else if (mode === "--check") {
  const current = await readFile(target, "utf8").catch(() => null)
  if (current !== bytes) {
    console.error("BFF IAM relay policy artifact drifted from its runtime source")
    process.exitCode = 1
  }
} else {
  console.error("expected --check or --write")
  process.exitCode = 2
}
