import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { BffConfigModule } from "../../config/config.module.js"
import { DatabaseModule } from "../../common/database/database.module.js"
import { AuthenticationModule } from "../authentication/authentication.module.js"
import { BillingAdminMiddleware } from "./billing-admin.middleware.js"
import { BillingPersonalMiddleware } from "./billing-personal.middleware.js"
import { BFF_POOL, BILLING_IDEMPOTENCY } from "../../common/tokens.js"
import type { Pool } from "pg"
import { PostgresIdempotencyRepository } from "../../infrastructure/postgres/idempotency-repository.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"

@Module({
  imports: [AuthenticationModule, BffConfigModule, DatabaseModule],
  providers: [
    BillingAdminMiddleware,
    BillingPersonalMiddleware,
    {
      provide: BILLING_IDEMPOTENCY,
      inject: [BFF_POOL],
      useFactory: (pool: Pool): IdempotencyRepository => new PostgresIdempotencyRepository(pool),
    },
  ],
  exports: [],
})
export class BillingModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(BillingPersonalMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
    consumer.apply(BillingAdminMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
