import type { ModelSelection, OrchestrationV2ProviderCapabilities } from "@supaterm/contracts";

export interface ProviderSelectionTransitionInput {
  readonly current: ModelSelection;
  readonly target: ModelSelection;
  readonly sessionCapabilities: OrchestrationV2ProviderCapabilities;
}

export type ProviderSelectionTransitionPlan =
  | { readonly type: "apply_on_next_turn" }
  | { readonly type: "restart_session" }
  | { readonly type: "create_with_handoff" }
  | { readonly type: "reject"; readonly reason: string };

export function turnScopedSelectionTransition() {
  return { type: "apply_on_next_turn" } satisfies ProviderSelectionTransitionPlan;
}

export function acpSelectionTransition(input: ProviderSelectionTransitionInput) {
  if (
    input.current.model !== input.target.model &&
    !input.sessionCapabilities.sessions.supportsModelSwitchInSession
  ) {
    return {
      type: "reject",
      reason: "The active ACP session does not expose a model-switch capability.",
    } satisfies ProviderSelectionTransitionPlan;
  }
  return { type: "apply_on_next_turn" } satisfies ProviderSelectionTransitionPlan;
}
