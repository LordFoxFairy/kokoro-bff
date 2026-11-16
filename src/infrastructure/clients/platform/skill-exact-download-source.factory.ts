import type { BffConfig } from "../../../config/runtime.js"
import {
  ExactSkillDownloadService,
  exactInstallationRecord,
  exactManagedRecord,
  type ExactSkillDownloadSource,
} from "../../../application/exact-skill-download.js"
import type { SkillDownloadHandles } from "../../../application/skill-download-handles.js"
import type { SkillInstallationConnectClient } from "./skill-installation-connect.js"
import { projectInstallation } from "./skill-installation-response.js"
import type { SkillProductConnectClient } from "./skill-product-connect.js"
import type { PostgresSkillShareRepository } from "../../postgres/skill-share-repository.js"
import { assertSkillWireKnown, projectSkillDownloadFact } from "./skill-product-response.js"
import { projectSkillPackageInspectionResponse } from "./skill-package-inspection-response.js"
import { PlatformProjectionHttpClient } from "./projection-http.js"

export function createSkillExactDownloadSource(
  config: BffConfig,
  product: SkillProductConnectClient | null,
  installations: SkillInstallationConnectClient | null,
  shares: PostgresSkillShareRepository,
  handles: SkillDownloadHandles,
): ExactSkillDownloadSource | null {
  if (!product || !installations || !shares || !config.platformProjection?.baseUrl || !config.platformProjection.credentialFile || !config.iamBaseUrl)
    return null
  const projection = new PlatformProjectionHttpClient(
    config.platformProjection.baseUrl,
    config.platformProjection.credentialFile,
    config.platformProjection.timeoutMs,
  )
  return new ExactSkillDownloadService({
    handles,
    objectOrigin: config.storageObjectOrigin ?? config.storage?.objectOrigin ?? null,
    installation: async (id, context, signal) =>
      exactInstallationRecord(
        id,
        projectInstallation(
          (
            await installations.get(
              {
                requestId: context.requestId,
                tenant: context.identity.namespace,
                subject: context.identity.userId,
                installationId: id,
              },
              signal,
            )
          ).installation,
        ),
      ),
    managed: async (id, context, signal, deadlineAt) => {
      const result = await projection.readManagedPersonalSkill(
        "managedSkill",
        context.identity.namespace,
        context.identity.userId,
        context.requestId,
        { skillId: id },
        signal,
        deadlineAt,
      )
      if (!result.ok) {
        if (result.status === 404) return null
        if (result.status === 502) throw new Error("skill_response_invalid")
        throw new Error("skill_dependency_unavailable")
      }
      return exactManagedRecord(id, result.data)
    },
    share: async (id, context, signal, deadlineAt) => {
      const share = await shares.findActive(context.identity.namespace, id)
      if (!share) return null
      const raw = await product.inspect(
        {
          requestId: context.requestId,
          tenant: context.identity.namespace,
          subject: context.identity.userId,
          sourceRef: share.sourceRef,
        },
        signal,
        deadlineAt,
      )
      assertSkillWireKnown(raw)
      const value = projectSkillPackageInspectionResponse(raw, {
        sourceRef: share.sourceRef,
      })
      return { sourceRef: value.source_ref, revision: value.revision }
    },
    download: async (sourceRef, context, signal, deadlineAt) => {
      const value = await product.download(
        {
          requestId: context.requestId,
          tenant: context.identity.namespace,
          subject: context.identity.userId,
          sourceRef,
        },
        signal,
        deadlineAt,
      )
      return projectSkillDownloadFact(value)
    },
  })
}
