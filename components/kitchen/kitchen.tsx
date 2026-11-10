"use client";
import React, { useEffect, useState } from "react";
import { KitchenProvider, useKitchen } from "./provider";
import { Recipes } from "./recipes";
import { Ingredients } from "./ingredients";
import { Invoices } from "./invoices";
import { Waste } from "./waste";
import { Wings } from "./wings";
import { SyncView, Posting } from "./sync";
import { Heading } from "./ui";
import { date, uid } from "@/lib/local";
import * as core from "@/lib/core/kitchen.mjs";
const C: any = core,
  tabs = [
    ["home", "Home"],
    ["recipes", "Recipes"],
    ["ingredients", "Ingredients"],
    ["waste", "Waste"],
    ["wings", "Wings"],
    ["invoices", "Invoices"],
    ["sync", "Sync & backup"],
  ];
export default function Kitchen() {
  return (
    <KitchenProvider>
      <Shell />
    </KitchenProvider>
  );
}
function Shell() {
  const { state, catalog, ready, pending, busy, storageError, update, notify } =
      useKitchen(),
    [screen, setScreen] = useState("home"),
    [startRecipe, setStartRecipe] = useState(false),
    [posting, setPosting] = useState<string | null>(null),
    [install, setInstall] = useState<any>(null);
  useEffect(() => {
    const route = () => {
      const s = location.hash.slice(1);
      setScreen(tabs.some((x) => x[0] === s) ? s : "home");
      window.scrollTo(0, 0);
    };
    route();
    window.addEventListener("hashchange", route);
    const prompt = (e: Event) => {
      e.preventDefault();
      setInstall(e);
    };
    window.addEventListener("beforeinstallprompt", prompt);
    return () => {
      window.removeEventListener("hashchange", route);
      window.removeEventListener("beforeinstallprompt", prompt);
    };
  }, []);
  const status = storageError
    ? "Local saving needs attention"
    : !ready
      ? "Opening local records…"
      : busy
        ? "Synchronising…"
        : pending
          ? `${pending} ${pending === 1 ? "entry" : "entries"} saved locally · waiting to sync`
          : "Saved locally" +
            (state.lastSync
              ? " · backed up " + date(state.lastSync)
              : " · not yet backed up");
  return (
    <div className="kitchen-shell">
      <header className="kitchen-header">
        <a className="brand" href="#home">
          <span className="brand-mark">S</span>
          <span>
            SCOTTY’S <small>VISION KITCHEN</small>
          </span>
        </a>
        <span id="status" role="status">
          {status}
        </span>
      </header>
      <nav className="kitchen-nav" aria-label="Kitchen tools">
        {tabs.map(([id, label]) => (
          <a
            key={id}
            href={"#" + id}
            aria-current={screen === id ? "page" : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <main
        className={["waste", "wings"].includes(screen) ? "module-main" : ""}
      >
        {storageError && (
          <p className="error" role="alert">
            {storageError}. Keep this screen open and export a backup. Do not
            clear browser storage.
          </p>
        )}
        {!ready ? (
          <p>Opening your kitchen…</p>
        ) : (
          <>
            {screen === "home" && (
              <>
                <Heading
                  title="Your kitchen, in one place."
                  sub="Make it. Record it. Know what it costs."
                />
                <div className="grid">
                  {[
                    [
                      "recipes",
                      "01 / MAKE",
                      "Recipe builder",
                      "Build a special as you work. See the ingredient cost live.",
                    ],
                    [
                      "waste",
                      "02 / RECORD",
                      "Waste logger",
                      "The familiar two-step form. Item, amount, employee.",
                    ],
                    [
                      "wings",
                      "03 / CHECK",
                      "Wing logger",
                      "One tray at a time. Actual times and probe readings.",
                    ],
                    [
                      "invoices",
                      "04 / CAPTURE",
                      "Invoices & receipts",
                      "Photograph on your S24 Ultra. Review details on either device.",
                    ],
                  ].map(([id, number, title, sub]) => (
                    <a className="card tool" href={"#" + id} key={id}>
                      <span className="tool-icon">{number}</span>
                      <span className="arrow">↗</span>
                      <b>{title}</b>
                      <p>{sub}</p>
                    </a>
                  ))}
                </div>
                <div className="actions">
                  <button
                    className="primary"
                    onClick={async () => {
                      try {
                        if (!state.draft)
                          await update((s: any) => ({
                            ...s,
                            draft: {
                              id: uid(),
                              name: "",
                              type: "BatchRecipe",
                              size: "Other / not pizza",
                              yieldQty: "",
                              yieldUnit: "ea",
                              sellPrice: "",
                              notes: "",
                              lines: [],
                              parentRevision: null,
                            },
                          }));
                        setStartRecipe(true);
                        location.hash = "recipes";
                      } catch (e) {
                        notify((e as Error).message);
                      }
                    }}
                  >
                    ＋ Start a recipe
                  </button>
                  <a className="button" href="#ingredients">
                    Review ingredient prices
                  </a>
                  {install && (
                    <button
                      onClick={async () => {
                        await install.prompt();
                        setInstall(null);
                      }}
                    >
                      Install on this tablet
                    </button>
                  )}
                </div>
                <div className="stat-grid">
                  <div className="panel">
                    <span className="metric">
                      {catalog.filter((x: any) => x.active).length}
                    </span>
                    <small>
                      ingredients available
                      <br />
                      {
                        catalog.filter((x: any) => x.active && x.confirmed)
                          .length
                      }{" "}
                      prices reviewed
                    </small>
                  </div>
                  <div className="panel">
                    <span className="metric">
                      {
                        C.currentRecipes(state.events).filter((x: any) =>
                          x.heads.some((e: any) => e.data.finalized),
                        ).length
                      }
                    </span>
                    <small>
                      recipes with a<br />
                      finalised card
                    </small>
                  </div>
                  <div className="panel">
                    <span className="metric">
                      {
                        state.events.filter((e: any) => e.kind === "invoice")
                          .length
                      }
                    </span>
                    <small>
                      invoice records
                      <br />
                      awaiting / saved review
                    </small>
                  </div>
                </div>
                <p className="notice">
                  Offline work saves on this device. Open{" "}
                  <a href="#sync">Sync & backup</a> when the hotspot is
                  available. Prices are CAD; missing costs stay unknown.
                </p>
                {!state.lastSync && (
                  <p className="notice warning">
                    Already used the downloaded loggers? Export their JSON
                    backups and import them here to bring those records across.
                  </p>
                )}
              </>
            )}
            {screen === "recipes" && (
              <Recipes onPost={setPosting} initialEditing={startRecipe} />
            )}{" "}
            {screen === "ingredients" && <Ingredients />}
            {screen === "invoices" && <Invoices />}
            {screen === "sync" && <SyncView onPost={setPosting} />}{" "}
            {["waste", "wings"].includes(screen) && (
              <p className="module-note">
                Saved on this device first. Use{" "}
                <a href="#sync">Sync & backup</a> to copy records online.
              </p>
            )}
            {screen === "waste" && <Waste />}
            {screen === "wings" && <Wings />}
          </>
        )}
      </main>
      {posting && <Posting id={posting} onClose={() => setPosting(null)} />}
    </div>
  );
}
