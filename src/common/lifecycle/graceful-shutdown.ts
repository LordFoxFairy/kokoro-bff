import { Injectable, OnApplicationShutdown } from "@nestjs/common"
import { LegacyRoutesRuntime } from "../../modules/legacy-routes/legacy-routes.runtime.js"

@Injectable()
export class GracefulShutdown implements OnApplicationShutdown {
  public constructor(private readonly legacy: LegacyRoutesRuntime) {}

  public async onApplicationShutdown(): Promise<void> {
    await this.legacy.close()
  }
}
