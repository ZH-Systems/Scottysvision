"use client";
import React, { useState } from "react";
import * as core from "@/lib/core/kitchen.mjs";
import { useKitchen } from "./provider";
import { Heading, Field, Modal, UnitSelect } from "./ui";
import { uid, unitMoney, today, date, download } from "@/lib/local";
const C: any = core;
export function IngredientEditor({
  item,
  onClose,
}: {
  item?: any;
  onClose: () => void;
}) {
  const { addEvent, notify } = useKitchen(),
    [x, set] = useState<any>(
      item || {
        id: "LOCAL-" + uid(),
        name: "",
        baseUnit: "kg",
        cost: null,
        confirmed: false,
        basis: "Current",
        costDate: "",
        category: "Food",
        active: true,
        gramsEach: null,
        mlEach: null,
        visionId: "",
      },
    ),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const patch = (k: string, v: any) => set({ ...x, [k]: v });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const cost = C.numeric(x.cost),
        grams = C.numeric(x.gramsEach),
        ml = C.numeric(x.mlEach);
      if (!x.name.trim()) throw Error("Name the ingredient.");
      if (
        x.confirmed &&
        (cost === null ||
          !x.costDate ||
          x.costDate > today() ||
          x.basis === "Imported — review")
      )
        throw Error(
          "A reviewed price needs its checked-on date and a Current, Average or Manual basis.",
        );
      if (grams === 0 || ml === 0)
        throw Error("Measured conversions must be positive or blank.");
      await addEvent("ingredient", x.id, {
        ...x,
        name: x.name.trim(),
        cost,
        reorderPoint: C.numeric(x.reorderPoint),
        parLevel: C.numeric(x.parLevel),
        gramsEach: grams,
        mlEach: ml,
        source: x.source || "Manual review",
      });
      notify(
        "Ingredient saved. Existing recipe cards retain their original costs.",
      );
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal onClose={onClose}>
      <h2>{item ? "Review ingredient" : "New ingredient"}</h2>
      <form onSubmit={save}>
        <Field
          label="Ingredient name"
          name="itemName"
          value={x.name}
          maxLength={160}
          onChange={(e) => patch("name", e.target.value)}
        />
        <div className="row">
          <label>
            Category
            <select
              value={x.category}
              onChange={(e) => patch("category", e.target.value)}
            >
              {C.CATEGORIES.map((s: string) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <UnitSelect
            label="Cost unit"
            value={x.baseUnit}
            onChange={(v) => patch("baseUnit", v)}
          />
        </div>
        <div className="row">
          <Field
            label="Cost per cost unit, CAD"
            name="cost"
            value={x.cost ?? ""}
            inputMode="decimal"
            onChange={(e) => patch("cost", e.target.value)}
          />
          <Field
            label="Price checked on"
            name="costDate"
            type="date"
            value={x.costDate || ""}
            onChange={(e) => patch("costDate", e.target.value)}
          />
        </div>
        <label>
          Price basis
          <select
            value={x.basis}
            onChange={(e) => patch("basis", e.target.value)}
          >
            {["Current", "Average", "Manual", "Imported — review"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={x.confirmed}
            onChange={(e) => patch("confirmed", e.target.checked)}
          />
          I verified this price and its unit.
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={x.active}
            onChange={(e) => patch("active", e.target.checked)}
          />
          Show in staff ingredient dropdown
        </label>
        <details>
          <summary>Measured conversions & Vision mapping</summary>
          <div className="row">
            <Field
              label="Grams per each"
              name="gramsEach"
              value={x.gramsEach ?? ""}
              onChange={(e) => patch("gramsEach", e.target.value)}
            />
            <Field
              label="mL per each"
              name="mlEach"
              value={x.mlEach ?? ""}
              onChange={(e) => patch("mlEach", e.target.value)}
            />
          </div>
          <Field
            label="Approved Vision ingredient ID"
            name="visionId"
            value={x.visionId || ""}
            onChange={(e) => patch("visionId", e.target.value.trim())}
          />
          <small>
            Only enter measured conversions and a mapping to the same product.
          </small>
        </details>
        <details>
          <summary>Stock planning</summary>
          <div className="row">
            <Field
              label="Reorder point in cost units"
              name="reorderPoint"
              value={x.reorderPoint ?? ""}
              onChange={(e) => patch("reorderPoint", e.target.value)}
            />
            <Field
              label="Target par level in cost units"
              name="parLevel"
              value={x.parLevel ?? ""}
              onChange={(e) => patch("parLevel", e.target.value)}
            />
          </div>
        </details>
        <small className="source">Source: {x.source || "Manual entry"}</small>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button className="primary" disabled={saving}>
            Save ingredient locally
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function Ingredients() {
  const { state, catalog, request, update, notify } = useKitchen(),
    [q, setQ] = useState(""),
    [edit, setEdit] = useState<any>(null),
    [busy, setBusy] = useState(false);
  const list = catalog
    .filter((x: any) => x.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));
  async function refresh() {
    setBusy(true);
    try {
      const r = await request("/api/catalog");
      await update((s: any) => ({
        ...s,
        source: r.items,
        native: r.native,
        catalogAt: r.at,
      }));
      notify(
        "Live ingredient list read. Reviewed local prices remain in place.",
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="Know your ingredients."
        sub="Review the price and unit once. Future waste entries and recipes use that price."
      >
        <button className="primary" onClick={() => setEdit({})}>
          ＋ Ingredient
        </button>
      </Heading>
      <div className="actions">
        <button disabled={busy} onClick={refresh}>
          Refresh from Vision Sheets
        </button>
        <button
          className="quiet"
          onClick={() =>
            download("Scottys_Ingredient_Reviews_" + today() + ".json", {
              exportedAt: Date.now(),
              ingredients: catalog,
            })
          }
        >
          Export ingredient list
        </button>
      </div>
      <p className="notice">
        {state.catalogAt
          ? "Last live workbook read: " + date(state.catalogAt)
          : "Using the existing ingredient cache; prices need review."}{" "}
        A workbook refresh brings in source values. Reviewed local prices remain
        in place until you change them.
      </p>
      <Field
        label="Find an ingredient"
        name="ingSearch"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <p className="muted">
        {list.length} ingredients ·{" "}
        {catalog.filter((x: any) => x.confirmed).length} prices reviewed
      </p>
      <div className="list">
        {list.slice(0, 80).map((x: any) => (
          <article className="panel list-item" key={x.id}>
            <div>
              <h3>{x.name}</h3>
              <small>
                {unitMoney(x.cost)} / {x.baseUnit} · {x.basis}
              </small>
              <span className={"tag " + (x.confirmed ? "" : "warn")}>
                {x.confirmed ? "Price reviewed" : "Needs review"}
              </span>
              {!x.active && (
                <span className="tag warn">Hidden from staff list</span>
              )}
              <small>{x.visionId || "Vision ID pending approval"}</small>
            </div>
            <button onClick={() => setEdit(x)}>Review</button>
          </article>
        ))}
      </div>
      {list.length > 80 && (
        <p>Showing the first 80. Search to narrow the list.</p>
      )}
      {edit && (
        <IngredientEditor
          item={edit.id ? edit : undefined}
          onClose={() => setEdit(null)}
        />
      )}
    </>
  );
}
