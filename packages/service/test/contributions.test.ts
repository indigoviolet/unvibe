/**
 * Shared-context contributions route (PRD §4.14, §9.5; M8 settings):
 * GET lists `snapshot.contributions`, DELETE removes one item through
 * `ReviewStore.mutate`. Plus the models 404 for unknown providers.
 */
import { describe, expect, it } from "vitest";
import type { Contribution } from "@unvibe/shared";
import { FakeCommandRunner } from "../src/exec/index.js";
import { StaticModelCatalog } from "../src/settings/index.js";
import { SettingsStore } from "../src/settings/index.js";
import { setupReview } from "./m6-helpers.js";

const CONTRIBUTIONS: Contribution[] = [
  {
    id: "ct_fact1",
    sourceSession: "sess-reader",
    items: [
      {
        kind: "fact",
        text: "Retry uses exponential backoff.",
        citations: [{ target: "diff:a-py:2" }],
      },
    ],
    status: "pending",
  },
  {
    id: "ct_corr1",
    sourceSession: "sess-critic",
    items: [
      {
        kind: "correction",
        text: "The central card overstates the scope.",
        target: "card:c-central#b-rule",
        citations: [],
      },
      { kind: "open_question", text: "Is the helper covered by tests?", citations: [] },
    ],
    status: "pending",
  },
];

describe("contributions routes", () => {
  it("GET lists contributions; DELETE removes one and publishes a patch", async () => {
    const setup = await setupReview(new FakeCommandRunner());
    const { app, ctx, reviewId } = setup;
    const auth = { authorization: "Bearer tok" };
    try {
      await ctx.reviews.mutate(reviewId, (draft) => {
        draft.contributions = [...CONTRIBUTIONS];
      });

      const list = await app.inject({
        method: "GET",
        url: `/api/reviews/${reviewId}/contributions`,
        headers: auth,
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().contributions.map((c: Contribution) => c.id)).toEqual([
        "ct_fact1",
        "ct_corr1",
      ]);

      const del = await app.inject({
        method: "DELETE",
        url: `/api/reviews/${reviewId}/contributions/ct_fact1`,
        headers: auth,
      });
      expect(del.statusCode).toBe(200);
      expect(del.json()).toEqual({ ok: true, deletedId: "ct_fact1" });

      const after = await app.inject({
        method: "GET",
        url: `/api/reviews/${reviewId}/contributions`,
        headers: auth,
      });
      expect(after.json().contributions.map((c: Contribution) => c.id)).toEqual(["ct_corr1"]);

      const unknownItem = await app.inject({
        method: "DELETE",
        url: `/api/reviews/${reviewId}/contributions/nope`,
        headers: auth,
      });
      expect(unknownItem.statusCode).toBe(404);

      const unknownReview = await app.inject({
        method: "GET",
        url: "/api/reviews/nope/contributions",
        headers: auth,
      });
      expect(unknownReview.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("GET /api/models names the problem for unknown providers", async () => {
    const { openDatabase } = await import("../src/store/db.js");
    const { migrate } = await import("../src/store/migrate.js");
    const { createApp } = await import("../src/server.js");
    const db = openDatabase(":memory:");
    migrate(db);
    const { app } = await createApp("tok", {
      settings: new SettingsStore(db),
      models: new StaticModelCatalog(),
    });
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/models?provider=bogus",
        headers: { authorization: "Bearer tok" },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain("couldn't list bogus models");
      expect(res.json().models).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
