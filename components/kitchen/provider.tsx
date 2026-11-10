"use client";
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as core from "@/lib/core/kitchen.mjs";
import WasteCore from "@/lib/core/waste.js";
import WingCore from "@/lib/core/wings.js";
import {
  KitchenState,
  KitchenEvent,
  emptyState,
  readLocal,
  writeLocal,
  uid,
  clone,
  download,
  today,
} from "@/lib/local";
const C: any = core,
  W: any = WasteCore,
  G: any = WingCore,
  Context = createContext<any>(null);
export const useKitchen = () => useContext(Context);
export function KitchenProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<KitchenState>(emptyState),
    ref = useRef(state),
    [ready, setReady] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [user, setUser] = useState<any>(null),
    [config, setConfig] = useState<any>(null),
    [client, setClient] = useState<SupabaseClient | null>(null),
    [storageError, setStorageError] = useState("");
  const syncTask = useRef<Promise<void> | null>(null);
  const locked = useRef(false),
    saveQueue = useRef(Promise.resolve()),
    authRef = useRef<SupabaseClient | null>(null),
    retry = useRef(0);
  const notify = useCallback((s: string) => setMessage(s), []);
  const update = useCallback(async (fn: (s: KitchenState) => KitchenState) => {
    const next = fn(clone(ref.current));
    ref.current = next;
    setState(next);
    const job = saveQueue.current
      .catch(() => {})
      .then(() => writeLocal("state", next, "main"));
    saveQueue.current = job;
    try {
      await job;
      setStorageError("");
    } catch (e) {
      setStorageError((e as Error).message);
      throw e;
    }
    return next;
  }, []);
  const request = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const auth = authRef.current;
      if (!auth)
        throw Error("Configure Supabase in Vercel, then sign in from Sync.");
      const { data } = await auth.auth.getSession();
      if (!data.session)
        throw Error("Sign in from Sync to back up this device.");
      if (ref.current.owner && ref.current.owner !== data.session.user.id)
        throw Error(
          "Device records belong to another account. Export a backup before changing account.",
        );
      const r = await fetch(url, {
        ...options,
        cache: "no-store",
        headers: {
          ...options.headers,
          Authorization: "Bearer " + data.session.access_token,
        },
      });
      let dataOut;
      try {
        dataOut = await r.json();
      } catch {
        throw Error("The server response could not be confirmed.");
      }
      if (!r.ok || (dataOut.status && dataOut.status !== "success"))
        throw Error(
          dataOut.message ||
            "Operation unconfirmed. Local records remain saved.",
        );
      return dataOut;
    },
    [],
  );
  const addEvents = useCallback(
    async (events: KitchenEvent[]) =>
      update((s) => ({ ...s, events: C.mergeEvents(s.events, events) })),
    [update],
  );
  const addEvent = useCallback(
    async (
      kind: string,
      entityId: string,
      data: any,
      at = Date.now(),
      id = uid(),
    ) => {
      const e = { id, kind, entityId, at, data: clone(data) };
      await addEvents([e]);
      return e;
    },
    [addEvents],
  );
  const sync = useCallback(() => {
    if (syncTask.current) return syncTask.current;
    const job = (async () => {
      locked.current = true;
      setBusy(true);
      try {
        await saveQueue.current;
        const a = authRef.current;
        if (!a) throw Error("Supabase is not configured.");
        const {
          data: { user: u },
          error,
        } = await a.auth.getUser();
        if (error || !u)
          throw Error("Sign in from Sync to back up this device.");
        if (ref.current.owner && ref.current.owner !== u.id)
          throw Error(
            "Device records belong to another account. Export a backup before changing account.",
          );
        await update((s) => ({ ...s, owner: u.id }));
        let more = true;
        while (more) {
          const current = ref.current,
            chunk = current.events
              .filter((e) => !current.acked.includes(e.id))
              .slice(0, 40);
          const r = await request("/api/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              events: chunk,
              since: current.cursor,
              catalog:
                current.catalogAcked &&
                current.catalogSentAt === (current.catalogAt || 0)
                  ? []
                  : current.source,
              catalogAt: current.catalogAt || 0,
            }),
          });
          if (!Array.isArray(r.ack) || chunk.some((e) => !r.ack.includes(e.id)))
            throw Error("Supabase did not acknowledge every record.");
          await update((s) => ({
            ...s,
            events: C.mergeEvents(s.events, r.events || []),
            acked: [
              ...new Set([
                ...s.acked,
                ...r.ack,
                ...r.events.map((e: KitchenEvent) => e.id),
              ]),
            ],
            cursor: r.cursor,
            catalogAcked: true,
            catalogSentAt: current.catalogAt || 0,
            ...(r.catalog?.length && (r.catalogAt || 0) >= (s.catalogAt || 0)
              ? { source: r.catalog, catalogAt: r.catalogAt || 0 }
              : {}),
          }));
          more =
            r.more ||
            ref.current.events.some((e) => !ref.current.acked.includes(e.id));
        }
        const used = new Set(
          ref.current.events
            .filter((e) => e.kind === "invoice")
            .flatMap((e) => e.data.attachments.map((x: any) => x.id)),
        );
        for (const file of await readLocal("files"))
          if (!file.synced && used.has(file.id)) {
            const bytes = await file.blob.arrayBuffer(),
              digest = [
                ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
              ]
                .map((n) => n.toString(16).padStart(2, "0"))
                .join(""),
              meta = {
                id: file.id,
                hash: digest,
                size: file.blob.size,
                type: file.type || file.blob.type,
                name: file.name,
              };
            const p = await request("/api/files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...meta, mode: "prepare" }),
            });
            if (!p.confirmed) {
              const { error } = await a.storage
                .from(config?.bucket || "vision-attachments")
                .uploadToSignedUrl(p.key, p.token, file.blob, {
                  contentType: meta.type,
                });
              if (error)
                throw Error("Receipt upload was not confirmed. Retry Sync.");
              await request("/api/files", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...meta, mode: "complete" }),
              });
            }
            await writeLocal("files", { ...file, synced: true });
          }
        await update((s) => ({ ...s, lastSync: Date.now() }));
        retry.current = 0;
        notify("Entries and attached files confirmed in Supabase.");
      } finally {
        locked.current = false;
        setBusy(false);
        syncTask.current = null;
      }
    })();
    syncTask.current = job;
    return job;
  }, [update, request, config, notify]);
  useEffect(() => {
    let cancelled = false;
    let subscription: any;
    async function boot() {
      try {
        let s = { ...emptyState(), ...(await readLocal("state", "main")) };
        if (!s.source.length) {
          const r = await fetch("/ingredient-cache.json");
          const seed = await r.json();
          s.source = (Array.isArray(seed) ? seed : seed.items || []).map(
            (x: any) => ({ ...x, confirmed: false }),
          );
        }
        // Preserve standalone logger data from the same origin. New React loggers write events directly.
        const imported: KitchenEvent[] = [];
        const rawW = localStorage.getItem("scottys-waste-log-v1");
        if (rawW) {
          const w = W.validateStore(JSON.parse(rawW));
          if (!s.legacyImported)
            for (const x of w.items)
              imported.push({
                id: uid(),
                kind: "ingredient",
                entityId: x.id,
                at: Date.now(),
                data: x,
              });
          for (const r of w.records)
            imported.push({
              id: "waste:" + r.id,
              kind: "waste",
              entityId: r.id,
              at: r.at,
              data: r,
            });
          for (const r of w.voids)
            imported.push({
              id: "waste-void:" + r.id,
              kind: "waste_void",
              entityId: r.recordId,
              at: r.at,
              data: r,
            });
          if (
            !s.events.some(
              (e: KitchenEvent) =>
                e.kind === "settings" && e.entityId === "waste-lists",
            )
          )
            imported.push({
              id: uid(),
              kind: "settings",
              entityId: "waste-lists",
              at: Date.now(),
              data: { employees: w.employees, reasons: w.reasons },
            });
        }
        const rawG = localStorage.getItem("scottys-wing-check-v1");
        if (rawG) {
          const g = G.validateStore(JSON.parse(rawG));
          for (const b of g.batches) {
            const { events, round, ...data } = b;
            imported.push({
              id: "wingbatch:" + b.id,
              kind: "wing_batch",
              entityId: b.id,
              at: b.createdAt,
              data,
            });
            for (const e of events)
              imported.push({
                id: "wing:" + b.id + ":" + e.id,
                kind: "wing_event",
                entityId: b.id,
                at: e.at,
                data: e,
              });
          }
        }
        s.events = C.mergeEvents(s.events, imported);
        s.legacyImported = true;
        await writeLocal("state", s, "main");
        if (cancelled) return;
        ref.current = s;
        setState(s);
        setReady(true);
        const r = await fetch("/api/config"),
          c = await r.json();
        setConfig(c);
        if (c.url && c.anonKey) {
          const a = createClient(c.url, c.anonKey);
          authRef.current = a;
          setClient(a);
          const { data } = await a.auth.getUser();
          setUser(data.user);
          subscription = a.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user || null);
          }).data.subscription;
        }
        if ("serviceWorker" in navigator)
          navigator.serviceWorker
            .register("/sw.js")
            .catch(() => notify("Offline shell setup could not be confirmed."));
      } catch (e) {
        setStorageError((e as Error).message);
        notify((e as Error).message);
      }
    }
    boot();
    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, [notify]);
  const pending = state.events.filter(
    (e) => !state.acked.includes(e.id),
  ).length;
  useEffect(() => {
    if (!ready || !state.autoSync || !user) return;
    const run = () => {
      if (navigator.onLine && !locked.current)
        sync().catch((e) => {
          retry.current = Math.min(retry.current + 1, 5);
          notify(e.message);
        });
    };
    const timer = setTimeout(run, 1800 * Math.max(1, 2 ** retry.current));
    const interval = setInterval(run, 30000);
    window.addEventListener("online", run);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener("online", run);
    };
  }, [ready, state.autoSync, pending, user, sync, notify]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 7000);
    return () => clearTimeout(t);
  }, [message]);
  async function backup() {
    await saveQueue.current;
    download("Scottys_Vision_Backup_" + today() + ".json", {
      visionSchema: 1,
      exportedAt: Date.now(),
      state: ref.current,
      attachmentNote:
        "Original attachment bytes are separate. Sync files and keep originals.",
    });
  }
  async function importBackup(file: File, rebind = false) {
    if (file.size > 30 * 1024 * 1024)
      throw Error("Choose a JSON backup under 30 MB.");
    const v = JSON.parse(await file.text());
    let incoming: KitchenEvent[] = [];
    if (v.visionSchema === 1) {
      if (!Array.isArray(v.state?.events))
        throw Error("Invalid Vision backup.");
      if (v.state.owner && v.state.owner !== ref.current.owner && !rebind)
        throw Error(
          "Confirm ownership transfer for a backup from another Site/account.",
        );
      incoming = v.state.events;
    } else if (v.records && v.items) {
      const w = W.validateStore(v);
      incoming = [
        ...w.records.map((r: any) => ({
          id: "waste:" + r.id,
          kind: "waste",
          entityId: r.id,
          at: r.at,
          data: r,
        })),
        ...w.voids.map((r: any) => ({
          id: "waste-void:" + r.id,
          kind: "waste_void",
          entityId: r.recordId,
          at: r.at,
          data: r,
        })),
        ...w.items.map((x: any) => ({
          id: uid(),
          kind: "ingredient",
          entityId: x.id,
          at: Date.now(),
          data: x,
        })),
        {
          id: uid(),
          kind: "settings",
          entityId: "waste-lists",
          at: Date.now(),
          data: { employees: w.employees, reasons: w.reasons },
        },
      ];
    } else if (v.batches) {
      const g = G.validateStore(v);
      for (const b of g.batches) {
        const { events, round, ...data } = b;
        incoming.push({
          id: "wingbatch:" + b.id,
          kind: "wing_batch",
          entityId: b.id,
          at: b.createdAt,
          data,
        });
        for (const e of events)
          incoming.push({
            id: "wing:" + b.id + ":" + e.id,
            kind: "wing_event",
            entityId: b.id,
            at: e.at,
            data: e,
          });
      }
    } else throw Error("Unrecognized backup.");
    for (const e of incoming) {
      if (!e.id || !e.entityId || !e.data || !Number.isSafeInteger(e.at))
        throw Error("Invalid event in backup.");
    }
    await update((s) => ({
      ...s,
      events: C.mergeEvents(s.events, incoming),
      source: s.source.length ? s.source : v.state?.source || [],
      draft: s.draft || v.state?.draft || null,
    }));
    notify(
      "Backup merged locally. Sync will verify and back up the imported records.",
    );
  }
  const catalog = C.mergeCatalog(state.source, state.events);
  return (
    <Context.Provider
      value={{
        state,
        catalog,
        ready,
        user,
        client,
        config,
        busy,
        pending,
        storageError,
        update,
        addEvent,
        addEvents,
        request,
        sync,
        backup,
        importBackup,
        notify,
      }}
    >
      {children}
      {message && (
        <div id="toast" role="status">
          {message}
        </div>
      )}
    </Context.Provider>
  );
}
