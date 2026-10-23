import { BlockList, isIP } from "node:net"

const ipv4 = new BlockList()
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.31.196.0", 24],
  ["192.52.193.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["192.175.48.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  ipv4.addSubnet(address, prefix, "ipv4")
const globalV6 = new BlockList()
globalV6.addSubnet("2000::", 3, "ipv6")
const ipv6 = new BlockList()
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["2620:4f:8000::", 48],
  ["3ffe::", 16],
  ["3fff::", 20],
] as const)
  ipv6.addSubnet(address, prefix, "ipv6")

export function isPublicRssAddress(address: string, family: number): boolean {
  if (address.includes("%") || isIP(address) !== family) return false
  if (family === 4) return !ipv4.check(address, "ipv4")
  return family === 6 && globalV6.check(address, "ipv6") && !ipv6.check(address, "ipv6")
}
