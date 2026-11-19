import { View } from "react-native";

import {
  ComposerDictationLeadingAction,
  ComposerDictationPrimaryAction,
  ComposerDictationStatus,
  ComposerDictationToolbar,
} from "./ComposerDictationControl";
import type { useVoiceInputController } from "./useVoiceInputController";
import type { VoiceComposerPresentation } from "./voiceInputPresentation";

export function TextFieldDictationToolbar(props: {
  readonly voiceInput: ReturnType<typeof useVoiceInputController>;
  readonly presentation: VoiceComposerPresentation;
  readonly disabled: boolean;
}) {
  const voice = props.voiceInput;
  const presentation = props.presentation;
  return (
    <ComposerDictationToolbar statusKind={presentation.statusKind}>
      <View className="h-full flex-row items-center gap-2">
        <ComposerDictationLeadingAction
          presentation={presentation}
          onStop={voice.stop}
          onCancel={voice.cancel}
        />
        <ComposerDictationStatus
          audioLevels={voice.audioLevels}
          elapsedSeconds={voice.elapsedSeconds}
          phase={voice.state.phase}
          presentation={presentation}
          onDismissError={voice.cancel}
        />
        <ComposerDictationPrimaryAction
          state={voice.state}
          presentation={presentation}
          isAvailable={voice.isAvailable}
          disabled={props.disabled}
          onStart={voice.start}
          onConfirm={voice.stop}
          onCancel={voice.cancel}
        />
      </View>
    </ComposerDictationToolbar>
  );
}
