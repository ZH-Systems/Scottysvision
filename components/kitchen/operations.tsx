"use client";
import React, { useEffect, useState } from "react";
import { useKitchen } from "./provider";
import { Heading, Field } from "./ui";
import { uid, money, date, download, today } from "@/lib/local";
export function Operations() {
  const { state, catalog, request, sync, notify } = useKitchen(),
    [data, setData] = useState<any>(null),
    [form, setForm] = useState<any>({
      id: uid(),
      kind: state.role === "staff" ? "production" : "receipt",
      itemId: "",
      location: "Kitchen",
      destination: "",
      qty: "",
      unitCost: "",
      reason: "",
      recipeEventId: "",
      batches: "1",
      operationId: "",
    }),
    [busy, setBusy] = useState(false);
  const patch = (k: string, v: any) => setForm({ ...form, [k]: v });
  const refresh = async () => {
    const r = await request("/api/operations");
    setData(r);
  };
  useEffect(() => {
    refresh().catch((e: Error) => notify(e.message));
  }, []);
  const manager = ["owner", "manager"].includes(state.role);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await sync();
      await request("/api/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      notify("Stock operation confirmed.");
      setForm({ ...form, id: uid(), qty: "", reason: "" });
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="Stock & production."
        sub="Receive purchases, count stock, transfer between locations and record production batches."
      >
        <button
          disabled={busy}
          onClick={() => refresh().catch((e: Error) => notify(e.message))}
        >
          Refresh stock
        </button>
      </Heading>
      <p className="notice">
        Balances include recorded receipts, counts, production and waste. No
        opening balance is invented. Unknown unit costs stay unknown. Physical
        stock and unrecorded movements require reconciliation.
      </p>
      <section className="panel">
        <h2>Current balances</h2>
        <div className="scroll-table">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Location</th>
                <th>Quantity</th>
                <th>Recorded value</th>
                <th>Reorder</th>
              </tr>
            </thead>
            <tbody>
              {(data?.balances || []).map((r: any) => {
                const item = catalog.find((x: any) => x.id === r.item_id);
                return (
                  <tr key={[r.item_id, r.location, r.unit].join(":")}>
                    <td>{item?.name || r.item_id}</td>
                    <td>{r.location}</td>
                    <td>
                      {r.qty} {r.unit}
                    </td>
                    <td>
                      {money(
                        r.recorded_value == null
                          ? null
                          : Number(r.recorded_value),
                      )}
                    </td>
                    <td>
                      {item?.reorderPoint != null &&
                      Number(r.qty) <= Number(item.reorderPoint)
                        ? "Below reorder point" +
                          (item.parLevel != null
                            ? ", target " + item.parLevel
                            : "")
                        : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button
          onClick={() =>
            download("Scottys_Stock_" + today() + ".json", data || {})
          }
        >
          Export stock & operations
        </button>
      </section>
      {state.role !== "viewer" && (
        <form className="panel" onSubmit={submit}>
          <h2>Record an operation</h2>
          <label>
            Operation
            <select
              value={form.kind}
              onChange={(e) => patch("kind", e.target.value)}
            >
              {(manager
                ? [
                    "receipt",
                    "adjustment",
                    "transfer",
                    "production",
                    "reversal",
                  ]
                : ["production"]
              ).map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          {form.kind === "production" ? (
            <>
              <label>
                Finalised recipe revision
                <select
                  required
                  value={form.recipeEventId}
                  onChange={(e) => patch("recipeEventId", e.target.value)}
                >
                  <option value="">Choose revision</option>
                  {state.events
                    .filter((e: any) => e.kind === "recipe" && e.data.finalized)
                    .map((e: any) => (
                      <option key={e.id} value={e.id}>
                        {e.data.recipe.name} · {date(e.at)}
                      </option>
                    ))}
                </select>
              </label>
              <Field
                label="Batches produced"
                name="batches"
                value={form.batches}
                onChange={(e) => patch("batches", e.target.value)}
                required
              />
            </>
          ) : form.kind === "reversal" ? (
            <>
              <label>
                Original operation
                <select
                  value={form.operationId}
                  onChange={(e) => patch("operationId", e.target.value)}
                  required
                >
                  <option value="">Choose operation</option>
                  {(data?.operations || [])
                    .filter((o: any) =>
                      [
                        "receipt",
                        "adjustment",
                        "transfer",
                        "production",
                      ].includes(o.kind),
                    )
                    .map((o: any) => (
                      <option key={o.operation_id} value={o.operation_id}>
                        {o.kind} · {o.operation_id}
                      </option>
                    ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <label>
                Ingredient
                <select
                  value={form.itemId}
                  onChange={(e) => patch("itemId", e.target.value)}
                  required
                >
                  <option value="">Choose ingredient</option>
                  {catalog.map((x: any) => (
                    <option key={x.id} value={x.id}>
                      {x.name} · {x.baseUnit}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                label={
                  form.kind === "adjustment"
                    ? "Physical count in ingredient cost unit"
                    : "Quantity in ingredient cost unit"
                }
                name="stockQty"
                value={form.qty}
                onChange={(e) => patch("qty", e.target.value)}
                required
              />
              {form.kind === "receipt" && (
                <Field
                  label="Actual cost per stock unit, CAD, blank if unknown"
                  name="stockCost"
                  value={form.unitCost}
                  onChange={(e) => patch("unitCost", e.target.value)}
                />
              )}
            </>
          )}
          <div className="row">
            <Field
              label="Location"
              name="stockLocation"
              value={form.location}
              onChange={(e) => patch("location", e.target.value)}
              required
            />
            {form.kind === "transfer" && (
              <Field
                label="Destination"
                name="stockDestination"
                value={form.destination}
                onChange={(e) => patch("destination", e.target.value)}
                required
              />
            )}
          </div>
          <Field
            label="Reason / reference"
            name="stockReason"
            value={form.reason}
            onChange={(e) => patch("reason", e.target.value)}
            required={["adjustment", "reversal"].includes(form.kind)}
          />
          <div className="actions">
            <button className="primary" disabled={busy}>
              Approve & record operation
            </button>
          </div>
        </form>
      )}
      <section className="panel">
        <h2>Recent operations</h2>
        {(data?.operations || []).map((x: any) => (
          <div className="list-item" key={x.operation_id}>
            <div>
              <b>{x.kind}</b>
              <small>
                {x.operation_id} · {new Date(x.created_at).toLocaleString()}
              </small>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
