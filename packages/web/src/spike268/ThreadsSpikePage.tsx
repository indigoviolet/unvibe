/**
 * Spike #268: flat threads mock-up (NEVER merged to main).
 *
 * One thread component for comments, Explain/Ask answers (and later
 * persona notes): a thread anchored somewhere, with flat replies of
 * different kinds. In-thread hyperlinks scroll to their reply and
 * highlight it. A header control collapses every thread to one row.
 */
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../components/Icon.js";
import "./spike268.css";

export type ReplyKind = "ask" | "explain" | "comment";

export interface SpikeReply {
  id: string;
  kind: ReplyKind;
  /** Agent answer vs reviewer comment — the visible distinction. */
  who: "agent" | "you";
  /** Reply heading: the question (ask) or the explained phrase. */
  heading: string;
  /** Body HTML; exactly one hyperlink may carry data-replylink. */
  html: string;
  /** Reply this hyperlink points at (same thread). */
  linkTo?: string;
  linkText?: string;
}

export interface SpikeThread {
  id: string;
  /** Where the thread is anchored (guide card excerpt on this page). */
  anchorQuote: string;
  anchorContext: string;
  replies: SpikeReply[];
}

const FEATURED: SpikeThread = {
  id: "th-featured",
  anchorQuote: "raw CRLF",
  anchorContext: "The problem · urllib3#5020 demo",
  replies: [
    {
      id: "r1",
      kind: "ask",
      who: "agent",
      heading: "Ask · Why does Requests re-emit the raw CRLF?",
      html: `Because Requests reads <code>http.client</code>'s own message object, not urllib3's copy — so it sees the folded value as it arrived. urllib3 now <LINK> right after <code>http.client</code> parses the response, so downstream consumers never see the break.`,
      linkTo: "r2",
      linkText: "normalizes each fold to a single space",
    },
    {
      id: "r2",
      kind: "explain",
      who: "agent",
      heading: "Explain · “normalizes each fold to a single space”",
      html: `Each RFC 9112 <code>OWS CRLF RWS</code> sequence becomes one <code>SP</code> before urllib3 or downstream consumers interpret the value. A common-case fast path handles short values; a linear-time pattern covers long field values. Header names, ordering, duplicate fields and parser state are preserved.`,
    },
    {
      id: "r3",
      kind: "comment",
      who: "you",
      heading: "Reviewer comment",
      html: `Good — let's call out the <code>Set-Cookie</code> regression explicitly in the description so the security angle is obvious.`,
    },
  ],
};

const MORE: SpikeThread[] = [
  {
    id: "th-sync",
    anchorQuote: "keeps HTTPHeaderDict and HTTPMessage synchronized",
    anchorContext: "Description · d-p2",
    replies: [
      {
        id: "th-sync-r1",
        kind: "comment",
        who: "you",
        heading: "Reviewer comment",
        html: `Should we name Requests here or keep it generic?`,
      },
      {
        id: "th-sync-r2",
        kind: "comment",
        who: "you",
        heading: "Reviewer comment",
        html: `Keeping it — the re-emit path is the whole point of the fix.`,
      },
    ],
  },
  {
    id: "th-ows",
    anchorQuote: "OWS CRLF RWS",
    anchorContext: "Description · d-p1",
    replies: [
      {
        id: "th-ows-r1",
        kind: "explain",
        who: "agent",
        heading: "Explain · “OWS CRLF RWS”",
        html: `Optional whitespace, <code>CRLF</code>, then required whitespace — the exact fold shape RFC 9112 names.`,
      },
    ],
  },
  {
    id: "th-fastpath",
    anchorQuote: "fast path",
    anchorContext: "The central idea",
    replies: [
      {
        id: "th-fastpath-r1",
        kind: "ask",
        who: "agent",
        heading: "Ask · When does the fast path trigger?",
        html: `Short field values without a fold take the early return — only values containing <code>CRLF</code> go through <LINK>.`,
        linkTo: "th-fastpath-r2",
        linkText: "the linear-time pattern",
      },
      {
        id: "th-fastpath-r2",
        kind: "explain",
        who: "agent",
        heading: "Explain · “the linear-time pattern”",
        html: `One pass over the value, no backtracking: each <code>OWS CRLF RWS</code> run is replaced inline, so cost stays proportional to value length.`,
      },
    ],
  },
];

export const ALL_THREADS: SpikeThread[] = [FEATURED, ...MORE];

function latestSnippet(t: SpikeThread): string {
  const last = t.replies[t.replies.length - 1];
  const tmp = document.createElement("div");
  tmp.innerHTML = last.html;
  const text = tmp.textContent ?? "";
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
}

function ReplyBody({ reply, onLink }: { reply: SpikeReply; onLink: (targetId: string) => void }) {
  if (!reply.linkTo || !reply.linkText) {
    return <p dangerouslySetInnerHTML={{ __html: reply.html }} />;
  }
  const parts = reply.html.split("<LINK>");
  return (
    <p>
      <span dangerouslySetInnerHTML={{ __html: parts[0] }} />
      <button
        type="button"
        className="rlink"
        data-replylink={reply.linkTo}
        onClick={() => onLink(reply.linkTo as string)}
      >
        {reply.linkText}
      </button>
      <span dangerouslySetInnerHTML={{ __html: parts[1] ?? "" }} />
    </p>
  );
}

export function SpikeReplyView({
  reply,
  flash,
  onLink,
}: {
  reply: SpikeReply;
  flash: boolean;
  onLink: (targetId: string) => void;
}) {
  return (
    <div
      className={`spike-reply${flash ? " flash" : ""}`}
      id={reply.id}
      data-reply={reply.id}
      data-kind={reply.kind}
    >
      <span
        className={`av ${reply.who === "you" ? "you" : "ai"}`}
        role="img"
        aria-label={reply.who === "you" ? "You" : "Agent"}
      >
        <Icon name={reply.who === "you" ? "person" : "spark"} />
      </span>
      <div className="spike-reply-main">
        <div className="spike-reply-head">
          <span className={`kind kind-${reply.kind}`}>{reply.kind}</span>
          <span className="ans-q">{reply.heading}</span>
        </div>
        <ReplyBody reply={reply} onLink={onLink} />
      </div>
    </div>
  );
}

export function SpikeThreadView({
  thread,
  flashId,
  onLink,
}: {
  thread: SpikeThread;
  flashId: string | null;
  onLink: (targetId: string) => void;
}) {
  return (
    <section className="ithread spike-thread" id={thread.id} data-thread={thread.id} aria-label="Thread">
      <div className="thd">
        <span className="mq">“{thread.anchorQuote}”</span>
        <span className="hint">{thread.anchorContext}</span>
        <span className="count" data-count={thread.id}>
          {thread.replies.length} {thread.replies.length === 1 ? "reply" : "replies"}
        </span>
      </div>
      {thread.replies.map((r) => (
        <SpikeReplyView key={r.id} reply={r} flash={flashId === r.id} onLink={onLink} />
      ))}
    </section>
  );
}

export function SpikeCollapsedRow({
  thread,
  onExpand,
}: {
  thread: SpikeThread;
  onExpand: () => void;
}) {
  const first = thread.replies[0];
  return (
    <button
      type="button"
      className="spike-row"
      data-row={thread.id}
      onClick={onExpand}
      aria-label={`Expand thread ${thread.anchorQuote}`}
    >
      <span className="spike-row-q">“{thread.anchorQuote}”</span>
      <span className="spike-row-first">{first.heading}</span>
      <span className="spike-row-sep">·</span>
      <span className="spike-row-snip">{latestSnippet(thread)}</span>
      <span className="spike-row-count">
        {thread.replies.length} {thread.replies.length === 1 ? "reply" : "replies"}
      </span>
      <Icon name="right" />
    </button>
  );
}

export function ThreadsSpikePage() {
  // Owner decision: one header control collapses ALL threads, comment
  // threads included. Rows show question/anchor + latest snippet + count.
  const [collapsedAll, setCollapsedAll] = useState(false);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set([FEATURED.id]));
  const [flashId, setFlashId] = useState<string | null>(null);

  useEffect(() => {
    if (!flashId) return;
    const t = window.setTimeout(() => setFlashId(null), 2400);
    return () => window.clearTimeout(t);
  }, [flashId]);

  const scrollToReply = useCallback((targetId: string) => {
    setFlashId(targetId);
    window.setTimeout(() => {
      const el = document.getElementById(targetId);
      if (!el) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    }, 30);
  }, []);

  const collapsed = (id: string): boolean => collapsedAll && !openIds.has(id);

  return (
    <div className="app with-reviewbar spike268">
      <div className="spike-topbar" aria-label="Review bar (spike)">
        <span className="spike-topbar-title">urllib3#5020 · Unfold obsolete folded response headers</span>
        <span className="spike-badge">spike 268 · not merged</span>
      </div>
      <div className="cols spike-cols">
        <main className="col" id="page">
          <div className="doc">
            <div className="spike-guidehead">
              <h1 className="title">Guide</h1>
              <button
                type="button"
                className="ib spike-collapse-all"
                data-testid="collapse-threads"
                data-tip={collapsedAll ? "Expand all threads" : "Collapse all threads"}
                aria-label={collapsedAll ? "Expand all threads" : "Collapse all threads"}
                aria-pressed={collapsedAll}
                onClick={() => {
                  if (collapsedAll) {
                    setOpenIds(new Set(ALL_THREADS.map((t) => t.id)));
                    setCollapsedAll(false);
                  } else {
                    setOpenIds(new Set());
                    setCollapsedAll(true);
                  }
                }}
              >
                <Icon name={collapsedAll ? "unfold" : "fold"} />
                <span className="spike-collapse-label">
                  {collapsedAll ? "Expand threads" : "Collapse threads"}
                </span>
              </button>
            </div>
            <p className="hint spike-lede">
              Flat threads (spike #268): one thread component, replies stay flat. The first thread is
              open below; the header control collapses every thread — comment threads included — to
              one row each.
            </p>

            <section className="ui-card" aria-label="Guide card: The problem">
              <div className="chead">
                <h2 className="ct">The problem</h2>
              </div>
              <p>
                HTTP/1.1 used to let a server continue a header value on the next line by starting
                that line with a space or tab. That&apos;s obsolete line folding. Python&apos;s{" "}
                <code>http.client</code> keeps the folded value as it arrived, with the{" "}
                <mark className="anc" data-thr={FEATURED.id}>
                  raw CRLF
                </mark>{" "}
                inside it, and urllib3 copied those values straight into its{" "}
                <code>HTTPHeaderDict</code>.
              </p>
            </section>

            <h2 className="spike-h2">Thread · Ask, then Explain inside it, then a reviewer comment</h2>
            {collapsed(FEATURED.id) ? (
              <SpikeCollapsedRow
                thread={FEATURED}
                onExpand={() => setOpenIds((s) => new Set(s).add(FEATURED.id))}
              />
            ) : (
              <SpikeThreadView thread={FEATURED} flashId={flashId} onLink={scrollToReply} />
            )}

            <h2 className="spike-h2">More threads on this page</h2>
            {MORE.map((t) =>
              collapsed(t.id) ? (
                <SpikeCollapsedRow
                  key={t.id}
                  thread={t}
                  onExpand={() => setOpenIds((s) => new Set(s).add(t.id))}
                />
              ) : (
                <SpikeThreadView key={t.id} thread={t} flashId={flashId} onLink={scrollToReply} />
              ),
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
