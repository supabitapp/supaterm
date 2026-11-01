import { buildRemoteOpenUrl, type EditorId, type EnvironmentId } from "@supaterm/contracts";
import { useEffect, useEffectEvent } from "react";

import { usePreferredEditor } from "../../editorPreferences";
import { editorLabelForPlatform } from "../../editorLabels";
import { announce } from "../../lib/announce";
import { openRemoteEditorUrl, useRemoteCapableEditors, useRemoteOpenState } from "../../remoteOpen";
import { registerCommands } from "../../shortcuts/dispatcher";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { usePaneInputOwner } from "../../chatPanes/paneScope";

/** Marks an OpenInPicker's primary button as the target of `editor.openFavorite`. */
export const OPEN_FAVORITE_EDITOR_ATTRIBUTE = "data-open-favorite-editor";

/**
 * `editor.openFavorite` presses the marked OpenInPicker primary button, so the shortcut opens
 * exactly what the button on screen would. A missing or disabled button leaves the command to
 * the chat's fallback below. Capture phase, so a focused terminal does not swallow the chord.
 */
export function registerOpenFavoriteEditorCommand(): () => void {
  return registerCommands(
    {
      "editor.openFavorite": ({ repeat }) => {
        if (repeat) return false;
        const button = [
          ...document.querySelectorAll<HTMLButtonElement>(`[${OPEN_FAVORITE_EDITOR_ATTRIBUTE}]`),
        ].at(-1);
        if (button === undefined || button.disabled) return false;
        button.click();
      },
    },
    { capture: true },
  );
}

export function useOpenFavoriteEditorShortcut({
  enabled,
  environmentId,
  availableEditors,
  openInCwd,
}: {
  enabled: boolean;
  environmentId: EnvironmentId;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
}) {
  const openInEditorMutation = useAtomCommand(shellEnvironment.openInEditor, "open in editor");
  const remote = useRemoteOpenState(environmentId);
  const remoteCapableEditors = useRemoteCapableEditors();
  // Matches the picker: remote editors run on the viewing machine.
  const [preferredEditor] = usePreferredEditor(
    remote.mode === "local-exec" ? availableEditors : remoteCapableEditors,
  );
  const isPaneInputOwner = usePaneInputOwner();

  const isLive = useEffectEvent(
    () => enabled && remote.mode !== "remote-unavailable" && isPaneInputOwner(),
  );
  const openFavorite = useEffectEvent((repeat: boolean) => {
    if (repeat || !openInCwd || !preferredEditor) return false;
    const label = editorLabelForPlatform(preferredEditor, navigator.platform);
    if (remote.mode === "remote-links") {
      const url = buildRemoteOpenUrl({
        editor: preferredEditor,
        ...remote.host,
        absolutePath: openInCwd,
      });
      if (url === undefined) return;
      void openRemoteEditorUrl(url).then((opened) => {
        if (opened) announce(`Opened in ${label}`);
      });
      return;
    }
    void openInEditorMutation({
      environmentId,
      input: {
        cwd: openInCwd,
        editor: preferredEditor,
      },
    }).then((result) => {
      if (result._tag === "Success") announce(`Opened in ${label}`);
    });
  });
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- registers the open-in-editor fallback with the dispatcher for the component's lifetime
  useEffect(
    () =>
      registerCommands(
        { "editor.openFavorite": ({ repeat }) => openFavorite(repeat) },
        { when: () => isLive() },
      ),
    [],
  );
}
