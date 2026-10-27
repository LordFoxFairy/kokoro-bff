import type { ProjectMcpRecommendationQuery, ReplaceProjectMcpRecommendations, ProjectPinQuery, SetProjectPin } from "./ports/project-repository.js"
import { createHash } from "node:crypto"

import type { Project, ProjectInstructionRevision, Task } from "../contracts/index.js"
import type { DeleteProjectResult, ProjectDeletionResource, ProjectOwnerScope, ProjectRepository, RenameProjectResult } from "./ports/project-repository.js"

/** Project use cases. HTTP handlers depend on this service, not on SQL adapters. */
export class ProjectService {
  public constructor(private readonly repository: ProjectRepository) {}

  public listPins(input: ProjectPinQuery) {
    return this.repository.listProjectPins(input)
  }
  public setPin(input: SetProjectPin) {
    return this.repository.setProjectPin(input)
  }

  public mcpRecommendations(input: ProjectMcpRecommendationQuery) {
    return this.repository.projectMcpRecommendations(input)
  }
  public replaceMcpRecommendations(input: ReplaceProjectMcpRecommendations) {
    return this.repository.replaceProjectMcpRecommendations(input)
  }

  public rename(scope: ProjectOwnerScope, projectId: string, name: string, key: string, signal: AbortSignal): Promise<RenameProjectResult> {
    return this.repository.renameProject({
      ...scope,
      projectId,
      name,
      signal,
      receiptScope: JSON.stringify([scope.tenantId, scope.subjectId, "project.rename:v1", projectId, key]),
      fingerprint: createHash("sha256")
        .update(JSON.stringify(["project.rename:v1", projectId, name]), "utf8")
        .digest("hex"),
    })
  }

  public list(scope: ProjectOwnerScope): Promise<Project[]> {
    return this.repository.listProjects(scope)
  }
  public find(scope: ProjectOwnerScope, idOrSlug: string): Promise<Project | null> {
    return this.repository.findProject(scope, idOrSlug)
  }
  public create(scope: ProjectOwnerScope, name: string, description: string): Promise<Project> {
    return this.repository.createProject(scope, name, description)
  }
  public updateInstruction(scope: ProjectOwnerScope, idOrSlug: string, instruction: string): Promise<Project | null> {
    return this.repository.updateProjectInstruction(scope, idOrSlug, instruction)
  }
  public revisions(scope: ProjectOwnerScope, idOrSlug: string): Promise<ProjectInstructionRevision[] | null> {
    return this.repository.instructionRevisions(scope, idOrSlug)
  }
  public skillSelection(scope: ProjectOwnerScope, projectId: string) {
    return this.repository.projectSkillSelection(scope, projectId)
  }
  public replaceSkillSelection(scope: ProjectOwnerScope, projectId: string, installationIds: string[], key: string, signal: AbortSignal) {
    return this.repository.replaceProjectSkillSelection({
      ...scope,
      projectId,
      installationIds,
      signal,
      receiptScope: JSON.stringify([scope.tenantId, scope.subjectId, "project.skill-selection:v1", projectId, key]),
      fingerprint: createHash("sha256")
        .update(JSON.stringify(["project.skill-selection:v1", projectId, installationIds]), "utf8")
        .digest("hex"),
    })
  }
  public tasks(scope: ProjectOwnerScope, projectId: string): Promise<Task[] | null> {
    return this.repository.listTasks(scope, projectId)
  }
  public delete(scope: ProjectOwnerScope, projectId: string, key: string, requestId: string, signal: AbortSignal): Promise<DeleteProjectResult> {
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(["project.delete:v1", projectId]), "utf8")
      .digest("hex")
    return this.repository.deleteProject(scope, projectId, key, fingerprint, requestId, signal)
  }

  public deletion(scope: ProjectOwnerScope, projectId: string, signal: AbortSignal): Promise<ProjectDeletionResource | null> {
    return this.repository.projectDeletion(scope, projectId, signal)
  }
}
