import { create } from "zustand";

interface SettingsStore {
  isSidebarCollapsed: boolean;
  isCommandPaletteOpen: boolean;
  isConnectionDialogOpen: boolean;

  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setConnectionDialogOpen: (open: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  isSidebarCollapsed: false,
  isCommandPaletteOpen: false,
  isConnectionDialogOpen: false,

  toggleSidebar: () =>
    set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed })),
  setSidebarCollapsed: (collapsed) =>
    set({ isSidebarCollapsed: collapsed }),
  setCommandPaletteOpen: (open) =>
    set({ isCommandPaletteOpen: open }),
  setConnectionDialogOpen: (open) =>
    set({ isConnectionDialogOpen: open }),
}));
