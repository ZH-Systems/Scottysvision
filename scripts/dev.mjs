import { spawn } from "node:child_process";
// The managed preview supplies Vite-style flags; translate them for Next.
const args = process.argv.slice(2),
  nextArgs = [];
for (let i = 0; i < args.length; i++) {
  const x = args[i];
  if (x === "--strictPort") continue;
  if (x === "--host") {
    nextArgs.push("--hostname", args[++i] || "0.0.0.0");
    continue;
  }
  nextArgs.push(x);
}
if (!nextArgs.includes("--hostname")) nextArgs.push("--hostname", "0.0.0.0");
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "--webpack", ...nextArgs],
  { stdio: "inherit" },
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
