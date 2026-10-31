import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import { AccountModule } from "../account/account.module.js"
import { AgentRunsModule } from "../agent-runs/agent-runs.module.js"

@Module({ imports: [AccountModule, DatabaseModule, AgentRunsModule], exports: [] })
export class ChatModule {}
