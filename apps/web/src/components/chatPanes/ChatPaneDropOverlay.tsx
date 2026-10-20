import { usePaneDropHover, type PaneDropZone } from "../../chatPanes/paneDrop";
import { cn } from "~/lib/utils";

const ZONE_CLASS_NAME: Record<PaneDropZone, string> = {
  left: "inset-y-0 left-0 w-1/2",
  right: "inset-y-0 right-0 w-1/2",
  top: "inset-x-0 top-0 h-1/2",
  bottom: "inset-x-0 bottom-0 h-1/2",
  center: "inset-0",
};

/** Shows where a dragged thread or pane would land in this pane. */
export function ChatPaneDropOverlay({ paneId }: { paneId: string }) {
  const zone = usePaneDropHover(paneId);
  if (zone === null) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[60]">
      <div
        className={cn(
          "absolute rounded-md border-2 border-primary/60 bg-primary/10",
          ZONE_CLASS_NAME[zone],
        )}
      />
    </div>
  );
}
