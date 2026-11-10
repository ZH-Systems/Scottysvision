import {
  identity,
  admin,
  checked,
  json,
  fail,
  body,
  AppError,
} from "@/lib/server";
export async function POST(req: Request) {
  try {
    const u = await identity(req, true),
      x = await body(req, 20000),
      db = admin();
    if (x.mode === "remove") {
      await checked(
        db
          .from("vision_push_subscriptions")
          .delete()
          .eq("user_id", u.id)
          .eq("endpoint", String(x.endpoint)),
      );
      return json({ status: "success" });
    }
    const sub = x.subscription;
    if (
      !sub ||
      !/^https:\/\//.test(sub.endpoint) ||
      !sub.keys?.p256dh ||
      !sub.keys?.auth
    )
      throw new AppError(400, "Invalid push subscription.");
    const endpoint = new URL(sub.endpoint);
    const allowed = [
      "fcm.googleapis.com",
      "updates.push.services.mozilla.com",
      "web.push.apple.com",
      "notify.windows.com",
    ];
    if (
      !allowed.some(
        (host) =>
          endpoint.hostname === host || endpoint.hostname.endsWith("." + host),
      )
    )
      throw new AppError(400, "Unsupported push delivery host.");
    await checked(
      db.from("vision_push_subscriptions").upsert(
        {
          workspace_id: u.scope,
          user_id: u.id,
          endpoint: sub.endpoint,
          subscription: sub,
        },
        { onConflict: "user_id,endpoint" },
      ),
    );
    return json({ status: "success" });
  } catch (e) {
    return fail(e);
  }
}
