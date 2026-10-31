import { Controller, Get, Module } from "@nestjs/common"
import { ReadinessIndicator } from "../../common/lifecycle/readiness.indicator.js"
import { DatabaseModule } from "../../common/database/database.module.js"

@Controller()
class HealthController {
  public constructor(private readonly readiness: ReadinessIndicator) {}

  @Get("healthz")
  public health(): { status: "ok"; service: "kokoro-bff" } {
    return { status: "ok", service: "kokoro-bff" }
  }

  @Get("readyz")
  public async ready(): Promise<{ status: "ok"; service: "kokoro-bff" }> {
    await this.readiness.assertReady()
    return { status: "ok", service: "kokoro-bff" }
  }
}

@Module({ imports: [DatabaseModule], controllers: [HealthController], providers: [ReadinessIndicator], exports: [ReadinessIndicator] })
export class HealthModule {}
