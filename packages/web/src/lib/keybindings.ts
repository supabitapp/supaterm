import { useConnectionStore } from "../stores/connection-store.js";
import { useWorkspaceStore } from "../stores/workspace-store.js";
import { useSettingsStore } from "../stores/settings-store.js";

interface Binding {
  key: string;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
}

function getBindings(): Binding[] {
  const send = useConnectionStore.getState().send;

  return [
    // Tabs
    {
      key: "t",
      meta: true,
      action: () => send({ type: "create_tab" }),
    },
    {
      key: "w",
      meta: true,
      action: () => {
        const { selectedTabId, focusedPaneByTab } = useWorkspaceStore.getState();
        if (!selectedTabId) return;
        const paneId = focusedPaneByTab[selectedTabId];
        if (paneId) send({ type: "close_pane", paneId });
      },
    },
    {
      key: "w",
      meta: true,
      shift: true,
      action: () => {
        const { selectedTabId } = useWorkspaceStore.getState();
        if (selectedTabId) send({ type: "close_tab", tabId: selectedTabId });
      },
    },
    {
      key: "]",
      meta: true,
      action: () => send({ type: "next_tab" }),
    },
    {
      key: "[",
      meta: true,
      action: () => send({ type: "previous_tab" }),
    },
    // Splits
    {
      key: "d",
      meta: true,
      action: () => {
        const { selectedTabId } = useWorkspaceStore.getState();
        if (selectedTabId) {
          send({
            type: "create_pane",
            tabId: selectedTabId,
            direction: "right",
          });
        }
      },
    },
    {
      key: "d",
      meta: true,
      shift: true,
      action: () => {
        const { selectedTabId } = useWorkspaceStore.getState();
        if (selectedTabId) {
          send({
            type: "create_pane",
            tabId: selectedTabId,
            direction: "down",
          });
        }
      },
    },
    // Zoom
    {
      key: "Enter",
      meta: true,
      shift: true,
      action: () => {
        const { selectedTabId } = useWorkspaceStore.getState();
        if (selectedTabId) send({ type: "toggle_zoom", tabId: selectedTabId });
      },
    },
    // Equalize
    {
      key: "=",
      meta: true,
      shift: true,
      action: () => {
        const { selectedTabId } = useWorkspaceStore.getState();
        if (selectedTabId) {
          send({ type: "equalize_panes", tabId: selectedTabId });
        }
      },
    },
    // Tab slots 1-9
    ...Array.from({ length: 9 }, (_, i) => ({
      key: String(i + 1),
      meta: true,
      action: () => send({ type: "select_tab_slot", slot: i }),
    })),
    // Sidebar
    {
      key: "b",
      meta: true,
      action: () => useSettingsStore.getState().toggleSidebar(),
    },
    // Command palette
    {
      key: "k",
      meta: true,
      action: () => {
        const settings = useSettingsStore.getState();
        settings.setCommandPaletteOpen(!settings.isCommandPaletteOpen);
      },
    },
    // Connect to Remote
    {
      key: "r",
      meta: true,
      shift: true,
      action: () => {
        useSettingsStore.getState().setConnectionDialogOpen(true);
      },
    },
  ];
}

function matchesBinding(e: KeyboardEvent, b: Binding): boolean {
  if (e.key.toLowerCase() !== b.key.toLowerCase() && e.key !== b.key)
    return false;
  if ((b.meta ?? false) !== e.metaKey) return false;
  if ((b.shift ?? false) !== e.shiftKey) return false;
  if ((b.alt ?? false) !== e.altKey) return false;
  return true;
}

let installed = false;

export function installKeybindings(): () => void {
  if (installed) return () => {};
  installed = true;

  const bindings = getBindings();

  const handler = (e: KeyboardEvent) => {
    if (!e.metaKey) return;

    for (const binding of bindings) {
      if (matchesBinding(e, binding)) {
        e.preventDefault();
        e.stopPropagation();
        binding.action();
        return;
      }
    }
  };

  document.addEventListener("keydown", handler, true);
  return () => {
    installed = false;
    document.removeEventListener("keydown", handler, true);
  };
}
