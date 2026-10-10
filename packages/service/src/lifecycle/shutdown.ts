/**
 * Clean-shutdown hook list (PRD §14 idle exit).
 *
 * Other modules (agent runner, store, job queue owners) register teardown
 * here so the idle-exit path — and SIGTERM/SIGINT handling — closes agent
 * subprocesses and the DB. Hooks run in reverse registration order; one
 * hook's failure never blocks the rest.
 */

export type ShutdownHook = () => void | Promise<void>;

export class ShutdownHooks {
  private hooks: ShutdownHook[] = [];

  /**
   * Register a teardown hook. Returns an unsubscribe function that
   * removes it (no-op when already removed).
   */
  onShutdown(fn: ShutdownHook): () => void {
    this.hooks.push(fn);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const i = this.hooks.indexOf(fn);
      if (i >= 0) this.hooks.splice(i, 1);
    };
  }

  count(): number {
    return this.hooks.length;
  }

  /** Run every hook, latest-registered first. Resolves when all settle. */
  async run(): Promise<void> {
    const pending = [...this.hooks].reverse();
    for (const fn of pending) {
      try {
        await fn();
      } catch {
        // One failing hook must not skip the rest (e.g. a dead agent
        // subprocess must not prevent closing the DB).
      }
    }
  }
}
