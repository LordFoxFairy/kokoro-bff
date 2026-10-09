import { readFile, writeFile } from "node:fs/promises"
import { SKILL_DOWNLOAD_POLICY } from "../src/http/routes/skill-download.policy.ts"
const target = new URL("../contract/skill-download-policy.json", import.meta.url)
const bytes = JSON.stringify(SKILL_DOWNLOAD_POLICY, null, 2) + "\n"
if (process.argv.includes("--write")) await writeFile(target, bytes)
else if ((await readFile(target, "utf8")) !== bytes) throw new Error("Skill download private policy drifted")
