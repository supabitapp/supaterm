import { settlePromise, squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import * as Dialog from "../../components/ui/Dialog";
import { TextInputWrapper } from "expo-paste-input";
import { AppTextInput as TextInput } from "../../components/ui/AppText";
import { useNativePaste } from "../../lib/useNativePaste";
import {
  convertPastedImagesToAttachments,
  skippedDuplicateAttachmentsMessage,
} from "../../lib/composerImages";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS, type UserInputQuestion } from "@supaterm/contracts";
import { useAtomValue } from "@effect/atom-react";
import { View, type TextInputInstance } from "react-native";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { ComposerAttachmentButton } from "./ComposerAttachmentButton";
import { ComposerAttachmentStrip } from "../../components/ComposerAttachmentStrip";
import { pickComposerFiles, pickComposerMedia } from "../../lib/composerImages";
import { useThreadSelection } from "../../state/use-thread-selection";
import { useNavigation } from "@react-navigation/native";
import { FilePreviewModal, type FilePreviewSource } from "../../components/ui/FilePreviewModal";
import { VideoPreviewModal, type VideoPreviewSource } from "../../components/ui/VideoPreviewModal";
import { useServerConfigs } from "../../state/entities";
import { appAtomRegistry } from "../../state/atom-registry";
import {
  appendComposerDraftAttachments,
  composerDraftsAtom,
  removeComposerDraftAttachment,
  releaseUnusedComposerAttachmentFiles,
} from "../../state/use-composer-drafts";
import {
  changeQuestionAttachmentPreparation,
  questionAttachmentDraftKey,
  questionAttachmentPreparationAtom,
} from "../../state/question-attachments";
import type { ComposerEditorSelection } from "../../components/ComposerEditor";
import { ComposerDictationStartAction } from "../voice-input/ComposerDictationControl";
import { TextFieldDictationToolbar } from "../voice-input/TextFieldDictationToolbar";
import { useVoiceInputController } from "../voice-input/useVoiceInputController";
import { resolveVoiceComposerPresentation } from "../voice-input/voiceInputPresentation";
export function QuestionAttachments(props: {
  requestId: string;
  question: UserInputQuestion;
  questions: ReadonlyArray<UserInputQuestion>;
  disabled: boolean;
  value: string;
  onChangeText: (value: string) => void;
  onInputFocusChange?: ((focused: boolean) => void) | undefined;
  onStartDictation: () => void;
}) {
  const { selectedThread } = useThreadSelection();
  const navigation = useNavigation();
  const [previewFile, setPreviewFile] = useState<FilePreviewSource | null>(null);
  const [previewVideo, setPreviewVideo] = useState<VideoPreviewSource | null>(null);
  const configs = useServerConfigs();
  const drafts = useAtomValue(composerDraftsAtom);
  const focusedRef = useRef(false);
  const onInputFocusChange = props.onInputFocusChange;
  // The caller keys this component by request and question, so unmounting ends any open
  // picker's scope.
  const pickerScope = useRef<{ active: boolean }>({ active: false });
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- opens a scope that native picker and paste callbacks check, and closes it on unmount
  useEffect(() => {
    const scope = { active: true };
    pickerScope.current = scope;
    return () => {
      scope.active = false;
    };
  }, []);
  // Unmounted inputs never emit onBlur; explicitly release keyboard ownership.
  const releaseFocus = useEffectEvent(() => {
    if (focusedRef.current) onInputFocusChange?.(false);
  });
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- releases keyboard ownership on unmount, since an unmounted native input never emits blur
  useEffect(() => () => releaseFocus(), []);
  // A controlled value makes Fabric rebuild the native text on every keystroke, which discards
  // iOS's pending autocorrection. The input owns its text; the only outside write is an option
  // selection clearing the draft, and dictation remounting it with the transcript.
  const inputRef = useRef<TextInputInstance>(null);
  const [seed, setSeed] = useState({ text: props.value, revision: 0 });
  const nativeText = useRef(props.value);
  const [selection, setSelection] = useState<ComposerEditorSelection>({
    start: props.value.length,
    end: props.value.length,
  });
  const key = selectedThread
    ? questionAttachmentDraftKey(
        selectedThread.environmentId,
        selectedThread.id,
        props.requestId,
        props.question.id,
      )
    : null;
  const voice = useVoiceInputController({
    ownerKey: key,
    label: props.question.header,
    selection,
    readDraftMessage: () => nativeText.current,
    onChangeSelection: setSelection,
    onChangeDraftMessage: (text) => {
      nativeText.current = text;
      setSeed((current) => ({ text, revision: current.revision + 1 }));
      props.onChangeText(text);
    },
    disabled: props.disabled,
    environmentId: selectedThread?.environmentId ?? null,
    ...(selectedThread ? { context: { threadId: selectedThread.id } } : {}),
  });
  const voiceBusy = voice.isBusy;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- holds submit and paging, like a converting paste, while dictation records or transcribes into this answer
  useEffect(() => {
    if (!voiceBusy || key === null) return;
    changeQuestionAttachmentPreparation(key, 1);
    return () => changeQuestionAttachmentPreparation(key, -1);
  }, [voiceBusy, key]);
  const cancelOwnDictation = useEffectEvent(() => {
    if (voice.isBusy) voice.cancel();
  });
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- ends this answer's dictation when the question leaves, so its transcript never lands in a resolved draft
  useEffect(() => () => cancelOwnDictation(), []);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- pushes an option selection's cleared draft into the uncontrolled native input
  useEffect(() => {
    if (props.value !== "" || nativeText.current === "") return;
    nativeText.current = "";
    inputRef.current?.clear();
  }, [props.value]);
  const append = (
    key: string,
    attachments: Parameters<typeof appendComposerDraftAttachments>[1],
  ) => {
    if (!selectedThread) return [];
    const current = appAtomRegistry.get(composerDraftsAtom);
    const otherCount = props.questions.reduce((count, question) => {
      const target = questionAttachmentDraftKey(
        selectedThread.environmentId,
        selectedThread.id,
        props.requestId,
        question.id,
      );
      return target === key ? count : count + (current[target]?.attachments.length ?? 0);
    }, 0);
    const { rejected, duplicates } = appendComposerDraftAttachments(key, attachments, {
      maxAttachments: Math.max(0, PROVIDER_SEND_TURN_MAX_ATTACHMENTS - otherCount),
    });
    const skipped = skippedDuplicateAttachmentsMessage(duplicates);
    return [...(rejected > 0 ? ["Too many attachments."] : []), ...(skipped ? [skipped] : [])];
  };
  const paste = useNativePaste((uris) => {
    const scope = pickerScope.current;
    if (!selectedThread || props.disabled || !configs.has(selectedThread.environmentId)) return;
    if (key === null) return;
    changeQuestionAttachmentPreparation(key, 1);
    void convertPastedImagesToAttachments({ uris })
      .then(async (result) => {
        if (
          scope.active &&
          (appAtomRegistry.get(questionAttachmentPreparationAtom)[key] ?? 0) > 0
        ) {
          const problems = [
            ...(result.error ? [result.error] : []),
            ...append(key, result.attachments),
          ];
          if (problems.length) Dialog.alert("Could not paste image", problems.join("\n\n"));
        } else await releaseUnusedComposerAttachmentFiles(result.attachments);
      })
      .catch((error) =>
        Dialog.alert(
          "Could not paste image",
          error instanceof Error ? error.message : "Try again.",
        ),
      )
      .finally(() => changeQuestionAttachmentPreparation(key, -1));
  });
  if (!selectedThread || key === null || props.question.allowCustomAnswer === false) return null;
  const { environmentId, id: threadId } = selectedThread;
  const capabilities = configs.get(environmentId)?.environment.capabilities;
  const canAttach = capabilities !== undefined;
  const presentation = resolveVoiceComposerPresentation(voice.state, voice.elapsedSeconds);
  const showsDictation = presentation.statusLabel !== null;
  const attachments = drafts[key]?.attachments ?? [];
  const pick = async (kind: "media" | "files") => {
    const scope = pickerScope.current;
    changeQuestionAttachmentPreparation(key, 1);
    const picked = await settlePromise(async () => {
      const existingCount = appAtomRegistry.get(composerDraftsAtom)[key]?.attachments.length ?? 0;
      const result =
        kind === "files"
          ? await pickComposerFiles({
              existingCount,
              maxBytes: capabilities?.fileAttachments?.maxUploadBytes,
            })
          : await pickComposerMedia({
              existingCount,
              maxVideoBytes: capabilities?.fileAttachments?.maxUploadBytes,
            });
      const picked = "files" in result ? result.files : result.attachments;
      // Resolution on another client clears the reservation while the picker is open.
      if (
        !scope.active ||
        (appAtomRegistry.get(questionAttachmentPreparationAtom)[key] ?? 0) === 0
      ) {
        await releaseUnusedComposerAttachmentFiles(picked);
        return;
      }
      const problems = [...(result.error ? [result.error] : []), ...append(key, picked)];
      if (problems.length) Dialog.alert("Could not attach file", problems.join("\n\n"));
    });
    changeQuestionAttachmentPreparation(key, -1);
    if (AsyncResult.isFailure(picked)) {
      const error = squashAtomCommandFailure(picked);
      Dialog.alert("Could not attach file", error instanceof Error ? error.message : "Try again.");
    }
  };
  return (
    <View className="gap-2">
      {canAttach ? (
        <ComposerAttachmentButton
          disabled={props.disabled}
          supportsFiles
          onPickMedia={() => pick("media")}
          onPickFiles={() => pick("files")}
        />
      ) : null}
      {attachments.length > 0 ? (
        <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)}>
          <ComposerAttachmentStrip
            environmentId={environmentId}
            attachments={attachments}
            onRemove={(id) => {
              if (!props.disabled) removeComposerDraftAttachment(key, id);
            }}
            onPressPreview={setPreviewFile}
            onPressVideo={(attachment, sourceIdentifier) =>
              setPreviewVideo({
                type: "local",
                attachment,
                sourceIdentifier,
              })
            }
            onPressDocument={(attachment) =>
              navigation.navigate("ThreadAttachment", {
                environmentId: String(environmentId),
                threadId: String(threadId),
                attachmentId: attachment.id,
                name: attachment.name,
                mimeType: attachment.mimeType,
                sizeBytes: String(attachment.sizeBytes),
                draftKey: key,
              })
            }
          />
        </Animated.View>
      ) : null}
      <FilePreviewModal source={previewFile} onRequestClose={() => setPreviewFile(null)} />
      <VideoPreviewModal source={previewVideo} onRequestClose={() => setPreviewVideo(null)} />
      <View className="flex-row items-center gap-1">
        <TextInputWrapper onPaste={paste} style={{ flex: 1 }}>
          <TextInput
            key={seed.revision}
            ref={inputRef}
            defaultValue={seed.text}
            multiline={props.question.initialAnswer !== undefined}
            submitBehavior={props.question.initialAnswer !== undefined ? "newline" : undefined}
            editable={!props.disabled && !voice.freezesEditor}
            onSelectionChange={({ nativeEvent }) => setSelection(nativeEvent.selection)}
            onChangeText={(text) => {
              nativeText.current = text;
              props.onChangeText(text);
            }}
            onFocus={() => {
              focusedRef.current = true;
              onInputFocusChange?.(true);
            }}
            onBlur={() => {
              focusedRef.current = false;
              onInputFocusChange?.(false);
            }}
            placeholder="Or type a custom answer"
            className="min-h-[54px] rounded-2xl border border-input-border bg-input px-3.5 py-3 font-sans text-base text-foreground"
          />
        </TextInputWrapper>
        {showsDictation ? null : (
          <ComposerDictationStartAction
            state={voice.state}
            isAvailable={voice.isAvailable}
            disabled={props.disabled}
            onStart={() => {
              props.onStartDictation();
              voice.start();
            }}
            onCancel={voice.cancel}
          />
        )}
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
