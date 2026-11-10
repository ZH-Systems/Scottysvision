import test from "node:test";
import assert from "node:assert/strict";
import W from "../lib/core/waste.js";
import G from "../lib/core/wings.js";
test("waste keeps original reviewed costs and excludes voids without deleting originals", () => {
  const r = W.makeRecord(
    { qty: "250", unit: "g", notes: "test" },
    {
      id: "flour",
      name: "Flour",
      active: true,
      baseUnit: "kg",
      cost: 12,
      confirmed: true,
      basis: "Current",
    },
    { id: "e", name: "Employee", active: true },
    { id: "r", name: "Spoilage", active: true },
    1000,
  );
  assert.equal(r.value, 3);
  assert.equal(r.qty, 250);
  const s = { records: [r], voids: [{ recordId: r.id }] };
  assert.equal(W.currentRecords(s).length, 0);
  assert.equal(s.records.length, 1);
  assert.match(W.exportCSV([r], "inventory"), /-0\.25/);
});
test("unknown prices are excluded from subtotal and measured conversion is required", () => {
  const x = { baseUnit: "kg", confirmed: false, cost: 12 };
  assert.equal(W.price(x, 2, "ea").cost, null);
  assert.equal(W.convert(1, "g", "mL"), null);
  assert.deepEqual(W.totals([{ value: null }, { value: 3 }]), {
    count: 2,
    priced: 1,
    unpriced: 1,
    value: 3,
  });
});
test("wing timeline preserves missed-deadline review and corrections", () => {
  const out = 1700000000000,
    make = (type, values = {}, at = out) =>
      G.event(type, { ...values, staff: "QA" }, at),
    batch = {
      id: "b",
      name: "Batch",
      createdAt: out,
      mode: "normal",
      trays: [{ id: "tray", label: "Tray 1" }],
      events: [
        make("oven_out"),
        make("cook_check", { tray: "tray", c: 75, held15: true }),
        make("cool_check", { tray: "tray", c: 19 }, out + G.HOUR),
        make("cool_check", { tray: "tray", c: 4 }, out + 4 * G.HOUR),
      ],
    };
  assert.equal(G.evaluate(batch, out + 4 * G.HOUR).allCold, true);
  const bad = {
    ...batch,
    events: [
      ...batch.events.slice(0, 2),
      make("cool_check", { tray: "tray", c: 19 }, out + 3 * G.HOUR),
      make("cool_check", { tray: "tray", c: 4 }, out + 5 * G.HOUR),
    ],
  };
  assert.equal(G.evaluate(bad, out + 5 * G.HOUR).status, "review");
  assert.ok(G.evaluate(bad, out + 5 * G.HOUR).reasons.length);
});
test("wing record conflict cannot silently overwrite an existing reading", () => {
  const e = G.event("raw_check", { c: 3 }, 1000),
    b = {
      id: "b",
      name: "B",
      createdAt: 1000,
      mode: "normal",
      trays: [{ id: "t", label: "Tray" }],
      events: [e],
    };
  assert.throws(() =>
    G.mergeStores(
      { schema: 1, batches: [b] },
      { schema: 1, batches: [{ ...b, events: [{ ...e, c: 4 }] }] },
    ),
  );
});
