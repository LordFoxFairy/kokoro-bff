import { Module } from "@nestjs/common"
import { BFF_CONFIG, SKILL_INSTALLATION_CLIENT } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import { PlatformServiceCredentialSource } from "../../infrastructure/clients/platform/platform-service-credential.js"
import { SkillInstallationConnectClient } from "../../infrastructure/clients/platform/skill-installation-connect.js"
import { BffConfigModule } from "../../config/config.module.js"

/** Shared Skill installation owner client used by Skills, Projects and Chat selection resolution. */
@Module({
  imports: [BffConfigModule],
  providers: [
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
        ) return null
        return new SkillInstallationConnectClient(
          config.skillDraft.platformBaseUrl,
          new PlatformServiceCredentialSource(config.skillDraft.credentialFile, "catalog"),
          new PlatformServiceCredentialSource(config.platformProjection.credentialFile, "projection"),
          config.skillDraft.timeoutMs,
        )
      },
    },
  ],
  exports: [SKILL_INSTALLATION_CLIENT],
})
export class SkillInstallationAccessModule {}
