import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { BffConfigModule } from "../../config/config.module.js"
import { AccountModule } from "../account/account.module.js"
import { DatabaseModule } from "../../common/database/database.module.js"
import { BFF_POOL, MUSIC_IDEMPOTENCY } from "../../common/tokens.js"
import type { Pool } from "pg"
import { PostgresIdempotencyRepository } from "../../infrastructure/postgres/idempotency-repository.js"
import { MusicMiddleware } from "./music.middleware.js"

@Module({
  imports: [AccountModule, BffConfigModule, DatabaseModule],
  providers: [
    MusicMiddleware,
    {
      provide: MUSIC_IDEMPOTENCY,
      inject: [BFF_POOL],
      useFactory: (pool: Pool) => ({ entries: new Map(), persistent: new PostgresIdempotencyRepository(pool) }),
    },
  ],
  exports: [],
})
export class MusicModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MusicMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
