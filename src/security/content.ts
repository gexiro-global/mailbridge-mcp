import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "blockquote",
  "pre",
  "code",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

export function sanitizeEmailHtml(html: string, maxChars: number): string {
  const sanitized = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {},
    allowedSchemes: [],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    enforceHtmlBoundary: true,
  });
  return truncate(normalizeWhitespace(sanitized), maxChars);
}

export function textSnippet(value: string | undefined | null, maxChars: number): string | null {
  if (!value) return null;
  const textOnly = sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} });
  const normalized = normalizeWhitespace(textOnly);
  return normalized ? truncate(normalized, maxChars) : null;
}

export function boundedText(value: string | undefined | null, maxChars: number): string {
  return truncate(normalizeWhitespace(value ?? ""), maxChars);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\u0000/g, "").replace(/\r\n/g, "\n").replace(/[\t ]+/g, " ").trim();
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
