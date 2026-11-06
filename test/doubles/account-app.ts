import "reflect-metadata"

import { Test } from "@nestjs/testing"

import { BFF_CONFIG, BFF_DATABASE, SESSION_ADMISSION } from "../../dist/common/tokens.js"
import { BFF_NEST_APPLICATION_OPTIONS } from "../../dist/main.js"
import { AccountModule } from "../../dist/modules/account/account.module.js"
import type { SessionAdmission } from "../../src/auth/session-admission.types.ts"
import type { BffConfig } from "../../src/config/runtime.ts"

export async function startAccountTestApp(config: BffConfig, admission: SessionAdmission) {
  // These IAM-facing scenarios must not access account storage.
  const database = { pool: Object.freeze({}) }
  const module = await Test.createTestingModule({ imports: [AccountModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(SESSION_ADMISSION)
    .useValue(admission)
    .overrideProvider(BFF_DATABASE)
    .useValue(database)
    .compile()
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  try {
    await app.listen(0, "127.0.0.1")
    return { base: await app.getUrl(), close: () => app.close() }
  } catch (error) {
    try {
      await app.close()
    } catch (closeError) {
      throw new AggregateError([error, closeError], "Account test listener failed to start and close")
    }
    throw error
  }
}
