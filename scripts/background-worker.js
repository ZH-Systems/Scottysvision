import { createClient } from "@supabase/supabase-js";
import { mergeEvents } from "../lib/core/kitchen.mjs";
import { acknowledgeDrafts, prepareDrafts } from "../lib/core/drafts.mjs";
async function database() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("scottys-vision-kitchen", 1);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function read(key, store = "state") {
  const db = await database();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store),
      r =
        key === undefined
          ? t.objectStore(store).getAll()
          : t.objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function put(key, value, store = "state") {
  const db = await database();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    if (key === undefined) t.objectStore(store).put(value);
    else t.objectStore(store).put(value, key);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}
async function mutate(fn) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const t = db.transaction("state", "readwrite"),
      store = t.objectStore("state"),
      r = store.get("main");
    r.onsuccess = () => store.put(fn(r.result), "main");
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}
export async function backgroundSync() {
  const run = async () => {
    const auth = await read("backgroundAuth"),
      initial = await read("main");
    if (!auth || !initial?.backgroundSync || !initial.autoSync) return;
    if (auth.expiresAt < Date.now() + 10000)
      throw Error(
        "Background session expired. Open Vision to refresh sign-in.",
      );
    if ((initial.workspaceId || initial.owner) !== auth.workspaceId) return;
    const request = async (url, body) => {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + auth.token,
          "X-Vision-Workspace": auth.workspaceId,
        },
        body: JSON.stringify(body),
      });
      const x = await r.json();
      if (!r.ok || x.status !== "success")
        throw Error(x.message || "Background backup unconfirmed");
      return x;
    };
    await mutate((s) =>
      prepareDrafts(s, () => crypto.randomUUID(), Date.now()),
    );
    let more = true;
    while (more) {
      const s = await read("main");
      if (s.workspaceId !== auth.workspaceId) return;
      const chunk = s.events
          .filter((e) => !s.acked.includes(e.id))
          .slice(0, 40),
        drafts = s.role === "viewer" ? [] : (s.draftOutbox || []).slice(0, 40),
        r = await request("/api/sync", {
          events: chunk,
          since: s.cursor,
          catalog:
            s.role === "viewer" || s.role === "staff" || s.catalogAcked
              ? []
              : s.source,
          catalogAt: s.catalogAt || 0,
          drafts,
        });
      if (chunk.some((e) => !r.ack.includes(e.id)))
        throw Error("Background acknowledgment incomplete");
      await mutate((current) => {
        if (current.workspaceId !== auth.workspaceId) return current;
        return {
          ...acknowledgeDrafts(current, drafts, r.drafts),
          events: mergeEvents(current.events, r.events),
          acked: [
            ...new Set([
              ...current.acked,
              ...r.ack,
              ...r.events.map((e) => e.id),
            ]),
          ],
          cursor: r.cursor,
          catalogAcked: true,
          ...(r.catalog?.length &&
          (r.catalogAt || 0) >= (current.catalogAt || 0)
            ? { source: r.catalog, catalogAt: r.catalogAt }
            : {}),
          lastSync: Date.now(),
        };
      });
      const after = await read("main");
      more =
        r.more ||
        after.events.some((e) => !after.acked.includes(e.id)) ||
        (after.role !== "viewer" && (after.draftOutbox || []).length > 0);
    }
    const state = await read("main"),
      refs = new Set([
        ...state.events
          .filter((e) => e.kind === "invoice")
          .flatMap((e) => e.data.attachments.map((f) => f.id)),
        ...(state.invoiceDraft?.attachments || []).map((f) => f.id),
      ]),
      client = createClient(auth.url, auth.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    for (const file of await read(undefined, "files"))
      if (
        refs.has(file.id) &&
        !(file.syncedScopes || []).includes(auth.workspaceId)
      ) {
        const bytes = await file.blob.arrayBuffer(),
          hash = [
            ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          ]
            .map((n) => n.toString(16).padStart(2, "0"))
            .join(""),
          meta = {
            id: file.id,
            hash,
            size: file.blob.size,
            type: file.type || file.blob.type,
            name: file.name,
          },
          p = await request("/api/files", { ...meta, mode: "prepare" });
        if (!p.confirmed) {
          const { error } = await client.storage
            .from(auth.bucket)
            .uploadToSignedUrl(p.key, p.token, file.blob, {
              contentType: meta.type,
            });
          if (error) throw error;
          await request("/api/files", { ...meta, mode: "complete" });
        }
        await put(
          undefined,
          {
            ...file,
            synced: true,
            syncedScopes: [
              ...new Set([...(file.syncedScopes || []), auth.workspaceId]),
            ],
          },
          "files",
        );
      }
    for (const c of await self.clients.matchAll())
      c.postMessage({ type: "VISION_BACKGROUND_SYNC" });
  };
  if (self.navigator.locks)
    return self.navigator.locks.request("vision-sync", run);
  return run();
}
