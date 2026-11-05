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
] as const satisfies ReadonlyArray<SettingsSearchItem>;
