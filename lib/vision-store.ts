import { admin, checked, AppError } from "./server";
// Bounded adapter for the preserved posting planner, not a general SQL interpreter.
export function database() {
  return {
    prepare(sql: string) {
      let args: any[] = [];
      const execute = async () => {
        const db = admin();
        let q: any;
        if (
          sql.startsWith(
            "SELECT kind,entity_id,payload,created_at FROM vision_events",
          )
        )
          q = db
            .from("vision_events")
            .select("kind,entity_id,payload,created_at")
            .eq("owner", args[0])
            .eq("event_id", args[1])
            .maybeSingle();
        else if (
          sql.startsWith("SELECT kind,entity_id,payload FROM vision_events")
        ) {
          q = db
            .from("vision_events")
            .select("kind,entity_id,payload")
            .eq("owner", args[0])
            .in("kind", ["ingredient", "waste_void"])
            .order("created_at")
            .order("event_id");
          const rows: any = await checked(q);
          return {
            results: rows.map((r: any) => ({
              ...r,
              payload: JSON.stringify(r.payload),
            })),
          };
        } else if (sql.startsWith("SELECT status,result FROM vision_postings"))
          q = db
            .from("vision_postings")
            .select("status,result")
            .eq("key", args[0])
            .maybeSingle();
        else if (sql.startsWith("INSERT INTO vision_locks")) {
          await checked(
            db.rpc("vision_acquire_lock", {
              p_owner: args[0],
              p_token: args[1],
              p_now: args[3],
            }),
          );
          return {};
        } else if (sql.startsWith("SELECT token FROM vision_locks"))
          q = db
            .from("vision_locks")
            .select("token")
            .eq("owner", args[0])
            .maybeSingle();
        else if (sql.startsWith("INSERT INTO vision_postings"))
          q = db
            .from("vision_postings")
            .insert({
              key: args[0],
              owner: args[1],
              record_id: args[2],
              kind: args[3],
              hash: args[4],
              status: args[5],
              updated_at: args[6],
            });
        else if (sql.startsWith("UPDATE vision_postings SET status=?,result="))
          q = db
            .from("vision_postings")
            .update({
              status: args[0],
              result: JSON.parse(args[1]),
              updated_at: args[2],
            })
            .eq("key", args[3]);
        else if (sql.startsWith("UPDATE vision_postings SET status="))
          q = db
            .from("vision_postings")
            .update({ status: args[0], updated_at: args[1] })
            .eq("key", args[2]);
        else if (sql.startsWith("DELETE FROM vision_locks"))
          q = db
            .from("vision_locks")
            .delete()
            .eq("owner", args[0])
            .eq("token", args[1]);
        else throw new AppError(500, "Unsupported posting storage operation.");
        const value: any = await checked(q);
        return (
          value && {
            ...value,
            ...(value.payload
              ? { payload: JSON.stringify(value.payload) }
              : {}),
            ...(value.result ? { result: JSON.stringify(value.result) } : {}),
          }
        );
      };
      return {
        bind(...values: any[]) {
          args = values;
          return this;
        },
        first<T = any>(): Promise<T> {
          return execute() as Promise<T>;
        },
        all<T = any>(): Promise<{ results: T[] }> {
          return execute() as any;
        },
        run() {
          return execute();
        },
      };
    },
  };
}
