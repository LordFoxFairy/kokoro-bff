import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { BffConfigModule } from "../../config/config.module.js"
import { IamRelayModule } from "../iam-relay/iam-relay.module.js"
import { AccountModule } from "../account/account.module.js"
import { SystemMiddleware } from "./system.middleware.js"

@Module({ imports: [AccountModule, IamRelayModule, BffConfigModule], providers: [SystemMiddleware], exports: [] })
export class SystemModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SystemMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
