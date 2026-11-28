import { useRef, useState } from "react";
import { TextInput, View } from "react-native";

import type { ComposerEditorSelection } from "../../components/ComposerEditor";
import { ComposerActionButton } from "../../components/ComposerToolbar";
import { AppText as Text } from "../../components/ui/AppText";
import {
  ComposerDictationCancelAction,
  ComposerDictationError,
  ComposerDictationPrimaryAction,
  ComposerDictationStartAction,
  ComposerDictationStatus,
  ComposerDictationToolbar,
} from "../voice-input/ComposerDictationControl";
import { useVoiceInputController } from "../voice-input/useVoiceInputController";
import { resolveVoiceComposerPresentation } from "../voice-input/voiceInputPresentation";
import { useGT, useMessages } from "gt-react-native";

const COMPOSER_BOTTOM_GUTTER = 8;

/**
 * The comment box at the foot of an issue: a field that grows with the draft, dictation, and a
 * round send button. `blocked` replaces the field with the reason.
 */
export function IssueCommentComposer(props: {
  /** Names this draft to dictation, so a recording started here lands here. */
  readonly ownerKey: string;
  readonly label: string;
  readonly blocked: string | null;
  readonly posting: boolean;
  readonly bottomInset: number;
  readonly contentMaxWidth?: number;
  /** Resolves true once the comment is posted, which clears the draft. */
  readonly onSubmit: (body: string) => Promise<boolean>;
  readonly onHeightChange: (height: number) => void;
  readonly onFocusChange: (focused: boolean) => void;
}) {
  const messages = useMessages();
  const gt = useGT();
  const [draft, setDraft] = useState("");
  // Read by dictation and by send after an await, when the render's `draft` may be stale.
  const latestDraft = useRef(draft);
  const changeDraft = (text: string) => {
    latestDraft.current = text;
    setDraft(text);
  };
  const [selection, setSelection] = useState<ComposerEditorSelection>({ start: 0, end: 0 });
  const voice = useVoiceInputController({
    ownerKey: props.ownerKey,
    label: props.label,
    readDraftMessage: () => latestDraft.current,
    selection,
    disabled: props.blocked !== null,
    hidden: props.blocked !== null,
    onChangeDraftMessage: changeDraft,
    onChangeSelection: setSelection,
  });
  const presentation = resolveVoiceComposerPresentation(
    voice.state,
    voice.elapsedSeconds,
    messages,
  );
  const showsDictation = presentation.statusKind === "active";
  const canSend =
    props.blocked === null && !props.posting && !voice.blocksSubmission && draft.trim().length > 0;

  const sending = useRef(false);
  const send = () => {
    if (!canSend || sending.current) return;
    sending.current = true;
    const submitted = latestDraft.current;
    void props.onSubmit(submitted).then((posted) => {
      sending.current = false;
      if (posted && latestDraft.current === submitted) changeDraft("");
    });
  };

  return (
    <View
      onLayout={(event) => props.onHeightChange(event.nativeEvent.layout.height)}
      className="px-[12px]"
      style={{ paddingTop: 6, paddingBottom: props.bottomInset + COMPOSER_BOTTOM_GUTTER }}
    >
      <View
        className="w-full gap-2 self-center rounded-[24px] border border-border-subtle bg-card px-3 py-1.5"
        style={
          props.contentMaxWidth === undefined ? undefined : { maxWidth: props.contentMaxWidth }
        }
      >
        {props.blocked !== null ? (
          <Text selectable className="px-1 py-2.5 text-sm text-foreground-muted">
            {props.blocked}
          </Text>
        ) : (
          <View className="flex-row items-end">
            <TextInput
              accessibilityLabel={gt("Add a comment")}
              value={draft}
              onChangeText={changeDraft}
              selection={selection}
              onSelectionChange={({ nativeEvent }) => setSelection(nativeEvent.selection)}
              onFocus={() => props.onFocusChange(true)}
              onBlur={() => props.onFocusChange(false)}
              readOnly={props.posting || voice.freezesEditor}
              multiline
              scrollEnabled
              textAlignVertical="top"
              placeholder={gt("Leave a comment")}
              placeholderTextColorClassName="accent-foreground-muted"
              className="max-h-40 min-h-11 min-w-0 flex-1 py-2.5 font-sans text-base text-foreground"
            />
            {voice.isAvailable && !showsDictation ? (
              <ComposerDictationStartAction
                state={voice.state}
                isAvailable={voice.isAvailable}
                disabled={props.posting}
                onStart={voice.start}
                onCancel={voice.cancel}
              />
            ) : null}
            <ComposerActionButton
              accessibilityLabel={props.posting ? gt("Posting comment") : gt("Post comment")}
              icon="arrow.up"
              variant="primary"
              disabled={!canSend}
              onPress={send}
            />
          </View>
        )}
        {props.blocked === null ? (
          <ComposerDictationError
            error={voice.state.phase === "error" ? voice.state.error : null}
            onDismiss={voice.cancel}
          />
        ) : null}
        {showsDictation ? (
          <ComposerDictationToolbar showsDictation>
            <View className="h-11 flex-row items-center">
              <ComposerDictationCancelAction presentation={presentation} onCancel={voice.cancel} />
              <ComposerDictationStatus
                audioLevels={voice.audioLevels}
                elapsedSeconds={voice.elapsedSeconds}
                phase={voice.state.phase}
                presentation={presentation}
              />
              <ComposerDictationPrimaryAction
                state={voice.state}
                presentation={presentation}
                isAvailable={voice.isAvailable}
                disabled={props.blocked !== null}
                onStart={voice.start}
                onConfirm={voice.stop}
                onCancel={voice.cancel}
              />
            </View>
          </ComposerDictationToolbar>
        ) : null}
      </View>
    </View>
  );
}
