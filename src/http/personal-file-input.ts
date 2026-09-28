import { createHash } from "node:crypto"
import type { PersonalFileInput } from "../application/personal-file-upload.types.js"
import { PersonalFileError } from "../application/personal-file-upload.error.js"

export async function parsePersonalFile(contentType: string, bytes: Buffer): Promise<PersonalFileInput> {
  if (bytes.length > 1024 * 1024) throw new PersonalFileError("request_body_too_large", 413)
  if (!/^multipart\/form-data\s*;/iu.test(contentType)) throw new PersonalFileError("invalid_library_file", 400)
  let form: FormData
  try {
    form = await new Request("http://multipart.invalid", { method: "POST", headers: { "content-type": contentType }, body: new Uint8Array(bytes) }).formData()
  } catch {
    throw new PersonalFileError("invalid_library_file", 400)
  }
  const entries = [...form.entries()]
  const entry = entries[0]
  if (entries.length !== 1 || entry?.[0] !== "files" || typeof entry[1] === "string") throw new PersonalFileError("invalid_library_file", 400)
  const file = entry[1]
  if (!/^[^\x00-\x1f\x7f/\\]{1,255}$/u.test(file.name) || file.name === "." || file.name === "..") throw new PersonalFileError("invalid_library_file", 400)
  const mimeType = file.type || "application/octet-stream"
  if (mimeType.length > 191 || !/^[\w.+-]+\/[\w.+-]+$/u.test(mimeType)) throw new PersonalFileError("invalid_library_file", 400)
  const body = new Uint8Array(await file.arrayBuffer())
  return { filename: file.name, mimeType, bytes: body, sha256: createHash("sha256").update(body).digest("hex") }
}
