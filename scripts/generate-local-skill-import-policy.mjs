import { readFile, writeFile } from "node:fs/promises"
import { LOCAL_SKILL_IMPORT_POLICY } from "../src/http/routes/local-skill-import.policy.ts"
const target = new URL("../contract/local-skill-import-policy.json", import.meta.url)
const bytes = JSON.stringify(LOCAL_SKILL_IMPORT_POLICY, null, 2) + "\n"
if (process.argv.includes("--write")) await writeFile(target, bytes)
else if ((await readFile(target, "utf8")) !== bytes) throw new Error("local Skill import private policy drifted")
