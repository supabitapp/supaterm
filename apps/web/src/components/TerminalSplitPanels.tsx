import { Fragment, type ReactNode } from "react";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useGroupRef,
} from "~/components/ui/resizable";
import { cn } from "~/lib/utils";
import {
  terminalSplitLayoutMatches,
  type TerminalSplitLayout,
  type ThreadTerminalGroup,
} from "../types";

const TERMINAL_SPLIT_MIN_SIZE = { horizontal: 48, vertical: 40 } as const;

function mapLayoutKeys(layout: TerminalSplitLayout, mapKey: (key: string) => string) {
  return Object.fromEntries(Object.entries(layout).map(([key, size]) => [mapKey(key), size]));
}

interface TerminalSplitPanelsProps {
  /**
   * Panel ids become DOM ids and key the library's in-memory layouts, so they
   * must be unique per thread and group: terminal ids like term-1 repeat.
   */
  idPrefix: string;
  group: ThreadTerminalGroup;
  disabled: boolean;
  activeTerminalId: string;
  onActiveTerminalChange: (terminalId: string) => void;
  onLayoutChange: (layout: TerminalSplitLayout) => void;
  /** Grabbing a divider moves focus onto it, or onto the page once a drag ends. */
  onDividerRelease: () => void;
  renderTerminal: (terminalId: string) => ReactNode;
}

export function TerminalSplitPanels({
  idPrefix,
  group,
  disabled,
  activeTerminalId,
  onActiveTerminalChange,
  onLayoutChange,
  onDividerRelease,
  renderTerminal,
}: TerminalSplitPanelsProps) {
  const groupRef = useGroupRef();
  const direction = group.splitDirection ?? "horizontal";
  const toPanelId = (terminalId: string) => idPrefix + terminalId;
  const resetLayout = () => {
    const size = 100 / group.terminalIds.length;
    const layout = Object.fromEntries(group.terminalIds.map((terminalId) => [terminalId, size]));
    groupRef.current?.setLayout(mapLayoutKeys(layout, toPanelId));
    onLayoutChange(layout);
  };

  return (
    <ResizablePanelGroup
      groupRef={groupRef}
      disabled={disabled}
      orientation={direction}
      defaultLayout={
        terminalSplitLayoutMatches(group.layout, group.terminalIds)
          ? mapLayoutKeys(group.layout, toPanelId)
          : undefined
      }
      onLayoutChanged={(layout, meta) => {
        if (!meta.isUserInteraction) return;
        onLayoutChange(
          mapLayoutKeys(meta.requestedLayout ?? layout, (panelId) =>
            panelId.slice(idPrefix.length),
          ),
        );
      }}
    >
      {group.terminalIds.map((terminalId, index) => (
        <Fragment key={terminalId}>
          {index > 0 && (
            <ResizableHandle
              aria-label="Resize terminals"
              onDoubleClick={resetLayout}
              onPointerUp={onDividerRelease}
            />
          )}
          <ResizablePanel id={toPanelId(terminalId)} minSize={TERMINAL_SPLIT_MIN_SIZE[direction]}>
            <div
              className={cn(
                "h-full",
                index > 0 && (direction === "vertical" ? "border-t" : "border-l"),
                terminalId === activeTerminalId ? "border-border" : "border-border/70",
              )}
              onPointerDown={() => {
                if (terminalId !== activeTerminalId) onActiveTerminalChange(terminalId);
              }}
            >
              {renderTerminal(terminalId)}
            </div>
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  );
}
