import { useCallback, useEffect, useState } from "react";
import type { ThreadContentPresentation } from "./threadContentPresentation";

const LANDING_FALLBACK_MS = 1_000;

/**
 * Keeps the loading handoff open until the incoming list has landed at the end: LegendList reports
 * ready while rows measured in its initial scroll can still leave it short. Messages the user just
 * wrote and empty conversations show at once.
 */
export function useThreadFeedLoading(input: {
  readonly listMountKey: string;
  readonly contentKind: ThreadContentPresentation["kind"];
  readonly hasContent: boolean;
  readonly hasLocalMessages: boolean;
}) {
  const [loadedListKey, setLoadedListKey] = useState<string | null>(null);
  const [landedListKey, setLandedListKey] = useState<string | null>(null);
  const [opening, setOpening] = useState(true);
  const fetchingMessages = input.contentKind === "loading" && !input.hasLocalMessages;
  if (fetchingMessages && !opening) {
    setOpening(true);
    setLoadedListKey(null);
    setLandedListKey(null);
  }
  const listLoaded = loadedListKey === input.listMountKey;
  const loading =
    fetchingMessages ||
    (opening &&
      input.contentKind === "ready" &&
      !input.hasLocalMessages &&
      input.hasContent &&
      landedListKey !== input.listMountKey);

  if (!loading && opening) setOpening(false);

  const onListLoaded = useCallback(() => {
    setLoadedListKey(input.listMountKey);
  }, [input.listMountKey]);
  const onListLanded = useCallback(() => {
    setLandedListKey(input.listMountKey);
  }, [input.listMountKey]);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- never leaves the feed hidden if end following stalls short of the end
  useEffect(() => {
    if (!loading || !listLoaded) return;
    const timer = setTimeout(onListLanded, LANDING_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [loading, listLoaded, onListLanded]);

  return { loading, listLoaded, onListLoaded, onListLanded };
}
