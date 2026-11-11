import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

export const newAgentConnectionSetupId = (): string => randomBytes(24).toString("base64url")
export const newTelegramProof = (): string => randomBytes(16).toString("base64url")
export const proofDigest = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex")
export const secretMatches = (a: string, b: string): boolean => timingSafeEqual(Buffer.from(proofDigest(a), "hex"), Buffer.from(proofDigest(b), "hex"))
