import type {
  AgentConnectionSetup,
  BillingPlan,
  BillingSummary,
  ChatEvent,
  Delivery,
  ChatMessage,
  ChatRun,
  ChatSessionDetail,
  ChatSessionSummary,
  LibraryItem,
  McpServer,
  McpTransport,
  Project,
  ProjectInstructionRevision,
  ScheduledTask,
  Skill,
  SkillQuota,
  SkillRevision,
  Task,
  WorkspaceFile,
} from "./contracts.js"

const now = "2026-01-01T00:00:00.000Z"
const skillPackageSize = 122880

type ChatSessionRecord = {
  session_id: string
  title: string
  owner_id: string
  project_ref: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  messages: ChatMessage[]
  active_run: { run_id: string; status: string } | null
  pending_pauses: Array<Record<string, unknown>>
  files: WorkspaceFile[]
  deliveries: Delivery[]
  events: ChatEvent[]
  share_id: string | null
  share_revoked_at: string | null
}

export class MockStore {
  readonly projects: Project[] = [{
    id: "project_kokoro",
    name: "Kokoro",
    slug: "kokoro",
    description: "Kokoro product workspace",
    instruction: "Keep implementation notes scoped to this project.",
    created_at: now,
    updated_at: now,
  }]

  readonly tasks: Task[] = [{
    id: "task_contract",
    project_id: "project_kokoro",
    title: "Review business API contract",
    status: "in_progress",
    updated_at: now,
  }]

  readonly scheduledTasks: ScheduledTask[] = [{
    id: "scheduled_contract_review",
    title: "Review the API contract",
    prompt: "Review the current business API contract.",
    frequency: "daily",
    time: "09:00",
    timezone: "UTC",
    next_run_at: "2026-01-02T09:00:00.000Z",
    auto_approve: false,
    enabled: true,
    status: "active",
  }]

  readonly skills: Skill[] = [{
    name: "contract-review",
    description: "Review a versioned business API contract.",
    content_hash: "sha256:fixture-contract-review",
    scope: "official",
    installed: true,
    enabled: true,
    categories: ["coding", "business"],
    updated_at: 1767225600,
  }]

  readonly mcpServers: McpServer[] = []

  readonly projectInstructionHistory = new Map<string, ProjectInstructionRevision[]>([
    ["project_kokoro", [{
      id: "project-instruction-initial",
      instruction: "Keep implementation notes scoped to this project.",
      updatedAt: 1767225600000,
      actorName: "Kokoro",
      current: true,
    }]],
  ])

  readonly projectSkills = new Map<string, Map<string, boolean>>([
    ["project_kokoro", new Map([["skill-builder", true]])],
  ])

  readonly library: LibraryItem[] = [{
    id: "artifact_contract",
    title: "Business API contract",
    type: "document",
    created_at: now,
    url: "/artifacts/artifact_contract",
  }]

  readonly billing: BillingSummary = { balance: 100, currency: "USD", period: "2026-01", usage: 0 }

  readonly plans: BillingPlan[] = [{
    id: "plan_starter",
    key: "starter",
    name: "Starter",
    currency: "USD",
    amount_minor: "900",
    credit_micros: "1000000",
    billing_interval: "once",
  }]

  readonly sessions: ChatSessionRecord[] = [{
    session_id: "session_kokoro",
    title: "Review business API contract",
    owner_id: "ns_test",
    project_ref: "project_kokoro",
    created_at: now,
    updated_at: now,
    deleted_at: null,
    messages: [],
    active_run: {
      run_id: "run_1",
      status: "running",
    },
    events: [{
      event_id: "event_1",
      seq: 1,
      session_id: "session_kokoro",
      run_id: "run_1",
      kind: "session.created",
      timestamp: now,
      payload: { title: "Review business API contract", owner_id: "ns_test" },
    }, {
      event_id: "event_2",
      seq: 2,
      session_id: "session_kokoro",
      run_id: "run_1",
      kind: "run.created",
      timestamp: now,
      payload: { run_id: "run_1" },
    }],
    pending_pauses: [],
    files: [],
    deliveries: [],
    share_id: null,
    share_revoked_at: null,
  }]

  projectTasks(projectId: string): Task[] {
    return this.tasks.filter((task) => task.project_id === projectId)
  }

  findProject(idOrSlug: string): Project | undefined {
    return this.projects.find((project) => project.id === idOrSlug || project.slug === idOrSlug)
  }

  updateProjectInstruction(projectId: string, instruction: string): Project | undefined {
    const project = this.findProject(projectId)
    if (project === undefined) return undefined
    project.instruction = instruction
    project.updated_at = new Date().toISOString()
    const history = this.projectInstructionHistory.get(project.id) ?? []
    const revision: ProjectInstructionRevision = {
      id: `project-instruction-${history.length + 1}`,
      instruction,
      updatedAt: Date.now(),
      actorName: "You",
      current: true,
    }
    this.projectInstructionHistory.set(project.id, [revision, ...history.map((item) => ({ ...item, current: false }))])
    return project
  }

  projectInstructions(projectId: string): ProjectInstructionRevision[] {
    return this.projectInstructionHistory.get(this.findProject(projectId)?.id ?? projectId) ?? []
  }

  setProjectSkillEnabled(projectId: string, name: string, enabled: boolean): boolean {
    const project = this.findProject(projectId)
    if (project === undefined) return false
    const skills = this.projectSkills.get(project.id) ?? new Map<string, boolean>()
    skills.set(name, enabled)
    this.projectSkills.set(project.id, skills)
    return true
  }

  projectSkillEnabled(projectId: string, name: string): boolean | undefined {
    return this.projectSkills.get(this.findProject(projectId)?.id ?? projectId)?.get(name)
  }

  skillQuota(namespace: string): SkillQuota {
    const packageCount = this.skills.filter((skill) => skill.scope !== "official").length
    return {
      namespace,
      package_count: packageCount,
      package_bytes: packageCount * skillPackageSize,
      max_packages: 20,
      max_bytes: 52428800,
    }
  }

  skillRevisions(name: string, scope?: string): SkillRevision[] {
    return this.skills
      .filter((skill) => skill.name === name && (scope === undefined || skill.scope === scope))
      .map((skill) => ({
        scope: skill.scope,
        name: skill.name,
        revision: 1,
        content_hash: skill.content_hash,
        package_size: skillPackageSize,
        source: skill.source_url || "mock",
        created_at: skill.updated_at || 1767225600,
      }))
  }

  setSkillEnabled(name: string, enabled: boolean, scope?: string): boolean {
    let changed = false
    for (const skill of this.skills) {
      if (skill.name !== name || (scope !== undefined && skill.scope !== scope)) continue
      skill.enabled = enabled
      changed = true
    }
    return changed
  }

  registerMcpServer(input: {
    scope: string
    name: string
    transport: McpTransport
    url: string
    allowed_tools: string[]
    secret_ref: string | null
  }): McpServer {
    const server: McpServer = {
      scope: input.scope,
      name: input.name,
      revision: 1,
      transport: input.transport,
      url: input.url,
      allowed_tools: [...input.allowed_tools],
      secret_ref: input.secret_ref,
      enabled: true,
    }
    this.mcpServers.push(server)
    return server
  }

  findMcpServer(name: string): McpServer | undefined {
    return this.mcpServers.find((server) => server.name === name)
  }

  setMcpEnabled(name: string, enabled: boolean): boolean {
    const server = this.findMcpServer(name)
    if (server === undefined) return false
    server.enabled = enabled
    return true
  }

  deleteMcpServer(name: string): boolean {
    const index = this.mcpServers.findIndex((server) => server.name === name)
    if (index < 0) return false
    this.mcpServers.splice(index, 1)
    return true
  }

  createProject(input: { name: string; description?: string }): Project {
    const timestamp = new Date().toISOString()
    const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project"
    const project: Project = {
      id: `project_${this.projects.length + 1}`,
      name: input.name,
      slug,
      description: input.description || "",
      created_at: timestamp,
      updated_at: timestamp,
    }
    this.projects.push(project)
    this.projectInstructionHistory.set(project.id, [])
    this.projectSkills.set(project.id, new Map())
    return project
  }

  createScheduledTask(input: Partial<ScheduledTask>): ScheduledTask {
    const task: ScheduledTask = {
      id: `scheduled_${this.scheduledTasks.length + 1}`,
      project_id: input.project_id,
      title: input.title || "Untitled task",
      prompt: input.prompt || "",
      frequency: input.frequency || "daily",
      time: input.time || "09:00",
      timezone: input.timezone || "UTC",
      next_run_at: input.next_run_at || "2026-01-02T09:00:00.000Z",
      expires_at: input.expires_at,
      auto_approve: input.auto_approve ?? false,
      enabled: input.enabled ?? true,
      status: input.status || "active",
    }
    this.scheduledTasks.push(task)
    return task
  }

  importGithubSkill(input: {
    source_url: string
    owner: string
    repository: string
    name: string
    description: string
  }): Skill {
    const existing = this.skills.find((skill) => skill.source_url === input.source_url)
    if (existing !== undefined) return existing

    const skill: Skill = {
      name: input.name,
      description: input.description,
      content_hash: `sha256:fixture-github-${input.owner}-${input.repository}`,
      scope: "user",
      source_url: input.source_url,
      installed: true,
      enabled: true,
      categories: ["github"],
      updated_at: 1767225600,
    }
    this.skills.push(skill)
    return skill
  }

  findScheduledTask(id: string): ScheduledTask | undefined {
    return this.scheduledTasks.find((task) => task.id === id)
  }

  setup(platform: AgentConnectionSetup["platform"]): AgentConnectionSetup {
    return {
      platform,
      status: "disconnected",
      qr_value: `kokoro://connect/${platform}/fixture`,
      continue_url: `https://dev.kokoro.localhost/app/agents?platform=${platform}`,
      expires_at: "2026-01-01T00:15:00.000Z",
    }
  }

  listSessions(scope?: string, projectRef?: string): ChatSessionSummary[] {
    return this.sessions
      .filter((session) => session.deleted_at === null)
      .filter((session) => scope === undefined || session.owner_id === scope)
      .filter((session) => projectRef === undefined || session.project_ref === projectRef)
      .map((session) => ({
        session_id: session.session_id,
        title: session.title,
        updated_at: session.updated_at,
      }))
  }

  listSessionMessages(
    id: string,
    scope: string | undefined,
    projectRef: string | undefined,
    cursor: string | undefined,
    limit: number,
  ): { messages: ChatMessage[]; next_cursor: string | null } | { invalid_cursor: true } | undefined {
    const session = this.findSession(id, scope, projectRef)
    if (session === undefined) return undefined
    const offset = cursor === undefined ? 0 : this.decodeMessageCursor(cursor)
    if (offset === null) return { invalid_cursor: true }
    const messages = session.messages.slice(offset, offset + limit).map((message) => ({ ...message }))
    const nextOffset = offset + messages.length
    return {
      messages,
      next_cursor: nextOffset < session.messages.length ? `msg_${nextOffset}` : null,
    }
  }

  private decodeMessageCursor(cursor: string): number | null {
    const match = /^msg_(\d+)$/u.exec(cursor)
    if (match === null) return null
    const offset = Number(match[1])
    return Number.isSafeInteger(offset) && offset >= 0 ? offset : null
  }

  findSession(id: string, scope?: string, projectRef?: string): ChatSessionRecord | undefined {
    return this.sessions.find((session) =>
      session.session_id === id
      && session.deleted_at === null
      && (scope === undefined || session.owner_id === scope)
      && (projectRef === undefined || session.project_ref === projectRef),
    )
  }

  findSharedSession(shareId: string, scope?: string, projectRef?: string): ChatSessionRecord | undefined {
    return this.sessions.find((session) =>
      session.share_id === shareId
      && session.share_revoked_at === null
      && session.deleted_at === null
      && (scope === undefined || session.owner_id === scope)
      && (projectRef === undefined || session.project_ref === projectRef),
    )
  }

  readSession(id: string, scope?: string, projectRef?: string): ChatSessionDetail | undefined {
    const session = this.findSession(id, scope, projectRef)
    if (session === undefined) return undefined
    const activeRun = session.active_run === null ? undefined : { run_id: session.active_run.run_id, status: session.active_run.status }
    return {
      session: {
        session_id: session.session_id,
        title: session.title,
        owner_id: session.owner_id,
        created_at: session.created_at,
        updated_at: session.updated_at,
      },
      ...(session.messages.length === 0 ? {} : { messages: session.messages.map((message) => ({ ...message })) }),
      ...(activeRun === undefined ? {} : { active_run: activeRun }),
      pending_pauses: session.pending_pauses.map((pause) => ({ ...pause })),
      files: session.files.map((file) => ({ ...file })),
      deliveries: session.deliveries.map((delivery) => ({ ...delivery })),
      event_watermark: session.events.at(-1)?.seq ?? 0,
    }
  }

  submitSessionMessage(sessionId: string, content: string, scope?: string, projectRef?: string): { run_id: string; user_message_id: string; assistant_message_id: string } | null {
    const session = this.findSession(sessionId, scope, projectRef)
    if (session === undefined) return null
    const timestamp = new Date().toISOString()
    const runId = session.active_run?.status === "running" ? session.active_run.run_id : `run_${session.events.length + 1}`
    if (session.active_run?.status !== "running") {
      session.active_run = { run_id: runId, status: "running" }
      session.events.push({
        event_id: `event_${session.events.length + 1}`,
        seq: session.events.length + 1,
        session_id: session.session_id,
        run_id: runId,
        kind: "run.created",
        timestamp,
        payload: { run_id: runId },
      })
    }
    const userMessageId = `message_${session.messages.length + 1}`
    const assistantMessageId = `message_${session.messages.length + 2}`
    const userMessage: ChatMessage = {
      message_id: userMessageId,
      role: "user",
      content,
      status: "completed",
      created_at: timestamp,
      run_id: runId,
    }
    session.messages.push(userMessage)
    session.updated_at = timestamp
    session.events.push({
      event_id: `event_${session.events.length + 1}`,
      seq: session.events.length + 1,
      session_id: session.session_id,
      run_id: runId,
      kind: "message.user",
      timestamp,
      payload: { message_id: userMessageId, content },
    })
    return { run_id: runId, user_message_id: userMessageId, assistant_message_id: assistantMessageId }
  }

  completeSessionRun(sessionId: string, runId: string, content: string, scope?: string, projectRef?: string): boolean {
    const session = this.findSession(sessionId, scope, projectRef)
    if (session === undefined || session.active_run?.run_id !== runId || session.active_run.status !== "running") return false
    const timestamp = new Date().toISOString()
    const assistantMessageId = `message_${session.messages.length + 1}`
    const assistantMessage: ChatMessage = {
      message_id: assistantMessageId,
      role: "assistant",
      content: `Mock reply: ${content}`,
      status: "completed",
      created_at: timestamp,
      run_id: runId,
    }
    session.messages.push(assistantMessage)
    session.active_run.status = "completed"
    session.updated_at = timestamp
    session.events.push({
      event_id: `event_${session.events.length + 1}`,
      seq: session.events.length + 1,
      session_id: session.session_id,
      run_id: runId,
      kind: "message.completed",
      timestamp,
      payload: { segment_id: `segment_${session.messages.length}`, content: assistantMessage.content },
    })
    session.events.push({
      event_id: `event_${session.events.length + 1}`,
      seq: session.events.length + 1,
      session_id: session.session_id,
      run_id: runId,
      kind: "run.completed",
      timestamp,
      payload: { status: "completed" },
    })
    return true
  }

  controlSessionRun(sessionId: string, runId: string, action: "cancel" | "resume" | "steer", decisions?: string[], scope?: string, projectRef?: string): { ok: true } | null {
    const session = this.findSession(sessionId, scope, projectRef)
    if (session === undefined) return null
    if (session.active_run === null || session.active_run.run_id !== runId) return null
    const timestamp = new Date().toISOString()
    session.active_run.status = action === "cancel" ? "cancelled" : "running"
    session.updated_at = timestamp
    if (action === "cancel") {
      session.events.push({
        event_id: `event_${session.events.length + 1}`,
        seq: session.events.length + 1,
        session_id: session.session_id,
        run_id: runId,
        kind: "run.completed",
        timestamp,
        payload: { status: "cancelled" },
      })
    }
    return { ok: true }
  }

  updateSessionTitle(sessionId: string, title: string, scope?: string, projectRef?: string): { ok: true } | null {
    const session = this.findSession(sessionId, scope, projectRef)
    if (session === undefined) return null
    session.title = title
    session.updated_at = new Date().toISOString()
    return { ok: true }
  }

  deleteSession(sessionId: string, scope?: string, projectRef?: string): { status: string } | null {
    const session = this.findSession(sessionId, scope, projectRef)
    if (session === undefined || session.deleted_at !== null) return null
    session.deleted_at = new Date().toISOString()
    session.updated_at = new Date().toISOString()
    if (session.share_id !== null) {
      session.share_revoked_at = session.updated_at
    }
    return { status: "deleted" }
  }

  createSessionShare(sessionId: string, scope?: string, projectRef?: string): { share_id: string } | null {
    const session = this.findSession(sessionId, scope, projectRef)
    if (session === undefined) return null
    if (session.share_id !== null && session.share_revoked_at === null) {
      return { share_id: session.share_id }
    }
    const shareId = `shr_${(this.sessions.length + session.events.length).toString(16).padStart(32, "0")}`
    session.share_id = shareId
    session.share_revoked_at = null
    session.updated_at = new Date().toISOString()
    session.events.push({
      event_id: `event_${session.events.length + 1}`,
      seq: session.events.length + 1,
      session_id: session.session_id,
      run_id: session.active_run?.run_id ?? "",
      kind: "session.shared",
      timestamp: session.updated_at,
      payload: { share_id: shareId },
    })
    return { share_id: shareId }
  }

  revokeSessionShare(sessionId: string, scope?: string, projectRef?: string): { share_id: string } | null {
    const session = this.findSession(sessionId, scope, projectRef)
    if (session === undefined || session.share_id === null || session.share_revoked_at !== null) return null
    const revokedAt = new Date().toISOString()
    session.updated_at = revokedAt
    session.share_revoked_at = revokedAt
    session.events.push({
      event_id: `event_${session.events.length + 1}`,
      seq: session.events.length + 1,
      session_id: session.session_id,
      run_id: session.active_run?.run_id ?? "",
      kind: "session.unshared",
      timestamp: revokedAt,
      payload: { share_id: session.share_id },
    })
    return { share_id: session.share_id }
  }
}
