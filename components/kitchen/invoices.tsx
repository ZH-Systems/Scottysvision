"use client";
import React, { useEffect, useState } from "react";
import * as core from "@/lib/core/kitchen.mjs";
import { useKitchen } from "./provider";
import { Heading, Field, Modal, UnitSelect } from "./ui";
import { IngredientEditor } from "./ingredients";
import {
  uid,
  clone,
  money,
  unitMoney,
  date,
  readLocal,
  writeLocal,
} from "@/lib/local";
const C: any = core;
export function Invoices() {
  const { state, catalog, addEvent, request, notify } = useKitchen(),
    [draft, setDraft] = useState<any>(null),
    [view, setView] = useState<any>(null),
    [ingredient, setIngredient] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const list = state.events
    .filter((e: any) => e.kind === "invoice")
    .sort((a: any, b: any) => b.at - a.at);
  const patch = (k: string, v: any) => setDraft((x: any) => ({ ...x, [k]: v })),
    linePatch = (i: number, k: string, v: any) =>
      setDraft((x: any) => ({
        ...x,
        lines: x.lines.map((l: any, j: number) =>
          i === j ? { ...l, [k]: v } : l,
        ),
      }));
  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(
      () =>
        writeLocal("state", draft, "invoiceDraft").catch((e) =>
          notify(e.message),
        ),
      300,
    );
    return () => clearTimeout(t);
  }, [draft, notify]);
  async function open() {
    const old = await readLocal("state", "invoiceDraft");
    setDraft(
      old || {
        id: uid(),
        vendor: "",
        number: "",
        date: "",
        notes: "",
        attachments: [],
        lines: [],
      },
    );
    setError("");
  }
  async function attach(files: File[]) {
    setBusy(true);
    try {
      const attachments: any[] = [];
      for (const file of files) {
        if (
          ![
            "image/jpeg",
            "image/png",
            "image/webp",
            "application/pdf",
          ].includes(file.type) ||
          file.size > 16777216 ||
          !file.size
        )
          throw Error("Use JPEG, PNG, WebP or PDF under 16 MB.");
        const x = {
          id: uid(),
          name: file.name,
          type: file.type,
          size: file.size,
        };
        await writeLocal("files", { ...x, blob: file, synced: false });
        attachments.push(x);
      }
      setDraft((x: any) => ({
        ...x,
        attachments: [...x.attachments, ...attachments],
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      for (const l of draft.lines)
        for (const k of ["packages", "packQty", "netSubtotal", "tax"])
          C.numeric(l[k]);
      if (!draft.attachments.length && !draft.lines.length)
        throw Error("Attach a receipt or enter at least one line.");
      await addEvent("invoice", draft.id, draft);
      await writeLocal("state", null, "invoiceDraft");
      setDraft(null);
      notify("Invoice saved for review. Prices and stock are unchanged.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openFile(id: string) {
    try {
      const f = await readLocal("files", id);
      if (f?.blob) {
        const url = URL.createObjectURL(f.blob),
          a = document.createElement("a");
        a.href = url;
        a.download = f.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      } else {
        const r = await request("/api/files?id=" + encodeURIComponent(id));
        window.location.assign(r.url);
      }
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <>
      <Heading
        title="Capture now. Review clearly."
        sub="Use the S24 Ultra for receipt photos. Use either screen to check the details."
      >
        <button
          className="primary"
          onClick={() => open().catch((e) => notify(e.message))}
        >
          ＋ Invoice / receipt
        </button>
      </Heading>
      <p className="notice">
        Photos and drafts can be saved offline. No invoice amount, tax, category
        or ingredient cost is approved automatically. Keep the original
        receipts.
      </p>
      <div className="list">
        {list.length ? (
          list.map((e: any) => (
            <article className="panel list-item" key={e.id}>
              <div>
                <h3>{e.data.vendor || "Supplier not yet entered"}</h3>
                <small>
                  {e.data.number || "Invoice number unknown"} ·{" "}
                  {e.data.date || "Date unknown"}
                </small>
                <span className="tag warn">
                  {e.data.lines.length} lines · needs review
                </span>
                <small>
                  {e.data.attachments.length} attachments · saved {date(e.at)}
                </small>
              </div>
              <button onClick={() => setView(e)}>Review</button>
            </article>
          ))
        ) : (
          <section className="panel empty">
            Tomorrow’s invoices and receipts can start here.
          </section>
        )}
      </div>
      {draft && (
        <Modal
          onClose={() => {
            writeLocal("state", draft, "invoiceDraft").catch((e: Error) =>
              notify(e.message),
            );
            setDraft(null);
          }}
        >
          <h2>Invoice intake</h2>
          <p>Attach the original, then enter only what you can verify.</p>
          <form onSubmit={save}>
            <Field
              label="Supplier / vendor"
              name="vendor"
              value={draft.vendor}
              onChange={(e) => patch("vendor", e.target.value)}
            />
            <div className="row">
              <Field
                label="Invoice / receipt number"
                name="number"
                value={draft.number}
                onChange={(e) => patch("number", e.target.value)}
              />
              <Field
                label="Invoice date"
                name="invoiceDate"
                type="date"
                value={draft.date}
                onChange={(e) => patch("date", e.target.value)}
              />
            </div>
            <Field
              label="Take a photo on the phone"
              name="cameraPhoto"
              className="capture"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(e) => attach(Array.from(e.target.files || []))}
            />
            <Field
              label="Choose existing photos or PDFs"
              name="photos"
              className="capture"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              multiple
              onChange={(e) => attach(Array.from(e.target.files || []))}
            />
            <div className="file-list">
              {draft.attachments.map((f: any) => (
                <div className="file-row" key={f.id}>
                  <span>{f.name}</span>
                  <small>Saved locally</small>
                </div>
              ))}
            </div>
            <h3 style={{ marginTop: 24 }}>Ingredient lines</h3>
            {draft.lines.map((l: any, i: number) => (
              <section className="line" key={i}>
                <label>
                  Ingredient
                  <select
                    value={l.itemId}
                    onChange={(e) => linePatch(i, "itemId", e.target.value)}
                  >
                    <option value="">Unmapped / needs clarification</option>
                    {catalog
                      .filter((x: any) => x.active)
                      .map((x: any) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </select>
                </label>
                <Field
                  label="Description as printed"
                  name={"description-" + i}
                  value={l.description}
                  onChange={(e) => linePatch(i, "description", e.target.value)}
                />
                <div className="row">
                  <Field
                    label="Packages purchased"
                    name={"packages-" + i}
                    value={l.packages}
                    inputMode="decimal"
                    onChange={(e) => linePatch(i, "packages", e.target.value)}
                  />
                  <Field
                    label="Net amount in each package"
                    name={"packQty-" + i}
                    value={l.packQty}
                    inputMode="decimal"
                    onChange={(e) => linePatch(i, "packQty", e.target.value)}
                  />
                </div>
                <div className="row">
                  <UnitSelect
                    label="Package measure"
                    value={l.packUnit}
                    onChange={(v) => linePatch(i, "packUnit", v)}
                  />
                  <Field
                    label="Line subtotal before tax / after discounts"
                    name={"netSubtotal-" + i}
                    value={l.netSubtotal}
                    onChange={(e) =>
                      linePatch(i, "netSubtotal", e.target.value)
                    }
                  />
                </div>
                <div className="row">
                  <Field
                    label="Tax actually shown"
                    name={"tax-" + i}
                    value={l.tax}
                    onChange={(e) => linePatch(i, "tax", e.target.value)}
                  />
                  <label>
                    Category
                    <select
                      value={l.category}
                      onChange={(e) => linePatch(i, "category", e.target.value)}
                    >
                      {C.CATEGORIES.map((s: string) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>
            ))}
            <button
              type="button"
              onClick={() =>
                patch("lines", [
                  ...draft.lines,
                  {
                    itemId: "",
                    description: "",
                    packages: "",
                    packQty: "",
                    packUnit: "kg",
                    netSubtotal: "",
                    tax: "",
                    category: "Other / needs review",
                  },
                ])
              }
            >
              ＋ Add line
            </button>
            <label>
              Questions / missing details
              <textarea
                value={draft.notes}
                onChange={(e) => patch("notes", e.target.value)}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="actions">
              <button className="primary" disabled={busy}>
                Save intake for review
              </button>
            </div>
            <small>
              Saving intake does not update ingredient costs, inventory or
              Google Sheets.
            </small>
          </form>
        </Modal>
      )}
      {view && (
        <Modal onClose={() => setView(null)}>
          <h2>{view.data.vendor || "Invoice review"}</h2>
          <p>
            {view.data.number || "Number unknown"} ·{" "}
            {view.data.date || "Date unknown"}
          </p>
          <div className="actions">
            {view.data.attachments.map((f: any) => (
              <button key={f.id} onClick={() => openFile(f.id)}>
                {f.name}
              </button>
            ))}
          </div>
          {view.data.lines.map((l: any, i: number) => {
            let p: any = null;
            try {
              p = C.invoicePrice(l);
            } catch {}
            return (
              <section className="line" key={i}>
                <h3>
                  {l.description ||
                    catalog.find((x: any) => x.id === l.itemId)?.name ||
                    "Unmapped line"}
                </h3>
                <p>
                  {l.packages || "?"} packages × {l.packQty || "?"} {l.packUnit}
                </p>
                <p>
                  Candidate ingredient cost:{" "}
                  <b>
                    {p
                      ? unitMoney(p.cost) + " / " + p.baseUnit
                      : "Missing pack quantity / subtotal"}
                  </b>
                </p>
                <small>
                  Tax as entered:{" "}
                  {l.tax === "" ? "Unknown" : money(Number(l.tax))} ·{" "}
                  {l.category}
                </small>
                {p && l.itemId && (
                  <button
                    onClick={() => {
                      const x = catalog.find((x: any) => x.id === l.itemId);
                      if (!x) {
                        notify("Map this invoice to an existing ingredient.");
                        return;
                      }
                      setIngredient({
                        ...x,
                        cost: p.cost,
                        baseUnit: p.baseUnit,
                        basis: "Current",
                        costDate: view.data.date || "",
                        confirmed: false,
                      });
                      setView(null);
                    }}
                  >
                    Review this ingredient price
                  </button>
                )}
              </section>
            );
          })}
          <p>{view.data.notes}</p>
          <button
            onClick={() => {
              setDraft({ ...clone(view.data), id: uid(), reviews: view.id });
              setView(null);
            }}
          >
            Edit a review copy
          </button>
          <p className="muted">
            Invoice intake is evidence. Updating a cost requires a separate
            reviewed ingredient save.
          </p>
        </Modal>
      )}
      {ingredient && (
        <IngredientEditor
          item={ingredient}
          onClose={() => setIngredient(null)}
        />
      )}
    </>
  );
}
