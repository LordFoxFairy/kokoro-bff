import { createHash } from "node:crypto"
const hash = (value) => createHash("sha256").update(value).digest("hex")

export function restorePublic2822ScheduledExecutionsContract(source) {
  if (!/^  version: 28\.23\.0$/mu.test(source)) return source
  if (hash(source) !== "0abd300ffc5d50d3aefa19832a32feb53ea358933bcc4df655202517554a7504") throw Error("Scheduled executions Public28.23 child drift")
  const parent = source
    .replace(/^  \/v1\/scheduled-tasks\/executions:\n[\s\S]*?(?=^  \/v1\/scheduled-tasks\/\{id\}:)/mu, "")
    .replace(/^    ScheduledTaskExecution:\n[\s\S]*?(?=^    ScheduledTaskLocalDate:)/mu, "")
    .replace(
      "      parameters:\n        - in: query\n          name: project_id\n          description: Exact visible Project filter; omitted lists the current subject's tasks.\n          schema: { type: string, minLength: 1, maxLength: 191 }\n",
      "",
    )
    .replace("  version: 28.23.0\n", "  version: 28.22.0\n")
  if (hash(parent) !== "a3d71aa845265084f7965c06dc903e2a5bf24c47d23bceb9a19bcd5d991c08b4") throw Error("Scheduled executions complete Public28.22 parent drift")
  return parent
}

export function scheduledExecutionsParentInventory(inventory) {
  if (!inventory.some((item) => item.operation_id === "listScheduledTaskExecutions")) return inventory
  if (hash(JSON.stringify(inventory)) !== "9d872bd30fe5a063ec2600d2e5beb59ae30c896fd607ee3eb1a278c95fbb7731")
    throw Error("Scheduled executions current inventory drift")
  const parent = inventory.filter((item) => item.operation_id !== "listScheduledTaskExecutions")
  if (hash(JSON.stringify(parent)) !== "fe45d2b55ffee8152eabf921b620cdd8f6e8e490a7eabdcd85e19a77fdc62e40")
    throw Error("Scheduled executions parent inventory drift")
  return parent
}
