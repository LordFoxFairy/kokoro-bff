import { MiddlewareConsumer, Module, type NestModule, RequestMethod } from "@nestjs/common"
import { BffConfigModule } from "../../config/config.module.js"
import { BFF_CONFIG, SESSION_ADMISSION } from "../../common/tokens.js"
import type { BffConfig } from "../../config/runtime.js"
import { SessionAdmissionClient } from "../../auth/session-admission.client.js"
import { AuthenticationMiddleware } from "./authentication.middleware.js"

@Module({
  imports: [BffConfigModule],
  providers: [
    AuthenticationMiddleware,
    {
      provide: SESSION_ADMISSION,
      inject: [BFF_CONFIG],
      useFactory: (config: BffConfig) =>
        new SessionAdmissionClient({
          baseUrl: config.iamBaseUrl,
          credentialFile: config.iamUserContextServiceCredentialFile,
          webOrigin: config.iamWebOrigin ?? config.iamRelay?.webOrigin,
          tenantId: config.tenantId,
          timeoutMs: config.upstreamTimeoutMs,
          maxResponseBytes: config.upstreamMaxResponseBytes,
        }),
    },
  ],
  exports: [SESSION_ADMISSION],
})
export class AuthenticationModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthenticationMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL })
  }
}
