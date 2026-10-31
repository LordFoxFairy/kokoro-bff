import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { AccountModule } from "../account/account.module.js"
import { LegacyRoutesMiddleware } from "./legacy-routes.middleware.js"
import { LegacyRoutesRuntime } from "./legacy-routes.runtime.js"

@Module({
  imports: [AccountModule],
  providers: [LegacyRoutesRuntime],
  exports: [LegacyRoutesRuntime],
})
export class LegacyRoutesModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(LegacyRoutesMiddleware)
      .exclude({ path: "healthz", method: RequestMethod.GET }, { path: "readyz", method: RequestMethod.GET })
      .forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
