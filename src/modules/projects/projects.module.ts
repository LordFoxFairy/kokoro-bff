import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import { BFF_DATABASE, PROJECT_SERVICE } from "../../common/tokens.js"
import type { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { PostgresProjectRepository } from "../../infrastructure/postgres/project-repository.js"
import { ProjectService } from "../../application/project-service.js"
import { AccountModule } from "../account/account.module.js"
import { ChatModule } from "../chat/chat.module.js"
import { ProjectPinMiddleware } from "./project-pin.middleware.js"

@Module({
  imports: [AccountModule, ChatModule, DatabaseModule],
  providers: [
    ProjectPinMiddleware,
    {
      provide: PROJECT_SERVICE,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): ProjectService => new ProjectService(new PostgresProjectRepository(database)),
    },
  ],
  exports: [PROJECT_SERVICE],
})
export class ProjectsModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ProjectPinMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
