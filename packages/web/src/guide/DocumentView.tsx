/**
 * Document left pane (issue #222): the pasted Markdown rendered with its
 * paragraph block IDs (`p1`, `p2`, …), so the selection toolbar, Explain,
 * Ask and Comment work on it exactly as on a guide page — the document
 * is the card (`document#pN`) every anchor addresses. Comments are local
 * (the shared comment model; they appear in the comments menu / Outbox).
 * Nothing here generates content: the agent only answers on demand.
 */
import { Fragment } from "react";
import type { DocumentBlock } from "@unvibe/shared";
import { DOCUMENT_CARD_ID } from "@unvibe/shared";
import { GuideBlockThreads } from "../comments/GuideThreads.js";
import { useReview } from "../state/store.js";
import { blockThreads } from "./annotations.js";
import { BlockView } from "./BlockView.js";
import { expansionsForBlock } from "./expansions/ExpansionHighlights.js";
import { isClosedExpansion } from "./expansions/expansionUtils.js";
import { RichText } from "./RichText.js";
import { Card as UiCard } from "../ui/index.js";

interface Props {
  reviewId: string;
  onOpenPage: (pageId: string) => void;
}

function HeadingBlock({ block }: { block: DocumentBlock }) {
  const level = Math.min(6, (block.level ?? 2) + 1);
  const html = block.block.type === "paragraph" ? block.block.text.standard : "";
  const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <div className="blk" id={`B-${block.id}`}>
      <Tag className="sel" data-top={block.id}>
        <RichText html={html} className="rt" top={block.id} onOpenPage={() => {}} />
      </Tag>
    </div>
  );
}

export function DocumentView({ reviewId, onOpenPage }: Props) {
  const snapshot = useReview((s) => s.snapshot);
  const doc = snapshot?.document;
  const annotations = snapshot?.annotations ?? [];
  const contextRepos = snapshot?.contextRepos ?? [];
  if (!doc) {
    return (
      <div className="doc">
        <p className="hint">Loading the document…</p>
      </div>
    );
  }
  const lookupPage = (id: string) => snapshot?.pages.find((p) => p.id === id);
  // The title shows once: when the document opens with an H1, that block
  // IS the page title (rendered here, with its block anchor, and skipped
  // in the card below).
  const titleBlock =
    doc.blocks[0]?.kind === "heading" && doc.blocks[0].level === 1 ? doc.blocks[0] : undefined;
  const titleHtml = titleBlock?.block.type === "paragraph" ? titleBlock.block.text.standard : "";
  return (
    <div className="doc" data-testid="document-view">
      {titleBlock ? (
        <h1 className="title sel" id={`B-${titleBlock.id}`} data-top={titleBlock.id}>
          <RichText html={titleHtml} className="rt" top={titleBlock.id} onOpenPage={onOpenPage} />
        </h1>
      ) : (
        <h1 className="title">{doc.title}</h1>
      )}
      {contextRepos.length > 0 ? (
        <p className="hint" data-testid="document-context">
          Context: {contextRepos.map((c) => c.label).join(" · ")}
        </p>
      ) : null}
      {titleBlock ? (
        <GuideBlockThreads reviewId={reviewId} cardId={DOCUMENT_CARD_ID} blockId={titleBlock.id} />
      ) : null}
      <UiCard as="section" variant="raised" id={`C-${DOCUMENT_CARD_ID}`}>
        {doc.blocks.filter((db) => db.id !== titleBlock?.id).map((db) => {
          const exps = expansionsForBlock(annotations, DOCUMENT_CARD_ID, db.id);
          const footnotes = exps.filter(isClosedExpansion);
          return (
            <Fragment key={db.id}>
              {db.kind === "heading" ? (
                <HeadingBlock block={db} />
              ) : (
                <BlockView
                  block={db.block}
                  level="standard"
                  threads={blockThreads(annotations, DOCUMENT_CARD_ID, db.id)}
                  footnotes={footnotes}
                  lookupPage={lookupPage}
                  cardId={DOCUMENT_CARD_ID}
                  onOpenPage={onOpenPage}
                  onFollowUp={() => {}}
                />
              )}
              <GuideBlockThreads reviewId={reviewId} cardId={DOCUMENT_CARD_ID} blockId={db.id} />
            </Fragment>
          );
        })}
      </UiCard>
      <p className="hint">Select any text for Explain, Ask or Comment. Comments stay on this machine.</p>
    </div>
  );
}
