import { Inject, Injectable, Module } from "@nestjs/common"
import { BFF_CONFIG } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"

@Injectable()
export class IamRelayService {
  public constructor(@Inject(BFF_CONFIG) private readonly config: BffConfig) {}

  public get origin(): string | null {
    return this.config.iamBaseUrl
  }
}

@Module({ providers: [IamRelayService], exports: [IamRelayService] })
export class IamRelayModule {}
