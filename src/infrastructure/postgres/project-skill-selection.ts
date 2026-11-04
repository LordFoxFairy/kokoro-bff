import { createHash } from "node:crypto"
import type { ProjectOwnerScope, ProjectSkillSelection } from "../../application/projects/project-repository.js"
import { parseProjectSkillSelection } from "../../domain/project/skill-selection.js"
import type { PostgresBffDatabase } from "./client.js"
import { replaceProjectSkillSelection } from "./project-rename.js"

export function createProjectSkillSelectionOperations(database: PostgresBffDatabase) {
  async function skillSelection(scope: ProjectOwnerScope, projectId: string): Promise<ProjectSkillSelection | null> {
    const result = await database.pool.query<{ project_id: string; selected_skill_installation_ids: string[] }>(
      `SELECT project_id, selected_skill_installation_ids FROM bff_project WHERE tenant_id=$1 AND owner_id=$2 AND project_id=$3 AND deleted_at IS NULL`,
      [scope.tenantId, scope.subjectId, projectId],
    )
    const row = result.rows[0]
    if (!row) return null
    const ids = parseProjectSkillSelection(row.selected_skill_installation_ids)
    if (ids === null) throw new Error("PROJECT_SKILL_SELECTION_ROW_INVALID")
    return { project_id: row.project_id, installation_ids: ids }
  }

  function replaceSkillSelection(scope: ProjectOwnerScope, projectId: string, installationIds: string[], key: string, signal: AbortSignal) {
    return replaceProjectSkillSelection(database, {
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

  return { skillSelection, replaceSkillSelection }
}

export type ProjectSkillSelectionOperations = ReturnType<typeof createProjectSkillSelectionOperations>
