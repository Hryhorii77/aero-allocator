/** Reading one Content Security Policy violation report into the few clipped fields worth logging. */
const clip = (v: unknown, n = 160) => (typeof v === "string" ? v.slice(0, n) : undefined);

/** A URL without its query or fragment (an address or amount could sit there); keywords like "inline" and "eval" pass through. */
function plain(v: unknown): string | undefined {
  const s = clip(v, 300);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return `${u.origin}${u.pathname}`.slice(0, 160);
  } catch {
    return s.slice(0, 40);
  }
}

/** Reads one violation from either report format: the legacy `{ "csp-report": {...} }` and the Reporting API's `{ type, body }`. */
export function readViolation(raw: unknown): Record<string, string> | null {
  const o = raw as { [k: string]: unknown } | null;
  const r = (o?.["csp-report"] ?? o?.body ?? o) as { [k: string]: unknown } | null;
  if (!r || typeof r !== "object") return null;
  const out = {
    directive: clip(r["effective-directive"] ?? r["violated-directive"] ?? r.effectiveDirective ?? r.violatedDirective, 60),
    blocked: plain(r["blocked-uri"] ?? r.blockedURL ?? r.blockedUri),
    page: plain(r["document-uri"] ?? r.documentURL ?? r.documentUri),
    source: plain(r["source-file"] ?? r.sourceFile),
    disposition: clip(r.disposition, 20),
  };
  const clean = Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Record<string, string>;
  return clean.directive || clean.blocked ? clean : null;
}
