import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { BffConfigModule } from "../../config/config.module.js"
import { IamRelayModule } from "../iam-relay/iam-relay.module.js"
import { AuthenticationModule } from "../authentication/authentication.module.js"
import { SystemMiddleware } from "./system.middleware.js"
import { SystemModelCatalogMiddleware } from "./system-model-catalog.middleware.js"

@Module({ imports: [AuthenticationModule, IamRelayModule, BffConfigModule], providers: [SystemMiddleware, SystemModelCatalogMiddleware], exports: [] })
export class SystemModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SystemModelCatalogMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
    consumer.apply(SystemMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
