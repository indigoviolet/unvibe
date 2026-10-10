/*global console process*/
 // Runs the service (tsx-free: uses built output if present, else delegates).
// `mise run dev` starts the service backend and the Vite dev server together.
// Both are plain child processes; Ctrl-C stops both.
import { spawn } from "node:child_process";

const procs = [];
function run(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { stdio: "inherit", shell: false, ...opts });
  procs.push(p);
  p.on("exit", (code) => {
    if (code !== 0 && code !== null) console.error(`[dev] ${cmd} exited with ${code}`);
  });
  return p;
}

// Service via tsx-less dev: build shared+service in watch is overkill for a
// scaffold; run vitest-style node with --experimental-strip-types is avoided.
// Simplest portable option: `npm run dev` in each workspace.
run("npm", ["run", "dev", "--workspace", "@unvibe/service", "--if-present"]);
run("npm", ["run", "dev", "--workspace", "@unvibe/web", "--if-present"]);

process.on("SIGINT", () => {
  for (const p of procs) p.kill("SIGINT");
  process.exit(0);
});
process.on("SIGTERM", () => {
  for (const p of procs) p.kill("SIGTERM");
  process.exit(0);
});
