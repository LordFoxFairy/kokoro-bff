import type { ProjectPinList, ProjectPinPosition, ProjectPinState } from "../../domain/project/pin.js"
import type { ProjectMcpRecommendation, ProjectMcpRecommendations } from "../../domain/project/mcp-recommendations.js"
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

export type ProjectSkillSelection = Readonly<{ project_id: string; installation_ids: string[] }>
export type ReplaceProjectSkillSelectionCommand = ProjectOwnerScope &
  Readonly<{ projectId: string; installationIds: string[]; receiptScope: string; fingerprint: string; signal: AbortSignal }>
export type ReplaceProjectSkillSelectionResult =
  Readonly<{ kind: "replaced"; receipt: Readonly<{ data: ProjectSkillSelection }> }> | Readonly<{ kind: "not_found" | "conflict" }>

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
export type ProjectPinQuery = ProjectOwnerScope &
  Readonly<{ projectId: string | null; limit: number; position: ProjectPinPosition | null; signal: AbortSignal; deadlineAt: number }>
export type SetProjectPin = ProjectOwnerScope & Readonly<{ projectId: string; isPinned: boolean; signal: AbortSignal; deadlineAt: number }>
export interface ProjectRepository {
  listProjectPins(input: ProjectPinQuery): Promise<ProjectPinList | null>
  setProjectPin(input: SetProjectPin): Promise<ProjectPinState | null>
  projectMcpRecommendations(input: ProjectMcpRecommendationQuery): Promise<ProjectMcpRecommendations | null>
  replaceProjectMcpRecommendations(input: ReplaceProjectMcpRecommendations): Promise<ReplaceProjectMcpRecommendationsResult>
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
  projectSkillSelection(scope: ProjectOwnerScope, projectId: string): Promise<ProjectSkillSelection | null>
  replaceProjectSkillSelection(command: ReplaceProjectSkillSelectionCommand): Promise<ReplaceProjectSkillSelectionResult>
  listTasks(scope: ProjectOwnerScope, projectId: string): Promise<Task[] | null>
}

export type ProjectMcpRecommendationQuery = ProjectOwnerScope & Readonly<{ projectId: string; signal: AbortSignal; deadlineAt: number }>
export type ReplaceProjectMcpRecommendations = ProjectMcpRecommendationQuery &
  Readonly<{ expectedStateVersion: string; recommendations: ProjectMcpRecommendation[] }>
export type ReplaceProjectMcpRecommendationsResult = { kind: "replaced"; data: ProjectMcpRecommendations } | { kind: "not_found" | "precondition_failed" }
