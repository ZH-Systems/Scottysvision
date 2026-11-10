"use client";
import React, { useState } from "react";
import { useKitchen } from "./provider";
import { Heading, Field, Modal } from "./ui";
import { date } from "@/lib/local";
export function SyncView({ onPost }: { onPost: (id: string) => void }) {
  const {
      state,
      user,
      client,
      config,
      pending,
      busy,
      update,
      sync,
      backup,
      importBackup,
      notify,
    } = useKitchen(),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [authBusy, setAuthBusy] = useState(false),
    [rebind, setRebind] = useState(false),
    [list, setList] = useState(false);
  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setAuthBusy(true);
    try {
      if (!client)
        throw Error("Set the Supabase environment variables and redeploy.");
      const { error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      setPassword("");
      notify(
        "Signed in. Local entries will back up automatically when enabled.",
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setAuthBusy(false);
    }
  }
  const voided = new Set(
      state.events
        .filter((e: any) => e.kind === "waste_void")
        .map((e: any) => e.data.recordId),
    ),
    postable = state.events
      .filter(
        (e: any) =>
          e.kind === "ingredient" ||
          (e.kind === "waste" && !voided.has(e.entityId)) ||
          (e.kind === "recipe" && e.data.finalized),
      )
      .sort((a: any, b: any) => b.at - a.at);
  return (
    <>
      <Heading
        title="Ready when the hotspot is."
        sub="Save on this device first. Synchronise when connected."
      >
        <button
          className="primary"
          disabled={busy}
          onClick={() => sync().catch((e: Error) => notify(e.message))}
        >
          {busy ? "Synchronising…" : "Sync now"}
        </button>
      </Heading>
      <div className="grid">
        <section className="panel">
          <div className="eyebrow">Device → Supabase backup</div>
          <h2>{pending} entries waiting</h2>
          <p>
            {state.lastSync
              ? "Last confirmed sync: " + date(state.lastSync)
              : "This device has not completed a sync."}
          </p>
          <p>
            Account: <b>{user?.email || "Sign in required to sync"}</b>
          </p>
          {!config?.configured && (
            <p className="notice warning">
              Supabase needs configuration in Vercel. Local entries remain on
              this device.
            </p>
          )}
          {!user ? (
            <form onSubmit={signIn}>
              <Field
                label="Email"
                name="authEmail"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Field
                label="Password"
                name="authPassword"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button className="primary" disabled={authBusy || !client}>
                Sign in to Vision
              </button>
            </form>
          ) : (
            <button
              className="quiet"
              onClick={async () => {
                await client.auth.signOut();
                notify(
                  "Signed out online. Device records remain saved locally.",
                );
              }}
            >
              Sign out
            </button>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={state.autoSync}
              onChange={(e) =>
                update((s: any) => ({
                  ...s,
                  autoSync: e.target.checked,
                })).catch((e: Error) => notify(e.message))
              }
            />
            Automatically back up while Vision is open and connected.
          </label>
          <small>
            Google Sheets writes always require a separate review and approval.
          </small>
        </section>
        <section className="panel">
          <div className="eyebrow">Keep a copy</div>
          <h2>Import & backup</h2>
          <div className="actions">
            <button
              onClick={() => backup().catch((e: Error) => notify(e.message))}
            >
              Download data backup
            </button>
            <label className="button" htmlFor="backupFile">
              Import logger / Vision backup
            </label>
          </div>
          <input
            id="backupFile"
            hidden
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f)
                importBackup(f, rebind).catch((e: Error) => notify(e.message));
              e.target.value = "";
            }}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={rebind}
              onChange={(e) => setRebind(e.target.checked)}
            />
            I own this backup and approve importing its records into this
            account, including a backup from the original Site.
          </label>
          <p className="muted">
            JSON backups contain records and drafts. Receipt image/PDF bytes are
            separate. Keep originals and use Sync to upload them.
          </p>
        </section>
        <section className="panel wide">
          <div className="eyebrow">Vision Google Sheets</div>
          <h2>Review before posting</h2>
          <p>
            Publish reviewed ingredients first. Waste posts a waste record plus
            a linked inventory decrease. Recipe cards post recipes and
            components without consuming stock.
          </p>
          {!config?.sheetsConfigured && (
            <p className="notice warning">
              Workbook access is not configured. Set the Google service-account
              variables, workbook ID and approved email list in Vercel to enable
              it.
            </p>
          )}
          <div className="actions">
            <button
              onClick={() => {
                location.hash = "ingredients";
              }}
            >
              Read ingredient list
            </button>
            <button onClick={() => setList(true)}>
              Review pending entries
            </button>
          </div>
          <p className="notice warning">
            Corrections to waste already posted in Sheets need manager
            reconciliation. Local corrections do not silently reverse posted
            stock.
          </p>
        </section>
        <section className="panel wide">
          <h2>Add Vision to the tablet home screen</h2>
          <ol>
            <li>
              Open this link in Chrome and sign in on both devices using the
              same Supabase account.
            </li>
            <li>
              Choose Install app or Add to Home screen from Chrome’s menu.
            </li>
            <li>Open Vision once online before disconnecting.</li>
          </ol>
          <p className="notice">
            The React app caches its shell after a successful online visit. Sync
            needs the app open and connected.
          </p>
          <small>
            Clearing browser storage erases unsynced records. Protect the tablet
            with a screen lock.
          </small>
        </section>
      </div>
      {list && (
        <Modal onClose={() => setList(false)}>
          <h2>Review for Vision Sheets</h2>
          <p>Nothing posts until the displayed rows are approved.</p>
          <div className="list">
            {postable.slice(0, 80).map((e: any) => (
              <article className="panel" key={e.id}>
                <b>{e.data.recipe?.name || e.data.itemName || e.data.name}</b>
                <small>
                  {e.kind} · {date(e.at)} ·{" "}
                  {state.postings[e.id]
                    ? "Posted / confirmed"
                    : "Not confirmed posted"}
                </small>
                <button
                  onClick={() => {
                    setList(false);
                    onPost(e.id);
                  }}
                >
                  Preview proposed rows
                </button>
              </article>
            ))}
          </div>
          {!postable.length && <p>No records to post yet.</p>}
        </Modal>
      )}
    </>
  );
}
export function Posting({ id, onClose }: { id: string; onClose: () => void }) {
  const { request, sync, state, update, addEvent, catalog, notify } =
      useKitchen(),
    [plan, setPlan] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function preview() {
    setBusy(true);
    try {
      await sync();
      const p = await request("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: id, mode: "preview" }),
      });
      if (p.alreadyConfirmed) {
        await update((s: any) => ({
          ...s,
          postings: { ...s.postings, [id]: p },
        }));
        notify("Already confirmed in Vision Sheets.");
        onClose();
        return;
      }
      setPlan(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!plan) return;
    setBusy(true);
    try {
      const p = await request("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: id,
          mode: "commit",
          approval: plan.approval,
        }),
      });
      await update((s: any) => ({
        ...s,
        postings: { ...s.postings, [id]: p },
      }));
      if (p.visionId) {
        const item = catalog.find((x: any) => x.id === plan.entityId);
        if (item)
          await addEvent("ingredient", item.id, {
            ...item,
            visionId: p.visionId,
          });
      }
      notify("Vision Sheets rows read back and confirmed.");
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setPlan(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal onClose={onClose}>
      <h2>
        {plan
          ? "Approve these Vision entries?"
          : "Preview proposed Vision rows"}
      </h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!plan ? (
        <>
          <p>
            This first reads the workbook and creates a plan. It does not write
            to Sheets.
          </p>
          <button disabled={busy} onClick={preview}>
            {busy ? "Reading…" : "Preview proposed rows"}
          </button>
        </>
      ) : (
        <>
          <p>{plan.summary}</p>
          {plan.blocks.map((b: any) => (
            <React.Fragment key={b.range}>
              <h3>
                {b.sheet} · {b.range}
              </h3>
              <div className="scroll-table">
                <table>
                  <tbody>
                    {b.rows.flatMap((row: any[], i: number) =>
                      row.map((v: any, j: number) => (
                        <tr key={i + ":" + j}>
                          <th>{b.headers[j]}</th>
                          <td>
                            {v == null || v === "" ? (
                              <i>Unknown / blank</i>
                            ) : (
                              String(v)
                            )}
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </React.Fragment>
          ))}
          <p className="notice warning">
            This writes the displayed rows to the configured workbook. Check the
            item, quantity, unit, price and date.
          </p>
          <div className="actions">
            <button className="primary" disabled={busy} onClick={commit}>
              Approve & post these rows
            </button>
            <button onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
    </Modal>
  );
}
