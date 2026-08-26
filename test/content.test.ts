import { describe, expect, it } from "vitest";
import { boundedText, sanitizeEmailHtml, textSnippet } from "../src/security/content.js";

describe("untrusted content handling", () => {
  it("removes scripts, remote images and event handlers", () => {
    const result = sanitizeEmailHtml(
      "<p onclick='steal()'>Hello</p><script>alert(1)</script><img src='https://tracker.invalid/pixel'>",
      1000,
    );
    expect(result).toContain("Hello");
    expect(result).not.toMatch(/script|onclick|tracker|img/i);
  });

  it("removes active links", () => {
    const result = sanitizeEmailHtml("<a href='https://phish.invalid'>click</a>", 1000);
    expect(result).toBe("click");
  });

  it("bounds sanitized html", () => {
    expect(sanitizeEmailHtml(`<p>${"x".repeat(200)}</p>`, 20)).toHaveLength(20);
  });

  it("creates a text-only snippet", () => {
    expect(textSnippet("<b>Hello</b>   world", 100)).toBe("Hello world");
  });

  it("removes NUL bytes and bounds text", () => {
    expect(boundedText(`a\u0000${"b".repeat(20)}`, 10)).toBe("abbbbbbbb…");
  });
});
