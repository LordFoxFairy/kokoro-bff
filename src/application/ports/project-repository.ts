import type { Project, ProjectInstructionRevision, Task } from "../../contracts/index.js"

export type ProjectOwnerScope = Readonly<{
  tenantId: string
  subjectId: string
}>

/** Port consumed by the BFF application layer. It contains no SQL or driver types. */
export interface ProjectRepository {
  listProjects(scope: ProjectOwnerScope): Promise<Project[]>
  findProject(scope: ProjectOwnerScope, idOrSlug: string): Promise<Project | null>
  createProject(scope: ProjectOwnerScope, name: string, description: string): Promise<Project>
  updateProjectInstruction(scope: ProjectOwnerScope, idOrSlug: string, instruction: string): Promise<Project | null>
  instructionRevisions(scope: ProjectOwnerScope, idOrSlug: string): Promise<ProjectInstructionRevision[] | null>
  setProjectSkill(scope: ProjectOwnerScope, projectId: string, skillName: string, enabled: boolean): Promise<boolean>
  listTasks(scope: ProjectOwnerScope, projectId: string): Promise<Task[] | null>
}
