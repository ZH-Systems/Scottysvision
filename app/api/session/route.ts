import { identity, json, fail } from "@/lib/server";
export async function GET(req: Request) {
  try {
    const u = await identity(req);
    return json({
      status: "success",
      user: { id: u.id, name: u.user_metadata?.full_name || u.email },
    });
  } catch (e) {
    return fail(e);
  }
}
