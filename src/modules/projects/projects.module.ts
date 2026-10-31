import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import {
  BFF_CONFIG,
  BFF_DATABASE,
  BFF_POOL,
  PROJECT_SERVICE,
  PROJECT_SKILL_INSTALLATION_CLIENT,
  PROJECT_SKILL_SELECTION_PROVIDER,
} from "../../common/tokens.js"
import type { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import type { Pool } from "pg"
import { PostgresProjectRepository } from "../../infrastructure/postgres/project-repository.js"
import { PostgresIdempotencyRepository } from "../../infrastructure/postgres/idempotency-repository.js"
import { ProjectService } from "../../application/project-service.js"
import type { BffConfig } from "../../config/runtime.js"
import { PlatformServiceCredentialSource } from "../../infrastructure/clients/platform/platform-service-credential.js"
import { SkillInstallationConnectClient } from "../../infrastructure/clients/platform/skill-installation-connect.js"
import { AccountModule } from "../account/account.module.js"
import { ChatModule } from "../chat/chat.module.js"
import { ProjectPinMiddleware } from "./project-pin.middleware.js"
import type { ProjectSkillSelectionProvider } from "../../http/routes/project-skill-selection.js"
import { SkillsModule } from "../skills/skills.module.js"

@Module({
  imports: [AccountModule, ChatModule, DatabaseModule, SkillsModule],
  providers: [
    ProjectPinMiddleware,
    {
      provide: PROJECT_SERVICE,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): ProjectService => new ProjectService(new PostgresProjectRepository(database)),
    },
    {
      provide: PROJECT_SKILL_INSTALLATION_CLIENT,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): SkillInstallationConnectClient | null => {
        if (
          config.skillDraft?.platformBaseUrl === null ||
          config.skillDraft?.platformBaseUrl === undefined ||
          config.skillDraft.credentialFile === null ||
          config.skillDraft.credentialFile === undefined ||
          config.platformProjection.credentialFile === null ||
          config.platformProjection.credentialFile === undefined
        )
          return null
        return new SkillInstallationConnectClient(
          config.skillDraft.platformBaseUrl,
          new PlatformServiceCredentialSource(config.skillDraft.credentialFile, "catalog"),
          new PlatformServiceCredentialSource(config.platformProjection.credentialFile, "projection"),
          config.skillDraft.timeoutMs,
        )
      },
    },
    {
      provide: PROJECT_SKILL_SELECTION_PROVIDER,
      inject: [PROJECT_SERVICE, BFF_POOL],
      useFactory: (projectService: ProjectService, pool: Pool): ProjectSkillSelectionProvider => {
        const receipts = new PostgresIdempotencyRepository(pool)
        return {
          find: projectService.find.bind(projectService),
          skillSelection: projectService.skillSelection.bind(projectService),
          replaceSkillSelection: projectService.replaceSkillSelection.bind(projectService),
          getReceipt: receipts.getReceipt.bind(receipts),
        }
      },
    },
  ],
  exports: [PROJECT_SERVICE, PROJECT_SKILL_SELECTION_PROVIDER, PROJECT_SKILL_INSTALLATION_CLIENT],
})
export class ProjectsModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ProjectPinMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
