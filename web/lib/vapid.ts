import { createPrivateKey, sign } from "node:crypto";
import { SITE_URL } from "./site";

// Web Push without a message (RFC 8030 + VAPID, RFC 8292): an empty POST to the browser's push address, signed with the site's VAPID key.
// With no payload there is nothing to encrypt, so no web-push dependency is needed; the service worker writes the notification itself.

export interface VapidKeys {
  /** base64url of the 65-byte uncompressed P-256 point; the browser subscribes with it. */
  publicKey: string;
  /** base64url of the 32-byte private scalar. */
  privateKey: string;
}

const B64URL = /^[A-Za-z0-9_-]+$/;

/** The keys from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, or null when they aren't set (the feature is then off: the routes answer 501). */
export function vapidKeys(env: Record<string, string | undefined> = process.env): VapidKeys | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey || !B64URL.test(publicKey) || !B64URL.test(privateKey)) return null;
  const pub = Buffer.from(publicKey, "base64url");
  if (pub.length !== 65 || pub[0] !== 4 || Buffer.from(privateKey, "base64url").length !== 32) return null;
  return { publicKey, privateKey };
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** The `Authorization: vapid t=…, k=…` header for one push address: an ES256 JWT for the push service's origin, valid 12 hours. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, nowSec: number): string {
  const pub = Buffer.from(keys.publicKey, "base64url");
  const key = createPrivateKey({
    format: "jwk",
    key: { kty: "EC", crv: "P-256", d: keys.privateKey, x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33, 65)) },
  });
  const head = b64(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: SITE_URL }));
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${body}.${b64(sig)}, k=${keys.publicKey}`;
}

/** Sends one empty push; resolves with the push service's HTTP status (0 when it couldn't be reached). */
export async function sendEmptyPush(endpoint: string, keys: VapidKeys, nowSec: number, fetchFn: typeof fetch = fetch): Promise<number> {
  try {
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: { Authorization: vapidAuthorization(endpoint, keys, nowSec), TTL: String(6 * 3600), Urgency: "normal", "Content-Length": "0" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel().catch(() => {});
    return res.status;
  } catch {
    return 0;
  }
}
