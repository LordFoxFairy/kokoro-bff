import { Inject, Injectable, MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { BFF_CONFIG } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import { IamRelayMiddleware } from "./iam-relay.middleware.js"

@Injectable()
export class IamRelayService {
  public constructor(@Inject(BFF_CONFIG) private readonly config: BffConfig) {}

  public get origin(): string | null {
    return this.config.iamBaseUrl
  }
}

@Module({ providers: [IamRelayService, IamRelayMiddleware], exports: [IamRelayService] })
export class IamRelayModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(IamRelayMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
