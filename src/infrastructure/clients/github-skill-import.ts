import { createHash } from "node:crypto"
import { inflateRawSync } from "node:zlib"
import { strictParseRawJson } from "../raw-json.js"
import { githubSkillMetadata } from "./github-skill-metadata.js"
import { githubSkillSelectorSchema } from "./platform/skill-product-schema.js"

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}
function pathOf(name: Buffer, utf8: boolean): string {
  if (!utf8 && name.some((byte) => byte > 127)) throw new Error("github_package_invalid")
  const value = new TextDecoder("utf-8", { fatal: true }).decode(name)
  const parts = value.replace(/\/$/u, "").split("/")
  if (
    !value ||
    value.normalize("NFC") !== value ||
    value.startsWith("\ufeff") ||
    /[\\\u0000-\u001f\u007f:]/u.test(value) ||
    parts.some((part) => ["", ".", ".."].includes(part))
  )
    throw new Error("github_package_invalid")
  return value
}
/** Bounded ZIP32 extraction; output is rebuilt as a deterministic ordinary package, never extracted to disk. */
function readGithubArchive(archive: Buffer, subdirectory: string | undefined): Map<string, Buffer> {
  if (archive.length < 22 || archive.length > 33_554_432) throw new Error("github_package_invalid")
  let eocd = archive.length - 22
  while (eocd >= Math.max(0, archive.length - 65_557) && archive.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (
    eocd < 0 ||
    archive.readUInt16LE(eocd + 4) !== 0 ||
    archive.readUInt16LE(eocd + 6) !== 0 ||
    eocd + 22 + archive.readUInt16LE(eocd + 20) !== archive.length
  )
    throw new Error("github_package_invalid")
  const count = archive.readUInt16LE(eocd + 10),
    directory = archive.readUInt32LE(eocd + 16),
    directorySize = archive.readUInt32LE(eocd + 12)
  if (!count || count > 4096 || count !== archive.readUInt16LE(eocd + 8) || directory + directorySize !== eocd) throw new Error("github_package_invalid")
  let cursor = directory,
    expanded = 0,
    root: string | undefined
  const entries = new Map<string, Buffer>(),
    allNames = new Set<string>()
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > eocd || archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error("github_package_invalid")
    const flags = archive.readUInt16LE(cursor + 8),
      method = archive.readUInt16LE(cursor + 10),
      crc = archive.readUInt32LE(cursor + 16),
      compressed = archive.readUInt32LE(cursor + 20),
      size = archive.readUInt32LE(cursor + 24),
      nameLength = archive.readUInt16LE(cursor + 28),
      extra = archive.readUInt16LE(cursor + 30),
      comment = archive.readUInt16LE(cursor + 32),
      offset = archive.readUInt32LE(cursor + 42),
      attributes = archive.readUInt32LE(cursor + 38)
    if (
      cursor + 46 + nameLength + extra + comment > eocd ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      archive.readUInt16LE(cursor + 34) !== 0 ||
      [compressed, size, offset].includes(0xffffffff) ||
      ((attributes >>> 16) & 0xf000) === 0xa000
    )
      throw new Error("github_package_invalid")
    const nameBytes = archive.subarray(cursor + 46, cursor + 46 + nameLength),
      name = pathOf(nameBytes, !!(flags & 0x800))
    if (allNames.has(name)) throw new Error("github_package_invalid")
    allNames.add(name)
    const top = name.split("/")[0]!
    if (root !== undefined && root !== top) throw new Error("github_package_invalid")
    root = top
    if (
      offset + 30 > directory ||
      archive.readUInt32LE(offset) !== 0x04034b50 ||
      archive.readUInt16LE(offset + 6) !== flags ||
      archive.readUInt16LE(offset + 8) !== method
    )
      throw new Error("github_package_invalid")
    if (
      !(flags & 8) &&
      (archive.readUInt32LE(offset + 14) !== crc || archive.readUInt32LE(offset + 18) !== compressed || archive.readUInt32LE(offset + 22) !== size)
    )
      throw new Error("github_package_invalid")
    const localName = archive.readUInt16LE(offset + 26),
      localExtra = archive.readUInt16LE(offset + 28),
      dataStart = offset + 30 + localName + localExtra
    if (localName !== nameLength || !archive.subarray(offset + 30, offset + 30 + localName).equals(nameBytes) || dataStart + compressed > directory)
      throw new Error("github_package_invalid")
    const prefix = `${root}/${subdirectory ? `${subdirectory}/` : ""}`
    if (name.startsWith(prefix) && !name.endsWith("/") && (subdirectory !== undefined || name.endsWith("/SKILL.md"))) {
      const relative = name.slice(prefix.length)
      if (Buffer.byteLength(relative) > 256 || size > 16_777_216 || entries.size >= 128) throw new Error("github_package_invalid")
      expanded += size
      if (expanded > 134_217_728) throw new Error("github_package_invalid")
      const compressedBytes = archive.subarray(dataStart, dataStart + compressed)
      const bytes = method === 0 ? Buffer.from(compressedBytes) : inflateRawSync(compressedBytes, { maxOutputLength: 16_777_216 })
      if (bytes.length !== size || crc32(bytes) !== crc || entries.has(relative)) throw new Error("github_package_invalid")
      entries.set(relative, bytes)
    }
    cursor += 46 + nameLength + extra + comment
  }
  if (cursor !== eocd) throw new Error("github_package_invalid")
  return entries
}
export function githubSkillPackage(archive: Buffer, subdirectory: string): Buffer {
  const entries = readGithubArchive(archive, subdirectory)
  if (!entries.has("SKILL.md")) throw new Error("github_package_invalid")
  const manifest = entries.get("manifest.json")
  if (manifest) {
    const value = strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(manifest)) as { schema_version?: unknown; entry?: unknown }
    if (
      manifest.length > 16384 ||
      !value ||
      Object.keys(value).sort().join(",") !== "entry,schema_version" ||
      value.schema_version !== 2 ||
      value.entry !== "SKILL.md"
    )
      throw new Error("github_package_invalid")
  } else entries.set("manifest.json", Buffer.from('{"schema_version":2,"entry":"SKILL.md"}'))
  for (const name of entries.keys())
    if (name.split("/").some((_, i, parts) => i > 0 && entries.has(parts.slice(0, i).join("/")))) throw new Error("github_package_invalid")
  const local: Buffer[] = [],
    central: Buffer[] = [],
    stamp = 0
  let offset = 0
  for (const [name, bytes] of [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const filename = Buffer.from(name),
      crc = crc32(bytes),
      header = Buffer.alloc(30),
      record = Buffer.alloc(46)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800, 6)
    header.writeUInt32LE(stamp, 10)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(bytes.length, 18)
    header.writeUInt32LE(bytes.length, 22)
    header.writeUInt16LE(filename.length, 26)
    record.writeUInt32LE(0x02014b50)
    record.writeUInt16LE(20, 4)
    record.writeUInt16LE(20, 6)
    record.writeUInt16LE(0x800, 8)
    record.writeUInt32LE(stamp, 12)
    record.writeUInt32LE(crc, 16)
    record.writeUInt32LE(bytes.length, 20)
    record.writeUInt32LE(bytes.length, 24)
    record.writeUInt16LE(filename.length, 28)
    record.writeUInt32LE(offset, 42)
    local.push(header, filename, bytes)
    central.push(record, filename)
    offset += header.length + filename.length + bytes.length
  }
  const centralBytes = Buffer.concat(central),
    end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.size, 8)
  end.writeUInt16LE(entries.size, 10)
  end.writeUInt32LE(centralBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  const output = Buffer.concat([...local, centralBytes, end])
  if (output.length > 33_554_432) throw new Error("github_package_invalid")
  return output
}
export class GithubSkillImportClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async #read(url: string, mime: "json" | "zip", maximum: number, signal: AbortSignal): Promise<Buffer> {
    const response = await this.fetcher(url, {
      method: "GET",
      headers: { accept: mime === "json" ? "application/vnd.github+json" : "application/zip", "user-agent": "kokoro-bff-skills" },
      redirect: "error",
      credentials: "omit",
      signal,
    })
    const type = response.headers.get("content-type")?.split(";", 1)[0]
    if (
      response.status !== 200 ||
      !response.body ||
      (mime === "json" ? type !== "application/json" : !["application/zip", "application/x-zip-compressed"].includes(type ?? ""))
    ) {
      await response.body?.cancel()
      throw new Error("github_response_invalid")
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
        if (size > maximum) throw new Error("github_response_invalid")
        chunks.push(part.value)
      }
    } finally {
      void reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
    return Buffer.concat(chunks)
  }
  async #repository(owner: string, repository: string, signal: AbortSignal) {
    const api = `https://api.github.com/repos/${owner}/${repository}`
    const metadata = strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(await this.#read(api, "json", 1_048_576, signal))) as {
      id?: unknown
      private?: unknown
      full_name?: unknown
      html_url?: unknown
      owner?: { login?: unknown; html_url?: unknown }
      stargazers_count?: unknown
      forks_count?: unknown
      default_branch?: unknown
    }
    if (
      metadata.private !== false ||
      metadata.full_name !== `${owner}/${repository}` ||
      metadata.html_url !== `https://github.com/${owner}/${repository}` ||
      metadata.owner?.login !== owner ||
      metadata.owner.html_url !== `https://github.com/${owner}` ||
      !Number.isSafeInteger(metadata.id) ||
      (metadata.id as number) < 1 ||
      !Number.isSafeInteger(metadata.stargazers_count) ||
      (metadata.stargazers_count as number) < 0 ||
      !Number.isSafeInteger(metadata.forks_count) ||
      (metadata.forks_count as number) < 0
    )
      throw new Error("github_response_invalid")
    return { api, metadata }
  }
  #snapshot(
    selector: { owner: string; repository: string; commit: string; path: string },
    repo: { api: string; metadata: { id?: unknown; html_url?: unknown; owner?: { html_url?: unknown }; stargazers_count?: unknown; forks_count?: unknown } },
    archive: Buffer,
  ) {
    const bytes = githubSkillPackage(archive, selector.path)
    const entry = readGithubArchive(archive, selector.path).get("SKILL.md")!
    const metadata = githubSkillMetadata(entry)
    return {
      bytes,
      metadata,
      selector,
      repository: {
        repository_id: String(repo.metadata.id),
        repository_url: repo.metadata.html_url as string,
        owner_login: selector.owner,
        owner_url: repo.metadata.owner!.html_url as string,
        commit: selector.commit,
        path: selector.path,
        repo_stats: {
          stars: String(repo.metadata.stargazers_count),
          forks: String(repo.metadata.forks_count),
          observed_at: new Date().toISOString(),
          metadata_source_url: repo.api,
        },
      },
      contentSha256: createHash("sha256").update(bytes).digest("hex"),
      archiveUrl: `https://codeload.github.com/${selector.owner}/${selector.repository}/zip/${selector.commit}`,
    }
  }
  async #commit(api: string, ref: string, signal: AbortSignal) {
    const value = strictParseRawJson(
      new TextDecoder("utf-8", { fatal: true }).decode(await this.#read(`${api}/commits/${encodeURIComponent(ref)}`, "json", 1_048_576, signal)),
    ) as { sha?: unknown }
    if (typeof value.sha !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(value.sha)) throw new Error("github_response_invalid")
    return value.sha
  }
  async preview(input: { repository_url: string; path?: string | undefined }, outer: AbortSignal) {
    const match = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9_.-]+)$/u.exec(input.repository_url)
    if (!match || match[1]!.length > 39 || match[2]!.length > 100 || [".", ".."].includes(match[2]!)) throw new Error("github_url_invalid")
    const owner = match[1]!,
      repository = match[2]!,
      signal = AbortSignal.any([outer, AbortSignal.timeout(10_000)])
    const repo = await this.#repository(owner, repository, signal)
    const branch = repo.metadata.default_branch
    if (typeof branch !== "string" || !branch || Buffer.byteLength(branch) > 255 || /[\u0000-\u001f\u007f]/u.test(branch))
      throw new Error("github_response_invalid")
    const commit = await this.#commit(repo.api, branch, signal)
    const archive = await this.#read(`https://codeload.github.com/${owner}/${repository}/zip/${commit}`, "zip", 33_554_432, signal)
    const candidates = readGithubArchive(archive, undefined)
    let paths: string[] = []
    if (candidates.has("SKILL.md")) {
      githubSkillMetadata(candidates.get("SKILL.md")!)
      paths = [""]
    } else
      for (const [entry, bytes] of candidates) {
        try {
          githubSkillMetadata(bytes)
          paths.push(entry.slice(0, -"/SKILL.md".length))
        } catch {
          /* Invalid documents never become selectable Skills. */
        }
      }
    paths.sort()
    if (!paths.length) throw new Error("github_metadata_invalid")
    if (input.path === undefined && paths.length > 1) return { selection_required: true as const, repository_url: input.repository_url, commit, paths }
    const path = input.path ?? paths[0]!
    const selector = githubSkillSelectorSchema.parse({ owner, repository, commit, path })
    if (!paths.includes(path)) throw new Error("github_path_invalid")
    signal.throwIfAborted()
    return { selection_required: false as const, ...this.#snapshot(selector, repo, archive) }
  }
  async fetch(selector: { owner: string; repository: string; commit: string; path: string }, outer: AbortSignal) {
    selector = githubSkillSelectorSchema.parse(selector)
    const signal = AbortSignal.any([outer, AbortSignal.timeout(10_000)]),
      repo = await this.#repository(selector.owner, selector.repository, signal)
    if ((await this.#commit(repo.api, selector.commit, signal)) !== selector.commit) throw new Error("github_response_invalid")
    const archive = await this.#read(`https://codeload.github.com/${selector.owner}/${selector.repository}/zip/${selector.commit}`, "zip", 33_554_432, signal)
    signal.throwIfAborted()
    return this.#snapshot(selector, repo, archive)
  }
}
