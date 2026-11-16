import type { BffConfig } from "../../../config/runtime.js"
import { ExactSkillDownloadService, exactInstallationRecord, type ExactSkillDownloadSource } from "../../../application/exact-skill-download.js"
import type { SkillDownloadHandles } from "../../../application/skill-download-handles.js"
import type { SkillInstallationConnectClient } from "./skill-installation-connect.js"
import { projectInstallation } from "./skill-installation-response.js"
import type { ProjectLookup } from "../../../application/projects/types.js"
import type { SkillPackageInspectionConnectClient } from "./skill-package-inspection-connect.js"
import { projectSkillDownloadFact } from "./skill-product-response.js"

export function createProjectExactDownloadSource(
  config: BffConfig,
  projectService: ProjectLookup,
  installations: SkillInstallationConnectClient | null,
  packageInspection: SkillPackageInspectionConnectClient | null,
  handles: SkillDownloadHandles,
): ExactSkillDownloadSource | null {
  if (!installations || !packageInspection) return null
  return new ExactSkillDownloadService({
    handles,
    objectOrigin: config.storageObjectOrigin ?? config.storage?.objectOrigin ?? null,
    projectInstallation: {
      resolve: async (projectId, installationId, context, signal) => {
        signal.throwIfAborted()
        const project = await projectService.find(
          {
            tenantId: context.identity.namespace,
            subjectId: context.identity.userId,
          },
          projectId,
        )
        signal.throwIfAborted()
        if (!project || project.id !== projectId) return null
        const owner = await installations.get(
          {
            requestId: context.requestId,
            tenant: context.identity.namespace,
            subject: context.identity.userId,
            projectRef: projectId,
            installationId,
          },
          signal,
        )
        if (!("projectRef" in owner) || owner.projectRef !== projectId) throw new Error("skill_response_invalid")
        const record = exactInstallationRecord(installationId, projectInstallation(owner.installation))
        const current = await projectService.find(
          {
            tenantId: context.identity.namespace,
            subjectId: context.identity.userId,
          },
          projectId,
        )
        signal.throwIfAborted()
        return current?.id === projectId ? record : null
      },
      download: async (projectId, installationId, context, signal, deadlineAt) => {
        const value = await packageInspection.downloadProject(
          {
            projectId,
            installationId,
            requestId: context.requestId,
            tenant: context.identity.namespace,
            subject: context.identity.userId,
          },
          signal,
          deadlineAt,
        )
        return projectSkillDownloadFact(value)
      },
    },
  })
}
