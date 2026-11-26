import { EraserIcon } from "@supaterm/icons";

import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { msg } from "gt-react";

/** Shown while `/clear` is armed; dismissing it keeps the current conversation. */
export function freshSessionBannerItem(onUndo: () => void): ComposerBannerStackItem {
  return {
    id: "fresh-session",
    variant: "info",
    icon: <EraserIcon />,
    title: msg("Your next message starts a fresh session"),
    description: msg("The agent won't see earlier messages in this thread."),
    dismissLabel: msg("Keep the current session"),
    onDismiss: onUndo,
  };
}
