"use client";
import React, { useEffect, useState } from "react";
import { useKitchen } from "./provider";
import { writeLocal } from "@/lib/local";
export function Background() {
  const { state, update, config, client, user, request, notify } = useKitchen(),
    [offline, setOffline] = useState(false),
    [push, setPush] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "VISION_OFFLINE_READY") setOffline(true);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    navigator.serviceWorker.ready.then((r) =>
      r.active?.postMessage({ type: "VISION_OFFLINE_STATUS" }),
    );
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);
  async function enablePush() {
    setBusy(true);
    try {
      if (!config?.vapidPublicKey)
        throw Error("Configure VAPID keys and the reminder scheduler first.");
      if (!("Notification" in window) || !("PushManager" in window))
        throw Error("This browser does not support Web Push.");
      if ((await Notification.requestPermission()) !== "granted")
        throw Error("Notifications were not enabled.");
      const r = await navigator.serviceWorker.ready,
        key = config.vapidPublicKey.replace(/-/g, "+").replace(/_/g, "/"),
        bytes = Uint8Array.from(
          atob(key.padEnd(Math.ceil(key.length / 4) * 4, "=")),
          (c) => c.charCodeAt(0),
        ),
        sub =
          (await r.pushManager.getSubscription()) ||
          (await r.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: bytes,
          }));
      await request("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      setPush(true);
      notify("Background kitchen reminders enabled for this browser.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disablePush() {
    setBusy(true);
    try {
      const r = await navigator.serviceWorker.ready,
        sub = await r.pushManager.getSubscription();
      if (sub) {
        await request("/api/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "remove", endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setPush(false);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h2>Offline & background work</h2>
      <p className="notice">
        {offline
          ? "Offline app ready, including the React bundles."
          : "Offline installation is being prepared. Keep this page open while connected."}
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={!!state.backgroundSync}
          onChange={(e) =>
            update((s: any) => ({
              ...s,
              backgroundSync: e.target.checked,
            })).catch((e: Error) => notify(e.message))
          }
        />
        Allow background backup when this browser supports Background Sync.
      </label>
      <small>
        Uses the current signed-in session. Open Vision again if the session
        expires. Browser and operating-system scheduling can delay background
        work.
      </small>
      <div className="actions">
        <button
          disabled={busy || !user}
          onClick={push ? disablePush : enablePush}
        >
          {push
            ? "Disable background reminders"
            : "Enable background reminders"}
        </button>
      </div>
      <small>
        Web Push can deliver while the app is closed. It requires a configured
        server scheduler, VAPID keys, browser permission and connectivity.
      </small>
    </>
  );
}

export function BackgroundAgent() {
  const { state, config, client, user, notify } = useKitchen();
  useEffect(() => {
    if (!client || !user || !state.backgroundSync) {
      writeLocal("state", null, "backgroundAuth").catch(() => {});
      return;
    }
    let disposed = false;
    const save = async () => {
      const { data } = await client.auth.getSession();
      if (disposed || !data.session) return;
      await writeLocal(
        "state",
        {
          token: data.session.access_token,
          expiresAt: data.session.expires_at * 1000,
          workspaceId: state.workspaceId || user.id,
          url: config.url,
          anonKey: config.anonKey,
          bucket: config.bucket,
        },
        "backgroundAuth",
      );
      const r: any = await navigator.serviceWorker.ready;
      if (r.sync) await r.sync.register("vision-backup");
    };
    save().catch((e: Error) => notify(e.message));
    const listener = client.auth.onAuthStateChange(() => {
      save().catch(() => {});
    });
    return () => {
      disposed = true;
      listener.data.subscription.unsubscribe();
    };
  }, [
    client,
    user,
    state.backgroundSync,
    state.workspaceId,
    state.events.length,
    Object.keys(state.draftDirty || {}).length,
    config,
    notify,
  ]);
  return null;
}
