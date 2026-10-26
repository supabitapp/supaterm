import { useAtomValue } from "@effect/atom-react";

import { APP_STAGE_LABEL } from "../../branding";
import { resolveServerBackedAppStageLabel } from "../../branding.logic";
import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { primaryServerConfigAtom } from "../../state/server";

type EnvironmentIdentificationPillLabel = "Dev" | "Nightly";

function resolveEnvironmentIdentificationPillLabel(
  stageLabel: string | null,
): EnvironmentIdentificationPillLabel | null {
  const normalized = stageLabel?.trim().toLowerCase();
  if (normalized === "dev") return "Dev";
  if (normalized === "nightly") return "Nightly";
  return null;
}

export function useEnvironmentIdentificationPillLabel(): EnvironmentIdentificationPillLabel | null {
  const mode = useEnvironmentIdentificationMode();
  const primaryServerVersion =
    useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;
  if (mode !== "pill") return null;
  return resolveEnvironmentIdentificationPillLabel(
    resolveServerBackedAppStageLabel({
      primaryServerVersion,
      fallbackStageLabel: APP_STAGE_LABEL,
    }),
  );
}
