const MOVED_ROW_PRESS_DELAY_MS = 500;
const OWN_INPUT_WINDOW_MS = 500;

const PRESS_FOLLOW_UPS = ["click", "auxclick", "dblclick", "contextmenu"] as const;

function editsText(event: KeyboardEvent) {
  const target = event.target;
  const editable =
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement);
  return editable && event.key !== "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey;
}

function readTops(list: HTMLElement) {
  const tops = new Map<HTMLElement, number>();
  for (const child of list.children) {
    if (child instanceof HTMLElement) tops.set(child, child.offsetTop);
  }
  return tops;
}

/**
 * Drops presses on rows that something other than the user just moved, so a
 * thread settling, waking or arriving above the pointer cannot hand its click
 * to the neighbouring row. Call `update` after each commit that can move rows.
 * The list must be positioned so every direct child's offsetTop shares its origin.
 */
export function createSidebarShiftGuard(list: HTMLElement) {
  const view = list.ownerDocument.defaultView;
  let tops = readTops(list);
  const movedAt = new WeakMap<Element, number>();
  let lastInputAt = Number.NEGATIVE_INFINITY;
  const heldDrops = new Set<number>();
  let pressDropped = false;
  let releasedDrop: number | null = null;

  const rowOf = (target: EventTarget | null) => {
    let node = target instanceof Node ? target : null;
    while (node !== null && node.parentNode !== list) node = node.parentNode;
    return node instanceof Element ? node : null;
  };
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const onPointerDown = (event: PointerEvent) => {
    heldDrops.delete(event.pointerId);
    if (releasedDrop === event.pointerId) releasedDrop = null;
    const now = performance.now();
    const row = rowOf(event.target);
    const moved = row === null ? undefined : movedAt.get(row);
    if (moved !== undefined && now - moved < MOVED_ROW_PRESS_DELAY_MS) {
      heldDrops.add(event.pointerId);
      pressDropped = true;
      swallow(event);
      return;
    }
    pressDropped = false;
    lastInputAt = now;
  };
  const onPointerUp = (event: PointerEvent) => {
    const dropped = heldDrops.delete(event.pointerId);
    releasedDrop = dropped ? event.pointerId : null;
    pressDropped = dropped;
    if (dropped) {
      if (rowOf(event.target) !== null) swallow(event);
      return;
    }
    lastInputAt = performance.now();
  };
  const onPointerCancel = (event: PointerEvent) => {
    heldDrops.delete(event.pointerId);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    pressDropped = false;
    if (!editsText(event)) lastInputAt = performance.now();
  };
  const onPressFollowUp = (event: MouseEvent) => {
    if (event.type === "click" && event.detail === 0) return;
    const dropped =
      event instanceof PointerEvent && event.pointerId >= 0
        ? heldDrops.has(event.pointerId) || releasedDrop === event.pointerId
        : pressDropped;
    if (dropped && rowOf(event.target) !== null) swallow(event);
  };

  view?.addEventListener("pointerdown", onPointerDown, { capture: true });
  view?.addEventListener("pointerup", onPointerUp, { capture: true });
  view?.addEventListener("pointercancel", onPointerCancel, { capture: true });
  view?.addEventListener("keydown", onKeyDown, { capture: true });
  for (const type of PRESS_FOLLOW_UPS) {
    view?.addEventListener(type, onPressFollowUp, { capture: true });
  }

  return {
    update() {
      const next = readTops(list);
      const now = performance.now();
      const ownMove = tops.size === 0 || now - lastInputAt < OWN_INPUT_WINDOW_MS;
      for (const [row, top] of next) {
        const previous = tops.get(row);
        if (previous === top) continue;
        if (previous !== undefined && Math.abs(top - previous) * 2 < row.offsetHeight) continue;
        if (ownMove) movedAt.delete(row);
        else movedAt.set(row, now);
      }
      tops = next;
    },
    dispose() {
      view?.removeEventListener("pointerdown", onPointerDown, { capture: true });
      view?.removeEventListener("pointerup", onPointerUp, { capture: true });
      view?.removeEventListener("pointercancel", onPointerCancel, { capture: true });
      view?.removeEventListener("keydown", onKeyDown, { capture: true });
      for (const type of PRESS_FOLLOW_UPS) {
        view?.removeEventListener(type, onPressFollowUp, { capture: true });
      }
    },
  };
}
