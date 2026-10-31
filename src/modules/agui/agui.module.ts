import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import { RedisModule } from "../../common/redis/redis.module.js"
import { ChatModule } from "../chat/chat.module.js"

@Module({ imports: [ChatModule, RedisModule, DatabaseModule], exports: [] })
export class AguiModule {}
