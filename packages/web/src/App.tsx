import { useEffect, useRef } from "react";
import { useConnectionStore } from "./stores/connection-store.js";
import { useWorkspaceStore } from "./stores/workspace-store.js";
import { useSettingsStore } from "./stores/settings-store.js";
import { Sidebar } from "./components/sidebar/Sidebar.js";
import { SplitPaneLayout } from "./components/terminal/SplitPaneLayout.js";
import { CommandPalette } from "./components/command-palette/CommandPalette.js";
import {
  ConnectionDialog,
  useAutoConnect,
} from "./components/connection/ConnectionDialog.js";
import { installKeybindings } from "./lib/keybindings.js";

export function App() {
  const status = useAutoConnect();
  const selectedTabId = useWorkspaceStore((s) => s.selectedTabId);
  const selectedTree = useWorkspaceStore(
    (s) => (s.selectedTabId ? s.trees[s.selectedTabId] : null),
  );
  const hasSelectedTab = !!selectedTabId;

  useEffect(() => installKeybindings(), []);

  const didAutoCreate = useRef(false);
  useEffect(() => {
    if (status !== "connected") {
      didAutoCreate.current = false;
      return;
    }
    if (didAutoCreate.current) return;
    const timer = setTimeout(() => {
      const { selectedTabId: cur, tabs } = useWorkspaceStore.getState();
      if (!cur && tabs.length === 0 && !didAutoCreate.current) {
        didAutoCreate.current = true;
        useConnectionStore.getState().send({ type: "create_tab" });
      } else {
        didAutoCreate.current = true;
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [status]);

  if (status === "disconnected") {
    return (
      <>
        <div className="flex h-full w-full items-center justify-center">
          <div className="text-center">
            <h1 className="mb-2 text-lg font-semibold text-zinc-200">
              supaterm
            </h1>
            <p className="mb-4 text-sm text-zinc-500">
              Waiting for connection...
            </p>
            <button
              onClick={() =>
                useSettingsStore
                  .getState()
                  .setConnectionDialogOpen(true)
              }
              className="rounded bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white"
            >
              Connect to Server
            </button>
          </div>
        </div>
        <ConnectionDialog />
      </>
    );
  }

  if (status === "connecting") {
    return (
      <>
        <div className="flex h-full w-full items-center justify-center">
          <div className="text-sm text-zinc-500">Connecting...</div>
        </div>
        <ConnectionDialog />
      </>
    );
  }

  return (
    <>
      <div className="flex h-full w-full">
        <Sidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            {selectedTabId && selectedTree ? (
              <SplitPaneLayout tree={selectedTree} tabId={selectedTabId} />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-zinc-600">
                {hasSelectedTab ? "Select a tab" : "Creating terminal..."}
              </div>
            )}
          </div>
          {status === "reconnecting" && (
            <div className="flex h-6 shrink-0 items-center justify-center bg-amber-900/50 text-xs text-amber-200">
              Reconnecting...
            </div>
          )}
        </div>
      </div>

      <CommandPalette />
      <ConnectionDialog />
    </>
  );
}
