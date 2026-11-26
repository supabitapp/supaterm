import { msg } from "gt-react";

import type { SettingsSearchItem } from "../settings/settingsSearch";

export const CODEX_MICRO_SETTINGS_SEARCH_ITEMS = [
  {
    id: "codex-micro-enabled",
    // oxlint-disable-next-line supaterm/no-untranslated-copy -- product name
    title: "Codex Micro",
    to: "/settings/codex-micro",
    searchTerms: [
      msg(
        "keyboard macro keypad hardware device enable connect usb bluetooth battery firmware creator micro 2 work louder keymap",
      ),
    ],
  },
  {
    id: "codex-micro-input-monitoring",
    title: msg("Input Monitoring"),
    to: "/settings/codex-micro",
    searchTerms: [msg("codex micro keyboard permission privacy key presses")],
    macOnly: true,
  },
  {
    id: "codex-micro-brightness",
    title: msg("Brightness"),
    to: "/settings/codex-micro",
    searchTerms: [msg("codex micro keyboard lighting lights")],
  },
  {
    id: "codex-micro-auto-dim",
    title: msg("Auto-dim"),
    to: "/settings/codex-micro",
    searchTerms: [msg("codex micro keyboard lighting lights inactivity idle timeout")],
  },
  {
    id: "codex-micro-layout",
    title: msg("Layout"),
    to: "/settings/codex-micro",
    searchTerms: [msg("codex micro keyboard keycaps keys analog stick joystick knob reset assign")],
  },
  {
    id: "codex-micro-agent-keys",
    title: msg("Agent keys"),
    to: "/settings/codex-micro",
    searchTerms: [
      msg(
        "codex micro keyboard threads sidebar order jump shortcuts pinned needs attention custom assignments",
      ),
    ],
  },
  {
    id: "codex-micro-knob",
    title: msg("Knob"),
    to: "/settings/codex-micro",
    searchTerms: [msg("codex micro keyboard encoder dial scroll conversation reasoning effort")],
  },
  {
    id: "codex-micro-separate-microphone-keys",
    title: msg("Use separate microphone keys"),
    to: "/settings/codex-micro",
    searchTerms: [msg("codex micro keyboard mic wide key switches")],
  },
  {
    id: "codex-micro-single-tap-focus",
    title: msg("Focus Supaterm with a single tap"),
    to: "/settings/codex-micro",
    searchTerms: [msg("codex micro keyboard agent key double tap bring window to front")],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
