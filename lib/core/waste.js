"use strict";
const units = {
  g: { group: "mass", factor: 1, label: "g" },
  kg: { group: "mass", factor: 1000, label: "kg" },
  oz: { group: "mass", factor: 28.349523125, label: "oz (weight)" },
  lb: { group: "mass", factor: 453.59237, label: "lb" },
  mL: { group: "volume", factor: 1, label: "mL" },
  L: { group: "volume", factor: 1000, label: "L" },
  ea: { group: "count", factor: 1, label: "each" },
};
const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "id-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2);
const clone = (x) => JSON.parse(JSON.stringify(x));
function number(value, optional = false) {
  if (value === null || value === undefined || String(value).trim() === "") {
    if (optional) return null;
    throw Error("Enter an amount.");
  }
  const s = String(value).trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s))
    throw Error("Use a positive number, such as 250 or 0.5.");
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 1e9)
    throw Error("That number is outside the allowed range.");
  return n;
}
function text(value, label, max = 160) {
  const s = String(value ?? "").trim();
  if (!s || s.length > max)
    throw Error("Enter " + label + " (up to " + max + " characters).");
  return s;
}
function convert(q, from, to, item = {}) {
  const a = units[from],
    b = units[to];
  if (!a || !b) return null;
  const canonical = q * a.factor;
  if (a.group === b.group) return canonical / b.factor;
  const per = (group) =>
    group === "mass" ? item.gramsEach : group === "volume" ? item.mlEach : 1;
  if (a.group === "count" && per(b.group) > 0)
    return (canonical * per(b.group)) / b.factor;
  if (b.group === "count" && per(a.group) > 0)
    return canonical / per(a.group) / b.factor;
  return null; // No mass-to-volume assumption.
}
function price(item, q, unit) {
  const baseQty = convert(q, unit, item.baseUnit, item);
  const known =
    item.confirmed === true &&
    typeof item.cost === "number" &&
    Number.isFinite(item.cost) &&
    item.cost >= 0;
  const cost = known && baseQty !== null ? baseQty * item.cost : null;
  return {
    baseQty,
    cost,
    unitCost: cost === null ? null : cost / q,
    reason: !known
      ? "Price needs review"
      : baseQty === null
        ? "No conversion for this unit"
        : "",
  };
}
function makeRecord(input, item, employee, reason, now = Date.now()) {
  if (!item?.active) throw Error("Choose an active ingredient.");
  if (!employee?.active) throw Error("Choose an active employee.");
  if (!reason?.active) throw Error("Choose a waste reason.");
  const qty = number(input.qty);
  if (qty <= 0) throw Error("Amount must be greater than zero.");
  if (!units[input.unit]) throw Error("Choose a unit.");
  const calc = price(item, qty, input.unit);
  return {
    id: "W-" + uid(),
    at: now,
    enteredAt: now,
    employeeId: employee.id,
    employee: employee.name,
    itemId: item.id,
    itemName: item.name,
    visionId: item.visionId || "",
    reason: reason.name,
    qty,
    unit: input.unit,
    baseUnit: item.baseUnit,
    baseQty: calc.baseQty,
    unitCost: calc.unitCost,
    value: calc.cost,
    costBasis: calc.cost === null ? "Unpriced" : item.basis,
    costDate: item.costDate || "",
    priceSource: item.source || "",
    priceReviewed: !!item.confirmed,
    conversion: {
      gramsEach: item.gramsEach ?? null,
      mlEach: item.mlEach ?? null,
    },
    location: String(input.location || "")
      .trim()
      .slice(0, 120),
    notes: String(input.notes || "")
      .trim()
      .slice(0, 1000),
  };
}
function currentRecords(state) {
  const voided = new Set(state.voids.map((v) => v.recordId));
  return state.records.filter((r) => !voided.has(r.id));
}
function totals(records) {
  return {
    count: records.length,
    priced: records.filter((r) => r.value !== null).length,
    unpriced: records.filter((r) => r.value === null).length,
    value: records.reduce((sum, r) => sum + (r.value ?? 0), 0),
  };
}
function dateKey(at) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}
function dateTime(at) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(at));
}
function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[\s]*[=+@-]/.test(s) ? "'" + s : s;
  return '"' + safe.replace(/"/g, '""') + '"';
}
function csv(rows) {
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
const wasteHeaders = [
  "Waste ID",
  "Date / Time",
  "Ingredient / Recipe ID",
  "Item Name",
  "Waste Reason",
  "Qty",
  "UOM",
  "Unit Cost",
  "Waste Value",
  "Employee",
  "Photo Link",
  "Notes",
];
const inventoryHeaders = [
  "Transaction ID",
  "Date / Time",
  "Ingredient ID",
  "Transaction Type",
  "Qty",
  "UOM",
  "Unit Cost",
  "Value",
  "Reference ID",
  "Location",
  "Entered By",
  "Notes",
];
function exportRows(records, kind) {
  return [
    kind === "inventory"
      ? inventoryHeaders
      : kind === "vision"
        ? wasteHeaders
        : [
            "Waste ID",
            "Actual time (UTC)",
            "Toronto time",
            "Item ID",
            "Vision ID",
            "Item",
            "Employee",
            "Reason",
            "Qty",
            "UOM",
            "Unit cost CAD per entered UOM",
            "Waste value CAD",
            "Cost basis",
            "Cost date",
            "Price source",
            "Location",
            "Notes",
          ],
    ...records.map((r) => {
      const notes = [
        r.notes,
        r.visionId ? "" : "ID MAPPING REQUIRED: " + r.itemId,
        r.value === null
          ? "UNPRICED"
          : r.costBasis + "; cost date " + (r.costDate || "unknown"),
      ]
        .filter(Boolean)
        .join(" | ");
      if (kind === "vision")
        return [
          r.id,
          new Date(r.at).toISOString(),
          r.visionId,
          r.itemName,
          r.reason,
          r.qty,
          r.unit,
          r.unitCost,
          r.value,
          r.employee,
          "",
          notes,
        ];
      if (kind === "inventory") {
        const q = r.baseQty ?? r.qty,
          u = r.baseQty === null ? r.unit : r.baseUnit;
        return [
          "TX-" + r.id,
          new Date(r.at).toISOString(),
          r.visionId,
          "Waste",
          -q,
          u,
          r.value === null ? null : r.value / q,
          r.value === null ? null : -r.value,
          r.id,
          r.location,
          r.employee,
          notes + (r.baseQty === null ? " | UNIT CONVERSION REQUIRED" : ""),
        ];
      }
      return [
        r.id,
        new Date(r.at).toISOString(),
        dateTime(r.at),
        r.itemId,
        r.visionId,
        r.itemName,
        r.employee,
        r.reason,
        r.qty,
        r.unit,
        r.unitCost,
        r.value,
        r.costBasis,
        r.costDate,
        r.priceSource,
        r.location,
        r.notes,
      ];
    }),
  ];
}
// CSV numeric negatives must remain numbers for inventory deductions; neutralise formulas only in text cells.
function exportCSV(records, kind) {
  const rows = exportRows(records, kind);
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((v) => (typeof v === "number" ? String(v) : csvCell(v)))
          .join(","),
      )
      .join("\r\n")
  );
}
function parseCSV(source) {
  source = source.replace(/^\uFEFF/, "");
  let rows = [],
    row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') {
      if (field) throw Error("Unexpected quote in CSV.");
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw Error("CSV has an unclosed quote.");
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  if (rows.length < 2) throw Error("CSV needs a header and at least one item.");
  return rows;
}
function normalUnit(x) {
  const n = String(x || "")
    .trim()
    .toLowerCase();
  return (
    {
      g: "g",
      gram: "g",
      grams: "g",
      kg: "kg",
      kilogram: "kg",
      ml: "mL",
      l: "L",
      litre: "L",
      ea: "ea",
      each: "ea",
      "by each": "ea",
      oz: "oz",
      lb: "lb",
    }[n] || null
  );
}
function importCatalog(source) {
  const rows = parseCSV(source);
  const legacyHeader = rows.findIndex(
    (r) =>
      r.some((x) => x.trim().toLowerCase() === "product") &&
      r.some((x) => x.trim().toLowerCase() === "unit of measure"),
  );
  const legacy = legacyHeader >= 0;
  if (legacy) rows.splice(0, legacyHeader);
  const headers = rows.shift().map((x) => x.trim().toLowerCase());
  const idx = (...names) => {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const fields = {
    id: idx("id", "ingredient id"),
    name: idx("name", "ingredient name", "product"),
    unit: idx("base_unit", "recipe uom", "unit of measure"),
    cost: idx("cost_per_unit", "cost / recipe uom", "cost per recipe unit"),
    basis: idx("cost_basis"),
    date: idx("cost_date", "last purchase date"),
    active: idx("active"),
    grams: idx("grams_per_each"),
    ml: idx("ml_per_each"),
    vision: idx("vision_id"),
    category: idx("category", "product type"),
  };
  if (fields.name < 0 || fields.unit < 0)
    throw Error(
      "CSV needs name + base_unit, or Ingredient Name + Recipe UOM columns.",
    );
  if (rows.length > 5000) throw Error("Import up to 5,000 items at a time.");
  const seen = new Set();
  const imported = rows
    .map((r, index) => {
      if (
        legacy &&
        (!r[fields.name]?.trim() || /^\d+(\.\d+)?$/.test(r[fields.name].trim()))
      )
        return null;
      const name = text(r[fields.name], "an ingredient name");
      const unit = normalUnit(r[fields.unit]);
      if (!unit)
        throw Error(
          "Row " +
            (index + 2) +
            ": unknown unit. Use g, kg, mL, L, ea, oz or lb.",
        );
      const sourceRow = index + legacyHeader + 2;
      const id =
        legacy && legacyHeader === 1
          ? "VOS-MASTER-" + sourceRow
          : fields.id >= 0 && r[fields.id]?.trim()
            ? r[fields.id].trim()
            : "CSV-" + uid();
      if (seen.has(id)) throw Error("Duplicate ingredient ID: " + id);
      seen.add(id);
      const cost = fields.cost < 0 ? null : number(r[fields.cost], true);
      return {
        id,
        name,
        baseUnit: unit,
        cost,
        confirmed: false,
        basis:
          fields.basis >= 0 && r[fields.basis]?.trim()
            ? r[fields.basis].trim()
            : "Imported — review",
        costDate: fields.date >= 0 ? r[fields.date] || "" : "",
        category: fields.category >= 0 ? r[fields.category] || "" : "",
        active:
          fields.active < 0 ||
          !["no", "false", "0"].includes(
            String(r[fields.active]).trim().toLowerCase(),
          ),
        visionId:
          fields.vision >= 0
            ? r[fields.vision]?.trim() || ""
            : fields.id >= 0 && headers[fields.id] === "ingredient id"
              ? id
              : "",
        gramsEach: fields.grams < 0 ? null : number(r[fields.grams], true),
        mlEach: fields.ml < 0 ? null : number(r[fields.ml], true),
        source: "CSV import " + dateKey(Date.now()),
        package: legacy ? String(r[headers.indexOf("qty/item")] || "") : "",
        sourceRow: legacy ? sourceRow : null,
      };
    })
    .filter(Boolean);
  if (legacy) {
    const counts = {};
    for (const x of imported)
      counts[x.name.toLowerCase()] = (counts[x.name.toLowerCase()] || 0) + 1;
    for (const x of imported)
      if (counts[x.name.toLowerCase()] > 1)
        x.name +=
          " · " + (x.package || "pack size unknown") + " · r" + x.sourceRow;
  }
  return imported;
}
function validateStore(s) {
  if (
    !s ||
    s.schema !== 1 ||
    !Array.isArray(s.items) ||
    !Array.isArray(s.records) ||
    !Array.isArray(s.employees) ||
    !Array.isArray(s.reasons) ||
    !Array.isArray(s.voids)
  )
    throw Error("This is not a Scotty’s waste backup.");
  for (const list of [s.items, s.records, s.employees, s.reasons, s.voids]) {
    if (list.length > 100000) throw Error("Backup is too large.");
    const ids = new Set();
    for (const x of list) {
      if (!x || typeof x.id !== "string" || !x.id || ids.has(x.id))
        throw Error("Missing or duplicate ID in backup.");
      ids.add(x.id);
    }
  }
  for (const x of s.items) {
    text(x.name, "an ingredient name");
    if (
      !units[x.baseUnit] ||
      typeof x.active !== "boolean" ||
      typeof x.confirmed !== "boolean" ||
      (x.cost !== null &&
        (typeof x.cost !== "number" || !Number.isFinite(x.cost) || x.cost < 0))
    )
      throw Error("Invalid ingredient in backup.");
    for (const k of ["gramsEach", "mlEach"])
      if (
        x[k] != null &&
        (typeof x[k] !== "number" || !Number.isFinite(x[k]) || x[k] <= 0)
      )
        throw Error("Invalid conversion in backup.");
  }
  for (const x of [...s.employees, ...s.reasons]) {
    text(x.name, "a name");
    if (typeof x.active !== "boolean")
      throw Error("Invalid employee or reason.");
  }
  for (const r of s.records) {
    if (
      typeof r.at !== "number" ||
      !Number.isFinite(r.at) ||
      r.at <= 0 ||
      r.at > Date.now() + 60000 ||
      !units[r.unit] ||
      typeof r.qty !== "number" ||
      !Number.isFinite(r.qty) ||
      r.qty <= 0 ||
      typeof r.itemName !== "string" ||
      typeof r.employee !== "string"
    )
      throw Error("Invalid waste record.");
    for (const k of ["unitCost", "value", "baseQty"])
      if (
        r[k] !== null &&
        (typeof r[k] !== "number" || !Number.isFinite(r[k]) || r[k] < 0)
      )
        throw Error("Invalid cost or quantity in record.");
    if ((r.value === null) !== (r.unitCost === null))
      throw Error("Incomplete cost record.");
    if (
      r.value !== null &&
      Math.abs(r.value - r.qty * r.unitCost) > 0.000001 * Math.max(1, r.value)
    )
      throw Error("Inconsistent waste value.");
  }
  const recordIds = new Set(s.records.map((r) => r.id));
  for (const v of s.voids)
    if (
      !recordIds.has(v.recordId) ||
      typeof v.reason !== "string" ||
      !v.reason.trim() ||
      typeof v.at !== "number" ||
      !Number.isFinite(v.at)
    )
      throw Error("Invalid correction in backup.");
  return s;
}
function mergeBackup(current, incoming) {
  validateStore(incoming);
  const result = clone(current);
  for (const key of ["items", "employees", "reasons", "records", "voids"]) {
    const map = new Map(result[key].map((x) => [x.id, x]));
    for (const x of incoming[key]) {
      if (map.has(x.id)) {
        if (
          ["records", "voids"].includes(key) &&
          JSON.stringify(map.get(x.id)) !== JSON.stringify(x)
        )
          throw Error("Conflicting record ID. Nothing imported: " + x.id);
      } else {
        result[key].push(clone(x));
        map.set(x.id, x);
      }
    }
  }
  validateStore(result);
  return result;
}
export default {
  units,
  uid,
  clone,
  number,
  text,
  convert,
  price,
  makeRecord,
  currentRecords,
  totals,
  dateKey,
  dateTime,
  csv,
  exportCSV,
  parseCSV,
  importCatalog,
  validateStore,
  mergeBackup,
};
