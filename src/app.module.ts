import { Module } from "@nestjs/common"
import { BffConfigModule } from "./config/config.module.js"
import { DatabaseModule } from "./common/database/database.module.js"
import { RedisModule } from "./common/redis/redis.module.js"
import { GracefulShutdown } from "./common/lifecycle/graceful-shutdown.js"
import { HealthModule } from "./modules/health/health.module.js"
import { IamRelayModule } from "./modules/iam-relay/iam-relay.module.js"
import { LegacyRoutesModule } from "./modules/legacy-routes/legacy-routes.module.js"
import { AccountModule } from "./modules/account/account.module.js"
import { ChatModule } from "./modules/chat/chat.module.js"
import { AgentRunsModule } from "./modules/agent-runs/agent-runs.module.js"
import { ProjectsModule } from "./modules/projects/projects.module.js"
import { AguiModule } from "./modules/agui/agui.module.js"
import { ScheduledTasksModule } from "./modules/scheduled-tasks/scheduled-tasks.module.js"
import { SkillsModule } from "./modules/skills/skills.module.js"
import { McpModule } from "./modules/mcp/mcp.module.js"
import { BillingModule } from "./modules/billing/billing.module.js"
import { SystemModule } from "./modules/system/system.module.js"
import { MusicModule } from "./modules/music/music.module.js"

@Module({
  imports: [
    BffConfigModule,
    DatabaseModule,
    RedisModule,
    HealthModule,
    IamRelayModule,
    AccountModule,
    ChatModule,
    AgentRunsModule,
    ProjectsModule,
    AguiModule,
    ScheduledTasksModule,
    SkillsModule,
    McpModule,
    BillingModule,
    SystemModule,
    MusicModule,
    LegacyRoutesModule,
  ],
  providers: [GracefulShutdown],
})
export class AppModule {}
