/**
 * Enclosing-unit rules (issue #133, stage 2).
 *
 * Ported from the `spike/diff-expand` harness (`harness/units.mjs`):
 * what counts as a unit per language, in tree-sitter node kinds, and the
 * walk that turns the smallest node covering the changed lines into the
 * chain of enclosing units. The walk only needs an adapter
 * (kind/parent/prev/rows/name), so the same rules drive tree-sitter here.
 *
 * Deliberate port choices (spike's known misses stay misses):
 * - `looseDoc` stays off: a doc comment separated from its function by a
 *   blank line is left out (or yields nothing when only it changed).
 * - `describe`/`it` blocks count as units (readers think of them that
 *   way); an ordinary callback inside one reads as one extra level.
 */
import type { EnclosingUnit } from "@unvibe/shared";

/** Minimal structural view of a tree-sitter node (version-proof). */
export interface UnitNode {
  type: string;
  text: string;
  parent: UnitNode | null;
  previousSibling: UnitNode | null;
  nextSibling: UnitNode | null;
  namedChildren: UnitNode[];
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  childForFieldName(name: string): UnitNode | null;
}

export interface UnitAdapter {
  kind(n: UnitNode): string;
  parent(n: UnitNode): UnitNode | null;
  prev(n: UnitNode): UnitNode | null;
  next(n: UnitNode): UnitNode | null;
  text(n: UnitNode): string;
  children(n: UnitNode): UnitNode[];
  /** 0-based inclusive [startRow, endRow] (a node ending at column 0 ends the row above). */
  rows(n: UnitNode): [number, number];
  name(n: UnitNode): string;
}

interface LangConfig {
  units: ReadonlySet<string>;
  values?: ReadonlySet<string>;
  objects?: ReadonlySet<string>;
  climb?: ReadonlySet<string>;
  bind?: ReadonlySet<string>;
  stmt?: ReadonlySet<string>;
  callArgs?: ReadonlySet<string>;
  wrap?: ReadonlySet<string>;
  lead: ReadonlySet<string>;
  fnLike: ReadonlySet<string>;
}

const S = (...a: string[]): ReadonlySet<string> => new Set(a);

const JS: LangConfig = {
  // Definitions that are units on their own.
  units: S(
    "function_declaration", "generator_function_declaration", "method_definition", "class_declaration",
    "abstract_class_declaration", "interface_declaration", "enum_declaration", "internal_module", "module",
    "type_alias_declaration",
  ),
  // Function-valued expressions: a unit only through the statement that binds or passes them.
  values: S("arrow_function", "function_expression", "generator_function", "class", "function"),
  objects: S("object"),
  climb: S("variable_declarator", "arguments", "call_expression", "member_expression", "await_expression",
    "parenthesized_expression", "as_expression", "satisfies_expression", "assignment_expression", "new_expression"),
  bind: S("lexical_declaration", "variable_declaration", "public_field_definition", "field_definition", "pair"),
  stmt: S("expression_statement"),
  callArgs: S("arguments"),
  wrap: S("export_statement"),
  lead: S("comment", "decorator"),
  fnLike: S("function_declaration", "generator_function_declaration", "method_definition"),
};

export const LANGS: Record<string, LangConfig> = {
  javascript: JS,
  typescript: JS,
  tsx: JS,
  python: {
    units: S("function_definition", "class_definition"),
    wrap: S("decorated_definition"),
    lead: S("comment"),
    fnLike: S("function_definition"),
  },
  go: {
    units: S("function_declaration", "method_declaration", "type_declaration"),
    values: S("func_literal"),
    climb: S("argument_list", "call_expression", "expression_list", "var_spec", "selector_expression"),
    bind: S("short_var_declaration", "assignment_statement", "var_declaration"),
    stmt: S("expression_statement"),
    callArgs: S("argument_list"),
    lead: S("comment"),
    fnLike: S("function_declaration", "method_declaration"),
  },
  rust: {
    units: S("function_item", "impl_item", "trait_item", "struct_item", "enum_item", "mod_item", "macro_definition", "union_item"),
    values: S("closure_expression"),
    climb: S(),
    bind: S("let_declaration"),
    stmt: S(),
    lead: S("line_comment", "block_comment", "attribute_item"),
    fnLike: S("function_item"),
  },
  java: {
    units: S("method_declaration", "constructor_declaration", "compact_constructor_declaration", "class_declaration",
      "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration"),
    lead: S("block_comment", "line_comment"),
    fnLike: S("method_declaration", "constructor_declaration"),
  },
  ruby: {
    units: S("method", "singleton_method", "class", "module", "singleton_class"),
    values: S("do_block", "block", "lambda"),
    climb: S("argument_list"),
    bind: S(),
    stmt: S("call"),
    callArgs: S("call"),
    lead: S("comment"),
    fnLike: S("method", "singleton_method"),
  },
};

const NONE: ReadonlySet<string> = new Set();

/** Loose doc-comment matching stays off (spike's accepted miss). */
const LOOSE_DOC = false;

interface RawUnit {
  node: UnitNode;
  kind: string;
  fn: boolean;
  callback?: boolean;
  object?: boolean;
  named: UnitNode;
}

/**
 * Chain of enclosing units, innermost first, for 0-based inclusive rows
 * [rowA, rowB]. `{ start, end }` are 1-based inclusive lines, leading doc
 * comments and decorators included; one-line declarations are skipped.
 */
export function chainFrom(cfg: LangConfig, ad: UnitAdapter, startNode: UnitNode, rowA: number, rowB: number): EnclosingUnit[] {
  let node = startNode;
  // A range that is exactly "doc comment + definition" (a newly added function) covers
  // several siblings, so the covering node is their parent. If only one child in the
  // range is not a leading comment/attribute, that child is the node to start from.
  for (;;) {
    const inRange = ad.children(node).filter((c) => {
      const [s, e] = ad.rows(c);
      return e >= rowA && s <= rowB;
    });
    const solid = inRange.filter((c) => !cfg.lead.has(ad.kind(c)));
    if (inRange.length < 2 || solid.length !== 1) break;
    const [s, e] = ad.rows(solid[0]);
    if (e < rowB || s > rowB) break;
    node = solid[0];
  }
  // A change only in a doc comment / attribute belongs to the definition right below it.
  let jumped = false;
  if (cfg.lead.has(ad.kind(node))) {
    let nx: UnitNode | null = node;
    while (nx && cfg.lead.has(ad.kind(nx))) {
      const after = ad.next(nx);
      if (!after || ad.rows(after)[0] !== ad.rows(nx)[1] + 1) {
        nx = null;
        break;
      }
      nx = after;
    }
    if (nx) {
      node = nx;
      jumped = true;
    }
  }
  // When the start node is a wrapper or a whole statement (`export function`, a decorated
  // definition, `const f = () => {}`), the unit is inside it, not above it: step in.
  const isUnitish = (k: string): boolean => cfg.units.has(k) || (cfg.values ?? NONE).has(k) || (cfg.objects ?? NONE).has(k);
  const k0 = ad.kind(node);
  if (!isUnitish(k0) && (jumped || cfg.wrap?.has(k0) || cfg.bind?.has(k0) || cfg.stmt?.has(k0) || cfg.climb?.has(k0))) {
    const row0 = ad.rows(node)[0];
    let queue: UnitNode[] = [node];
    let found: UnitNode | null = null;
    for (let depth = 0; depth < 6 && !found && queue.length; depth++) {
      const nextQueue: UnitNode[] = [];
      for (const q of queue) {
        for (const c of ad.children(q)) {
          if (isUnitish(ad.kind(c))) {
            found = c;
            break;
          }
          if (cfg.wrap?.has(ad.kind(q)) || ad.rows(c)[0] === row0) nextQueue.push(c);
        }
        if (found) break;
      }
      queue = nextQueue;
    }
    if (found) node = found;
  }
  const raw: RawUnit[] = [];
  let n: UnitNode | null = node;
  while (n) {
    const cur = n;
    const kind = ad.kind(cur);
    // Anything found inside a parse-error region is a guess (seen: JSX read as a
    // "method" after an unsupported type syntax). Drop it and keep what encloses the error.
    if (kind === "ERROR" || kind === "⚠") {
      raw.length = 0;
      n = ad.parent(cur);
      continue;
    }
    if (cfg.units.has(kind)) {
      raw.push({ node: cur, kind, fn: cfg.fnLike.has(kind), named: cur });
      n = ad.parent(cur);
      continue;
    }
    const isValue = (cfg.values ?? NONE).has(kind);
    const isObject = (cfg.objects ?? NONE).has(kind);
    if (!isValue && !isObject) {
      n = ad.parent(cur);
      continue;
    }
    // Climb to the statement that binds this value to a name or passes it to a call.
    let viaCall = false;
    let blockBound = false;
    let p = ad.parent(cur);
    let holder: UnitNode | null = null;
    if (kind === "do_block" || kind === "block" || kind === "lambda") viaCall = true;
    while (p) {
      const pk = ad.kind(p);
      if (cfg.callArgs?.has(pk) && pk !== "call") viaCall = true;
      if ((cfg.bind ?? NONE).has(pk) || (cfg.stmt ?? NONE).has(pk)) {
        holder = p;
        break;
      }
      if (!(cfg.climb ?? NONE).has(pk)) break;
      p = ad.parent(p);
    }
    if (!holder) {
      n = ad.parent(cur);
      continue;
    }
    // Ruby: `call` is both the climb step and the statement; it must itself be a statement.
    if (ad.kind(holder) === "call") {
      const gp = ad.parent(holder);
      const gk = gp ? ad.kind(gp) : "";
      // `Name = proc do ... end`: the assignment names the block.
      if (gp && gk === "assignment") {
        holder = gp;
        viaCall = false;
        blockBound = true;
      } else if (!["program", "body_statement", "block_body", "then", "else", "begin"].includes(gk)) {
        n = ad.parent(cur);
        continue;
      }
    }
    if (isObject && viaCall) {
      n = ad.parent(cur);
      continue;
    }
    raw.push({
      node: holder,
      kind: isObject ? "object" : viaCall ? "callback" : "bound-function",
      fn: !isObject && !viaCall && !blockBound,
      callback: viaCall,
      object: isObject,
      named: holder,
    });
    // Skip ahead so the holder's inner nodes are not revisited.
    n = ad.parent(holder);
  }
  // Callbacks and object literals only count at module/DSL level: not inside a function.
  const kept = raw.filter((u, i) => {
    if (!u.callback && !u.object) return true;
    return !raw.slice(i + 1).some((o) => o.fn);
  });
  const chain: EnclosingUnit[] = [];
  for (const u of kept) {
    let outer = u.node;
    for (let p: UnitNode | null = ad.parent(outer); p && cfg.wrap?.has(ad.kind(p)); p = ad.parent(outer)) outer = p;
    const outerRows = ad.rows(outer);
    let start = outerRows[0];
    const end = outerRows[1];
    // Leading doc comments / attributes / decorators directly above, with no blank line between.
    // tree-sitter hangs a comment that follows `class X` / `module X` on the class node, not
    // on its body, so the first definition in a body finds its doc comment one level up.
    const prevAcross = (x: UnitNode): UnitNode | null => {
      const direct = ad.prev(x);
      if (direct) return direct;
      const par = ad.parent(x);
      return par && ad.rows(par)[0] === ad.rows(x)[0] ? ad.prev(par) : null;
    };
    let s: UnitNode | null = prevAcross(outer);
    while (s && cfg.lead.has(ad.kind(s))) {
      const sRows = ad.rows(s);
      const ps = sRows[0];
      const pe = sRows[1];
      // LOOSE_DOC would also accept a `/** ... */` block separated from the code by one blank line.
      const gapOk = pe === start - 1 || (LOOSE_DOC && pe === start - 2 && ad.text(s).startsWith("/**"));
      if (!gapOk) break;
      // A trailing comment on the previous line of code (`module X # :nodoc:`) is not a doc comment.
      const before = ad.prev(s);
      const par = ad.parent(s);
      if ((before && ad.rows(before)[1] === ps) || (par && ad.rows(par)[0] === ps && ad.kind(par) !== "program" && ad.parent(par))) break;
      start = ps;
      s = ad.prev(s);
    }
    // One-line declarations (`mod x;`, `type A = B`) are not units worth expanding to.
    const [ownStart, ownEnd] = ad.rows(u.node);
    if (!u.fn && ownStart === ownEnd) continue;
    const item: EnclosingUnit = { kind: u.kind, name: ad.name(u.named), start: start + 1, end: end + 1 };
    const last = chain[chain.length - 1];
    if (last && last.start === item.start && last.end === item.end) continue;
    chain.push(item);
  }
  return chain;
}
