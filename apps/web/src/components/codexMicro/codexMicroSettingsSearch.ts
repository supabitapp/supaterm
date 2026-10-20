import type { SettingsSearchItem } from "../settings/settingsSearch";

export const CODEX_MICRO_SETTINGS_SEARCH_ITEMS = [
  {
    id: "codex-micro-enabled",
    title: "Codex Micro",
    to: "/settings/codex-micro",
    searchTerms: [
      "keyboard macro keypad hardware device enable connect usb bluetooth battery firmware",
    ],
  },
  {
    id: "codex-micro-input-monitoring",
    title: "Input Monitoring",
    to: "/settings/codex-micro",
    searchTerms: ["codex micro keyboard permission privacy key presses"],
    macOnly: true,
  },
  {
    id: "codex-micro-brightness",
    title: "Brightness",
    to: "/settings/codex-micro",
    searchTerms: ["codex micro keyboard lighting lights"],
  },
  {
    id: "codex-micro-auto-dim",
    title: "Auto-dim",
    to: "/settings/codex-micro",
    searchTerms: ["codex micro keyboard lighting lights inactivity idle timeout"],
  },
  {
    id: "codex-micro-layout",
    title: "Layout",
    to: "/settings/codex-micro",
    searchTerms: ["codex micro keyboard keycaps keys analog stick joystick knob reset assign"],
  },
  {
    id: "codex-micro-agent-keys",
    title: "Agent keys",
    to: "/settings/codex-micro",
    searchTerms: ["codex micro keyboard threads pinned recent needs attention custom assignments"],
  },
  {
    id: "codex-micro-knob",
    title: "Knob",
    to: "/settings/codex-micro",
    searchTerms: ["codex micro keyboard encoder dial scroll conversation reasoning effort"],
  },
  {
    id: "codex-micro-separate-microphone-keys",
    title: "Use separate microphone keys",
    to: "/settings/codex-micro",
    searchTerms: ["codex micro keyboard mic wide key switches"],
  },
  {
    id: "codex-micro-single-tap-focus",
    title: "Focus Supaterm with a single tap",
    to: "/settings/codex-micro",
    searchTerms: ["codex micro keyboard agent key double tap bring window to front"],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
