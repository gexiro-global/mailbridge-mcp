import { describe, expect, it } from "vitest";
import { protectedResourceMetadata } from "../src/auth/oauth.js";
import { testConfig } from "./fixtures.js";

describe("OAuth protected resource metadata", () => {
  it("binds tokens to the configured resource and issuer", () => {
    const metadata = protectedResourceMetadata(testConfig);
    expect(metadata.resource).toBe(testConfig.auth.audience);
    expect(metadata.authorization_servers).toEqual([testConfig.auth.issuer]);
    expect(metadata.scopes_supported).toContain("mail.read");
    expect(metadata.scopes_supported).toContain("mail.health.read");
    expect(metadata.scopes_supported).toContain("mail.send");
  });
});
