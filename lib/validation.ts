import { AppError, cleanId, canonical } from "./server";
import * as core from "./core/kitchen.mjs";
import WingCore from "./core/wings.js";
const C: any = core,
  W: any = WingCore;
export function validateEvent(e: any) {
  if (
    !e ||
    ![
      "waste",
      "waste_void",
      "wing_event",
      "wing_batch",
      "recipe",
      "ingredient",
      "invoice",
      "settings",
    ].includes(e.kind)
  )
    throw new AppError(400, "Unknown record type.");
  cleanId(e.id);
  cleanId(e.entityId);
  if (!Number.isSafeInteger(e.at) || e.at < 1 || e.at > Date.now() + 60000)
    throw new AppError(400, "Check the device clock.");
  if (
    !e.data ||
    typeof e.data !== "object" ||
    Array.isArray(e.data) ||
    canonical(e.data).length > 180000
  )
    throw new AppError(400, "Invalid or oversized record.");
  const d = e.data,
    positive = (v: any) => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (
    e.kind === "waste" &&
    (!positive(d.qty) ||
      !C.UNITS[d.unit] ||
      typeof d.itemId !== "string" ||
      !d.employee?.trim() ||
      (d.value !== null && (!Number.isFinite(d.value) || d.value < 0)))
  )
    throw new AppError(400, "Invalid waste record.");
  if (
    e.kind === "ingredient" &&
    (!d.name?.trim() ||
      !C.UNITS[d.baseUnit] ||
      typeof d.active !== "boolean" ||
      typeof d.confirmed !== "boolean" ||
      (d.cost !== null && (!Number.isFinite(d.cost) || d.cost < 0)))
  )
    throw new AppError(400, "Invalid ingredient.");
  if (e.kind === "recipe") {
    try {
      C.validateRecipe(d.recipe);
      if (
        !d.costingSnapshot ||
        !Array.isArray(d.costingSnapshot.lines) ||
        d.costingSnapshot.lines.length !== d.recipe.lines.length
      )
        throw Error();
    } catch {
      throw new AppError(400, "Invalid recipe revision.");
    }
  }
  if (
    e.kind === "invoice" &&
    (!Array.isArray(d.lines) || !Array.isArray(d.attachments))
  )
    throw new AppError(400, "Invalid invoice.");
  if (e.kind === "waste_void" && (!d.recordId || !d.reason?.trim()))
    throw new AppError(400, "Invalid waste correction.");
  if (e.kind === "wing_batch") {
    try {
      W.validateStore({
        schema: 1,
        batches: [{ ...d, events: [], round: null }],
      });
    } catch {
      throw new AppError(400, "Invalid wing batch.");
    }
  }
  if (e.kind === "wing_event") {
    const types = [
      "dry_start",
      "dry_end",
      "raw_check",
      "cook_start",
      "oven_out",
      "cook_check",
      "cook_batch_check",
      "cooler_in",
      "cool_check",
      "packed",
      "note",
      "void",
      "clock_fix",
      "discarded",
    ];
    if (
      !d.id ||
      !types.includes(d.type) ||
      !Number.isSafeInteger(d.at) ||
      !Number.isSafeInteger(d.enteredAt) ||
      d.at < 1 ||
      d.at > Date.now() + 60000
    )
      throw new AppError(400, "Invalid wing reading.");
    if (
      ["raw_check", "cook_check", "cook_batch_check", "cool_check"].includes(
        d.type,
      ) &&
      (!Number.isFinite(d.c) || d.c < -40 || d.c > 120)
    )
      throw new AppError(400, "Invalid wing temperature.");
    if (
      ["cook_check", "cook_batch_check"].includes(d.type) &&
      typeof d.held15 !== "boolean"
    )
      throw new AppError(400, "Missing cook confirmation.");
    if (["cook_check", "cool_check"].includes(d.type) && !d.tray)
      throw new AppError(400, "Missing tray.");
    if (d.type === "void" && (!d.ref || !d.reason))
      throw new AppError(400, "Invalid correction.");
    if (
      d.type === "clock_fix" &&
      (!Number.isSafeInteger(d.valueAt) || !d.reason)
    )
      throw new AppError(400, "Invalid clock correction.");
  }
  if (e.kind === "settings" && e.entityId === "waste-lists") {
    for (const list of [d.employees, d.reasons])
      if (
        !Array.isArray(list) ||
        list.length > 10000 ||
        list.some(
          (x: any) =>
            !x.id ||
            typeof x.name !== "string" ||
            typeof x.active !== "boolean",
        )
      )
        throw new AppError(400, "Invalid employee or reason list.");
  }

  return { id: e.id, kind: e.kind, entityId: e.entityId, at: e.at, data: d };
}
