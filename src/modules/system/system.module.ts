import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { BffConfigModule } from "../../config/config.module.js"
import { IamRelayModule } from "../iam-relay/iam-relay.module.js"
import { SystemMiddleware } from "./system.middleware.js"

@Module({ imports: [IamRelayModule, BffConfigModule], providers: [SystemMiddleware], exports: [] })
export class SystemModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SystemMiddleware).forRoutes({ path: "v1/system/runtime-manifest", method: RequestMethod.GET })
  }
}
