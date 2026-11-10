import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
const port = Number(process.env.VISION_SMOKE_PORT || 3002);
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
try {
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(Error("Server did not become ready: " + logs)),
      20000,
    );
    const consume = (b) => {
      logs += b.toString();
      if (logs.includes("Ready in")) {
        clearTimeout(deadline);
        resolve();
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(deadline);
      reject(Error("Server exited " + code + ": " + logs));
    });
  });
  const base = "http://127.0.0.1:" + port;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes("SCOTTY"));
  assert.ok(html.includes("kitchen-shell"));
  const c = await (await fetch(base + "/api/config")).json();
  assert.equal(typeof c.configured, "boolean");
  assert.equal("serviceRoleKey" in c, false);
  assert.equal("service" in c, false);
  assert.equal("GOOGLE_PRIVATE_KEY" in c, false);
  for (const [path, method] of [
    ["session", "GET"],
    ["catalog", "GET"],
    ["files", "GET"],
    ["sync", "POST"],
    ["vision", "POST"],
    ["operations", "GET"],
    ["operations", "POST"],
    ["workspaces", "GET"],
    ["workspaces", "POST"],
    ["ocr", "POST"],
    ["push", "POST"],
    ["reconciliation", "GET"],
    ["reconciliation", "POST"],
    ["cron/reminders", "GET"],
  ]) {
    const r = await fetch(base + "/api/" + path, {
      method,
      headers:
        method === "POST"
          ? { Origin: base, "Content-Type": "application/json" }
          : {},
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    assert.equal(r.status, 401, path);
    assert.equal((await r.json()).status, "error");
  }
  const foreign = await fetch(base + "/api/sync", {
    method: "POST",
    headers: {
      Origin: "https://untrusted.example",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(foreign.status, 403);
  const sw = await (await fetch(base + "/sw.js")).text();
  assert.ok(sw.includes("vision-react-"));
  assert.ok(!sw.includes("__BUILD_HASH__"));
  const manifest = await (await fetch(base + "/offline-manifest.json")).json();
  assert.ok(
    manifest.assets.some(
      (p) => p.endsWith(".js") && p.startsWith("/_next/static/"),
    ),
  );
  for (const path of manifest.assets) {
    const r = await fetch(base + path);
    assert.equal(r.status, 200, "Precached asset " + path);
  }
  console.log(
    "PASS production HTTP smoke: React shell, public-only configuration, authentication required on every data endpoint, foreign-origin write rejection, versioned offline worker.",
  );
} finally {
  if (child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
}
