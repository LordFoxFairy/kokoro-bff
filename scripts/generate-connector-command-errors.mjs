import { readFile, writeFile } from "node:fs/promises"
import { CONNECTOR_COMMAND_FAULT_POLICY } from "../src/infrastructure/clients/platform/connector-command-fault.ts"

const target = new URL("../contract/connector-command-errors-v1.json", import.meta.url)
const bytes = JSON.stringify(CONNECTOR_COMMAND_FAULT_POLICY, null, 2) + "\n"
if (process.argv.slice(2).join(" ") === "--write") await writeFile(target, bytes)
else if (process.argv.length === 2) {
  if ((await readFile(target, "utf8")) !== bytes) throw new Error("connector command private error policy drifted")
} else throw new Error("unexpected connector error policy generator argument")
