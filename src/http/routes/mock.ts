import type { IncomingMessage, ServerResponse } from "node:http"

import type { AgentConnectionSetup, BillingSummary, LibraryItem, Project, ScheduledTask, Skill } from "../../contracts/index.js"
import { failure, ok, type ChatSessionDetail } from "../../contracts/index.js"
import { MockBffStore } from "../../infrastructure/mock/bff-store.js"
import { MoriMockBffStore } from "../../adapters/mori.js"
import { buildAgentControl } from "../../adapters/agent.js"
import { reply } from "../response.js"
import { headerString, idempotencyKey, isRecord, queryOf, type Context } from "../request.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import { chatSessionDetailData, chatSessionsData, chatSseFrame, githubSkillSource, mcpRegisterInput, mockControlReceipt, PLATFORMS, projectData, scheduledData, sessionScope, skillData, taskData } from "./helpers.js"
import { skillCatalogData, skillPoolData } from "./owner.js"
import { mockMoriBusiness } from "./mori.js"

export async function mockBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  segments: string[],
  context: Context,
  store: MockBffStore,
  mori: MoriMockBffStore,
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
  json: Record<string, unknown>,
): Promise<void> {
  const method = request.method || "GET"
  let status = 200
  let payload: unknown

  if (segments[0] === "mori") {
    await mockMoriBusiness(request, response, segments, context, mori, idempotency, mutation, json)
    return
  }
  if (segments[0] === "sessions") {
    const sessionId = segments[1] || ""
    const scoped = sessionScope(request, context)
    if ("error" in scoped) {
      status = 400
      payload = failure("invalid_session_scope", scoped.error, context.requestId)
    } else if (segments.length === 1 && method === "GET") {
      payload = chatSessionsData(store.listSessions(scoped.scope, scoped.projectRef))
    }
    else if (segments.length === 2 && method === "GET") {
      const detail = store.readSession(sessionId, scoped.scope, scoped.projectRef)
      if (detail === undefined) {
        status = 404
        payload = failure("session_not_found", "Session was not found", context.requestId)
      } else payload = chatSessionDetailData(detail)
    } else if (segments.length === 3 && segments[2] === "messages" && method === "GET") {
      const query = queryOf(request)
      const limit = Number(query.get("limit") || "20")
      const cursor = query.get("cursor")?.trim() || undefined
      const result = Number.isInteger(limit) && limit >= 1 && limit <= 100
        ? store.listSessionMessages(sessionId, scoped.scope, scoped.projectRef, cursor, limit)
        : undefined
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        status = 400
        payload = failure("invalid_pagination", "limit must be between 1 and 100", context.requestId)
      } else if (result === undefined) {
        status = 404
        payload = failure("session_not_found", "Session was not found", context.requestId)
      } else if ("invalid_cursor" in result) {
        status = 400
        payload = failure("invalid_cursor", "cursor is invalid", context.requestId)
      } else payload = result
    } else if (segments.length === 3 && segments[2] === "messages" && method === "POST") {
      if (typeof json.content !== "string" || json.content.trim() === "") {
        status = 400
        payload = failure("invalid_message", "Message content is required", context.requestId)
      } else {
        const result = store.submitSessionMessage(sessionId, json.content.trim(), scoped.scope, scoped.projectRef)
        if (result === null) {
          status = 404
          payload = failure("session_not_found", "Session was not found", context.requestId)
        } else {
          status = 202
          payload = result
          setTimeout(() => { store.completeSessionRun(sessionId, result.run_id, json.content as string, scoped.scope, scoped.projectRef) }, 10)
        }
      }
    } else if (segments.length === 3 && segments[2] === "events" && method === "GET") {
      const detail = store.readSession(sessionId, scoped.scope, scoped.projectRef)
      if (detail === undefined) {
        status = 404
        payload = failure("session_not_found", "Session was not found", context.requestId)
      } else {
        const session = store.findSession(sessionId, scoped.scope, scoped.projectRef)
        const lastEventIdHeader = headerString(request.headers["last-event-id"]).trim()
        const cursor = lastEventIdHeader === "" ? 0 : Number(lastEventIdHeader)
        const events = session?.events.filter((event) => event.seq > (Number.isFinite(cursor) ? cursor : 0)) ?? []
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
        })
        if (events.length === 0) {
          response.end(": keep-alive\n\n")
          return
        }
        response.end(events.map((event) => chatSseFrame(event)).join(""))
        return
      }
    } else if (segments.length === 5 && segments[2] === "runs" && segments[4] === "control" && method === "POST") {
      const control = buildAgentControl(sessionId, json)
      const action = control?.kind === "run.cancel"
        ? "cancel"
        : control?.kind === "run.resume"
          ? "resume"
          : control?.kind === "run.steer"
            ? "steer"
            : ""
      const decisions = Array.isArray(json.decisions)
        ? json.decisions.map((decision) => typeof decision === "string" ? decision : JSON.stringify(decision))
        : undefined
      if (control === null || action === "") {
        status = 400
        payload = failure("invalid_run_control", "Control request does not match the v1 contract", context.requestId)
      } else {
        const commandId = idempotencyKey(request) || "mock-command"
        const result = store.controlSessionRun(sessionId, segments[3] || "", action, decisions, scoped.scope, scoped.projectRef)
        if (result === null) {
          status = 404
          payload = failure("run_not_found", "Run was not found", context.requestId)
        } else {
          status = 202
          payload = mockControlReceipt(segments[3] || "", commandId, json)
        }
      }
    } else if (segments.length === 3 && segments[2] === "title" && method === "PATCH") {
      if (typeof json.title !== "string" || json.title.trim() === "") {
        status = 400
        payload = failure("invalid_title", "Title is required", context.requestId)
      } else {
        const session = store.updateSessionTitle(sessionId, json.title.trim(), scoped.scope, scoped.projectRef)
        if (session === null) {
          status = 404
          payload = failure("session_not_found", "Session was not found", context.requestId)
        } else {
          payload = session
        }
      }
    } else if (segments.length === 2 && method === "DELETE") {
      const deleted = store.deleteSession(sessionId, scoped.scope, scoped.projectRef)
      if (!deleted) {
        status = 404
        payload = failure("session_not_found", "Session was not found", context.requestId)
      } else {
        payload = deleted
      }
    } else if (segments.length === 3 && segments[2] === "share" && method === "POST") {
      const share = store.createSessionShare(sessionId, scoped.scope, scoped.projectRef)
      if (share === null) {
        status = 404
        payload = failure("session_not_found", "Session was not found", context.requestId)
      } else {
        payload = share
      }
    } else if (segments.length === 3 && segments[2] === "share" && method === "DELETE") {
      const share = store.revokeSessionShare(sessionId, scoped.scope, scoped.projectRef)
      if (share === null) {
        status = 404
        payload = failure("share_not_found", "Share was not found", context.requestId)
      } else {
        payload = share
      }
    } else {
      status = 404
      payload = failure("bff_route_not_found", "Business route was not found", context.requestId)
    }
  } else if (segments[0] === "projects") {
    if (segments.length === 1 && method === "GET") payload = projectData(store.projects)
    else if (segments.length === 1 && method === "POST") {
      if (typeof json.name !== "string" || json.name.trim() === "") {
        status = 400
        payload = failure("invalid_project", "Project name is required", context.requestId)
      } else payload = { project: store.createProject({ name: json.name.trim(), description: typeof json.description === "string" ? json.description : undefined }) }
    } else if (segments.length === 2 && (method === "GET" || method === "PATCH")) {
      const project = store.findProject(segments[1] || "")
      if (project === undefined) { status = 404; payload = failure("project_not_found", "Project was not found", context.requestId) }
      else if (method === "GET") payload = { project }
      else if (typeof json.instruction !== "string") {
        status = 400
        payload = failure("invalid_project_instruction", "Project instruction must be a string", context.requestId)
      } else payload = { project: store.updateProjectInstruction(project.id, json.instruction) }
    } else if (segments.length === 3 && segments[2] === "instruction-revisions" && method === "GET") {
      if (store.findProject(segments[1] || "") === undefined) {
        status = 404
        payload = failure("project_not_found", "Project was not found", context.requestId)
      } else payload = { items: store.projectInstructions(segments[1] || "") }
    } else if (segments.length === 3 && segments[2] === "resources" && method === "POST") {
      if (store.findProject(segments[1] || "") === undefined) {
        status = 404
        payload = failure("project_not_found", "Project was not found", context.requestId)
      } else payload = { ok: true }
    } else if (segments.length === 4 && segments[2] === "skills" && method === "PATCH") {
      const project = store.findProject(segments[1] || "")
      if (project === undefined) {
        status = 404
        payload = failure("project_not_found", "Project was not found", context.requestId)
      } else if (typeof json.enabled !== "boolean") {
        status = 400
        payload = failure("invalid_project_skill", "Skill enabled must be a boolean", context.requestId)
      } else {
        store.setProjectSkillEnabled(project.id, segments[3] || "", json.enabled)
        payload = { skill: { project_id: project.id, name: segments[3] || "", enabled: json.enabled } }
      }
    } else if (segments.length === 3 && segments[2] === "scheduled-tasks" && method === "POST") {
      const project = store.findProject(segments[1] || "")
      if (project === undefined) {
        status = 404
        payload = failure("project_not_found", "Project was not found", context.requestId)
      } else {
        const task = store.createScheduledTask({
          ...(json as Partial<ScheduledTask>),
          project_id: project.id,
        })
        payload = { task }
      }
    } else if (segments.length === 3 && segments[2] === "tasks" && method === "GET") {
      payload = taskData(store.projectTasks(segments[1] || ""))
    } else { status = 404; payload = failure("bff_route_not_found", "Business route was not found", context.requestId) }
  } else if (segments[0] === "skills") {
    if (segments.length === 1 && method === "GET") payload = skillData(store.skills)
    else if (segments.length === 2 && segments[1] === "catalog" && method === "GET") payload = skillCatalogData(store.skills)
    else if (segments.length === 2 && segments[1] === "pool" && method === "GET") payload = skillPoolData(store.skills.filter((skill) => skill.enabled !== false))
    else if (segments.length === 2 && segments[1] === "quota" && method === "GET") payload = store.skillQuota(context.identity.namespace)
    else if (segments.length === 3 && segments[2] === "revisions" && method === "GET") {
      payload = { revisions: store.skillRevisions(segments[1] || "", queryOf(request).get("scope")?.trim() || undefined) }
    } else if (segments.length === 3 && (segments[2] === "enable" || segments[2] === "disable") && method === "POST") {
      const enabled = segments[2] === "enable"
      const changed = store.setSkillEnabled(segments[1] || "", enabled, queryOf(request).get("scope")?.trim() || undefined)
      if (!changed) {
        status = 404
        payload = failure("skill_not_found", "Skill was not found", context.requestId)
      } else payload = { ok: true }
    }
    else if (segments.length === 3 && segments[1] === "github" && (segments[2] === "preview" || segments[2] === "import") && method === "POST") {
      const source = githubSkillSource(json.repository)
      if (source === null) {
        status = 400
        payload = failure("invalid_github_url", "A valid GitHub URL is required", context.requestId)
      } else if (segments[2] === "preview") {
        payload = { repository: source.source_url, default_branch: "main", skill: { name: source.name, description: source.description } }
      } else {
        const skill = store.importGithubSkill(source)
        payload = { repository: source.source_url, default_branch: "main", skill: { name: skill.name, description: skill.description } }
      }
    } else { status = 404; payload = failure("bff_route_not_found", "Business route was not found", context.requestId) }
  } else if (segments[0] === "mcp" && segments[1] === "servers") {
    const name = segments[2]
    if (segments.length === 2 && method === "GET") payload = { servers: store.mcpServers }
    else if (segments.length === 2 && method === "POST") {
      const input = mcpRegisterInput(json)
      if (input === null) {
        status = 400
        payload = failure("invalid_mcp_server", "A valid MCP server registration is required", context.requestId)
      } else if (store.findMcpServer(input.name) !== undefined) {
        status = 409
        payload = failure("mcp_server_exists", "MCP server already exists", context.requestId)
      } else {
        payload = { server: store.registerMcpServer({ ...input, scope: context.identity.namespace }) }
      }
    } else if (segments.length === 4 && (segments[3] === "enable" || segments[3] === "disable") && method === "POST") {
      const changed = store.setMcpEnabled(name || "", segments[3] === "enable")
      if (!changed) {
        status = 404
        payload = failure("mcp_server_not_found", "MCP server was not found", context.requestId)
      } else payload = { ok: true }
    } else if (segments.length === 3 && method === "DELETE") {
      const deleted = store.deleteMcpServer(name || "")
      if (!deleted) {
        status = 404
        payload = failure("mcp_server_not_found", "MCP server was not found", context.requestId)
      } else payload = { ok: true }
    } else { status = 404; payload = failure("bff_route_not_found", "Business route was not found", context.requestId) }
  } else if (segments[0] === "scheduled-tasks") {
    const id = segments[1]
    if (segments.length === 1 && method === "GET") payload = scheduledData(store.scheduledTasks)
    else if (segments.length === 1 && method === "POST") payload = { task: store.createScheduledTask(json as Partial<ScheduledTask>) }
    else if (segments.length === 2 && method === "GET") {
      const task = id === undefined ? undefined : store.findScheduledTask(id)
      if (task === undefined) { status = 404; payload = failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId) }
      else payload = { task }
    } else if (segments.length === 2 && method === "PATCH") {
      const task = id === undefined ? undefined : store.findScheduledTask(id)
      if (task === undefined) { status = 404; payload = failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId) }
      else { Object.assign(task, json); payload = { task } }
    } else if (segments.length === 2 && method === "DELETE") {
      const index = id === undefined ? -1 : store.scheduledTasks.findIndex((task) => task.id === id)
      if (index < 0) { status = 404; payload = failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId) }
      else { store.scheduledTasks.splice(index, 1); payload = { ok: true } }
    } else if (segments.length === 3 && segments[2] === "retry" && method === "POST") {
      const task = id === undefined ? undefined : store.findScheduledTask(id)
      if (task === undefined) { status = 404; payload = failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId) }
      else { task.status = "active"; task.enabled = true; payload = { task } }
    } else { status = 404; payload = failure("bff_route_not_found", "Business route was not found", context.requestId) }
  } else if (segments[0] === "agents" && segments[1] === "connections" && segments[2] === "setup" && method === "GET") {
    const platform = queryOf(request).get("platform")
    if (platform === null || !PLATFORMS.has(platform as AgentConnectionSetup["platform"])) {
      status = 400
      payload = failure("invalid_agent_platform", "platform must be telegram, line, or slack", context.requestId)
    } else payload = store.setup(platform as AgentConnectionSetup["platform"])
  } else if (segments[0] === "library" && segments.length === 1 && method === "GET") {
    payload = { items: store.library } satisfies { items: LibraryItem[] }
  } else if (segments[0] === "billing" && segments[1] === "plans" && method === "GET") {
    payload = { plans: store.plans }
  } else if (segments[0] === "billing" && segments[1] === "checkout" && method === "POST") {
    const planId = typeof json.plan_id === "string" ? json.plan_id : ""
    if (!store.plans.some((plan) => plan.id === planId)) {
      status = 404
      payload = failure("plan_not_found", "Billing plan was not found", context.requestId)
    } else {
      payload = { checkout_url: `/billing/mock-checkout/${encodeURIComponent(planId)}` }
    }
  } else if (segments[0] === "billing" && segments[1] === "mock-pay" && method === "POST") {
    payload = { ok: true }
  } else if (segments[0] === "billing" && segments[1] === "summary" && method === "GET") {
    payload = store.billing satisfies BillingSummary
  } else {
    status = 404
    payload = failure("bff_route_not_found", "Business route was not found", context.requestId)
  }

  const isError = isRecord(payload) && "error" in payload
  const envelope = isError ? payload : ok(payload, context.requestId)
  reply(response, status, envelope, context, idempotency, mutation)
}
