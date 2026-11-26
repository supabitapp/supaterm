import {
  automaticTranscriptionProvider,
  disallowedProviderMessage,
  isManagedDriverAllowed,
  type ManagedPolicySummary,
  type ProviderInstanceId,
  type ServerProvider,
} from "@supaterm/contracts";

interface VoiceTranscriptionChoice {
  readonly provider: ServerProvider;
  readonly denial: string | undefined;
}

export function voiceTranscriptionChoices(
  providers: ReadonlyArray<ServerProvider>,
  policy: ManagedPolicySummary | undefined,
  chosen: ProviderInstanceId | null,
) {
  const transcribers = providers.filter((provider) => provider.transcription !== undefined);
  const allowed = (provider: ServerProvider) => isManagedDriverAllowed(policy, provider.driver);
  return {
    automatic: automaticTranscriptionProvider(transcribers.filter(allowed)),
    choices: transcribers.flatMap((provider): ReadonlyArray<VoiceTranscriptionChoice> => {
      if (allowed(provider)) return [{ provider, denial: undefined }];
      if (provider.instanceId !== chosen) return [];
      const label = provider.displayName ?? provider.instanceId;
      return [{ provider, denial: disallowedProviderMessage(policy?.organization, label) }];
    }),
  };
}
