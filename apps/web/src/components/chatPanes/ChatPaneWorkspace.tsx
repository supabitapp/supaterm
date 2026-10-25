import { useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { BackgroundThreadContext } from "../chat/backgroundThread";

import {
  focusedPane,
  isSplit,
  paneGridlines,
  paneLayoutFits,
  paneTargetKey,
  trackMinimumSize,
  type PaneCell,
  type PaneLayout,
} from "../../chatPanes/layout";
import { PaneScopeProvider, registerPaneComposer, type PaneScope } from "../../chatPanes/paneScope";
import { useChatPaneStore } from "../../chatPanes/store";
import { ComposerHandleContext } from "../../composerHandleContext";
import { observeResize } from "../../lib/observeResize";
import { RIGHT_PANEL_SHEET_MAX_WIDTH } from "../../rightPanelLayout";
import { buildThreadRouteParams, type ThreadRouteTarget } from "../../threadRoutes";
import type { ChatComposerHandle } from "../chat/ChatComposer";
import { ThreadRouteView } from "../ThreadRouteView";
import { SidebarInset } from "../ui/sidebar";
import { ResizableGrid, ResizableGridCell, ResizableGridline, useGridRef } from "../ui/resizable";
import { ChatPaneDropOverlay } from "./ChatPaneDropOverlay";
import { LinkPullRequestDialogHost } from "../pullRequest/LinkPullRequestDialog";
import { cn } from "~/lib/utils";
import { useStableCallback } from "~/hooks/useStableCallback";
import { runPaneMenuAction, trackChatPaneWorkspaceMount } from "../../chatPanes/actions";

function useNavigateToPaneTarget() {
  const navigate = useNavigate();
  return useStableCallback((target: ThreadRouteTarget, replace: boolean) => {
    if (target.kind === "server") {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(target.threadRef),
        replace,
      });
    } else {
      void navigate({ to: "/draft/$draftId", params: { draftId: target.draftId }, replace });
    }
  });
}

/**
 * The chat area: one pane per open thread, tiled on a resizable grid. Even a
 * single thread renders as a one-cell grid, so splitting it, moving it, or
 * closing its neighbours never remounts the view the user is in.
 */
/** `background` keeps the panes mounted, inert and in place under Settings or Usage. */
export function ChatPaneWorkspace({
  target,
  background = false,
}: {
  target: ThreadRouteTarget;
  background?: boolean;
}) {
  const layout = useChatPaneStore((state) => state.layout);
  const navigateToTarget = useNavigateToPaneTarget();
  const routeKey = paneTargetKey(target);
  const routeKeyRef = useRef(routeKey);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    routeKeyRef.current = routeKey;
    const rect = containerRef.current?.getBoundingClientRect();
    useChatPaneStore
      .getState()
      .reconcileRoute(target, rect ? { width: rect.width, height: rect.height } : null);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the key identifies the target; a new object for the same thread is not a navigation
  }, [routeKey]);

  const focusedKey = layout ? paneTargetKey(focusedPane(layout).target) : null;
  // Focus changes move the URL; route changes flow the other way through the reconcile above.
  useEffect(() => {
    if (background || focusedKey === null || focusedKey === routeKeyRef.current) return;
    const { layout: current, historyMode } = useChatPaneStore.getState();
    const focused = current ? focusedPane(current).target : null;
    if (!focused || paneTargetKey(focused) !== focusedKey) return;
    navigateToTarget(focused, historyMode === "replace");
  }, [background, focusedKey, navigateToTarget]);

  useEffect(() => trackChatPaneWorkspaceMount(), []);
  useEffect(() => window.desktopBridge?.onMenuAction(runPaneMenuAction), []);

  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize((current) =>
        current && current.width === width && current.height === height
          ? current
          : { width, height },
      );
    };
    measure();
    return observeResize([element], measure);
  }, []);

  return (
    <SidebarInset
      className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh"
      inert={background}
    >
      <BackgroundThreadContext value={background}>
        <div ref={containerRef} className="isolate flex min-h-0 min-w-0 flex-1">
          {layout && size ? <PaneGrid layout={layout} size={size} /> : null}
        </div>
        <LinkPullRequestDialogHost />
      </BackgroundThreadContext>
    </SidebarInset>
  );
}

const SINGLE_TRACK = [{ id: "single", defaultSize: "100%" }];

const trackSizes = (tracks: PaneLayout["columns"]) =>
  Object.fromEntries(tracks.map((track) => [track.id, track.size]));

const sizesDiffer = (current: Record<string, number>, wanted: Record<string, number>) =>
  Object.entries(wanted).some(([id, size]) => Math.abs((current[id] ?? -1) - size) > 0.5);

function gridTracks(layout: PaneLayout, axis: "column" | "row") {
  return (axis === "column" ? layout.columns : layout.rows).map((track, index) => ({
    id: track.id,
    defaultSize: `${track.size}%`,
    minSize: trackMinimumSize(layout, axis, index),
  }));
}

function PaneGrid({
  layout,
  size,
}: {
  layout: PaneLayout;
  size: { width: number; height: number };
}) {
  const setTrackSizes = useChatPaneStore((state) => state.setTrackSizes);
  // Too small for every pane: show the focused one and keep the arrangement for later.
  const collapsed = isSplit(layout) && !paneLayoutFits(layout, size);
  const split = isSplit(layout) && !collapsed;
  const cells = split ? layout.cells : [focusedPane(layout)];
  const columns = split ? gridTracks(layout, "column") : SINGLE_TRACK;
  const rows = split ? gridTracks(layout, "row") : SINGLE_TRACK;
  // Sizes that change without a drag, like equalizing or reopening, reach the grid through its
  // handle: once dragged, it keeps the sizes it was given over new default sizes.
  const gridRef = useGridRef();
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || !split) return;
    const current = grid.getLayout();
    const wanted = { columns: trackSizes(layout.columns), rows: trackSizes(layout.rows) };
    if (sizesDiffer(current.columns, wanted.columns) || sizesDiffer(current.rows, wanted.rows)) {
      grid.setLayout(wanted);
    }
  }, [gridRef, layout, split]);
  return (
    <ResizableGrid
      gridRef={gridRef}
      className="min-h-0 min-w-0 flex-1"
      columns={columns}
      rows={rows}
      onLayoutChanged={(next, meta) => {
        if (split && meta.isUserInteraction) setTrackSizes(next);
      }}
    >
      {cells.map((cell) => (
        <ResizableGridCell
          key={cell.id}
          id={`chat-pane-${cell.id}`}
          column={split ? cell.column : 0}
          columnSpan={split ? cell.columnSpan : 1}
          row={split ? cell.row : 0}
          rowSpan={split ? cell.rowSpan : 1}
        >
          <ChatPaneFrame
            cell={cell}
            layout={layout}
            split={split}
            collapsed={collapsed}
            focused={cell.id === layout.focusedPaneId}
          />
        </ResizableGridCell>
      ))}
      {split
        ? paneGridlines(layout).map((line) =>
            line.type === "column" ? (
              <ResizableGridline
                key={`column:${layout.columns[line.index]!.id}:${line.from}`}
                type="column"
                column={line.index}
                row={line.from}
                rowSpan={line.span}
                label="Resize chat panes"
              />
            ) : (
              <ResizableGridline
                key={`row:${layout.rows[line.index]!.id}:${line.from}`}
                type="row"
                row={line.index}
                column={line.from}
                columnSpan={line.span}
                label="Resize chat panes"
              />
            ),
          )
        : null}
    </ResizableGrid>
  );
}

function trackOffset(tracks: PaneLayout["columns"], index: number) {
  return tracks.slice(0, index).reduce((sum, track) => sum + track.size, 0);
}

/**
 * Title-bar placement for a pane: only panes along the window's top edge hold
 * native window controls or the floating sidebar toggle, so the rest drop
 * those insets.
 */
function paneChromeStyle(cell: PaneCell, layout: PaneLayout, split: boolean): CSSProperties {
  if (!split) return {};
  const top = cell.row === 0;
  const left = cell.column === 0;
  const right = cell.column + cell.columnSpan === layout.columns.length;
  return {
    ...(top && right
      ? {}
      : {
          "--workspace-controls-right": "0.75rem",
          "--workspace-native-controls-inset": "0px",
        }),
    ...(top ? {} : { "--workspace-controls-top": "0px" }),
    ...(top && left ? {} : { "--workspace-titlebar-content-left": "0.75rem" }),
  } as CSSProperties;
}

function ChatPaneFrame(props: {
  cell: PaneCell;
  layout: PaneLayout;
  split: boolean;
  collapsed: boolean;
  focused: boolean;
}) {
  const { cell, layout, split, collapsed, focused } = props;
  const focus = useChatPaneStore((state) => state.focus);
  const [composerRef] = useState(() => ({ current: null as ChatComposerHandle | null }));
  useEffect(() => registerPaneComposer(cell.id, composerRef), [cell.id, composerRef]);

  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const element = frame;
    if (!element) return;
    const measure = () =>
      setNarrow(element.getBoundingClientRect().width <= RIGHT_PANEL_SHEET_MAX_WIDTH);
    measure();
    return observeResize([element], measure);
  }, [frame]);

  const layoutVersion = split
    ? [
        trackOffset(layout.columns, cell.column),
        trackOffset(layout.rows, cell.row),
        trackOffset(layout.columns, cell.column + cell.columnSpan),
        trackOffset(layout.rows, cell.row + cell.rowSpan),
      ].join(":")
    : "single";
  const scope: PaneScope = {
    paneId: cell.id,
    layoutVersion,
    narrow,
    collapsed,
    element: split ? frame : null,
  };

  const claimFocus = () => {
    if (!focused) focus(cell.id);
  };
  return (
    <div
      ref={setFrame}
      className={cn(
        "relative flex h-full min-h-0 w-full min-w-0 flex-col border-border data-[split=true]:[contain:layout]",
        split && cell.column > 0 && "border-l",
        split && cell.row > 0 && "border-t",
      )}
      data-chat-pane={cell.id}
      data-split={split}
      data-top-row={!split || cell.row === 0}
      data-focused={focused}
      data-collapsed={collapsed}
      style={paneChromeStyle(cell, layout, split)}
      onPointerDownCapture={claimFocus}
      onFocusCapture={claimFocus}
    >
      <PaneScopeProvider value={scope}>
        <ComposerHandleContext value={composerRef}>
          <ThreadRouteView target={cell.target} paneId={cell.id} />
        </ComposerHandleContext>
      </PaneScopeProvider>
      {split ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-40 border border-transparent data-[focused=true]:border-primary/35"
          data-focused={focused}
        />
      ) : null}
      <ChatPaneDropOverlay paneId={cell.id} />
    </div>
  );
}
