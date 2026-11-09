import { createHash } from "node:crypto"
import { scheduledExecutionsParentInventory } from "./scheduled-executions-public-contract.mjs"

// Build/test-only exact inverse: the historical contract and inventory stay frozen.
const digest = (source) => createHash("sha256").update(source).digest("hex")
const operationIds = new Set(["createProjectTask", "updateProjectTask", "deleteProjectTask"])

export function restorePublic2819ProjectTasksContract(source) {
  if (!/^  version: 28\.20\.0$/mu.test(source)) return source
  if (digest(source) !== "c5fc7225901fa5b815cdb7ee5286354d7c4cabed9919676e6e86651fb9910783") throw Error("Project Todo Public28.20 child drift")
  const parent = source
    .replace(
      /^    post:\n      tags: \[Projects\]\n      operationId: createProjectTask\n[\s\S]*?(?=^  \/v1\/projects\/\{projectId\}\/instruction-revisions:)/mu,
      "",
    )
    .replace(/^    ProjectTaskWriteProjectId:\n[\s\S]*?(?=^    ProjectId:)/mu, "")
    .replace(/^    ProjectTaskRevision:\n[\s\S]*?(?=^    TaskListResponse:)/mu, "")
    .replace(/^    ProjectTaskPreconditionFailed:\n[\s\S]*?(?=^    TooManyRequests:)/mu, "")
    .replace("      required: [id, project_id, title, status, updated_at, revision]\n", "      required: [id, project_id, title, status, updated_at]\n")
    .replace("        revision: { $ref: '#/components/schemas/ProjectTaskRevision' }\n", "")
    .replace("  version: 28.20.0\n", "  version: 28.19.0\n")
  if (digest(parent) !== "27032917fb272601b6da8ba9227bab5324ac305682a72c94adca72e4f9e25577") throw Error("Project Todo complete Public28.19 parent drift")
  return parent
}

export function projectTasksParentInventory(inventory) {
  inventory = scheduledExecutionsParentInventory(inventory)
  if (!inventory.some((item) => operationIds.has(item.operation_id))) return inventory
  if (inventory.length !== 203 || digest(JSON.stringify(inventory)) !== "fe45d2b55ffee8152eabf921b620cdd8f6e8e490a7eabdcd85e19a77fdc62e40")
    throw Error("Project Todo Public28.20 inventory drift")
  const parent = inventory.filter((item) => !operationIds.has(item.operation_id))
  if (digest(JSON.stringify(parent)) !== "324cb256e8260ad11530f031051fb03c045cb4abed0d83ae34b13e83eaa9dae7")
    throw Error("Project Todo Public28.19 inventory drift")
  return parent
}
