export type MessageFeedback = "up" | "down" | null
export type MessageFeedbackState = Readonly<{ session_id: string; message_id: string; feedback: MessageFeedback }>
export type MessageFeedbackQuery = Readonly<{
  tenantId: string
  subjectId: string
  conversationId: string
  messageId: string
  signal: AbortSignal
  deadlineAt: number
}>
export type SetMessageFeedback = MessageFeedbackQuery & Readonly<{ feedback: MessageFeedback }>
export function messageFeedbackId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value)
}
