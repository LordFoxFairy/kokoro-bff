import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import { AgentRunsModule } from "../agent-runs/agent-runs.module.js"
import { ProjectsModule } from "../projects/projects.module.js"

@Module({ imports: [ProjectsModule, AgentRunsModule, DatabaseModule], exports: [] })
export class ScheduledTasksModule {}
