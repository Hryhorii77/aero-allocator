import { NextResponse } from "next/server";
import { withApiErrorHandling } from "@/lib/api-error";
import { parseAdd, parseRemove } from "@/lib/push-reminders";
import { addReminder, removeReminder } from "@/lib/push-reminders-store";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { vapidKeys } from "@/lib/vapid";

// "Your wait is over" notifications (lib/push-reminders.ts). The page reads the public key here, then adds or cancels a reminder:
// a random id, the browser's push address and a time rounded to 15 minutes. Nothing about the position or the wallet is sent.
// Page-only, not in the OpenAPI or llms.txt.

const MAX_BODY = 2048;
const off = () => NextResponse.json({ error: "notifications are not set up on this deployment" }, { status: 501 });

async function readJson(req: Request): Promise<{ ok: true; json: unknown } | { ok: false; res: NextResponse }> {
  const text = await req.text();
  if (text.length > MAX_BODY) return { ok: false, res: NextResponse.json({ error: "too large" }, { status: 413 }) };
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, res: NextResponse.json({ error: "not json" }, { status: 400 }) };
  }
}

export const GET = withApiErrorHandling("reminders", async () => {
  const keys = vapidKeys();
  if (!keys) return off();
  return NextResponse.json({ publicKey: keys.publicKey }, { headers: { "Cache-Control": "public, s-maxage=3600" } });
});

export const POST = withApiErrorHandling("reminders", async (req: Request) => {
  if (!vapidKeys()) return off();
  const rl = checkRateLimit(req, { key: "reminders", limit: 10, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = parseAdd(body.json, Math.floor(Date.now() / 1000));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const outcome = await addReminder(parsed.value, Math.floor(Date.now() / 1000));
  if (outcome === "full") return NextResponse.json({ error: "too many reminders" }, { status: 429 });
  if (outcome === "failed") return NextResponse.json({ error: "could not save the reminder just now" }, { status: 503 });
  return new NextResponse(null, { status: 204 });
});

export const DELETE = withApiErrorHandling("reminders", async (req: Request) => {
  if (!vapidKeys()) return off();
  const rl = checkRateLimit(req, { key: "reminders", limit: 10, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = parseRemove(body.json);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!(await removeReminder(parsed.value.id, parsed.value.endpoint))) return NextResponse.json({ error: "could not cancel just now" }, { status: 503 });
  return new NextResponse(null, { status: 204 });
});
