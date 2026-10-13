/**
 * Per-review debug page (`/review/:id/debug`, issue #32): Jobs, Prompts
 * and Shared context tabs (issue #60), one panel visible at a time. The
 * selected tab lives in the `?tab=` query parameter so a reload or a
 * pasted link lands on the same tab; every panel stays mounted behind
 * `hidden` so the jobs live subscription and each block's open state
 * survive a tab switch.
 *
 * Served by `GET /api/reviews/:id/shared-context` (three Markdown strings
 * rendered as-is through `MarkdownView`). Delete keeps working through the
 * existing `DELETE /api/reviews/:id/contributions/:id` endpoint, with one
 * plain text button per contribution (existing `x`-style class, no new
 * CSS); the buttons read their ids from the structured contributions fetch
 * so the document itself stays pure Markdown.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { Contribution, SharedContextResponse } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { ScreenTopBar } from "../shell/ScreenTopBar.js";
import { useReviewIdentity } from "../shell/reviewIdentity.js";
import { TabPanel, Tabs, useQueryTab } from "../tabs/Tabs.js";
import { ExpandedPrompts } from "./ExpandedPrompts.js";
import { JobsSection } from "./JobsSection.js";
import { RedoGuideSection } from "./RedoGuideSection.js";
import { SharedContext } from "./SharedContext.js";

const DEBUG_TABS = [
  { id: "jobs", label: "Jobs" },
  { id: "prompts", label: "Prompts" },
  { id: "context", label: "Shared context" },
] as const;

const DEBUG_TAB_IDS: readonly string[] = DEBUG_TABS.map((t) => t.id);

export function DebugPageRoute(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  return <DebugPage reviewId={id ?? "demo"} />;
}

export function DebugPage({ reviewId }: { reviewId: string }): React.JSX.Element {
  const [doc, setDoc] = useState<SharedContextResponse | null>(null);
  const [items, setItems] = useState<Contribution[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useQueryTab(DEBUG_TAB_IDS, "jobs");
  const { short } = useReviewIdentity(reviewId);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [shared, contribs] = await Promise.all([
        api.sharedContext(reviewId),
        api.contributions(reviewId),
      ]);
      setDoc(shared);
      setItems(contribs.contributions);
    } catch (err) {
      setError(friendlyError(err));
    }
  }, [reviewId]);

  useEffect(() => {
    setDoc(null);
    setItems(null);
    void load();
  }, [load]);

  const remove = async (id: string): Promise<void> => {
    try {
      await api.deleteContribution(reviewId, id);
      setItems((prev) => (prev === null ? prev : prev.filter((c) => c.id !== id)));
      // Re-render the document so the deleted contribution leaves it too.
      setDoc(await api.sharedContext(reviewId));
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  return (
    <div className="app">
      <ScreenTopBar
        crumbs={[{ label: short, to: `/review/${encodeURIComponent(reviewId)}` }, { label: "Debug" }]}
      />
      <main className="col" style={{ padding: 24 }}>
        <div className="doc">
          {error ? (
            <p className="err" role="alert">
              Couldn&apos;t load shared context: {error}
            </p>
          ) : null}
          <Tabs label="Debug sections" tabs={DEBUG_TABS} active={tab} onSelect={setTab} idPrefix="debug" />
          <TabPanel idPrefix="debug" id="jobs" active={tab === "jobs"}>
            <JobsSection reviewId={reviewId} />
          </TabPanel>
          <TabPanel idPrefix="debug" id="prompts" active={tab === "prompts"}>
            <ExpandedPrompts reviewId={reviewId} />
          </TabPanel>
          <TabPanel idPrefix="debug" id="context" active={tab === "context"}>
            {!doc && !error ? <p className="hint">Loading shared context…</p> : null}
            {doc ? <SharedContext doc={doc} items={items} onDelete={(id) => void remove(id)} /> : null}
          </TabPanel>
          <RedoGuideSection reviewId={reviewId} />
        </div>
      </main>
    </div>
  );
}
