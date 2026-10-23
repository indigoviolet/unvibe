/**
 * Documents screen (`/documents`, issue #222): the pasted-Markdown
 * document form (any number of context repos) plus the list of existing
 * document reviews. Document reviews live here, never on the PR start
 * page; the top bar's home link returns there.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { Repo, ReviewSummary } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { Button } from "../ui/index.js";
import { Toast, toast } from "../floating/Toast.js";
import { ScreenTopBar } from "../shell/ScreenTopBar.js";
import { DocumentForm, SessionRow } from "./StartPage.js";

export function DocumentsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [sessions, setSessions] = useState<ReviewSummary[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [docOpen, setDocOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .repos()
      .then((r) => {
        if (!cancelled) setRepos(r.repos);
      })
      .catch(() => {
        // Repos stay empty; the form surfaces the failure on create.
      });
    api
      .reviews()
      .then((r) => {
        if (cancelled) return;
        setSessions(r.reviews);
        setSessionsError(null);
      })
      .catch(() => {
        if (!cancelled) setSessionsError("Couldn't load your documents.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const removeSession = useCallback(async (id: string) => {
    setDeleting(id);
    try {
      await api.deleteReview(id);
      setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
      setConfirmDelete(null);
    } catch (err) {
      toast(`Couldn't remove the review: ${friendlyError(err)}`);
    } finally {
      setDeleting(null);
    }
  }, []);

  const docs = (sessions ?? []).filter((s) => s.kind === "document");

  return (
    <div className="app">
      <Toast />
      <ScreenTopBar crumbs={[{ label: "Documents" }]} showBadge />
      <main className="col" style={{ padding: 24 }}>
        <div className="doc" style={{ maxWidth: 760 }}>
          <h1 className="divider">Document</h1>
          {docOpen ? (
            <DocumentForm repos={repos} onCreated={(id) => navigate(`/review/${id}`)} />
          ) : (
            <p className="hint">
              Review a pasted Markdown document with repos as context.{" "}
              <Button variant="quiet" size="sm" type="button" onClick={() => setDocOpen(true)}>
                New document review
              </Button>
            </p>
          )}

          <h1 className="divider">Documents</h1>
          {sessions === null && !sessionsError ? (
            <p className="hint">Loading documents…</p>
          ) : sessionsError ? (
            <p className="hint" role="alert">
              {sessionsError}
            </p>
          ) : (
            <div aria-label="Documents" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {docs.map((s) => (
                <SessionRow
                  key={s.id}
                  s={s}
                  opening={null}
                  deleting={deleting}
                  confirmDelete={confirmDelete}
                  setConfirmDelete={setConfirmDelete}
                  removeSession={removeSession}
                  onOpen={() => navigate(`/review/${s.id}`)}
                />
              ))}
              {docs.length === 0 ? (
                <p className="hint" data-testid="documents-empty">
                  No documents yet. Paste one above to start a review.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
