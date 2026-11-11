import { z } from "zod"

export const setupId = z.string().regex(/^[A-Za-z0-9_-]{32}$/u)
const stateVersion = z
  .string()
  .regex(/^[1-9][0-9]{0,9}$/u)
  .refine((value) => Number(value) <= 2_147_483_647)
const expected = { expected_state_version: stateVersion }
export const connectionCommand = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("start"), ...expected }),
  z.strictObject({ action: z.literal("cancel"), ...expected, setup_id: setupId }),
  z.strictObject({ action: z.literal("confirm"), ...expected, setup_id: setupId, proof: z.string().regex(/^[A-Za-z0-9_-]{22}$/u) }),
  z.strictObject({ action: z.literal("disconnect"), ...expected }),
])
export type ConnectionCommand = z.infer<typeof connectionCommand>

export type ConnectionProvider = "telegram" | "line" | "slack"
export const lineLinkToken = z.string().regex(/^[!-~]{1,512}(?![\s\S])/u)
export const lineContinueCommand = z.strictObject({ ...expected, setup_id: setupId, link_token: lineLinkToken })
export const slackCompleteCommand = z.strictObject({ state: setupId, code: z.string().regex(/^[!-~]{1,512}(?![\s\S])/u) })
