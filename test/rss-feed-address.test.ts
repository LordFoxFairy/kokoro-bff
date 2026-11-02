import { parseRssFeedUrl } from "../src/domain/scheduled-task/trigger.js"
import assert from "node:assert/strict"
import test from "node:test"
import { isPublicRssAddress } from "../src/infrastructure/clients/rss-feed-address.js"
for (const [address, family] of [
  ["8.8.8.8", 4],
  ["1.1.1.1", 4],
  ["2606:4700:4700::1111", 6],
  ["2001:4860:4860::8888", 6],
] as const)
  test(`public address ${address}`, () => assert.equal(isPublicRssAddress(address, family), true))
for (const address of [
  "0.1.2.3",
  "10.1.2.3",
  "100.64.0.1",
  "127.0.0.1",
  "169.254.1.1",
  "172.16.1.1",
  "192.0.0.1",
  "192.0.2.1",
  "192.31.196.1",
  "192.52.193.1",
  "192.88.99.1",
  "192.168.1.1",
  "192.175.48.1",
  "198.18.1.1",
  "198.51.100.1",
  "203.0.113.1",
  "224.1.1.1",
  "255.255.255.255",
])
  test(`forbidden IPv4 ${address}`, () => assert.equal(isPublicRssAddress(address, 4), false))
for (const address of [
  "::",
  "::1",
  "::ffff:8.8.8.8",
  "::ffff:127.0.0.1",
  "64:ff9b::808:808",
  "100::1",
  "2001::1",
  "2001:db8::1",
  "2002:808:808::1",
  "2620:4f:8000::1",
  "3ffe::1",
  "3fff::1",
  "fc00::1",
  "fe80::1",
  "ff02::1",
  "2001:4860::1%en0",
])
  test(`forbidden IPv6 ${address}`, () => assert.equal(isPublicRssAddress(address, 6), false))
test("invalid and mismatched families are rejected", () => {
  assert.equal(isPublicRssAddress("8.8.8.8", 6), false)
  assert.equal(isPublicRssAddress("no", 4), false)
})
test("normal HTTPS feed URL", () => assert.equal(parseRssFeedUrl("https://FEED.example.com:443/a?q=1").hostname, "feed.example.com"))
for (const url of [
  "http://feed.example.com",
  "https://feed.example.com:444",
  "https://@feed.example.com",
  "https://a:b@feed.example.com",
  "https://feed.example.com/#",
  "https://feed.example.com/#x",
  "https://127.0.0.1",
  "https://[::1]",
  "https://localhost",
  "https://a.local",
  "https://a.test",
  "https://a.invalid",
  "https://a.internal",
  "https://a.localhost",
  "https://feed.example.com.",
  " https://feed.example.com",
  "https://feed.example.com/a b",
  "https://feed.example.com/\n",
  "https://feed.example.com/" + "x".repeat(2048),
])
  test(`invalid URL ${JSON.stringify(url.slice(0, 70))}`, () => assert.throws(() => parseRssFeedUrl(url)))
