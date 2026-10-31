/**
 * Spike panel store (#322 part 2): threads + active-repo ids in one JSON
 * file under the service data dir. Spike-only persistence — the production
 * build makes web documents real reviews (design doc §2). No migration:
 * a corrupt file is moved aside by the caller resetting data.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PanelThread } from "@unvibe/shared";

export interface PanelState { activeRepoIds: string[] | null; threads: Record<string, PanelThread> }

export class PanelStore {
  private file: string;
  private state: PanelState;
  constructor(dataDir: string) {
    this.file = path.join(dataDir, "spike-322-panel.json");
    this.state = { activeRepoIds: null, threads: {} };
    try {
      if (existsSync(this.file)) this.state = JSON.parse(readFileSync(this.file, "utf8")) as PanelState;
    } catch { this.state = { activeRepoIds: null, threads: {} }; }
  }
  private save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }
  get activeRepoIds(): string[] | null { return this.state.activeRepoIds; }
  setActiveRepoIds(ids: string[]): void { this.state.activeRepoIds = ids; this.save(); }
  thread(key: string): PanelThread | null { return this.state.threads[key] ?? null; }
  putThread(t: PanelThread): void { this.state.threads[t.pageKey] = t; this.save(); }
}
