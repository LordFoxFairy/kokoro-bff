import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { AccountModule } from "../account/account.module.js"
import { SkillsModule } from "../skills/skills.module.js"
import { ChatModule } from "../chat/chat.module.js"
import { ScheduledTasksModule } from "../scheduled-tasks/scheduled-tasks.module.js"
import { LegacyRoutesMiddleware } from "./legacy-routes.middleware.js"
import { LegacyRoutesRuntime } from "./legacy-routes.runtime.js"

@Module({
  imports: [AccountModule, SkillsModule, ChatModule, ScheduledTasksModule],
  providers: [LegacyRoutesRuntime],
  exports: [LegacyRoutesRuntime],
})
export class LegacyRoutesModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(LegacyRoutesMiddleware)
      .exclude({ path: "healthz", method: RequestMethod.GET }, { path: "readyz", method: RequestMethod.GET })
      .forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
