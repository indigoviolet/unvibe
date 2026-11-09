#!/usr/bin/env node
/**
 * `unvibe` CLI entry (PRD §14).
 *
 * - No command → run the service in the foreground (backwards compatible
 *   with `mise run start` / `node packages/service/dist/index.js`).
 * - `start|stop|status|setup|open|token|doctor|update` → the matching CLI command
 *   (`src/cli/`). `start` daemonises unless `--foreground` is given.
 *
 * Tracing (issue #356, debug flavour): the instrumentation hooks must
 * install before the instrumented modules load — but in a bundle every
 * external import loads before any module body runs, so a plain prelude
 * import is too late (verified: fastify/http spans missing). The setup
 * therefore runs first here, and the app loads dynamically afterwards.
 * The loader is OTel-free and degrades to false in lean builds;
 * nothing records until the Debug switch turns it on.
 */
const { ensureTracingSetup } = await import("./traces/loader.js");
await ensureTracingSetup();

const [{ runCli, CLI_USAGE }, { serve }] = await Promise.all([
  import("./cli/commands.js"),
  import("./serve.js"),
]);

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
