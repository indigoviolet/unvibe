// What counts as a "unit" per language, in tree-sitter node kinds, and the walk that
// turns "smallest node covering the changed lines" into the chain of enclosing units.
// The walk only needs an adapter (kind/parent/prev/rows/name), so the same rules drive
// web-tree-sitter and @ast-grep/napi (both use the tree-sitter grammars).
const S = (...a) => new Set(a);

const JS = {
  // Definitions that are units on their own.
  units: S("function_declaration", "generator_function_declaration", "method_definition", "class_declaration",
    "abstract_class_declaration", "interface_declaration", "enum_declaration", "internal_module", "module",
    "type_alias_declaration"),
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

export const LANGS = {
  javascript: JS, typescript: JS, tsx: JS,
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

const NONE = new Set();

/**
 * @param cfg   LANGS[lang]
 * @param ad    adapter: kind(n), parent(n), prev(n) (previous sibling incl. comments), rows(n) -> [startRow,endRow] 0-based inclusive, name(n)
 * @param node  smallest node covering the changed range
 * @returns chain innermost first: { start, end, kind, name } with 1-based inclusive lines
 */
export const opts = { looseDoc: process.env.LOOSE_DOC === "1" };

export function chainFrom(cfg, ad, node, rowA, rowB) {
  // A range that is exactly "doc comment + definition" (a newly added function) covers
  // several siblings, so the covering node is their parent. If only one child in the
  // range is not a leading comment/attribute, that child is the node to start from.
  for (;;) {
    const inRange = ad.children(node).filter((c) => { const [s, e] = ad.rows(c); return e >= rowA && s <= rowB; });
    const solid = inRange.filter((c) => !cfg.lead.has(ad.kind(c)));
    if (inRange.length < 2 || solid.length !== 1) break;
    const [s, e] = ad.rows(solid[0]);
    if (e < rowB || s > rowB) break;
    node = solid[0];
  }
  // A change only in a doc comment / attribute belongs to the definition right below it.
  let jumped = false;
  if (cfg.lead.has(ad.kind(node))) {
    let nx = node;
    while (nx && cfg.lead.has(ad.kind(nx))) {
      const after = ad.next(nx);
      if (!after || ad.rows(after)[0] !== ad.rows(nx)[1] + 1) { nx = null; break; }
      nx = after;
    }
    if (nx) { node = nx; jumped = true; }
  }
  // When the start node is a wrapper or a whole statement (`export function`, a decorated
  // definition, `const f = () => {}`), the unit is inside it, not above it: step in.
  const isUnitish = (k) => cfg.units.has(k) || (cfg.values ?? NONE).has(k) || (cfg.objects ?? NONE).has(k);
  const k0 = ad.kind(node);
  if (!isUnitish(k0) && (jumped || cfg.wrap?.has(k0) || cfg.bind?.has(k0) || cfg.stmt?.has(k0) || cfg.climb?.has(k0))) {
    const row0 = ad.rows(node)[0];
    let queue = [node], found = null;
    for (let depth = 0; depth < 6 && !found && queue.length; depth++) {
      const nextQueue = [];
      for (const q of queue) {
        for (const c of ad.children(q)) {
          if (isUnitish(ad.kind(c))) { found = c; break; }
          if (cfg.wrap?.has(ad.kind(q)) || ad.rows(c)[0] === row0) nextQueue.push(c);
        }
        if (found) break;
      }
      queue = nextQueue;
    }
    if (found) node = found;
  }
  const raw = [];
  for (let n = node; n; n = ad.parent(n)) {
    const kind = ad.kind(n);
    if (cfg.units.has(kind)) { raw.push({ node: n, kind, fn: cfg.fnLike.has(kind), named: n }); continue; }
    const isValue = (cfg.values ?? NONE).has(kind), isObject = (cfg.objects ?? NONE).has(kind);
    if (!isValue && !isObject) continue;
    // Climb to the statement that binds this value to a name or passes it to a call.
    let viaCall = false, blockBound = false, p = ad.parent(n), holder = null;
    if (kind === "do_block" || kind === "block" || kind === "lambda") viaCall = true;
    while (p) {
      const pk = ad.kind(p);
      if (cfg.callArgs?.has(pk) && pk !== "call") viaCall = true;
      if (cfg.bind.has(pk) || cfg.stmt.has(pk)) { holder = p; break; }
      if (!cfg.climb.has(pk)) break;
      p = ad.parent(p);
    }
    if (!holder) continue;
    // Ruby: `call` is both the climb step and the statement; it must itself be a statement.
    if (ad.kind(holder) === "call") {
      const gp = ad.parent(holder), gk = gp ? ad.kind(gp) : "";
      // `Name = proc do ... end`: the assignment names the block.
      if (gk === "assignment") { holder = gp; viaCall = false; blockBound = true; }
      else if (!["program", "body_statement", "block_body", "then", "else", "begin"].includes(gk)) continue;
    }
    if (isObject && viaCall) continue;
    raw.push({ node: holder, kind: isObject ? "object" : viaCall ? "callback" : "bound-function", fn: !isObject && !viaCall && !blockBound, callback: viaCall, object: isObject, named: holder });
    // Skip ahead so the holder's inner nodes are not revisited.
    n = holder;
  }
  // Callbacks and object literals only count at module/DSL level: not inside a function.
  const kept = raw.filter((u, i) => {
    if (!u.callback && !u.object) return true;
    return !raw.slice(i + 1).some((o) => o.fn);
  });
  const chain = [];
  for (const u of kept) {
    let outer = u.node;
    for (let p = ad.parent(outer); p && cfg.wrap?.has(ad.kind(p)); p = ad.parent(outer)) outer = p;
    let [start, end] = ad.rows(outer);
    // Leading doc comments / attributes / decorators directly above, with no blank line between.
    // tree-sitter hangs a comment that follows `class X` / `module X` on the class node, not
    // on its body, so the first definition in a body finds its doc comment one level up.
    const prevAcross = (n) => {
      const direct = ad.prev(n);
      if (direct) return direct;
      const p = ad.parent(n);
      return p && ad.rows(p)[0] === ad.rows(n)[0] ? ad.prev(p) : null;
    };
    for (let s = prevAcross(outer); s && cfg.lead.has(ad.kind(s)); s = ad.prev(s)) {
      const [ps, pe] = ad.rows(s);
      // LOOSE_DOC: also accept a `/** ... */` block separated from the code by one blank line.
      const gapOk = pe === start - 1 || (opts.looseDoc && pe === start - 2 && ad.text(s).startsWith("/**"));
      if (!gapOk) break;
      // A trailing comment on the previous line of code (`module X # :nodoc:`) is not a doc comment.
      const before = ad.prev(s), par = ad.parent(s);
      if ((before && ad.rows(before)[1] === ps) || (par && ad.rows(par)[0] === ps && ad.kind(par) !== "program" && ad.parent(par))) break;
      start = ps;
    }
    // One-line declarations (`mod x;`, `type A = B`) are not units worth expanding to.
    const [ownStart, ownEnd] = ad.rows(u.node);
    if (!u.fn && ownStart === ownEnd) continue;
    const item = { start: start + 1, end: end + 1, kind: u.kind, name: ad.name(u.named) };
    const last = chain[chain.length - 1];
    if (last && last.start === item.start && last.end === item.end) continue;
    chain.push(item);
  }
  return chain;
}

// The same rules in Lezer's node names (no Ruby grammar is published for Lezer).
const LJS = {
  units: S("FunctionDeclaration", "MethodDeclaration", "ClassDeclaration", "InterfaceDeclaration", "EnumDeclaration",
    "NamespaceDeclaration", "TypeAliasDeclaration"),
  values: S("ArrowFunction", "FunctionExpression", "ClassExpression"),
  objects: S("ObjectExpression"),
  climb: S("ArgList", "CallExpression", "MemberExpression", "UnaryExpression", "ParenthesizedExpression",
    "AssignmentExpression", "NewExpression"),
  bind: S("VariableDeclaration", "PropertyDeclaration", "Property"),
  stmt: S("ExpressionStatement"),
  callArgs: S("ArgList"),
  wrap: S("ExportDeclaration"),
  lead: S("LineComment", "BlockComment", "Decorator"),
  fnLike: S("FunctionDeclaration", "MethodDeclaration"),
};
export const LEZER = {
  javascript: LJS, typescript: LJS, tsx: LJS,
  python: { units: S("FunctionDefinition", "ClassDefinition"), wrap: S("DecoratedStatement"), lead: S("Comment"), fnLike: S("FunctionDefinition") },
  go: {
    units: S("FunctionDecl", "MethodDecl", "TypeDecl"),
    values: S("FunctionLiteral"),
    climb: S("Arguments", "CallExpr", "SelectorExpr", "VarSpec"),
    bind: S("Assignment", "VarDecl"),
    stmt: S("ExprStatement"),
    callArgs: S("Arguments"),
    lead: S("LineComment", "BlockComment"),
    fnLike: S("FunctionDecl", "MethodDecl"),
  },
  rust: {
    units: S("FunctionItem", "ImplItem", "TraitItem", "StructItem", "EnumItem", "ModItem", "MacroDefinition", "UnionItem"),
    values: S("ClosureExpression"), climb: S(), bind: S("LetDeclaration"), stmt: S(),
    lead: S("LineComment", "BlockComment", "AttributeItem"),
    fnLike: S("FunctionItem"),
  },
  java: {
    units: S("MethodDeclaration", "ConstructorDeclaration", "CompactConstructorDeclaration", "ClassDeclaration",
      "InterfaceDeclaration", "EnumDeclaration", "RecordDeclaration", "AnnotationTypeDeclaration"),
    lead: S("BlockComment", "LineComment"),
    fnLike: S("MethodDeclaration", "ConstructorDeclaration"),
  },
};
