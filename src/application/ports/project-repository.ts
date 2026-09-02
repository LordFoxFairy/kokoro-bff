import type { Project, ProjectInstructionRevision, Task } from "../../contracts/index.js"

/** Port consumed by the BFF application layer. It contains no SQL or driver types. */
export interface ProjectRepository {
  listProjects(tenantId: string): Promise<Project[]>
  findProject(tenantId: string, idOrSlug: string): Promise<Project | null>
  createProject(tenantId: string, name: string, description: string): Promise<Project>
  updateProjectInstruction(tenantId: string, idOrSlug: string, instruction: string, actorId: string): Promise<Project | null>
  instructionRevisions(tenantId: string, idOrSlug: string): Promise<ProjectInstructionRevision[] | null>
  setProjectSkill(tenantId: string, projectId: string, skillName: string, enabled: boolean): Promise<boolean>
  listTasks(tenantId: string, projectId: string): Promise<Task[]>
}
