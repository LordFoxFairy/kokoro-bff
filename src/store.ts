import type { AgentConnectionSetup, BillingPlan, BillingSummary, LibraryItem, Project, ScheduledTask, Skill, Task } from "./contracts.js"

const now = "2026-01-01T00:00:00.000Z"

export class MockStore {
  readonly projects: Project[] = [{
    id: "project_kokoro",
    name: "Kokoro",
    slug: "kokoro",
    description: "Kokoro product workspace",
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

  projectTasks(projectId: string): Task[] {
    return this.tasks.filter((task) => task.project_id === projectId)
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
    return project
  }

  createScheduledTask(input: Partial<ScheduledTask>): ScheduledTask {
    const task: ScheduledTask = {
      id: `scheduled_${this.scheduledTasks.length + 1}`,
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
}
