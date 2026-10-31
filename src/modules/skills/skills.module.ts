import { Inject, Injectable, MiddlewareConsumer, Module, NestModule, OnApplicationShutdown, RequestMethod } from "@nestjs/common"
import { BffConfigModule } from "../../config/config.module.js"
import { AccountModule } from "../account/account.module.js"
import { IamRelayModule } from "../iam-relay/iam-relay.module.js"
import { APP_SKILL_BINDING_CLIENT, BFF_CONFIG, BFF_DATABASE, BFF_POOL, OPEN_APP_MANAGEMENT_ADMISSION, SKILL_ADMIN_CLIENT, SKILL_AUTHORIZATION, SKILL_DOWNLOAD_HANDLES, SKILL_DRAFT_CLIENT, SKILL_IMPORT_RECEIPTS, SKILL_INSTALLATION_CLIENT, SKILL_LIST_ADMISSION, SKILL_LOCAL_IMPORT_CLIENT, SKILL_PACKAGE_INSPECTION_CLIENT, SKILL_PRODUCT_CLIENT, SKILL_SHARE_REPOSITORY, SKILL_SPECIFICATION_SOURCE, SKILL_USAGE_READER } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import { SkillAuthorizationClient } from "../../auth/skill-authorization.client.js"
import { PlatformServiceCredentialSource } from "../../infrastructure/clients/platform/platform-service-credential.js"
import { SkillInstallationConnectClient } from "../../infrastructure/clients/platform/skill-installation-connect.js"
import { CatalogConnectClient } from "../../infrastructure/clients/platform/catalog-connect.js"
import { SkillProductConnectClient } from "../../infrastructure/clients/platform/skill-product-connect.js"
import { SkillAdminConnectClient } from "../../infrastructure/clients/platform/skill-admin-connect.js"
import { LocalSkillImportConnectClient } from "../../infrastructure/clients/platform/local-skill-import-connect.js"
import type { LocalSkillImportClient } from "../../http/routes/local-skill-import.js"
import { SkillsMiddleware } from "./skills.middleware.js"
import type { Pool } from "pg"
import { readSkillUsage } from "../../infrastructure/postgres/skill-usage-projection.js"
import type { SkillUsageResult } from "../../application/agui/skill-usage.js"
import { PostgresIdempotencyRepository } from "../../infrastructure/postgres/idempotency-repository.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import { ChatModule } from "../chat/chat.module.js"
import { DatabaseModule } from "../../common/database/database.module.js"
import type { PostgresBffDatabase } from "../../infrastructure/postgres/client.js"
import { PostgresSkillShareRepository } from "../../infrastructure/postgres/skill-share-repository.js"
import { SkillSpecificationService } from "../../application/skill-specification.js"
import type { SkillSpecificationSource } from "../../application/skill-specification.types.js"
import { PlatformSkillSpecificationFacade } from "../../infrastructure/clients/platform/skill-specification-facade.js"
import { PlatformProjectionHttpClient } from "../../infrastructure/clients/platform/projection-http.js"
import { IamPublisherProfileClient } from "../../infrastructure/clients/iam-publisher-profile.js"
import { OpenAppManagementAdmissionClient } from "../../auth/open-app-management-admission.client.js"
import { AppSkillBindingConnectClient } from "../../infrastructure/clients/platform/app-skill-binding-connect.js"
import { SkillListAdmissionClient } from "../../auth/skill-list-admission.client.js"
import { SkillDownloadHandles } from "../../application/skill-download-handles.js"
import { SkillPackageInspectionConnectClient } from "../../infrastructure/clients/platform/skill-package-inspection-connect.js"

@Injectable()
class SkillsRuntime implements OnApplicationShutdown {
  public constructor(@Inject(SKILL_DOWNLOAD_HANDLES) private readonly handles: SkillDownloadHandles) {}

  public onApplicationShutdown(): void {
    this.handles.clear()
  }
}

@Module({
  imports: [AccountModule, ChatModule, DatabaseModule, IamRelayModule, BffConfigModule],
  providers: [
    SkillsMiddleware,
    SkillsRuntime,
    {
      provide: SKILL_LIST_ADMISSION,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): SkillListAdmissionClient => new SkillListAdmissionClient({
        baseUrl: config.iamBaseUrl,
        timeoutMs: config.upstreamTimeoutMs,
        maxResponseBytes: config.upstreamMaxResponseBytes,
      }),
    },
    { provide: SKILL_DOWNLOAD_HANDLES, useFactory: (): SkillDownloadHandles => new SkillDownloadHandles() },
    {
      provide: SKILL_PACKAGE_INSPECTION_CLIENT,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): SkillPackageInspectionConnectClient | null => config.platformProjection?.baseUrl && config.platformProjection.credentialFile
        ? new SkillPackageInspectionConnectClient(config.platformProjection.baseUrl, config.platformProjection.credentialFile, config.platformProjection.timeoutMs)
        : null,
    },
    {
      provide: OPEN_APP_MANAGEMENT_ADMISSION,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): OpenAppManagementAdmissionClient => new OpenAppManagementAdmissionClient({
        baseUrl: config.iamBaseUrl,
        timeoutMs: config.upstreamTimeoutMs,
        maxResponseBytes: config.upstreamMaxResponseBytes,
      }),
    },
    {
      provide: APP_SKILL_BINDING_CLIENT,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): AppSkillBindingConnectClient | null =>
        config.skillDraft?.platformBaseUrl && config.skillDraft.credentialFile && config.platformProjection?.credentialFile
          ? new AppSkillBindingConnectClient(
              config.skillDraft.platformBaseUrl,
              new PlatformServiceCredentialSource(config.skillDraft.credentialFile, "catalog"),
              new PlatformServiceCredentialSource(config.platformProjection.credentialFile, "projection"),
              config.skillDraft.timeoutMs,
            )
          : null,
    },
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
      provide: SKILL_ADMIN_CLIENT,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): SkillAdminConnectClient | null => {
        if (config.skillDraft?.platformBaseUrl === null || config.skillDraft?.platformBaseUrl === undefined || config.skillAdminCredentialFile === null || config.skillAdminCredentialFile === undefined)
          return null
        return new SkillAdminConnectClient(
          config.skillDraft.platformBaseUrl,
          new PlatformServiceCredentialSource(config.skillAdminCredentialFile, "skills_admin"),
          config.skillDraft.timeoutMs,
        )
      },
    },
    {
      provide: SKILL_LOCAL_IMPORT_CLIENT,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): LocalSkillImportClient | undefined => {
        if (config.skillDraft?.platformBaseUrl === null || config.skillDraft?.platformBaseUrl === undefined || config.skillDraft.credentialFile === null || config.skillDraft.credentialFile === undefined || config.platformProjection?.credentialFile === null || config.platformProjection?.credentialFile === undefined)
          return undefined
        return new LocalSkillImportConnectClient(
          config.skillDraft.platformBaseUrl,
          new PlatformServiceCredentialSource(config.skillDraft.credentialFile, "catalog"),
          new PlatformServiceCredentialSource(config.platformProjection.credentialFile, "projection"),
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
    {
      provide: SKILL_IMPORT_RECEIPTS,
      inject: [BFF_POOL],
      useFactory: (pool: Pool): Pick<IdempotencyRepository, "getReceipt" | "claimReceipt" | "compareAndSetReceipt"> => new PostgresIdempotencyRepository(pool),
    },
    {
      provide: SKILL_SHARE_REPOSITORY,
      inject: [BFF_DATABASE],
      useFactory: (database: PostgresBffDatabase): PostgresSkillShareRepository => new PostgresSkillShareRepository(database),
    },
    {
      provide: SKILL_SPECIFICATION_SOURCE,
      inject: [BFF_CONFIG, SKILL_PRODUCT_CLIENT, SKILL_INSTALLATION_CLIENT, SKILL_USAGE_READER],
      useFactory: (
        config: BffConfig,
        product: SkillProductConnectClient | null,
        installations: SkillInstallationConnectClient | null,
        usage: (tenant: string, refs: readonly string[]) => Promise<Map<string, SkillUsageResult>>,
      ): SkillSpecificationSource | null => {
        if (!product || !installations || !config.platformProjection?.baseUrl || !config.platformProjection.credentialFile || !config.iamBaseUrl) return null
        const projection = new PlatformProjectionHttpClient(config.platformProjection.baseUrl, config.platformProjection.credentialFile, config.platformProjection.timeoutMs)
        return new SkillSpecificationService({
          owner: new PlatformSkillSpecificationFacade({ product, installations, projection }),
          profiles: new IamPublisherProfileClient(config.iamBaseUrl, config.upstreamTimeoutMs),
          usage,
          objectOrigin: config.storageObjectOrigin ?? config.storage?.objectOrigin ?? null,
        })
      },
    },
  ],
  exports: [APP_SKILL_BINDING_CLIENT, OPEN_APP_MANAGEMENT_ADMISSION, SKILL_ADMIN_CLIENT, SKILL_AUTHORIZATION, SKILL_DOWNLOAD_HANDLES, SKILL_DRAFT_CLIENT, SKILL_IMPORT_RECEIPTS, SKILL_INSTALLATION_CLIENT, SKILL_LIST_ADMISSION, SKILL_LOCAL_IMPORT_CLIENT, SKILL_PACKAGE_INSPECTION_CLIENT, SKILL_PRODUCT_CLIENT, SKILL_SHARE_REPOSITORY, SKILL_SPECIFICATION_SOURCE, SKILL_USAGE_READER],
})
export class SkillsModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SkillsMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
