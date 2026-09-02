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
  updatedAt: number
  actorName: string
  current: boolean
}

export type Task = {
  id: string
  project_id: string
  title: string
  status: "todo" | "in_progress" | "done"
  updated_at: string
}
