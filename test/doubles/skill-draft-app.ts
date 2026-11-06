import "reflect-metadata"

import { Test } from "@nestjs/testing"

import { BFF_CONFIG, BFF_DATABASE, SESSION_ADMISSION, SKILL_AUTHORIZATION, SKILL_DRAFT_CLIENT } from "../../dist/common/tokens.js"
import { BFF_NEST_APPLICATION_OPTIONS } from "../../dist/main.js"
import { SkillsModule } from "../../dist/modules/skills/skills.module.js"
import type { SessionAdmission } from "../../src/auth/session-admission.types.ts"
import type { SkillAuthorizationClient } from "../../src/auth/skill-authorization.client.ts"
import type { BffConfig } from "../../src/config/runtime.ts"
import type { CatalogConnectClient } from "../../src/infrastructure/clients/platform/catalog-connect.ts"
import { TEST_WEB_ORIGIN } from "./session-admission.ts"

export async function startSkillDraftTestApp(
  config: BffConfig,
  options: {
    sessionAdmission: SessionAdmission
    skillAuthorization: Pick<SkillAuthorizationClient, "check">
    skillDraftClient?: Partial<CatalogConnectClient> | null
  },
) {
  const builder = Test.createTestingModule({ imports: [SkillsModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue({
      ...config,
      iamWebOrigin: config.iamWebOrigin === undefined ? (config.iamRelay?.webOrigin ?? TEST_WEB_ORIGIN) : config.iamWebOrigin,
    })
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: Object.freeze({}) })
    .overrideProvider(SESSION_ADMISSION)
    .useValue(options.sessionAdmission)
    .overrideProvider(SKILL_AUTHORIZATION)
    .useValue(options.skillAuthorization)
  if (options.skillDraftClient !== undefined) builder.overrideProvider(SKILL_DRAFT_CLIENT).useValue(options.skillDraftClient)
  const module = await builder.compile()
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  try {
    await app.listen(0, "127.0.0.1")
    return { base: await app.getUrl(), close: () => app.close() }
  } catch (error) {
    try {
      await app.close()
    } catch (closeError) {
      throw new AggregateError([error, closeError], "Skills draft test listener failed to start and close")
    }
    throw error
  }
}
