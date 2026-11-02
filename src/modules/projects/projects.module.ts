import { Inject, Injectable, MiddlewareConsumer, Module, NestModule, OnApplicationShutdown, OnModuleInit, RequestMethod } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import {
  BFF_CONFIG,
  BFF_DATABASE,
  BFF_POOL,
  PROJECT_IDEMPOTENCY,
  PROJECT_EXACT_DOWNLOAD_SOURCE,
  PROJECT_SCOPE_RELEASE_DISPATCHER,
  PROJECT_SCOPE_RELEASE_OUTBOX,
  PROJECT_SERVICE,
  SKILL_DOWNLOAD_HANDLES,
  SKILL_INSTALLATION_CLIENT,
  SKILL_PACKAGE_INSPECTION_CLIENT,
} from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { ProjectService } from "../../application/project-service.js"
import { AccountModule } from "../account/account.module.js"
import { ChatModule } from "../chat/chat.module.js"
import { ProjectPinMiddleware } from "./project-pin.middleware.js"
import { ProjectMutationMiddleware } from "./project-mutation.middleware.js"
import { ProjectSkillPackageInspectionMiddleware } from "./project-skill-package-inspection.middleware.js"
import { ProjectSkillDownloadMiddleware } from "./project-skill-download.middleware.js"
import { SkillsModule } from "../skills/skills.module.js"
import { ProjectAccessModule } from "./project-access.module.js"
import type { SkillDownloadHandles } from "../../application/skill-download-handles.js"
import { ExactSkillDownloadService, exactInstallationRecord, type ExactSkillDownloadSource } from "../../application/exact-skill-download.js"
import type { SkillInstallationConnectClient } from "../../infrastructure/clients/platform/skill-installation-connect.js"
import type { SkillPackageInspectionConnectClient } from "../../infrastructure/clients/platform/skill-package-inspection-connect.js"
import { projectInstallation } from "../../infrastructure/clients/platform/skill-installation-response.js"
import { assertSkillWireKnown, skillTimestamp } from "../../infrastructure/clients/platform/skill-product-response.js"
import { PostgresProjectScopeReleaseOutboxRepository } from "../../infrastructure/postgres/project-scope-release-outbox-repository.js"
import type { ProjectScopeReleaseOutboxRepository } from "../../application/projects/project-scope-release-outbox.js"
import { ProjectScopeReleaseOutboxDispatcher } from "../../application/project-scope-release-outbox-dispatcher.js"
import { StorageScopeReleaseClient } from "../../infrastructure/clients/storage/scope-release-client.js"
import { randomUUID } from "node:crypto"
import { PostgresIdempotencyRepository } from "../../infrastructure/postgres/idempotency-repository.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import type { Pool } from "pg"

@Injectable()
class ProjectScopeReleaseWorkerLifecycle implements OnModuleInit, OnApplicationShutdown {
  public constructor(@Inject(PROJECT_SCOPE_RELEASE_DISPATCHER) private readonly dispatcher: ProjectScopeReleaseOutboxDispatcher | null) {}

  public onModuleInit(): void {
    this.dispatcher?.start()
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.dispatcher?.stop()
  }
}

@Module({
  imports: [AccountModule, ChatModule, DatabaseModule, SkillsModule, ProjectAccessModule],
  providers: [
    ProjectPinMiddleware,
    ProjectMutationMiddleware,
    ProjectSkillPackageInspectionMiddleware,
    ProjectSkillDownloadMiddleware,
    {
      provide: PROJECT_EXACT_DOWNLOAD_SOURCE,
      inject: [BFF_CONFIG, PROJECT_SERVICE, SKILL_INSTALLATION_CLIENT, SKILL_PACKAGE_INSPECTION_CLIENT, SKILL_DOWNLOAD_HANDLES],
      useFactory: (
        config: BffConfig,
        projectService: ProjectService,
        installations: SkillInstallationConnectClient | null,
        packageInspection: SkillPackageInspectionConnectClient | null,
        handles: SkillDownloadHandles,
      ): ExactSkillDownloadSource | null => {
        if (!installations || !packageInspection) return null
        return new ExactSkillDownloadService({
          handles,
          objectOrigin: config.storageObjectOrigin ?? config.storage?.objectOrigin ?? null,
          projectInstallation: {
            resolve: async (projectId, installationId, context, signal) => {
              signal.throwIfAborted()
              const project = await projectService.find({ tenantId: context.identity.namespace, subjectId: context.identity.userId }, projectId)
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
              const current = await projectService.find({ tenantId: context.identity.namespace, subjectId: context.identity.userId }, projectId)
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
              assertSkillWireKnown(value)
              return {
                sourceRef: value.sourceRef?.value ?? "",
                revision: value.revision.toString(),
                filename: value.filename,
                sizeBytes: value.sizeBytes,
                contentSha256: value.contentSha256,
                transfer: {
                  url: value.transferReference?.url ?? "",
                  method: value.transferReference?.method ?? "",
                  requiredHeaders: value.transferReference?.requiredHeaders ?? {},
                  expiresAt: skillTimestamp(value.transferReference?.expiresAt),
                },
              }
            },
          },
        })
      },
    },
    {
      provide: PROJECT_SCOPE_RELEASE_OUTBOX,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): ProjectScopeReleaseOutboxRepository => new PostgresProjectScopeReleaseOutboxRepository(database),
    },
    {
      provide: PROJECT_IDEMPOTENCY,
      inject: [BFF_POOL],
      useFactory: (pool: Pool): IdempotencyRepository => new PostgresIdempotencyRepository(pool),
    },
    {
      provide: PROJECT_SCOPE_RELEASE_DISPATCHER,
      inject: [PROJECT_SCOPE_RELEASE_OUTBOX, BFF_CONFIG],
      useFactory: (repository: ProjectScopeReleaseOutboxRepository, config: BffConfig): ProjectScopeReleaseOutboxDispatcher | null => {
        if (config.storage === undefined) return null
        return new ProjectScopeReleaseOutboxDispatcher(repository, new StorageScopeReleaseClient(config.storage.baseUrl, config.storage.secret), {
          workerId: `bff-project-scope-release-${process.pid}-${randomUUID()}`,
        })
      },
    },
    ProjectScopeReleaseWorkerLifecycle,
  ],
  exports: [PROJECT_EXACT_DOWNLOAD_SOURCE, PROJECT_SCOPE_RELEASE_OUTBOX, PROJECT_SCOPE_RELEASE_DISPATCHER, ProjectAccessModule],
})
export class ProjectsModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ProjectMutationMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
    consumer.apply(ProjectPinMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
    consumer.apply(ProjectSkillDownloadMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
    consumer.apply(ProjectSkillPackageInspectionMiddleware).forRoutes({ path: "*", method: RequestMethod.GET })
  }
}
