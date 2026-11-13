import type { ProjectPinPosition } from "../../domain/project/pin.js"
import type { ProjectMcpRecommendation, ProjectMcpRecommendations } from "../../domain/project/mcp-recommendations.js"
import type { Project } from "../../contracts/index.js"

export type ProjectOwnerScope = Readonly<{
  tenantId: string
  subjectId: string
}>

/** Current Project ownership by canonical ID or slug; no write capabilities. */
export type ProjectLookup = Readonly<{
  find(scope: ProjectOwnerScope, idOrSlug: string, lifetime?: Readonly<{ signal: AbortSignal; deadlineAt: number }>): Promise<Project | null>
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
  Readonly<{ kind: "replaced"; receipt: Readonly<{ data: ProjectSkillSelection }> }> | Readonly<{ kind: "not_found" | "forbidden" | "conflict" }>

export type RenameProjectReceipt = Readonly<{ data: Readonly<{ project_id: string; name: string }> }>
export type RenameProjectResult = Readonly<{ kind: "renamed"; receipt: RenameProjectReceipt }> | Readonly<{ kind: "not_found" | "forbidden" | "conflict" }>
export type ProjectDeletionResource = Readonly<{
  project_id: string
  logical_release_state: "pending" | "blocked" | "released"
  physical_cleanup_state: "pending"
}>
export type DeleteProjectResult =
  Readonly<{ kind: "accepted"; resource: ProjectDeletionResource; location: string }> | Readonly<{ kind: "not_found" | "conflict" | "in_progress" }>

/** Pin inputs used by the Project-owned persistence and HTTP adapter. */
export type ProjectPinQuery = ProjectOwnerScope &
  Readonly<{ projectId: string | null; limit: number; position: ProjectPinPosition | null; signal: AbortSignal; deadlineAt: number }>
export type SetProjectPin = ProjectOwnerScope & Readonly<{ projectId: string; isPinned: boolean; signal: AbortSignal; deadlineAt: number }>
export type ProjectMcpRecommendationQuery = ProjectOwnerScope & Readonly<{ projectId: string; signal: AbortSignal; deadlineAt: number }>
export type ReplaceProjectMcpRecommendations = ProjectMcpRecommendationQuery &
  Readonly<{ expectedStateVersion: string; recommendations: ProjectMcpRecommendation[] }>
export type ReplaceProjectMcpRecommendationsResult =
  { kind: "replaced"; data: ProjectMcpRecommendations } | { kind: "not_found" | "forbidden" | "precondition_failed" }
