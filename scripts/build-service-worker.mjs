import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const h = createHash("sha256");
async function walk(dir) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const p = dir + "/" + entry.name;
    if (entry.isDirectory()) await walk(p);
    else h.update(p).update(await readFile(p));
  }
}
for (const d of ["app", "components", "lib"]) await walk(d);
h.update(await readFile("scripts/service-worker.template.js"));
await writeFile(
  "public/sw.js",
  (await readFile("scripts/service-worker.template.js", "utf8")).replace(
    "__BUILD_HASH__",
    h.digest("hex").slice(0, 16),
  ),
);
