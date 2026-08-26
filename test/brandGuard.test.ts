import { describe, expect, it } from "vitest";
import { checkBrandContext } from "../src/security/brandGuard.js";
import { testConfig } from "./fixtures.js";

describe("brand guardrail", () => {
  it("matches the expected mailbox brand", () => {
    const result = checkBrandContext(testConfig.mailboxes, { mailbox_id: "brand_a", organisation_name: "Alpha Org" });
    expect(result.status).toBe("MATCH");
    expect(result.expected_brand).toBe("BRAND_A");
  });

  it("warns on a cross-brand mismatch", () => {
    const result = checkBrandContext(testConfig.mailboxes, { mailbox_id: "brand_b", organisation_name: "Alpha Org" });
    expect(result.status).toBe("WARNING");
    expect(result.reason_codes).toContain("CROSS_BRAND_SENDER_MISMATCH");
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("uses proposed sender domain as evidence", () => {
    const result = checkBrandContext(testConfig.mailboxes, {
      mailbox_id: "brand_a",
      organisation_name: "Unknown",
      proposed_sender_email: "operator@brand-b.example.invalid",
    });
    expect(result.expected_brand).toBe("BRAND_B");
    expect(result.status).toBe("WARNING");
  });

  it("requires review when there is no brand signal", () => {
    const result = checkBrandContext(testConfig.mailboxes, { mailbox_id: "brand_a", organisation_name: "Unknown" });
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.confidence).toBeLessThan(0.5);
  });
});
