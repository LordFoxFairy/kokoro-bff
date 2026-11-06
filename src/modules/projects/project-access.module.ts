import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import {
  BFF_DATABASE,
  BFF_POOL,
  PROJECT_LOOKUP,
  PROJECT_MCP_RECOMMENDATIONS_STORE,
  PROJECT_PINS,
  PROJECT_TASKS,
  PROJECT_SKILL_SELECTION_PROVIDER,
} from "../../common/tokens.js"
import type { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import type { Pool } from "pg"
import { createProjectLookup } from "../../infrastructure/postgres/project-store.js"
import { createProjectTasks } from "../../infrastructure/postgres/project-tasks.js"
import { createProjectPins } from "../../infrastructure/postgres/project-pin.js"
import { PostgresIdempotencyRepository } from "../../infrastructure/postgres/idempotency-repository.js"
import { createProjectSkillSelectionOperations } from "../../infrastructure/postgres/project-skill-selection.js"
import { createProjectMcpRecommendationsStore } from "../../infrastructure/postgres/project-mcp-recommendations.js"
import type { ProjectLookup } from "../../application/projects/types.js"
import type { ProjectSkillSelectionProvider } from "../../http/routes/project-skill-selection.js"

/** Project owner capabilities for same-repository feature consumers. */
@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: PROJECT_PINS, inject: [BFF_DATABASE], useFactory: createProjectPins },
    { provide: PROJECT_TASKS, inject: [BFF_DATABASE], useFactory: createProjectTasks },
    { provide: PROJECT_LOOKUP, inject: [BFF_POOL], useFactory: createProjectLookup },
    { provide: PROJECT_MCP_RECOMMENDATIONS_STORE, inject: [BFF_DATABASE], useFactory: createProjectMcpRecommendationsStore },
    {
      provide: PROJECT_SKILL_SELECTION_PROVIDER,
      inject: [PROJECT_LOOKUP, BFF_DATABASE, BFF_POOL],
      useFactory: (lookup: ProjectLookup, database: PostgresBffDatabase, pool: Pool): ProjectSkillSelectionProvider => {
        const receipts = new PostgresIdempotencyRepository(pool)
        return {
          find: lookup.find,
          ...createProjectSkillSelectionOperations(database),
          getReceipt: receipts.getReceipt.bind(receipts),
        }
      },
    },
  ],
  exports: [PROJECT_LOOKUP, PROJECT_MCP_RECOMMENDATIONS_STORE, PROJECT_PINS, PROJECT_TASKS, PROJECT_SKILL_SELECTION_PROVIDER],
})
export class ProjectAccessModule {}
