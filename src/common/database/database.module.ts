import { Module } from "@nestjs/common"
import { BFF_CONFIG, BFF_DATABASE, BFF_POOL } from "../tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { BffConfigModule } from "../../config/config.module.js"

@Module({
  imports: [BffConfigModule],
  providers: [
    {
      provide: BFF_DATABASE,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): PostgresBffDatabase => {
        if (config.postgresUrl === null || config.redisUrl === null) {
          throw new Error("BFF database and Redis URLs are required for the Nest runtime")
        }
        return new PostgresBffDatabase(config.postgresUrl, config.redisUrl)
      },
    },
    {
      provide: BFF_POOL,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase) => database.pool,
    },
  ],
  exports: [BFF_DATABASE, BFF_POOL],
})
export class DatabaseModule {}
