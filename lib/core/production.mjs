import { recipeCost, numeric } from "./kitchen.mjs";
export function productionCost(recipe, catalog) {
  const ingredients = recipeCost(recipe, catalog),
    minutes = numeric(recipe.labourMinutes),
    rate = numeric(recipe.labourRate),
    overhead = numeric(recipe.overheadPerBatch),
    labour = minutes === null || rate === null ? null : (minutes / 60) * rate,
    total =
      ingredients.total === null || labour === null || overhead === null
        ? null
        : ingredients.total + labour + overhead,
    perPortion =
      total !== null && ingredients.yieldQty > 0
        ? total / ingredients.yieldQty
        : null;
  return {
    labourMinutes: minutes,
    labourRate: rate,
    labourCost: labour,
    overhead,
    total,
    perPortion,
    margin:
      perPortion !== null && ingredients.price > 0
        ? ((ingredients.price - perPortion) / ingredients.price) * 100
        : null,
  };
}
export function validateExtractedInvoice(input) {
  const x = input?.invoice || input;
  if (
    !x ||
    typeof x !== "object" ||
    !Array.isArray(x.lines) ||
    x.lines.length > 200
  )
    throw Error("OCR did not return a valid invoice.");
  const nullable = (v) =>
    v === null || v === undefined || v === "" ? "" : String(numeric(v));
  const lines = x.lines.map((l) => ({
    itemId: "",
    description: String(l.description || "").slice(0, 300),
    packages: nullable(l.packages),
    packQty: nullable(l.packQty),
    packUnit: ["g", "kg", "mL", "L", "ea", "oz", "lb"].includes(l.packUnit)
      ? l.packUnit
      : "",
    netSubtotal: nullable(l.netSubtotal),
    tax: nullable(l.tax),
    category: "Other / needs review",
  }));
  const total = nullable(x.total),
    subtotal = nullable(x.subtotal),
    tax = nullable(x.tax),
    warnings = [];
  if (
    total !== "" &&
    subtotal !== "" &&
    tax !== "" &&
    Math.abs(Number(total) - Number(subtotal) - Number(tax)) > 0.02
  )
    warnings.push("Subtotal plus tax does not match the stated total.");
  if (
    subtotal !== "" &&
    lines.every((l) => l.netSubtotal !== "") &&
    Math.abs(
      lines.reduce((n, l) => n + Number(l.netSubtotal), 0) - Number(subtotal),
    ) > 0.02
  )
    warnings.push("Line subtotals do not match the invoice subtotal.");
  return {
    vendor: String(x.vendor || "").slice(0, 200),
    number: String(x.number || "").slice(0, 100),
    date: /^\d{4}-\d{2}-\d{2}$/.test(x.date || "") ? x.date : "",
    notes: String(x.notes || "").slice(0, 2000),
    total,
    subtotal,
    tax,
    lines,
    warnings,
  };
}
