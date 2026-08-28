import { NextResponse } from "next/server";
import { PRESET, PROTOCOL } from "aero-allocator/config";

// Server-side source of truth for the contract addresses a vote transaction
// signs against — client code reads these via useProtocolAddresses
// (web/lib/protocol.ts) rather than duplicating them, so a redeploy with a
// different AERO_PROTOCOL can never leave the wallet flow pointed at a
// stale/wrong contract.
export async function GET() {
  return NextResponse.json({
    protocol: PROTOCOL,
    voterAddress: PRESET.addresses.voter,
    veSugarAddress: PRESET.addresses.veSugar,
  });
}
