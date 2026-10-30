import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";

import { EASE_DRAWER, animationsSettled, prefersReducedMotion } from "~/lib/motion";
import { observeResize } from "~/lib/observeResize";

export const COMPOSER_ATTACHMENT_PRESENCE_CLASS =
  "transition-[opacity,scale] duration-200 ease-drawer data-enter:starting:scale-95 data-enter:starting:opacity-0 data-ending-style:pointer-events-none data-ending-style:scale-95 data-ending-style:opacity-0 data-ending-style:duration-150 data-ending-style:ease-in motion-reduce:transition-none";

const NO_IDS: ReadonlySet<string> = new Set();

export interface AttachmentTray {
  readonly draftKey: string;
  readonly arrived: ReadonlySet<string>;
  readonly findAttachment: (id: string) => HTMLElement | undefined;
  readonly exitSettled: () => void;
}

/**
 * Only attachments added to the open draft animate; switching drafts or layouts, sending, and
 * stashing show the tray as it is. Measures synchronously so a snap-shot's flight (which skips
 * this) reads final geometry.
 */
export function useAttachmentTrayMotion(
  draftKey: string,
  attachmentIds: ReadonlyArray<string>,
  layoutKey: string,
  snapShotPending: boolean,
): { readonly trayRef: RefObject<HTMLDivElement | null>; readonly tray: AttachmentTray } {
  const idsKey = attachmentIds.join("\n");
  const [tray, setTray] = useState({
    draftKey,
    idsKey,
    layoutKey,
    arrived: NO_IDS,
    animateHeight: false,
  });
  if (tray.draftKey !== draftKey || tray.idsKey !== idsKey || tray.layoutKey !== layoutKey) {
    const previousIds = new Set(tray.idsKey.split("\n"));
    const arrived =
      tray.draftKey === draftKey
        ? new Set(attachmentIds.filter((id) => !previousIds.has(id)))
        : NO_IDS;
    setTray({
      draftKey,
      idsKey,
      layoutKey,
      arrived,
      animateHeight: arrived.size > 0 && tray.layoutKey === layoutKey,
    });
  }
  const trayRef = useRef<HTMLDivElement>(null);
  const settledHeightRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = trayRef.current;
    if (!element) return;
    return observeResize(element, () => {
      if (element.getAnimations().length > 0) return;
      settledHeightRef.current = element.getBoundingClientRect().height;
    });
  }, []);
  useLayoutEffect(() => {
    const element = trayRef.current;
    if (!element) return;
    const running = element.getAnimations();
    const from =
      running.length > 0 ? element.getBoundingClientRect().height : settledHeightRef.current;
    for (const animation of running) animation.cancel();
    const to = element.getBoundingClientRect().height;
    settledHeightRef.current = to;
    if (
      !tray.animateHeight ||
      snapShotPending ||
      from === null ||
      from === to ||
      prefersReducedMotion()
    ) {
      return;
    }
    element.animate(
      [
        { height: `${from}px`, overflow: "clip" },
        { height: `${to}px`, overflow: "clip" },
      ],
      { duration: 200, easing: EASE_DRAWER },
    );
  }, [snapShotPending, tray]);
  const findAttachment = (id: string) =>
    [...(trayRef.current?.querySelectorAll<HTMLElement>("[data-composer-attachment]") ?? [])].find(
      (element) => element.dataset.composerAttachment === id,
    );
  const exitSettled = () => setTray((current) => ({ ...current, animateHeight: true }));
  return { trayRef, tray: { draftKey, arrived: tray.arrived, findAttachment, exitSettled } };
}

interface RetainedAttachment<T> {
  readonly id: string;
  readonly item: T;
  /** Everything shown before it when it left, so it keeps its place as others come and go. */
  readonly after: ReadonlyArray<string>;
}

const NO_RETAINED: ReadonlyArray<never> = [];

function placeRetained<T>(
  items: ReadonlyArray<T>,
  getId: (item: T) => string,
  retained: ReadonlyArray<RetainedAttachment<T>>,
) {
  const shown = [...items];
  const shownIds = items.map(getId);
  const exiting = new Set<string>();
  for (const entry of retained) {
    if (shownIds.includes(entry.id)) continue;
    const anchor = entry.after.findLast((id) => shownIds.includes(id));
    const index = anchor === undefined ? 0 : shownIds.indexOf(anchor) + 1;
    shown.splice(index, 0, entry.item);
    shownIds.splice(index, 0, entry.id);
    exiting.add(entry.id);
  }
  return { shown, exiting };
}

/**
 * One list in the tray. `exit` takes an attachment out of the draft at once
 * while a retained copy plays its exit in place, so a removed attachment can
 * never be sent. Spread `presence(id)` on each attachment's root element.
 */
export function useAttachmentExits<T>(
  tray: AttachmentTray,
  items: ReadonlyArray<T>,
  getId: (item: T) => string,
) {
  const [retained, setRetained] = useState<{
    readonly draftKey: string;
    readonly entries: ReadonlyArray<RetainedAttachment<T>>;
  }>({ draftKey: tray.draftKey, entries: NO_RETAINED });
  const entries = retained.draftKey === tray.draftKey ? retained.entries : NO_RETAINED;
  const { shown, exiting } =
    entries.length === 0 ? { shown: items, exiting: NO_IDS } : placeRetained(items, getId, entries);

  const { findAttachment, exitSettled } = tray;
  useEffect(() => {
    if (entries.length === 0) return;
    let cancelled = false;
    for (const { id } of entries) {
      const element = findAttachment(id);
      void (element ? animationsSettled(element) : Promise.resolve()).then(() => {
        if (cancelled) return;
        setRetained((current) => ({
          ...current,
          entries: current.entries.filter((entry) => entry.id !== id),
        }));
        exitSettled();
      });
    }
    return () => {
      cancelled = true;
    };
  }, [entries, exitSettled, findAttachment]);

  const exit = (id: string, remove: () => void) => {
    const shownIds = shown.map(getId);
    const index = shownIds.indexOf(id);
    const item = shown[index];
    if (item === undefined) {
      remove();
      return;
    }
    const entry = { id, item, after: shownIds.slice(0, index) };
    // One commit takes it out of the draft and retains it, so its element stays mounted.
    flushSync(() => {
      setRetained((current) => ({
        draftKey: tray.draftKey,
        entries: [...(current.draftKey === tray.draftKey ? current.entries : []), entry],
      }));
      remove();
    });
  };

  const presence = (id: string) => ({
    "data-composer-attachment": id,
    "data-enter": tray.arrived.has(id) ? "" : undefined,
    "data-ending-style": exiting.has(id) ? "" : undefined,
    inert: exiting.has(id) || undefined,
  });

  return { items: shown, exit, presence };
}

export type AttachmentExits<T> = ReturnType<typeof useAttachmentExits<T>>;
