import { SIDE_PULSE_EFFECTS } from "@supaterm/contracts";

import type { SettingsSearchItem } from "../settings/settingsSearch";

export const SIDE_PULSE_SETTINGS_SEARCH_ITEMS = [
  {
    id: "sidepulse-enabled",
    title: "SidePulse",
    to: "/settings/sidepulse",
    searchTerms: [
      "sidepulse pro led light status indicator hardware device sd card usb agents running",
    ],
  },
  {
    id: "sidepulse-brightness",
    title: "Brightness",
    to: "/settings/sidepulse",
    searchTerms: ["sidepulse led lights dim"],
  },
  {
    id: "sidepulse-effects",
    title: "Light effects",
    to: "/settings/sidepulse",
    searchTerms: ["sidepulse led lights animation", SIDE_PULSE_EFFECTS.join(" ")],
    targetId: "sidepulse-lights",
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
