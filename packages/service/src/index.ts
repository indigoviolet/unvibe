#!/usr/bin/env node
/**
 * `unvibe` CLI entry (PRD §14).
 *
 * - No command → run the service in the foreground (backwards compatible
 *   with `mise run start` / `node packages/service/dist/index.js`).
 * - `start|stop|status|setup|open|token|doctor` → the matching CLI command
 *   (`src/cli/`). `start` daemonises unless `--foreground` is given.
 */
import { runCli, CLI_USAGE } from "./cli/commands.js";
import { serve } from "./serve.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    await serve();
    return;
  }
  if (argv[0] === "--help" || argv[0] === "-h") {
    console.log(CLI_USAGE);
    return;
  }
  const code = await runCli(argv);
  process.exit(code);
}

await main();
