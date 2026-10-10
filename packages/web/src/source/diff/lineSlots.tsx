/**
 * Line-slot registry: lets other features (threads and expansions in later
 * milestones) render rows under a diff line without owning the diff.
 *
 * Slots are keyed by `${fileKey}:${newSideLine}`. `DiffView` accepts them as
 * a prop and merges context-provided slots under the prop:
 *
 * ```tsx
 * <LineSlotProvider slots={{ "conn:82": <MyThread /> }}>
 *   <DiffView reviewId={id} />
 * </LineSlotProvider>
 * // or directly:
 * <DiffView reviewId={id} lineSlots={{ "conn:82": <MyThread /> }} />
 * ```
 *
 * A slot renders as a pinned full-width row right under its line (same
 * `.pin` treatment as hunk headers/cards, so it never scrolls out of view
 * sideways), and its line number shows the comment icon.
 */
import { createContext, useContext, type ReactNode } from "react";

export type LineSlots = Record<string, ReactNode>;

export const LineSlotsContext = createContext<LineSlots>({});

export function LineSlotProvider({ slots, children }: { slots: LineSlots; children: ReactNode }): ReactNode {
  return <LineSlotsContext.Provider value={slots}>{children}</LineSlotsContext.Provider>;
}

export function useLineSlots(): LineSlots {
  return useContext(LineSlotsContext);
}

/** Registry key for a new-side diff line. */
export function slotKey(fileKey: string, line: number): string {
  return `${fileKey}:${line}`;
}
