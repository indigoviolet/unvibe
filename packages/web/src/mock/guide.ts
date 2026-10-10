/**
 * Mock guide fixture (M2, web-guide owner).
 *
 * The pages, cards, blocks and annotations of the prototype's sample review
 * (urllib3/urllib3#5020, "Unfold obsolete folded response header values"):
 * the `NODES`, `GEN` and `DESC` content plus the seed state, typed with the
 * shared `Page` / `Card` / `Block` / `Annotation` types.
 *
 * Inline dotted links keep the prototype's markup
 * (`<a class="cx" data-node="…">…</a>`); per-block citations live in the
 * typed `citations` arrays (prototype `src`), rendered as `<>` markers.
 *
 * The diff agent's `src/mock/index.ts` assembles the full mock snapshot from
 * this module plus `src/mock/diff.ts`. Until that lands,
 * `src/mock/loadGuideFixture.ts` loads this fixture into the store on its own
 * (snapshot `files` left empty; citation previews fall back to
 * `prototypeLines.ts`).
 */
import type {
  Annotation,
  Block,
  Card,
  Citation,
  Page,
  Review,
  ReviewDescription,
  Version,
} from "@unvibe/shared";

const cit = (targets: string[]): Citation[] =>
  targets.map((target) => ({ target }));

const para = (
  id: string,
  standard: string,
  opts?: { citations?: string[]; simple?: string; deep?: string },
): Block => ({
  type: "paragraph",
  id,
  text: {
    standard,
    ...(opts?.simple !== undefined ? { simple: opts.simple } : {}),
    ...(opts?.deep !== undefined ? { deep: opts.deep } : {}),
  },
  citations: cit(opts?.citations ?? []),
});

const card = (
  id: string,
  title: string | null,
  blocks: Block[],
  pageId: string,
): Card => ({
  id,
  pageId,
  title,
  level: "standard",
  read: false,
  collapsed: false,
  revision: 1,
  blocks,
  undoStack: [],
});

const CX = (id: string, text: string): string =>
  `<a class="cx" data-node="${id}">${text}</a>`;

/** Pre-rendered prototype `S()` source buttons (`<button class="src" …>`). */
const S = (ref: string, label: string): string =>
  `<button class="src" data-src="${ref}" data-refs="${ref}">${label}</button>`;

// ---------------------------------------------------------------------------
// Canned KB examples (prototype `KB[*].example`), kept for the seed expansion
// and the mock "Use examples" transform.
// ---------------------------------------------------------------------------

export const kbExampleFold = `<pre class="code">Set-Cookie: a=1; path=/ <span class="d">\\r\\n</span>
<span class="d">    </span>Max-Age=900\\r\\n

# http.client keeps:   'a=1; path=/ \\r\\n    Max-Age=900'
# urllib3 now returns: 'a=1; path=/ Max-Age=900'</pre>`;

export const kbExampleHeaders = `<pre class="code">r = pool.request("GET", "/")
r.headers.getlist("set-cookie")              # urllib3's HTTPHeaderDict
r._original_response.msg.get_all("set-cookie")  # http.client's HTTPMessage
# Requests' cookie jar reads the second one.</pre>`;

export const kbExampleInjection = `<pre class="code"># stored cookie value with a raw fold:
"session=abc \\r\\n X-Injected: 1"
# re-sent as a request header:
Cookie: session=abc
 X-Injected: 1        &lt;- a server may read this as a new header</pre>`;

export const kbExampleRegex = `<pre class="code">value = " " * 100_000 + "x"
re.sub(r"[ \\t]*\\r\\n[ \\t]+", " ", value)                # O(n²): slow
re.sub(r"(?:(?&lt;![ \\t])[ \\t]+)?\\r\\n[ \\t]+", " ", value)  # O(n)</pre>`;

export const kbExampleCookie = `<pre class="code">r.headers["set-cookie"]          # 'foo=1, bar=1'   (joined: lossy)
r.headers.getlist("set-cookie")  # ['foo=1', 'bar=1'] (kept apart)</pre>`;

// ---------------------------------------------------------------------------
// Diagrams: the prototype used hand-drawn SVG; the product renders Mermaid
// (PRD §13 proposal). These sources approximate the prototype's two diagrams.
// ---------------------------------------------------------------------------

export const foldMermaid = `flowchart LR
    wire["On the wire<br/>Set-Cookie: a=1; path=/ CRLF<br/>plus spaces, Max-Age=900 CRLF"]
    clean["After unfolding<br/>Set-Cookie: a=1; path=/ Max-Age=900"]
    wire -->|"fold: OWS CRLF RWS<br/>becomes one space"| clean`;

export const pathMermaid = `flowchart TD
    srv["Server<br/>folded header"]
    hc["http.client parse_headers"]
    msg["HTTPMessage<br/>value keeps CRLF"]
    norm["_normalize_header_values<br/>OWS CRLF RWS to SP"]
    hdict["HTTPHeaderDict<br/>r.headers"]
    same["HTTPMessage, same object<br/>Requests cookie jar"]
    srv --> hc --> msg --> norm
    norm --> hdict
    norm --> same`;

// ---------------------------------------------------------------------------
// Canned follow-up answers (prototype `ASK`, pre-rendered `S()` buttons).
// ---------------------------------------------------------------------------

export const kbAnswers: Record<string, string> = {
  "bare lf": `Not with this PR. The fast path checks for <code>"\\r\\n"</code> (${S("diff:conn:86", "connection.py:86")}) and the pattern requires <code>\\r\\n</code> (${S("diff:conn:82", "connection.py:82")}). <code>http.client</code> also accepts header lines that end in a bare LF: parsing <code>Set-Cookie: a=1\\n b=2</code> gives <code>'a=1\\n b=2'</code>, which passes through unchanged. The tests only send CRLF folds (${S("diff:tsock:99-118", "test_socketlevel.py:99–118")}). See the finding about bare LF folds.`,
  order: `Order and duplicates are preserved. The helper works on <code>message.items()</code>, a list of pairs, deletes every header from the message, then re-adds the list in its original order (${S("diff:conn:102-108", "connection.py:102–108")}). The unit test checks this with two <code>Set-Cookie</code> lines separated by other headers (${S("diff:tconn:238-246", "test_connection.py:238–246")}).`,
  identity: `It mutates the existing <code>HTTPMessage</code> rather than replacing it, so anything holding a reference sees the clean values. The tests assert the message's <code>defects</code> and <code>policy</code> objects are unchanged (${S("diff:tconn:248-249", "test_connection.py:248–249")}) and that <code>r._original_response.headers is r._original_response.msg</code> (${S("diff:tsock:141", "test_socketlevel.py:141")}).`,
  cost: `Cheap in practice. Values without CRLF skip the regex (${S("diff:conn:86-87", "connection.py:86–87")}), and the message is only rewritten when something changed (${S("diff:conn:102", "connection.py:102")}). The rewrite deletes headers by name, which scans the message each time, so it's quadratic in the number of headers. That only happens for folded responses, which are rare. The regex itself is linear in value length (${S("diff:conn:80-82", "connection.py:80–82")}).`,
  test: `Two levels. Unit tests cover the value helper (whitespace on both sides, multiple folds, two adjacent folds, a tab inside an ordinary value) (${S("diff:tconn:214-224", "test_connection.py:214–224")}) and the message helper (order, duplicates, payload, defects, policy) (${S("diff:tconn:226-249", "test_connection.py:226–249")}). A socket-level test sends a real folded response through a pool and checks both header views (${S("diff:tsock:92-146", "test_socketlevel.py:92–146")}). Nothing exercises bare LF folds or a very long value.`,
  "two spaces": `Yes. RFC 9112 allows replacing each fold with <em>one or more</em> spaces, and the helper replaces each fold with exactly one. <code>"one\\r\\n \\r\\n\\tthree"</code> contains two folds back to back, so it becomes two spaces (${S("diff:tconn:220", "test_connection.py:220")}). Collapsing them further would change whitespace the server actually sent.`,
  rfc: `RFC 9112 lets a recipient either reject a message with folded headers or replace each fold with spaces. Rejecting is stricter but breaks the rare legacy servers that still fold, and urllib3 has generally favoured compatibility. Unfolding is safe as long as it covers every line ending the parser accepts, which is the gap in the bare-LF finding.`,
};

// ---------------------------------------------------------------------------
// Root page
// ---------------------------------------------------------------------------

const problemBlocks: Block[] = [
  para(
    "problem-1",
    `HTTP/1.1 used to let a server continue a header value on the next line by starting that line with a space or tab. That's ${CX("c-fold", "obsolete line folding")}. Python's <code>http.client</code> keeps the folded value as it arrived, with the raw CRLF inside it, and urllib3 copied those values straight into its ${CX("c-hdict", "HTTPHeaderDict")}. A header such as <code>Set-Cookie</code> could therefore contain a line break.`,
    {
      citations: ["desc:d-intro", "diff:conn:650-651"],
      simple: `Old servers sometimes split one header across two lines. Python keeps the line break inside the header's value, and urllib3 passed it along unchanged, so some header values contained hidden line breaks.`,
      deep: `<b>A parser leaking its input format.</b> A fold is an encoding detail: one value written across lines. RFC 9112 requires a recipient to replace each fold with spaces before interpreting the value. Keeping the CRLF lets the wire format leak into the value itself, and every consumer then has to unfold it again, or carries the line break further.`,
    },
  ),
  para(
    "problem-2",
    `The line break isn't just untidy. Libraries that copy cookies from the response, such as Requests, read <code>http.client</code>'s own message object and can send the value back out with the raw CRLF in it. That can split one header into two on the next request: ${CX("c-inject", "header injection")}. Issue #1362 tracked the original report.`,
    {
      citations: ["desc:d-sync", "desc:d-intro"],
      simple: `Worse, other libraries copy these values into the next request, and the hidden line break can turn one header into two.`,
      deep: `<b>A safety property.</b> A header value must never contain CR or LF once it leaves the parser, because anything that writes it out again treats the line break as the end of the header. Normalizing at the one point where urllib3 turns the parsed response into its own types fixes every consumer at once, as long as the original message is fixed too.`,
    },
  ),
];

const centralBlocks: Block[] = [
  para(
    "p-central",
    `urllib3 now unfolds header values right after <code>http.client</code> parses the response. A new helper replaces each fold (optional whitespace, CRLF, then at least one space or tab) with a single space. It updates both urllib3's <code>HTTPHeaderDict</code> and the original <code>HTTPMessage</code>, so code reading either one sees the same clean values.`,
    {
      citations: ["diff:conn:91-110", "diff:conn:650-651"],
      simple: `Right after a response arrives, urllib3 now turns every split header back into one line, in both copies of the headers.`,
      deep: `<b>Normalize the source, then derive.</b> The fix rewrites the <code>HTTPMessage</code> in place (same object, same order, same duplicates) and builds <code>HTTPHeaderDict</code> from the same normalized list. Both views are equal by construction, and nothing downstream has to know folding ever existed.`,
    },
  ),
  {
    type: "table",
    id: "p-table",
    html: `<table><tr><th>Raw value</th><th>After</th></tr>
<tr><td><code>before \\t\\r\\n\\t  after</code></td><td><code>before after</code></td></tr>
<tr><td><code>one\\r\\n two\\t\\r\\n\\tthree</code></td><td><code>one two three</code></td></tr>
<tr><td><code>one\\r\\n \\r\\n\\tthree</code></td><td><code>one  three</code> (two folds give two spaces)</td></tr>
<tr><td><code>ordinary\\tvalue</code></td><td>unchanged</td></tr></table>`,
    citations: cit(["diff:tconn:214-222"]),
  },
  { type: "finding-link", id: "p-findref-lf", pageId: "f-lf", citations: [] },
  para(
    "p-rule",
    `The rule behind it: a parsed header value must never contain a line break. The pattern starts its optional whitespace match only at the beginning of a run of spaces, which keeps it ${CX("c-redos", "linear-time")} on long values, and a fast path skips any value without CRLF, which is almost all of them.`,
    {
      citations: ["diff:conn:80-88"],
      simple: `No header value should contain a line break after parsing. The code also stays fast, even for very long or unusual values.`,
      deep: `Two properties are enforced together: a semantic one (no CR or LF in values) and a performance one (cost linear in input). The second matters because response headers are attacker-controlled input; a pattern that backtracks quadratically would turn a cleanup step into a ${CX("c-redos", "denial-of-service")} vector.`,
    },
  ),
];

function pendingCard(
  id: string,
  pageId: string,
  label: string,
  why: string,
  statusSteps: string[],
  genKey: string,
): Card {
  return {
    id,
    pageId,
    title: null,
    level: "standard",
    read: false,
    collapsed: false,
    revision: 1,
    blocks: [],
    undoStack: [],
    pending: { label, why, statusSteps, genKey },
  };
}

// ---------------------------------------------------------------------------
// Concept pages
// ---------------------------------------------------------------------------

function conceptPage(
  id: string,
  title: string,
  cards: Card[],
): Page {
  // No `saved` flag: concept pages default to saved (see `isSaved`).
  return { id, kind: "concept", title, parent: "root", cards };
}

// ---------------------------------------------------------------------------
// Finding pages
// ---------------------------------------------------------------------------

function findingPage(
  id: string,
  title: string,
  confidence: string,
  summary: string,
  cards: Card[],
): Page {
  return {
    id,
    kind: "finding",
    title,
    saved: false,
    parent: "root",
    confidence,
    summary,
    cards,
  };
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export const guidePages: Page[] = [
  {
    id: "root",
    kind: "root",
    title: "Unfold obsolete folded response headers",
    saved: false,
    cards: [
      card("problem", "The problem", problemBlocks, "root"),
      card("central", "The central change", centralBlocks, "root"),
      pendingCard(
        "g-flow",
        "root",
        "Data flow: from the socket to HTTPHeaderDict",
        "Follows a folded header from http.client through the new helpers to both header views.",
        ["Reading connection.py", "Subagent: finding readers of _original_response.msg", "Drawing the flow"],
        "flow",
      ),
      pendingCard(
        "g-design",
        "root",
        "Design: why the original HTTPMessage is rewritten too",
        "Two copies of the headers, who reads which, and how identity and order are kept.",
        ["Reading the message helper", "Checking the unit and socket tests", "Drafting"],
        "design",
      ),
      pendingCard(
        "g-regex",
        "root",
        "The pattern: why the lookbehind matters",
        "What each part of the regex matches, and the backtracking it avoids.",
        ["Reading _OBSOLETE_FOLD_RE", "Working through the backtracking case", "Drafting"],
        "regex",
      ),
      pendingCard(
        "g-check",
        "root",
        "Review checklist",
        "Concrete things to verify, each linked to the line that answers it.",
        ["Cross-checking the description against the code", "Reading the tests", "Drafting"],
        "check",
      ),
    ],
  },
  conceptPage("c-fold", "Obsolete line folding (obs-fold)", [
    card("cc-fold", null, [
      para(
        "cfold-main",
        `HTTP/1.1 originally let a server continue a header value on the next line, as long as that line started with a space or tab. That's <em>line folding</em>. RFC 9112 now calls it <code>obs-fold</code> (obsolete folding): servers must not send it, and a client that receives it must replace each fold with one or more spaces before using the value. Python's <code>http.client</code> doesn't do that; it keeps the CRLF and the leading whitespace inside the value.`,
        {
          citations: ["desc:d-intro"],
          simple: `Some servers split one long header across two lines, starting the second line with spaces. The modern rule is: treat that split as a single space. Python keeps the line break instead, so urllib3 has to clean it up.`,
          deep: `A fold is a property of the <em>encoding</em>, not of the value: the same value can be sent folded or not. A parser that keeps the fold leaks its input format into the semantic value, so every consumer must either re-implement unfolding or carry a raw line break further. RFC 9112 §5.2 resolves it at the recipient, before interpretation or forwarding.`,
        },
      ),
      {
        type: "diagram",
        id: "cfold-diagram",
        mermaid: foldMermaid,
        caption: "An obs-fold on the wire, and the value urllib3 now hands to callers.",
        citations: [],
      },
      { type: "html", id: "cfold-example", html: kbExampleFold, citations: [] },
      para(
        "cfold-close",
        `RFC 9112 allows a recipient to reject a folded message or unfold it. urllib3 unfolds, using one space per fold. Whitespace is one of the ${CX("c-ows", "OWS and RWS")} rules.`,
      ),
    ], "c-fold"),
  ]),
  conceptPage("c-ows", "OWS and RWS: whitespace in HTTP", [
    card("cc-ows", null, [
      para(
        "cows-main",
        `HTTP's grammar names its whitespace. <code>OWS</code> is optional whitespace (zero or more spaces or tabs) and <code>RWS</code> is required whitespace (at least one). A fold is <code>OWS CRLF RWS</code>: maybe some spaces, the line break, then at least one space or tab starting the next line. That's exactly the shape of the PR's regex.`,
        {
          citations: ["diff:conn:82"],
          simple: `"Optional spaces, a line break, then at least one space": that's what a fold looks like, and that's what the code searches for.`,
        },
      ),
    ], "c-ows"),
  ]),
  conceptPage("c-hdict", "HTTPHeaderDict and HTTPMessage", [
    card("cc-hd", null, [
      para(
        "chdict-main",
        `A urllib3 response carries its headers twice. <code>r.headers</code> is urllib3's <code>HTTPHeaderDict</code>, a case-insensitive dict that keeps repeated headers. <code>r._original_response.msg</code> is the <code>HTTPMessage</code> that <code>http.client</code> built while parsing, based on Python's email message class. urllib3 builds the first from the second, but some libraries, notably Requests for cookies, read the second directly. Fixing only one would leave them disagreeing.`,
        {
          citations: ["diff:conn:650-651"],
          simple: `There are two copies of the headers: urllib3's own, and the one Python's HTTP library made. Other libraries read different copies, so both need the same clean values.`,
          deep: `Two representations of one fact are a consistency hazard. The PR chooses <em>normalize the source, then derive</em>: it rewrites the <code>HTTPMessage</code> in place (keeping the object's identity, defects and policy) and builds <code>HTTPHeaderDict</code> from the same normalized list, so both views are equal by construction.`,
        },
      ),
      { type: "html", id: "chdict-example", html: kbExampleHeaders, citations: [] },
      para(
        "chdict-close",
        `Repeated headers matter here, especially ${CX("c-cookie", "Set-Cookie")}, which can't be joined into one value.`,
      ),
    ], "c-hdict"),
  ]),
  conceptPage("c-inject", "Header injection through raw line breaks", [
    card("cc-inj", null, [
      para(
        "cinject-main",
        `HTTP separates headers with CRLF. If a header value itself contains CRLF and some code later writes that value back out, for example a cookie jar sending a stored cookie on the next request, the line break ends the header early and whatever follows becomes a new header. That's <em>header injection</em>. Here the risk is that a folded <code>Set-Cookie</code> could be re-sent with a raw CRLF inside it.`,
        {
          citations: ["desc:d-sync"],
          simple: `A hidden line break inside a header can split one header into two when the value is sent again. Removing line breaks from values prevents that.`,
          deep: `The invariant is simple: no CR or LF in a field value after parsing. Code that serializes headers trusts that invariant, so it must hold at the boundary where external bytes become values. Enforcing it once in <code>getresponse()</code> protects every downstream serializer, as long as the enforcement covers every line terminator the parser accepts.`,
        },
      ),
      { type: "html", id: "cinject-example", html: kbExampleInjection, citations: [] },
      para(
        "cinject-close",
        `Requests is one such consumer: it reads cookies from ${CX("c-requests", "the original message")}.`,
      ),
    ], "c-inject"),
  ]),
  conceptPage("c-redos", "Regex backtracking and linear-time patterns", [
    card("cc-re", null, [
      para(
        "credos-main",
        `The pattern is <code>(?:(?&lt;![ \\t])[ \\t]+)?\\r\\n[ \\t]+</code>: optional spaces or tabs, then CRLF, then at least one space or tab. The <code>(?&lt;![ \\t])</code> lookbehind lets the optional whitespace match start only at the <em>beginning</em> of a run of spaces. Without it, a long run of spaces that isn't followed by CRLF makes the engine try every starting position and rescan the whole run from each one, which takes quadratic time.`,
        {
          citations: ["diff:conn:80-82"],
          simple: `The pattern finds "spaces, line break, spaces". A small extra check stops it re-reading the same spaces over and over, so very long header values can't make it slow.`,
          deep: `Regex engines that backtrack retry at each start position. With <code>[ \\t]*\\r\\n</code>, a run of <i>n</i> spaces costs <i>n − i</i> steps from position <i>i</i>, which is O(n²) in total. The lookbehind fails in O(1) everywhere inside a run, so only the run's first character starts the expensive scan, which brings the total to O(n). It's the same idea as anchoring a token to its leftmost position.`,
        },
      ),
      { type: "html", id: "credos-example", html: kbExampleRegex, citations: [] },
    ], "c-redos"),
  ]),
  conceptPage("c-cookie", "Why Set-Cookie lines stay separate", [
    card("cc-ck", null, [
      para(
        "ccookie-main",
        `<code>Set-Cookie</code> is the one header that can't be combined into a comma-separated list, because cookie attributes such as <code>Expires=Wed, 21 Oct 2026 …</code> contain commas themselves. urllib3's <code>HTTPHeaderDict</code> still keeps each <code>Set-Cookie</code> line separately (<code>getlist</code>), and the PR has to preserve that, along with the order of duplicate headers, when it rewrites the message.`,
        {
          citations: ["diff:tsock:124-127"],
          simple: `Each cookie has to stay as its own header line, because cookies contain commas. The fix keeps every cookie separate and in order.`,
          deep: `Set-Cookie breaks the general rule that repeated fields are equivalent to one comma-joined field (RFC 9110 §5.3 calls this out explicitly). Any header normalization therefore has to work on the list of (name, value) pairs, never on a joined map, which is why the helper takes <code>message.items()</code> and writes them back in order.`,
        },
      ),
      { type: "html", id: "ccookie-example", html: kbExampleCookie, citations: [] },
    ], "c-cookie"),
  ]),
  conceptPage("c-requests", "Requests reads the original HTTPMessage", [
    card("cc-rq", null, [
      para(
        "crequests-main",
        `Requests builds its cookie jar from <code>response._original_response.msg</code>, the <code>http.client</code> message, not from urllib3's <code>r.headers</code>. That's why the PR rewrites the original message in place instead of only cleaning the dict it builds. The socket-level test checks both views and that the message is still the same object.`,
        {
          citations: ["diff:tsock:139-146"],
          simple: `Requests reads cookies from Python's own copy of the headers, so that copy has to be fixed too, not just urllib3's.`,
        },
      ),
    ], "c-requests"),
  ]),
  findingPage(
    "f-lf",
    "Folds that end in a bare LF are not unfolded",
    "medium",
    "http.client accepts header lines ending in LF alone, but the new code only looks for CRLF.",
    [
      card("flf-ev", "Evidence", [
        para(
          "flf-ev-1",
          `<b>Code:</b> the fast path returns early unless the value contains <code>"\\r\\n"</code>, and the pattern requires <code>\\r\\n</code>.`,
          { citations: ["diff:conn:86-88", "diff:conn:82"] },
        ),
        para(
          "flf-ev-2",
          `<b>Parser:</b> <code>http.client</code> accepts header lines ending in a bare LF. Checked locally: parsing <code>Set-Cookie: a=1\\n b=2</code> returns the value <code>'a=1\\n b=2'</code>, which these helpers leave unchanged.`,
        ),
        para(
          "flf-ev-3",
          `<b>Tests:</b> every fold in the socket test and the unit tests uses CRLF.`,
          { citations: ["diff:tsock:99-118", "diff:tconn:214-222"] },
        ),
      ], "f-lf"),
      card("flf-as", "Assessment", [
        para(
          "flf-as-1",
          `The invariant the PR states, no raw line breaks in header values, still fails for a folded value whose lines end in a bare LF. That's the same ${CX("c-inject", "header injection")} risk through LF instead of CRLF. RFC 9112 lets recipients accept a bare LF as a line terminator, and <code>http.client</code> does. Broadening the pattern and fast path to <code>\\r?\\n</code>, plus one test, would close it. Confidence is medium: the maintainers may have left LF out deliberately, and it depends on <code>http.client</code>'s behaviour.`,
          {
            simple: `A rarer kind of split header, using only LF, still keeps its line break. A small change to the pattern would cover it.`,
            deep: `A sanitizer is only as strong as its coverage of the parser it follows: whatever line terminators the parser accepts, the sanitizer must also recognize. Here the parser is more permissive (CRLF or LF) than the sanitizer (CRLF only), so there's a gap between "accepted" and "cleaned".`,
          },
        ),
        {
          type: "comment-link",
          id: "flf-as-clink",
          diffRef: "diff:conn:82",
          threadId: "t-sglf",
          citations: [],
        },
        {
          type: "follow-up",
          id: "flf-as-follow",
          items: [{ label: "Would rejecting folds be safer than unfolding?", ask: "rfc" }],
          citations: [],
        },
      ], "f-lf"),
    ],
  ),
  findingPage(
    "f-perf",
    "The linear-time claim has no test",
    "high",
    "The description and a comment rely on the pattern being linear-time, but nothing would catch a regression.",
    [
      card("fpf-ev", "Evidence", [
        para(
          "fpf-ev-1",
          `<b>Description:</b> it says the normalization uses a linear-time pattern for long field values.`,
          { citations: ["desc:d-norm"] },
        ),
        para(
          "fpf-ev-2",
          `<b>Code:</b> a comment explains that starting the whitespace match at the beginning of a run avoids quadratic backtracking.`,
          { citations: ["diff:conn:80-82"] },
        ),
        para(
          "fpf-ev-3",
          `<b>Tests:</b> no test uses a long value or a long run of spaces.`,
          { citations: ["diff:tconn:214-222"] },
        ),
      ], "f-perf"),
      card("fpf-as", "Assessment", [
        para(
          "fpf-as-1",
          `The pattern is correct today, but the property that makes it safe (the lookbehind) is easy to "simplify" away later, and response headers are untrusted input. A test that normalizes a value with a very long run of spaces, kept within a generous time limit, would protect it. This is a test gap, not a bug.`,
        ),
        {
          type: "comment-link",
          id: "fpf-as-clink",
          diffRef: "diff:conn:80",
          threadId: "t-sgperf",
          citations: [],
        },
      ], "f-perf"),
    ],
  ),
];

// ---------------------------------------------------------------------------
// "Go deeper" generated content (prototype `GEN`), used by mock generate.
// ---------------------------------------------------------------------------

export const genContent: Record<string, Block[]> = {
  flow: [
    {
      type: "diagram",
      id: "gen-flow-dg",
      mermaid: pathMermaid,
      caption: "Where a response's headers go after parsing, and the one place they are now unfolded.",
      citations: cit(["diff:conn:650-651", "diff:tsock:139-146"]),
    },
    {
      type: "list",
      id: "gen-flow-ol",
      ordered: true,
      items: [
        {
          html: `<code>http.client</code> parses the response headers into an <code>HTTPMessage</code>. A folded value keeps its CRLF and leading whitespace.`,
          citations: [],
        },
        {
          html: `<code>getresponse()</code> passes that message to <code>_normalize_header_values</code> instead of reading <code>.items()</code> directly.`,
          citations: cit(["diff:conn:650"]),
        },
        {
          html: `Each value goes through <code>_normalize_header_value</code>: values without CRLF return at once, folded ones are rewritten with the pattern.`,
          citations: cit(["diff:conn:85-88"]),
        },
        {
          html: `If any value changed, the message is rewritten in place: every header is deleted, then the normalized list is added back in the same order.`,
          citations: cit(["diff:conn:102-108"]),
        },
        {
          html: `<code>HTTPHeaderDict</code> is built from the same normalized list, so <code>r.headers</code> and <code>r._original_response.msg</code> agree.`,
          citations: cit(["diff:conn:651", "diff:tsock:139-146"]),
        },
      ],
      citations: [],
    },
    {
      type: "follow-up",
      id: "gen-flow-follow",
      items: [
        { label: "What happens to a fold that ends in a bare LF?", ask: "bare lf" },
        { label: "Does unfolding change header order?", ask: "order" },
      ],
      citations: [],
    },
  ],
  design: [
    para(
      "gen-design-1",
      `A response's headers exist twice: urllib3's <code>HTTPHeaderDict</code> and <code>http.client</code>'s <code>HTTPMessage</code>. Requests reads cookies from the second, so cleaning only the first would leave the raw CRLF where it does harm.`,
      { citations: ["desc:d-sync"] },
    ),
    para(
      "gen-design-2",
      `The helper therefore rewrites the original message <b>in place</b>. It keeps the object's identity (the socket test checks <code>headers is msg</code>), its <code>defects</code> and <code>policy</code>, its payload, and the order of every header, including duplicate <code>Set-Cookie</code> lines.`,
      { citations: ["diff:tconn:226-249", "diff:tsock:141"] },
    ),
    para(
      "gen-design-3",
      `The alternative, building a new message, would break anything already holding a reference to the old one. Normalizing the list once and deriving both views from it makes them equal by construction.`,
    ),
    {
      type: "follow-up",
      id: "gen-design-follow",
      items: [
        { label: "Is mutating the message in place safe?", ask: "identity" },
        { label: "What does this cost per response?", ask: "cost" },
      ],
      citations: [],
    },
  ],
  regex: [
    para(
      "gen-regex-1",
      `<code>_OBSOLETE_FOLD_RE = (?:(?&lt;![ \\t])[ \\t]+)?\\r\\n[ \\t]+</code>`,
      { citations: ["diff:conn:82"] },
    ),
    {
      type: "list",
      id: "gen-regex-ul",
      ordered: false,
      items: [
        {
          html: `<code>(?:…)?</code>: optional whitespace before the line break, the <code>OWS</code> in <code>OWS CRLF RWS</code>.`,
          citations: [],
        },
        {
          html: `<code>(?&lt;![ \\t])</code>: that optional whitespace may only start where the previous character isn't a space or tab, i.e. at the start of a run.`,
          citations: cit(["diff:conn:80-81"]),
        },
        { html: `<code>\\r\\n</code>: the line break itself.`, citations: [] },
        {
          html: `<code>[ \\t]+</code>: at least one space or tab starting the continuation line, the <code>RWS</code>.`,
          citations: [],
        },
      ],
      citations: [],
    },
    para(
      "gen-regex-2",
      `Without the lookbehind, a long run of spaces that isn't followed by CRLF makes the engine try every start position and rescan the run each time, which is quadratic. With it, positions inside a run fail at once, so the scan is linear.`,
      { citations: ["diff:conn:80-81"] },
    ),
    {
      type: "follow-up",
      id: "gen-regex-follow",
      items: [{ label: "Why isn't this tested?", ask: "test" }],
      citations: [],
    },
  ],
  check: [
    {
      type: "list",
      id: "gen-check-ul",
      ordered: false,
      items: [
        {
          html: `✓ Unfolds exactly the RFC shape: optional whitespace, CRLF, at least one space or tab.`,
          citations: cit(["diff:conn:82"]),
        },
        {
          html: `⚠ ${CX("f-lf", "Folds that end in a bare LF are not unfolded")}.`,
          citations: cit(["diff:conn:82", "diff:conn:86"]),
        },
        {
          html: `✓ Order and duplicate headers are preserved when the message is rewritten.`,
          citations: cit(["diff:tconn:238-246"]),
        },
        {
          html: `✓ The original message keeps its identity, payload, defects and policy.`,
          citations: cit(["diff:tconn:247-249", "diff:tsock:141"]),
        },
        {
          html: `? ${CX("f-perf", "The linear-time claim has no test")}.`,
          citations: cit(["diff:conn:80-82"]),
        },
        {
          html: `✓ Tabs inside ordinary values are left alone.`,
          citations: cit(["diff:tconn:217", "diff:tsock:133"]),
        },
        {
          html: `✓ Two adjacent folds give two spaces, which RFC 9112 allows.`,
          citations: cit(["diff:tconn:220"]),
        },
      ],
      citations: [],
    },
    {
      type: "follow-up",
      id: "gen-check-follow",
      items: [{ label: "Is the double space intended?", ask: "two spaces" }],
      citations: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Seed annotations (prototype `seed`): one guide thread plus the suggested
// review comments the findings link to. Guide threads render as comment
// markers until the threads milestone.
// ---------------------------------------------------------------------------

export const guideAnnotations: Annotation[] = [
  {
    id: "t-seed",
    type: "thread",
    anchor: {
      host: { kind: "block", blockId: "p-rule" },
      quotedText: "fast path",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    open: false,
    messages: [
      { who: "you", text: "Does the fast path still catch a fold that uses a bare LF?" },
      { who: "ai", html: kbAnswers["bare lf"] },
    ],
    post: false,
    note: false,
  },
  {
    id: "t-sglf",
    type: "thread",
    anchor: {
      host: { kind: "diff-line", fileKey: "conn", line: 82 },
      quotedText: "",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    open: false,
    messages: [
      {
        who: "ai",
        suggested: true,
        text: "http.client also accepts header lines that end in a bare LF, so a fold like `a=1\\n b=2` keeps its line break: both the `\"\\r\\n\" not in value` fast path and this pattern only look for CRLF. Would `\\r?\\n` here (and in the fast path), plus a test, make sense?",
      },
    ],
    post: false,
    note: false,
  },
  {
    id: "t-sgperf",
    type: "thread",
    anchor: {
      host: { kind: "diff-line", fileKey: "conn", line: 80 },
      quotedText: "",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    open: false,
    messages: [
      {
        who: "ai",
        suggested: true,
        text: "Could we add a test that normalizes a value with a very long run of spaces, so a later simplification of this pattern can't bring back the quadratic case?",
      },
    ],
    post: false,
    note: false,
  },
  {
    id: "t-diff",
    type: "thread",
    anchor: {
      host: { kind: "diff-line", fileKey: "tconn", line: 220 },
      quotedText: "",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    open: false,
    messages: [
      { who: "you", text: "Is the double space here intended?" },
      { who: "ai", html: kbAnswers["two spaces"] },
    ],
    post: false,
    note: false,
  },
];

/**
 * Seeded hunk UI state (prototype `H()` assignments). The diff agent's
 * assembler maps these onto `HunkState` by content hash:
 * tconn hunk 3 reviewed + folded; conn hunk 2 carries the user's note.
 */
export const seedHunkUi: {
  fileKey: string;
  index: number;
  reviewed?: boolean;
  folded?: boolean;
  note?: string;
}[] = [
  { fileKey: "tconn", index: 2, reviewed: true, folded: true },
  { fileKey: "conn", index: 1, note: "Only call site; everything else is the helper." },
];

// ---------------------------------------------------------------------------
// Description (prototype `DESC` + `PR`)
// ---------------------------------------------------------------------------

const descriptionHtml = `<div class="desc">
  <p class="para" id="d-intro" data-top="d-intro">Addresses the original obs-fold response-header case discussed in #1362. Python's <code>http.client</code> preserves obsolete folded response header lines in <code>HTTPMessage</code> values. This change replaces each RFC 9112 <code>OWS CRLF RWS</code> sequence with a single space before urllib3 or downstream consumers interpret the value. <button class="back" data-back="problem-1">Restated →</button></p>
  <h3>The normalization</h3>
  <ul class="para" id="d-norm" data-top="d-norm">
  <li id="d-sync" data-top="d-sync">keeps urllib3's <code>HTTPHeaderDict</code> and the original <code>HTTPMessage</code> synchronized, preventing cookie consumers such as Requests from re-emitting raw CRLF;</li>
  <li>preserves header names, ordering, duplicate fields, and parser state;</li>
  <li>uses a common-case fast path and a linear-time pattern for long field values. <button class="back" data-back="p-central">Restated →</button></li></ul>
  <h3>Tests</h3>
  <p class="para" id="d-tests" data-top="d-tests">The socket regression covers the original folded <code>Set-Cookie</code>, duplicate cookies, every SP/HTAB combination around CRLF, mixed and repeated whitespace, multiple folds, and ordinary headers. Focused unit coverage also verifies adjacent folds and preservation of the original message's order, duplicates, payload, policy, and defects.</p>
  <p class="para" id="d-scope" data-top="d-scope">This intentionally does not address the separate whitespace-before-colon/header name validation scope discussed on #1362.</p>
  <h3>Validation performed</h3>
  <ul class="para" id="d-valid" data-top="d-valid"><li>full local suite: 2,279 passed, 333 skipped, 4 xfailed;</li><li>focused strict nox sessions on Python 3.12, 3.13, and 3.14;</li><li>pyupgrade, Black, isort, and flake8;</li><li>towncrier changelog validation;</li><li>source distribution and wheel builds;</li><li>end-to-end Requests cookie extraction and subsequent request serialization.</li></ul>
</div>`;

export const guideDescription: ReviewDescription = {
  author: "adityawrk",
  merged: true,
  isAuthor: false,
  html: descriptionHtml,
  restated: [
    { paragraphId: "d-intro", cardId: "problem", blockId: "problem-1" },
    { paragraphId: "d-norm", cardId: "central", blockId: "p-central" },
  ],
};

// ---------------------------------------------------------------------------
// Review / version meta for the mock snapshot
// ---------------------------------------------------------------------------

export const guideReview: Review = {
  id: "demo",
  repoId: "urllib3",
  branch: "unfold-obs-fold",
  prNumber: 5020,
  versions: [],
  currentVersion: 1,
  createdAt: Date.now(),
};

export const guideVersion: Version = {
  n: 1,
  headSha: "bdcc1e493e",
  mergeBaseSha: "443cb01be1",
  baseRef: "main",
  fetchedAt: Date.now(),
  idMapping: {},
};
