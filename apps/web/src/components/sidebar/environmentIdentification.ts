import { useAtomValue } from "@effect/atom-react";

import { APP_STAGE_LABEL } from "../../branding";
import { resolveServerBackedAppStageLabel } from "../../branding.logic";
import { primaryServerConfigAtom } from "../../state/server";

type EnvironmentStageLabel = "Dev" | "Nightly";

function resolveEnvironmentStageLabel(stageLabel: string | null): EnvironmentStageLabel | null {
  const normalized = stageLabel?.trim().toLowerCase();
  if (normalized === "dev") return "Dev";
  if (normalized === "nightly") return "Nightly";
  return null;
}

export function useEnvironmentStageLabel(): EnvironmentStageLabel | null {
  const primaryServerVersion =
    useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;
  return resolveEnvironmentStageLabel(
    resolveServerBackedAppStageLabel({
      primaryServerVersion,
      fallbackStageLabel: APP_STAGE_LABEL,
    }),
  );
}
