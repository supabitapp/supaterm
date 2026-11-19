import type { ScreenReaderAnnouncements } from "@supaterm/contracts";
import { memo, useEffect, useRef } from "react";

import { useLiveRegion } from "../../hooks/useLiveRegion";
import type { TimelineEntry } from "../../session-logic";

import {
  nextThreadAnnouncement,
  type ThreadActivitySnapshot,
  type ThreadAnnouncementMemory,
} from "@supaterm/client-runtime/state/thread-activity-announcement";
import {
  nextTurnDetailAnnouncement,
  NO_TURN_DETAIL,
  turnDetail,
  type TurnDetailMemory,
} from "./turnDetailAnnouncement";

const ACTIVITY_GAP_MS = 2_000;
const MESSAGE_HOLD_MS_PER_CHARACTER = 50;
const MESSAGE_HOLD_MAX_MS = 15_000;

function holdAfter(text: string) {
  return Math.min(
    MESSAGE_HOLD_MAX_MS,
    Math.max(ACTIVITY_GAP_MS, text.length * MESSAGE_HOLD_MS_PER_CHARACTER),
  );
}

function asOneAnnouncement(texts: ReadonlyArray<string>) {
  return texts
    .map((text, index) => (index === texts.length - 1 || /[.!?:…]$/.test(text) ? text : `${text}.`))
    .join(" ");
}

/**
 * The open thread's polite live regions. Status has its own, so "Needs
 * approval" landing a moment after a message doesn't replace it unheard.
 */
export const ThreadActivityAnnouncer = memo(function ThreadActivityAnnouncer({
  threadKey,
  status,
  requestId,
  runId,
  runStatus,
  detailBehind,
  level,
  entries,
  workspaceRoot,
}: ThreadActivitySnapshot & {
  /** Null while the timeline shows another thread during a switch. */
  readonly threadKey: string | null;
  /** See isDetailBehindShell. */
  readonly detailBehind: boolean;
  readonly level: ScreenReaderAnnouncements;
  /** The thread's entries before any are hidden; unread at the "status" level. */
  readonly entries: ReadonlyArray<TimelineEntry>;
  readonly workspaceRoot: string | undefined;
}) {
  const { regionRef, announce, clear } = useLiveRegion();
  const {
    regionRef: detailRegionRef,
    announce: announceDetail,
    clear: clearDetail,
  } = useLiveRegion();
  const memoryRef = useRef<{
    threadKey: string;
    level: ScreenReaderAnnouncements;
    memory: ThreadAnnouncementMemory;
    detail: TurnDetailMemory;
  } | null>(null);
  const stepRef = useRef<{
    quietUntil: number;
    waiting: { label: string; timer: ReturnType<typeof setTimeout> } | null;
  }>({ quietUntil: 0, waiting: null });

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- writes the turn's status, messages and steps to the aria-live region after commit
  useEffect(() => {
    const step = stepRef.current;
    const write = (text: string, quietMs: number) => {
      announceDetail(text);
      step.quietUntil = Date.now() + quietMs;
    };
    const takeWaiting = () => {
      const label = step.waiting?.label ?? null;
      if (step.waiting !== null) clearTimeout(step.waiting.timer);
      step.waiting = null;
      return label;
    };

    if (threadKey === null) {
      takeWaiting();
      memoryRef.current = null;
      clear();
      clearDetail();
      return;
    }
    const waitingLabel = takeWaiting();
    if (detailBehind) {
      if (waitingLabel !== null && memoryRef.current !== null) {
        const { detail } = memoryRef.current;
        memoryRef.current = { ...memoryRef.current, detail: { ...detail, activity: null } };
      }
      return;
    }
    const previous = memoryRef.current?.threadKey === threadKey ? memoryRef.current : null;
    const turn = nextThreadAnnouncement(previous?.memory ?? null, {
      status,
      requestId,
      runId,
      runStatus,
    });
    const previousDetail = previous?.level === level ? previous.detail : null;
    const detail = nextTurnDetailAnnouncement(previousDetail, {
      ...(level === "status"
        ? NO_TURN_DETAIL
        : turnDetail(entries, workspaceRoot, previousDetail?.tailId ?? null)),
      level,
      status,
    });
    memoryRef.current = { threadKey, level, memory: turn.memory, detail: detail.memory };
    if (previous === null) {
      step.quietUntil = 0;
      clear();
      clearDetail();
      return;
    }
    if (detail.messages.length > 0) {
      const text = asOneAnnouncement(
        turn.announcement === null ? detail.messages : [...detail.messages, turn.announcement],
      );
      write(text, holdAfter(text));
    } else if (turn.announcement !== null) {
      announce(turn.announcement);
      step.quietUntil = Math.max(step.quietUntil, Date.now() + ACTIVITY_GAP_MS);
    }
    const label =
      level !== "everything" || detail.memory.activity === null
        ? null
        : (detail.activity ?? waitingLabel);
    if (label === null) return;
    const speakStep = () => {
      step.waiting = null;
      write(label, ACTIVITY_GAP_MS);
    };
    const wait = step.quietUntil - Date.now();
    if (wait <= 0) {
      speakStep();
      return;
    }
    const timer = setTimeout(speakStep, wait);
    step.waiting = { label, timer };
    return () => clearTimeout(timer);
  }, [
    threadKey,
    status,
    requestId,
    runId,
    runStatus,
    detailBehind,
    level,
    entries,
    workspaceRoot,
    announce,
    clear,
    announceDetail,
    clearDetail,
  ]);

  return (
    <>
      <div ref={detailRegionRef} aria-live="polite" className="sr-only" />
      <div ref={regionRef} aria-live="polite" className="sr-only" />
    </>
  );
});
