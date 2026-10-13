/**
 * Test helper (#139): recognise a git subcommand when the args may carry
 * leading `git -c k=v` config pairs. Ingest/refresh fetches pass the gh
 * credential helper per command, so the subcommand is no longer at
 * `args[0]` — matching by position (`args[0] === "fetch"`) breaks silently
 * (the stub misses and the call falls through to real git or throws).
 */

/** The git subcommand in `args`, skipping leading `-c k=v` config pairs. */
export function gitSubcommand(args: string[]): string | undefined {
  const rest = [...args];
  while (rest.length >= 3 && rest[0] === "-c") rest.splice(0, 2);
  return rest[0];
}

/** True when the args invoke `git fetch` (any leading `-c` pairs skipped). */
export function isGitFetch(args: string[]): boolean {
  return gitSubcommand(args) === "fetch";
}
