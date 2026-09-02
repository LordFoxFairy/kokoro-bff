import { createHash } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"

import type { AgentConnectionSetup, ChatEvent, ChatSessionDetail, ChatSessionSummary, McpTransport, Project, ScheduledTask, Skill, Task } from "../../contracts/index.js"
import { queryOf, stableStringify, type Context } from "../request.js"

export const PLATFORMS = new Set<AgentConnectionSetup["platform"]>(["telegram", "line", "slack"])

export type GithubSkillSource = {
  source_url: string
  owner: string
  repository: string
  name: string
  description: string
}

export function mcpRegisterInput(value: Record<string, unknown>): {
  name: string
  transport: McpTransport
  url: string
  allowed_tools: string[]
  secret_ref: string | null
} | null {
  const name = typeof value.name === "string" ? value.name.trim() : ""
  const transport = value.transport
  const url = typeof value.url === "string" ? value.url.trim() : ""
  const allowedTools = value.allowed_tools
  const secretRef = value.secret_ref
  if (
    name === ""
    || (transport !== "http" && transport !== "streamable_http")
    || url === ""
    || !Array.isArray(allowedTools)
    || !allowedTools.every((tool): tool is string => typeof tool === "string")
    || (secretRef !== undefined && secretRef !== null && typeof secretRef !== "string")
  ) return null
  return {
    name,
    transport,
    url,
    allowed_tools: [...allowedTools],
    secret_ref: secretRef === undefined ? null : secretRef,
  }
}

export function githubSkillSource(value: unknown): GithubSkillSource | null {
  if (typeof value !== "string" || value.trim() === "") return null
  const sourceUrl = value.trim().replace(/\/$/u, "")
  let parsed: URL
  try {
    parsed = new URL(sourceUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== "https:" || !["github.com", "www.github.com"].includes(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    return null
  }

  const parts = parsed.pathname.split("/").filter(Boolean)
  if (parts.length !== 2) return null
  const owner = parts[0]
  const repository = parts[1]?.replace(/\.git$/u, "")
  if (owner === undefined || repository === undefined || !/^[A-Za-z0-9_.-]+$/u.test(owner) || !/^[A-Za-z0-9_.-]+$/u.test(repository)) {
    return null
  }
  const canonical = `https://github.com/${owner}/${repository}`
  return {
    source_url: canonical,
    owner,
    repository,
    name: repository,
    description: `Mock GitHub skill from ${owner}/${repository}`,
  }
}

export function projectData(projects: Project[]): { projects: Project[] } { return { projects } }
export function taskData(tasks: Task[]): { tasks: Task[] } { return { tasks } }
export function skillData(skills: Skill[]): { skills: Skill[] } { return { skills } }
export function scheduledData(tasks: ScheduledTask[]): { tasks: ScheduledTask[] } { return { tasks } }
export function chatSessionsData(sessions: ChatSessionSummary[], nextCursor: string | null = null): { sessions: ChatSessionSummary[]; next_cursor: string | null } {
  return { sessions, next_cursor: nextCursor }
}

export function sessionScope(request: IncomingMessage, context: Context): { scope: string; projectRef?: string } | { error: string } {
  const query = queryOf(request)
  const requestedScope = query.get("scope")?.trim()
  if (requestedScope !== undefined && requestedScope !== "" && requestedScope !== "direct") {
    return { error: "scope must be direct when provided" }
  }
  const projectRef = query.get("project_ref")?.trim() || undefined
  return { scope: context.identity.namespace, ...(projectRef === undefined ? {} : { projectRef }) }
}

export function mockControlReceipt(runId: string, commandId: string, body: Record<string, unknown>): Record<string, unknown> {
  const requestDigest = createHash("sha256").update(stableStringify(body)).digest("hex")
  return {
    run_id: runId,
    command_id: commandId,
    request_digest: `sha256:${requestDigest}`,
    status: "succeeded",
    replayed: false,
  }
}
export function chatSessionDetailData(detail: ChatSessionDetail): ChatSessionDetail {
  return detail
}
export function chatShareData(shareId: string): { share_id: string } { return { share_id: shareId } }
export function chatSseFrame(event: ChatEvent): string {
  return `id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
}

export function waitForSsePoll(request: IncomingMessage, response: ServerResponse, delayMs: number): Promise<boolean> {
  if (request.aborted || response.destroyed || response.writableEnded) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve(true)
    }, delayMs)
    const stop = (): void => {
      cleanup()
      resolve(false)
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      request.off("aborted", stop)
      response.off("close", stop)
    }
    request.once("aborted", stop)
    response.once("close", stop)
  })
}
