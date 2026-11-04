import { Controller, Get, Inject, Module, ServiceUnavailableException } from "@nestjs/common"
import { ReadinessIndicator } from "../../common/lifecycle/readiness.indicator.js"
import { DatabaseModule } from "../../common/database/database.module.js"
import { BFF_CONFIG } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"

@Controller()
class HealthController {
  public constructor(
    private readonly readiness: ReadinessIndicator,
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
  ) {}

  @Get("healthz")
  public health(): { status: "ok"; service: "kokoro-bff"; mode: BffConfig["mode"] } {
    return { status: "ok", service: "kokoro-bff", mode: this.config.mode }
  }

  @Get("readyz")
  public async ready(): Promise<{ status: "ok"; service: "kokoro-bff"; mode: BffConfig["mode"] }> {
    try {
      await this.readiness.assertReady()
    } catch {
      throw new ServiceUnavailableException(this.health())
    }
    return this.health()
  }
}

@Module({ imports: [DatabaseModule], controllers: [HealthController], providers: [ReadinessIndicator], exports: [ReadinessIndicator] })
export class HealthModule {}
