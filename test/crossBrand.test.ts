import { describe, expect, it } from "vitest";
import { brandConfigurationWarnings } from "../src/security/brandGuard.js";
import { findCrossBrandFindings } from "../src/security/crossBrand.js";
import type { MessageSummary } from "../src/domain/types.js";
import { testConfig } from "./fixtures.js";

describe("cross-brand detection", () => {
  it("finds a foreign configured brand domain in another mailbox", () => {
    const message: MessageSummary = {
      stable_message_id: "opaque-message-id",
      mailbox_id: "brand_a",
      mailbox_email: "operator@brand-a.example.invalid",
      brand: "BRAND_A",
      folder: "INBOX",
      from: [{ address: "operator@brand-b.example.invalid" }],
      to: [{ address: "operator@brand-a.example.invalid" }],
      cc: [],
      subject: "Synthetic test",
      received_at: "2026-07-17T08:00:00.000Z",
      unread: true,
      has_attachments: false,
      attachment_count: 0,
      safe_snippet: null,
      untrusted_content_warning: "UNTRUSTED_EMAIL_CONTENT",
    };
    const findings = findCrossBrandFindings(testConfig.mailboxes, [message]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.expected_brands).toEqual(["BRAND_B"]);
    expect(findings[0]?.follow_up_tool).toBe("fetch_thread");
  });

  it("raises the required configuration warning for a configured domain mismatch", () => {
    const mailbox = structuredClone(testConfig.mailboxes[0]!);
    mailbox.email = "operator@brand-b.example.invalid";
    mailbox.brand = "BRAND_A";
    expect(brandConfigurationWarnings(mailbox, testConfig.mailboxes)[0]?.code).toBe("CROSS_BRAND_CONFIGURATION_WARNING");
    expect(brandConfigurationWarnings(mailbox, testConfig.mailboxes)[0]?.expected_brand).toBe("BRAND_B");
  });
});
