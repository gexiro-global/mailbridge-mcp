export interface MessageAuthentication {
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
  dkim_signed: boolean;
  authentication_results: string[];
  received_spf: string[];
  received_hops: number;
}

function values(headers: Record<string, string | string[]>, name: string): string[] {
  const value = headers[name];
  if (value === undefined) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function verdict(results: string[], mechanism: string): string | null {
  for (const line of results) {
    const match = new RegExp(`${mechanism}\\s*=\\s*([a-z]+)`, "i").exec(line);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}

export function summarizeAuthentication(headers: Record<string, string | string[]>): MessageAuthentication {
  const normalized: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) normalized[key.toLowerCase()] = value;
  const authResults = values(normalized, "authentication-results");
  const receivedSpf = values(normalized, "received-spf");
  return {
    spf: verdict(authResults, "spf") ?? (receivedSpf[0]?.trim().split(/\s+/)[0]?.toLowerCase() ?? null),
    dkim: verdict(authResults, "dkim"),
    dmarc: verdict(authResults, "dmarc"),
    dkim_signed: values(normalized, "dkim-signature").length > 0,
    authentication_results: authResults,
    received_spf: receivedSpf,
    received_hops: values(normalized, "received").length,
  };
}
