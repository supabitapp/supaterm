import type { CodexMicroSettings } from "@supaterm/contracts";

import { updateClientSettings } from "../../hooks/useSettings";

/** Merges into the latest saved settings, so quick successive writes keep each other's fields. */
export function updateCodexMicroSettings(patch: Partial<CodexMicroSettings>): Promise<void> {
  return updateClientSettings((current) => ({ codexMicro: { ...current.codexMicro, ...patch } }));
}
