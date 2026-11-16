import { LAYOUT_SHIFT_EVENT, type LayoutShift } from "~/lib/layoutShift";

const ROW_FRAME_SELECTOR = ".messages-timeline-row-frame";
// The list repositions rows one or two frames after a row resizes.
const REPOSITION_DEADLINE_MS = 80;
// The list's row containment without `paint`, so a row held taller than the list knows can show.
const UNCLIPPED_ROW_CONTAINMENT = "layout style";

/** What follows one row's shifts, from the event until the shift settles or the next one takes over. */
interface RowFollow {
  readonly frame: HTMLElement;
  readonly row: HTMLElement;
  /** The row's own `contain`, put back when it stops holding extra height. */
  readonly containment: string;
  /** How far the list scrolled the timeline for the slides now on screen. */
  scrolled: number;
  slides: Animation[];
  stopWaiting: () => void;
}

const rowsOf = (content: HTMLElement) =>
  [...content.children].filter((row) => row instanceof HTMLElement);

const topOf = (row: HTMLElement) => Number.parseFloat(row.style.top);

/** Runs `onMoved` in the task where the list rewrites row positions, or at the deadline. */
function whenRepositioned(content: HTMLElement, onMoved: () => void) {
  const rows = rowsOf(content);
  const tops = new Map(rows.map((row) => [row, row.style.top]));
  const height = content.style.height;
  const stop = () => {
    observer.disconnect();
    window.clearTimeout(timeout);
  };
  const finish = () => {
    stop();
    onMoved();
  };
  const observer = new MutationObserver(() => {
    const moved =
      content.style.height !== height || rows.some((row) => row.style.top !== tops.get(row));
    if (moved) finish();
  });
  const options = { attributes: true, attributeFilter: ["style"] };
  for (const element of [content, ...rows]) observer.observe(element, options);
  const timeout = window.setTimeout(finish, REPOSITION_DEADLINE_MS);
  return stop;
}

/**
 * Slides the timeline around a row whose height changes in one step. The list positions
 * rows a frame or two after a resize and decides then how scroll follows, so it gets the
 * final height at once and the shift waits for it. Everything then slides from where it
 * was to where the list put it. Rows move by their list containers, which clip paint.
 */
export function followTimelineLayoutShifts(scrollNode: HTMLElement) {
  const follows = new Map<HTMLElement, RowFollow>();
  const end = (follow: RowFollow) => {
    follow.stopWaiting();
    for (const animation of follow.slides) animation.cancel();
    follow.frame.style.removeProperty("margin-bottom");
    follow.row.style.contain = follow.containment;
  };

  const onShift = (event: Event) => {
    if (!(event instanceof CustomEvent) || !(event.target instanceof Element)) return;
    const shift: LayoutShift = event.detail;
    if (shift.anchor !== "top") return;
    const frame = event.target.closest<HTMLElement>(ROW_FRAME_SELECTOR);
    const row = frame?.parentElement;
    const content = row?.parentElement;
    const list = content?.parentElement;
    if (!frame || !row || !content || !list || Number.isNaN(topOf(row))) return;

    const [first, last] = shift.offsets;
    const interrupted = follows.get(row);
    interrupted?.stopWaiting();
    for (const animation of interrupted?.slides ?? []) {
      // Seeking completes the pause now, where the interrupted reveal stopped.
      const time = animation.currentTime;
      animation.pause();
      animation.currentTime = time;
    }
    const follow: RowFollow = {
      frame,
      row,
      containment: interrupted?.containment ?? row.style.contain,
      scrolled: interrupted?.scrolled ?? 0,
      slides: interrupted?.slides ?? [],
      stopWaiting: () => {},
    };
    follows.set(row, follow);

    // The row holds `-last` more height than it ends with. A negative margin takes that
    // from the list's row now, so the list repositions once, at the start.
    frame.style.marginBottom = last < 0 ? `${last}px` : "";
    row.style.contain = last < 0 ? UNCLIPPED_ROW_CONTAINMENT : follow.containment;

    const placeInView = () => topOf(row) - scrollNode.scrollTop;
    const before = placeInView();
    const start = shift.hold();
    const stopWatching = whenRepositioned(content, () => {
      follow.stopWaiting = () => {};
      // Slides taken over part way still show this much of the scroll they followed.
      const progress = follow.slides[0]?.effect?.getComputedTiming().progress ?? 1;
      const scrolled = before - placeInView() + follow.scrolled * (1 - progress);
      for (const animation of follow.slides) animation.cancel();
      // Added to other rows' slides: two rows can shift at once.
      const timing = { ...shift.timing, composite: "add" } as const;
      const slide = (element: Element, offset: number) =>
        Math.abs(offset) < 0.5
          ? []
          : [element.animate({ translate: [`0 ${offset}px`, "0 0"] }, timing)];
      // What sits below the row also gives up the height the reveal has yet to show or hide.
      const below = scrolled + first - last;
      const parts = [...list.children];
      const slides = [
        ...parts.slice(0, parts.indexOf(content)).flatMap((part) => slide(part, scrolled)),
        ...rowsOf(content).flatMap((other) =>
          slide(other, topOf(other) > topOf(row) ? below : scrolled),
        ),
        ...parts.slice(parts.indexOf(content) + 1).flatMap((part) => slide(part, below)),
      ];
      follow.scrolled = scrolled;
      follow.slides = slides;
      start();
    });
    follow.stopWaiting = () => {
      stopWatching();
      start();
    };
    void shift.settled.then(() => {
      if (follows.get(row) !== follow) return;
      follows.delete(row);
      end(follow);
    });
  };
  scrollNode.addEventListener(LAYOUT_SHIFT_EVENT, onShift);
  return () => {
    scrollNode.removeEventListener(LAYOUT_SHIFT_EVENT, onShift);
    for (const follow of follows.values()) end(follow);
    follows.clear();
  };
}
