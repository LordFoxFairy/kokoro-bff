import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { BffConfigModule } from "../../config/config.module.js"
import { AccountModule } from "../account/account.module.js"
import { BillingAdminMiddleware } from "./billing-admin.middleware.js"

@Module({ imports: [AccountModule, BffConfigModule], providers: [BillingAdminMiddleware], exports: [] })
export class BillingModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(BillingAdminMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
