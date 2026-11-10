const base = process.env.VISION_URL,
  key = process.env.CRON_SECRET;
if (!base || !key)
  throw Error("Set VISION_URL and CRON_SECRET in the scheduler environment.");
const r = await fetch(new URL("/api/cron/reminders", base), {
  headers: { Authorization: "Bearer " + key },
  signal: AbortSignal.timeout(60000),
});
if (!r.ok) throw Error("Reminder job failed with HTTP " + r.status);
const x = await r.json();
console.log(JSON.stringify({ sent: x.sent, failed: x.failed }));
