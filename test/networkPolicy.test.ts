import { describe, expect, it } from "vitest";
import { isPublicAddress, resolvePublicEndpoint } from "../src/security/networkPolicy.js";

describe("mail endpoint network policy", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
  ])("rejects special-use address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])("accepts public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it("pins a literal public endpoint without DNS", async () => {
    await expect(resolvePublicEndpoint("1.1.1.1")).resolves.toMatchObject({
      hostname: "1.1.1.1",
      address: "1.1.1.1",
      family: 4,
      address_count: 1,
    });
  });

  it("rejects IPv4-mapped loopback literals", async () => {
    await expect(resolvePublicEndpoint("::ffff:127.0.0.1")).rejects.toMatchObject({ code: "ENDPOINT_NOT_PUBLIC" });
  });
});
