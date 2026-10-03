type JsonRecord = Record<string, unknown>
const fail = (message: string): never => {
  throw new Error(`platform execution operations: ${message}`)
}

class Parser {
  private index = 0
  public constructor(private readonly text: string) {}
  public parse(): unknown {
    this.space()
    const value = this.value()
    this.space()
    if (this.index !== this.text.length) fail(`raw JSON trailing token at ${this.index}`)
    return value
  }
  private value(): unknown {
    const token = this.text[this.index]
    if (token === "{") return this.object()
    if (token === "[") return this.array()
    if (token === '"') return this.string()
    if (token === "t") return this.literal("true", true)
    if (token === "f") return this.literal("false", false)
    if (token === "n") return this.literal("null", null)
    if (token === "-" || (token !== undefined && token >= "0" && token <= "9")) return this.number()
    return fail(`raw JSON unexpected token at ${this.index}`)
  }
  private object(): JsonRecord {
    this.index++
    this.space()
    const result: JsonRecord = Object.create(null) as JsonRecord
    const keys = new Set<string>()
    if (this.take("}")) return result
    while (true) {
      if (this.text[this.index] !== '"') fail(`raw JSON object key at ${this.index}`)
      const key = this.string()
      if (keys.has(key)) fail(`raw JSON duplicate key ${key}`)
      keys.add(key)
      this.space()
      if (!this.take(":")) fail(`raw JSON missing colon at ${this.index}`)
      this.space()
      result[key] = this.value()
      this.space()
      if (this.take("}")) return result
      if (!this.take(",")) fail(`raw JSON missing comma at ${this.index}`)
      this.space()
    }
  }
  private array(): unknown[] {
    this.index++
    this.space()
    const result: unknown[] = []
    if (this.take("]")) return result
    while (true) {
      result.push(this.value())
      this.space()
      if (this.take("]")) return result
      if (!this.take(",")) fail(`raw JSON missing comma at ${this.index}`)
      this.space()
    }
  }
  private string(): string {
    this.index++
    let result = ""
    while (this.index < this.text.length) {
      const character = this.text[this.index++]!
      if (character === '"') return result
      if (character === "\\") {
        const escape = this.text[this.index++]
        const simple: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        }
        if (escape !== undefined && Object.hasOwn(simple, escape)) {
          result += simple[escape]
          continue
        }
        if (escape !== "u") fail(`raw JSON invalid escape at ${this.index - 1}`)
        const first = this.codeUnit()
        if (first >= 0xd800 && first <= 0xdbff) {
          if (this.text.slice(this.index, this.index + 2) !== "\\u") fail("raw JSON lone surrogate")
          this.index += 2
          const second = this.codeUnit()
          if (second < 0xdc00 || second > 0xdfff) fail("raw JSON lone surrogate")
          result += String.fromCharCode(first, second)
          continue
        }
        if (first >= 0xdc00 && first <= 0xdfff) fail("raw JSON lone surrogate")
        result += String.fromCharCode(first)
        continue
      }
      if (character.charCodeAt(0) < 0x20) fail("raw JSON control character")
      const code = character.charCodeAt(0)
      if (code >= 0xd800 && code <= 0xdfff) {
        const next = this.text.charCodeAt(this.index)
        if (code > 0xdbff || next < 0xdc00 || next > 0xdfff) fail("raw JSON lone surrogate")
        result += character + this.text[this.index++]
      } else result += character
    }
    return fail("raw JSON unterminated string")
  }
  private codeUnit(): number {
    const hex = this.text.slice(this.index, this.index + 4)
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(`raw JSON invalid unicode escape at ${this.index}`)
    this.index += 4
    return Number.parseInt(hex, 16)
  }
  private number(): number {
    const match = /^-?(?:0|[1-9][0-9]*)/.exec(this.text.slice(this.index))
    if (!match) return fail(`raw JSON number token at ${this.index}`)
    const token = match[0]
    this.index += token.length
    const next = this.text[this.index]
    if (next === "." || next === "e" || next === "E" || (next !== undefined && /[0-9]/.test(next)))
      fail("raw JSON number token must be an integer without exponent")
    if (token === "-0") fail("raw JSON number token -0 is forbidden")
    const value = Number(token)
    if (!Number.isSafeInteger(value)) fail("raw JSON unsafe integer")
    return value
  }
  private literal<T>(token: string, value: T): T {
    if (this.text.slice(this.index, this.index + token.length) !== token) fail(`raw JSON invalid literal at ${this.index}`)
    this.index += token.length
    return value
  }
  private space(): void {
    while (/[\t\n\r ]/.test(this.text[this.index] ?? "")) this.index++
  }
  private take(token: string): boolean {
    if (this.text[this.index] !== token) return false
    this.index++
    return true
  }
}

export function strictParseRawJson(raw: Uint8Array | string): unknown {
  let text: string
  if (typeof raw === "string") text = raw
  else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(raw)
    } catch {
      return fail("raw JSON invalid UTF-8")
    }
  }
  return new Parser(text).parse()
}
