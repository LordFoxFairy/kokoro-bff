import { constants } from "node:fs"
import { open } from "node:fs/promises"
import { z } from "zod"
import { strictParseRawJson } from "../infrastructure/raw-json.js"

const credentialFile = z.strictObject({
  version: z.literal(1),
  entries: z
    .array(
      z.strictObject({
        credential_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
        caller: z.literal("kokoro-bff"),
        surface: z.literal("session_admission"),
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

const MAX_CREDENTIAL_FILE_BYTES = 65_536

/** Read the BFF-owned IAM session-admission credential afresh for every request. */
export async function readIamSessionAdmissionCredential(path: string, tenantId: string | null, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  if (!tenantId) throw new Error("iam_session_admission_tenant_unavailable")
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = await handle.stat()
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.uid !== process.getuid?.() ||
      ![0o400, 0o600].includes(before.mode & 0o777) ||
      before.size > MAX_CREDENTIAL_FILE_BYTES
    )
      throw new Error("iam_session_admission_credentials_unavailable")
    const bytes = Buffer.alloc(MAX_CREDENTIAL_FILE_BYTES + 1)
    let size = 0
    while (size < bytes.length) {
      signal.throwIfAborted()
      const result = await handle.read(bytes, size, bytes.length - size, null)
      if (result.bytesRead === 0) break
      size += result.bytesRead
    }
    const after = await handle.stat()
    if (
      size > MAX_CREDENTIAL_FILE_BYTES ||
      before.size !== size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      after.mode !== before.mode ||
      after.uid !== before.uid ||
      after.nlink !== 1
    )
      throw new Error("iam_session_admission_credentials_changed")
    const parsed = credentialFile.parse(strictParseRawJson(bytes.subarray(0, size)))
    if (
      parsed.entries.some((entry) => entry.tenant_id !== tenantId) ||
      new Set(parsed.entries.map((entry) => entry.credential_id)).size !== parsed.entries.length ||
      new Set(parsed.entries.map((entry) => entry.secret)).size !== parsed.entries.length
    )
      throw new Error("iam_session_admission_credentials_invalid")
    signal.throwIfAborted()
    return parsed.entries[0]!.secret
  } finally {
    await handle.close()
  }
}
