# Unvibe: product requirements

Unvibe is a reader for code changes. It helps a person understand a branch or pull request (often one an agent wrote), dig into it with an agent alongside, and turn what they learn into review comments.

This document is the hand-off for building it. It contains the product behaviour, the architecture, and the decisions behind them, and it supersedes the earlier `DECISIONS.md` and `spec.html`.

---

## 0. Hand-off notes

**Status.** The UX is settled in a clickable prototype. The architecture is decided, apart from the items in §19. No production code exists yet.

**Files**

| File | What it is |
|---|---|
| `PRD.md` | This document |
| `prototype.html` | A self-contained, clickable prototype. Open it in a browser; it needs no server. Every agent response in it is written in advance, and it runs on the real diff of a public pull request, urllib3/urllib3#5020 ("Unfold obsolete folded response header values"). |

**How to use the prototype.** Treat it as the reference for *look and behaviour*, not for code. Its code is a single-file sketch with no persistence. §4 describes what the product must do. §20 lists where the prototype fakes behaviour.

**Constraints that apply throughout**
- **No new logins.** GitHub access goes through the user's existing `gh` login. Agents run through the user's existing Claude Code and Codex logins.- **Nothing is hosted on the public internet.** Everything runs on the user's machine, on localhost.
- **Nothing is posted to GitHub until the user clicks Submit review** (§4.12).
- **Nothing starts at login** (§14).

**Where to start.** Milestone M0 (§17) is a short spike that tests the riskiest assumption, ACP session forking, before anything else is built.

---

## 1. Problem

Reviewing a branch you didn't write is slow. That's more and more often the case, because an agent wrote it. A diff shows *what* changed, not *why*, and it gives no way in to the domain concepts, the data flow, or the design choices the change depends on. Chat-based agents can explain parts of it, but the explanations are scattered across conversations, aren't tied back to the code, and disappear.

## 2. Goals and non-goals

**Goals**
1. Restate a change so the reader grasps the problem and the central idea within minutes.
2. Let the reader dig into anything (a phrase, a concept, a hunk), at whatever depth they need, without losing their place.
3. Tie every explanation back to the exact code or text it came from, with links that are checked.
4. Keep everything the reader and agents produce as a linked set of pages that later questions build on.
5. Turn understanding into review comments, and post them only when the reader decides to.
6. Make many parallel conversations cheap and fast, by reusing the agents' context.
7. Survive new pushes and rebases without losing the reader's work.

**Non-goals for the first version**
- Reading content that isn't code, such as web pages. The design keeps this possible (§19).
- Grouping the diff by meaning across files. Deferred.
- Saved pages shared with other people. Deferred.
- Editing code. Unvibe reads and comments; it doesn't change the branch.
- Multi-user or hosted use.

## 3. Users and main flows

**User.** An engineer reviewing a branch or PR, either their own (often agent-written) or a colleague's.

**Main flows**
1. **Open a review.** Pick a repo, then a PR or branch. The guide starts filling in within about a minute.
2. **Understand.** Read the guide. Hover links and citations, open concept pages, change the depth, and explain or ask about selected text.
3. **Inspect the code.** Use the diff beside the guide: filter files, hide uninteresting hunks, fold, summarize, note, mark reviewed.
4. **Get a second opinion** on a card or an agent finding.
5. **Comment and submit.** Mark comments "For PR", edit the drafts, then submit one GitHub review. If it's your PR, the description edit goes in the same submit.
6. **Come back after new commits.** See what changed, click Update, and continue.

---

## 4. Product behaviour

### 4.1 Layout
- **Top bar:** PR or branch title, Tips, **Submit review** with a count of pending changes, and **Source**, which shows or hides the right-hand pane.
- **Guide** (left, main column): the current page.
- **Source pane** (right): tabs for **PR description** and **Diff**, plus the **Comments** menu. A drag handle resizes it, and the arrow keys work on the handle. It's docked at window widths of 900px and up, and an overlay below that. Clicking any citation opens it.
- Nothing may disappear because a pane is narrow. Controls wrap, become icons with tooltips, or stay pinned to the pane width.

### 4.2 Start page
- A repo picker that remembers recent repos and finds local checkouts.
- For the selected repo:
  - **PRs you're authoring:** `gh search prs --author @me`;
  - **PRs waiting on your review:** `gh search prs --review-requested @me`;
  - **recent branches**, local and remote;
  - **reviews you've opened before**, with their unread and stale state ("new commits · Update").
- Selections are remembered.

### 4.3 Pages
- **Kinds:** the guide (the root page), concept pages, finding pages, and pages opened from an expansion. The kinds behave the same; only the root and finding pages show a type label.
- **Header:**
  - a label, but only where it matters: **"Guided review"** on the root page, **"Agent finding · <confidence>"** on a finding page;
  - a **bookmark** icon (save or unsave the page);
  - the title.
- **Trail:** a breadcrumb back to the root, on every page except the root.
- **Contents:** a collapsible box listing this page's cards (click to jump, expanding the card if needed) and the pages it links to. Read items are muted. There are no other status labels.
- **Go deeper:** the root page ends with placeholder cards for the directions the agent picked for this change. **Generate** shows progress and fills the card. A generated card may end with follow-up suggestions; clicking one adds its answer.
- **Saving:** pages are scoped to the repo. Saving is deferred (§2), but the bookmark and its state must exist.

### 4.4 Cards
Every card and every expansion card has the same controls:
- **Title:** every page card has a short title, shown in the card header and in Contents. The prompts require one for every card; when the agent omits it anyway, the app derives a fallback once — the first sentence or clause of the body as plain text, cut on a word boundary with an ellipsis. Expansions show the quoted selection as their header instead and get no derived title.
- **Collapse:** a leading chevron on the title row. A collapsed card shows only its title row.
- **Depth:** a − / + stepper with three dots and no level names. The levels are simpler, standard and first principles.
  - Changing depth rewrites the card's paragraphs in place.
  - + at the deepest level adds an "Underlying principle" block.
  - Depth versions are generated **on demand** and kept once made.
- **Use examples** and **Add diagram:** insert example or diagram blocks after the paragraphs they relate to, never duplicating one already there.
- **Undo:** reverts the card's last change (depth, examples or diagram). There's no history trail and no redo. Comments and expansions attached to the card survive undo.
- **Mark read:** greys the card and collapses it to its title row. Unmarking expands it.
- **Read state rolls up:** a page is read when all of its cards are, and links to fully read pages show muted.

### 4.5 Links and citations
- **Dotted links** all behave the same way: hover shows a preview card, click acts.
  - A link to a page previews its title and first paragraph; click opens the page.
  - A collapsed expansion previews its content; click expands it in place.
- **Citations:** a small `<>` marker at the end of a block, with a count if there's more than one.
  - Hover previews the cited lines.
  - Click opens the source pane at that spot and highlights it. If needed it unfolds or shows hidden hunks, and clears file filters.
  - Inline code chips in agent answers behave the same way.
- **Unverified citations:** a citation the app couldn't check or repair (§10) is shown dimmed, with a tooltip saying so.
- **Comment marker:** a speech bubble with a count, shown only for comments that never had highlighted anchor text. A thread whose quote can no longer be found in its host paragraph shows a footnote chip with its quote instead (see §4.7).
- **Anchor footnotes:** when an annotation's quote cannot be found in its host paragraph's rendered text (for example after a depth rewrite), a small muted chip on the paragraph's citations line shows the truncated quote (full quote on hover). Hover previews and click behave as the highlight did. One row per paragraph, shared with the `<>` chip; 12px muted, no underline until hover. A closed explanation shows dotted-link styling, an opened-as-page link an arrow, a thread a speech bubble. When the phrase returns, the highlight comes back and the chip disappears. Open cards stay in place with a muted "from an earlier wording" hint next to the quote.
- **Hover cards and tooltips:**
  - open after a short pause (about 0.2 s);
  - close on any scroll anywhere, a press outside them, Escape, the window losing focus or the pointer, and on resize;
  - after a scroll, hover is ignored until the pointer actually moves.

### 4.6 Selecting text
- Works in the guide, the PR description, and diff code.
- A selection snaps to whole words, with leading and trailing spaces trimmed, and the highlight updates to match.
- The toolbar offers **Explain**, **Ask…** and **Note**. Examples and diagrams come from the explanation card's own controls, not the toolbar.
- The toolbar appears only when the user finishes selecting text, never after clicking a control.

### 4.7 Explanations
- **Explain** creates an expansion card right under the block the text came from: under the paragraph in the description, under the line in the diff. The selected text is highlighted.
- **Header:** the quoted text, then **Open as page**, **Delete** and **Close**. Below that, the standard card controls.
- **Close** removes the card and turns the highlighted text into a dotted link: hover previews the explanation, click expands it. Marking an expansion read closes it the same way.
- **If the anchor text can't be found** (for example after a depth rewrite), a footnote chip is shown on the host paragraph's citations line instead of a collapsed card (see §4.5). Open explanation cards stay in place with a muted "from an earlier wording" hint next to the quote.
- **Open as page** moves the content to a new page titled with the quoted text, and the anchor text becomes a link to that page.

### 4.8 Comments
- **Ask…** starts a thread, and the agent replies with citations. **Note** starts a thread with no agent reply.
- **Thread header:** the quoted text (or `file:line` in the diff), then **Mark for PR** (a send icon, filled when on), **Delete** and **Close**.
- **Reply box:** always visible, with **Discard** and **Reply**.
  - Typed text survives anything else on the page re-rendering.
  - Discard removes a new thread, and clears the box on an existing one.
- **Where threads live:**
  - **Guide:** threads start closed. The anchor text is highlighted; hovering previews the thread, clicking opens it. Hovering an open thread outlines its anchor.
  - **Diff:** threads sit under their line and start open. Closing one leaves a comment icon on the line number, and clicking the number reopens it. Clicking any line number starts a comment.
  - **Description:** threads sit under their paragraph. Closing one leaves the highlight, or a marker.
- **Comments menu:**
  - lists every comment, from the guide, the description and the diff, and clicking one jumps to it;
  - the **For PR** filter shows the comments marked for the PR, each with an editable draft of the text to post;
  - it never posts.

### 4.9 Agent findings
- Findings are the agent's own judgements about the change: mismatches, risks, questionable choices. They are **separate pages**, never sentences mixed into the restatement.
- **In the guide:** an orange card labelled "Agent finding · <confidence>", with the title, a one-line summary and "Open →". It dims once the finding page is read.
- **The finding page:** carries the same label, and its cards have a rust left border. Typical cards are Evidence (each piece cited) and Assessment.
- **Suggested comments:** the agent drafts one on the relevant diff line, shown as "Agent · suggested comment" and *not* marked for the PR. The finding page links to it: hover previews it, click jumps to it. There's no separate suggestion card.

### 4.10 Second opinion
- A **Second opinion** action is available on any card or finding. It asks a *different* model (§12).
- **Mode:** **blind** by default for findings, where the model sees only the topic and the cited code. **Check this claim** by default for cards, where it sees the claim. A switch on the action selects the other mode.
- **Result:** a "Second opinion" block attached to the card, labelled with the model, giving a verdict (agrees / partly / disagrees), reasoning with citations, and anything the card missed. A disagreement is shown prominently.

### 4.11 PR description
- Shows the author's description. Paragraphs the guide restates have "Restated →" links back to the guide.
- **Editable only when the user is the PR author and the PR isn't merged.**
  - **Edit description** makes the text editable in place, with Discard and Save.
  - **Save** keeps the edit locally and shows "Edited · goes to GitHub when you submit the review", with **Revert edits**.
  - Edits keep paragraph identity, so citations and annotations still resolve.
- **For a branch without a PR:** the tab shows the commit messages instead, read-only.

### 4.12 Submit review
- **Nothing reaches GitHub until Submit review**, whether comments or a description edit.
- The top-bar button shows how many changes are pending. Its panel lists every comment marked for the PR (location and draft text) and the description change if there is one, with **Cancel** and **Submit as <user>**.
- Submitting creates **one GitHub review** containing all the comments, and updates the description.
- For a branch without a PR, Submit is disabled and says why.

### 4.13 Diff
**Toolbar:** **Files** (collapsed by default), **Unified / Split**, **Hide uninteresting** (on by default), **Fold all**, **Unfold all**.

**Files panel** (it scrolls with the diff):
- a filter-as-you-type name box;
- file-type chips: Source, Tests, Docs, Config, Generated;
- **Hide reviewed**, and a progress bar of hunks reviewed;
- a folder tree that compacts single-child folders, with +/− counts and reviewed/total per file. Clicking a file scrolls to it.

**File header:** collapse chevron, the path (with the file name always visible), +/− counts, the reviewed count, and a mark-file-reviewed toggle.

**Hunks**
- **Hunks are git's own:** a run of changed lines plus up to 3 unchanged lines of context, with nearby runs merged.
- **Header:** "Hunk i of n · lines a–b · in <function> · +x −y", with the raw `@@` line on hover.
- **Actions:** a leading fold chevron, then Summarize (agent), Add or Edit note, and Mark reviewed.
- **Hunk card:** the agent summary and the user's note, each with Delete. It exists regardless of folding. **Folding only hides code**, replacing it with "N changed lines folded · show".
- **Mark reviewed** greys the hunk and folds its code.

**Hide uninteresting**
- Hides generated-file, import-only, and docs or config hunks.
- Each run of hidden hunks becomes one thin row: "Hunks i–j hidden · <reason> · +x −y", plus a one-line reason why it's skippable. Clicking the row shows those hunks.
- **One-line changes are never hidden.** A real version should also never hide a hunk that the guide cites.

**Fold all and Unfold all:** Fold all summarizes and folds every hunk that isn't hidden. Unfold all shows all code and keeps the summaries.

**Views**
- **Unified:** long lines scroll sideways.
- **Split:** always two equal halves with fixed line-number columns; long lines wrap inside their half. Choosing Split widens the pane if it's narrow.
- **Pinned rows:** hunk headers, hunk cards, line comments and expansions are pinned to the pane width, so their controls never scroll out of view.

**New commits:** a "New commits on this branch · Update" banner. Stale and outdated markers follow §8.

### 4.14 Settings page
- **Models:** one picker per role: main, small, and second opinion. Each lists the provider and the models its ACP adapter offers.
- **Prompts:** each template (Template view): the raw text with its variables marked. View-only to start. The per-review "Expanded for this review" view — the exact text that would be sent now, with layers L0–L4 marked, token counts, and the cached part set apart — lives on the debug page below.
- **Limits:** concurrent sessions per provider, the inline size budget, base-rebuild thresholds.
- **Debug page** (per review, `/review/:id/debug`, linked from the review top bar):
  - **Jobs:** running and queued jobs. Each links to the exact prompt it sent, with tokens, cache-hit rate and provider.
  - **Shared context** as a rendered Markdown document — the base session(s) with the current base pack, the append-only log (§9.3), and every contribution (§9.5) with the thread it came from — plus delete for any item. No formatting beyond Markdown rendering.

### 4.15 UI conventions

| Meaning | Control | Placement |
|---|---|---|
| Collapse in place, leaving a header row | Chevron ▾ / ▸ | First, on the left of the row |
| Close, leaving the anchor link or marker | × | Always last on the right |
| Delete | Trash | Right side, just before × |
| Item actions | Icons with tooltips | Right side, before Delete |
| Read / reviewed | Check in a circle | Right end of card controls; hunk and file headers |
| Agent content vs the user's | "AI" or the user's initials on each message; teal for the agent, amber for the user's comments | Threads, hunk cards |

- The only type labels are "Guided review" and "Agent finding".
- Comments and expansions use the same header layout.
- An element hidden with the `hidden` attribute must stay hidden even if its own style sets `display`. Two prototype bugs came from this.

---

## 5. Architecture overview

```
┌───────── Installed web app (Chrome "Install app", served from localhost) ─────────┐
│  React UI: start page · guide · source pane · settings                            │
└───────────────▲─────────────────────────────── HTTP + WebSocket (token) ──────────┘
                │
┌───────────────┴──────────────── Unvibe service (Node/TypeScript, localhost) ───────┐
│  Review store (SQLite + files) · ingest (git/gh) · context builder · job queue    │
│  Citation validator · MCP server (HTTP, shared by all sessions)                   │
│  AgentRunner interface ──► ACP client ──► claude-agent-acp / codex-acp (stdio)    │
│                                              │                                     │
│                                    claude / codex CLIs (user's logins)             │
└───────────────────────────────────────────────────────────────────────────────────┘
        gh / git (user's logins) ◄── ingest, submit          worktree of the branch
```

- **One process, the Unvibe service,** owns all state and talks to every external tool.
- **The UI** is a static React app served by the service, and talks to it over HTTP and a WebSocket.
- **Agents read code** in a worktree of the branch that the service creates (`git worktree add`, or `gh pr checkout` in a worktree). They query review data through the service's MCP server.

---

## 6. Agent runner

ACP (Agent Client Protocol) comes first, through `@agentclientprotocol/sdk`, with `@agentclientprotocol/claude-agent-acp` and `@agentclientprotocol/codex-acp` as subprocesses. **Nothing outside this module may depend on ACP.** (Package names corrected; see the `spike/acp` branch (`docs/m0-acp-spike.md`) § "Packages and versions".)

```ts
interface AgentRunner {
  start(opts: { provider: string; model: string; cwd: string; systemPrompt: string;
                mcpServers: McpServerConfig[] }): Promise<Session>;
  fork?(session: Session, opts?: { atMessage?: string }): Promise<Session>; // optional capability
  load(sessionId: string): Promise<Session>;                                 // reopen after idle close
  prompt(session: Session, text: string, signal?: AbortSignal): AsyncIterable<AgentEvent>;
  close(session: Session): Promise<void>;
}
type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; status: "start" | "end" }
  | { type: "usage"; inputTokens: number; cachedTokens: number; outputTokens: number }
  | { type: "done"; stopReason: string }
  | { type: "error"; message: string; retryable: boolean };
```

- **Facts checked in the source, October 2026:**
  - **Claude:** `@agentclientprotocol/claude-agent-acp` is built on the Claude Agent SDK. It implements session fork (including fork from a given message), load, list and resume, and accepts per-session MCP servers and a system prompt.
  - **Codex:** `@agentclientprotocol/codex-acp` is built on `codex app-server`, implements the same session calls, and supports ChatGPT login.
  - **The spec:** `session/fork` is in the unstable part of the ACP spec.
- **If fork isn't available:** the context builder sends the same layers as the first message of a fresh session (§9). The prefix still matches byte for byte, so caching still works.
- **Replacements** must implement the same interface: Paseo (no fork), or the Claude Agent SDK and `codex app-server` directly (both can fork).

---

## 7. Data model and IDs

### 7.1 Entities

| Entity | Key fields |
|---|---|
| Repo | id, owner/name, local path, last opened |
| Review | id, repo, **branch name**, PR number (optional), versions[], current version |
| Version | n, head SHA, merge-base SHA, base ref, fetched at, mapping from the previous version's IDs |
| File / Hunk | file key, path, category, hunk **content hash**, header, line ranges, `hidden_reason` |
| HunkState | content hash → folded, reviewed, summary, note (carried across versions by hash) |
| Page | id, kind (root, concept, finding, opened-expansion), title, saved, parent, cards[] |
| Card | id, page, title, level, read, collapsed, revision, blocks[], undo stack |
| Block | id, type (paragraph, list, table, code, diagram, finding link, follow-up, aside), text per depth level, citations |
| Annotation | id, type (expansion, thread, link), anchor, open/closed, plus for threads: messages, `post`, draft, note flag |
| Anchor | host (block ID, description paragraph, or diff line), quoted text, prefix/suffix, position at creation, version |
| Contribution | id, source session, items (fact, correction, open question, reader note), citations, replaces, status |
| Job | id, kind, model, priority, state, session ID, prompt snapshot, usage, error |
| LogEntry | seq, kind, payload, scope (global, or local to a card) |

### 7.2 ID grammar
The app assigns all IDs; agents never invent them. They appear in links as tokens (§10).

```
diff:<fileKey>:<line>[-<line>]@<headSha>   new-side lines in the change
h:<fileKey>:<contentHash>                  a hunk (stable across versions)
code:<path>:<line>[-<line>]@<sha>          any code at a commit (pinned or fetched)
desc:<paragraph>@<rev>                     description paragraph
card:<cardId>[#<blockId>]                  guide content
page:<pageId>                              a page
concept:<slug>                             a concept (may be a hidden candidate)
ann:<id>                                   an annotation
```

- **Short forms:** within one version, the UI and prompts may drop the `@<sha>` suffix. Stored references always keep it.
- **Card and block IDs stay the same across revisions,** so a reference always means the latest version.

---

## 8. Versions, pushes and rebases

- **Every anchor is tied to content**, not position. It keeps:
  - its position when created;
  - the quoted text with a few lines before and after (prefix and suffix);
  - its hunk's content hash, which ignores line numbers and whitespace.
- **Each fetch that finds a new head SHA creates a version** with an old-to-new ID mapping. Older versions stay viewable.
- **Telling branch changes from a rebase:** compare the old diff (old merge-base..old head) with the new one (new merge-base..new head) hunk by hunk, using content hashes. Use `git range-diff` to match commits for display. A rebase without conflicts comes out as "no change".

| Item | Content unchanged | Content changed |
|---|---|---|
| Hunk state | Kept; found again by hash | Reviewed is cleared, the summary regenerated, the note kept and marked "code changed since" |
| Comment or annotation on code | Moved by matching content | Marked **outdated**: the original snippet is shown, with a link to the new code |
| Card | Citations remapped | Stale badge ("2 cited hunks changed") and an **Update** button |
| Finding | Remapped | Rechecked: still applies, resolved, or changed |
| Pinned code | Found again by content | Pinned again by the update pass |
| Thread in progress | Its change list notes moved anchors | Its change list includes the changed code; a large change offers a move to the new base |

**Updates are manual.**
1. Fetching and comparing happen whenever the review is opened, or when the user clicks refresh. They cost no agent time.
2. The **update pass** runs only when the user clicks Update. It uses a fork of a new base and sees only the changed and new hunks. It revises stale cards, rechecks findings, writes findings for new code, and summarizes changed hunks.

Uncommitted local edits can be treated as an extra version.

---

## 9. Context for agent sessions

The aim: every conversation starts mostly from cache, and rarely needs a tool call to see content.

### 9.1 Layers, least likely to change first

| Layer | Contents | Changes when |
|---|---|---|
| L0 Harness | The adapter's system prompt and tools, our MCP tools (identical in every session), our instructions (link tokens, output format) | App release |
| L1 Source | Metadata, description or commit log, the full handwritten diff with IDs inline (a hunk ID on each header, the new-side number on each line), the file list, one-line summaries of hidden hunks | New version |
| L1b Pinned code | Code excerpts the reader pinned, each with a `code:` ID | New version |
| L2 Reader output | Guide cards at standard depth, findings, the concept index (one line each), hunk summaries | Guide regenerated |
| L3 Annotations | Appended log entries (§9.3) | Continuously |
| L4 Conversation | The anchor (quote, full host block, its card), nearby annotations in full, the thread so far, the change list, the user's message | Every turn |

- **Size budget:** the starting guess is about 40k tokens of handwritten diff in L1. Over budget, L1 inlines hunk headers, summaries and pinned hunks only, and the rest is fetched with `get_hunk`.
- **Caches are per model,** so each model in use gets its own base.

### 9.2 Base session
- Built from L0 plus one message containing L1 + L1b + L2, to which the agent answers "ready".
- Keyed by (version, guide revision, model).
- **Each conversation is `fork(base)`** plus one message containing L4.
- The reader's own exploratory session is never forked: it's large and noisy.
- **Fan-out:** the base is warmed first, then forks go out in parallel.

### 9.3 The append-only log and change lists
- **What enters the log:**
  - **never:** read, collapse, depth, open/close and "mark for PR" state;
  - **only for conversations anchored on that card:** examples, diagrams and depth rewrites;
  - **one line, once a thread settles:** a summary of the thread;
  - **in full:** new cards and findings, and answers that cited something outside the base;
  - **a one-line deletion entry:** for a deleted item that had been shared.
- **The base grows by appending batches as new turns** (threshold about 2k tokens), so its cached prefix stays valid.
- **Each session records the last log entry it has seen,** and its next turn gets a filtered change list (global entries, plus local ones for its card or hunk).

### 9.4 Rebuilding the base
A new base is built when any of these happens:
1. a new version, or the guide is regenerated;
2. **the provider cache has expired** (the prefix is cold anyway, so rebuilding is free). This is the main cleanup trigger;
3. too much has been superseded (for example more than 20% of the base, or more than 10k tokens appended).

### 9.5 Contributions (automatic)
- **Each agent turn may end with a `contribute` block:**
  - `facts` (citations required);
  - `corrections` (they target `card:…#block`);
  - `open_questions`;
  - `reader_notes` (what the user found unclear or already understood);
  - `replaces` (the ID of an earlier contribution this supersedes).
  - At most 1–3 items; usually empty; only what isn't already in the session's context.
- **The app:**
  - validates citations, drops facts without them, and drops duplicates;
  - appends the rest to the log, labelled with its source;
  - shows corrections as suggestions on the target card. The user accepts (creating a new card revision) or dismisses; nothing is rewritten silently.
- **On each base rebuild,** the small model merges contributions: it removes duplicates, resolves superseded items, and folds accepted corrections in.

---

## 10. Linking and validation

- **Agents write Markdown with inline tokens:** `[[diff:sp:147-152]]`, `[[code:src/x.py:10-20]]`, `[[desc:d-table]]`, `[[card:central#p-rule]]`, `[[page:f-522]]`, `[[concept:idempotency|idempotency]]`.
- **Structured fields** (a new card's title, `contribute`, a second-opinion verdict) go in one fenced JSON block at the end of the reply. The app removes it before display. ACP has no standard structured output, so this needs testing with both adapters (§19).
- **MCP tools** (a fixed set, identical in every session):

| Tool | Returns |
|---|---|
| `get_hunk(id)` | The hunk's text, with IDs on every line |
| `get_code(path, lines, sha?)` | Code at a commit, with a `code:` ID |
| `search_review(query)` | Matching cards, annotations and contributions, with IDs |
| `resolve(description)` | Candidate IDs for a description of a location |

- **Validation of every token, before display:**
  - the ID must exist in the current version (or map to it);
  - line ranges must lie inside the hunk, or the file at that commit;
  - a quoted anchor must be a real substring of its host;
  - unknown `concept:` slugs become **hidden concept candidates**, with the page written when first opened.
- **On failure:**
  - repair automatically if the fix is unambiguous (for example a line range off by a few lines in the same hunk);
  - otherwise show the citation **dimmed as unverified** and record it in the job's debug data;
  - send one follow-up turn asking for repair only if several citations in a reply fail.

---

## 11. Pipelines

1. **Ingest** (no agent, seconds):
   - work out whether the source is a PR (`gh pr view --json …`) or a branch;
   - fetch;
   - compute the merge-base diff and parse it into hunks with content hashes;
   - assign IDs;
   - classify files (`.gitattributes linguist-generated`, path rules, extension);
   - build L1 and check it against the size budget;
   - create or reuse the worktree.
2. **Reader** (main model, one session, cards streamed as they finish):
   - explores the repo;
   - writes the problem card, the central-change card, and the "Go deeper" directions (title plus why);
   - makes a **hidden concept pass** (slug, title, one line, where mentioned);
   - **pins code** with a `pin_context(path, lines, why)` tool, the one tool only the reader gets.
3. **Build the base** (§9.2).
4. **Parallel forks of the base:**
   - a **critic** (main model): findings with evidence, an assessment, a confidence level, and drafted suggested comments on diff lines;
   - **concept stubs** (main model, one batch).
5. **Hunk pass** (small model, no fork): a summary for each hunk, plus the uninteresting classification with a one-line reason.
6. **On demand:** depth versions, "Go deeper" cards, explanations, examples, diagrams, answers, full concept pages, second opinions.
7. **Update pass** (§8).

---

## 12. Models and concurrency

- **Main model:** everything that needs the review's context. Using one model means one base.
- **Small model:** hunk summaries, the uninteresting classification, consolidating contributions, titles. These jobs get only what they need and don't fork the base.
- **Second-opinion model:** a different provider or model. It runs in a fresh session with its own base, containing L0 + L1 + the cited code. It never sees guide text, other findings, contributions, or the main model's pinned code beyond what's cited.
- **Concurrency:**
  - a per-provider session cap, starting at 4;
  - a priority queue: what the user asked for, then what's visible on screen, then background work;
  - back off on rate limits, and show it on the job;
  - cancel a job when its card closes (ACP `session/cancel`);
  - reuse results for identical requests, keyed by (anchor, kind of request, depth, base version);
  - close idle sessions after the cache lifetime, and reopen them with `load`.

---

## 13. Prompts

- **Templates** are files (`prompts/<name>.md`) whose front matter gives the role, model tier and variables.
- **Rendering is deterministic:** stable ordering, no timestamps, the same bytes for the same inputs.
- **Templates are shown in Settings** (§4.14).

| Template | Used by | Key variables |
|---|---|---|
| `instructions` (L0) | All main-model sessions | Link-token rules, output format, the `contribute` schema |
| `reader` | Reader | `{{source}}`, `{{diff_inline}}`, repo path |
| `base_pack` | Base | `{{source}}`, `{{diff_inline}}`, `{{pinned_code}}`, `{{guide}}`, `{{concepts}}`, `{{hunk_summaries}}` |
| `critic` | Critic fork | Criteria, the suggested-comment format |
| `hunk_pass` | Small model | `{{hunk}}`, `{{path}}` |
| `concept_stub`, `concept_page` | Concept pages | `{{concept}}`, `{{mentions}}` |
| `explain`, `ask`, `note_ack` | Conversations (L4) | `{{anchor.quote}}`, `{{anchor.block}}`, `{{card}}`, `{{thread}}`, `{{change_list}}`, `{{message}}` |
| `depth`, `examples`, `diagram` | Card controls | `{{card}}`, `{{level}}` |
| `go_deeper` | Placeholder cards | `{{direction}}` |
| `update_pass` | Update | `{{changed_hunks}}`, `{{stale_cards}}`, `{{findings}}` |
| `consolidate` | Small model | `{{contributions}}` |
| `second_opinion_blind`, `second_opinion_check` | Second opinion | `{{topic}}` or `{{claim}}`, `{{cited_code}}` |

**Diagrams:** decided as D2, rendered on the service by a user-installed `d2` binary; citations as `link:` on shapes (see `docs/d2-diagrams.md`). Superseded proposal (kept as history): agents were to write Mermaid, rendered on the page, with citation tokens allowed in node labels; the prototype used hand-drawn SVG.

**Shared instructions:** `instructions` (L0) carries guidance shared by every task: every page card has a short title (§4.4), and replies never repeat what the reader already sees — no echo of the selection, the question, the card title or a diagram's caption. As a backstop the parser drops a leading body line that exactly echoes them (no retry, no repair turn).

---

## 14. App shell, install and security

- **Service:** Node and TypeScript, listening on `127.0.0.1` only. It requires a **token** (one per install): generated at setup, held by the UI, and checked on every HTTP and WebSocket request.
- **UI:** a React (Vite) build served by the service, and **installable as a web app** from Chrome (localhost counts as secure). There are no browser extensions.
- **Nothing starts at login.**
  - `unvibe setup` writes a small link-handler app to `~/Applications`. It's generated locally, so Gatekeeper doesn't quarantine it and it needs no Apple signing, and it registers the `unvibe://` URL scheme.
  - When the service isn't running, the installed web app's cached "Start Unvibe" page links to `unvibe://start`. The link handler starts the service, and the page reloads.
  - The service exits after a period with no open window and no running jobs (default 10 minutes).
- **Install:** `npm install -g github:<org>/unvibe#release`, then `unvibe setup`. Updates use the same install command. The agent CLIs (`claude`/`codex`) are the user's own installs (see `DEVELOPMENT.md` "Releases" and `docs/acceptance-audit.md` "Intentional deviations" item 1).
- **macOS gotcha:** apps opened from Finder don't inherit the shell's `PATH`. On startup the service must read it from a login shell (`zsh -lc 'echo $PATH'`) so it can find `gh`, `git`, `claude`, `codex` and mise-installed tools.
- **Storage:** `~/.local/share/unvibe/` holds a SQLite database plus a folder per review (`<owner>/<repo>/<review-id>/`) for the log and snapshots. Nothing is written into the user's checkout, apart from the worktree, which is created alongside it under a managed path.

### 14.1 Service API (proposal)

```
GET  /api/repos                          recent and detected repos
POST /api/repos                          add a repo path
GET  /api/repos/:id/changes?filter=      PRs (authoring | review-requested) and branches
POST /api/reviews                        { repoId, pr? , branch? } → review
GET  /api/reviews/:id                    snapshot: version, pages, cards, annotations, hunk state, jobs
POST /api/reviews/:id/refresh            fetch and compare (no agent)
POST /api/reviews/:id/update             run the update pass
POST /api/reviews/:id/actions            { kind: explain|ask|note|depth|examples|diagram|undo|read|
                                           collapse|generate|second_opinion|promote|close|delete, … }
PATCH /api/reviews/:id/hunks/:hash       { folded?, reviewed?, note? } ; POST …/summarize
PATCH /api/reviews/:id/comments/:id      { post?, draft? }
PUT  /api/reviews/:id/description        local edit (pending until submit)
POST /api/reviews/:id/submit             one GitHub review plus the description update
GET  /api/settings · PUT /api/settings
GET  /api/prompts?review=:id             templates and expanded text
GET  /api/jobs?review=:id
WS   /api/events?review=:id              job progress, streamed text, state patches
```

---

## 15. GitHub and git integration

| Need | Command |
|---|---|
| List PRs | `gh search prs --author @me --repo …`, `gh search prs --review-requested @me --repo …` |
| PR metadata, description, files | `gh pr view <n> --json title,body,author,state,isDraft,baseRefName,headRefName,headRefOid,files` |
| Diff | `git diff <merge-base>...<head>` locally (more reliable than `gh pr diff` for large PRs, which fails above 300 files) |
| Existing review threads | `gh api repos/{o}/{r}/pulls/{n}/comments` |
| Submit review | `gh api repos/{o}/{r}/pulls/{n}/reviews -f event=COMMENT -f body=… -F comments[]=…` (one review, every comment) |
| Update description | `gh pr edit <n> --body-file <file>` |
| Worktree | `git worktree add <managed-path> <head>` |
| Rebase comparison | `git range-diff <old-base>..<old-head> <new-base>..<new-head>` |

- **Description edits** are converted from the edited HTML back to Markdown before `gh pr edit`. Content outside edited paragraphs must round-trip unchanged.
- **If `GITHUB_TOKEN` is set in the environment** without the needed scopes, it can override the `gh` keyring login. Run `gh` with `GITHUB_TOKEN` unset unless the user configures otherwise.

---

## 16. Non-functional requirements

- **Time to first card:** under about 90 s for a small-to-medium PR such as urllib3#5020 (hunks appear within seconds).
- **Interactive latency:** an explanation or answer starts streaming within about 5 s when the base is warm.
- **Cache efficiency:** measure and show the cache-hit rate. Target: most conversation input tokens are cache reads.
- **Resilience:** a service restart loses no user data. Sessions are reopened with `load`, or rebuilt from the log.
- **Privacy:** data stays on the machine, apart from agent provider calls made by the user's own CLIs, and GitHub calls made with `gh`.

---

## 17. Milestones and acceptance criteria

| # | Milestone | Done when |
|---|---|---|
| **M0** | **ACP spike** (do this first) | In both `claude-agent-acp` and `codex-acp`: start a session with a system prompt plus an MCP server, send a ~30k-token pack, fork it twice, and confirm that (a) each fork answers questions about the pack, (b) usage shows cache reads on the forks, (c) a trailing JSON block parses reliably. Results written up. |
| M1 | Service, ingest and diff | Start page lists repos, PRs and branches. Opening one ingests it. The diff pane has every §4.13 feature except agent summaries. Token-protected localhost service, installable web app, helper and idle exit. |
| M2 | Reader and guide | Reader, base and critic run. The guide shows cards with checked citations and hover previews. Findings appear as pages. Concept candidates are hidden. Hunk pass summaries, and Hide uninteresting with reasons. |
| M3 | Interaction | Explain, Ask and Note on the guide, description and diff. The depth stepper, examples and diagrams on demand, and undo. Expansions close into links; Open as page. Mark read. Contents. The log, change lists and contributions; the per-review shared-context debug page. |
| M4 | Comments and submit | Threads in all three places, the Comments menu with For PR drafts, agent-suggested comments, description editing (author, open PR), and Submit review posting one review. |
| M5 | Versions | Refresh, the version mapping, a stale and outdated UI, preservation of hunk state by hash, and the update pass. A rebase without conflicts shows no changes. |
| M6 | Second opinion and settings | Second opinion (blind or check). The settings page with models, prompt templates and limits; the per-review debug page with jobs, the expanded prompt text, and usage. |

## 18. Testing and evaluation

- **Unit tests:** diff parsing and hunk hashing; ID grammar and validation; anchor remapping, including fixtures for the rebase and amend cases; log and change-list filtering; deterministic prompt rendering (golden files).
- **Integration tests:** a fake `AgentRunner` that replays recorded sessions, so UI and pipeline tests don't need live agents.
- **Live evaluation:** a handful of real PRs, starting with urllib3#5020. Check citation validity (the unverified rate), finding precision, and cache-hit rate. Spot-check that answers stay grounded.
- **UI behaviour:** check against §4, using the prototype as the reference.

## 19. Open questions

1. **Where the code lives:** its own `unvibe` repo (recommended), or a package inside an existing monorepo.
2. **The size budget** and the rebuild thresholds. Set them from M0 and M2 measurements.
3. **Structured output over ACP:** whether the trailing JSON block is reliable enough, or whether each adapter's metadata passthrough should be used.
4. **The diagram format:** decided as D2, rendered on the service by a user-installed `d2` binary; citations as `link:` on shapes (see `docs/d2-diagrams.md`). Superseded options (kept as history): Mermaid with citation tokens in labels, or a small JSON diagram spec.
5. **Subscription terms:** Anthropic's rules for Agent SDK and `claude -p` usage changed several times in 2026. Recheck them before release.
6. **Saved pages:** sharing and refresh across PRs, when concept identity across reviews is tackled. Deferred.
7. **Reading other content:** the source pane and anchor scheme for web pages. Deferred.
8. **Semantic grouping of the diff.** Deferred.

## 20. Where the prototype fakes behaviour

- Agent output is written in advance. Explanations and answers are matched by keyword, and anything else gets a placeholder.
- "Uninteresting" is rule-based (file type, import-only lines). The real version should have the agent judge each hunk, and never hide a hunk the guide cites.
- There's no persistence: reloading resets everything.
- Submit and description saves post nothing.
- The sample PR is someone else's and already merged, so the description is read-only. A "Prototype: view as the author" switch on the description tab shows author mode and editing.
- The sample PR has no generated files, so the Generated filter is empty. Hide uninteresting hides the changelog and three import-only hunks.
- The bare-LF finding is based on a local check of `http.client` behaviour, not a test in the PR.
- There's no start page, settings page, second opinion, version handling, unverified-citation style, or shared-context view. Those are specified here but weren't prototyped.
