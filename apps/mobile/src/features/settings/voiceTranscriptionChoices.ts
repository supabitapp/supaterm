import {
  automaticTranscriptionProvider,
  isManagedDriverAllowed,
  type ManagedPolicySummary,
  type ProviderInstanceId,
  type ServerProvider,
} from "@supaterm/contracts";
import { disallowedProviderMessage } from "@supaterm/client-runtime/contract-labels";

import { m, type MessageResolver } from "../../i18n/messages";

interface VoiceTranscriptionChoice {
  readonly provider: ServerProvider;
  readonly denial: string | undefined;
}

export function voiceTranscriptionChoices(
  providers: ReadonlyArray<ServerProvider>,
  policy: ManagedPolicySummary | undefined,
  chosen: ProviderInstanceId | null,
  resolve: MessageResolver = m,
) {
  const transcribers = providers.filter((provider) => provider.transcription !== undefined);
  const allowed = (provider: ServerProvider) => isManagedDriverAllowed(policy, provider.driver);
  return {
    automatic: automaticTranscriptionProvider(transcribers.filter(allowed)),
    choices: transcribers.flatMap((provider): ReadonlyArray<VoiceTranscriptionChoice> => {
      if (allowed(provider)) return [{ provider, denial: undefined }];
      if (provider.instanceId !== chosen) return [];
      const label = provider.displayName ?? provider.instanceId;
      return [
        { provider, denial: disallowedProviderMessage(policy?.organization, label, resolve) },
      ];
    }),
  };
}
