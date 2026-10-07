import type { Project, ProjectInstructionRevision, Task } from "../../contracts/index.js"

export type ProjectOwnerScope = Readonly<{
  tenantId: string
  subjectId: string
}>

export type RenameProjectCommand = ProjectOwnerScope &
  Readonly<{
    projectId: string
    name: string
    receiptScope: string
    fingerprint: string
    signal: AbortSignal
  }>

export type RenameProjectReceipt = Readonly<{ data: Readonly<{ project_id: string; name: string }> }>
export type RenameProjectResult = Readonly<{ kind: "renamed"; receipt: RenameProjectReceipt }> | Readonly<{ kind: "not_found" | "conflict" }>
export type ProjectDeletionResource = Readonly<{
  project_id: string
  logical_release_state: "pending" | "blocked" | "released"
  physical_cleanup_state: "pending"
}>
export type DeleteProjectResult =
  Readonly<{ kind: "accepted"; resource: ProjectDeletionResource; location: string }> | Readonly<{ kind: "not_found" | "conflict" | "in_progress" }>

/** Port consumed by the BFF application layer. It contains no SQL or driver types. */
export interface ProjectRepository {
  deleteProject(
    scope: ProjectOwnerScope,
    projectId: string,
    key: string,
    fingerprint: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<DeleteProjectResult>
  projectDeletion(scope: ProjectOwnerScope, projectId: string, signal: AbortSignal): Promise<ProjectDeletionResource | null>
  renameProject(command: RenameProjectCommand): Promise<RenameProjectResult>
  listProjects(scope: ProjectOwnerScope): Promise<Project[]>
  findProject(scope: ProjectOwnerScope, idOrSlug: string): Promise<Project | null>
  createProject(scope: ProjectOwnerScope, name: string, description: string): Promise<Project>
  updateProjectInstruction(scope: ProjectOwnerScope, idOrSlug: string, instruction: string): Promise<Project | null>
  instructionRevisions(scope: ProjectOwnerScope, idOrSlug: string): Promise<ProjectInstructionRevision[] | null>
  setProjectSkill(scope: ProjectOwnerScope, projectId: string, skillName: string, enabled: boolean): Promise<boolean>
  listTasks(scope: ProjectOwnerScope, projectId: string): Promise<Task[] | null>
}
