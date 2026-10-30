import type { V2TurnStartParams__AdditionalContextEntry } from "effect-codex-app-server/schema";
import { buildRuntimeInstructions } from "@supaterm/provider-core/server/runtimeInstructions";

import {
  SUPATERM_BROWSER_TOOL_INSTRUCTIONS,
  SUPATERM_DEVICE_TOOL_INSTRUCTIONS,
  SUPATERM_ORCHESTRATION_SECTIONS,
} from "@supaterm/provider-core/server/orchestrationInstructions";

export const CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES = 4_000;

export interface SupatermToolAvailability {
  readonly browser: boolean;
  readonly device: boolean;
}

const normalizeAvailability = (
  availability: boolean | SupatermToolAvailability,
): SupatermToolAvailability =>
  typeof availability === "boolean" ? { browser: availability, device: false } : availability;

/**
 * Describing `preview_*` or `device_*` tools that aren't in the turn's tool list would be worse
 * than saying nothing: the instructions actively steer the model away from Playwright,
 * agent-browser, and raw simctl/adb, so leaving them in would talk it out of the only automation
 * it still has.
 */
const toolInstructions = (availability: boolean | SupatermToolAvailability): string => {
  const tools = normalizeAvailability(availability);
  return [
    tools.browser ? SUPATERM_BROWSER_TOOL_INSTRUCTIONS : "",
    tools.device ? SUPATERM_DEVICE_TOOL_INSTRUCTIONS : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

export interface CodexRuntimeInfo {
  readonly model: string;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}

export function buildCodexAdditionalContext(
  runtime: CodexRuntimeInfo,
  toolsAvailable: boolean | SupatermToolAvailability = true,
): Record<string, V2TurnStartParams__AdditionalContextEntry> {
  const tools = toolInstructions(toolsAvailable);

  return {
    ...Object.fromEntries(
      SUPATERM_ORCHESTRATION_SECTIONS.map((section, index) => [
        `supaterm_orchestration_${String(index + 1).padStart(2, "0")}`,
        { kind: "application" as const, value: section },
      ]),
    ),
    supaterm_runtime: {
      kind: "application",
      value: buildRuntimeInstructions({ harness: "Codex", ...runtime }),
    },
    ...(tools ? { supaterm_tools: { kind: "application", value: tools } } : {}),
  };
}
