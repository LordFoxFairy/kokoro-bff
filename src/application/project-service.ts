import type { Project, ProjectInstructionRevision, Task } from "../contracts/index.js"
import type { ProjectRepository } from "../modules/projects/repository.js"

/** Project use cases. HTTP handlers depend on this service, not on SQL adapters. */
export class ProjectService {
  public constructor(private readonly repository: ProjectRepository) {}

  public list(tenantId: string): Promise<Project[]> { return this.repository.listProjects(tenantId) }
  public find(tenantId: string, idOrSlug: string): Promise<Project | null> { return this.repository.findProject(tenantId, idOrSlug) }
  public create(tenantId: string, name: string, description: string): Promise<Project> { return this.repository.createProject(tenantId, name, description) }
  public updateInstruction(tenantId: string, idOrSlug: string, instruction: string, actorId: string): Promise<Project | null> {
    return this.repository.updateProjectInstruction(tenantId, idOrSlug, instruction, actorId)
  }
  public revisions(tenantId: string, idOrSlug: string): Promise<ProjectInstructionRevision[] | null> {
    return this.repository.instructionRevisions(tenantId, idOrSlug)
  }
  public setSkill(tenantId: string, projectId: string, skillName: string, enabled: boolean): Promise<boolean> {
    return this.repository.setProjectSkill(tenantId, projectId, skillName, enabled)
  }
  public tasks(tenantId: string, projectId: string): Promise<Task[]> { return this.repository.listTasks(tenantId, projectId) }
}
