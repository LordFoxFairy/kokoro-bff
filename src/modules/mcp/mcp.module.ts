import { Inject, Injectable, MiddlewareConsumer, Module, NestModule, OnApplicationShutdown, RequestMethod } from "@nestjs/common"
import { BffConfigModule } from "../../config/config.module.js"
import {
  BFF_CONFIG,
  MCP_AUTHORIZATION,
  MCP_PACKAGE_ADMIN_CLIENT,
  MCP_PERSONAL_CLIENT,
  MCP_PROJECT_PUBLICATION_CLIENT,
  CUSTOM_API_CLIENT,
  MCP_PROVIDER_ADMIN_CLIENT,
  PROJECT_MCP_RECOMMENDATIONS_PROVIDER,
  PROJECT_MCP_RECOMMENDATIONS_STORE,
} from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import { McpAuthorizationClient } from "../../auth/mcp-authorization.client.js"
import { PlatformServiceCredentialSource } from "../../infrastructure/clients/platform/platform-service-credential.js"
import { McpPersonalConnectClient } from "../../infrastructure/clients/platform/mcp-personal-connect.js"
import { McpPackageAdminConnectClient } from "../../infrastructure/clients/platform/mcp-package-admin-connect.js"
import { McpProviderAdminConnectClient } from "../../infrastructure/clients/platform/mcp-provider-admin-connect.js"
import { McpProjectPublicationConnectClient } from "../../infrastructure/clients/platform/mcp-project-publication-connect.js"
import { CustomApiConnectClient } from "../../infrastructure/clients/platform/custom-api-connect.js"
import type { ProjectMcpRecommendationsStore } from "../../infrastructure/postgres/project-mcp-recommendations.js"
import { ProjectMcpRecommendationsMiddleware } from "./project-mcp-recommendations.middleware.js"
import { ConnectorListMiddleware } from "./connector-list.middleware.js"
import { McpAdminMiddleware } from "./mcp-admin.middleware.js"
import { McpProjectPublicationMiddleware } from "./mcp-project-publication.middleware.js"
import { PlatformProjectionMiddleware } from "./platform-projection.middleware.js"
import { McpPersonalMiddleware } from "./mcp-personal.middleware.js"
import { CustomApiMiddleware, type CustomApiClient } from "./custom-api.middleware.js"
import type { ProjectMcpRecommendationsProvider } from "../../http/routes/project-mcp-recommendations.js"
import { AuthenticationModule } from "../authentication/authentication.module.js"
import { IamRelayModule } from "../iam-relay/iam-relay.module.js"
import { ProjectAccessModule } from "../projects/project-access.module.js"

@Injectable()
class ProjectMcpRecommendationsRuntime implements OnApplicationShutdown {
  public constructor(@Inject(PROJECT_MCP_RECOMMENDATIONS_PROVIDER) private readonly provider: ProjectMcpRecommendationsProvider) {}

  public onApplicationShutdown(): void {
    const personal = this.provider.clients.mcpPersonalClient
    if (personal && "close" in personal && typeof personal.close === "function") personal.close()
    const customApi = this.provider.clients.customApiClient
    if (customApi && "close" in customApi && typeof customApi.close === "function") customApi.close()
  }
}

@Injectable()
class McpAdminRuntime implements OnApplicationShutdown {
  public constructor(
    @Inject(MCP_PROVIDER_ADMIN_CLIENT) private readonly providerClient: McpProviderAdminConnectClient | null,
    @Inject(MCP_PACKAGE_ADMIN_CLIENT) private readonly packageClient: McpPackageAdminConnectClient | null,
  ) {}

  public onApplicationShutdown(): void {
    this.providerClient?.close()
    this.packageClient?.close()
  }
}

@Injectable()
class McpProjectPublicationRuntime implements OnApplicationShutdown {
  public constructor(@Inject(MCP_PROJECT_PUBLICATION_CLIENT) private readonly client: McpProjectPublicationConnectClient | null) {}

  public onApplicationShutdown(): void {
    this.client?.close?.()
  }
}

@Module({
  imports: [AuthenticationModule, IamRelayModule, ProjectAccessModule, BffConfigModule],
  providers: [
    ProjectMcpRecommendationsMiddleware,
    ConnectorListMiddleware,
    McpAdminMiddleware,
    McpProjectPublicationMiddleware,
    PlatformProjectionMiddleware,
    McpPersonalMiddleware,
    CustomApiMiddleware,
    ProjectMcpRecommendationsRuntime,
    McpAdminRuntime,
    McpProjectPublicationRuntime,
    {
      provide: CUSTOM_API_CLIENT,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): CustomApiClient | null =>
        config.customApi
          ? new CustomApiConnectClient(config.customApi.baseUrl, new PlatformServiceCredentialSource(config.customApi.credentialFile, "custom_api_personal"))
          : null,
    },
    {
      provide: MCP_AUTHORIZATION,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): McpAuthorizationClient =>
        new McpAuthorizationClient({
          credentialFile: config.iamUserContextServiceCredentialFile,
          baseUrl: config.iamBaseUrl,
          timeoutMs: 5000,
          maxResponseBytes: 65_536,
        }),
    },
    {
      provide: PROJECT_MCP_RECOMMENDATIONS_PROVIDER,
      inject: [PROJECT_MCP_RECOMMENDATIONS_STORE, MCP_PERSONAL_CLIENT, CUSTOM_API_CLIENT],
      useFactory: (
        project: ProjectMcpRecommendationsStore,
        mcpPersonalClient: McpPersonalConnectClient | null,
        customApiClient: CustomApiClient | null,
      ): ProjectMcpRecommendationsProvider => {
        return {
          project,
          clients: { mcpPersonalClient, customApiClient },
        }
      },
    },
    {
      provide: MCP_PERSONAL_CLIENT,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): McpPersonalConnectClient | null =>
        config.mcpPersonal
          ? new McpPersonalConnectClient(config.mcpPersonal.baseUrl, new PlatformServiceCredentialSource(config.mcpPersonal.credentialFile, "mcp_personal"))
          : null,
    },
    {
      provide: MCP_PROVIDER_ADMIN_CLIENT,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): McpProviderAdminConnectClient | null =>
        config.mcpProviderAdmin
          ? new McpProviderAdminConnectClient(
              config.mcpProviderAdmin.baseUrl,
              new PlatformServiceCredentialSource(config.mcpProviderAdmin.credentialFile, "mcp_admin"),
            )
          : null,
    },
    {
      provide: MCP_PACKAGE_ADMIN_CLIENT,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): McpPackageAdminConnectClient | null =>
        config.mcpProviderAdmin
          ? new McpPackageAdminConnectClient(
              config.mcpProviderAdmin.baseUrl,
              new PlatformServiceCredentialSource(config.mcpProviderAdmin.credentialFile, "mcp_admin"),
            )
          : null,
    },
    {
      provide: MCP_PROJECT_PUBLICATION_CLIENT,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): McpProjectPublicationConnectClient | null =>
        config.mcpPersonal
          ? new McpProjectPublicationConnectClient(
              config.mcpPersonal.baseUrl,
              new PlatformServiceCredentialSource(config.mcpPersonal.credentialFile, "mcp_personal"),
            )
          : null,
    },
  ],
  exports: [
    MCP_AUTHORIZATION,
    MCP_PERSONAL_CLIENT,
    MCP_PROVIDER_ADMIN_CLIENT,
    MCP_PACKAGE_ADMIN_CLIENT,
    MCP_PROJECT_PUBLICATION_CLIENT,
    CUSTOM_API_CLIENT,
    PROJECT_MCP_RECOMMENDATIONS_PROVIDER,
  ],
})
export class McpModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(PlatformProjectionMiddleware).forRoutes({ path: "*", method: RequestMethod.GET })
    consumer.apply(McpPersonalMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
    consumer.apply(CustomApiMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
    consumer.apply(ProjectMcpRecommendationsMiddleware).forRoutes({ path: "v1/projects/:projectId/mcp-recommendations", method: RequestMethod.ALL })
    consumer.apply(ConnectorListMiddleware).forRoutes({ path: "v1/connector.list", method: RequestMethod.GET })
    consumer.apply(McpAdminMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
    consumer.apply(McpProjectPublicationMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
