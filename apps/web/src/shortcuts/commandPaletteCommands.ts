import type { AnyRouter } from "@tanstack/react-router";

import {
  dispatchCommandPalette,
  isCommandPaletteMounted,
  useCommandPaletteStore,
} from "../commandPaletteStore";
import { overlayModeForCommand } from "../components/CommandPalette.logic";
import { APPEARANCE_OPTIONS, notifyThemeSaveFailure } from "../components/CommandPaletteThemeItems";
import { toggleThemeEditorForTheme } from "../components/settings/themeEditorStore";
import { toastManager } from "../components/ui/toast";
import { getThemeSnapshot, setAppearanceMode } from "../hooks/useTheme";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { type CommandHandler, type CommandScopeOptions, registerCommands } from "./dispatcher";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { resolveThreadRouteTarget } from "../threadRoutes";

const toggleOverlay =
  (command: Parameters<typeof overlayModeForCommand>[0]): CommandHandler =>
  () => {
    const mode = overlayModeForCommand(command);
    if (mode === null) return false;
    dispatchCommandPalette({ _tag: "ToggleMode", mode });
  };

/**
 * Palette, theme and page commands. They read the route, panels and theme
 * when they run, and are live only while the palette is mounted.
 */
export function installCommandPaletteCommands(
  router: AnyRouter,
  options: Pick<CommandScopeOptions, "keybindings"> = {},
): () => void {
  const readRouteThreadRef = () => {
    const target = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
    return target?.kind === "server" ? target.threadRef : null;
  };

  // A child search (files, contents) goes back to the palette on Escape before
  // its own widgets or the dialog can treat the key as a close.
  const disposeEscape = registerCommands(
    {},
    {
      capture: true,
      when: isCommandPaletteMounted,
      onKeyDown: (event) => {
        if (event.isComposing || event.keyCode === 229 || event.key !== "Escape") return false;
        const { open, mode } = useCommandPaletteStore.getState();
        if (!open || mode === "command") return false;
        event.preventDefault();
        event.stopPropagation();
        dispatchCommandPalette({ _tag: "BackToCommand" });
      },
    },
  );

  const openPage =
    (to: "/usage" | "/automations"): CommandHandler =>
    () => {
      dispatchCommandPalette({ _tag: "SetOpen", open: false });
      void router.navigate({ to });
    };

  const disposeCommands = registerCommands(
    {
      "appearance.cycle": ({ repeat }) => {
        if (repeat) return;
        const { appearanceMode } = getThemeSnapshot();
        const nextMode =
          appearanceMode === "system" ? "light" : appearanceMode === "light" ? "dark" : "system";
        if (!setAppearanceMode(nextMode)) {
          notifyThemeSaveFailure();
          return;
        }
        toastManager.add({
          id: "appearance-cycle",
          title: `Appearance: ${APPEARANCE_OPTIONS.find((option) => option.mode === nextMode)?.label}`,
          timeout: 1500,
        });
      },
      "theme.select": ({ repeat }) => {
        if (repeat) return;
        dispatchCommandPalette({ _tag: "OpenChangeTheme" });
      },
      "themeEditor.toggle": () => {
        const { theme, themeHalves, resolvedTheme } = getThemeSnapshot();
        toggleThemeEditorForTheme({ theme, themeHalves, initialAppearance: resolvedTheme });
      },
      "usage.open": openPage("/usage"),
      "automations.open": openPage("/automations"),
      "commandPalette.toggle": toggleOverlay("commandPalette.toggle"),
      "filePicker.toggle": toggleOverlay("filePicker.toggle"),
      "projectSearch.toggle": toggleOverlay("projectSearch.toggle"),
    },
    {
      ...options,
      when: isCommandPaletteMounted,
      context: () => {
        const threadRef = readRouteThreadRef();
        return {
          terminalOpen: threadRef
            ? selectThreadTerminalUiState(
                useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
                threadRef,
              ).terminalOpen
            : false,
          previewOpen: threadRef
            ? selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, threadRef) ===
              "preview"
            : false,
          usagePageOpen: router.state.location.pathname === "/usage",
        };
      },
    },
  );

  return () => {
    disposeEscape();
    disposeCommands();
  };
}
