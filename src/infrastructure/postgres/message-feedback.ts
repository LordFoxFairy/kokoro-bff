import type { PoolClient, QueryResult, QueryResultRow } from "pg"
import type { PostgresBffDatabase } from "./client.js"
import type { MessageFeedbackQuery, SetMessageFeedback, MessageFeedbackState } from "../../application/chat/message-feedback-input.js"
type PinLifetime = Readonly<{ signal: AbortSignal; deadlineAt: number }>
/** A single bounded Message feedback transaction. It never touches command receipts. */
async function transaction<T>(
  database: PostgresBffDatabase,
  input: PinLifetime,
  work: (query: <R extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) => Promise<QueryResult<R>>) => Promise<T>,
  readOnly: boolean,
): Promise<T> {
  let client: PoolClient | undefined,
    broken = false,
    open = false
  const onError = () => {
    broken = true
  }
  const within = <R>(start: () => Promise<R>): Promise<R> =>
    new Promise((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        clearTimeout(timer)
        input.signal.removeEventListener("abort", stop)
        client?.removeListener("error", stop)
      }
      const stop = () => {
        if (settled) return
        settled = true
        broken = true
        cleanup()
        reject(new Error("MESSAGE_FEEDBACK_UNAVAILABLE"))
      }
      const remaining = Math.floor(input.deadlineAt - performance.now())
      const timer = setTimeout(stop, Math.max(0, remaining))
      input.signal.addEventListener("abort", stop, { once: true })
      client?.once("error", stop)
      if (broken || input.signal.aborted || remaining <= 0) {
        stop()
        return
      }
      void Promise.resolve()
        .then(() => {
          if (settled) throw new Error("MESSAGE_FEEDBACK_RETIRED")
          return start()
        })
        .then(
          (value) => {
            if (settled) return
            settled = true
            cleanup()
            resolve(value)
          },
          (error) => {
            if (settled) return
            settled = true
            cleanup()
            reject(error)
          },
        )
    })
  const query = <R extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) => within(() => client!.query<R>(sql, values))
  try {
    await within(async () => {
      const acquired = await database.pool.connect()
      if (broken || input.signal.aborted || performance.now() >= input.deadlineAt) {
        acquired.release()
        throw new Error("MESSAGE_FEEDBACK_RETIRED")
      }
      client = acquired
      client.on("error", onError)
      return acquired
    })
    await query(readOnly ? "BEGIN READ ONLY" : "BEGIN")
    open = true
    await query("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true)", [
      String(Math.max(1, Math.floor(input.deadlineAt - performance.now()))),
      String(Math.min(1000, Math.max(1, Math.floor(input.deadlineAt - performance.now())))),
    ])
    const result = await work(query)
    try {
      await query("COMMIT")
      open = false
    } catch (error) {
      broken = true
      open = false
      throw new Error("MESSAGE_FEEDBACK_COMMIT_UNKNOWN", { cause: error })
    }
    return result
  } catch (error) {
    if (open && !broken) {
      try {
        await query("ROLLBACK")
      } catch {
        broken = true
      }
    }
    throw error
  } finally {
    if (client) {
      try {
        client.release(broken)
      } finally {
        client.removeListener("error", onError)
      }
    }
  }
}
const visible = `conversation.tenant_id=$1 AND conversation.owner_id=$2 AND conversation.conversation_id=$3 AND conversation.status='active'
 AND (conversation.project_ref IS NULL OR EXISTS (SELECT 1 FROM bff_project project WHERE project.tenant_id=conversation.tenant_id AND project.owner_id=conversation.owner_id AND project.deleted_at IS NULL AND (project.project_id=conversation.project_ref OR project.slug=conversation.project_ref)))`
type FeedbackRow = { feedback: unknown }
function state(input: MessageFeedbackQuery, value: unknown): MessageFeedbackState {
  if (value !== null && value !== "up" && value !== "down") throw Error("MESSAGE_FEEDBACK_ROW_INVALID")
  return { session_id: input.conversationId, message_id: input.messageId, feedback: value }
}
export function readMessageFeedback(database: PostgresBffDatabase, input: MessageFeedbackQuery): Promise<MessageFeedbackState | null> {
  return transaction(
    database,
    input,
    async (query) => {
      const result = await query<FeedbackRow>(
        `SELECT preference.feedback FROM bff_conversation conversation
      JOIN bff_message message ON message.tenant_id=conversation.tenant_id AND message.conversation_id=conversation.conversation_id AND message.message_id=$4 AND message.role='assistant'
      LEFT JOIN bff_message_feedback preference ON preference.tenant_id=message.tenant_id AND preference.subject_id=$2 AND preference.conversation_id=message.conversation_id AND preference.message_id=message.message_id
      WHERE ${visible}`,
        [input.tenantId, input.subjectId, input.conversationId, input.messageId],
      )
      return result.rows[0] ? state(input, result.rows[0].feedback) : null
    },
    true,
  )
}
export function setMessageFeedback(database: PostgresBffDatabase, input: SetMessageFeedback): Promise<MessageFeedbackState | null> {
  return transaction(
    database,
    input,
    async (query) => {
      const values = [input.tenantId, input.subjectId, input.conversationId, input.messageId]
      const parent = await query(`SELECT conversation.conversation_id FROM bff_conversation conversation WHERE ${visible} FOR UPDATE`, values.slice(0, 3))
      if (!parent.rows[0]) return null
      const message = await query(
        `SELECT message_id FROM bff_message WHERE tenant_id=$1 AND conversation_id=$2 AND message_id=$3 AND role='assistant' FOR UPDATE`,
        [input.tenantId, input.conversationId, input.messageId],
      )
      if (!message.rows[0]) return null
      if (input.feedback === null)
        await query(`DELETE FROM bff_message_feedback WHERE tenant_id=$1 AND subject_id=$2 AND conversation_id=$3 AND message_id=$4`, values)
      else
        await query(
          `INSERT INTO bff_message_feedback(tenant_id,subject_id,conversation_id,message_id,feedback) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(tenant_id,subject_id,message_id) DO UPDATE SET feedback=EXCLUDED.feedback,updated_at=CURRENT_TIMESTAMP(3)
      WHERE bff_message_feedback.conversation_id=EXCLUDED.conversation_id AND bff_message_feedback.feedback IS DISTINCT FROM EXCLUDED.feedback`,
          [...values, input.feedback],
        )
      const result = await query<FeedbackRow>(
        `SELECT feedback FROM bff_message_feedback WHERE tenant_id=$1 AND subject_id=$2 AND conversation_id=$3 AND message_id=$4`,
        values,
      )
      const observed = state(input, result.rows[0]?.feedback ?? null)
      if (observed.feedback !== input.feedback) throw Error("MESSAGE_FEEDBACK_WRITE_LOST")
      return observed
    },
    false,
  )
}
