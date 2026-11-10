"use client";
import React, { useState } from "react";
import { useKitchen } from "./provider";
import { Field } from "./ui";
export function Reconciliation() {
  const { state, request, notify } = useKitchen(),
    [rows, setRows] = useState<any[]>([]),
    [note, setNote] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false);
  if (!["owner", "manager"].includes(state.role)) return null;
  async function load() {
    try {
      const r = await request("/api/reconciliation");
      setRows(r.postings);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <>
      <h2>Workbook reconciliation</h2>
      <p>
        Uncertain writes stay blocked from automatic retry. Check the actual
        workbook record IDs and stock rows before marking a posting confirmed.
      </p>
      <button onClick={load}>Read blocked postings</button>
      {rows.map((r) => (
        <button
          className="search-result"
          key={r.key}
          onClick={() => {
            setKey(r.key);
            setNote("");
            setConfirmed(false);
          }}
        >
          {r.record_id} · {r.status}
        </button>
      ))}
      {key && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await request("/api/reconciliation", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  key,
                  note,
                  confirmed,
                  mode: confirmed ? "confirmed" : "note",
                }),
              });
              notify(
                confirmed
                  ? "Manual workbook confirmation recorded."
                  : "Reconciliation note saved; automatic retry remains blocked.",
              );
              setKey("");
              await load();
            } catch (e) {
              notify((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field
            label="What was checked or corrected in the workbook?"
            name="reconciliationNote"
            value={note}
            minLength={10}
            required
            onChange={(e) => setNote(e.target.value)}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I checked the actual workbook rows and confirm this posting is
            complete.
          </label>
          <button disabled={busy} className="primary">
            Save reconciliation
          </button>
        </form>
      )}
    </>
  );
}
