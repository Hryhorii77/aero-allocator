import type { AllocationRecommendation } from "../types.js";

/**
 * Adapter for Aerodrome's Predictive Allocation mechanism (launching September
 * 2026 alongside the Aerodrome/Velodrome "Aero" merger — pushed back from the
 * original July 2026 target).
 *
 * As of 2026-07-24 Dromos Labs has announced the mechanism (real-time,
 * prediction-market-style incentive allocation replacing weekly gauge voting)
 * but has not published contract addresses or an ABI. This module isolates
 * everything that depends on those specifics so the rest of the engine —
 * data, forecasting, recommendations — ships now and this file is the only
 * thing to update on launch day.
 *
 * Execution intentionally returns unsigned call data: signing and submission
 * belong to the host agent's wallet layer (e.g. Base MCP `send_calls` with
 * explicit user approval), never to this server.
 */

export interface PreparedCall {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  description: string;
}

export interface PredictiveAllocationAdapter {
  /** Whether the live mechanism's contracts are configured. */
  isLive(): boolean;
  /** Translate a recommendation into unsigned calls for the host wallet. */
  prepareSubmission(rec: AllocationRecommendation): Promise<PreparedCall[]>;
}

export class NotYetLiveAdapter implements PredictiveAllocationAdapter {
  isLive(): boolean {
    return false;
  }

  async prepareSubmission(_rec: AllocationRecommendation): Promise<PreparedCall[]> {
    throw new Error(
      "Predictive Allocation contracts are not published yet. " +
        "Use the recommendation output with the classic Voter.vote() flow, or " +
        "update src/adapters/predictive-allocation.ts once Dromos Labs releases addresses/ABI.",
    );
  }
}

export const adapter: PredictiveAllocationAdapter = new NotYetLiveAdapter();
