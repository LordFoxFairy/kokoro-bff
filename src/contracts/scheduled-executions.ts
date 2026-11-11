import { createHash } from "node:crypto"

export type ScheduledExecutionScope = Readonly<{ tenantId: string; subjectId: string }>
export type ScheduledExecutionQuery = Readonly<{ taskId?: string; projectId?: string; limit: number; before?: readonly [string, string] }>
export type ScheduledExecution = Readonly<{
  execution_id: string
  task_id: string
  task_title: string
  occurrence_at: string
  state: "queued" | "admitted" | "streaming" | "completed" | "failed" | "cancelled"
  conversation_id: string | null
  project_id: string | null
  run_id: string
  assistant_message_id: string | null
  completed_at: string | null
}>
export type ScheduledExecutionPage = Readonly<{ executions: ScheduledExecution[]; next_cursor: string | null }>

function binding(scope: ScheduledExecutionScope, query: Pick<ScheduledExecutionQuery, "taskId" | "projectId">): string {
  return createHash("sha256")
    .update(JSON.stringify([scope.tenantId, scope.subjectId, query.taskId ?? null, query.projectId ?? null]))
    .digest("base64url")
}

export function scheduledExecutionCursor(scope: ScheduledExecutionScope, query: ScheduledExecutionQuery, position: readonly [string, string]): string {
  return Buffer.from(JSON.stringify([1, binding(scope, query), ...position])).toString("base64url")
}

export function parseScheduledExecutionQuery(params: URLSearchParams, scope: ScheduledExecutionScope): ScheduledExecutionQuery | null {
  if ([...params.keys()].some((key) => !["task_id", "project_id", "limit", "cursor"].includes(key) || params.getAll(key).length !== 1)) return null
  const taskId = params.get("task_id"),
    projectId = params.get("project_id"),
    limitText = params.get("limit"),
    cursor = params.get("cursor")
  if ([taskId, projectId].some((value) => value !== null && (value.length === 0 || value.length > 191 || value.trim() !== value))) return null
  if (limitText !== null && !/^(?:[1-9]|[1-4][0-9]|50)$/u.test(limitText)) return null
  const query: ScheduledExecutionQuery = {
    ...(taskId === null ? {} : { taskId }),
    ...(projectId === null ? {} : { projectId }),
    limit: limitText === null ? 20 : Number(limitText),
  }
  if (cursor === null) return query
  if (cursor.length === 0 || cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/u.test(cursor)) return null
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    if (
      !Array.isArray(value) ||
      value.length !== 4 ||
      value[0] !== 1 ||
      value[1] !== binding(scope, query) ||
      typeof value[2] !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/u.test(value[2]) ||
      !Number.isFinite(Date.parse(value[2])) ||
      typeof value[3] !== "string" ||
      !/^scheduled_agent_[0-9a-f]{32}$/u.test(value[3])
    )
      return null
    return { ...query, before: [value[2], value[3]] }
  } catch {
    return null
  }
}
