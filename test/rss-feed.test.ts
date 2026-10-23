import assert from "node:assert/strict"
import test from "node:test"
import { parseRssFeed } from "../src/infrastructure/clients/rss-feed-parser.js"
const bytes = (s: string) => new TextEncoder().encode(s)
const rss = (items: string) => bytes(`<rss version="2.0"><channel>${items}</channel></rss>`)
const item = (extra = "") => `<item><guid>x</guid><title>Hello</title>${extra}</item>`
test("RSS2 normalizes identity, text, authors, categories, dates and enclosures", () => {
  const [e] = parseRssFeed(
    rss(
      item(
        `<description><![CDATA[<b>data</b>]]></description><author>A</author><category>C</category><link>https://EXAMPLE.com/a</link><pubDate>Tue, 01 Jan 2030 00:00:00 GMT</pubDate><enclosure url="https://example.com/a.mp3" type="audio/mpeg" length="12"/>`,
      ),
    ),
  )
  assert.equal(e?.title, "Hello")
  assert.equal(e?.summary, "<b>data</b>")
  assert.deepEqual(e?.authors, ["A"])
  assert.deepEqual(e?.categories, ["C"])
  assert.equal(e?.domain, "example.com")
  assert.equal(e?.publishedAt, "2030-01-01T00:00:00.000Z")
  assert.equal(e?.enclosures.length, 1)
})
test("Atom namespace and prefixed entries normalize without executing XHTML", () => {
  const [e] = parseRssFeed(
    bytes(
      `<a:feed xmlns:a="http://www.w3.org/2005/Atom"><a:entry><a:id>x</a:id><a:title>T</a:title><a:content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><b>Data</b></div></a:content><a:author><a:name>N</a:name></a:author><a:link href="https://example.com/a"/><a:updated>2030-01-01T00:00:00Z</a:updated></a:entry></a:feed>`,
    ),
  )
  assert.equal(e?.content, "Data")
  assert.deepEqual(e?.authors, ["N"])
  assert.equal(e?.updatedAt, "2030-01-01T00:00:00.000Z")
})
test("stable ID survives changed title; identical duplicates merge; conflicting duplicates reject atomically", () => {
  const a = parseRssFeed(rss(item()))[0]
  const b = parseRssFeed(rss(item().replace("Hello", "Changed")))[0]
  assert.equal(a?.identity, b?.identity)
  assert.equal(parseRssFeed(rss(item() + item())).length, 1)
  assert.throws(() => parseRssFeed(rss(item() + item().replace("Hello", "Changed"))))
})
test("link fallback is canonical and absent stable ID rejects entire feed", () => {
  assert.equal(parseRssFeed(rss(`<item><link>https://EXAMPLE.com:443/a</link></item>`))[0]?.link, "https://example.com/a")
  assert.throws(() => parseRssFeed(rss(item() + `<item><title>No ID</title></item>`)))
})
for (const [name, xml] of Object.entries({
  dtd: `<!DOCTYPE rss [<!ENTITY x "bad">]><rss version="2.0"><channel/></rss>`,
  xxe: `<!DOCTYPE rss SYSTEM "file:///etc/passwd"><rss version="2.0"><channel/></rss>`,
  xinclude: `<rss version="2.0" xmlns:xi="http://www.w3.org/2001/XInclude"><channel><xi:include href="https://example.com"/></channel></rss>`,
  tail: `<rss version="2.0"><channel>${item()}</channel></rss><broken>`,
  namespace: `<feed><entry><id>x</id></entry></feed>`,
  url: `<rss version="2.0"><channel>${item("<link>javascript:alert(1)</link>")}</channel></rss>`,
  credentials: `<rss version="2.0"><channel>${item("<link>https://u:p@example.com</link>")}</channel></rss>`,
  encoding: `<?xml version="1.0" encoding="ISO-8859-1"?><rss version="2.0"><channel/></rss>`,
}))
  test(`rejects ${name} without raw error disclosure`, () => {
    assert.throws(
      () => parseRssFeed(bytes(xml)),
      (e) => e instanceof Error && e.message === "rss_feed_invalid",
    )
  })
test("UTF8 BOM allowed; invalid UTF8 rejected", () => {
  assert.deepEqual(parseRssFeed(bytes('\uFEFF<rss version="2.0"><channel/></rss>')), [])
  assert.throws(() => parseRssFeed(new Uint8Array([255])))
})
test("all resource bounds reject whole documents", () => {
  assert.throws(() => parseRssFeed(new Uint8Array(1048577)))
  assert.throws(() => parseRssFeed(rss(Array.from({ length: 201 }, (_, i) => item().replace("<guid>x", `<guid>${i}`)).join(""))))
  assert.throws(() => parseRssFeed(rss(item(`<description>${"a".repeat(65537)}</description>`))))
  assert.throws(() => parseRssFeed(rss(item(`<description>${"<b>".repeat(33)}x${"</b>".repeat(33)}</description>`))))
  assert.throws(() => parseRssFeed(rss(item(Array.from({ length: 33 }, () => "<author>A</author>").join("")))))
  assert.throws(() => parseRssFeed(rss("<x/>".repeat(20001))))
})

test("XML-only predefined entities, no HTML entity fallback", () => {
  assert.equal(parseRssFeed(rss(item("<description>&lt;&amp;&gt;&quot;&apos;</description>")))[0]?.summary, "<&>\"'")
  assert.throws(() => parseRssFeed(rss(item("<description>&nbsp;</description>"))))
})
test("exact field, item and list limits are accepted", () => {
  assert.equal(parseRssFeed(rss(item(`<description>${"a".repeat(65536)}</description>`)))[0]?.summary.length, 65536)
  assert.equal(parseRssFeed(rss(Array.from({ length: 200 }, (_, i) => item().replace("<guid>x", `<guid>${i}`)).join(""))).length, 200)
  assert.equal(parseRssFeed(rss(item("<category>C</category>".repeat(32))))[0]?.categories.length, 32)
})
test("Atom alternate/enclosure, source identity and immutable returned data", () => {
  const result = parseRssFeed(
    bytes(
      `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>x</id><title>T</title><link rel="enclosure" href="https://example.com/a"/><category term="news"/></entry></feed>`,
    ),
  )
  assert.equal(result[0]?.link, null)
  assert.deepEqual(result[0]?.categories, ["news"])
  assert.equal(result[0]?.enclosures[0]?.url, "https://example.com/a")
  assert.ok(Object.isFrozen(result))
  assert.ok(Object.isFrozen(result[0]))
  assert.ok(Object.isFrozen(result[0]?.enclosures))
})
test("bad date, duplicate scalar, credential enclosure and non-UTF8 declarations fail closed", () => {
  for (const extra of ["<pubDate>not a date</pubDate>", "<title>other</title>", '<enclosure url="https://u:p@example.com/a"/>'])
    assert.throws(() => parseRssFeed(rss(item(extra))))
})

for (const xml of [
  '<rss version="2.0" version="3"><channel/></rss>',
  '<rss version="2.0"><channel/></rss><rss version="2.0"><channel/></rss>',
  '<rss version="2.0"><channel/></rss>not-whitespace',
  '<rss version="2.0" xmlns:a="urn:x" xmlns:b="urn:x" a:id="one" b:id="two"><channel/></rss>',
  '<rss version="2.0" xmlns:f="urn:foreign"><channel><item><f:guid>x</f:guid></item></channel></rss>',
  '<feed xmlns="urn:fake"><entry><id>x</id></entry></feed>',
])
  test(`rejects duplicate/root/namespace ambiguity ${xml.slice(0, 65)}`, () => assert.throws(() => parseRssFeed(bytes(xml))))
for (const char of ["\u0000", "\u0001", "\u000b", "\u000c", "\u001f", "\ufffe", "\uffff"])
  test(`rejects literal XML1.0 forbidden character U+${char.charCodeAt(0).toString(16)}`, () =>
    assert.throws(() => parseRssFeed(rss(item(`<description>${char}</description>`)))))
test("numeric XML-forbidden scalars reject while astral Unicode remains data", () => {
  for (const scalar of ["0", "xD800", "xFFFE", "xFFFF"]) assert.throws(() => parseRssFeed(rss(item(`<description>&#${scalar};</description>`))))
  assert.equal(parseRssFeed(rss(item("<description>&#x1F600;😀</description>")))[0]?.summary, "😀😀")
})
test("XML declaration may not reappear inside or after the document", () => {
  for (const xml of [
    '<rss version="2.0"><channel><?xml version="1.0"?></channel></rss>',
    '<rss version="2.0"><channel/></rss><?xml version="1.0"?>',
    '<?xml version="1.0"?><?xml version="1.0"?><rss version="2.0"><channel/></rss>',
  ])
    assert.throws(() => parseRssFeed(bytes(xml)))
})

test("opaque IDs retain their exact value instead of collapsing distinct IDs", () => {
  const a = parseRssFeed(rss(item()))[0]
  const b = parseRssFeed(rss(item().replace("<guid>x</guid>", "<guid> x </guid>")))[0]
  assert.notEqual(a?.identity, b?.identity)
})

for (const separator of [" ", "\t", "\n", "\r", "\r\n"])
  test(`XML declaration accepts XML S ${JSON.stringify(separator)}`, () => {
    assert.equal(
      parseRssFeed(
        bytes(
          `<?xml${separator}version${separator}=${separator}"1.0"${separator}encoding="uTf-8"${separator}standalone="yes"?>` +
            '<rss version="2.0"><channel/></rss>',
        ),
      ).length,
      0,
    )
  })
for (const declaration of [
  '<?xml VERSION="1.0"?>',
  '<?xml version="1.0" ENCODING="UTF-8"?>',
  '<?xml version="1.0" STANDALONE="yes"?>',
  '<?xml version="1.0" standalone="YES"?>',
  '<?xml version="1.0" standalone="NO"?>',
  '<?xml version\u00a0=\u00a0"1.0"?>',
  '<?xml\u00a0version="1.0"?>',
  '<?xml version="1.0"\u00a0encoding="UTF-8"?>',
])
  test(`XML declaration rejects non-XML separators or wrong keyword/value case ${JSON.stringify(declaration)}`, () =>
    assert.throws(() => parseRssFeed(bytes(declaration + '<rss version="2.0"><channel/></rss>'))))
test("literal CRLF/CR normalize before entities, matching LF identities and duplicate content", () => {
  const entries = ["a\rb", "a\r\nb", "a\nb"].map((id) => parseRssFeed(rss(`<item><guid>${id}</guid><title>T</title></item>`))[0])
  assert.equal(entries[0]?.identity, entries[2]?.identity)
  assert.equal(entries[1]?.identity, entries[2]?.identity)
  assert.equal(parseRssFeed(rss("<item><guid>same</guid><title>a\r\nb</title></item><item><guid>same</guid><title>a\nb</title></item>")).length, 1)
  assert.equal(parseRssFeed(rss(item("<description><![CDATA[a\rb\r\nc]]></description>")))[0]?.summary, "a\nb\nc")
})
test("entity-derived CR remains distinct from literal CR and unchanged in text", () => {
  const literal = parseRssFeed(rss("<item><guid>a\rb</guid></item>"))[0]
  const entity = parseRssFeed(rss("<item><guid>a&#xD;b</guid><description>x&#xD;y</description></item>"))[0]
  assert.notEqual(literal?.identity, entity?.identity)
  assert.equal(entity?.summary, "x\ry")
})
for (const whitespace of ["\t", "\n", "\r", "&#x9;", "&#xA;", "&#xD;"])
  for (const kind of ["projected", "unknown", "namespace"])
    test(`all decoded attributes reject ${kind} whitespace ${JSON.stringify(whitespace)}`, () => {
      const attribute = kind === "projected" ? `term="a${whitespace}b"` : kind === "unknown" ? `unused="a${whitespace}b"` : `xmlns:x="urn:a${whitespace}b"`
      assert.throws(() => parseRssFeed(bytes(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>x</id><category ${attribute}/></entry></feed>`)))
    })
test("ordinary space in an attribute remains supported without normalization guesses", () => {
  const [e] = parseRssFeed(bytes('<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>x</id><category term="a b"/></entry></feed>'))
  assert.deepEqual(e?.categories, ["a b"])
})

for (const cdata of ["<![CDATA[]]>", "<![CDATA[ \t\n]]>"]) {
  test(`CDATA before root is rejected ${JSON.stringify(cdata)}`, () => assert.throws(() => parseRssFeed(bytes(cdata + '<rss version="2.0"><channel/></rss>'))))
  test(`CDATA after root is rejected ${JSON.stringify(cdata)}`, () => assert.throws(() => parseRssFeed(bytes('<rss version="2.0"><channel/></rss>' + cdata))))
}
test("CDATA inside a projected element remains data", () =>
  assert.equal(parseRssFeed(rss(item("<description><![CDATA[x<y]]></description>")))[0]?.summary, "x<y"))
