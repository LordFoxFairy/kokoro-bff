import { Global, Module } from "@nestjs/common"
import { loadConfig } from "./runtime.js"
import { BFF_CONFIG } from "../common/tokens.js"

@Global()
@Module({
  providers: [{ provide: BFF_CONFIG, useFactory: () => loadConfig() }],
  exports: [BFF_CONFIG],
})
export class BffConfigModule {}
