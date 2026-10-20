import { SidebarPointerSensor } from "../Sidebar.pointer";
import {
  dropThreadContext,
  endThreadContextDrag,
  moveThreadContextDrag,
} from "../chat/threadContextDrag";

const PANE_DRAG_DISTANCE = 4;

/**
 * Drags a pane by its header grip onto another pane, through the same channel
 * as sidebar thread drags: an edge moves the pane there, the middle swaps.
 */
export function startPaneDrag(event: PointerEvent, paneId: string, title: string) {
  if (!event.isPrimary || event.button !== 0) return null;
  const payload = { kind: "pane", paneId } as const;
  const label = { title: title.trim() || "Thread", count: 1 };
  return new SidebarPointerSensor({
    active: paneId,
    event,
    options: {
      distance: PANE_DRAG_DISTANCE,
      onAttach: () => {},
      onFinish: endThreadContextDrag,
      onMove: (point) => {
        moveThreadContextDrag(point, label, payload);
        return true;
      },
      onDrop: (point) => {
        dropThreadContext(point, payload);
        return true;
      },
    },
    onPending: () => {},
    onStart: () => {},
    onMove: () => {},
    onEnd: () => {},
    onCancel: () => {},
    onAbort: () => {},
  });
}
