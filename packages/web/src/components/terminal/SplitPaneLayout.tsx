import { useCallback, useRef, useState } from "react";
import type { SplitNode, SplitTree } from "@supaterm/shared";
import { TerminalPane } from "./TerminalPane.js";
import { useWorkspaceStore } from "../../stores/workspace-store.js";
import { useConnectionStore } from "../../stores/connection-store.js";

interface SplitPaneLayoutProps {
  tree: SplitTree<string>;
  tabId: string;
}

export function SplitPaneLayout({ tree, tabId }: SplitPaneLayoutProps) {
  const focusedPaneId = useWorkspaceStore(
    (s) => s.focusedPaneByTab[tabId],
  );

  if (tree.zoomed && tree.zoomed.type === "leaf") {
    return (
      <div className="h-full w-full">
        <TerminalPane
          paneId={tree.zoomed.id}
          isFocused={tree.zoomed.id === focusedPaneId}
        />
      </div>
    );
  }

  if (!tree.root) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-zinc-600">
        No panes
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <SplitNodeView
        node={tree.root}
        tabId={tabId}
        focusedPaneId={focusedPaneId}
      />
    </div>
  );
}

interface SplitNodeViewProps {
  node: SplitNode<string>;
  tabId: string;
  focusedPaneId: string | undefined;
}

function SplitNodeView({ node, tabId, focusedPaneId }: SplitNodeViewProps) {
  if (node.type === "leaf") {
    return (
      <div
        className="h-full w-full"
        onMouseDownCapture={() => {
          if (node.id !== focusedPaneId) {
            useWorkspaceStore.getState().focusPane(node.id);
          }
        }}
      >
        <TerminalPane
          paneId={node.id}
          isFocused={node.id === focusedPaneId}
        />
      </div>
    );
  }

  const isHorizontal = node.direction === "horizontal";

  return (
    <div
      className="flex h-full w-full"
      style={{ flexDirection: isHorizontal ? "row" : "column" }}
    >
      <div
        style={{
          flexBasis: `${node.ratio * 100}%`,
          flexGrow: 0,
          flexShrink: 0,
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <SplitNodeView
          node={node.left}
          tabId={tabId}
          focusedPaneId={focusedPaneId}
        />
      </div>

      <SplitDivider
        direction={node.direction}
        onDrag={(delta) => {
          useConnectionStore.getState().send({
            type: "split_resize",
            paneId: getFirstLeaf(node.left),
            delta,
            axis: node.direction,
          });
        }}
      />

      <div
        style={{
          flexBasis: `${(1 - node.ratio) * 100}%`,
          flexGrow: 0,
          flexShrink: 0,
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <SplitNodeView
          node={node.right}
          tabId={tabId}
          focusedPaneId={focusedPaneId}
        />
      </div>
    </div>
  );
}

function getFirstLeaf(node: SplitNode<string>): string {
  if (node.type === "leaf") return node.id;
  return getFirstLeaf(node.left);
}

// --- Divider ---

interface SplitDividerProps {
  direction: "horizontal" | "vertical";
  onDrag: (delta: number) => void;
}

function SplitDivider({ direction, onDrag }: SplitDividerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startRef = useRef(0);
  const sizeRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startRef.current =
        direction === "horizontal" ? e.clientX : e.clientY;

      const parent = (e.target as HTMLElement).parentElement;
      if (parent) {
        sizeRef.current =
          direction === "horizontal"
            ? parent.offsetWidth
            : parent.offsetHeight;
      }

      const handleMouseMove = (e: MouseEvent) => {
        const current =
          direction === "horizontal" ? e.clientX : e.clientY;
        const pixelDelta = current - startRef.current;
        const ratioDelta =
          sizeRef.current > 0 ? pixelDelta / sizeRef.current : 0;
        if (Math.abs(ratioDelta) > 0.005) {
          onDrag(ratioDelta);
          startRef.current = current;
        }
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [direction, onDrag],
  );

  const isH = direction === "horizontal";

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`shrink-0 ${isH ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"} ${
        isDragging ? "bg-blue-500" : "bg-zinc-800 hover:bg-zinc-600"
      } transition-colors`}
    />
  );
}
