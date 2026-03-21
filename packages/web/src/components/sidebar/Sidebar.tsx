import { useState } from "react";
import type { TabState } from "@supaterm/shared";
import { useWorkspaceStore } from "../../stores/workspace-store.js";
import { useConnectionStore } from "../../stores/connection-store.js";
import { useSettingsStore } from "../../stores/settings-store.js";

const TONE_COLORS: Record<string, string> = {
  amber: "text-amber-400",
  coral: "text-red-400",
  mint: "text-emerald-400",
  sky: "text-sky-400",
  slate: "text-slate-400",
  violet: "text-violet-400",
};

function SidebarIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      className={className}
    >
      <rect x="1" y="2" width="12" height="10" rx="1.5" />
      <line x1="5" y1="2" x2="5" y2="12" />
    </svg>
  );
}

export function Sidebar() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const selectedWorkspaceId = useWorkspaceStore((s) => s.selectedWorkspaceId);
  const allTabs = useWorkspaceStore((s) => s.tabs);
  const selectedTabId = useWorkspaceStore((s) => s.selectedTabId);
  const send = useConnectionStore((s) => s.send);
  const isCollapsed = useSettingsStore((s) => s.isSidebarCollapsed);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);

  const tabs = selectedWorkspaceId
    ? allTabs.filter((t) => t.workspaceId === selectedWorkspaceId)
    : allTabs;

  if (isCollapsed) {
    return (
      <div className="flex h-full w-10 shrink-0 flex-col items-center border-r border-zinc-800 bg-zinc-950 py-2">
        <button
          onClick={toggleSidebar}
          className="flex h-7 w-7 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          title="Expand sidebar (Cmd+B)"
        >
          <SidebarIcon />
        </button>

        <div className="mt-3 flex flex-col items-center gap-1">
          {tabs.map((tab) => {
            const toneClass = TONE_COLORS[tab.tone] ?? "text-zinc-400";
            return (
              <button
                key={tab.id}
                onClick={() =>
                  send({ type: "select_tab", tabId: tab.id })
                }
                className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                  tab.id === selectedTabId
                    ? "bg-zinc-800"
                    : "hover:bg-zinc-800/50"
                }`}
                title={tab.title || "shell"}
              >
                <span className={`${toneClass} text-[8px]`}>
                  &#9679;
                </span>
              </button>
            );
          })}
          <button
            onClick={() => send({ type: "create_tab" })}
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-800/50 hover:text-zinc-400"
            title="New Tab"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M5 1v8M1 5h8" />
            </svg>
          </button>
        </div>

        <div className="mt-auto flex flex-col items-center gap-1">
          {workspaces.map((ws) => (
            <div key={ws.id} className="group relative">
              <button
                onClick={() =>
                  send({
                    type: "select_workspace",
                    workspaceId: ws.id,
                  })
                }
                className={`flex h-6 w-6 items-center justify-center rounded text-[10px] font-medium transition-colors ${
                  ws.id === selectedWorkspaceId
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
                }`}
                title={ws.name}
              >
                {ws.name.charAt(0)}
              </button>
              {workspaces.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    send({
                      type: "delete_workspace",
                      workspaceId: ws.id,
                    });
                  }}
                  className="absolute -top-1 -right-1 hidden h-3 w-3 items-center justify-center rounded-full bg-zinc-600 text-zinc-200 hover:bg-red-500 group-hover:flex"
                  title={`Delete workspace ${ws.name}`}
                >
                  <svg
                    width="5"
                    height="5"
                    viewBox="0 0 6 6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M1 1l4 4M5 1l-4 4" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-52 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-zinc-800 px-2">
        <button
          onClick={toggleSidebar}
          className="flex h-7 w-7 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          title="Collapse sidebar (Cmd+B)"
        >
          <SidebarIcon />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {tabs.map((tab) => (
          <SidebarTabItem
            key={tab.id}
            tab={tab}
            isSelected={tab.id === selectedTabId}
            onSelect={() =>
              send({ type: "select_tab", tabId: tab.id })
            }
            onClose={(e) => {
              e.stopPropagation();
              send({ type: "close_tab", tabId: tab.id });
            }}
          />
        ))}
        <button
          onClick={() => send({ type: "create_tab" })}
          className="mx-1 mt-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-800/50 hover:text-zinc-300"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M6 2v8M2 6h8" />
          </svg>
          <span>New Tab</span>
        </button>
      </div>

      <div className="flex items-center gap-1 border-t border-zinc-800 px-2 py-2">
        {workspaces.map((ws) => (
          <WorkspacePill
            key={ws.id}
            id={ws.id}
            name={ws.name}
            isSelected={ws.id === selectedWorkspaceId}
            canDelete={workspaces.length > 1}
            onSelect={() =>
              send({
                type: "select_workspace",
                workspaceId: ws.id,
              })
            }
            onRename={(name) =>
              send({
                type: "rename_workspace",
                workspaceId: ws.id,
                name,
              })
            }
            onDelete={() =>
              send({
                type: "delete_workspace",
                workspaceId: ws.id,
              })
            }
          />
        ))}
        <button
          onClick={() => send({ type: "create_workspace" })}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          title="New workspace"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M5 1v8M1 5h8" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function SidebarTabItem({
  tab,
  isSelected,
  onSelect,
  onClose,
}: {
  tab: TabState;
  isSelected: boolean;
  onSelect: () => void;
  onClose: (e: React.MouseEvent) => void;
}) {
  const toneClass = TONE_COLORS[tab.tone] ?? "text-zinc-400";

  return (
    <button
      onClick={onSelect}
      className={`group mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors ${
        isSelected
          ? "bg-zinc-800 text-zinc-200"
          : "text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300"
      }`}
    >
      <span className={`${toneClass} shrink-0 text-[10px]`}>
        &#9679;
      </span>
      <span className="truncate">{tab.title || "shell"}</span>
      {tab.isDirty && (
        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
      )}
      <span
        onClick={onClose}
        className="ml-auto hidden shrink-0 rounded p-0.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300 group-hover:inline-block"
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M1 1l6 6M7 1l-6 6" />
        </svg>
      </span>
    </button>
  );
}

function WorkspacePill({
  name,
  isSelected,
  canDelete,
  onSelect,
  onRename,
  onDelete,
}: {
  id: string;
  name: string;
  isSelected: boolean;
  canDelete?: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete?: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);

  const handleDoubleClick = () => {
    setEditValue(name);
    setIsEditing(true);
  };

  const commitRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== name) {
      onRename(trimmed);
    }
    setIsEditing(false);
  };

  const label = name.charAt(0).toUpperCase();

  if (isEditing) {
    return (
      <input
        autoFocus
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitRename();
          if (e.key === "Escape") setIsEditing(false);
        }}
        className="h-7 w-16 rounded bg-zinc-800 px-1 text-center text-xs text-zinc-200 outline-none"
      />
    );
  }

  return (
    <div className="group relative shrink-0">
      <button
        onClick={onSelect}
        onDoubleClick={handleDoubleClick}
        title={name}
        className={`flex h-7 w-7 items-center justify-center rounded text-xs font-medium transition-colors ${
          isSelected
            ? "bg-zinc-700 text-zinc-100"
            : "bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
        }`}
      >
        {label}
      </button>
      {canDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.();
          }}
          className="absolute -top-1 -right-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-zinc-600 text-zinc-200 hover:bg-red-500 group-hover:flex"
          title={`Delete workspace ${name}`}
        >
          <svg
            width="6"
            height="6"
            viewBox="0 0 6 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M1 1l4 4M5 1l-4 4" />
          </svg>
        </button>
      )}
    </div>
  );
}
