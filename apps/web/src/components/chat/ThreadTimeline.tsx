import type { ScopedThreadRef } from "@supaterm/contracts";
import { type ComponentProps, useLayoutEffect, useState } from "react";
import {
  createTimelineEntriesProjector,
  type TimelineEntriesInput,
  type TimelineEntry,
} from "../../session-logic";
import { useThreadVisibleTurnItems } from "../../state/entities";
import {
  peekRememberedThreadTimeline,
  rememberReadyThreadTimeline,
  resolveThreadSwitchTimeline,
  timelineHasEphemeralPreviewUrls,
} from "../ChatView.logic";
import { MessagesTimeline } from "./MessagesTimeline";

/**
 * The timeline with the streamed text. ChatView reads the thread through its quiet
 * atoms, which hold through text deltas; this reads the live turn items, so a
 * delta re-renders the timeline without re-rendering ChatView.
 */
export function ThreadTimeline({
  threadDetailRef,
  entriesInput,
  draftEntries,
  activeThreadKey,
  syncing,
  detailLoading,
  readyMarkdownCwd,
  readyWorkspaceRoot,
  timelineScope,
  ...timelineProps
}: Omit<ComponentProps<typeof MessagesTimeline>, "timelineEntries"> & {
  /** Null until the thread's detail may load; see resolveThreadDetailRef. */
  threadDetailRef: ScopedThreadRef | null;
  entriesInput: Omit<TimelineEntriesInput, "visibleTurnItems">;
  /** A local draft's optimistic rows; null for a server thread. */
  draftEntries: ReadonlyArray<TimelineEntry> | null;
  activeThreadKey: string | null;
  syncing: boolean;
  detailLoading: boolean;
  readyMarkdownCwd: string | null;
  readyWorkspaceRoot: string | null;
  /** The chat pane whose last ready timeline this one becomes. */
  timelineScope: string | undefined;
}) {
  const visibleTurnItems = useThreadVisibleTurnItems(threadDetailRef);
  const [projectTimelineEntries] = useState(createTimelineEntriesProjector);
  const serverEntries = projectTimelineEntries(
    { ...entriesInput, visibleTurnItems },
    activeThreadKey,
  );
  const entries = draftEntries ?? serverEntries;
  const displayed = resolveThreadSwitchTimeline({
    loading: entries.length === 0 && syncing,
    activeThreadKey,
    nextEntries: entries,
    rememberedForActive: peekRememberedThreadTimeline<typeof entries>(activeThreadKey),
    scope: timelineScope,
  });
  useLayoutEffect(() => {
    if (detailLoading || entries.length === 0 || timelineHasEphemeralPreviewUrls(entries)) {
      return;
    }
    rememberReadyThreadTimeline(
      {
        threadKey: activeThreadKey,
        entries,
        markdownCwd: readyMarkdownCwd,
        workspaceRoot: readyWorkspaceRoot,
      },
      timelineScope,
    );
  }, [
    activeThreadKey,
    detailLoading,
    entries,
    readyMarkdownCwd,
    readyWorkspaceRoot,
    timelineScope,
  ]);
  return <MessagesTimeline {...timelineProps} timelineEntries={displayed.entries} />;
}
