import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const owner = "00000000-0000-4000-8000-000000000011",
  staff = "00000000-0000-4000-8000-000000000012",
  viewer = "00000000-0000-4000-8000-000000000013",
  outsider = "00000000-0000-4000-8000-000000000014";
test("forward migration, memberships, drafts and transactional stock", async (t) => {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated;insert into auth.users values('${owner}','owner@test.invalid'),('${staff}','staff@test.invalid'),('${viewer}','viewer@test.invalid'),('${outsider}','outside@test.invalid');`,
  );
  for (const file of [
    "20261110000000_vision_parity.sql",
    "20261110010000_shared_kitchens_and_operations.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  await db.query("select vision_bootstrap($1)", [owner]);
  const member = async (actor, email, role) =>
    db.query("select vision_set_member($1,$2,$3,$4)", [
      owner,
      actor,
      email,
      role,
    ]);
  const event = (id, kind, data, entityId = id) => ({
    id,
    kind,
    data,
    entityId,
    at: Date.now(),
    hash: id,
  });
  const sync = async (actor, events = [], drafts = []) =>
    (
      await db.query(
        "select vision_sync_workspace($1,$2,$3::jsonb,0,$4::jsonb,0,$5::jsonb) result",
        [owner, actor, JSON.stringify(events), "[]", JSON.stringify(drafts)],
      )
    ).rows[0].result;
  const stock = async (actor, id, kind, moves, payload = { id }) =>
    (
      await db.query(
        "select vision_apply_stock($1,$2,$3,$4,$5::jsonb,$6::jsonb) result",
        [
          owner,
          actor,
          id,
          kind,
          JSON.stringify(payload),
          JSON.stringify(moves),
        ],
      )
    ).rows[0].result;
  const movement = (qty, location = "Kitchen") => ({
    itemId: "flour",
    location,
    unit: "kg",
    qty,
    unitCost: 2,
  });
  await t.test(
    "only owner adds members and cannot demote the owner",
    async () => {
      await member(owner, "staff@test.invalid", "staff");
      await member(owner, "viewer@test.invalid", "viewer");
      await assert.rejects(member(staff, "outside@test.invalid", "manager"));
      await assert.rejects(member(owner, "owner@test.invalid", "remove"));
    },
  );
  await t.test(
    "viewer can pull but cannot log; staff cannot edit prices",
    async () => {
      assert.equal((await sync(viewer)).status, "success");
      await assert.rejects(sync(viewer, [event("v", "settings", {})]));
      await assert.rejects(
        sync(staff, [event("i", "ingredient", { name: "Flour" })]),
      );
      await assert.rejects(sync(outsider));
    },
  );
  await t.test(
    "concurrent draft branches remain separate; identical retries deduplicate",
    async () => {
      const draft = (revision, parentRevision = null) => ({
        key: "recipe:r",
        revision,
        parentRevision,
        at: Date.now(),
        payload: { kind: "recipe", value: { id: "r", name: revision } },
      });
      await sync(owner, [], [draft("a")]);
      await sync(staff, [], [draft("b", "a")]);
      const r = await sync(owner, [], [draft("c", "a")]);
      assert.deepEqual(r.drafts.map((d) => d.revision).sort(), ["b", "c"]);
      await sync(owner, [], [draft("c", "a")]);
      assert.equal(
        (await db.query("select count(*)::int n from vision_drafts")).rows[0].n,
        3,
      );
      await assert.rejects(
        sync(owner, [], [{ ...draft("c", "a"), payload: { changed: true } }]),
      );
    },
  );
  await t.test(
    "receipts are idempotent and staff cannot receive purchases",
    async () => {
      await stock(owner, "receipt", "receipt", [movement(10)]);
      assert.equal(
        (await stock(owner, "receipt", "receipt", [movement(10)]))
          .alreadyConfirmed,
        true,
      );
      await assert.rejects(stock(staff, "forbidden", "receipt", [movement(1)]));
      assert.equal(
        Number(
          (await db.query("select qty from vision_stock_balances")).rows[0].qty,
        ),
        10,
      );
    },
  );
  await t.test("failed transfers and production are atomic", async () => {
    await assert.rejects(
      stock(owner, "too-much", "transfer", [
        movement(-11),
        movement(11, "Cooler"),
      ]),
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from vision_operations where operation_id='too-much'",
        )
      ).rows[0].n,
      0,
    );
    await stock(staff, "produce", "production", [
      movement(-2),
      {
        itemId: "recipe:r",
        location: "Kitchen",
        unit: "ea",
        qty: 4,
        unitCost: 1,
      },
    ]);
    assert.equal(
      Number(
        (
          await db.query(
            "select qty from vision_stock_balances where item_id='flour'",
          )
        ).rows[0].qty,
      ),
      8,
    );
  });
  await t.test("count adjustment detects concurrent changes", async () => {
    await assert.rejects(
      stock(owner, "stale", "adjustment", [movement(2)], {
        expectedBalance: 7,
      }),
    );
    await stock(owner, "count", "adjustment", [movement(2)], {
      expectedBalance: 8,
    });
    assert.equal(
      Number(
        (
          await db.query(
            "select qty from vision_stock_balances where item_id='flour'",
          )
        ).rows[0].qty,
      ),
      10,
    );
  });
  await t.test(
    "waste and its correction affect Supabase stock exactly once",
    async () => {
      const waste = event(
        "waste-event",
        "waste",
        {
          id: "waste1",
          itemId: "flour",
          qty: 1,
          unit: "kg",
          baseUnit: "kg",
          baseQty: 1,
          value: 2,
          location: "Kitchen",
        },
        "waste1",
      );
      await sync(staff, [waste]);
      await sync(staff, [waste]);
      assert.equal(
        Number(
          (
            await db.query(
              "select qty from vision_stock_balances where item_id='flour'",
            )
          ).rows[0].qty,
        ),
        9,
      );
      await sync(staff, [
        event("void1", "waste_void", {
          recordId: "waste1",
          reason: "Wrong entry",
        }),
      ]);
      await sync(staff);
      assert.equal(
        Number(
          (
            await db.query(
              "select qty from vision_stock_balances where item_id='flour'",
            )
          ).rows[0].qty,
        ),
        10,
      );
    },
  );
  await t.test(
    "shared RLS permits a member and excludes outsiders",
    async () => {
      await db.exec(
        `set role authenticated;select set_config('request.jwt.claim.sub','${staff}',false);`,
      );
      assert.ok(
        (await db.query("select * from vision_stock_balances")).rows.length > 0,
      );
      await db.exec(
        `select set_config('request.jwt.claim.sub','${outsider}',false);`,
      );
      assert.equal(
        (await db.query("select * from vision_stock_balances")).rows.length,
        0,
      );
      await assert.rejects(
        db.query("select vision_apply_stock($1,$2,$3,$4,$5::jsonb,$6::jsonb)", [
          owner,
          outsider,
          "hack",
          "receipt",
          "{}",
          "[]",
        ]),
      );
      await db.exec("reset role;");
    },
  );
  await t.test('review copies cannot receive the same invoice twice until reversed',async()=>{const payload={invoiceRoot:'invoice-root',invoiceKey:'supplier::inv-1',revision:1};await stock(owner,'invoice-first','receipt',[movement(3)],payload);await assert.rejects(stock(owner,'invoice-copy','receipt',[movement(3)],{...payload,revision:2}));await stock(owner,'reverse:invoice-first','reversal',[movement(-3)],{operationId:'invoice-first',reason:'Correct invoice'});await stock(owner,'invoice-corrected','receipt',[movement(4)],{...payload,revision:2});});
  await t.test('existing historical waste is projected on the first workspace sync',async()=>{const e=event('legacy-waste','waste',{id:'old',itemId:'legacy',baseQty:2,baseUnit:'kg',qty:2,unit:'kg',value:4},'old');await db.query('select vision_sync($1,$2::jsonb,0)',[owner,JSON.stringify([e])]);await sync(owner);assert.equal(Number((await db.query("select qty from vision_stock_balances where item_id='legacy'")).rows[0].qty),-2);});
  await t.test('manager attestation records reconciliation without retrying a write',async()=>{await db.query("insert into vision_postings values('posting',$1,'event','sheets','hash','attempting',null,1)",[owner]);await assert.rejects(db.query('select vision_reconcile_posting($1,$2,$3,$4,true)',[owner,viewer,'posting','Checked actual rows']));await db.query('select vision_reconcile_posting($1,$2,$3,$4,true)',[owner,owner,'posting','Checked actual rows']);const r=(await db.query("select status,result from vision_postings where key='posting'")).rows[0];assert.equal(r.status,'confirmed');assert.equal(r.result.manuallyReconciled,true);});
  await t.test("removing a member revokes shared access", async () => {
    await member(owner, "staff@test.invalid", "remove");
    await assert.rejects(sync(staff));
  });
  await db.close();
});
