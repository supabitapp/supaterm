import { ChevronLeftIcon, ChevronRightIcon, GripVerticalIcon } from "@supaterm/icons";

import { orderedPanes } from "../../chatPanes/layout";
import { usePaneScope } from "../../chatPanes/paneScope";
import { useChatPaneStore } from "../../chatPanes/store";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { startPaneDrag } from "./paneHeaderDrag";
import { T, useGT } from "gt-react";

export function ChatPaneHeaderControls({ title }: { title: string }) {
  const gt = useGT();
  const scope = usePaneScope();
  const paneId = scope?.paneId ?? null;
  const panes = useChatPaneStore((state) => state.layout?.cells.length ?? 1);
  const position = useChatPaneStore((state) =>
    state.layout && paneId
      ? orderedPanes(state.layout).findIndex((pane) => pane.id === paneId)
      : -1,
  );
  if (paneId === null || panes < 2) return null;
  const store = useChatPaneStore.getState;
  return (
    <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
      {scope?.collapsed ? (
        <>
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label={gt("Previous pane")}
            onClick={() => store().focusAdjacent(-1)}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {position + 1}/{panes}
          </span>
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label={gt("Next pane")}
            onClick={() => store().focusAdjacent(1)}
          >
            <ChevronRightIcon />
          </Button>
        </>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={gt("Move pane")}
                className="inline-flex size-6 cursor-grab touch-none items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:cursor-grabbing"
                onPointerDown={(event) => startPaneDrag(event.nativeEvent, paneId, title)}
              />
            }
          >
            <GripVerticalIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            <T>Drag onto another pane to move it</T>
          </TooltipPopup>
        </Tooltip>
      )}
    </div>
  );
}
