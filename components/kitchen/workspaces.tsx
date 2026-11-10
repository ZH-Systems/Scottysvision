"use client";
import React, { useState, useEffect } from "react";
import { useKitchen } from "./provider";
import { Field } from "./ui";
import { date } from "@/lib/local";
export function Workspaces() {
  const { state, user, request, update, switchWorkspace, notify, sync } =
      useKitchen(),
    [spaces, setSpaces] = useState<any[]>(state.workspaces || []),
    [email, setEmail] = useState(""),
    [role, setRole] = useState("staff"),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (user)
      request("/api/workspaces")
        .then(async (r: any) => {
          setSpaces(r.workspaces);
          const active = r.workspaces.find(
            (x: any) => x.id === (state.workspaceId || user.id),
          );
          if (active)
            await update((s: any) => ({
              ...s,
              role: active.role,
              workspaces: r.workspaces,
            }));
        })
        .catch((e: Error) => notify(e.message));
  }, [user, state.workspaceId]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h2>Kitchen access</h2>
      <p>
        Staff use individual accounts. Members of the same kitchen share its
        records. A viewer can read; staff can log; managers can change prices,
        receive stock and post Sheets; the owner manages access.
      </p>
      <button
        disabled={busy || !user}
        onClick={() =>
          run(async () => {
            const r = await request("/api/workspaces");
            setSpaces(r.workspaces);
          })
        }
      >
        Refresh kitchens
      </button>
      <label>
        Active kitchen
        <select
          value={state.workspaceId || user?.id || ""}
          onChange={(e) => run(() => switchWorkspace(e.target.value))}
        >
          <option value="">Select kitchen</option>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.role}
            </option>
          ))}
        </select>
      </label>
      {state.role === "owner" && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await request("/api/workspaces", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email, role }),
                });
                notify("Kitchen membership updated.");
                setEmail("");
              });
            }}
          >
            <Field
              label="Existing Supabase user email"
              name="memberEmail"
              type="email"
              value={email}
              required
              onChange={(e) => setEmail(e.target.value)}
            />
            <label>
              Role
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {["viewer", "staff", "manager", "remove"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <button disabled={busy} className="primary">
              Update member
            </button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await request("/api/workspaces", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ mode: "rename", name }),
                });
                notify("Kitchen renamed. Refresh kitchens to see the name.");
              });
            }}
          >
            <Field
              label="Kitchen name"
              name="kitchenName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <button disabled={busy}>Rename kitchen</button>
          </form>
        </>
      )}
      <h2>Synced working drafts</h2>
      <p>
        Concurrent revisions remain separate. Restore a selected revision
        instead of overwriting current work silently.
      </p>
      <button disabled={busy || !user} onClick={() => run(() => sync())}>
        Refresh drafts
      </button>
      {(state.draftHeads || []).map((d: any) => (
        <article key={d.revision} className="panel list-item">
          <div>
            <b>
              {d.payload.kind} ·{" "}
              {d.payload.value?.name || d.payload.value?.vendor || d.draft_key}
            </b>
            <small>
              {date(d.updated_at)} ·{" "}
              {d.payload.value === null ? "Closed draft" : "Working draft"} ·{" "}
              {d.revision}
            </small>
          </div>
          {d.payload.value !== null && (
            <button
              onClick={() =>
                run(async () => {
                  const kind = d.payload.kind;
                  if (
                    (kind === "recipe" && state.draft) ||
                    (kind === "invoice" && state.invoiceDraft)
                  )
                    throw Error(
                      "Save or clear the current working draft first.",
                    );
                  await update((s: any) => ({
                    ...s,
                    draftParents: {
                      ...s.draftParents,
                      [d.draft_key]: d.revision,
                    },
                    ...(kind === "recipe"
                      ? { draft: d.payload.value }
                      : kind === "invoice"
                        ? { invoiceDraft: d.payload.value }
                        : d.payload.value),
                  }));
                  notify("Draft restored locally.");
                })
              }
            >
              Restore revision
            </button>
          )}
        </article>
      ))}
    </>
  );
}
