import { inflateSync } from "node:zlib"
import type { PackageTransferReference, SkillCover } from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { projectSkillCover, assertSkillWireKnown, skillTimestamp } from "../platform/skill-product-response.js"
import { spoolVerifiedArtifact } from "./artifact-download-transfer.js"

function referenceOf(reference: PackageTransferReference | undefined, allowedOrigin: string) {
  if (!reference || reference.method !== "GET" || Object.keys(reference.requiredHeaders).length !== 0) throw new Error("skill_response_invalid")
  assertSkillWireKnown(reference)
  const url = new URL(reference.url),
    expiresAt = Date.parse(skillTimestamp(reference.expiresAt))
  if (
    url.origin !== allowedOrigin ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    expiresAt <= Date.now() ||
    expiresAt > Date.now() + 301_000
  )
    throw new Error("skill_response_invalid")
  return { url: reference.url, method: "GET", requiredHeaders: {}, expiresAt }
}
export async function spoolSkillPackage(reference: PackageTransferReference | undefined, size: bigint, sha256: string, origin: string, signal: AbortSignal) {
  if (size < 1n || size > 33_554_432n || !/^[a-f0-9]{64}$/u.test(sha256)) throw new Error("skill_response_invalid")
  return spoolVerifiedArtifact(referenceOf(reference, origin), Number(size), sha256, origin, signal)
}
function imageDimensions(bytes: Buffer, mime: string): { width: number; height: number } {
  if (mime === "image/png") {
    if (
      bytes.length < 33 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.readUInt32BE(8) !== 13 ||
      bytes.toString("ascii", 12, 16) !== "IHDR"
    )
      throw new Error("skill_response_invalid")
    const width = bytes.readUInt32BE(16),
      height = bytes.readUInt32BE(20),
      depth = bytes[24]!,
      color = bytes[25]!,
      interlace = bytes[28]!
    const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color]
    if (
      !width ||
      !height ||
      width > 4096 ||
      height > 4096 ||
      !channels ||
      !({ 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] } as Record<number, number[]>)[color]?.includes(depth) ||
      bytes[26] !== 0 ||
      bytes[27] !== 0 ||
      ![0, 1].includes(interlace)
    )
      throw new Error("skill_response_invalid")
    let offset = 8,
      ended = false,
      palette = false
    const compressed: Buffer[] = []
    const crc32 = (value: Uint8Array) => {
      let crc = 0xffffffff
      for (const byte of value) {
        crc ^= byte
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
      }
      return (crc ^ 0xffffffff) >>> 0
    }
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset),
        end = offset + 12 + length,
        kind = bytes.toString("ascii", offset + 4, offset + 8)
      if (end > bytes.length || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4) || !/^[A-Za-z]{4}$/u.test(kind))
        throw new Error("skill_response_invalid")
      if (kind === "IHDR" && offset !== 8) throw new Error("skill_response_invalid")
      if (kind === "PLTE") {
        if (length === 0 || length > 768 || length % 3 !== 0) throw new Error("skill_response_invalid")
        palette = true
      }
      if (kind === "IDAT") compressed.push(bytes.subarray(offset + 8, end - 4))
      if (kind === "IEND") {
        if (length !== 0 || end !== bytes.length) throw new Error("skill_response_invalid")
        ended = true
        break
      }
      if (!["IHDR", "PLTE", "IDAT", "IEND"].includes(kind) && /[A-Z]/u.test(kind[0]!)) throw new Error("skill_response_invalid")
      offset = end
    }
    if (!ended || !compressed.length || (color === 3 && !palette)) throw new Error("skill_response_invalid")
    const passes =
      interlace === 0
        ? [[0, 0, 1, 1]]
        : [
            [0, 0, 8, 8],
            [4, 0, 8, 8],
            [0, 4, 4, 8],
            [2, 0, 4, 4],
            [0, 2, 2, 4],
            [1, 0, 2, 2],
            [0, 1, 1, 2],
          ]
    const rows = passes
      .map(([x, y, dx, dy]) => ({ width: Math.max(0, Math.ceil((width - x!) / dx!)), height: Math.max(0, Math.ceil((height - y!) / dy!)) }))
      .filter((pass) => pass.width && pass.height)
      .map((pass) => ({ length: Math.ceil((pass.width * channels * depth) / 8) + 1, height: pass.height }))
    const expandedSize = rows.reduce((sum, row) => sum + row.length * row.height, 0)
    const expanded = inflateSync(Buffer.concat(compressed), { maxOutputLength: expandedSize })
    if (expanded.length !== expandedSize) throw new Error("skill_response_invalid")
    let rowOffset = 0
    for (const row of rows)
      for (let index = 0; index < row.height; index++) {
        if (expanded[rowOffset]! > 4) throw new Error("skill_response_invalid")
        rowOffset += row.length
      }
    return { width, height }
  }
  if (mime !== "image/jpeg" || bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9)
    throw new Error("skill_response_invalid")
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error("skill_response_invalid")
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]!
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) break
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) throw new Error("skill_response_invalid")
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) throw new Error("skill_response_invalid")
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) }
    }
    offset += length
  }
  throw new Error("skill_response_invalid")
}
/** Platform has just verified purpose/CLEAN/object identity; BFF verifies its returned exact image and re-admits afterwards. */
export async function readSkillCoverBytes(
  reference: PackageTransferReference | undefined,
  cover: SkillCover | undefined,
  origin: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Buffer> {
  const expected = projectSkillCover(cover),
    transfer = referenceOf(reference, origin)
  const response = await fetcher(transfer.url, { method: "GET", redirect: "error", credentials: "omit", signal })
  if (response.status !== 200 || !response.body || response.headers.get("content-type")?.split(";", 1)[0] !== expected.mime_type) {
    await response.body?.cancel()
    throw new Error("skill_response_invalid")
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const part = await reader.read()
      signal.throwIfAborted()
      if (part.done) break
      size += part.value.byteLength
      if (size > 5_242_880) throw new Error("skill_response_invalid")
      chunks.push(part.value)
    }
  } finally {
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const bytes = Buffer.concat(chunks),
    actual = imageDimensions(bytes, expected.mime_type)
  if (actual.width !== expected.width || actual.height !== expected.height) throw new Error("skill_response_invalid")
  return bytes
}
