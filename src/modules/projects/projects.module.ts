import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import { AccountModule } from "../account/account.module.js"
import { ChatModule } from "../chat/chat.module.js"

@Module({ imports: [AccountModule, ChatModule, DatabaseModule], exports: [] })
export class ProjectsModule {}
