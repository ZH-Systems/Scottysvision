"use client";
import React, { useMemo, useState } from "react";
import WasteCore from "@/lib/core/waste.js";
import { useKitchen } from "./provider";
import { IngredientEditor } from "./ingredients";
import { Modal, Field } from "./ui";
import { wasteStyles } from "./module-styles";
import { uid, money, date, download, today } from "@/lib/local";
const C: any = WasteCore,
  defaultReasons = [
    "Spoilage",
    "Overproduction",
    "Expired",
    "Dropped / damaged",
    "Quality reject",
    "Staff meal",
    "Customer return",
  ].map((name, i) => ({ id: "reason-" + i, name, active: true }));
export function Waste() {
  const { state, catalog, addEvent, addEvents, notify, backup, importBackup } =
      useKitchen(),
    [view, setView] = useState("log"),
    [step, setStep] = useState("choose"),
    [form, setForm] = useState<any>({
      employee: "",
      item: "",
      reason: "",
      qty: "",
      unit: "g",
      location: "",
      notes: "",
    }),
    [search, setSearch] = useState(""),
    [saved, setSaved] = useState<any>(null),
    [error, setError] = useState(""),
    [manager, setManager] = useState<string | null>(null),
    [edit, setEdit] = useState<any>(null),
    [person, setPerson] = useState<any>(null),
    [correct, setCorrect] = useState<any>(null),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [filterEmployee, setFilterEmployee] = useState(""),
    [saving, setSaving] = useState(false),
    [csvPreview, setCsvPreview] = useState<any[] | null>(null);
  const latest = state.events
      .filter((e: any) => e.kind === "settings" && e.entityId === "waste-lists")
      .sort(
        (a: any, b: any) => b.at - a.at || b.id.localeCompare(a.id),
      )[0]?.data,
    employees = latest?.employees || [],
    reasons = latest?.reasons || defaultReasons;
  const voided = new Set(
    state.events
      .filter((e: any) => e.kind === "waste_void")
      .map((e: any) => e.data.recordId),
  );
  const records = state.events
      .filter((e: any) => e.kind === "waste")
      .map((e: any) => e.data)
      .filter((r: any) => !voided.has(r.id))
      .sort((a: any, b: any) => b.at - a.at),
    list = records.filter(
      (r: any) =>
        (!from || C.dateKey(r.at) >= from) &&
        (!to || C.dateKey(r.at) <= to) &&
        (!filterEmployee || r.employeeId === filterEmployee),
    ),
    totals = C.totals(list),
    item = catalog.find((x: any) => x.id === form.item);
  let price: any = { cost: null, reason: "Choose an ingredient" };
  try {
    if (item && Number(form.qty) > 0)
      price = C.price(item, C.number(form.qty), form.unit);
  } catch {}
  const patch = (k: string, v: any) => setForm({ ...form, [k]: v });
  function next() {
    if (!employees.some((x: any) => x.id === form.employee && x.active))
      throw Error("Choose an employee.");
    if (!item?.active) throw Error("Choose an ingredient.");
    if (!reasons.some((x: any) => x.id === form.reason && x.active))
      throw Error("Choose a reason.");
    setStep("amount");
    setError("");
  }
  function key(k: string) {
    let s = form.qty;
    if (k === "clear") s = "";
    else if (k === "back") s = s.slice(0, -1);
    else if (k === "." && !s.includes(".")) s = (s || "0") + ".";
    else if (/^\d$/.test(k) && s.length < 14) s += k;
    patch("qty", s);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (step === "choose") {
        next();
        return;
      }
      const r = C.makeRecord(
        form,
        item,
        employees.find((x: any) => x.id === form.employee),
        reasons.find((x: any) => x.id === form.reason),
      );
      await addEvent("waste", r.id, r, r.at, "waste:" + r.id);
      setSaved(r);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function savePerson(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (!person.name.trim()) throw Error("Enter a name.");
      const list = person.kind === "employees" ? employees : reasons,
        next = [
          ...list.filter((x: any) => x.id !== person.id),
          {
            id: person.id || uid(),
            name: person.name.trim(),
            active: person.active,
          },
        ];
      await addEvent("settings", "waste-lists", {
        employees: person.kind === "employees" ? next : employees,
        reasons: person.kind === "reasons" ? next : reasons,
      });
      setPerson(null);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  const run = (fn: () => void | Promise<void>) => {
    try {
      Promise.resolve(fn()).catch((e) => {
        setError(e.message);
        notify(e.message);
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <style>{wasteStyles}</style>
      <div className="waste-module logger-surface" data-waste-step={step}>
        <header className="top">
          <div className="top-inner">
            <div className="brand">
              <div className="brand-mark">S</div>
              <div>
                SCOTTY’S<small>WASTE LOG</small>
              </div>
            </div>
            <nav>
              <button
                className={view === "log" ? "selected" : "quiet"}
                onClick={() => {
                  setView("log");
                  setSaved(null);
                }}
              >
                Log waste
              </button>
              <button
                className={view === "records" ? "selected" : "quiet"}
                onClick={() => setView("records")}
              >
                Records
              </button>
              <button className="quiet" onClick={() => setManager("items")}>
                Manage
              </button>
            </nav>
          </div>
        </header>
        <main>
          {view === "log" && !saved && (
            <>
              <div className="intro">
                <div>
                  <div className="eyebrow">
                    {step === "choose" ? "Scotty’s on King" : "Step 2 of 2"}
                  </div>
                  <h1>{step === "choose" ? "Choose the item." : item?.name}</h1>
                  <p>
                    {step === "choose"
                      ? "Step 1 of 2 · Employee, ingredient and reason."
                      : "Enter the amount wasted."}
                  </p>
                </div>
                <span className="pill">Saved on this device</span>
              </div>
              <form onSubmit={save}>
                <div className="entry-grid">
                  <section className="panel choices">
                    <label className="field">
                      Employee
                      <select
                        value={form.employee}
                        onChange={(e) => patch("employee", e.target.value)}
                      >
                        <option value="">Who is recording?</option>
                        {employees
                          .filter((x: any) => x.active)
                          .map((x: any) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="field">
                      Find an ingredient
                      <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Type a few letters (optional)"
                      />
                    </label>
                    <label className="field">
                      Ingredient or item
                      <select
                        value={form.item}
                        onChange={(e) => {
                          const x = catalog.find(
                            (x: any) => x.id === e.target.value,
                          );
                          setForm({
                            ...form,
                            item: e.target.value,
                            unit: x?.baseUnit || "g",
                          });
                        }}
                      >
                        <option value="">Choose an ingredient</option>
                        {catalog
                          .filter(
                            (x: any) =>
                              x.active &&
                              x.name
                                .toLowerCase()
                                .includes(search.toLowerCase()),
                          )
                          .sort((a: any, b: any) =>
                            a.name.localeCompare(b.name),
                          )
                          .map((x: any) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="field">
                      Reason
                      <select
                        value={form.reason}
                        onChange={(e) => patch("reason", e.target.value)}
                      >
                        <option value="">What happened?</option>
                        {reasons
                          .filter((x: any) => x.active)
                          .map((x: any) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <details>
                      <summary>Location or note (optional)</summary>
                      <label className="field">
                        Location
                        <input
                          value={form.location}
                          maxLength={120}
                          onChange={(e) => patch("location", e.target.value)}
                        />
                      </label>
                      <label className="field">
                        Note / batch ID
                        <textarea
                          value={form.notes}
                          maxLength={1000}
                          onChange={(e) => patch("notes", e.target.value)}
                        />
                      </label>
                    </details>
                  </section>
                  <section className="panel quantity">
                    <label>Amount wasted</label>
                    <div className="amount-row">
                      <input
                        aria-label="Amount wasted"
                        readOnly
                        value={form.qty}
                        placeholder="—"
                      />
                      <select
                        aria-label="Waste unit"
                        value={form.unit}
                        onChange={(e) => patch("unit", e.target.value)}
                      >
                        {Object.entries(C.units).map(([k, v]: any) => (
                          <option key={k} value={k}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="keypad">
                      {[
                        "1",
                        "2",
                        "3",
                        "4",
                        "5",
                        "6",
                        "7",
                        "8",
                        "9",
                        ".",
                        "0",
                        "back",
                      ].map((k) => (
                        <button
                          className="key"
                          key={k}
                          type="button"
                          aria-label={k === "back" ? "Delete last digit" : k}
                          onClick={() => key(k)}
                        >
                          {k === "back" ? "⌫" : k}
                        </button>
                      ))}
                    </div>
                    <div className="amount-bottom">
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => key("clear")}
                      >
                        Clear amount
                      </button>
                    </div>
                    <div className="cost-preview">
                      <span>Waste cost estimate</span>
                      <strong>{money(price.cost)}</strong>
                      <small>
                        {price.reason ||
                          "Reviewed price snapshot will be saved."}
                      </small>
                    </div>
                  </section>
                </div>
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                <div className="save-bar">
                  {step === "amount" && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setStep("choose")}
                    >
                      ← Change item
                    </button>
                  )}
                  <button className="primary" disabled={saving}>
                    {step === "choose"
                      ? "Continue to amount"
                      : "Save waste entry"}
                  </button>
                  <span>Saved on this device first.</span>
                </div>
              </form>
            </>
          )}
          {saved && (
            <section className="panel success">
              <div className="checkmark">✓</div>
              <h1>Waste entry saved.</h1>
              <p className="saved-amount">
                {saved.qty} {saved.unit} · {saved.itemName}
              </p>
              <div className="receipt">
                <div>
                  <span>Waste value</span>
                  <strong>{money(saved.value)}</strong>
                </div>
                <div>
                  <span>Employee</span>
                  <strong>{saved.employee}</strong>
                </div>
                <div>
                  <span>Reason</span>
                  <strong>{saved.reason}</strong>
                </div>
              </div>
              <button
                className="primary"
                onClick={() => {
                  setSaved(null);
                  setStep("choose");
                  setForm({ ...form, qty: "", notes: "" });
                }}
              >
                Log another item
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setSaved(null);
                  setView("records");
                }}
              >
                View records
              </button>
            </section>
          )}
          {view === "records" && !saved && (
            <>
              <div className="intro">
                <div>
                  <div className="eyebrow">Scotty’s on King</div>
                  <h1>Waste records.</h1>
                  <p>
                    Original cost snapshots. Corrections stay in the history.
                  </p>
                </div>
              </div>
              <section className="panel">
                <div className="filter-row">
                  <label>
                    From
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    To
                    <input
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                  <label>
                    Employee
                    <select
                      value={filterEmployee}
                      onChange={(e) => setFilterEmployee(e.target.value)}
                    >
                      <option value="">All employees</option>
                      {employees.map((x: any) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="stats">
                  <div>
                    <span>Priced subtotal</span>
                    <strong>{money(totals.value)}</strong>
                  </div>
                  <div>
                    <span>Entries</span>
                    <strong>{totals.count}</strong>
                  </div>
                  <div className="unpriced">
                    <span>Unpriced entries</span>
                    <strong>{totals.unpriced}</strong>
                  </div>
                </div>
                {totals.unpriced > 0 && (
                  <p className="notice">Subtotal excludes unpriced entries.</p>
                )}
                <details>
                  <summary>Totals by ingredient</summary>
                  {[...new Set(list.map((r: any) => r.itemId))].map(
                    (id: any) => {
                      const a = list.filter((r: any) => r.itemId === id),
                        t = C.totals(a);
                      return (
                        <div className="record-top" key={id}>
                          <span>
                            {a[0].itemName} · {t.count} entries
                          </span>
                          <strong>
                            {money(t.value)}
                            {t.unpriced ? " + unknown" : ""}
                          </strong>
                        </div>
                      );
                    },
                  )}
                </details>
                {list.map((r: any) => (
                  <article className="record" key={r.id}>
                    <div className="record-top">
                      <h3>{r.itemName}</h3>
                      <strong>{money(r.value)}</strong>
                    </div>
                    <div className="record-amount">
                      {r.qty} {r.unit}
                    </div>
                    <p>
                      {r.reason} · {r.employee}
                      <br />
                      {date(r.at)}
                      {r.location && (
                        <>
                          <br />
                          {r.location}
                        </>
                      )}
                    </p>
                    <p>{r.notes}</p>
                    <small>
                      {r.costBasis} · {r.costDate} · {r.id}
                    </small>
                    <button
                      className="quiet"
                      onClick={() =>
                        setCorrect({ record: r, by: "", reason: "" })
                      }
                    >
                      Correct this entry
                    </button>
                  </article>
                ))}
                <div className="actions">
                  {["general", "vision", "inventory"].map((k) => (
                    <button
                      className="secondary"
                      key={k}
                      onClick={() =>
                        download(
                          "Scottys_Waste_" + k + "_" + today() + ".csv",
                          C.exportCSV(list, k),
                          "text/csv;charset=utf-8",
                        )
                      }
                    >
                      Export {k} CSV
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}
        </main>
        <footer className="footnote">
          <strong>Good Food = Good Mood</strong> · Saved on this device. Back up
          after each shift.
        </footer>
      </div>
      {manager && (
        <Modal
          onClose={() => {
            setManager(null);
            setPerson(null);
          }}
        >
          <h2>Manage waste tracking</h2>
          <div className="actions">
            {[
              ["items", "Ingredients"],
              ["employees", "Employees"],
              ["reasons", "Reasons"],
              ["backup", "Import & backup"],
            ].map(([id, label]) => (
              <button
                key={id}
                className={manager === id ? "primary" : ""}
                onClick={() => {
                  setManager(id);
                  setPerson(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {manager === "items" && (
            <>
              <button onClick={() => setEdit({})}>
                ＋ Add ingredient or prepared item
              </button>
              <div className="list">
                {catalog.map((x: any) => (
                  <button
                    key={x.id}
                    className="search-result"
                    onClick={() => setEdit(x)}
                  >
                    {x.name} · {x.confirmed ? "Reviewed" : "Needs review"}
                  </button>
                ))}
              </div>
            </>
          )}
          {["employees", "reasons"].includes(manager) && (
            <>
              <p>
                Edit a name or archive it. Existing records retain the original
                name.
              </p>
              <div className="actions">
                {(manager === "employees" ? employees : reasons).map(
                  (x: any) => (
                    <button
                      key={x.id}
                      onClick={() => setPerson({ ...x, kind: manager })}
                    >
                      {x.name}
                      {!x.active ? " · archived" : ""}
                    </button>
                  ),
                )}
              </div>
              <button
                onClick={() =>
                  setPerson({ id: "", name: "", active: true, kind: manager })
                }
              >
                ＋ Add {manager === "employees" ? "employee" : "reason"}
              </button>
              {person && (
                <form onSubmit={savePerson}>
                  <Field
                    label="Name"
                    name="personName"
                    value={person.name}
                    maxLength={80}
                    onChange={(e) =>
                      setPerson({ ...person, name: e.target.value })
                    }
                  />
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={person.active}
                      onChange={(e) =>
                        setPerson({ ...person, active: e.target.checked })
                      }
                    />
                    Available in staff dropdown
                  </label>
                  <button className="primary">Save</button>
                </form>
              )}
            </>
          )}
          {manager === "backup" && (
            <>
              <button
                onClick={() => backup().catch((e: Error) => notify(e.message))}
              >
                Download backup
              </button>
              <Field
                label="Import logger JSON"
                name="wasteImport"
                type="file"
                accept=".json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    importBackup(f, false).catch((e: Error) =>
                      notify(e.message),
                    );
                }}
              />
              <Field
                label="Import ingredient CSV"
                name="catalogImport"
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  try {
                    const f = e.target.files?.[0];
                    if (f) {
                      if (f.size > 10000000) throw Error("CSV is too large.");
                      setCsvPreview(C.importCatalog(await f.text()));
                    }
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              />
              {csvPreview && (
                <>
                  <p>
                    {csvPreview.length} ingredient rows ready. Prices remain
                    unreviewed.
                  </p>
                  <button
                    onClick={() =>
                      run(async () => {
                        await addEvents(
                          csvPreview.map((x) => ({
                            id: uid(),
                            kind: "ingredient",
                            entityId: x.id,
                            at: Date.now(),
                            data: x,
                          })),
                        );
                        setCsvPreview(null);
                        notify("Catalog imported locally.");
                      })
                    }
                  >
                    Approve catalog import
                  </button>
                </>
              )}
            </>
          )}
        </Modal>
      )}
      {edit && (
        <IngredientEditor
          item={edit.id ? edit : undefined}
          onClose={() => setEdit(null)}
        />
      )}
      {correct && (
        <Modal onClose={() => setCorrect(null)}>
          <h2>Correct a waste entry</h2>
          <p>
            {correct.record.itemName}. The original is retained and excluded
            from totals. Posted Sheets rows require reconciliation.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const employee = employees.find(
                  (x: any) => x.id === correct.by && x.active,
                );
                if (!employee || !correct.reason.trim())
                  throw Error(
                    "Choose an employee and enter a correction reason.",
                  );
                const v = {
                  id: uid(),
                  recordId: correct.record.id,
                  at: Date.now(),
                  reason: correct.reason,
                  by: employee.name,
                };
                await addEvent(
                  "waste_void",
                  v.recordId,
                  v,
                  v.at,
                  "waste-void:" + v.id,
                );
                setCorrect(null);
              });
            }}
          >
            <label>
              Corrected by
              <select
                value={correct.by}
                onChange={(e) => setCorrect({ ...correct, by: e.target.value })}
              >
                <option value="">Choose employee</option>
                {employees
                  .filter((x: any) => x.active)
                  .map((x: any) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Reason for correction
              <textarea
                required
                value={correct.reason}
                onChange={(e) =>
                  setCorrect({ ...correct, reason: e.target.value })
                }
              />
            </label>
            <button className="primary">Mark original void</button>
          </form>
        </Modal>
      )}
    </>
  );
}
