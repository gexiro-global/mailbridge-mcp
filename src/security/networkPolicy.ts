import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { MailBridgeError } from "../domain/errors.js";

export interface ResolvedPublicEndpoint {
  hostname: string;
  address: string;
  family: 4 | 6;
  address_count: number;
}

// Keep address families in separate lists. Node represents IPv4 values as
// IPv4-mapped IPv6 internally when a BlockList contains IPv6 rules, so a
// blanket mapped-address rule would otherwise reject every public IPv4 host.
const blockedIpv4 = new BlockList();
const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) blockedIpv4.addSubnet(network, prefix, "ipv4");

blockedIpv6.addAddress("::", "ipv6");
blockedIpv6.addAddress("::1", "ipv6");
for (const [network, prefix] of [
  ["::ffff:0:0", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) blockedIpv6.addSubnet(network, prefix, "ipv6");

/**
 * Resolves once, rejects the complete DNS answer if any address is not public,
 * and returns the exact IP that callers must use for the socket connection.
 * Keeping the original hostname separately preserves SNI and certificate-host
 * validation without a second resolver lookup (DNS-rebinding defence).
 */
export async function resolvePublicEndpoint(hostname: string): Promise<ResolvedPublicEndpoint> {
  const normalized = hostname.trim().replace(/^\[|\]$/g, "");
  if (!normalized || normalized.length > 253 || normalized.includes("\0")) {
    throw new MailBridgeError("Mail endpoint hostname is invalid", "ENDPOINT_HOST_INVALID");
  }
  const literalFamily = isIP(normalized);
  const addresses = literalFamily
    ? [{ address: normalized, family: literalFamily }]
    : await lookup(normalized, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new MailBridgeError("Mail endpoint did not resolve", "ENDPOINT_DNS_FAILED", true);
  }
  if (addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new MailBridgeError("Mail endpoint resolved to a prohibited network", "ENDPOINT_NOT_PUBLIC");
  }
  const selected = addresses[0]!;
  return {
    hostname: normalized,
    address: selected.address,
    family: selected.family as 4 | 6,
    address_count: addresses.length,
  };
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedIpv4.check(address, "ipv4");
  if (family !== 6) return false;

  const mapped = mappedIpv4(address);
  if (mapped) return isPublicAddress(mapped);
  return !blockedIpv6.check(address, "ipv6");
}

function mappedIpv4(address: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1];
  if (dotted && isIP(dotted) === 4) return dotted;
  const hexadecimal = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (!hexadecimal?.[1] || !hexadecimal[2]) return null;
  const high = Number.parseInt(hexadecimal[1], 16);
  const low = Number.parseInt(hexadecimal[2], 16);
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}
