import { Inject, Injectable, MiddlewareConsumer, Module, NestModule, OnApplicationShutdown, RequestMethod } from "@nestjs/common"
import { BffConfigModule } from "../../config/config.module.js"
import {
  BFF_CONFIG,
  MCP_AUTHORIZATION,
  PROJECT_MCP_RECOMMENDATIONS_PROVIDER,
  PROJECT_SERVICE,
} from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import { McpAuthorizationClient } from "../../auth/mcp-authorization.client.js"
import { PlatformServiceCredentialSource } from "../../infrastructure/clients/platform/platform-service-credential.js"
import { McpPersonalConnectClient } from "../../infrastructure/clients/platform/mcp-personal-connect.js"
import { CustomApiConnectClient } from "../../infrastructure/clients/platform/custom-api-connect.js"
import type { ProjectService } from "../../application/project-service.js"
import { ProjectMcpRecommendationsMiddleware } from "./project-mcp-recommendations.middleware.js"
import type { ProjectMcpRecommendationsProvider } from "../../http/routes/project-mcp-recommendations.js"
import { AccountModule } from "../account/account.module.js"
import { IamRelayModule } from "../iam-relay/iam-relay.module.js"
import { ProjectsModule } from "../projects/projects.module.js"

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

@Module({
  imports: [AccountModule, IamRelayModule, ProjectsModule, BffConfigModule],
  providers: [
    ProjectMcpRecommendationsMiddleware,
    ProjectMcpRecommendationsRuntime,
    {
      provide: MCP_AUTHORIZATION,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig): McpAuthorizationClient => new McpAuthorizationClient({ baseUrl: config.iamBaseUrl, timeoutMs: 5000, maxResponseBytes: 65_536 }),
    },
    {
      provide: PROJECT_MCP_RECOMMENDATIONS_PROVIDER,
      inject: [BFF_CONFIG, PROJECT_SERVICE],
      useFactory: (config: BffConfig, project: ProjectService): ProjectMcpRecommendationsProvider => {
        const mcpPersonalClient = config.mcpPersonal
          ? new McpPersonalConnectClient(config.mcpPersonal.baseUrl, new PlatformServiceCredentialSource(config.mcpPersonal.credentialFile, "mcp_personal"))
          : null
        const customApiClient = config.customApi
          ? new CustomApiConnectClient(config.customApi.baseUrl, new PlatformServiceCredentialSource(config.customApi.credentialFile, "custom_api_personal"))
          : null
        return {
          project,
          clients: { mcpPersonalClient, customApiClient },
        }
      },
    },
  ],
  exports: [MCP_AUTHORIZATION, PROJECT_MCP_RECOMMENDATIONS_PROVIDER],
})
export class McpModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ProjectMcpRecommendationsMiddleware).forRoutes({ path: "v1/projects/:projectId/mcp-recommendations", method: RequestMethod.ALL })
  }
}
