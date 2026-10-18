import { createHash } from "node:crypto"

// Release proof only. Runtime reads and immutable ACKs each have one current schema.
export function restorePublic161ScheduledAnchorContract(source) {
  if (!/^  version: 16\.2\.0$/mu.test(source)) return source
  const digest = (value) => createHash("sha256").update(value).digest("hex")
  const start = source.indexOf("    ScheduledTaskDetails:\n")
  const end = source.indexOf("    ScheduledTaskResponse:\n", start)
  if (start < 0 || end < 0 || digest(source.slice(start, end)) !== "4d0a421aedc8167dffafc31a8d28e68716441fe3e6f8e122163a4d1c618f245a")
    throw Error("Scheduled anchor exact current-read schemas drift")
  let parent = source.slice(0, start) + source.slice(end)
  const detailStart = parent.indexOf("  /v1/scheduled-tasks/{id}:\n")
  const detailEnd = parent.indexOf("    patch:\n", detailStart)
  const detail = parent.slice(detailStart, detailEnd)
  const responseRef = "#/components/schemas/ScheduledTaskDetailResponse'"
  if (detailStart < 0 || detailEnd < 0 || detail.split(responseRef).length !== 2) throw Error("Scheduled anchor detail GET binding drift")
  parent = parent.slice(0, detailStart) + detail.replace(responseRef, "#/components/schemas/ScheduledTaskResponse'") + parent.slice(detailEnd)
  const listStart = parent.indexOf("    ScheduledTaskListResponse:\n")
  const listEnd = parent.indexOf("    CreateScheduledTaskRequest:\n", listStart)
  const list = parent.slice(listStart, listEnd)
  const itemRef = "#/components/schemas/ScheduledTaskDetails'"
  if (listStart < 0 || listEnd < 0 || list.split(itemRef).length !== 2) throw Error("Scheduled anchor list GET binding drift")
  parent = (parent.slice(0, listStart) + list.replace(itemRef, "#/components/schemas/ScheduledTask'") + parent.slice(listEnd)).replace(
    "  version: 16.2.0",
    "  version: 16.1.0",
  )
  if (digest(parent) !== "930ba94677ce83655ab6ee73c6bb18404e0c84a29de602a128a77d6a7fb87ad5")
    throw Error("Scheduled anchor complete Public16.1 parent inverse drift")
  return parent
}
