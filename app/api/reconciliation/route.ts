import {
  identity,
  requireRole,
  admin,
  checked,
  body,
  json,
  fail,
  AppError,
} from "@/lib/server";
export async function GET(req: Request) {
  try {
    const u = await identity(req);
    requireRole(u);
    const rows = await checked(
      admin()
        .from("vision_postings")
        .select("*")
        .eq("owner", u.scope)
        .neq("status", "confirmed")
        .order("updated_at", { ascending: false }),
    );
    return json({ status: "success", postings: rows });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request) {
  try {
    const u = await identity(req, true);
    requireRole(u);
    const x = await body(req, 10000);
    if (
      typeof x.key !== "string" ||
      typeof x.note !== "string" ||
      x.note.trim().length < 10
    )
      throw new AppError(
        400,
        "Enter the posting key and a reconciliation note of at least 10 characters.",
      );
    if (x.mode === "confirmed" && x.confirmed !== true)
      throw new AppError(
        400,
        "Confirm that the actual workbook rows were checked.",
      );
    await checked(
      admin().rpc("vision_reconcile_posting", {
        p_workspace: u.scope,
        p_actor: u.id,
        p_key: x.key,
        p_note: x.note.trim(),
        p_confirm: x.mode === "confirmed",
      }),
    );
    return json({ status: "success" });
  } catch (e) {
    return fail(e);
  }
}
