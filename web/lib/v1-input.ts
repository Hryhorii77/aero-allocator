import { NextResponse } from "next/server";

/** A 400 (not a 402-then-fail): withX402 does not settle a response of 400 or above, so a malformed request costs the caller nothing. */
export const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });

/** A sAERO position id from a query string: a plain whole number, nothing else. */
export function parseTokenId(raw: string): bigint | null {
  return /^\d{1,20}$/.test(raw) ? BigInt(raw) : null;
}
