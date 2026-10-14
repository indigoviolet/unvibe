/**
 * Read-only GitHub comment thread (issue #168).
 *
 * Reuses the user-thread classes (`ithread`, `thd`, `msg`, `av`) so the
 * read-only threads look like the threads they sit beside, without
 * changing `ThreadView`'s behaviour for user comments: no composer, no
 * Mark-for-PR, no Delete — only collapse, the rendered bodies and an
 * "Open on GitHub" link per message. Bodies render the `bodyHtml` the
 * service produced with the shared untrusted-Markdown renderer, never raw
 * HTML from GitHub.
 */
import type { ExistingReviewComment } from "@unvibe/shared";
import { Icon } from "../components/Icon.js";
import type { GithubThread } from "./GithubThreads.js";

function Message({ message }: { message: ExistingReviewComment }): React.JSX.Element {
  return (
    <div className="msg">
      <span
        className="av gh"
        role="img"
        aria-label={message.author ?? "GitHub"}
        data-tip={message.author ?? "GitHub"}
      >
        <Icon name="person" />
      </span>
      <div>
        {message.author ? <span className="who">{message.author}</span> : null}
        {/* Block HTML (paragraphs, lists, fences): no <p> wrapper, so the
            service-rendered blocks nest validly. */}
        <div className="ghbody" dangerouslySetInnerHTML={{ __html: message.bodyHtml }} />
        {message.htmlUrl ? (
          <a className="ghopen" href={message.htmlUrl} target="_blank" rel="noreferrer noopener">
            Open on GitHub
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function GithubThreadView({
  thread,
  collapsed,
  onToggle,
}: {
  thread: GithubThread;
  collapsed: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const count = 1 + thread.replies.length;
  const author = thread.root.author ?? "GitHub";
  const label = collapsed ? `Expand comments from ${author}` : `Collapse comments from ${author}`;
  // Only current threads carry a toolbar target: an outdated line is not
  // in the diff, so Explain/Ask/Comment could never anchor there.
  const target =
    !thread.outdated && thread.fileKey !== undefined && thread.line !== undefined
      ? `${thread.fileKey}:${thread.line}`
      : null;
  return (
    <div
      className="ithread gh"
      id={`gh-thread-${thread.root.id}`}
      {...(target !== null ? { "data-gh-thread": target } : {})}
    >
      <div className="thd">
        <button className="ib" type="button" data-tip={label} aria-label={label} onClick={onToggle}>
          <Icon name={collapsed ? "right" : "down"} />
        </button>
        <span className="mq">
          {author} · {count} {count === 1 ? "comment" : "comments"}
        </span>
        <span className="hint">from GitHub</span>
      </div>
      {collapsed ? null : (
        <>
          <Message message={thread.root} />
          {thread.replies.map((r) => (
            <Message key={r.id} message={r} />
          ))}
        </>
      )}
    </div>
  );
}
