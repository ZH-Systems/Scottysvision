import {
  authenticate,
  identity,
  admin,
  checked,
  json,
  fail,
  body,
  requireRole,
  AppError,
} from "@/lib/server";
export async function GET(req: Request) {
  try {
    const u = await authenticate(req),
      db = admin();
    await checked(db.rpc("vision_bootstrap", { p_user: u.id }));
    const members: any = await checked(
      db
        .from("vision_memberships")
        .select("workspace_id,role")
        .eq("user_id", u.id),
    );
    const spaces: any = await checked(
      db
        .from("vision_workspaces")
        .select("*")
        .in(
          "id",
          members.map((m: any) => m.workspace_id),
        ),
    );
    return json({
      status: "success",
      workspaces: spaces.map((s: any) => ({
        ...s,
        role: members.find((m: any) => m.workspace_id === s.id).role,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request) {
  try {
    const u = await identity(req, true);
    requireRole(u, "owner");
    const x = await body(req, 10000),
      db = admin();
    if (x.mode === "rename") {
      if (typeof x.name !== "string" || !x.name.trim() || x.name.length > 100)
        throw new AppError(400, "Enter a kitchen name.");
      await checked(
        db
          .from("vision_workspaces")
          .update({ name: x.name.trim() })
          .eq("id", u.scope),
      );
    } else
      await checked(
        db.rpc("vision_set_member", {
          p_scope: u.scope,
          p_actor: u.id,
          p_email: String(x.email || ""),
          p_role: String(x.role || ""),
        }),
      );
    return json({ status: "success" });
  } catch (e) {
    return fail(e);
  }
}
