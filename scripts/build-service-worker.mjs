import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { build } from "esbuild";
const assets = [
  "/",
  "/manifest.webmanifest",
  "/vision-icon.svg",
  "/vision-icon-192.png",
  "/vision-icon-512.png",
  "/ingredient-cache.json",
];
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = dir + "/" + e.name;
    if (e.isDirectory()) await walk(path);
    else if (!e.name.endsWith(".map"))
      assets.push("/_next/static/" + path.slice(".next/static/".length));
  }
}
await walk(".next/static");
assets.sort();
const hash = createHash("sha256")
  .update(JSON.stringify(assets))
  .update(await readFile("scripts/service-worker.template.js"))
  .update(await readFile("scripts/background-worker.js"))
  .digest("hex")
  .slice(0, 16);
const code = (await readFile("scripts/service-worker.template.js", "utf8"))
  .replace("__BUILD_HASH__", hash)
  .replace("__PRECACHE__", JSON.stringify(assets));
await build({
  stdin: {
    contents: code,
    resolveDir: process.cwd() + "/scripts",
    sourcefile: "service-worker.js",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: "public/sw.js",
  minify: true,
});
await writeFile(
  "public/offline-manifest.json",
  JSON.stringify({ cache: "vision-react-" + hash, assets }, null, 2),
);
console.log("Precached React shell and " + assets.length + " assets.");
