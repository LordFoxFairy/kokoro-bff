import { createProjectExactDownloadSource } from "../../infrastructure/clients/platform/project-exact-download-source.factory.js"
import { ProjectGrantMiddleware } from "./project-grant.middleware.js"
import { BeforeApplicationShutdown, Inject, Injectable, MiddlewareConsumer, Module, NestModule, OnModuleInit, RequestMethod } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import {
  BFF_CONFIG,
  BFF_DATABASE,
  BFF_POOL,
  PROJECT_DELETION,
  PROJECT_IDEMPOTENCY,
  PROJECT_MUTATIONS,
  PROJECT_READS,
  PROJECT_RENAME,
  PROJECT_EXACT_DOWNLOAD_SOURCE,
  PROJECT_SCOPE_RELEASE_DISPATCHER,
  PROJECT_SCOPE_RELEASE_OUTBOX,
  PROJECT_READ_LOOKUP,
  SKILL_DOWNLOAD_HANDLES,
  SKILL_INSTALLATION_CLIENT,
  SKILL_PACKAGE_INSPECTION_CLIENT,
} from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import type { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { createProjectDeletion, createProjectRenamer } from "../../application/projects/commands.js"
import { createProjectMutationStore, createProjectReadStore } from "../../infrastructure/postgres/project-store.js"
import { deleteProjectAggregate, readProjectDeletion } from "../../infrastructure/postgres/project-delete.js"
import { renameProject } from "../../infrastructure/postgres/project-rename.js"
import { AuthenticationModule } from "../authentication/authentication.module.js"
import { ChatModule } from "../chat/chat.module.js"
import { ProjectPinMiddleware } from "./project-pin.middleware.js"
import { ProjectMutationMiddleware } from "./project-mutation.middleware.js"
import { ProjectSkillPackageInspectionMiddleware } from "./project-skill-package-inspection.middleware.js"
import { ProjectSkillDownloadMiddleware } from "./project-skill-download.middleware.js"
import { SkillsModule } from "../skills/skills.module.js"
import { ProjectAccessModule } from "./project-access.module.js"
import { PostgresProjectScopeReleaseOutboxRepository } from "../../infrastructure/postgres/project-scope-release-outbox-repository.js"
import type { ProjectScopeReleaseOutboxRepository } from "../../application/projects/project-scope-release-outbox.js"
import { ProjectScopeReleaseOutboxDispatcher } from "../../application/project-scope-release-outbox-dispatcher.js"
import { StorageScopeReleaseClient } from "../../infrastructure/clients/storage/scope-release-client.js"
import { randomUUID } from "node:crypto"
import { PostgresIdempotencyRepository } from "../../infrastructure/postgres/idempotency-repository.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import type { Pool } from "pg"

@Injectable()
class ProjectScopeReleaseWorkerLifecycle implements OnModuleInit, BeforeApplicationShutdown {
  public constructor(
    @Inject(PROJECT_SCOPE_RELEASE_DISPATCHER)
    private readonly dispatcher: ProjectScopeReleaseOutboxDispatcher | null,
  ) {}

  public onModuleInit(): void {
    this.dispatcher?.start()
  }

  public async beforeApplicationShutdown(): Promise<void> {
    try {
      await this.dispatcher?.stop()
    } catch {
      process.exitCode = 1
      throw new Error("bff_project_scope_release_shutdown_failed")
    }
  }
}

@Module({
  imports: [AuthenticationModule, ChatModule, DatabaseModule, SkillsModule, ProjectAccessModule],
  providers: [
    ProjectGrantMiddleware,
    ProjectPinMiddleware,
    ProjectMutationMiddleware,
    ProjectSkillPackageInspectionMiddleware,
    ProjectSkillDownloadMiddleware,
    {
      provide: PROJECT_READS,
      inject: [BFF_POOL],
      useFactory: createProjectReadStore,
    },
    {
      provide: PROJECT_MUTATIONS,
      inject: [BFF_POOL],
      useFactory: createProjectMutationStore,
    },
    {
      provide: PROJECT_RENAME,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase) => createProjectRenamer(renameProject.bind(null, database)),
    },
    {
      provide: PROJECT_DELETION,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase) =>
        createProjectDeletion(deleteProjectAggregate.bind(null, database), readProjectDeletion.bind(null, database)),
    },
    {
      provide: PROJECT_EXACT_DOWNLOAD_SOURCE,
      inject: [BFF_CONFIG, PROJECT_READ_LOOKUP, SKILL_INSTALLATION_CLIENT, SKILL_PACKAGE_INSPECTION_CLIENT, SKILL_DOWNLOAD_HANDLES],
      useFactory: createProjectExactDownloadSource,
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
    consumer.apply(ProjectGrantMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
    consumer.apply(ProjectMutationMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
    consumer.apply(ProjectPinMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
    consumer.apply(ProjectSkillDownloadMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
    consumer.apply(ProjectSkillPackageInspectionMiddleware).forRoutes({ path: "*", method: RequestMethod.GET })
  }
}
