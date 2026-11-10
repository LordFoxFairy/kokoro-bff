import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
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

export type ConnectionProvider = "telegram" | "line"
export const lineLinkToken = z.string().regex(/^[!-~]{1,512}(?![\s\S])/u)
export const lineContinueCommand = z.strictObject({ ...expected, setup_id: setupId, link_token: lineLinkToken })

export const newAgentConnectionSetupId = (): string => randomBytes(24).toString("base64url")
export const newTelegramProof = (): string => randomBytes(16).toString("base64url")
export const proofDigest = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex")
export const secretMatches = (a: string, b: string): boolean => timingSafeEqual(Buffer.from(proofDigest(a), "hex"), Buffer.from(proofDigest(b), "hex"))
