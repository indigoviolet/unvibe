#!/usr/bin/env node
/** `unvibe` entry: resolve config, ensure data dir + token, serve. */
import { loadOrCreateToken } from "./auth.js";
import { loadConfig } from "./config.js";
import { resolvePathFromLoginShell } from "./exec/index.js";
import { createApp, listen } from "./server.js";
import { dbFilePath } from "./store/index.js";
import { migrate, openDatabase } from "./store/index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const token = loadOrCreateToken(config.dataDir);

  // macOS gotcha (PRD §14): pick up the login-shell PATH so gh/git/agents resolve.
  try {
    const loginPath = await resolvePathFromLoginShell();
    if (loginPath) process.env.PATH = loginPath;
  } catch {
    // non-fatal: keep the inherited PATH
  }

  const db = openDatabase(dbFilePath(config.dataDir));
  migrate(db);

  const { app } = await createApp(token);
  const url = await listen(app, config);
  console.log(`Unvibe listening on ${url}/?token=${token}`);
}

await main();
