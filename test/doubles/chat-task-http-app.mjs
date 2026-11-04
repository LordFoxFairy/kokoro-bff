import "reflect-metadata"
import assert from "node:assert/strict"
import { Test } from "@nestjs/testing"
import { BFF_CONFIG, BFF_DATABASE, CHAT_ARCHIVE, CHAT_SHARED_TASKS, CHAT_MESSAGE_FEEDBACK, CHAT_TURN_SERVICE, SESSION_ADMISSION } from "../../dist/common/tokens.js"
import { BFF_NEST_APPLICATION_OPTIONS } from "../../dist/main.js"
import { ChatModule } from "../../dist/modules/chat/chat.module.js"

export async function startChatTaskHttpTestApp(t, config, sessionAdmission, { archive, sharedTasks, feedback, chatTurns }) {
  const unexpected = () => assert.fail("Chat task HTTP fixture must not reach PostgreSQL")
  const builder = Test.createTestingModule({ imports: [ChatModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: { query: unexpected, connect: unexpected }, ready: unexpected })
    .overrideProvider(SESSION_ADMISSION)
    .useValue(sessionAdmission)
  if (archive !== undefined) builder.overrideProvider(CHAT_ARCHIVE).useValue(archive)
  if (sharedTasks !== undefined) builder.overrideProvider(CHAT_SHARED_TASKS).useValue(sharedTasks)
  if (feedback !== undefined) builder.overrideProvider(CHAT_MESSAGE_FEEDBACK).useValue(feedback)
  if (chatTurns !== undefined) builder.overrideProvider(CHAT_TURN_SERVICE).useValue(chatTurns)
  const module = await builder.compile()
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  t.after(async () => {
    app.getHttpServer().closeAllConnections()
    await app.close()
  })
  await app.listen(0, "127.0.0.1")
  return app.getUrl()
}
