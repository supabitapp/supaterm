import type { CodexMicroSettings } from "@supaterm/contracts";

import { useUpdateClientSettings } from "../../hooks/useSettings";

/** Merges into the latest saved settings, so quick successive writes keep each other's fields. */
export function useUpdateCodexMicroSettings() {
  const updateClientSettings = useUpdateClientSettings();
  return (patch: Partial<CodexMicroSettings>) =>
    updateClientSettings((current) => ({ codexMicro: { ...current.codexMicro, ...patch } }));
}
