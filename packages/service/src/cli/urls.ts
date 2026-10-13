/** App URLs printed by the CLI (issue #108: the bookmarkable name). */

/** Token URL: open once to connect a browser (never a bookmark). */
export function serviceUrl(port: number, token: string): string {
  // Browsers resolve `*.localhost` to loopback themselves. The 127.0.0.1
  // URL stays valid (same service).
  return `http://unvibe.localhost:${port}/?token=${token}`;
}

/** The plain bookmark URL (no token: the cookie carries it after setup). */
export function bookmarkUrl(port: number): string {
  return `http://unvibe.localhost:${port}`;
}
