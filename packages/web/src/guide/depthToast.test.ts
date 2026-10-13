/**
 * Depth reuse toasts (issue #65): the toast shows only when the level did
 * not change and nothing was added — for Deeper and Simpler, on cards and
 * on expansions. A stored-level switch (reused with a new level) and an
 * agent-generated change stay silent.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { DepthLevel } from "@unvibe/shared";
import { api } from "../api/client.js";
import * as ToastModule from "../floating/Toast.js";
import { resetMockState } from "../mock/index.js";
import { useReview } from "../state/store.js";
import { performAction } from "./actions.js";

const REVIEW_ID = "demo";

function setCardLevel(cardId: string, level: DepthLevel): void {
  const snap = useReview.getState().snapshot!;
  useReview.getState().setSnapshot({
    ...snap,
    pages: snap.pages.map((p) => ({
      ...p,
      cards: p.cards.map((c) => (c.id === cardId ? { ...c, level } : c)),
    })),
  });
}

function setExpansionLevel(annotationId: string, level: DepthLevel): void {
  const snap = useReview.getState().snapshot!;
  useReview.getState().setSnapshot({
    ...snap,
    annotations: snap.annotations.map((a) =>
      a.id === annotationId && a.type === "expansion" && a.expansion
        ? { ...a, expansion: { ...a.expansion, level } }
        : a,
    ),
  });
}

beforeEach(async () => {
  vi.useRealTimers();
  resetMockState();
  useReview.getState().clear();
  useReview.getState().setSnapshot(await api.review(REVIEW_ID));
});

describe("depth reuse toasts", () => {
  test("card Deeper served from stored text shows no toast", async () => {
    const actionSpy = vi
      .spyOn(api, "action")
      .mockResolvedValue({ accepted: true, cardId: "central", reused: true, level: "deep" });
    const toastSpy = vi.spyOn(ToastModule, "toast").mockImplementation(() => {});
    try {
      // central is standard in the seed; the service switched it to deep.
      await performAction(REVIEW_ID, { kind: "depth", cardId: "central", direction: "deeper" });
      expect(toastSpy).not.toHaveBeenCalled();
    } finally {
      actionSpy.mockRestore();
      toastSpy.mockRestore();
    }
  });

  test("card Deeper at the deepest level toasts", async () => {
    setCardLevel("central", "deep");
    const actionSpy = vi
      .spyOn(api, "action")
      .mockResolvedValue({ accepted: true, cardId: "central", reused: true, level: "deep" });
    const toastSpy = vi.spyOn(ToastModule, "toast").mockImplementation(() => {});
    try {
      await performAction(REVIEW_ID, { kind: "depth", cardId: "central", direction: "deeper" });
      expect(toastSpy).toHaveBeenCalledWith("Already at the deepest level");
    } finally {
      actionSpy.mockRestore();
      toastSpy.mockRestore();
    }
  });

  test("card Simpler served from stored text shows no toast", async () => {
    setCardLevel("central", "deep");
    const actionSpy = vi
      .spyOn(api, "action")
      .mockResolvedValue({ accepted: true, cardId: "central", reused: true, level: "standard" });
    const toastSpy = vi.spyOn(ToastModule, "toast").mockImplementation(() => {});
    try {
      await performAction(REVIEW_ID, { kind: "depth", cardId: "central", direction: "simpler" });
      expect(toastSpy).not.toHaveBeenCalled();
    } finally {
      actionSpy.mockRestore();
      toastSpy.mockRestore();
    }
  });

  test("card Simpler at the simplest level toasts", async () => {
    setCardLevel("central", "simple");
    const actionSpy = vi
      .spyOn(api, "action")
      .mockResolvedValue({ accepted: true, cardId: "central", reused: true, level: "simple" });
    const toastSpy = vi.spyOn(ToastModule, "toast").mockImplementation(() => {});
    try {
      await performAction(REVIEW_ID, { kind: "depth", cardId: "central", direction: "simpler" });
      expect(toastSpy).toHaveBeenCalledWith("Already at the simplest level");
    } finally {
      actionSpy.mockRestore();
      toastSpy.mockRestore();
    }
  });

  test("expansion Deeper served from stored text shows no toast", async () => {
    const actionSpy = vi
      .spyOn(api, "action")
      .mockResolvedValue({ accepted: true, cardId: "x-seed", reused: true, level: "deep" });
    const toastSpy = vi.spyOn(ToastModule, "toast").mockImplementation(() => {});
    try {
      // x-seed is standard in the seed; the service switched it to deep.
      await performAction(REVIEW_ID, { kind: "depth", cardId: "x-seed", direction: "deeper" });
      expect(toastSpy).not.toHaveBeenCalled();
    } finally {
      actionSpy.mockRestore();
      toastSpy.mockRestore();
    }
  });

  test("expansion Deeper at the deepest level toasts", async () => {
    setExpansionLevel("x-seed", "deep");
    const actionSpy = vi
      .spyOn(api, "action")
      .mockResolvedValue({ accepted: true, cardId: "x-seed", reused: true, level: "deep" });
    const toastSpy = vi.spyOn(ToastModule, "toast").mockImplementation(() => {});
    try {
      await performAction(REVIEW_ID, { kind: "depth", cardId: "x-seed", direction: "deeper" });
      expect(toastSpy).toHaveBeenCalledWith("Already at the deepest level");
    } finally {
      actionSpy.mockRestore();
      toastSpy.mockRestore();
    }
  });

  test("agent-generated depth change shows no toast", async () => {
    const actionSpy = vi
      .spyOn(api, "action")
      .mockResolvedValue({ accepted: true, cardId: "central", jobId: "job-9", level: "deep" });
    const toastSpy = vi.spyOn(ToastModule, "toast").mockImplementation(() => {});
    try {
      await performAction(REVIEW_ID, { kind: "depth", cardId: "central", direction: "deeper" });
      expect(toastSpy).not.toHaveBeenCalled();
    } finally {
      useReview.getState().clearInflight("central");
      actionSpy.mockRestore();
      toastSpy.mockRestore();
    }
  });
});
