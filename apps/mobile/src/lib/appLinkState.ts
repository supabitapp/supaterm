import { getStateFromPath } from "@react-navigation/native";
import { pipe } from "effect/Function";

import { restoreDraftLinkState } from "./appLinking";
import { restoreSettingsLinkState } from "../features/settings/settings-navigation";
import { settingsLinkPage } from "../features/workspace/workspace-selection-store";
import { takeThreadPromptLink } from "../features/prompt-links/threadPromptLink";
import { takeNewTaskPromptLink } from "../features/prompt-links/newTaskPromptLink";
import { startDevAutoConnect, withoutPairingTarget } from "../features/connection/devAutoConnect";
import { takeScheduledTaskNewLink } from "../features/settings/scheduled-task-editor-state";

export function getAppStateFromPath(path: string, options: Parameters<typeof getStateFromPath>[1]) {
  return pipe(
    getStateFromPath(path, options),
    (state) => restoreDraftLinkState(state, path),
    (state) => restoreSettingsLinkState(state, settingsLinkPage()),
    takeThreadPromptLink,
    takeNewTaskPromptLink,
    withoutPairingTarget,
    startDevAutoConnect,
    takeScheduledTaskNewLink,
  );
}
