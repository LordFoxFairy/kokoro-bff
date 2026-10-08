import { configureTextEncoding, getTextEncoding } from "@bufbuild/protobuf/wire"

let configured = false

/** Preserve every Protobuf string code point, including a file's leading BOM. */
export function configureBffProtobufTextEncoding(): void {
  if (configured) return
  const base = getTextEncoding()
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true })
  const strictDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
  configureTextEncoding({
    checkUtf8: (text) => base.checkUtf8(text),
    encodeUtf8: (text) => base.encodeUtf8(text),
    encodeUtf8Into: (text, destination) => base.encodeUtf8Into(text, destination),
    decodeUtf8: (bytes, strict) => (strict ? strictDecoder : decoder).decode(bytes),
  })
  configured = true
}
