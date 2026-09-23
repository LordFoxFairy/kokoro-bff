import type { Project, ProjectInstructionRevision, Task } from "../contracts/index.js"
import type { ProjectOwnerScope, ProjectRepository } from "./ports/project-repository.js"

/** Project use cases. HTTP handlers depend on this service, not on SQL adapters. */
export class ProjectService {
  public constructor(private readonly repository: ProjectRepository) {}

  public list(scope: ProjectOwnerScope): Promise<Project[]> { return this.repository.listProjects(scope) }
  public find(scope: ProjectOwnerScope, idOrSlug: string): Promise<Project | null> { return this.repository.findProject(scope, idOrSlug) }
  public create(scope: ProjectOwnerScope, name: string, description: string): Promise<Project> {
    return this.repository.createProject(scope, name, description)
  }
  public updateInstruction(scope: ProjectOwnerScope, idOrSlug: string, instruction: string): Promise<Project | null> {
    return this.repository.updateProjectInstruction(scope, idOrSlug, instruction)
  }
  public revisions(scope: ProjectOwnerScope, idOrSlug: string): Promise<ProjectInstructionRevision[] | null> {
    return this.repository.instructionRevisions(scope, idOrSlug)
  }
  public setSkill(scope: ProjectOwnerScope, projectId: string, skillName: string, enabled: boolean): Promise<boolean> {
    return this.repository.setProjectSkill(scope, projectId, skillName, enabled)
  }
  public tasks(scope: ProjectOwnerScope, projectId: string): Promise<Task[] | null> { return this.repository.listTasks(scope, projectId) }
}
