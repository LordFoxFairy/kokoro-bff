import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { BffConfigModule } from "../../config/config.module.js"
import { AccountModule } from "../account/account.module.js"
import { IamRelayModule } from "../iam-relay/iam-relay.module.js"
import { BFF_CONFIG, BFF_POOL, SKILL_AUTHORIZATION, SKILL_DRAFT_CLIENT, SKILL_INSTALLATION_CLIENT, SKILL_PRODUCT_CLIENT, SKILL_USAGE_READER } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import { SkillAuthorizationClient } from "../../auth/skill-authorization.client.js"
import { PlatformServiceCredentialSource } from "../../infrastructure/clients/platform/platform-service-credential.js"
import { SkillInstallationConnectClient } from "../../infrastructure/clients/platform/skill-installation-connect.js"
import { CatalogConnectClient } from "../../infrastructure/clients/platform/catalog-connect.js"
import { SkillProductConnectClient } from "../../infrastructure/clients/platform/skill-product-connect.js"
import { SkillsMiddleware } from "./skills.middleware.js"
import type { Pool } from "pg"
import { readSkillUsage } from "../../infrastructure/postgres/skill-usage-projection.js"
import type { SkillUsageResult } from "../../application/agui/skill-usage.js"

@Module({
  imports: [AccountModule, IamRelayModule, BffConfigModule],
  providers: [
    SkillsMiddleware,
    {
      provide: SKILL_AUTHORIZATION,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): SkillAuthorizationClient => new SkillAuthorizationClient({ baseUrl: config.iamBaseUrl, timeoutMs: 5000, maxResponseBytes: 65_536 }),
    },
    {
      provide: SKILL_INSTALLATION_CLIENT,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): SkillInstallationConnectClient | null => {
        if (
          config.skillDraft?.platformBaseUrl === null ||
          config.skillDraft?.platformBaseUrl === undefined ||
          config.skillDraft.credentialFile === null ||
          config.skillDraft.credentialFile === undefined ||
          config.platformProjection.credentialFile === null ||
          config.platformProjection.credentialFile === undefined
        )
          return null
        return new SkillInstallationConnectClient(
          config.skillDraft.platformBaseUrl,
          new PlatformServiceCredentialSource(config.skillDraft.credentialFile, "catalog"),
          new PlatformServiceCredentialSource(config.platformProjection.credentialFile, "projection"),
          config.skillDraft.timeoutMs,
        )
      },
    },
    {
      provide: SKILL_DRAFT_CLIENT,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): CatalogConnectClient | null => {
        if (config.skillDraft?.platformBaseUrl === null || config.skillDraft?.platformBaseUrl === undefined || config.skillDraft.credentialFile === null || config.skillDraft.credentialFile === undefined)
          return null
        return new CatalogConnectClient(
          config.skillDraft.platformBaseUrl,
          new PlatformServiceCredentialSource(config.skillDraft.credentialFile, "catalog"),
          config.skillDraft.timeoutMs,
        )
      },
    },
    {
      provide: SKILL_PRODUCT_CLIENT,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): SkillProductConnectClient | null => {
        if (
          config.skillDraft?.platformBaseUrl === null ||
          config.skillDraft?.platformBaseUrl === undefined ||
          config.skillDraft.credentialFile === null ||
          config.skillDraft.credentialFile === undefined ||
          config.platformProjection?.credentialFile === null ||
          config.platformProjection?.credentialFile === undefined
        )
          return null
        return new SkillProductConnectClient(
          config.skillDraft.platformBaseUrl,
          new PlatformServiceCredentialSource(config.skillDraft.credentialFile, "catalog"),
          new PlatformServiceCredentialSource(config.platformProjection.credentialFile, "projection"),
          config.skillDraft.timeoutMs,
        )
      },
    },
    {
      provide: SKILL_USAGE_READER,
      inject: [BFF_POOL],
      useFactory: (pool: Pool): ((tenant: string, refs: readonly string[]) => Promise<Map<string, SkillUsageResult>>) => async (tenant, refs) => {
        const client = await pool.connect()
        try {
          return await readSkillUsage(client, tenant, refs)
        } finally {
          client.release()
        }
      },
    },
  ],
  exports: [SKILL_AUTHORIZATION, SKILL_DRAFT_CLIENT, SKILL_INSTALLATION_CLIENT, SKILL_PRODUCT_CLIENT, SKILL_USAGE_READER],
})
export class SkillsModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SkillsMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
