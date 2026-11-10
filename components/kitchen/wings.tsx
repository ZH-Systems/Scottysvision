"use client";
import React, { useEffect, useRef, useState } from "react";
import { wingsBackup } from "@/lib/core/backups.mjs";
import WingCore from "@/lib/core/wings.js";
import { useKitchen } from "./provider";
import { Modal, Field } from "./ui";
import { wingStyles } from "./module-styles";
import { uid, download, today, clone } from "@/lib/local";
const C: any = WingCore;
const names: Record<string, string> = {
  dry_start: "Fridge rest started",
  dry_end: "Fridge rest ended",
  raw_check: "Starting temperature",
  cook_start: "Cooking started",
  oven_out: "Oven out",
  cook_check: "Cooking check",
  cook_batch_check: "Earlier batch cook check",
  cooler_in: "Into cooler",
  cool_check: "Cooling check",
  packed: "Packed",
  note: "Note",
  void: "Corrected / voided",
  clock_fix: "Oven-out correction",
  discarded: "Discard recorded",
};
export function Wings() {
  const { state, update, addEvents, notify, backup, importBackup } =
      useKitchen(),
    [screen, setScreen] = useState("home"),
    [selected, setSelected] = useState<string | null>(null),
    [now, setNow] = useState(0),
    [form, setForm] = useState<any>({
      staff: "",
      count: "",
      labels: [],
      name: "",
      weight: "",
      notes: "",
      rawCore: "",
      out: "",
      cookCore: "",
      cookAt: "",
      held15: false,
    }),
    [round, setRound] = useState<any>(null),
    [temp, setTemp] = useState(""),
    [held, setHeld] = useState(false),
    [modal, setModal] = useState<any>(null),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [sound, setSound] = useState(!!state.wingSound),
    audio = useRef<AudioContext | null>(null),
    alerted = useRef(new Set<string>());
  const batches = state.events
      .filter((e: any) => e.kind === "wing_batch")
      .map((e: any) => ({
        ...e.data,
        events: state.events
          .filter(
            (x: any) => x.kind === "wing_event" && x.entityId === e.entityId,
          )
          .map((x: any) => x.data)
          .sort((a: any, b: any) => a.at - b.at || a.id.localeCompare(b.id)),
      })),
    b = batches.find((x: any) => x.id === selected),
    v = b ? C.evaluate(b, now || Date.now()) : null;
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  function beep() {
    try {
      audio.current ??= new AudioContext();
      const a = audio.current;
      a.resume();
      const o = a.createOscillator(),
        g = a.createGain();
      o.connect(g);
      g.connect(a.destination);
      o.frequency.value = 660;
      g.gain.setValueAtTime(0.12, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.6);
      o.start();
      o.stop(a.currentTime + 0.6);
    } catch {}
  }
  useEffect(() => {
    if (!sound) return;
    for (const b of batches) {
      const e = C.evaluate(b, now),
        key = b.id + ":" + e.status + ":" + e.nextDue;
      if (
        ((e.nextDue && now >= e.nextDue) || e.status === "review") &&
        !alerted.current.has(key) &&
        !["packed", "discarded", "cooled"].includes(e.status)
      ) {
        alerted.current.add(key);
        beep();
      }
    }
  }, [now, sound, batches]);
  const patch = (k: string, x: any) => setForm({ ...form, [k]: x });
  const staff = () => {
    const x = form.staff.trim() || b?.staff || state.wingStaff || "";
    if (!x || x.length > 20)
      throw Error("Enter initials, up to 20 characters.");
    return x;
  };
  const future = (s: string) => {
    const x = C.parseLocal(s);
    if (x > Date.now() + 60000)
      throw Error("Enter an actual past measurement time.");
    return x;
  };
  const wrap = (batchId: string, e: any) => ({
    id: "wing:" + batchId + ":" + e.id,
    kind: "wing_event",
    entityId: batchId,
    at: e.at,
    data: clone(e),
  });
  async function append(type: string, values: any = {}, batch = b) {
    if (!batch) throw Error("Choose a batch.");
    const e = C.event(type, {
      staff: state.wingStaff || batch.staff,
      ...values,
    });
    await addEvents([wrap(batch.id, e)]);
    return e;
  }
  async function create(mode: string) {
    setSaving(true);
    try {
      const initials = staff(),
        n = Number(form.count),
        existing = screen === "existing";
      if (!Number.isInteger(n) || n < 1 || n > 12)
        throw Error("Choose the actual number of trays.");
      const weight = form.weight === "" ? null : Number(form.weight);
      if (weight !== null && (!Number.isFinite(weight) || weight <= 0))
        throw Error("Enter a positive measured weight or leave blank.");
      const x = {
        id: uid(),
        name:
          form.name.trim() || "Wings " + today() + " · " + (batches.length + 1),
        createdAt: Date.now(),
        staff: initials,
        weight,
        mode: existing ? "existing" : "normal",
        notes: form.notes,
        trays: Array.from({ length: n }, (_, i) => ({
          id: uid(),
          label: form.labels[i]?.trim() || "Tray " + (i + 1),
        })),
      };
      const events: any[] = [];
      if (existing) {
        if (form.out)
          events.push(
            C.event("oven_out", {
              at: future(form.out),
              staff: initials,
              note: "Entered from existing batch records.",
            }),
          );
        if (form.cookCore) {
          if (!form.cookAt)
            throw Error("Enter actual earlier cooking-check time.");
          events.push(
            C.event("cook_batch_check", {
              at: future(form.cookAt),
              staff: initials,
              c: C.temperature(form.cookCore),
              held15: form.held15,
              note: "Earlier lowest cooking reading across all trays.",
            }),
          );
        }
        events.push(
          C.event("note", {
            staff: initials,
            note: "Existing batch added. Original cooler-entry time was not supplied.",
          }),
        );
      } else {
        events.push(
          C.event("raw_check", {
            c: C.temperature(form.rawCore),
            staff: initials,
          }),
        );
        events.push(
          C.event(mode === "dry" ? "dry_start" : "cook_start", {
            staff: initials,
          }),
        );
      }
      await addEvents([
        {
          id: "wingbatch:" + x.id,
          kind: "wing_batch",
          entityId: x.id,
          at: x.createdAt,
          data: x,
        },
        ...events.map((e) => wrap(x.id, e)),
      ]);
      await update((s: any) => ({ ...s, wingStaff: initials }));
      setSelected(x.id);
      setScreen("batch");
      setError("");
      if (existing) {
        setRound({ id: uid(), kind: "cool", done: [] });
        setTemp("");
        setHeld(false);
        setScreen("measure");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function startRound(kind: string) {
    const prior = state.wingRounds?.[b?.id];
    const next =
      prior?.kind === kind && prior.done.length < b.trays.length
        ? prior
        : { id: uid(), kind, done: [] };
    setRound(next);
    update((s: any) => ({
      ...s,
      wingRounds: { ...s.wingRounds, [b.id]: next },
    })).catch((e: Error) => notify(e.message));
    setTemp("");
    setHeld(false);
    setError("");
    setScreen("measure");
  }
  async function measure(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const tray = b.trays.find((t: any) => !round.done.includes(t.id)),
        c = C.temperature(temp),
        cook = round.kind === "cook";
      await append(cook ? "cook_check" : "cool_check", {
        tray: tray.id,
        c,
        ...(cook ? { held15: held && c >= 74 } : {}),
        round: round.id,
      });
      setTemp("");
      setHeld(false);
      if (cook && (c < 74 || !held))
        throw Error(
          c < 74
            ? "Reading saved. This tray needs more cooking."
            : "Reading saved. Confirm at least 15 seconds at ≥74°C before passing this tray.",
        );
      const done = [...round.done, tray.id];
      if (done.length === b.trays.length) {
        setRound(null);
        await update((s: any) => ({
          ...s,
          wingRounds: { ...s.wingRounds, [b.id]: null },
        }));
        setScreen("batch");
      } else {
        const next = { ...round, done };
        setRound(next);
        await update((s: any) => ({
          ...s,
          wingRounds: { ...s.wingRounds, [b.id]: next },
        }));
      }
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function action(a: string) {
    setSaving(true);
    try {
      if (a === "out") {
        if (!C.active(b).some((e: any) => e.type === "oven_out"))
          await append("oven_out");
        startRound("cook");
      }
      if (a === "cooler") {
        await append("cooler_in");
        startRound("cool");
      }
      if (a === "pack") {
        if (!v.allCold || v.reasons.length)
          throw Error("Cooling checks are incomplete or need review.");
        await append("packed");
      }
      if (a === "start-cook") setModal({ kind: "start-cook", temp: "" });
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function submitModal(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const m = modal;
      if (m.kind === "start-cook") {
        const c = C.temperature(m.temp);
        await addEvents(
          ["raw_check", "dry_end", "cook_start"].map((type) =>
            wrap(
              b.id,
              C.event(type, {
                staff: state.wingStaff || b.staff,
                ...(type === "raw_check" ? { c } : {}),
              }),
            ),
          ),
        );
      } else if (m.kind === "clock") {
        if ((m.reason || "").trim().length < 4)
          throw Error("Enter the source of the corrected time.");
        await append("clock_fix", { valueAt: future(m.at), reason: m.reason });
      } else if (m.kind === "note" || m.kind === "discard") {
        if (!m.note?.trim()) throw Error("Enter a note.");
        await append(m.kind === "discard" ? "discarded" : "note", {
          note: m.note,
          flag: !!m.flag,
        });
      } else if (m.kind === "manual") {
        if ((m.reason || "").trim().length < 4)
          throw Error("Enter a reason or source.");
        const type = m.original?.type || m.type,
          c = C.temperature(m.temp),
          at = future(m.at);
        const events = [];
        if (m.original)
          events.push(
            wrap(
              b.id,
              C.event("void", {
                ref: m.original.id,
                reason: m.reason,
                staff: state.wingStaff || b.staff,
              }),
            ),
          );
        events.push(
          wrap(
            b.id,
            C.event(type, {
              c,
              at,
              staff: state.wingStaff || b.staff,
              note: m.reason,
              ...(["raw_check", "cook_batch_check"].includes(type)
                ? {}
                : { tray: m.original?.tray || m.tray }),
              ...(["cook_check", "cook_batch_check"].includes(type)
                ? { held15: !!m.held15 }
                : {}),
            }),
          ),
        );
        await addEvents(events);
      }
      setModal(null);
      setScreen("history");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const manual = (original?: any) => {
    setError("");
    setModal({
      kind: "manual",
      original,
      type: original?.type || "cool_check",
      tray: original?.tray || b.trays[0].id,
      temp: original?.c == null ? "" : String(original.c),
      at: original ? C.localInput(original.at) : "",
      held15: !!original?.held15,
      reason: "",
    });
  };
  const timeLeft = (t: number | null) =>
    t == null
      ? "Time unknown"
      : now >= t
        ? "Check now"
        : Math.floor((t - now) / 60000) +
          " m " +
          Math.floor(((t - now) % 60000) / 1000) +
          " s";
  const notice = (e: any) =>
    e.status === "review" ? (
      <div className="notice bad">
        <strong>Hold this batch. Tell Scotty.</strong>
        <ul>
          {e.reasons.map((r: string) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p>A later cold reading does not erase missing or late checks.</p>
      </div>
    ) : null;
  return (
    <>
      <style>{wingStyles}</style>
      <div className="wings-module logger-surface" data-view={screen}>
        <header className="top">
          <div className="top-inner">
            <a
              className="brand"
              href="#wings"
              onClick={() => setScreen("home")}
            >
              <span className="brand-mark">S</span>
              <span>
                SCOTTY’S<small>ON KING</small>
              </span>
            </a>
            <div className="top-actions">
              <span className="local-badge">Saved on this device</span>
              <button
                className="quiet"
                onClick={() => {
                  setSound(!sound);
                  update((s: any) => ({ ...s, wingSound: !sound })).catch(
                    (e: Error) => notify(e.message),
                  );
                  if (!sound) beep();
                }}
              >
                {sound ? "Sound on" : "Sound off"}
              </button>
              <button
                className="quiet"
                aria-label="Records and backup"
                onClick={() => setModal({ kind: "manager" })}
              >
                Records & backup
              </button>
            </div>
          </div>
        </header>
        <main id="wing-app">
          {screen === "home" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">Wing check</div>
                  <h1>One check at a time.</h1>
                  <p>Start a batch. Follow the prompt. We’ll keep the times.</p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    setScreen("new");
                    setForm({ ...form, staff: state.wingStaff || "" });
                  }}
                >
                  + Start a batch
                </button>
              </div>
              {!batches.some(
                (x: any) =>
                  !["packed", "discarded"].includes(
                    C.evaluate(x, now || Date.now()).status,
                  ),
              ) ? (
                <section className="empty">
                  <div className="empty-copy">
                    <div className="eyebrow">Made for the kitchen</div>
                    <h2>The thermometer readings are your only maths.</h2>
                    <p>
                      Big buttons, one tray at a time, and a clear next step.
                      The full log fills itself in as you work.
                    </p>
                    <button
                      className="primary large"
                      onClick={() => setScreen("new")}
                    >
                      Start the first batch
                    </button>
                  </div>
                  <div className="empty-steps">
                    {[
                      [
                        "Start the batch",
                        "Initials, tray count, starting temperature.",
                      ],
                      [
                        "Confirm the cook",
                        "Enter each tray’s lowest core reading.",
                      ],
                      [
                        "Follow the cooling prompts",
                        "Enter each tray’s warmest core reading.",
                      ],
                    ].map(([title, sub], i) => (
                      <div className="simple-step" key={title}>
                        <span className="number">{i + 1}</span>
                        <div>
                          <strong>{title}</strong>
                          <small>{sub}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : (
                <div className="cards">
                  {batches
                    .filter(
                      (x: any) =>
                        !["packed", "discarded"].includes(
                          C.evaluate(x, now || Date.now()).status,
                        ),
                    )
                    .map((x: any) => {
                      const e = C.evaluate(x, now || Date.now());
                      return (
                        <section className="card" key={x.id}>
                          <div className="card-top">
                            <span className="eyebrow">
                              {x.trays.length}{" "}
                              {x.trays.length === 1 ? "tray" : "trays"}
                            </span>
                            <span
                              className={
                                "tag " +
                                (e.status === "review"
                                  ? "bad"
                                  : ["cooled", "packed"].includes(e.status)
                                    ? "good"
                                    : "warn")
                              }
                            >
                              {e.status === "review" ? "Tell Scotty" : e.status}
                            </span>
                          </div>
                          <h2>{x.name}</h2>
                          <div className="card-meta">
                            Started {C.localTime(x.createdAt)} · {x.staff}
                          </div>
                          <div style={{ minHeight: 66 }}>
                            {e.status === "review" ? (
                              e.reasons[0]
                            ) : e.status === "cooled" ? (
                              "Every tray has a timely ≤4°C reading."
                            ) : e.status === "cookcheck" ? (
                              "Check each tray before cooling."
                            ) : e.nextDue ? (
                              <>
                                <span className="card-time">
                                  {timeLeft(e.nextDue)}
                                </span>
                                <div className="mini muted">
                                  until the next check
                                </div>
                              </>
                            ) : (
                              "Record the next step."
                            )}
                          </div>
                          <button
                            className="primary"
                            onClick={() => {
                              setSelected(x.id);
                              setScreen("batch");
                            }}
                          >
                            Continue
                          </button>
                        </section>
                      );
                    })}
                </div>
              )}
              <div className="batch-tools">
                <span className="mini muted">
                  {batches.length} saved batches · Times shown for Welland
                </span>
                <button
                  className="text-button"
                  onClick={() => setScreen("existing")}
                >
                  Add wings already out of the oven
                </button>
              </div>
              {batches.some((x: any) =>
                ["packed", "discarded"].includes(
                  C.evaluate(x, now || Date.now()).status,
                ),
              ) && (
                <details className="archived">
                  <summary>Finished batches</summary>
                  <ul className="record-list">
                    {batches
                      .filter((x: any) =>
                        ["packed", "discarded"].includes(
                          C.evaluate(x, now || Date.now()).status,
                        ),
                      )
                      .map((x: any) => (
                        <li key={x.id}>
                          <div>
                            <strong>{x.name}</strong>
                            <small>{C.localDateTime(x.createdAt)}</small>
                          </div>
                          <button
                            className="secondary small-button"
                            onClick={() => {
                              setSelected(x.id);
                              setScreen("history");
                            }}
                          >
                            View record
                          </button>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            </>
          )}
          {["new", "existing"].includes(screen) && (
            <>
              <button className="back" onClick={() => setScreen("home")}>
                ← Back to batches
              </button>
              <div className="eyebrow">Wing check</div>
              <h1>
                {screen === "existing"
                  ? "Add an existing batch."
                  : "Start a wing batch."}
              </h1>
              <p>
                {screen === "existing"
                  ? "Use actual records. Unknown history stays unverified."
                  : "A few details now. One simple prompt after that."}
              </p>
              <div className="two-column">
                <form
                  className="panel"
                  onSubmit={(e) => {
                    e.preventDefault();
                    create("cook");
                  }}
                >
                  <div className="row">
                    <Field
                      label="Your initials"
                      name="initials"
                      value={form.staff}
                      maxLength={20}
                      onChange={(e) => patch("staff", e.target.value)}
                    />
                    <label>
                      How many trays?
                      <select
                        value={form.count}
                        onChange={(e) => patch("count", e.target.value)}
                      >
                        <option value="">Choose tray count</option>
                        {Array.from({ length: 12 }, (_, i) => (
                          <option key={i} value={i + 1}>
                            {i + 1} {i ? "trays" : "tray"}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {screen === "existing" ? (
                    <>
                      <p className="notice">
                        Unknown times and temperatures remain unknown. Earlier
                        cooking is not certified by adding a batch.
                      </p>
                      <Field
                        label="Actual oven-out time, if known"
                        name="pastOut"
                        type="datetime-local"
                        value={form.out}
                        onChange={(e) => patch("out", e.target.value)}
                      />
                      <details>
                        <summary>Earlier cooking check, if documented</summary>
                        <Field
                          label="Lowest cook core across ALL trays (°C)"
                          name="pastCore"
                          inputMode="decimal"
                          value={form.cookCore}
                          onChange={(e) => patch("cookCore", e.target.value)}
                        />
                        <Field
                          label="Actual cooking-check time"
                          name="pastCookAt"
                          type="datetime-local"
                          value={form.cookAt}
                          onChange={(e) => patch("cookAt", e.target.value)}
                        />
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={form.held15}
                            onChange={(e) => patch("held15", e.target.checked)}
                          />
                          All trays were checked at ≥74°C for at least 15
                          seconds.
                        </label>
                      </details>
                    </>
                  ) : (
                    <Field
                      label="Warmest starting wing core (°C)"
                      name="rawCore"
                      inputMode="decimal"
                      value={form.rawCore}
                      onChange={(e) => patch("rawCore", e.target.value)}
                    />
                  )}
                  <details>
                    <summary>Name the trays / shelves (optional)</summary>
                    {Array.from({ length: Number(form.count) || 0 }, (_, i) => (
                      <Field
                        key={i}
                        label={"Tray " + (i + 1)}
                        name={"trayLabel" + i}
                        value={form.labels[i] || ""}
                        onChange={(e) => {
                          const a = [...form.labels];
                          a[i] = e.target.value;
                          patch("labels", a);
                        }}
                      />
                    ))}
                  </details>
                  <details>
                    <summary>Batch name, weight & notes (optional)</summary>
                    <Field
                      label="Batch name"
                      name="batchName"
                      value={form.name}
                      onChange={(e) => patch("name", e.target.value)}
                    />
                    <Field
                      label="Actual drained wing weight (kg)"
                      name="weight"
                      type="number"
                      min="0.001"
                      step="0.001"
                      value={form.weight}
                      onChange={(e) => patch("weight", e.target.value)}
                    />
                    <label>
                      Notes / original use-by
                      <textarea
                        value={form.notes}
                        onChange={(e) => patch("notes", e.target.value)}
                      />
                    </label>
                  </details>
                  {error && (
                    <p className="form-error" role="alert">
                      {error}
                    </p>
                  )}
                  <div className="actions">
                    <button className="primary large" disabled={saving}>
                      {screen === "existing"
                        ? "Add batch & record temperatures"
                        : "Start oven timer"}
                    </button>
                    {screen !== "existing" && (
                      <button
                        className="secondary"
                        type="button"
                        disabled={saving}
                        onClick={() => create("dry")}
                      >
                        Start overnight fridge rest
                      </button>
                    )}
                  </div>
                </form>
                <aside className="side-panel">
                  <h3>Keep the history honest.</h3>
                  <p>
                    Times are recorded when the button is pressed. Enter actual
                    wing core temperatures, one tray at a time.
                  </p>
                  <p className="help">
                    Records save locally first. Sync backs them up to Supabase.
                  </p>
                </aside>
              </div>
            </>
          )}
          {screen === "batch" && b && (
            <>
              <button className="back" onClick={() => setScreen("home")}>
                ← Back to batches
              </button>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">Wing check</div>
                  <h1>{b.name}</h1>
                  <p>
                    {b.trays.length} trays · {b.staff} · started{" "}
                    {C.localDateTime(b.createdAt)}
                  </p>
                </div>
                <span className={"tag " + (v.status === "review" ? "bad" : "")}>
                  {v.status}
                </span>
              </div>
              {notice(v)}
              <WingDetail
                b={b}
                v={v}
                timeLeft={timeLeft}
                action={action}
                startRound={startRound}
                busy={saving}
                history={() => setScreen("history")}
                home={() => setScreen("home")}
              />
              <div className="batch-tools">
                <span className="help">
                  Oven-out time:{" "}
                  {v.out == null ? "Unknown" : C.localDateTime(v.out)}
                </span>
                <button
                  className="secondary small-button"
                  onClick={() => setScreen("history")}
                >
                  Full record & corrections
                </button>
              </div>
            </>
          )}
          {screen === "measure" &&
            b &&
            round &&
            (() => {
              const tray = b.trays.find((t: any) => !round.done.includes(t.id));
              if (!tray) return null;
              return (
                <>
                  <button className="back" onClick={() => setScreen("batch")}>
                    ← Back to batch
                  </button>
                  <div className="measure-head">
                    <div className="eyebrow">
                      {round.kind === "cook"
                        ? "Confirm the cook"
                        : "Cooling check"}
                    </div>
                    <h1>{tray.label}</h1>
                    <p>
                      {round.done.length + 1} of {b.trays.length} trays ·{" "}
                      {b.name}
                    </p>
                  </div>
                  <form className="measure-card" onSubmit={measure}>
                    <div className="progress-track">
                      {b.trays.map((t: any) => (
                        <i
                          key={t.id}
                          className={round.done.includes(t.id) ? "done" : ""}
                        />
                      ))}
                    </div>
                    <label className="field">
                      Actual wing core (°C)
                      <div className="temp-wrap">
                        <button
                          type="button"
                          className="temp-edit"
                          onClick={() =>
                            setTemp((s) =>
                              s.startsWith("-") ? s.slice(1) : "-" + s,
                            )
                          }
                        >
                          ±
                        </button>
                        <input
                          className="temp-input"
                          aria-label="Actual wing core (°C)"
                          inputMode="decimal"
                          value={temp}
                          onChange={(e) => setTemp(e.target.value)}
                          placeholder="—"
                        />
                        <span>°C</span>
                        <button
                          type="button"
                          className="temp-edit"
                          onClick={() => setTemp("")}
                        >
                          Clear
                        </button>
                      </div>
                    </label>
                    <div className="temperature-keypad">
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
                          className="number-key"
                          type="button"
                          key={k}
                          aria-label={k === "back" ? "Delete last digit" : k}
                          onClick={() =>
                            setTemp((s) =>
                              k === "back"
                                ? s.slice(0, -1)
                                : k === "."
                                  ? s.includes(".")
                                    ? s
                                    : (s || "0") + "."
                                  : s.length < 7
                                    ? s + k
                                    : s,
                            )
                          }
                        >
                          {k === "back" ? "⌫" : k}
                        </button>
                      ))}
                    </div>
                    {round.kind === "cook" && (
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={held}
                          onChange={(e) => setHeld(e.target.checked)}
                        />
                        This tray’s checked wings stayed at ≥74°C for at least
                        15 seconds.
                      </label>
                    )}
                    {error && (
                      <p className="form-error" role="alert">
                        {error}
                      </p>
                    )}
                    <button className="primary large" disabled={saving}>
                      Save reading & continue
                    </button>
                  </form>
                </>
              );
            })()}
          {screen === "history" && b && (
            <>
              <button
                className="back no-print"
                onClick={() => setScreen("batch")}
              >
                ← Back to batch
              </button>
              <h1>{b.name}</h1>
              <p>
                Full log · actual measurement times and corrections remain
                visible.
              </p>
              {notice(v)}
              <div className="panel">
                <div className="chip-row">
                  <span className="chip">{b.trays.length} trays</span>
                  <span className="chip">
                    {b.weight == null
                      ? "Weight not recorded"
                      : b.weight + " kg"}
                  </span>
                  <span className="chip">Staff: {b.staff}</span>
                  <span className="chip">Toronto time</span>
                </div>
                <p>{b.notes}</p>
                <div className="history-wrap">
                  <table className="history-table">
                    <thead>
                      <tr>
                        <th>Actual time</th>
                        <th>Step</th>
                        <th>Tray / shelf</th>
                        <th>Core</th>
                        <th>Staff</th>
                        <th>Note</th>
                        <th className="no-print" />
                      </tr>
                    </thead>
                    <tbody>
                      {b.events
                        .slice()
                        .sort((a: any, b: any) => a.enteredAt - b.enteredAt)
                        .map((e: any) => {
                          const isVoid = b.events.some(
                            (v: any) => v.type === "void" && v.ref === e.id,
                          );
                          return (
                            <tr key={e.id} className={isVoid ? "muted" : ""}>
                              <td>
                                {C.localDateTime(
                                  e.type === "clock_fix" ? e.valueAt : e.at,
                                )}
                                {e.enteredAt - e.at > 60000 && (
                                  <small>
                                    Entered {C.localDateTime(e.enteredAt)}
                                  </small>
                                )}
                              </td>
                              <td>
                                {names[e.type] || e.type}
                                {isVoid && <strong>Corrected / voided</strong>}
                              </td>
                              <td>
                                {b.trays.find((t: any) => t.id === e.tray)
                                  ?.label || "—"}
                              </td>
                              <td>
                                {C.fmt(e.c)} °C
                                {e.held15 != null && (
                                  <small>
                                    15 s: {e.held15 ? "Yes" : "Not confirmed"}
                                  </small>
                                )}
                              </td>
                              <td>{e.staff}</td>
                              <td>{e.note || e.reason}</td>
                              <td className="no-print">
                                {[
                                  "raw_check",
                                  "cook_check",
                                  "cook_batch_check",
                                  "cool_check",
                                ].includes(e.type) &&
                                  !isVoid && (
                                    <button
                                      className="text-button"
                                      onClick={() => manual(e)}
                                    >
                                      Correct
                                    </button>
                                  )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <div className="actions no-print">
                  <button className="secondary" onClick={() => manual()}>
                    Add a missed reading
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      setError("");
                      setModal({ kind: "clock", at: "", reason: "" });
                    }}
                  >
                    Correct oven-out time
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      setModal({ kind: "note", note: "", flag: false })
                    }
                  >
                    Add a note
                  </button>
                  <button className="secondary" onClick={() => window.print()}>
                    Print record
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      download(
                        "Scottys_Wing_Records_" + today() + ".csv",
                        C.csv({ schema: 1, batches: [b] }),
                        "text/csv;charset=utf-8",
                      )
                    }
                  >
                    Export CSV
                  </button>
                </div>
                <details className="no-print">
                  <summary>Record a discard</summary>
                  <button
                    className="secondary"
                    onClick={() => setModal({ kind: "discard", note: "" })}
                  >
                    Record discard
                  </button>
                </details>
              </div>
            </>
          )}
        </main>
        <footer className="footer">
          <strong>Good Food = Good Mood</strong>
          <span> Keep this tab open for on-screen reminders and sound.</span>
          <button
            className="text-button"
            onClick={() => setModal({ kind: "guidance" })}
          >
            Temperature rules
          </button>
        </footer>
      </div>
      {modal && (
        <Modal
          onClose={() => {
            setModal(null);
            setError("");
          }}
        >
          {modal.kind === "manager" ? (
            <>
              <h2>Records & backup</h2>
              <p>
                Keep a copy after each shift. JSON restores records; CSV opens
                in Excel.
              </p>
              <div className="actions">
                <button
                  onClick={() =>
                    Promise.resolve(
                      download(
                        "Scottys_Wing_Backup_" + today() + ".json",
                        wingsBackup(state),
                      ),
                    ).catch((e: Error) => notify(e.message))
                  }
                >
                  Download backup
                </button>
                <button
                  onClick={() =>
                    download(
                      "Scottys_Wing_Records_" + today() + ".csv",
                      C.csv({ schema: 1, batches }),
                      "text/csv;charset=utf-8",
                    )
                  }
                >
                  Export CSV
                </button>
              </div>
              <Field
                label="Restore / merge backup"
                name="wingImport"
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
              <h3>Batch records</h3>
              {batches.map((b: any) => (
                <div className="list-item" key={b.id}>
                  <b>{b.name}</b>
                  <button
                    onClick={() => {
                      setSelected(b.id);
                      setScreen("history");
                      setModal(null);
                    }}
                  >
                    Open
                  </button>
                </div>
              ))}
              <p>
                No automatic temperature readings are taken. Staff must use the
                probe.
              </p>
            </>
          ) : modal.kind === "guidance" ? (
            <>
              <h2>Temperature rules</h2>
              <div className="numbered-steps">
                <p>
                  <strong>Cook:</strong> verify ≥74°C for 15 seconds in several
                  large wings on each tray. The 20-minute oven timer is a
                  reference, not a passing result.
                </p>
                <p>
                  <strong>Cool:</strong> the source workflow uses oven-out as
                  the conservative clock start. Rack and transfer time count.
                </p>
                <p>
                  <strong>Per-tray deadlines:</strong> ≤20°C by oven-out + 2
                  hours, then ≤4°C by the earlier of that tray’s first
                  qualifying ≤20°C time + 4 hours or oven-out + 6 hours.
                </p>
                <p>
                  <strong>Keep chilled:</strong> ≤4°C. The 72-hour use-by is the
                  source application’s house limit for never-frozen stock.
                </p>
              </div>
              <p className="notice">
                Missing or late checks remain on hold. Add earlier readings only
                from real records; corrections preserve originals.
              </p>
              <p className="source-links">
                <a
                  href="https://www.hamilton.ca/sites/default/files/2024-07/Food-Handler-Training-Manual-ENGLISH-APRIL2023.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Ontario food-handler guide referenced by the original artifact
                </a>
                <br />
                <a
                  href="https://www.hpph.ca/health-topics/food-and-nutrition/safe-food-handling/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Huron Perth Public Health
                </a>
              </p>
              <p>
                Encoded workflow: record ≥74°C for 15 seconds for the cook;
                ≤20°C by oven-out + 2 hours; ≤4°C by the earlier of the first
                qualifying ≤20°C check + 4 hours or oven-out + 6 hours.
              </p>
              <p>
                Missing and late checks require review. The 20-minute oven timer
                is a reference. The 72-hour use-by is the source application’s
                house limit.
              </p>
            </>
          ) : (
            <form onSubmit={submitModal}>
              <h2>
                {modal.kind === "manual"
                  ? modal.original
                    ? "Correct a reading"
                    : "Add a missed reading"
                  : modal.kind === "clock"
                    ? "Correct oven-out time"
                    : modal.kind === "start-cook"
                      ? "Start cooking from cold"
                      : modal.kind === "discard"
                        ? "Record discard"
                        : "Add a note"}
              </h2>
              {modal.kind === "manual" && (
                <>
                  <p>
                    Use an actual measurement and time from a real record.
                    Originals remain visible.
                  </p>
                  <label>
                    Step
                    <select
                      disabled={!!modal.original}
                      value={modal.type}
                      onChange={(e) =>
                        setModal({ ...modal, type: e.target.value })
                      }
                    >
                      {[
                        "cool_check",
                        "cook_check",
                        "raw_check",
                        "cook_batch_check",
                      ].map((x) => (
                        <option key={x} value={x}>
                          {names[x]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!["raw_check", "cook_batch_check"].includes(modal.type) && (
                    <label>
                      Tray / shelf
                      <select
                        value={modal.tray}
                        onChange={(e) =>
                          setModal({ ...modal, tray: e.target.value })
                        }
                      >
                        {b.trays.map((t: any) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <Field
                    label="Actual wing core (°C)"
                    name="manualTemp"
                    value={modal.temp}
                    onChange={(e) =>
                      setModal({ ...modal, temp: e.target.value })
                    }
                  />
                  <Field
                    label="Actual measurement time (Toronto)"
                    name="manualAt"
                    type="datetime-local"
                    value={modal.at}
                    onChange={(e) => setModal({ ...modal, at: e.target.value })}
                  />
                  {["cook_check", "cook_batch_check"].includes(modal.type) && (
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={modal.held15}
                        onChange={(e) =>
                          setModal({ ...modal, held15: e.target.checked })
                        }
                      />
                      At least 15 seconds at ≥74°C
                    </label>
                  )}
                </>
              )}
              {modal.kind === "clock" && (
                <Field
                  label="Actual oven-out time (Toronto)"
                  name="clockAt"
                  type="datetime-local"
                  value={modal.at}
                  onChange={(e) => setModal({ ...modal, at: e.target.value })}
                />
              )}{" "}
              {["manual", "clock"].includes(modal.kind) && (
                <label>
                  Reason / source
                  <textarea
                    required
                    minLength={4}
                    value={modal.reason}
                    onChange={(e) =>
                      setModal({ ...modal, reason: e.target.value })
                    }
                  />
                </label>
              )}
              {modal.kind === "start-cook" && (
                <Field
                  label="Warmest wing core now (°C)"
                  name="startTemp"
                  value={modal.temp}
                  onChange={(e) => setModal({ ...modal, temp: e.target.value })}
                />
              )}{" "}
              {["note", "discard"].includes(modal.kind) && (
                <>
                  <label>
                    Note
                    <textarea
                      required
                      value={modal.note}
                      onChange={(e) =>
                        setModal({ ...modal, note: e.target.value })
                      }
                    />
                  </label>
                  {modal.kind === "note" && (
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={modal.flag}
                        onChange={(e) =>
                          setModal({ ...modal, flag: e.target.checked })
                        }
                      />
                      Request manager review
                    </label>
                  )}
                </>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary" disabled={saving}>
                Save with actual records
              </button>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}

function WingDetail({
  b,
  v,
  timeLeft,
  action,
  startRound,
  busy,
  history,
  home,
}: any) {
  const readings = (
    <div className="readings">
      {v.trays.map((t: any) => (
        <div key={t.id} className={"reading " + (t.cold ? "good" : "")}>
          <strong>{t.label}</strong>
          <div className="reading-temp">
            {C.fmt(t.latest?.c)}
            <span className="mini"> °C</span>
          </div>
          <small>
            {t.latest
              ? "Checked " + C.localTime(t.latest.at)
              : t.cook
                ? "Cook checked at " + C.localTime(t.cook.at)
                : "No cooling reading yet"}
          </small>
        </div>
      ))}
    </div>
  );
  return (
    <>
      {v.status === "cooking" ? (
        <section className="hero-panel">
          <div className="eyebrow">Top oven reference</div>
          <h1>Cooking in progress.</h1>
          <div className="timer">{timeLeft(v.nextDue)}</div>
          <div className="timer-label">
            20-minute reference timer · a probe check is still required
          </div>
          <div className="actions">
            <button
              className="primary large"
              disabled={busy}
              onClick={() => action("out")}
            >
              Wings out now, check the cook
            </button>
          </div>
          <p className="help" style={{ marginTop: 18 }}>
            Press when the first tray leaves the oven. That starts the
            conservative cooling clock.
          </p>
        </section>
      ) : v.status === "brining" ? (
        <section className="hero-panel">
          <div className="eyebrow">18–20 hour fridge rest</div>
          <h1>Keep the raw wings cold.</h1>
          <div className="timer">{timeLeft(v.nextDue)}</div>
          <p>
            Cook from {C.localDateTime(v.nextDue)} to{" "}
            {C.localDateTime(v.restEnd)}.<br />
            Keep at ≤4°C, skin side up, with space between wings.
          </p>
          <div className="actions">
            <button
              className="primary large"
              onClick={() => action("start-cook")}
            >
              Start cooking
            </button>
          </div>
          <p className="help">
            Check the original raw use-by. The rest does not restart it.
          </p>
        </section>
      ) : v.status === "cookcheck" ? (
        <section className="hero-panel">
          <div className="eyebrow">Cook check</div>
          <h1>Check the largest wings.</h1>
          <p>
            Probe several large wings on every tray. Record the lowest centre
            temperature and confirm 15 seconds at ≥74°C.
          </p>
          <div className="actions">
            <button
              className="primary large"
              onClick={() => startRound("cook")}
            >
              Check the trays
            </button>
          </div>
        </section>
      ) : v.status === "transfer" ? (
        <section className="hero-panel">
          <div className="eyebrow">Cook confirmed</div>
          <h1>Into the cooler promptly.</h1>
          <p>
            Transfer to fresh trays in a spaced single layer. Keep airflow
            around the trays.
            <br />
            Rack and transfer time are already on the clock.
          </p>
          <div className="actions">
            <button
              className="primary large"
              disabled={busy}
              onClick={() => action("cooler")}
            >
              All trays are in the cooler now
            </button>
          </div>
          <button className="text-button" onClick={() => startRound("cool")}>
            Record a temperature first
          </button>
        </section>
      ) : v.status === "cooling" ? (
        <>
          <section className="hero-panel">
            <div className="eyebrow">Next temperature check</div>
            <h1>Keep cooling.</h1>
            <div className="timer">{timeLeft(v.nextDue)}</div>
            <div className="timer-label">
              Next check at {C.localTime(v.nextDue)} · check sooner if needed
            </div>
            <div className="actions">
              <button
                className="primary large"
                onClick={() => startRound("cool")}
              >
                Record tray temperatures
              </button>
            </div>
          </section>
          {readings}
        </>
      ) : v.status === "cooled" ? (
        <>
          <section className="hero-panel">
            <span className="tag good">All tracked cooling checks passed</span>
            <h1 style={{ marginTop: 18 }}>Every tray has a ≤4°C reading.</h1>
            <p>
              Cover, label and keep refrigerated. Confirm that all trays are
              packed.
            </p>
            <div className="actions">
              <button
                className="primary large"
                disabled={busy}
                onClick={() => action("pack")}
              >
                Covered, labelled & packed
              </button>
            </div>
            <button className="text-button" onClick={() => startRound("cool")}>
              Take another temperature check
            </button>
          </section>
          {readings}
        </>
      ) : v.status === "packed" ? (
        <>
          <section className="hero-panel">
            <div className="eyebrow">Batch recorded</div>
            <h1>Covered, labelled and chilled.</h1>
            <p>
              Packed at {C.localDateTime(v.packed)}.<br />
              House chilled use-by: <strong>{C.localDateTime(v.useBy)}</strong>,
              if never frozen.
            </p>
            <div className="actions">
              <button className="primary large" onClick={home}>
                Back to batches
              </button>
              <button className="secondary" onClick={history}>
                Print this record
              </button>
            </div>
          </section>
          {readings}
        </>
      ) : v.status === "discarded" ? (
        <section className="hero-panel">
          <h1>Discard recorded.</h1>
          <p>The readings and disposition remain in the batch history.</p>
          <button className="primary" onClick={history}>
            View record
          </button>
        </section>
      ) : (
        <>
          <section className="panel">
            <h2>Keep the measurements coming.</h2>
            <p>
              Only recorded evidence can establish the cooling checks. Add
              missed readings only from actual earlier records.
            </p>
            <div className="actions">
              <button
                className="primary large"
                onClick={() => startRound("cool")}
              >
                Record current tray temperatures
              </button>
              <button className="secondary" onClick={history}>
                Open the full record
              </button>
            </div>
          </section>
          {readings}
        </>
      )}
    </>
  );
}
