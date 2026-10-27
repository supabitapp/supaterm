import type { KeybindingCommand } from "@supaterm/contracts";
import type { AnyRouter } from "@tanstack/react-router";

import { registerAppCommandHandler } from "../appCommandBus";
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
import { type CommandHandlers, type CommandScopeOptions, registerCommands } from "./dispatcher";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { resolveThreadRouteTarget } from "../threadRoutes";

function consume(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

// Shortcuts that open a page work from anywhere the palette is mounted.
const PAGE_BY_COMMAND = {
  "usage.open": "/usage",
  "automations.open": "/automations",
} as const;

const PALETTE_COMMANDS = [
  "appearance.cycle",
  "theme.select",
  "themeEditor.toggle",
  "usage.open",
  "automations.open",
  "commandPalette.toggle",
  "filePicker.toggle",
  "projectSearch.toggle",
] as const satisfies ReadonlyArray<KeybindingCommand>;

/** Returns false when the command is not a palette command. */
function runCommandPaletteCommand(
  router: AnyRouter,
  command: KeybindingCommand,
  repeat: boolean,
): boolean {
  switch (command) {
    case "appearance.cycle": {
      if (repeat) return true;
      const { appearanceMode } = getThemeSnapshot();
      const nextMode =
        appearanceMode === "system" ? "light" : appearanceMode === "light" ? "dark" : "system";
      if (!setAppearanceMode(nextMode)) {
        notifyThemeSaveFailure();
        return true;
      }
      toastManager.add({
        id: "appearance-cycle",
        title: `Appearance: ${APPEARANCE_OPTIONS.find((option) => option.mode === nextMode)?.label}`,
        timeout: 1500,
      });
      return true;
    }
    case "theme.select":
      if (!repeat) dispatchCommandPalette({ _tag: "OpenChangeTheme" });
      return true;
    case "themeEditor.toggle": {
      const { theme, themeHalves, resolvedTheme } = getThemeSnapshot();
      toggleThemeEditorForTheme({ theme, themeHalves, initialAppearance: resolvedTheme });
      return true;
    }
    case "usage.open":
    case "automations.open":
      dispatchCommandPalette({ _tag: "SetOpen", open: false });
      void router.navigate({ to: PAGE_BY_COMMAND[command] });
      return true;
    default: {
      const mode = overlayModeForCommand(command);
      if (mode === null) return false;
      dispatchCommandPalette({ _tag: "ToggleMode", mode });
      return true;
    }
  }
}

/**
 * Palette, theme and page shortcuts. They read the route, panels and theme
 * when the key is pressed, and are live only while the palette is mounted.
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
        if (event.isComposing || event.key !== "Escape") return false;
        const { open, mode } = useCommandPaletteStore.getState();
        if (!open || mode === "command") return false;
        consume(event);
        dispatchCommandPalette({ _tag: "BackToCommand" });
      },
    },
  );

  const handlers: CommandHandlers = Object.fromEntries(
    PALETTE_COMMANDS.map((command) => [
      command,
      (event: KeyboardEvent) => {
        if (!runCommandPaletteCommand(router, command, event.repeat)) return false;
        consume(event);
      },
    ]),
  );
  const disposeCommands = registerCommands(handlers, {
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
  });

  // Commands that arrive without a key press, such as from a connected device.
  const disposeAppCommands = registerAppCommandHandler(
    (command) => isCommandPaletteMounted() && runCommandPaletteCommand(router, command, false),
  );

  return () => {
    disposeEscape();
    disposeCommands();
    disposeAppCommands();
  };
}
