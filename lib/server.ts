import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function config() {
  return {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    anon:
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "",
    service: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
}
export function admin() {
  const c = config();
  if (!c.url || !c.service)
    throw new AppError(
      503,
      "Supabase is not configured. Local entries remain saved.",
    );
  return createClient(c.url, c.service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function authenticate(req: Request, write = false) {
  if (write) {
    const target = new URL(req.url);
    // Next may normalize Request.url to localhost behind its Node/Vercel adapter.
    // Host is the destination requested by the browser, not a submitted owner ID.
    const host = req.headers.get("host");
    const origin = req.headers.get("origin");
    if (
      origin !== target.origin &&
      (!host || origin !== target.protocol + "//" + host)
    )
      throw new AppError(403, "Open Vision in its own tab.");
  }
  const token = req.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!token)
    throw new AppError(401, "Sign in from Sync to back up this device.");
  const c = config();
  if (!c.url || !c.anon) throw new AppError(503, "Supabase is not configured.");
  const { data, error } = await createClient(c.url, c.anon, {
    auth: { persistSession: false },
  }).auth.getUser(token);
  if (error || !data.user)
    throw new AppError(401, "Your session expired. Sign in again.");
  const allowed = (process.env.VISION_ALLOWED_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length && !allowed.includes(data.user.email?.toLowerCase() || ""))
    throw new AppError(
      403,
      "This account is not permitted to use this kitchen.",
    );
  return data.user;
}
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export function fail(e: unknown) {
  console.error(e instanceof Error ? e.message : "Unconfirmed request");
  return json(
    {
      status: "error",
      message:
        e instanceof AppError
          ? e.message
          : "The operation could not be confirmed. Your local records remain saved.",
    },
    e instanceof AppError ? e.status : 500,
  );
}
export async function body(req: Request, limit = 2500000) {
  const raw = await req.text();
  if (raw.length > limit) throw new AppError(413, "Send fewer entries.");
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError(400, "Invalid JSON.");
  }
}
export function cleanId(x: unknown) {
  if (typeof x !== "string" || !/^[-A-Za-z0-9_.:]{1,220}$/.test(x))
    throw new AppError(400, "Invalid record ID.");
  return x;
}
export function canonical(x: any): string {
  if (x === null || typeof x === "boolean" || typeof x === "string")
    return JSON.stringify(x);
  if (typeof x === "number") {
    if (!Number.isFinite(x)) throw new AppError(400, "Invalid number.");
    return JSON.stringify(x);
  }
  if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
  if (x && typeof x === "object")
    return (
      "{" +
      Object.keys(x)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
        .join(",") +
      "}"
    );
  throw new AppError(400, "Unsupported record value.");
}
export async function hash(x: string | ArrayBuffer) {
  return createHash("sha256")
    .update(typeof x === "string" ? x : Buffer.from(x))
    .digest("hex");
}
export async function checked<T>(
  query: PromiseLike<{ data: T; error: any }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) {
    const status =
      error.code === "42501"
        ? 403
        : error.code === "23505" || error.code === "P0001"
          ? 409
          : 502;
    throw new AppError(
      status,
      ["42501", "23505", "P0001"].includes(error.code)
        ? String(error.message || "This operation needs review.").slice(0, 400)
        : "Supabase could not confirm this operation. Check the migration and configuration.",
    );
  }
  return data;
}
export const bucketName = () =>
  process.env.SUPABASE_STORAGE_BUCKET || "vision-attachments";

export const roleLevel: Record<string, number> = {
  viewer: 0,
  staff: 1,
  manager: 2,
  owner: 3,
};
export function requireRole(user: { role: string }, minimum = "manager") {
  if ((roleLevel[user.role] ?? -1) < roleLevel[minimum])
    throw new AppError(403, minimum + " permission is required.");
}
export async function identity(req: Request, write = false, minimum = "staff") {
  const u = await authenticate(req, write),
    db = admin(),
    scope = req.headers.get("x-vision-workspace") || u.id;
  if (!/^[0-9a-f-]{36}$/i.test(scope))
    throw new AppError(400, "Invalid kitchen.");
  if (scope === u.id)
    await checked(db.rpc("vision_bootstrap", { p_user: u.id }));
  const membership: any = await checked(
    db
      .from("vision_memberships")
      .select("role")
      .eq("workspace_id", scope)
      .eq("user_id", u.id)
      .maybeSingle(),
  );
  if (!membership)
    throw new AppError(403, "You are not a member of this kitchen.");
  const result = { ...u, scope, role: membership.role as string };
  if (write) requireRole(result, minimum);
  return result;
}
