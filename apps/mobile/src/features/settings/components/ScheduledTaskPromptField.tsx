import { TextInput, View } from "react-native";

import { AppText as Text } from "../../../components/ui/AppText";
import type { ComposerEditorSelection } from "../../../components/ComposerEditor";
import { ComposerDictationStartAction } from "../../voice-input/ComposerDictationControl";
import { TextFieldDictationToolbar } from "../../voice-input/TextFieldDictationToolbar";
import type { useVoiceInputController } from "../../voice-input/useVoiceInputController";
import { resolveVoiceComposerPresentation } from "../../voice-input/voiceInputPresentation";

export function ScheduledTaskPromptField(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly selection: ComposerEditorSelection;
  readonly onChangeSelection: (selection: ComposerEditorSelection) => void;
  readonly disabled: boolean;
  readonly voiceInput: ReturnType<typeof useVoiceInputController>;
}) {
  const voice = props.voiceInput;
  const presentation = resolveVoiceComposerPresentation(voice.state, voice.elapsedSeconds);
  const showsDictation = presentation.statusLabel !== null;
  const showsIdleTrigger = voice.isAvailable && !showsDictation;

  return (
    <View className="gap-2 border-t border-border-subtle px-4 py-3">
      <Text className="text-sm text-foreground-muted">Prompt</Text>
      <View className="flex-row items-end">
        <TextInput
          accessibilityLabel="Prompt"
          value={props.value}
          onChangeText={props.onChange}
          selection={props.selection}
          onSelectionChange={({ nativeEvent }) => props.onChangeSelection(nativeEvent.selection)}
          readOnly={props.disabled || voice.freezesEditor}
          multiline
          scrollEnabled
          textAlignVertical="top"
          placeholder="What should the agent do each time?"
          placeholderTextColorClassName="accent-foreground-muted"
          className="max-h-40 min-h-24 min-w-0 flex-1 font-sans text-base text-foreground"
        />
        {showsIdleTrigger ? (
          <ComposerDictationStartAction
            state={voice.state}
            isAvailable={voice.isAvailable}
            disabled={props.disabled}
            onStart={voice.start}
            onCancel={voice.cancel}
          />
        ) : null}
      </View>
      {showsDictation ? (
        <TextFieldDictationToolbar
          voiceInput={voice}
          presentation={presentation}
          disabled={props.disabled}
        />
      ) : null}
    </View>
  );
}
