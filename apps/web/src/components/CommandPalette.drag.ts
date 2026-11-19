import type { ScopedThreadRef } from "@supaterm/contracts";
import { flushSync } from "react-dom";
import { dispatchCommandPalette } from "../commandPaletteStore";
import { SidebarPointerSensor } from "./Sidebar.pointer";
import {
  dropThreadContext,
  endThreadContextDrag,
  moveThreadContextDrag,
} from "./chat/threadContextDrag";

export function startPaletteThreadDrag(
  event: PointerEvent,
  thread: ScopedThreadRef,
  title: string,
) {
  if (!event.isPrimary || event.button !== 0 || event.pointerType === "touch") return;
  const payload = { kind: "threads", threads: [{ ...thread, title }] } as const;
  return new SidebarPointerSensor({
    event,
    active: `${thread.environmentId}:${thread.threadId}`,
    options: {
      distance: 6,
      onAttach: () => {},
      onFinish: endThreadContextDrag,
      onDrop: (point) => dropThreadContext(point, payload),
    },
    onStart: () => {
      flushSync(() => dispatchCommandPalette({ _tag: "SetOpen", open: false }));
    },
    onMove: (point) => moveThreadContextDrag(point, { title, count: 1 }, payload),
    onPending: () => {},
    onAbort: () => {},
    onCancel: () => {},
    onEnd: () => {},
  });
}
