import { memo, useEffect, useRef, useCallback } from "react";
import { Restty } from "restty";
import { useWorkspaceStore } from "../../stores/workspace-store.js";
import { useConnectionStore } from "../../stores/connection-store.js";

interface TerminalPaneProps {
  paneId: string;
  isFocused?: boolean;
}

export const TerminalPane = memo(function TerminalPane({
  paneId,
  isFocused,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const resttyRef = useRef<Restty | null>(null);
  const initedRef = useRef(false);
  const paneIdRef = useRef(paneId);
  const ptyUrlRef = useRef<string | undefined>(undefined);

  const ptyUrl = useWorkspaceStore((s) => s.ptyUrls[paneId]);
  ptyUrlRef.current = ptyUrl;
  paneIdRef.current = paneId;

  const initTerminal = useCallback(
    (container: HTMLDivElement) => {
      const url = ptyUrlRef.current;
      if (initedRef.current || !url) return;
      if (container.offsetWidth === 0 || container.offsetHeight === 0) return;

      initedRef.current = true;

      const restty = new Restty({
        root: container,
        createInitialPane: true,
        shortcuts: {
          canHandleEvent: () => false,
        },
        defaultContextMenu: false,
        appOptions: {
          fontSize: 14,
          autoResize: true,
          callbacks: {
            onGridSize: (cols: number, rows: number) => {
              useConnectionStore.getState().send({
                type: "resize_pane",
                paneId: paneIdRef.current,
                cols,
                rows,
              });
            },
          },
        },
      });

      resttyRef.current = restty;
      restty.connectPty(url);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !ptyUrl) return;
    if (initedRef.current) return;

    initTerminal(container);

    if (!initedRef.current) {
      const observer = new ResizeObserver(() => {
        if (!initedRef.current) {
          initTerminal(container);
        }
        if (initedRef.current) {
          observer.disconnect();
        }
      });
      observer.observe(container);
      return () => observer.disconnect();
    }

    return undefined;
  }, [ptyUrl, initTerminal]);

  useEffect(() => {
    return () => {
      if (resttyRef.current) {
        resttyRef.current.destroy();
        resttyRef.current = null;
        initedRef.current = false;
      }
    };
  }, []);

  if (!ptyUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-zinc-600">
        Waiting for PTY...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      data-pane-id={paneId}
      data-focused={isFocused || undefined}
    />
  );
});
