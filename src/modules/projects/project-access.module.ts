import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import { BFF_DATABASE, BFF_POOL, PROJECT_LOOKUP, PROJECT_SERVICE, PROJECT_SKILL_SELECTION_PROVIDER } from "../../common/tokens.js"
import type { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import type { Pool } from "pg"
import { createProjectLookup, PostgresProjectRepository } from "../../infrastructure/postgres/project-repository.js"
import { PostgresIdempotencyRepository } from "../../infrastructure/postgres/idempotency-repository.js"
import { ProjectService } from "../../application/project-service.js"
import type { ProjectSkillSelectionProvider } from "../../http/routes/project-skill-selection.js"

/** Project owner capabilities for same-repository feature consumers. */
@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: PROJECT_LOOKUP, inject: [BFF_POOL], useFactory: createProjectLookup },
    {
      provide: PROJECT_SERVICE,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): ProjectService => new ProjectService(new PostgresProjectRepository(database)),
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
  exports: [PROJECT_LOOKUP, PROJECT_SERVICE, PROJECT_SKILL_SELECTION_PROVIDER],
})
export class ProjectAccessModule {}
