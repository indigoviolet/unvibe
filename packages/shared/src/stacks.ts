/**
 * Stacked PRs (#321): shared types, implicit-stack inference and the
 * per-stack colour. Pure — no I/O.
 *
 * Native finding (checked 2026-10-31 with `gh api graphql`,
 * GITHUB_TOKEN unset): GitHub GraphQL exposes native stacks —
 * `PullRequest.stack: PullRequestStack { id, number, size, baseRefName,
 * entries(first:) { nodes { position, pullRequest } } }` and
 * `PullRequest.stackEntry: PullRequestStackEntry { position, stack }`.
 * The service prefers that when present and falls back to the implicit
 * inference below. Position 1 is closest to the default branch.
 */

export interface StackPrInput {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  /** True when the head lives in a fork (headRepository differs). */
  isCrossRepository?: boolean;
}

export interface StackMember {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
}

export interface PrStackInfo {
  /** 1-based position in review order (1 = closest to default branch). */
  position: number;
  size: number;
  rootNumber: number;
  /** Index into STACK_PALETTE, hashed from the stack root. */
  colorIndex: number;
  source: "native" | "inferred";
  /** Own chain in review order (bottom first), including this PR. */
  members: StackMember[];
  /** Sibling PR numbers branching off the same parent, when forked. */
  siblings?: number[];
  /** Base branch at the bottom of the chain (usually the default). */
  baseRefName: string;
}

export const MAX_STACK_DEPTH = 50;

/** Fixed palette: [light, dark] background + text pairs, legible in both themes. */
export const STACK_PALETTE: { light: { bg: string; fg: string }; dark: { bg: string; fg: string } }[] = [
  { light: { bg: "#fde68a", fg: "#713f12" }, dark: { bg: "#713f12", fg: "#fde68a" } },
  { light: { bg: "#a7f3d0", fg: "#064e3b" }, dark: { bg: "#064e3b", fg: "#a7f3d0" } },
  { light: { bg: "#bfdbfe", fg: "#1e3a5f" }, dark: { bg: "#1e3a5f", fg: "#bfdbfe" } },
  { light: { bg: "#fbcfe8", fg: "#701a3d" }, dark: { bg: "#701a3d", fg: "#fbcfe8" } },
  { light: { bg: "#ddd6fe", fg: "#3b1470" }, dark: { bg: "#3b1470", fg: "#ddd6fe" } },
  { light: { bg: "#fed7aa", fg: "#7c2d12" }, dark: { bg: "#7c2d12", fg: "#fed7aa" } },
  { light: { bg: "#99f6e4", fg: "#134e4a" }, dark: { bg: "#134e4a", fg: "#99f6e4" } },
  { light: { bg: "#fecaca", fg: "#7f1d1d" }, dark: { bg: "#7f1d1d", fg: "#fecaca" } },
];

/** FNV-1a hash of the stack root key → palette index. Stable. Pure. */
export function stackColorIndex(rootKey: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < rootKey.length; i++) {
    h ^= rootKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % STACK_PALETTE.length;
}

export function stackRootKey(owner: string, name: string, rootNumber: number): string {
  return `${owner}/${name}#${rootNumber}`;
}

/**
 * Infer implicit stacks from open PRs. A PR whose base is another open
 * PR's head is stacked on it. Fork heads (cross-repository) never act as
 * a parent key (branch names collide across repos). Cycles and chains
 * longer than MAX_STACK_DEPTH are capped. Only PRs in a stack of >=2
 * get an entry.
 */
export function inferStacks(prs: StackPrInput[], repoKey: string): Map<number, PrStackInfo> {
  const byNumber = new Map(prs.map((p) => [p.number, p]));
  const byHead = new Map<string, StackPrInput>();
  for (const p of prs) {
    if (p.isCrossRepository) continue;
    const prev = byHead.get(p.headRefName);
    if (!prev || p.number < prev.number) byHead.set(p.headRefName, p);
  }
  const childrenOf = new Map<number, StackPrInput[]>();
  for (const p of prs) {
    const parent = byHead.get(p.baseRefName);
    if (parent && parent.number !== p.number) {
      const list = childrenOf.get(parent.number) ?? [];
      list.push(p);
      childrenOf.set(parent.number, list);
    }
  }
  const parentOf = (p: StackPrInput): StackPrInput | undefined => {
    const parent = byHead.get(p.baseRefName);
    return parent && parent.number !== p.number ? parent : undefined;
  };
  // Longest descendant depth (memoised, cycle-safe).
  const depthMemo = new Map<number, number>();
  const descendantDepth = (p: StackPrInput, seen: Set<number>): number => {
    if (depthMemo.has(p.number)) return depthMemo.get(p.number)!;
    if (seen.has(p.number)) return 0;
    seen.add(p.number);
    let best = 0;
    for (const c of childrenOf.get(p.number) ?? []) best = Math.max(best, 1 + descendantDepth(c, seen));
    seen.delete(p.number);
    depthMemo.set(p.number, best);
    return best;
  };
  const out = new Map<number, PrStackInfo>();
  for (const pr of prs) {
    // Ancestors up to root (cycle/depth capped).
    const ancestors: StackPrInput[] = [];
    const seen = new Set<number>([pr.number]);
    let cur: StackPrInput | undefined = pr;
    while (ancestors.length < MAX_STACK_DEPTH) {
      const parent: StackPrInput | undefined = cur ? parentOf(cur) : undefined;
      if (!parent || seen.has(parent.number)) break;
      seen.add(parent.number);
      ancestors.unshift(parent);
      cur = parent;
    }
    // No parent and no children => not stacked.
    const kids = childrenOf.get(pr.number) ?? [];
    if (ancestors.length === 0 && kids.length === 0) continue;
    // Descendant path: follow the longest chain (ties: lowest number).
    const descendants: StackPrInput[] = [];
    let node = pr;
    const dseen = new Set<number>([pr.number]);
    while (descendants.length < MAX_STACK_DEPTH) {
      const cs = (childrenOf.get(node.number) ?? []).filter((c) => !dseen.has(c.number));
      if (cs.length === 0) break;
      cs.sort((a, b) => descendantDepth(b, new Set()) - descendantDepth(a, new Set()) || a.number - b.number);
      node = cs[0];
      dseen.add(node.number);
      descendants.push(node);
    }
    const chain = [...ancestors, pr, ...descendants];
    if (chain.length < 2) continue;
    const root = chain[0];
    // Siblings: other children of this PR's parent.
    let siblings: number[] | undefined;
    const parent: StackPrInput | undefined = parentOf(pr);
    if (parent) {
      const sibs = (childrenOf.get(parent.number) ?? []).map((c) => c.number).filter((n) => n !== pr.number);
      if (sibs.length > 0) siblings = sibs.sort((a, b) => a - b);
    }
    out.set(pr.number, {
      position: ancestors.length + 1,
      size: chain.length,
      rootNumber: root.number,
      colorIndex: stackColorIndex(`${repoKey}#${root.number}`),
      source: "inferred",
      members: chain.map((c) => ({ number: c.number, title: c.title, headRefName: c.headRefName, baseRefName: c.baseRefName })),
      ...(siblings ? { siblings } : {}),
      baseRefName: root.baseRefName,
    });
    void byNumber;
  }
  return out;
}

/** Build stack infos from native GitHub stack data. Pure. */
export function nativeStacks(
  prs: (StackPrInput & { stackNumber?: number; stackSize?: number; stackPosition?: number; stackBaseRefName?: string; stackMembers?: StackMember[] })[],
  repoKey: string,
): Map<number, PrStackInfo> {
  const out = new Map<number, PrStackInfo>();
  for (const pr of prs) {
    if (pr.stackNumber === undefined || !pr.stackMembers || pr.stackMembers.length < 2) continue;
    const members = [...pr.stackMembers].sort((a, b) => a.number - b.number);
    // Members arrive ordered by position from the service; keep that order.
    const ordered = pr.stackMembers;
    const root = ordered[0];
    out.set(pr.number, {
      position: pr.stackPosition ?? ordered.findIndex((m) => m.number === pr.number) + 1,
      size: pr.stackSize ?? ordered.length,
      rootNumber: root.number,
      colorIndex: stackColorIndex(`${repoKey}#${root.number}`),
      source: "native",
      members: ordered,
      baseRefName: pr.stackBaseRefName ?? root.baseRefName,
    });
    void members;
  }
  return out;
}
