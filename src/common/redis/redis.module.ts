import { Module } from "@nestjs/common"
import type { RedisClientType } from "redis"
import { BFF_DATABASE, BFF_REDIS } from "../tokens.js"
import { DatabaseModule } from "../database/database.module.js"
import { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: BFF_REDIS,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): RedisClientType => database.redis,
    },
  ],
  exports: [BFF_REDIS],
})
export class RedisModule {}
