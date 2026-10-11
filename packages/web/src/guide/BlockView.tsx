/**
 * Block rendering (web-guide owner; PRD §4.4 display side + §4.5 + §4.9).
 *
 * Paragraph, list (per-item citations plus the block-level union the
 * parser emits), table, code, diagram (D2, service-rendered), aside
 * (Example / Diagram / Underlying principle), finding-link (orange
 * agent-finding card), follow-up chips, comment-link (suggested review
 * comment on a diff line).
 */
import type { Annotation, Block, DepthLevel, Page } from "@unvibe/shared";
import { Icon } from "../components/Icon.js";
import { revealSource } from "../source/reveal.js";
import { useReview } from "../state/store.js";
import { resolveBlockCitations, resolveCitation } from "./citations.js";
import { DiagramView } from "./DiagramView.js";
import { depthText, isPageRead } from "./guideUtils.js";
import { BlockMarkers } from "./Markers.js";
import { handleHtmlLinkClick, RichText } from "./RichText.js";

export interface BlockCallbacks {
  onOpenPage: (pageId: string) => void;
  onFollowUp: (blockId: string, index: number) => void;
}

interface Props extends BlockCallbacks {
  block: Block;
  level: DepthLevel;
  threads: Annotation[];
  lookupPage?: (pageId: string) => Page | undefined;
}

function Paragraph({
  id,
  html,
  citations,
  threads,
  blockId,
  onOpenPage,
}: {
  id: string;
  html: string;
  citations: ReturnType<typeof resolveBlockCitations>;
  threads: Annotation[];
  blockId: string;
  onOpenPage: (pageId: string) => void;
}) {
  return (
    <p className="prose sel" data-top={id}>
      <RichText html={html} className="rt" top={id} onOpenPage={onOpenPage} />
      <BlockMarkers citations={citations} threads={threads} blockId={blockId} />
    </p>
  );
}

function AsideInner({
  inner,
  top,
  reviewId,
  onOpenPage,
}: {
  inner: Block;
  top: string;
  reviewId: string;
  onOpenPage: (p: string) => void;
}) {
  switch (inner.type) {
    case "paragraph":
      return (
        <p className="prose sel" data-top={top}>
          <RichText html={inner.text.standard} className="rt" top={top} onOpenPage={onOpenPage} />
        </p>
      );
    case "code":
      return (
        <pre className="code sel" data-top={top}>
          {inner.code}
        </pre>
      );
    case "diagram":
      return <DiagramView reviewId={reviewId} block={inner} />;
    case "list":
      return (
        <ul className="lst">
          {inner.items.map((item, i) => (
            <li key={i}>
              <span className="sel" data-top={top} dangerouslySetInnerHTML={{ __html: item.html }} />
            </li>
          ))}
        </ul>
      );
    default:
      return null;
  }
}

/** Clicks on dotted links inside non-RichText HTML (list items, tables). */
function onHtmlClick(
  e: React.MouseEvent,
  pages: Page[] | undefined,
  onOpenPage: (pageId: string) => void,
): void {
  handleHtmlLinkClick(e, pages, onOpenPage);
}

export function BlockView({ block, level, threads, lookupPage, onOpenPage, onFollowUp }: Props) {
  const snapshot = useReview((s) => s.snapshot);
  const pages = snapshot?.pages;
  const citations =
    "citations" in block && Array.isArray(block.citations) ? block.citations : [];
  const resolved = snapshot ? resolveBlockCitations(snapshot, citations) : [];
  const id = `B-${block.id}`;
  const reviewId = snapshot?.review.id ?? "";

  switch (block.type) {
    case "paragraph": {
      const html = depthText(block.text, level);
      return (
        <div className="blk" id={id}>
          <Paragraph
            id={block.id}
            html={html}
            citations={resolved}
            threads={threads}
            blockId={block.id}
            onOpenPage={onOpenPage}
          />
        </div>
      );
    }
    case "list": {
      const items = block.items.map((item, i) => {
        const itemResolved = snapshot
          ? resolveBlockCitations(snapshot, item.citations)
          : [];
        return (
          <li key={i} id={`${id}-${i}`}>
            <span
              className="sel"
              data-top={block.id}
              dangerouslySetInnerHTML={{ __html: item.html }}
              onClick={(e) => onHtmlClick(e, pages, onOpenPage)}
            />
            <BlockMarkers citations={itemResolved} threads={i === 0 ? threads : []} blockId={block.id} />
          </li>
        );
      });
      const list = block.ordered ? <ol className="lst">{items}</ol> : <ul className="lst">{items}</ul>;
      return (
        <div className="blk" id={id}>
          {list}
          {(resolved.length > 0 || threads.length > 0) && (
            <div className="lo-row">
              <BlockMarkers citations={resolved} threads={[]} blockId={block.id} />
            </div>
          )}
        </div>
      );
    }
    case "table":
      return (
        <div className="blk" id={id}>
          <div
            className="md sel"
            data-top={block.id}
            dangerouslySetInnerHTML={{ __html: block.html }}
            onClick={(e) => onHtmlClick(e, pages, onOpenPage)}
          />
          {(resolved.length > 0 || threads.length > 0) && (
            <div className="lo-row">
              <BlockMarkers citations={resolved} threads={threads} blockId={block.id} />
            </div>
          )}
        </div>
      );
    case "code":
      return (
        <div className="blk" id={id}>
          <pre className="code sel" data-top={block.id}>
            {block.code}
          </pre>
          {(resolved.length > 0 || threads.length > 0) && (
            <div className="lo-row">
              <BlockMarkers citations={resolved} threads={threads} blockId={block.id} />
            </div>
          )}
        </div>
      );
    case "diagram":
      return (
        <div className="blk" id={id}>
          <DiagramView reviewId={reviewId} block={block} />
          {(resolved.length > 0 || threads.length > 0) && (
            <div className="lo-row">
              <BlockMarkers citations={resolved} threads={threads} blockId={block.id} />
            </div>
          )}
        </div>
      );
    case "aside":
      return (
        <div className="blk gen-aside fresh" id={id}>
          <div className="tag">{block.kind}</div>
          {block.inner.map((inner) => (
            <AsideInner key={inner.id} inner={inner} top={block.id} reviewId={reviewId} onOpenPage={onOpenPage} />
          ))}
          {threads.length > 0 && (
            <div className="lo-row">
              <BlockMarkers citations={[]} threads={threads} blockId={block.id} />
            </div>
          )}
        </div>
      );
    case "finding-link": {
      const page = lookupPage?.(block.pageId);
      const read = page ? isPageRead(page) : false;
      return (
        <div className="blk" id={id}>
          <button
            className={`findref${read ? " read" : ""}`}
            type="button"
            data-node={block.pageId}
            onClick={() => onOpenPage(block.pageId)}
          >
            <span className="ftag">Agent finding · {page?.confidence ?? ""} confidence</span>
            <span className="ft">{page?.title ?? block.pageId}</span>
            <span className="fs">{page?.summary ?? ""}</span>
            <span className="fo">Open →</span>
          </button>
        </div>
      );
    }
    case "comment-link": {
      const thread = snapshot?.annotations.find((a) => a.id === block.threadId);
      const label = snapshot
        ? resolveCitation(snapshot, { target: block.diffRef }).label
        : block.diffRef;
      return (
        <div className="blk" id={id}>
          <button
            className="clink"
            type="button"
            data-cjump={block.threadId}
            data-cprev={block.threadId}
            onClick={() => revealSource(block.diffRef)}
          >
            <Icon name="comment" />
            <span>
              Suggested review comment on <b>{label}</b>
            </span>
            <span className="sp" />
            {thread?.post ? <span className="prtag">For PR</span> : null}→
          </button>
        </div>
      );
    }
    case "follow-up": {
      if (!block.items.length) return null;
      return (
        <div className="follow">
          <span className="k">Follow up:</span>
          {block.items.map((item, i) => (
            <button key={i} type="button" data-follow={block.id} data-i={i} onClick={() => onFollowUp(block.id, i)}>
              {item.label}
            </button>
          ))}
        </div>
      );
    }
    default:
      return null;
  }
}

