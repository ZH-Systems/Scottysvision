import * as webpush from "web-push";
import { timingSafeEqual } from "node:crypto";
import { admin, checked, json, fail, AppError } from "@/lib/server";
import WingCore from "@/lib/core/wings.js";
const C: any = WingCore;
export const maxDuration = 60;
export async function GET(req: Request) {
  try {
    const expected = process.env.CRON_SECRET || "",
      actual = req.headers.get("authorization")?.replace(/^Bearer /i, "") || "";
    if (
      !expected ||
      Buffer.byteLength(actual) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
    )
      throw new AppError(401, "Cron authorization required.");
    if (
      !process.env.VAPID_PUBLIC_KEY ||
      !process.env.VAPID_PRIVATE_KEY ||
      !process.env.VAPID_SUBJECT
    )
      throw new AppError(503, "Configure Web Push delivery first.");
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
    const db = admin(),
      subscriptions: any = await checked(
        db.from("vision_push_subscriptions").select("*").limit(500),
      );
    let sent = 0,
      failed = 0;
    for (const scope of [
      ...new Set<string>(subscriptions.map((s: any) => s.workspace_id)),
    ]) {
      const batches: any = await checked(
        db
          .from("vision_events")
          .select("entity_id,payload")
          .eq("owner", scope)
          .eq("kind", "wing_batch"),
      );
      for (const b of batches) {
        const rows: any = await checked(
          db
            .from("vision_events")
            .select("payload")
            .eq("owner", scope)
            .eq("entity_id", b.entity_id)
            .eq("kind", "wing_event")
            .order("created_at"),
        );
        const v = C.evaluate(
          { ...b.payload, events: rows.map((r: any) => r.payload) },
          Date.now(),
        );
        if (
          ["packed", "discarded", "cooled"].includes(v.status) ||
          !(v.status === "review" || (v.nextDue && Date.now() >= v.nextDue))
        )
          continue;
        const key =
          b.entity_id + ":" + v.status + ":" + (v.nextDue || "review");
        const claim = await db
          .from("vision_reminders")
          .insert({ workspace_id: scope, reminder_key: key });
        if (claim.error) {
          if (claim.error.code === "23505") continue;
          throw new AppError(502, "Reminder claim failed.");
        }
        let delivered = false;
        for (const sub of subscriptions.filter(
          (s: any) => s.workspace_id === scope,
        )) {
          const member: any = await checked(
            db
              .from("vision_memberships")
              .select("role")
              .eq("workspace_id", scope)
              .eq("user_id", sub.user_id)
              .maybeSingle(),
          );
          if (!member) continue;
          try {
            await webpush.sendNotification(
              sub.subscription,
              JSON.stringify({
                title: "Vision Kitchen · " + b.payload.name,
                body: v.title,
                tag: key,
                url: "/#wings",
              }),
              { TTL: 1800, urgency: "high", timeout: 10000 },
            );
            sent++;
            delivered = true;
          } catch (e: any) {
            failed++;
            if (e.statusCode === 404 || e.statusCode === 410)
              await db
                .from("vision_push_subscriptions")
                .delete()
                .eq("id", sub.id);
          }
        }
        if (!delivered)
          await db
            .from("vision_reminders")
            .delete()
            .eq("workspace_id", scope)
            .eq("reminder_key", key);
      }
    }
    return json({ status: "success", sent, failed });
  } catch (e) {
    return fail(e);
  }
}
