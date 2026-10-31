import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common"
import { BffConfigModule } from "../../config/config.module.js"
import { AccountModule } from "../account/account.module.js"
import { IamRelayModule } from "../iam-relay/iam-relay.module.js"
import { BFF_CONFIG, SKILL_AUTHORIZATION, SKILL_INSTALLATION_CLIENT } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import { SkillAuthorizationClient } from "../../auth/skill-authorization.client.js"
import { PlatformServiceCredentialSource } from "../../infrastructure/clients/platform/platform-service-credential.js"
import { SkillInstallationConnectClient } from "../../infrastructure/clients/platform/skill-installation-connect.js"
import { SkillsMiddleware } from "./skills.middleware.js"

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
  ],
  exports: [SKILL_AUTHORIZATION, SKILL_INSTALLATION_CLIENT],
})
export class SkillsModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SkillsMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
