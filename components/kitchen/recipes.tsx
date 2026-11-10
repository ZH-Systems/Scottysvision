"use client";
import React, { useState } from "react";
import { productionCost } from "@/lib/core/production.mjs";
import * as core from "@/lib/core/kitchen.mjs";
import { useKitchen } from "./provider";
import { Heading, Field, Modal, UnitSelect } from "./ui";
import { uid, clone, money, unitMoney, date } from "@/lib/local";
const C: any = core;
export function Recipes({
  onPost,
  initialEditing = false,
}: {
  onPost: (id: string) => void;
  initialEditing?: boolean;
}) {
  const { state, catalog, update, addEvent, notify } = useKitchen(),
    [editing, setEditing] = useState(initialEditing),
    [card, setCard] = useState<string | null>(null),
    [pick, setPick] = useState(false),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const r = state.draft,
    heads = C.currentRecipes(state.events);
  let cost: any = null,
    fullCost: any = null;
  try {
    if (r) {
      cost = C.recipeCost(r, catalog);
      fullCost = productionCost(r, catalog);
    }
  } catch (e) {
    cost = { error: (e as Error).message };
  }
  const patch = (key: string, value: any) =>
    update((s: any) => ({ ...s, draft: { ...s.draft, [key]: value } })).catch(
      (e: Error) => notify(e.message),
    );
  const linePatch = (i: number, key: string, value: any) =>
    update((s: any) => {
      s.draft.lines[i][key] = value;
      return s;
    }).catch((e: Error) => notify(e.message));
  async function fresh() {
    if (r) {
      setEditing(true);
      return;
    }
    await update((s: any) => ({
      ...s,
      draft: {
        id: uid(),
        name: "",
        type: "BatchRecipe",
        size: "Other / not pizza",
        yieldQty: "",
        yieldUnit: "ea",
        sellPrice: "",
        notes: "",
        lines: [],
        parentRevision: null,
      },
    }));
    setEditing(true);
    setCard(null);
  }
  async function finish(finalized: boolean) {
    setSaving(true);
    try {
      C.validateRecipe(r);
      const recipe = clone(r),
        parentRevision = recipe.parentRevision;
      delete recipe.parentRevision;
      const e = await addEvent("recipe", r.id, {
        recipe,
        costingSnapshot: C.recipeCost(r, catalog),
        productionSnapshot: productionCost(r, catalog),
        finalized,
        parentRevision,
      });
      await update((s: any) => ({ ...s, draft: null }));
      setEditing(false);
      setCard(e.id);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function edit(e: any) {
    if (r) {
      notify("Save or clear the working recipe before editing another.");
      return;
    }
    await update((s: any) => ({
      ...s,
      draft: { ...clone(e.data.recipe), parentRevision: e.id },
    }));
    setCard(null);
    setEditing(true);
  }
  if (card) {
    const e = state.events.find((e: any) => e.id === card);
    if (!e) return null;
    const x = e.data.recipe,
      c = e.data.costingSnapshot;
    return (
      <>
        <div className="actions no-print">
          <button onClick={() => setCard(null)}>← Recipes</button>
          <button onClick={() => window.print()}>Print card</button>
          <button onClick={() => edit(e)}>Edit a new revision</button>
          {e.data.finalized && (
            <button onClick={() => onPost(e.id)}>
              Review for Vision Sheets
            </button>
          )}
        </div>
        <article className="panel recipe-card">
          <div className="card-head">
            <div className="eyebrow">Scotty’s on King · Recipe card</div>
            <h1>{x.name}</h1>
            <p>
              {x.size} · {x.type} · {e.data.finalized ? "Finalised" : "Draft"}
            </p>
            <small>
              Saved {date(e.at)} · CAD · {e.id}
            </small>
          </div>
          <p>
            Yield:{" "}
            <b>
              {x.yieldQty || "Not measured"} {x.yieldQty ? x.yieldUnit : ""}
            </b>
          </p>
          <p>
            Selling price before tax:{" "}
            <b>
              {c.price == null
                ? "Not recorded"
                : money(c.price) + " / " + x.yieldUnit}
            </b>
          </p>
          <div className="scroll-table">
            <table>
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th>Amount</th>
                  <th>Cost basis</th>
                  <th>Ingredient cost</th>
                </tr>
              </thead>
              <tbody>
                {c.lines.map((l: any, i: number) => (
                  <tr key={i}>
                    <td>{l.name}</td>
                    <td>
                      {l.qty} {l.unit}
                    </td>
                    <td>
                      {l.basis}
                      <small>
                        {l.value === null
                          ? l.reason
                          : unitMoney(l.cost) + " / " + l.priceUnit}
                      </small>
                    </td>
                    <td>{money(l.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CostBar cost={c} unit={x.yieldUnit} />
          {e.data.productionSnapshot && (
            <ProductionCost cost={e.data.productionSnapshot} />
          )}
          {x.notes && (
            <>
              <h2>Method & notes</h2>
              <p className="notes">{x.notes}</p>
            </>
          )}
          <p className="muted">
            Cost snapshot retained. Ingredient margin excludes labour, overhead
            and tax.
          </p>
        </article>
      </>
    );
  }
  if (editing && r)
    return (
      <>
        <Heading
          title="What are we making?"
          sub="Costs update as you enter the amount. Staff can add ingredients one at a time."
        >
          <button onClick={() => setEditing(false)}>Recipe list</button>
        </Heading>
        <section className="panel">
          <Field
            label="Recipe / daily special name"
            name="recipeName"
            value={r.name}
            maxLength={160}
            onChange={(e) => patch("name", e.target.value)}
          />
          <div className="row">
            <Field
              label="Finished yield / number of portions"
              name="yieldQty"
              value={r.yieldQty}
              inputMode="decimal"
              onChange={(e) => patch("yieldQty", e.target.value)}
            />
            <UnitSelect
              label="Yield unit"
              value={r.yieldUnit}
              onChange={(v) => patch("yieldUnit", v)}
            />
          </div>
          <div className="row">
            <label>
              Pizza size / product
              <select
                value={r.size}
                onChange={(e) => patch("size", e.target.value)}
              >
                {C.PIZZA_SIZES.map((x: string) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <Field
              label="Selling price per yield unit, before tax"
              name="sellPrice"
              value={r.sellPrice}
              inputMode="decimal"
              onChange={(e) => patch("sellPrice", e.target.value)}
            />
          </div>
          <div className="row">
            <label>
              Recipe type
              <select
                value={r.type}
                onChange={(e) => patch("type", e.target.value)}
              >
                {[
                  "BatchRecipe",
                  "SubRecipe",
                  "PrepItem",
                  "Sauce",
                  "Dough",
                  "Blend",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Method / preparation notes
              <textarea
                value={r.notes}
                onChange={(e) => patch("notes", e.target.value)}
              />
            </label>
          </div>
          <details>
            <summary>Labour & overhead costing</summary>
            <div className="row">
              <Field
                label="Labour minutes per batch"
                name="labourMinutes"
                inputMode="decimal"
                value={r.labourMinutes ?? ""}
                onChange={(e) => patch("labourMinutes", e.target.value)}
              />
              <Field
                label="Actual hourly labour rate, CAD"
                name="labourRate"
                inputMode="decimal"
                value={r.labourRate ?? ""}
                onChange={(e) => patch("labourRate", e.target.value)}
              />
            </div>
            <Field
              label="Other overhead per batch, CAD"
              name="overheadPerBatch"
              inputMode="decimal"
              value={r.overheadPerBatch ?? ""}
              onChange={(e) => patch("overheadPerBatch", e.target.value)}
            />
            <p className="muted">
              Unknown costs stay blank. Enter zero explicitly when a component
              has no cost.
            </p>
          </details>
          <div className="toolbar">
            <h2>Ingredients</h2>
            <button onClick={() => setPick(true)}>＋ Add ingredient</button>
          </div>
          {r.lines.map((l: any, i: number) => {
            const item = catalog.find((x: any) => x.id === l.itemId);
            return (
              <section className="line" key={i}>
                <div className="line-top">
                  <strong>{item?.name || l.name}</strong>
                  <button
                    className="quiet danger"
                    onClick={() =>
                      patch(
                        "lines",
                        r.lines.filter((_: any, j: number) => j !== i),
                      )
                    }
                  >
                    ✕
                  </button>
                </div>
                <div className="row">
                  <Field
                    label="Amount used"
                    name={"qty-" + i}
                    value={l.qty}
                    inputMode="decimal"
                    onChange={(e) => linePatch(i, "qty", e.target.value)}
                  />
                  <UnitSelect
                    value={l.unit}
                    onChange={(v) => linePatch(i, "unit", v)}
                  />
                  <div className="line-price">
                    {money(cost?.lines?.[i]?.value)}
                  </div>
                </div>
                <small>{cost?.lines?.[i]?.reason}</small>
                <details>
                  <summary>Cost for this recipe only (optional)</summary>
                  <div className="row">
                    <Field
                      label="Cost per unit (CAD)"
                      name={"override-" + i}
                      value={l.overrideCost ?? ""}
                      onChange={(e) =>
                        linePatch(i, "overrideCost", e.target.value)
                      }
                    />
                    <UnitSelect
                      value={l.overrideUnit || l.unit}
                      onChange={(v) => linePatch(i, "overrideUnit", v)}
                    />
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!!l.overrideReviewed}
                      onChange={(e) =>
                        linePatch(i, "overrideReviewed", e.target.checked)
                      }
                    />
                    I checked this override and its unit.
                  </label>
                </details>
              </section>
            );
          })}
          <p className="saving">Draft saved locally as you type.</p>
          {(error || cost?.error) && (
            <p className="error" role="alert">
              {error || cost.error}
            </p>
          )}
          <div className="actions">
            <button
              className="primary accent"
              disabled={saving}
              onClick={() => finish(true)}
            >
              Finalise recipe card
            </button>
            <button disabled={saving} onClick={() => finish(false)}>
              Save draft revision
            </button>
            <button
              className="quiet danger"
              onClick={() => {
                if (
                  window.confirm(
                    "Clear this working draft? Saved revisions remain.",
                  )
                ) {
                  update((s: any) => ({ ...s, draft: null }));
                  setEditing(false);
                }
              }}
            >
              Clear working draft
            </button>
          </div>
        </section>
        {cost && !cost.error && (
          <>
            <CostBar cost={cost} unit={r.yieldUnit} />
            <ProductionCost cost={fullCost} />
          </>
        )}
        <p className="muted">
          Ingredient margin excludes labour, overhead, packaging not entered and
          tax. A blank cost never counts as zero.
        </p>
        {pick && (
          <Modal onClose={() => setPick(false)}>
            <h2>Add an ingredient</h2>
            <Field
              label="Search name"
              name="pickSearch"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {catalog
              .filter(
                (x: any) =>
                  x.active &&
                  x.name.toLowerCase().includes(search.toLowerCase()),
              )
              .slice(0, 40)
              .map((x: any) => (
                <button
                  className="search-result"
                  key={x.id}
                  onClick={() => {
                    patch("lines", [
                      ...r.lines,
                      {
                        itemId: x.id,
                        name: x.name,
                        qty: "",
                        unit: x.baseUnit,
                        overrideCost: "",
                        overrideUnit: x.baseUnit,
                        overrideReviewed: false,
                      },
                    ]);
                    setPick(false);
                  }}
                >
                  <span>
                    {x.name}
                    <small>
                      {x.confirmed
                        ? unitMoney(x.cost) + " / " + x.baseUnit
                        : "Price needs review"}
                    </small>
                  </span>
                  ＋
                </button>
              ))}
          </Modal>
        )}
      </>
    );
  return (
    <>
      <Heading
        title="Build while you cook."
        sub="Add the amount used. Reviewed ingredient prices do the costing."
      >
        <button className="primary" onClick={fresh}>
          ＋ New recipe
        </button>
      </Heading>
      {r && (
        <section className="panel">
          <div className="eyebrow">Work in progress</div>
          <h2>{r.name || "Untitled recipe"}</h2>
          <p>Saved on this device as you type.</p>
          <button className="primary" onClick={() => setEditing(true)}>
            Continue recipe
          </button>
        </section>
      )}
      <h2 style={{ marginTop: 28 }}>Saved recipes</h2>
      <div className="list">
        {heads.length ? (
          heads.flatMap((x: any) =>
            x.heads.map((e: any) => (
              <article className="panel list-item" key={e.id}>
                <div>
                  <h3>{e.data.recipe.name}</h3>
                  <small>
                    {e.data.recipe.size} · {date(e.at)}
                  </small>
                  <span
                    className={
                      "tag " + (e.data.costingSnapshot.complete ? "" : "warn")
                    }
                  >
                    {e.data.finalized ? "Finalised card" : "Draft"} ·{" "}
                    {money(e.data.costingSnapshot.total)}
                  </span>
                  {x.heads.length > 1 && (
                    <span className="tag warn">
                      Two device revisions, review both
                    </span>
                  )}
                </div>
                <div className="actions">
                  <button onClick={() => setCard(e.id)}>View card</button>
                  <button className="quiet" onClick={() => edit(e)}>
                    Edit copy
                  </button>
                </div>
              </article>
            )),
          )
        ) : (
          <section className="panel empty">
            Your recipe cards will appear here.
          </section>
        )}
      </div>
    </>
  );
}
function CostBar({ cost: c, unit }: { cost: any; unit: string }) {
  return (
    <div className="cost-bar">
      <span>
        <small>
          {c.complete
            ? "Ingredient cost / batch"
            : "Known subtotal · " + c.unpriced + " unpriced"}
        </small>
        <strong className={c.complete ? "" : "incomplete"}>
          {money(c.complete ? c.total : c.subtotal)}
          {c.complete ? "" : " + ?"}
        </strong>
      </span>
      <span>
        <small>Per {unit}</small>
        <strong>{c.perPortion === null ? "—" : money(c.perPortion)}</strong>
      </span>
      <span>
        <small>Ingredient margin</small>
        <strong>{c.margin === null ? "—" : c.margin.toFixed(1) + "%"}</strong>
      </span>
    </div>
  );
}

function ProductionCost({ cost: c }: { cost: any }) {
  return (
    <section className="panel">
      <h3>Full recorded production cost</h3>
      <p>
        Labour: {money(c.labourCost)} · Overhead: {money(c.overhead)} · Total
        per batch: <b>{money(c.total)}</b>
      </p>
      <p>
        Per yield unit: {money(c.perPortion)} · Margin after recorded production
        costs: {c.margin == null ? "Unknown" : c.margin.toFixed(1) + "%"}
      </p>
      <small>
        This covers entered costs. Unentered operating expenses, selling fees
        and tax are not assumed.
      </small>
    </section>
  );
}
