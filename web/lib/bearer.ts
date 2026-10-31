import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Whether an Authorization header is exactly `Bearer <secret>`, compared in constant time so the response time says nothing about how
 * much of a guess was right. Both sides are hashed first because `timingSafeEqual` needs equal lengths, and comparing lengths would
 * leak the secret's length.
 */
export function bearerMatches(header: string | null, secret: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}
