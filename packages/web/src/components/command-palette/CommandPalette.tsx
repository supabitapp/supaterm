import { useEffect, useMemo, useRef, useState } from "react";
import { useConnectionStore } from "../../stores/connection-store.js";
import { useWorkspaceStore } from "../../stores/workspace-store.js";
import { useSettingsStore } from "../../stores/settings-store.js";

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
}

function getCommands(): Command[] {
  const send = useConnectionStore.getState().send;
  const getState = useWorkspaceStore.getState;
  const settings = useSettingsStore.getState();
  const workspaceState = getState();
  const isSharedTabMode = workspaceState.workspaces.length === 0;

  const commands: Command[] = [
    {
      id: "close_pane",
      label: "Close Pane",
      shortcut: "Cmd+W",
      action: () => {
        const { selectedTabId, focusedPaneByTab } = getState();
        if (!selectedTabId) return;
        const paneId = focusedPaneByTab[selectedTabId];
        if (paneId) send({ type: "close_pane", paneId });
      },
    },
    {
      id: "close_tab",
      label: "Close Tab",
      shortcut: "Cmd+Shift+W",
      action: () => {
        const { selectedTabId } = getState();
        if (selectedTabId) send({ type: "close_tab", tabId: selectedTabId });
      },
    },
    {
      id: "split_right",
      label: "Split Right",
      shortcut: "Cmd+D",
      action: () => {
        const { selectedTabId } = getState();
        if (selectedTabId)
          send({ type: "create_pane", tabId: selectedTabId, direction: "right" });
      },
    },
    {
      id: "split_below",
      label: "Split Below",
      shortcut: "Cmd+Shift+D",
      action: () => {
        const { selectedTabId } = getState();
        if (selectedTabId)
          send({ type: "create_pane", tabId: selectedTabId, direction: "down" });
      },
    },
    {
      id: "split_left",
      label: "Split Left",
      action: () => {
        const { selectedTabId } = getState();
        if (selectedTabId)
          send({ type: "create_pane", tabId: selectedTabId, direction: "left" });
      },
    },
    {
      id: "split_up",
      label: "Split Up",
      action: () => {
        const { selectedTabId } = getState();
        if (selectedTabId)
          send({ type: "create_pane", tabId: selectedTabId, direction: "up" });
      },
    },
    {
      id: "next_tab",
      label: "Next Tab",
      shortcut: "Cmd+]",
      action: () => send({ type: "next_tab" }),
    },
    {
      id: "prev_tab",
      label: "Previous Tab",
      shortcut: "Cmd+[",
      action: () => send({ type: "previous_tab" }),
    },
    {
      id: "equalize",
      label: "Equalize Panes",
      shortcut: "Cmd+Shift+=",
      action: () => {
        const { selectedTabId } = getState();
        if (selectedTabId)
          send({ type: "equalize_panes", tabId: selectedTabId });
      },
    },
    {
      id: "zoom",
      label: "Toggle Zoom",
      shortcut: "Cmd+Shift+Enter",
      action: () => {
        const { selectedTabId } = getState();
        if (selectedTabId)
          send({ type: "toggle_zoom", tabId: selectedTabId });
      },
    },
    {
      id: "toggle_sidebar",
      label: "Toggle Sidebar",
      shortcut: "Cmd+B",
      action: () => settings.toggleSidebar(),
    },
    {
      id: "connect_remote",
      label: "Connect to Remote...",
      shortcut: "Cmd+Shift+R",
      action: () => settings.setConnectionDialogOpen(true),
    },
    {
      id: "new_workspace",
      label: "New Workspace",
      action: () => send({ type: "create_workspace" }),
    },
    ...workspaceState.workspaces.map((ws) => ({
      id: `switch_workspace_${ws.id}`,
      label: `Switch to Workspace: ${ws.name}`,
      action: () => send({ type: "select_workspace", workspaceId: ws.id }),
    })),
  ];

  if (!isSharedTabMode) {
    commands.unshift({
      id: "new_tab",
      label: "New Tab",
      shortcut: "Cmd+T",
      action: () => send({ type: "create_tab" }),
    });
  }

  return isSharedTabMode
    ? commands.filter((command) =>
        !["next_tab", "prev_tab", "new_workspace"].includes(command.id))
    : commands;
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CommandPalette() {
  const isOpen = useSettingsStore((s) => s.isCommandPaletteOpen);
  const close = () => useSettingsStore.getState().setCommandPaletteOpen(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo(() => getCommands(), [isOpen]);
  const filtered = useMemo(
    () =>
      query
        ? commands.filter((c) => fuzzyMatch(query, c.label))
        : commands,
    [query, commands],
  );

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isOpen) return null;

  const execute = (cmd: Command) => {
    close();
    cmd.action();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[selectedIndex];
      if (cmd) execute(cmd);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={close}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-zinc-800 px-3 py-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="w-full bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
          />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-600">
              No matching commands
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                onClick={() => execute(cmd)}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs ${
                  i === selectedIndex
                    ? "bg-zinc-800 text-zinc-200"
                    : "text-zinc-400 hover:bg-zinc-800/50"
                }`}
              >
                <span>{cmd.label}</span>
                {cmd.shortcut && (
                  <span className="text-zinc-600">{cmd.shortcut}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
