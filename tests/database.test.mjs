import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const A = "00000000-0000-4000-8000-000000000001",
  B = "00000000-0000-4000-8000-000000000002";
let db;
test("Postgres parity schema, atomic sync, pagination, locks and row isolation", async (t) => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated;insert into auth.users values('${A}'),('${B}');`,
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261110000000_vision_parity.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const rpc = async (owner, events, since = 0) =>
    (
      await db.query("select public.vision_sync($1,$2::jsonb,$3) as value", [
        owner,
        JSON.stringify(events),
        since,
      ])
    ).rows[0].value;
  const event = (
    id,
    kind = "settings",
    data = { employees: [], reasons: [] },
  ) => ({ id, kind, entityId: id, at: 100, data, hash: "hash-" + id });
  await t.test(
    "stores full payload and identical retry acknowledges without duplication",
    async () => {
      const e = event("one");
      const a = await rpc(A, [e]);
      assert.deepEqual(a.ack, ["one"]);
      assert.equal(a.events[0].data.reasons.length, 0);
      await rpc(A, [e]);
      assert.equal(
        (await db.query("select count(*)::int n from vision_events")).rows[0].n,
        1,
      );
    },
  );
  await t.test("conflicting batch rolls back every insert", async () => {
    await assert.rejects(
      rpc(A, [
        event("new-before-conflict"),
        { ...event("one"), hash: "changed" },
      ]),
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from vision_events where event_id='new-before-conflict'",
        )
      ).rows[0].n,
      0,
    );
  });
  await t.test(
    "all eight record categories have reporting coverage",
    async () => {
      await rpc(A, [
        event("ingredient", "ingredient", {
          name: "Flour",
          baseUnit: "kg",
          cost: 2,
          confirmed: true,
        }),
        event("waste", "waste", { id: "waste", qty: 2, value: 4 }),
        event("void", "waste_void", {
          recordId: "waste",
          reason: "Correction",
        }),
        event("batch", "wing_batch", { name: "Wings", trays: [] }),
        event("reading", "wing_event", { type: "raw_check", c: 3 }),
        event("recipe", "recipe", {
          recipe: { name: "Test" },
          costingSnapshot: { total: 4 },
        }),
        event("invoice", "invoice", { attachments: [], lines: [] }),
      ]);
      for (const name of [
        "ingredients",
        "waste",
        "waste_voids",
        "wing_batches",
        "wing_events",
        "recipe_revisions",
        "invoices",
        "settings",
      ])
        assert.ok(
          (await db.query("select count(*)::int n from vision_" + name)).rows[0]
            .n > 0,
        );
      assert.equal(
        (await db.query("select voided from vision_waste")).rows[0].voided,
        true,
      );
    },
  );
  await t.test("pagination never drops the 501st record", async () => {
    for (let offset = 0; offset < 520; offset += 40)
      await rpc(
        B,
        Array.from({ length: Math.min(40, 520 - offset) }, (_, i) =>
          event("b-" + (offset + i)),
        ),
      );
    const first = await rpc(B, []);
    assert.equal(first.events.length, 500);
    assert.equal(first.more, true);
    const next = await rpc(B, [], first.cursor);
    assert.equal(next.events.length, 20);
    assert.equal(next.more, false);
    assert.equal(
      new Set([...first.events, ...next.events].map((e) => e.id)).size,
      520,
    );
  });
  await t.test(
    "reference catalog is backed up, newer source wins, reviewed overlay wins",
    async () => {
      const item = {
        id: "source-only",
        name: "Cached flour",
        baseUnit: "kg",
        cost: 2,
        confirmed: false,
      };
      const sync = async (at, name) =>
        (
          await db.query(
            "select vision_sync($1,$2::jsonb,0,$3::jsonb,$4) result",
            [A, "[]", JSON.stringify([{ ...item, name }]), at],
          )
        ).rows[0].result;
      assert.equal((await sync(10, "Live flour")).catalog.length, 1);
      assert.equal(
        (await sync(0, "Stale cache")).catalog[0].name,
        "Live flour",
      );
      assert.equal(
        (
          await db.query(
            "select name from vision_ingredients where ingredient_id='source-only'",
          )
        ).rows[0].name,
        "Live flour",
      );
      await rpc(A, [
        {
          ...event("review", "ingredient", {
            ...item,
            name: "Reviewed flour",
            confirmed: true,
          }),
          entityId: "source-only",
        },
      ]);
      assert.equal(
        (
          await db.query(
            "select name from vision_ingredients where ingredient_id='source-only'",
          )
        ).rows[0].name,
        "Reviewed flour",
      );
    },
  );
  await t.test(
    "RLS and invoker views do not expose another owner; writes/RPC denied",
    async () => {
      await db.exec(
        `set role authenticated;select set_config('request.jwt.claim.sub','${A}',false);`,
      );
      const rows = await db.query("select distinct owner from vision_events");
      assert.deepEqual(
        rows.rows.map((x) => x.owner),
        [A],
      );
      const view = await db.query("select distinct owner from vision_settings");
      assert.deepEqual(
        view.rows.map((x) => x.owner),
        [A],
      );
      await assert.rejects(
        db.query("select public.vision_sync($1,$2::jsonb,0)", [B, "[]"]),
      );
      await assert.rejects(db.exec("delete from vision_events"));
      await db.exec("reset role;");
    },
  );
  await t.test(
    "workbook lock requires release or expiry and token is retained",
    async () => {
      const get = async (token, now) =>
        (
          await db.query("select vision_acquire_lock($1,$2,$3) result", [
            "workbook",
            token,
            now,
          ])
        ).rows[0].result;
      assert.equal(await get("a", 1), true);
      assert.ok(!(await get("b", 2)));
      assert.equal(await get("c", 180002), true);
      assert.equal(
        (
          await db.query(
            "select token from vision_locks where owner='workbook'",
          )
        ).rows[0].token,
        "c",
      );
    },
  );
  await db.close();
});
