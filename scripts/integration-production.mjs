// Real Next route handlers + PostgreSQL, with local HTTP doubles for external services.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateVAPIDKeys } from "web-push";
import { PGlite } from "@electric-sql/pglite";
const vapid = generateVAPIDKeys();
const owner = "00000000-0000-4000-8000-000000000021",
  staff = "00000000-0000-4000-8000-000000000022",
  viewer = "00000000-0000-4000-8000-000000000023";
const people = {
  owner: { id: owner, email: "owner@test.invalid" },
  staff: { id: staff, email: "staff@test.invalid" },
  viewer: { id: viewer, email: "viewer@test.invalid" },
};
const db = new PGlite();
await db.exec(
  `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
);
for (const p of Object.values(people))
  await db.query("insert into auth.users values($1,$2)", [p.id, p.email]);
for (const f of [
  "20261110000000_vision_parity.sql",
  "20261110010000_shared_kitchens_and_operations.sql",
])
  await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
const files = new Map();
let extractionCalls = 0,
  verificationCalls = 0;
const reply = (res, status, data, type = "application/json") => {
  res.writeHead(status, { "Content-Type": type });
  res.end(type === "application/json" ? JSON.stringify(data) : data);
};
const identifier = (s) => {
  if (!/^[a-z_][a-z_0-9]*$/.test(s)) throw Error("Invalid test SQL identifier");
  return '"' + s + '"';
};
const mock = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost"),
      raw = await Array.fromAsync(req).then((b) => Buffer.concat(b)),
      body = raw.length ? JSON.parse(raw) : {};
    if (url.pathname === "/auth/v1/user") {
      const u = people[req.headers.authorization?.replace("Bearer ", "")];
      return reply(
        res,
        u ? 200 : 401,
        u
          ? {
              ...u,
              aud: "authenticated",
              role: "authenticated",
              user_metadata: {},
            }
          : { message: "Invalid token" },
      );
    }
    if (url.pathname === "/extract") {
      extractionCalls++;
      assert.ok(body.file.base64);
      return reply(res, 200, {
        text: "Flour 2 bags of 5 kg subtotal 20 tax 0 total 20",
        invoice: {
          vendor: "Supplier",
          number: "INV-1",
          date: "2026-11-09",
          subtotal: 20,
          tax: 0,
          total: 20,
          lines: [
            {
              description: "Flour",
              packages: 2,
              packQty: 5,
              packUnit: "kg",
              netSubtotal: 20,
              tax: 0,
            },
          ],
        },
      });
    }
    if (url.pathname === "/verify") {
      verificationCalls++;
      return reply(res, 200, { invoice: body.invoice });
    }
    if (
      url.pathname.startsWith("/storage/v1/object/") &&
      !url.pathname.includes("/sign/")
    ) {
      const key = decodeURIComponent(
        url.pathname.split("/vision-attachments/")[1] || "",
      );
      const bytes = files.get(key);
      return bytes
        ? reply(res, 200, bytes, "image/png")
        : reply(res, 404, { message: "Not found" });
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const f = url.pathname.split("/").at(-1),
        args = Object.entries(body);
      const r = await db.query(
        "select " +
          identifier(f) +
          "(" +
          args.map(([k], i) => identifier(k) + " := $" + (i + 1)).join(",") +
          ") value",
        args.map(([, v]) =>
          v && typeof v === "object" ? JSON.stringify(v) : v,
        ),
      );
      return reply(res, 200, r.rows[0].value);
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.split("/").at(-1);
      if (!table.startsWith("vision_")) throw Error("Invalid table");
      const params = [],
        where = [];
      for (const [k, v] of url.searchParams) {
        if (v.startsWith("eq.")) {
          params.push(v.slice(3));
          where.push(identifier(k) + "=$" + params.length);
        }
        if (v.startsWith("in.(")) {
          const values = v.slice(4, -1).split(",");
          params.push(values);
          where.push(identifier(k) + "=any($" + params.length + "::uuid[])");
        }
      }
      const filter = where.length ? " where " + where.join(" and ") : "";
      if (req.method === "GET") {
        let select = url.searchParams.get("select") || "*";
        select =
          select === "*" ? "*" : select.split(",").map(identifier).join(",");
        let sql = "select " + select + " from " + identifier(table) + filter;
        const order = url.searchParams.get("order");
        if (order) {
          sql +=
            " order by " +
            order
              .split(",")
              .map((o) => {
                const [k, d] = o.split(".");
                return identifier(k) + (d === "desc" ? " desc" : " asc");
              })
              .join(",");
        }
        if (url.searchParams.has("limit"))
          sql +=
            " limit " + Math.min(5000, Number(url.searchParams.get("limit")));
        const r = await db.query(sql, params);
        return reply(
          res,
          200,
          req.headers.accept?.includes("vnd.pgrst.object")
            ? r.rows[0] || null
            : r.rows,
        );
      }
      if (req.method === "PATCH") {
        const fields = Object.entries(body),
          offset = params.length;
        const sql =
          "update " +
          identifier(table) +
          " set " +
          fields
            .map(([k], i) => identifier(k) + "=$" + (offset + i + 1))
            .join(",") +
          filter;
        await db.query(sql, [...params, ...fields.map(([, v]) => v)]);
        return reply(res, 200, []);
      }
      if (req.method === "POST") {
        const fields = Object.entries(body),
          sql =
            "insert into " +
            identifier(table) +
            "(" +
            fields.map(([k]) => identifier(k)).join(",") +
            ") values(" +
            fields.map((_, i) => "$" + (i + 1)).join(",") +
            ")";
        await db.query(
          sql,
          fields.map(([, v]) =>
            v && typeof v === "object" ? JSON.stringify(v) : v,
          ),
        );
        return reply(res, 201, []);
      }
      if (req.method === "DELETE") {
        await db.query("delete from " + identifier(table) + filter, params);
        return reply(res, 200, []);
      }
    }
    reply(res, 404, { message: "Unhandled fixture " + url.pathname });
  } catch (e) {
    reply(res, 400, {
      code: e.code || "P0001",
      message: e.message,
      details: null,
      hint: null,
    });
  }
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockUrl = "http://127.0.0.1:" + mock.address().port,
  port = 3012,
  base = "http://127.0.0.1:" + port;
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    env: {
      ...process.env,
      SUPABASE_URL: mockUrl,
      SUPABASE_ANON_KEY: "fixture-anon",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
      VISION_ALLOWED_EMAILS: "",
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: "mailto:test@example.invalid",
      CRON_SECRET: "fixture-cron-secret",
      VISION_OCR_API_URL: mockUrl + "/extract",
      VISION_VERIFY_API_URL: mockUrl + "/verify",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(output)), 20000),
      read = (b) => {
        output += b;
        if (output.includes("Ready in")) {
          clearTimeout(timer);
          resolve();
        }
      };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(Error("Next exited " + code + " " + output));
    });
  });
  const api = async (
    path,
    { actor = "owner", method = "GET", data, scope = owner } = {},
  ) => {
    const r = await fetch(base + "/api/" + path, {
      method,
      headers: {
        Authorization: "Bearer " + actor,
        Origin: base,
        "X-Vision-Workspace": scope,
        "Content-Type": "application/json",
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const b = await r.json();
    return { status: r.status, ...b };
  };
  assert.equal((await api("workspaces")).status, "success");
  assert.equal(
    (
      await api("workspaces", {
        method: "POST",
        data: { email: "staff@test.invalid", role: "staff" },
      })
    ).status,
    "success",
  );
  assert.equal(
    (
      await api("workspaces", {
        method: "POST",
        data: { email: "viewer@test.invalid", role: "viewer" },
      })
    ).status,
    "success",
  );
  const ingredient = {
    id: "flour",
    name: "Flour",
    baseUnit: "kg",
    cost: 2,
    confirmed: true,
    active: true,
    category: "Food",
    costDate: "2026-11-09",
    basis: "Current",
  };
  const event = {
    id: "ingredient-event",
    entityId: "flour",
    kind: "ingredient",
    at: Date.now(),
    data: ingredient,
  };
  const draft = {
    key: "recipe:r",
    revision: "draft-1",
    parentRevision: null,
    at: Date.now(),
    payload: { kind: "recipe", value: { id: "r", name: "Draft" } },
  };
  let s = await api("sync", {
    method: "POST",
    data: { events: [event], since: 0, catalog: [], drafts: [draft] },
  });
  assert.equal(s.status, "success", JSON.stringify(s));
  assert.equal(s.drafts.length, 1);
  s = await api("sync", {
    actor: "staff",
    method: "POST",
    data: { events: [], since: 0, drafts: [] },
  });
  assert.equal(s.events[0].id, "ingredient-event");
  assert.equal(s.drafts[0].payload.value.name, "Draft");
  assert.equal(
    (
      await api("sync", {
        actor: "staff",
        method: "POST",
        data: { events: [{ ...event, id: "forbidden" }], since: 0 },
      })
    ).status,
    "error",
  );
  assert.equal(
    (
      await api("sync", {
        actor: "viewer",
        method: "POST",
        data: { events: [], since: 0 },
      })
    ).status,
    "success",
  );
  const op = {
    id: "receipt-1",
    kind: "receipt",
    itemId: "flour",
    location: "Kitchen",
    qty: "10",
    unitCost: "2",
  };
  assert.equal(
    (await api("operations", { method: "POST", data: op })).status,
    "success",
  );
  assert.equal(
    (await api("operations", { method: "POST", data: op })).alreadyConfirmed,
    true,
  );
  assert.equal(
    Number((await api("operations", { actor: "staff" })).balances[0].qty),
    10,
  );
  assert.equal(
    (await api("operations", { actor: "viewer", method: "POST", data: op }))
      .status,
    "error",
  );
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    key = owner + "/file1/hash";
  files.set(key, png);
  await db.query("insert into vision_files values($1,$2,$3,$4,$5,$6,$7,$8)", [
    key,
    owner,
    "file1",
    "receipt.png",
    "image/png",
    png.length,
    "hash",
    Date.now(),
  ]);
  const ocr = await api("ocr", { method: "POST", data: { fileId: "file1" } });
  assert.equal(ocr.status, "success", JSON.stringify(ocr));
  assert.equal(ocr.invoice.lines[0].netSubtotal, "20");
  assert.equal(ocr.requiresReview, true);
  assert.equal(extractionCalls, 1);
  assert.equal(verificationCalls, 1);
  const invoice = {
    id: "invoice1",
    vendor: "Supplier",
    number: "INV-1",
    date: "2026-11-09",
    attachments: [],
    lines: [
      {
        itemId: "flour",
        description: "Flour",
        packages: "2",
        packQty: "5",
        packUnit: "kg",
        netSubtotal: "20",
        tax: "0",
        category: "Food",
      },
    ],
  };
  await api("sync", {
    method: "POST",
    data: {
      events: [
        {
          id: "invoice-event",
          entityId: "invoice1",
          kind: "invoice",
          at: Date.now(),
          data: invoice,
        },
      ],
      since: 0,
    },
  });
  const receipt = await api("operations", {
    method: "POST",
    data: { id: "receive", kind: "receipt", invoiceEventId: "invoice-event" },
  });
  assert.equal(receipt.status, "success", JSON.stringify(receipt));
  assert.equal(
    (
      await api("operations", {
        method: "POST",
        data: {
          id: "receive",
          kind: "receipt",
          invoiceEventId: "invoice-event",
        },
      })
    ).alreadyConfirmed,
    true,
  );
  const reminderResponse = await fetch(base + "/api/cron/reminders", {
    headers: { Authorization: "Bearer fixture-cron-secret" },
  });
  assert.equal(reminderResponse.status, 200, await reminderResponse.text());
  console.log(
    "PASS configured route integration: verified Auth, shared-member access, permissions, draft round trip, stock receipt idempotency, real OCR + verifier HTTP contracts, invoice approval-to-stock. No production services were modified.",
  );
} finally {
  if (child.exitCode === null) {
    const exit = once(child, "exit");
    child.kill("SIGTERM");
    await exit;
  }
  await new Promise((r) => mock.close(r));
  await db.close();
}
