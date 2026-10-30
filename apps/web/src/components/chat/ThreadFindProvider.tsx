import {
  createContext,
  use,
  useImperativeHandle,
  type ReactNode,
  type ComponentProps,
  type Ref,
} from "react";
import { useThreadFind } from "./useThreadFind";
import { ThreadFindBar } from "./ThreadFindBar";
import { ChatCanvas } from "./ChatCanvas";

type Find = ReturnType<typeof useThreadFind>;
export type ThreadFindControls = Pick<Find, "open" | "close">;
export const ThreadFindTimelineContext = createContext<Find["timelineProps"] | null>(null);
const ThreadFindBarContext = createContext<Find["barProps"] | null>(null);

export function ThreadFindCanvas({
  findOptions,
  controlsRef,
  ...canvasProps
}: ComponentProps<typeof ChatCanvas> & {
  findOptions: Parameters<typeof useThreadFind>[0];
  controlsRef: Ref<ThreadFindControls>;
}) {
  return (
    <ThreadFindProvider {...findOptions} controlsRef={controlsRef}>
      <ChatCanvas {...canvasProps} />
    </ThreadFindProvider>
  );
}

function ThreadFindProvider({
  controlsRef,
  children,
  ...options
}: Parameters<typeof useThreadFind>[0] & {
  controlsRef: Ref<ThreadFindControls>;
  children: ReactNode;
}) {
  const find = useThreadFind(options);
  useImperativeHandle(controlsRef, () => ({ open: find.open, close: find.close }), [
    find.open,
    find.close,
  ]);
  return (
    <ThreadFindBarContext value={find.barProps}>
      <ThreadFindTimelineContext value={find.timelineProps}>{children}</ThreadFindTimelineContext>
    </ThreadFindBarContext>
  );
}

export function ThreadFind({ onClose }: { onClose: () => void }) {
  const bar = use(ThreadFindBarContext);
  if (!bar) return null;
  return (
    <ThreadFindBar
      {...bar}
      onClose={() => {
        bar.onClose();
        onClose();
      }}
    />
  );
}
