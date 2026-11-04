import { NextResponse } from "next/server";
import { withApiErrorHandling } from "@/lib/api-error";
import { bearerMatches } from "@/lib/bearer";
import { sendDueReminders } from "@/lib/push-reminders-store";
import { vapidKeys } from "@/lib/vapid";

export const maxDuration = 60;

// Called every 15 minutes by Vercel Cron (web/vercel.json): sends an empty push to each browser with a reminder due. CRON_SECRET only,
// like the fee ingest: a deployment without the secret refuses everyone.
export const GET = withApiErrorHandling("reminders-send", async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  if (secret ? !bearerMatches(req.headers.get("authorization"), secret) : process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const keys = vapidKeys();
  if (!keys) return NextResponse.json({ skipped: "VAPID keys not set" });
  const report = await sendDueReminders(keys, Math.floor(Date.now() / 1000));
  if (!report) return NextResponse.json({ error: "could not read the reminders" }, { status: 503 });
  if (report.pushed + report.gone + report.retry + report.expired > 0) console.log(JSON.stringify({ level: "info", tag: "push-reminders", ...report }));
  return NextResponse.json(report);
});
