/**
 * Shared reply box (issue #136): the composer at the bottom of a comment
 * thread and of a conversation card.
 *
 * - Typed text survives any re-render elsewhere (local state keyed by
 *   annotation id, debounced through `PATCH …/comments/:id` `reply`);
 *   unsent text flushes on unmount so it is never lost.
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

  // Flush an unsent draft on unmount so debounced text is never lost.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const serverReplyRef = useRef(serverReply);
  serverReplyRef.current = serverReply;
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      const current = draftRef.current;
      if (current !== (serverReplyRef.current ?? "") && current.trim() !== "") {
        api.updateComment(reviewId, annotationId, { reply: current }).catch(() => {});
      }
    },
    [reviewId, annotationId],
  );

  const setSendingBoth = (b: boolean): void => {
    setSending(b);
    onSendingChange?.(b);
  };

  const persistReply = (value: string): void => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.updateComment(reviewId, annotationId, { reply: value }).catch(() => {
        // Local draft stays; a toast on every keystroke would be noise.
      });
    }, 400);
  };

  const handleDiscard = (): void => {
    if (sending) return;
    window.clearTimeout(saveTimer.current);
    setSendingBoth(true);
    onDiscard()
      .then(() => {
        setDraft("");
      })
      .catch((err: unknown) => {
        toast(`Couldn't clear the reply: ${friendlyError(err)}`);
      })
      .finally(() => setSendingBoth(false));
  };

  const handleSend = (): void => {
    const text = draft.trim();
    if (!text || sending) return;
    setSendingBoth(true);
    onSend(text)
      .then(() => {
        setDraft("");
      })
      .catch((err: unknown) => {
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
          setDraft(e.target.value);
          persistReply(e.target.value);
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
