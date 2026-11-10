import test from "node:test";
import assert from "node:assert/strict";
import {
  trackDraftChanges,
  prepareDrafts,
  acknowledgeDrafts,
} from "../lib/core/drafts.mjs";
import {
  productionCost,
  validateExtractedInvoice,
} from "../lib/core/production.mjs";
import {
  wasteBackup,
  wingsBackup,
  catalogTemplate,
} from "../lib/core/backups.mjs";
import W from "../lib/core/waste.js";
import G from "../lib/core/wings.js";
test("typing coalesces to one pending revision and closure is a tombstone", () => {
  let s = { deviceId: "d", draft: { id: "r", name: "one" } };
  s = trackDraftChanges(s, { ...s, draft: { id: "r", name: "two" } });
  s = trackDraftChanges(s, { ...s, draft: { id: "r", name: "three" } });
  assert.equal(Object.keys(s.draftDirty).length, 1);
  s = prepareDrafts(s, () => "revision", 10);
  assert.equal(s.draftOutbox.length, 1);
  const after = trackDraftChanges(s, { ...s, draft: null });
  assert.equal(after.draftDirty["recipe:r"].value, null);
  const ack = acknowledgeDrafts(after, s.draftOutbox, []);
  assert.equal(ack.draftOutbox.length, 0);
  assert.equal(ack.draftDirty["recipe:r"].value, null);
});
test("full cost preserves unknown labour and overhead rather than zeroing them", () => {
  const catalog = [
      { id: "i", name: "I", baseUnit: "kg", cost: 10, confirmed: true },
    ],
    r = {
      lines: [{ itemId: "i", qty: "1", unit: "kg" }],
      yieldQty: "2",
      sellPrice: "20",
      labourMinutes: "30",
      labourRate: "20",
      overheadPerBatch: "4",
    };
  const c = productionCost(r, catalog);
  assert.equal(c.total, 24);
  assert.equal(c.perPortion, 12);
  assert.equal(c.margin, 40);
  assert.equal(productionCost({ ...r, labourRate: "" }, catalog).total, null);
});
test("OCR normalization leaves unknown values empty and flags arithmetic inconsistencies", () => {
  const r = validateExtractedInvoice({
    vendor: "Vendor",
    subtotal: 10,
    tax: 1,
    total: 50,
    lines: [{ description: "Flour", netSubtotal: 8 }],
  });
  assert.equal(r.warnings.length, 2);
  assert.equal(r.lines[0].packages, "");
  assert.equal(r.lines[0].packUnit, "");
  assert.equal(r.lines[0].itemId, "");
  assert.throws(() =>
    validateExtractedInvoice({ lines: [{ netSubtotal: "-3" }] }),
  );
});
test("standalone exports remain compatible with both original logger validators", () => {
  const state = {
    events: [],
    wasteSettings: { lastEmployee: "e", location: "Kitchen" },
    wingSound: true,
    wingStaff: "QA",
  };
  W.validateStore(wasteBackup(state, []));
  G.validateStore(wingsBackup(state));
  assert.ok(catalogTemplate.includes("grams_per_each"));
});
