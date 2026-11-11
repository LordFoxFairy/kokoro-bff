import { createHash } from "node:crypto"
import type { DeleteProjectResult, ProjectDeletionResource, ProjectOwnerScope, RenameProjectCommand, RenameProjectResult } from "./types.js"

export function createProjectRenamer(write: (command: RenameProjectCommand) => Promise<RenameProjectResult>) {
  return function rename(scope: ProjectOwnerScope, projectId: string, name: string, key: string, signal: AbortSignal): Promise<RenameProjectResult> {
    return write({
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
}

export type ProjectRenamer = ReturnType<typeof createProjectRenamer>

export function createProjectDeletion(
  write: (
    scope: ProjectOwnerScope,
    projectId: string,
    key: string,
    fingerprint: string,
    requestId: string,
    signal: AbortSignal,
  ) => Promise<DeleteProjectResult>,
  read: (scope: ProjectOwnerScope, projectId: string, signal: AbortSignal) => Promise<ProjectDeletionResource | null>,
) {
  function remove(scope: ProjectOwnerScope, projectId: string, key: string, requestId: string, signal: AbortSignal): Promise<DeleteProjectResult> {
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(["project.delete:v1", projectId]), "utf8")
      .digest("hex")
    return write(scope, projectId, key, fingerprint, requestId, signal)
  }

  return { delete: remove, deletion: read }
}

export type ProjectDeletion = ReturnType<typeof createProjectDeletion>
