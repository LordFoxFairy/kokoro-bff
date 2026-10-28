// Exact build/test-only Public28.14 addition; never a runtime downgrade.
import { createHash } from "node:crypto"
const hash = (source) => createHash("sha256").update(source).digest("hex")
const deltas = [
  ["info:\n  title: Kokoro Business API\n  version: 28.14.0\n", "info:\n  title: Kokoro Business API\n  version: 28.13.0\n"],
  [
    "      required: [mode, format_version, revision, event_watermark, parts_cursor]\n      properties:\n        final_segment_id:\n          type: string\n          minLength: 1\n          description: Proven final answer text segment of this exact completed Run at this revision. May occur on another page; absence is unknown, never inferred from the last visible part.\n",
    "      required: [mode, format_version, revision, event_watermark, parts_cursor]\n      properties:\n",
  ],
  [
    "      required: [session_id, message_id, run_id, format_version, revision, event_watermark, items, next_cursor]\n      properties:\n        final_segment_id:\n          type: string\n          minLength: 1\n          description: Proven final answer text segment of this exact completed Run at this revision. May occur on another page; absence is unknown, never inferred from the last visible part.\n",
    "      required: [session_id, message_id, run_id, format_version, revision, event_watermark, items, next_cursor]\n      properties:\n",
  ],
  [
    "      type: string\n      description: AG-UI server-sent event frames read from the BFF PostgreSQL ledger. Each id is a distinct opaque resume cursor. Every durable data frame requires owner metadata described by x-kokoro-owner-metadata; public_sequence is the positive decimal BFF ledger position, distinct from unchanged source seq. Never decode an opaque cursor as a sequence. Heartbeat comments have no owner metadata. CUSTOM kokoro.interaction.state carries one complete ChatInteractionState in value; HTTP control admission does not resolve it.\n      x-kokoro-run-finished-results:\n        completed:\n          $ref: '#/components/schemas/FinalAnswerResult'\n",
    "      type: string\n      description: AG-UI server-sent event frames read from the BFF PostgreSQL ledger. Each id is a distinct opaque resume cursor. Every durable data frame requires owner metadata described by x-kokoro-owner-metadata; public_sequence is the positive decimal BFF ledger position, distinct from unchanged source seq. Never decode an opaque cursor as a sequence. Heartbeat comments have no owner metadata. CUSTOM kokoro.interaction.state carries one complete ChatInteractionState in value; HTTP control admission does not resolve it.\n",
  ],
  [
    '        id: agui_abcdef0123456789abcdef0123456789ab\n        data: {"type":"RUN_FINISHED","timestamp":1767225605000,"threadId":"session_kokoro","runId":"run_01JASYNC","metadata":{"kokoro":{"event_id":"agent_event_5","seq":5,"public_sequence":"8","session_id":"session_kokoro","run_id":"run_01JASYNC","timestamp":"2026-01-01T00:00:05.000Z"}}}\n    FinalAnswerResult:\n      type: object\n      additionalProperties: false\n      required: [final_segment_id]\n      description: Optional result of a successful RUN_FINISHED only. Its reference is committed with that terminal and the ordered message revision; cancelled and failed runs never carry it.\n      properties:\n        final_segment_id: { type: string, minLength: 1 }\n',
    '        id: agui_abcdef0123456789abcdef0123456789ab\n        data: {"type":"RUN_FINISHED","timestamp":1767225605000,"threadId":"session_kokoro","runId":"run_01JASYNC","metadata":{"kokoro":{"event_id":"agent_event_5","seq":5,"public_sequence":"8","session_id":"session_kokoro","run_id":"run_01JASYNC","timestamp":"2026-01-01T00:00:05.000Z"}}}\n',
  ],
]
export function restorePublic2813FinalAnswerContract(source) {
  if (!/^  version: 28\.14\.0$/mu.test(source)) return source
  if (hash(source) !== "921be666a3bd570eb984503528d9ee713e3739cc8525e2e1c2f46c96fa161a05") throw Error("Final answer Public28.14 child drift")
  for (const [child, parent] of deltas) {
    if (source.split(child).length !== 2) throw Error("Final answer exact delta drift")
    source = source.replace(child, () => parent)
  }
  if (hash(source) !== "30b288a7f719ec1d5a6f85c70ad80f18bbbce614fbdad1412d1ff3de7a0b2f9c") throw Error("Final answer Public28.13 parent drift")
  return source
}
