export type Project = {
  id: string
  name: string
  slug: string
  description: string
  instruction?: string
  created_at: string
  updated_at: string
}

export type ProjectInstructionRevision = {
  id: string
  instruction: string
  updated_at: string
  actor_name: string
  current: boolean
}

export type ProjectTaskStatus = "todo" | "in_progress" | "done"

export type Task = {
  id: string
  project_id: string
  title: string
  status: ProjectTaskStatus
  updated_at: string
  revision: string
}

export type ProjectTaskWriteReceipt = Pick<Task, "id" | "project_id" | "revision">

export const projectTaskIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
export const projectTaskRevisionPattern = /^ptask_[A-Za-z0-9_-]{43}$/u
