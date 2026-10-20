/**
 * Shared reply box (issue #136): the composer at the bottom of a comment
 * thread and of a conversation card.
 *
 * - Typed text survives any re-render elsewhere (local state keyed by
 *   annotation id, debounced through `PATCH …/comments/:id` `reply`);
 *   unsent text flushes on unmount so it is never lost.
 * - A successful send or discard empties the box and clears the stored
 *   draft, and a debounce tick scheduled before it can never write the
 *   sent text back (keystroke generations: a tick is stale once a newer
 *   send/discard settled). A failed send keeps the text.
 * - Discard clears the box (the caller decides what else that means);
 *   Cmd/Ctrl+Enter sends.
 * - What Send does is the caller's `onSend` (agent `reply` action on Ask
 *   threads and conversation cards, plain comment reply on notes).
 */
import { useEffect, useRef, useState } from "react";
import { api, friendlyError } from "../api/client.js";
import { toast } from "../floating/Toast.js";

interface Props {
  reviewId: string;
  annotationId: string;
  /** Server draft (`Annotation.reply`); external edits flow back in. */
  serverReply: string | undefined;
  placeholder: string;
  /** Accessible name for the textarea. */
  ariaLabel: string;
  sendLabel: string;
  discardLabel: string;
  rows?: number;
  readOnly?: boolean;
  /** Send the text; the box clears on success. */
  onSend: (text: string) => Promise<unknown>;
  /** Discard action (clear the draft, or delete a new thread); the box clears on success. */
  onDiscard: () => Promise<unknown>;
  /** Follows the sending state (callers disable sibling controls with it). */
  onSendingChange?: (sending: boolean) => void;
  /**
   * Keep Discard enabled with an empty box (a new thread's Discard
   * deletes the thread itself, so it must work before anything is typed).
   */
  allowEmptyDiscard?: boolean;
}

export function ReplyBox({
  reviewId,
  annotationId,
  serverReply,
  placeholder,
  ariaLabel,
  sendLabel,
  discardLabel,
  rows,
  readOnly,
  onSend,
  onDiscard,
  onSendingChange,
  allowEmptyDiscard,
}: Props) {
  const [draft, setDraft] = useState(serverReply ?? "");
  const [sending, setSending] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  // A persist whose debounce already fired and whose PATCH is on the
  // wire: a send/discard must wait it out (see `consumeDraft`).
  const persistPromiseRef = useRef<Promise<unknown> | undefined>(undefined);
  // Keystroke generation: bumped on every change; a successful send or
  // discard records the generation it settled, and a debounce tick from
  // an earlier generation is stale and must not persist (it would write
  // the just-sent text back over the cleared box and stored draft).
  const seqRef = useRef(0);
  const clearedSeqRef = useRef(-1);
  const mountedId = useRef(annotationId);
  if (mountedId.current !== annotationId) {
    mountedId.current = annotationId;
    setDraft(serverReply ?? "");
  }

  // Server-cleared boxes (after Send) and external edits flow back in;
  // unrelated WS patches carry the same value and leave typing alone.
  // (Intentionally dep-only on the server value: `draft` is local state.)
  useEffect(() => {
    if (serverReply !== undefined && serverReply !== draft) {
      setDraft(serverReply);
    }
  }, [serverReply]);

  // Flush an unsent draft on unmount so debounced text is never lost —
  // but never a consumed one: since #203 the box unmounts while a sent
  // turn is being written, often before the send settles, and flushing
  // the sent text would write it back over the server-side clear, so
  // the remounted box (answer arrived) would hold the sent text again.
  // The check is the #195 generation rule: the current keystroke
  // generation has been consumed by a send/discard that has not since
  // failed (a failure re-arms the persist, lowering clearedSeq).
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const serverReplyRef = useRef(serverReply);
  serverReplyRef.current = serverReply;
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      const current = draftRef.current;
      const consumed = clearedSeqRef.current >= seqRef.current && seqRef.current > 0;
      if (!consumed && current !== (serverReplyRef.current ?? "") && current.trim() !== "") {
        api.updateComment(reviewId, annotationId, { reply: current }).catch(() => {});
      }
    },
    [reviewId, annotationId],
  );

  const setSendingBoth = (b: boolean): void => {
    setSending(b);
    onSendingChange?.(b);
  };

  const persistReply = (value: string, seq: number): void => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      // A send or discard consumed this keystroke: the text is
      // consumed, never persist it back.
      if (seq <= clearedSeqRef.current) return;
      const sent = api.updateComment(reviewId, annotationId, { reply: value }).catch(() => {
        // Local draft stays; a toast on every keystroke would be noise.
      });
      persistPromiseRef.current = sent;
      void sent.then(() => {
        if (persistPromiseRef.current === sent) persistPromiseRef.current = undefined;
      });
    }, 400);
  };

  // Consume the current text for a send or discard. The generation is
  // marked consumed *now*, not when the send settles: a slow send
  // otherwise leaves a window where the 400ms tick fires mid-flight
  // and its PATCH (or one already on the wire) lands after the
  // server-side clear, resurrecting the sent text as a draft (#195).
  // Waiting out an in-flight persist makes the caller's action —
  // whose server side clears the draft — the last write.
  const consumeDraft = (): Promise<void> | null => {
    window.clearTimeout(saveTimer.current);
    clearedSeqRef.current = seqRef.current;
    const inFlight = persistPromiseRef.current;
    return inFlight ? inFlight.then(() => undefined) : null;
  };

  // A failed send/discard keeps the text: re-arm its persist.
  const restoreDraftPersist = (): void => {
    clearedSeqRef.current = seqRef.current - 1;
    persistReply(draftRef.current, seqRef.current);
  };

  const handleDiscard = (): void => {
    if (sending) return;
    setSendingBoth(true);
    const wait = consumeDraft();
    const attempt = wait ? wait.then(() => onDiscard()) : onDiscard();
    attempt
      .then(() => {
        clearedSeqRef.current = seqRef.current;
        setDraft("");
      })
      .catch((err: unknown) => {
        restoreDraftPersist();
        toast(`Couldn't clear the reply: ${friendlyError(err)}`);
      })
      .finally(() => setSendingBoth(false));
  };

  const handleSend = (): void => {
    const text = draft.trim();
    if (!text || sending) return;
    setSendingBoth(true);
    const wait = consumeDraft();
    const attempt = wait ? wait.then(() => onSend(text)) : onSend(text);
    attempt
      .then(() => {
        clearedSeqRef.current = seqRef.current;
        setDraft("");
      })
      .catch((err: unknown) => {
        restoreDraftPersist();
        toast(`Couldn't send the reply: ${friendlyError(err)}`);
      })
      .finally(() => setSendingBoth(false));
  };

  if (readOnly) {
    return <div className="hint">Viewing an older version · read-only</div>;
  }
  return (
    <div className="composer">
      <textarea
        id={`ta-${annotationId}`}
        rows={rows ?? 1}
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={draft}
        onChange={(e) => {
          seqRef.current += 1;
          setDraft(e.target.value);
          persistReply(e.target.value, seqRef.current);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSend();
          }
        }}
      />
      <div className="row">
        <button
          className="btn ghost"
          type="button"
          data-discard={annotationId}
          data-tip={discardLabel}
          disabled={sending || (!allowEmptyDiscard && draft.trim() === "")}
          onClick={handleDiscard}
        >
          {discardLabel}
        </button>
        <button
          className="btn"
          type="button"
          data-send={annotationId}
          disabled={sending || draft.trim() === ""}
          onClick={handleSend}
        >
          {sendLabel}
        </button>
      </div>
    </div>
  );
}
