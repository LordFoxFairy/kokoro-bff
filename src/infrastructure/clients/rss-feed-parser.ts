import { createHash } from "node:crypto"
import sax, { type QualifiedAttribute, type QualifiedTag } from "sax"

import type { RssFeedEntry } from "../../domain/scheduled-task/rss-feed.js"

export class RssFeedError extends Error {
  constructor() {
    super("rss_feed_invalid")
    this.name = "RssFeedError"
  }
}
const ATOM = "http://www.w3.org/2005/Atom"
const CONTENT = "http://purl.org/rss/1.0/modules/content/"
const INVALID_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u
const DC = "http://purl.org/dc/elements/1.1/"
type XmlNode = { local: string; uri: string; attributes: Record<string, string>; parts: (string | XmlNode)[] }
function invalid(): never {
  throw new RssFeedError()
}
const children = (n: XmlNode): XmlNode[] => n.parts.filter((p): p is XmlNode => typeof p !== "string")
const select = (n: XmlNode, local: string, uri = n.uri): XmlNode[] => children(n).filter((p) => p.local === local && p.uri === uri)
function text(n: XmlNode): string {
  const value = n.parts.map((p) => (typeof p === "string" ? p : text(p))).join("")
  if (Buffer.byteLength(value, "utf8") > 65536) invalid()
  return value
}
function single(n: XmlNode, local: string, uri = n.uri): XmlNode | undefined {
  const found = select(n, local, uri)
  if (found.length > 1) invalid()
  return found[0]
}
function value(n: XmlNode, local: string, uri = n.uri): string {
  const node = single(n, local, uri)
  return node === undefined ? "" : text(node)
}
function url(value: string): string {
  try {
    const u = new URL(value)
    if (!/^https?:$/u.test(u.protocol) || u.username || u.password || /[\u0000-\u0020\u007f]/u.test(value)) invalid()
    return u.href
  } catch {
    return invalid()
  }
}
function date(value: string): string | null {
  if (value === "") return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) invalid()
  return new Date(ms).toISOString()
}
function list(values: readonly string[]): readonly string[] {
  if (values.length > 32) invalid()
  for (const v of values) if (Buffer.byteLength(v, "utf8") > 65536) invalid()
  return Object.freeze([...values])
}
function entry(node: XmlNode, atom: boolean): RssFeedEntry {
  const id = value(node, atom ? "id" : "guid")
  const hasId = id.trim() !== ""
  let link: string | null = null
  const links = select(node, "link")
  if (atom) {
    const alternate = links.filter((n) => n.attributes.rel === undefined || n.attributes.rel === "alternate")
    if (alternate.length > 1) invalid()
    if (alternate[0] !== undefined) link = url(alternate[0].attributes.href ?? "")
  } else {
    if (links.length > 1) invalid()
    if (links[0] !== undefined) link = url(text(links[0]).trim())
  }
  if (!hasId && link === null) invalid()
  const title = value(node, "title")
  const summary = value(node, atom ? "summary" : "description")
  const content = atom ? value(node, "content") : value(node, "encoded", CONTENT)
  const authors = atom ? select(node, "author").map((n) => value(n, "name")) : [...select(node, "author").map(text), ...select(node, "creator", DC).map(text)]
  const categories = select(node, "category").map((n) => (atom ? (n.attributes.term ?? "") : text(n)))
  const enclosureNodes = atom ? links.filter((n) => n.attributes.rel === "enclosure") : select(node, "enclosure")
  if (enclosureNodes.length > 32) invalid()
  const enclosures = enclosureNodes.map((n) => {
    const length = n.attributes.length ?? null
    if (length !== null && !/^(?:0|[1-9][0-9]*)$/u.test(length)) invalid()
    return Object.freeze({ url: url(n.attributes[atom ? "href" : "url"] ?? ""), type: n.attributes.type ?? null, length })
  })
  const identity = createHash("sha256")
    .update(JSON.stringify(hasId ? ["id", id] : ["link", link]))
    .digest("hex")
  return Object.freeze({
    identity,
    title,
    summary,
    content,
    authors: list(authors),
    categories: list(categories),
    link,
    domain: link === null ? null : new URL(link).hostname,
    publishedAt: date(value(node, atom ? "published" : "pubDate")),
    updatedAt: date(atom ? value(node, "updated") : ""),
    enclosures: Object.freeze(enclosures),
  })
}

/** Parse one bounded document atomically. No network, entity loading, HTML execution or prompt authority. */
export function parseRssFeed(bytes: Uint8Array): readonly RssFeedEntry[] {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 1048576) invalid()
    // XML 1.0 EOL normalization precedes entity expansion; &#xD; must remain CR.
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\r\n?/gu, "\n")
    // sax 1.6.1 implements strictEntities; its published 1.2.7 types omit the option.
    if (INVALID_XML.test(xml)) invalid()
    const options = { xmlns: true, strictEntities: true, trim: false, normalize: false }
    const p = sax.parser(true, options)
    const stack: XmlNode[] = []
    let root: XmlNode | undefined
    let nodes = 0
    const count = () => {
      if (++nodes > 20000) invalid()
    }
    p.onerror = () => invalid()
    p.ondoctype = () => invalid()
    let declarationSeen = false
    p.onprocessinginstruction = (instruction) => {
      if (declarationSeen || root !== undefined || !/^<\?xml[ \t\n]/u.test(xml)) invalid()
      declarationSeen = true
      if (
        instruction.name !== "xml" ||
        !/^version[ \t\n]*=[ \t\n]*(["'])1\.0\1(?:[ \t\n]+encoding[ \t\n]*=[ \t\n]*(["'])[Uu][Tt][Ff]-8\2)?(?:[ \t\n]+standalone[ \t\n]*=[ \t\n]*(["'])(?:yes|no)\3)?[ \t\n]*$/u.test(
          instruction.body,
        )
      )
        invalid()
    }
    let attributeNames = new Set<string>()
    let expandedNames = new Set<string>()
    p.onopentagstart = () => {
      attributeNames = new Set()
      expandedNames = new Set()
    }
    p.onattribute = (raw) => {
      count()
      const a = raw as QualifiedAttribute
      // Conservative supported subset: do not guess literal versus reference attribute whitespace.
      if (INVALID_XML.test(a.value) || /[\t\n\r]/u.test(a.value)) invalid()
      const expanded = JSON.stringify([a.uri, a.local])
      if (attributeNames.has(a.name) || expandedNames.has(expanded)) invalid()
      attributeNames.add(a.name)
      expandedNames.add(expanded)
    }
    p.onopentag = (raw) => {
      count()
      const tag = raw as QualifiedTag
      if (stack.length >= 32 || tag.uri === "http://www.w3.org/2001/XInclude") invalid()
      const attributes: Record<string, string> = Object.create(null)
      for (const a of Object.values(tag.attributes)) {
        if (Buffer.byteLength(a.value, "utf8") > 65536) invalid()
        if (a.uri === "" && a.prefix === "") attributes[a.local] = a.value
      }
      const node: XmlNode = { local: tag.local, uri: tag.uri, attributes, parts: [] }
      const parent = stack.at(-1)
      if (parent) parent.parts.push(node)
      else {
        if (root !== undefined) invalid()
        root = node
      }
      stack.push(node)
    }
    const addText = (s: string) => {
      count()
      if (INVALID_XML.test(s)) invalid()
      const n = stack.at(-1)
      if (n) n.parts.push(s)
      else if (s.trim() !== "") invalid()
    }
    p.ontext = addText
    p.onopencdata = () => {
      if (stack.length === 0) invalid()
    }
    p.oncdata = (text) => {
      if (stack.length === 0) invalid()
      addText(text)
    }
    p.oncomment = count
    p.onclosetag = () => {
      stack.pop()
    }
    p.write(xml).close()
    if (root === undefined || stack.length !== 0) invalid()
    let entries: XmlNode[]
    let atom: boolean
    if (root.local === "rss" && root.uri === "" && root.attributes.version === "2.0") {
      const channel = single(root, "channel")
      if (channel === undefined) invalid()
      entries = select(channel, "item")
      atom = false
    } else if (root.local === "feed" && root.uri === ATOM) {
      entries = select(root, "entry")
      atom = true
    } else return invalid()
    if (entries.length > 200) invalid()
    const unique = new Map<string, RssFeedEntry>()
    for (const n of entries) {
      const e = entry(n, atom),
        previous = unique.get(e.identity)
      if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(e)) invalid()
      unique.set(e.identity, e)
    }
    return Object.freeze([...unique.values()])
  } catch {
    throw new RssFeedError()
  }
}
