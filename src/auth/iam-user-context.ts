import { readIamServiceCredential } from "./iam-service-credential.js"

/** Ordinary IAM business input: no browser authentication material. */
export type IamUserContextInput = Readonly<{
  tenantId: string
  subjectId: string
  requestId: string
  signal: AbortSignal
}>
export async function iamUserContextHeaders(
  input: IamUserContextInput & Readonly<{ credentialFile: string | null | undefined }>,
): Promise<Record<string, string>> {
  input.signal.throwIfAborted()
  if (!input.credentialFile || !input.tenantId || !input.subjectId || /[\s\x00-\x1f\x7f,]/u.test(input.subjectId))
    throw new Error("iam_user_context_unavailable")
  const credential = await readIamServiceCredential(input.credentialFile, input.tenantId, "bff_user_context", input.signal)
  return { authorization: `Bearer ${credential}`, "x-kokoro-actor-id": input.subjectId }
}
