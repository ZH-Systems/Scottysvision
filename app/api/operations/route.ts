import {
  identity,
  admin,
  checked,
  json,
  fail,
  body,
  cleanId,
  requireRole,
  AppError,
} from "@/lib/server";
import * as core from "@/lib/core/kitchen.mjs";
const C: any = core;
export async function GET(req: Request) {
  try {
    const u = await identity(req),
      db = admin();
    const [balances, operations, catalog]: any = await Promise.all([
      checked(
        db
          .from("vision_stock_balances")
          .select("*")
          .eq("workspace_id", u.scope),
      ),
      checked(
        db
          .from("vision_operations")
          .select("*")
          .eq("workspace_id", u.scope)
          .order("created_at", { ascending: false })
          .limit(100),
      ),
      checked(
        db
          .from("vision_ingredients")
          .select("ingredient_id,payload")
          .eq("owner", u.scope),
      ),
    ]);
    return json({
      status: "success",
      balances,
      operations,
      ingredients: catalog.map((x: any) => x.payload),
      role: u.role,
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request) {
  try {
    const u = await identity(req, true),
      x = await body(req, 100000),
      db = admin();
    if (x.kind !== "production") requireRole(u);
    const loc = String(x.location || "Kitchen")
      .trim()
      .slice(0, 120);
    if (!loc) throw new AppError(400, "Choose a location.");
    const ingredient = async (id: string) => {
      const row: any = await checked(
        db
          .from("vision_ingredients")
          .select("payload")
          .eq("owner", u.scope)
          .eq("ingredient_id", cleanId(id))
          .maybeSingle(),
      );
      if (!row) throw new AppError(400, "Ingredient is not synced.");
      return row.payload;
    };
    const saved = async (id: string, kind: string) => {
      const row: any = await checked(
        db
          .from("vision_events")
          .select("payload")
          .eq("owner", u.scope)
          .eq("event_id", cleanId(id))
          .eq("kind", kind)
          .maybeSingle(),
      );
      if (!row) throw new AppError(400, "Sync this record before posting.");
      return row.payload;
    };
    let kind = String(x.kind),
      id = cleanId(x.id),
      payload: any = { ...x },
      moves: any[] = [];
    const qty = (n: any) => {
      const v = C.numeric(n, false);
      if (!(v > 0)) throw new AppError(400, "Enter a positive quantity.");
      return v;
    };
    if (kind === "receipt" && x.invoiceEventId) {
      const invoice = await saved(x.invoiceEventId, "invoice");
      let root = x.invoiceEventId,
        prior = invoice;
      const seen = new Set<string>();
      while (prior.reviews) {
        if (seen.has(root) || seen.size > 50)
          throw new AppError(400, "Invoice review lineage is invalid.");
        seen.add(root);
        root = cleanId(prior.reviews);
        prior = await saved(root, "invoice");
      }
      id = "invoice:" + x.invoiceEventId;
      payload = {
        invoiceEventId: x.invoiceEventId,
        invoiceRoot: root,
        invoiceKey:
          invoice.vendor?.trim() && invoice.number?.trim()
            ? [
                invoice.vendor.trim().toLowerCase(),
                invoice.number.trim().toLowerCase(),
                invoice.date || "",
              ].join("::")
            : "root:" + root,
        location: loc,
        invoice,
      };
      if (!invoice.lines.length)
        throw new AppError(400, "Enter invoice lines before receiving stock.");
      for (const line of invoice.lines) {
        const item = await ingredient(line.itemId),
          price = C.invoicePrice(line),
          n = C.convert(
            qty(line.packages) * qty(line.packQty),
            line.packUnit,
            item.baseUnit,
            item,
          );
        if (!price || n === null || n <= 0)
          throw new AppError(
            400,
            "Review every invoice line and its measured conversion.",
          );
        moves.push({
          itemId: item.id,
          location: loc,
          unit: item.baseUnit,
          qty: n,
          unitCost: C.numeric(line.netSubtotal) / n,
        });
      }
    } else if (kind === "production") {
      const r = await saved(x.recipeEventId, "recipe");
      if (!r.finalized)
        throw new AppError(400, "Finalise the recipe before producing stock.");
      const batches = qty(x.batches);
      payload = { recipeEventId: x.recipeEventId, batches, location: loc, id };
      for (const line of r.recipe.lines) {
        const item = await ingredient(line.itemId),
          amount = C.convert(
            qty(line.qty) * batches,
            line.unit,
            item.baseUnit,
            item,
          );
        if (amount === null)
          throw new AppError(
            400,
            "A measured conversion is needed for " + item.name,
          );
        moves.push({
          itemId: item.id,
          location: loc,
          unit: item.baseUnit,
          qty: -amount,
          unitCost: item.confirmed ? item.cost : null,
        });
      }
      const yieldQty = qty(r.recipe.yieldQty) * batches;
      moves.push({
        itemId: "recipe:" + r.recipe.id,
        location: loc,
        unit: r.recipe.yieldUnit,
        qty: yieldQty,
        unitCost:
          r.productionSnapshot?.total != null
            ? (r.productionSnapshot.total * batches) / yieldQty
            : r.costingSnapshot.total != null
              ? (r.costingSnapshot.total * batches) / yieldQty
              : null,
      });
    } else if (kind === "transfer") {
      const item = await ingredient(x.itemId),
        n = qty(x.qty),
        destination = String(x.destination || "").trim();
      if (!destination || destination === loc)
        throw new AppError(400, "Choose a different destination.");
      moves = [
        {
          itemId: item.id,
          location: loc,
          unit: item.baseUnit,
          qty: -n,
          unitCost: item.confirmed ? item.cost : null,
        },
        {
          itemId: item.id,
          location: destination.slice(0, 120),
          unit: item.baseUnit,
          qty: n,
          unitCost: item.confirmed ? item.cost : null,
        },
      ];
    } else if (kind === "receipt") {
      const item = await ingredient(x.itemId),
        n = qty(x.qty);
      moves = [
        {
          itemId: item.id,
          location: loc,
          unit: item.baseUnit,
          qty: n,
          unitCost: C.numeric(x.unitCost),
        },
      ];
    } else if (kind === "adjustment") {
      const item = await ingredient(x.itemId);
      if (!String(x.reason || "").trim())
        throw new AppError(400, "A count adjustment needs a reason.");
      const target = C.numeric(x.qty, false);
      const bal: any = await checked(
        db
          .from("vision_stock_balances")
          .select("qty")
          .eq("workspace_id", u.scope)
          .eq("item_id", item.id)
          .eq("location", loc)
          .eq("unit", item.baseUnit)
          .maybeSingle(),
      );
      const delta = target - Number(bal?.qty || 0);
      if (delta === 0) return json({ status: "success", unchanged: true });
      payload = { ...payload, expectedBalance: Number(bal?.qty || 0) };
      moves = [
        {
          itemId: item.id,
          location: loc,
          unit: item.baseUnit,
          qty: delta,
          unitCost: item.confirmed ? item.cost : null,
        },
      ];
    } else if (kind === "reversal") {
      requireRole(u);
      const original = cleanId(x.operationId);
      id = "reverse:" + original;
      if (!String(x.reason || "").trim())
        throw new AppError(400, "Enter a reversal reason.");
      const rows: any = await checked(
        db
          .from("vision_stock_movements")
          .select("*")
          .eq("workspace_id", u.scope)
          .eq("operation_id", original),
      );
      if (
        !rows.length ||
        original.startsWith("reverse:") ||
        original.startsWith("void-waste:") ||
        original.startsWith("waste:")
      )
        throw new AppError(
          400,
          "Use a waste correction for waste movements, or select an unreversed stock operation.",
        );
      payload = { operationId: original, reason: x.reason };
      moves = rows.map((r: any) => ({
        itemId: r.item_id,
        location: r.location,
        unit: r.unit,
        qty: -Number(r.qty),
        unitCost: r.unit_cost,
      }));
    } else throw new AppError(400, "Unsupported stock operation.");
    const result = await checked(
      db.rpc("vision_apply_stock", {
        p_workspace: u.scope,
        p_actor: u.id,
        p_id: id,
        p_kind: kind,
        p_payload: payload,
        p_moves: moves,
      }),
    );
    return json(result);
  } catch (e) {
    return fail(e);
  }
}
