import { Inject, Injectable } from "@nestjs/common"
import type { BffConfig } from "../../config/runtime.js"
import { BFF_CONFIG, BFF_DATABASE } from "../tokens.js"
import { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"

@Injectable()
export class ReadinessIndicator {
  public constructor(
    @Inject(BFF_CONFIG) private readonly config: BffConfig,
    @Inject(BFF_DATABASE) private readonly database: PostgresBffDatabase,
  ) {}

  public async assertReady(): Promise<void> {
    if (this.config.iamBaseUrl === null) throw new Error("KOKORO_IAM_BASE_URL is not configured")
    await this.database.ready()
  }
}
