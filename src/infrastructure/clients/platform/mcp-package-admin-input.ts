import { createHash } from "node:crypto"
import { z } from "zod"
const id = (max = 191) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[\x21-\x7e]+$/u)
    .refine((value) => value.trim() === value)
const text = (max: number) =>
  z
    .string()
    .min(1)
    .refine(
      (value) =>
        value.trim() === value &&
        Buffer.byteLength(value, "utf8") <= max &&
        !/[\ud800-\udfff]/u.test(value) &&
        [...value].every((c) => (c.codePointAt(0) ?? 0) >= 32 && c.codePointAt(0) !== 127),
    )
const size = z
  .string()
  .regex(/^[1-9][0-9]{0,7}$/u)
  .refine((value) => BigInt(value) <= 33_554_432n && value.trim() === value)
const bytes = {
  contentSha256: z
    .string()
    .length(64)
    .regex(/^[a-f0-9]{64}$/u),
  sizeBytes: size,
}
const scope = { packageId: id() },
  command = { commandId: id() },
  upload = { uploadId: id(), uploadSourceVersionId: id(512) }
const identitySchema = z
  .object({ tenantId: id(255), subjectId: id(), requestId: id() })
  .strict()
  .readonly()
const inputSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("begin"), ...scope, ...command, ...bytes, filename: text(255).refine((value) => !/[\\/]/u.test(value)) }).strict(),
    z.object({ kind: z.literal("complete"), ...scope, ...command, ...bytes, ...upload }).strict(),
    z.object({ kind: z.literal("abort"), ...scope, ...command, uploadId: id(), reason: text(512) }).strict(),
    z.object({ kind: z.literal("status"), ...scope, uploadId: id() }).strict(),
    z
      .object({
        kind: z.literal("publish"),
        ...scope,
        ...command,
        ...bytes,
        ...upload,
        providerKey: id(64).refine((value) => /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value)),
        assetId: id(),
      })
      .strict(),
  ])
  .readonly()
export type McpPackageAdminIdentity = z.infer<typeof identitySchema>
export type McpPackageAdminInput = z.infer<typeof inputSchema>
export function parseMcpPackageAdminInput(identity: McpPackageAdminIdentity, input: McpPackageAdminInput) {
  return { identity: identitySchema.parse(identity), input: inputSchema.parse(input) }
}
/** Implements the published fixed string tuples; never trusts a supplied digest. */
export function mcpPackageAdminCommand(
  identity: McpPackageAdminIdentity,
  original: Exclude<McpPackageAdminInput, { kind: "status" }>,
): { commandId: string; requestDigest: string } {
  const { identity: trusted, input } = parseMcpPackageAdminInput(identity, original)
  if (input.kind === "status") throw new Error("MCP package command required")
  const fields =
    input.kind === "begin"
      ? [input.filename, input.contentSha256, input.sizeBytes]
      : input.kind === "complete"
        ? [input.uploadId, input.uploadSourceVersionId, input.contentSha256, input.sizeBytes]
        : input.kind === "abort"
          ? [input.uploadId, input.reason]
          : [input.uploadId, input.uploadSourceVersionId, input.assetId, input.contentSha256, input.sizeBytes]
  const tuple =
    input.kind === "publish"
      ? ["mcp.package.publish/v1", trusted.tenantId, trusted.subjectId, input.providerKey, input.packageId, ...fields]
      : [`mcp.package.upload.${input.kind}/v1`, trusted.tenantId, trusted.subjectId, input.packageId, ...fields]
  return { commandId: input.commandId, requestDigest: createHash("sha256").update(JSON.stringify(tuple)).digest("hex") }
}
