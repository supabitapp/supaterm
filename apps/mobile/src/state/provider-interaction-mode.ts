import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ProviderInteractionMode,
  type ServerProvider,
} from "@supaterm/contracts";

type InteractionModeProvider = Pick<ServerProvider, "showInteractionModeToggle">;

export function resolveProviderInteractionMode(
  provider: InteractionModeProvider | null | undefined,
  interactionMode: ProviderInteractionMode | null | undefined,
) {
  return provider?.showInteractionModeToggle === false
    ? DEFAULT_PROVIDER_INTERACTION_MODE
    : (interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE);
}
