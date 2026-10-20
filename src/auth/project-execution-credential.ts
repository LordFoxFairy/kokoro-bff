import { createHash, timingSafeEqual } from "node:crypto"
import { constants } from "node:fs"
import { open } from "node:fs/promises"
import { z } from "zod"

const fileSchema = z.strictObject({
  version: z.literal(1),
  entries: z
    .array(
      z.strictObject({
        credential_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
        caller: z.literal("kokoro-iam"),
        surface: z.literal("project_execution_binding"),
        tenant_id: z
          .string()
          .min(1)
          .max(255)
          .regex(/^[^\s\x00-\x1f\x7f]+$/u),
        secret: z
          .string()
          .min(32)
          .max(4096)
          .regex(/^[\x21-\x7e]+$/u),
      }),
    )
    .min(1)
    .max(32),
})

/** Fresh receiving-owner credential snapshot. No Web secret or old snapshot fallback. */
export async function projectExecutionCredentialTenant(path: string, bearer: string, signal: AbortSignal): Promise<string | null> {
  signal.throwIfAborted()
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    signal.throwIfAborted()
    const stat = await handle.stat()
    if (!stat.isFile() || stat.uid !== process.getuid?.() || ![0o400, 0o600].includes(stat.mode & 0o777) || stat.size > 65_536)
      throw new Error("binding_credentials_unavailable")
    const bytes = Buffer.alloc(65_537)
    let size = 0
    while (size < bytes.length) {
      signal.throwIfAborted()
      const read = await handle.read(bytes, size, bytes.length - size, null)
      if (read.bytesRead === 0) break
      size += read.bytesRead
    }
    if (size > 65_536) throw new Error("binding_credentials_unavailable")
    const parsed = fileSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))))
    if (
      new Set(parsed.entries.map((x) => x.credential_id)).size !== parsed.entries.length ||
      new Set(parsed.entries.map((x) => x.secret)).size !== parsed.entries.length
    )
      throw new Error("binding_credentials_unavailable")
    signal.throwIfAborted()
    const actual = createHash("sha256").update(bearer).digest()
    const found = parsed.entries.filter((entry) => timingSafeEqual(actual, createHash("sha256").update(entry.secret).digest()))
    return found.length === 1 ? found[0]!.tenant_id : null
  } finally {
    await handle.close()
  }
}
