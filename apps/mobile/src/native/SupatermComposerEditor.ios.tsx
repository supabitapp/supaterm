import { PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES } from "@supaterm/client-runtime/text-paste";
import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@supaterm/contracts";
import { collectComposerInlineTokens } from "@supaterm/shared/composerInlineTokens";
import { composerSkillLabels } from "../lib/composerContext";
import { composerEditorChips } from "../lib/composerEditorChips";
import { requireNativeView } from "expo";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import type { NativeSyntheticEvent, StyleProp, ViewProps, ViewStyle } from "react-native";
import { StyleSheet } from "react-native";

import { useUniwindTheme } from "../lib/useUniwindTheme";
import { createNativeComposerTheme } from "../lib/nativeComposerTheme";
import { SYSTEM_FONT_FAMILY } from "../lib/fonts";
import { useScaledTextRole } from "../features/settings/appearance/useScaledTextRole";
import {
  acknowledgeComposerNativeEvent,
  assumeComposerControlledState,
  isComposerNativeEcho,
  pruneAcknowledgedComposerNativeEvents,
  resolveComposerControlledEventCount,
  type ComposerNativeEventSnapshot,
} from "./composerEditorRevision";
import { DEFAULT_COMPOSER_ENTER_BEHAVIOR } from "../lib/composerEnterBehavior";
import type { ComposerEditorProps, ComposerEditorSelection } from "./SupatermComposerEditor.types";

const NATIVE_MODULE_NAME = "SupatermComposerEditor";
const EMPTY_SKILLS: NonNullable<ComposerEditorProps["skills"]> = [];
const NO_RESET = () => 0;

type NativeEditorEvent = NativeSyntheticEvent<{
  readonly value: string;
  readonly selection: ComposerEditorSelection;
  readonly eventCount: number;
  readonly resetGeneration: number;
}>;

type NativeSelectionEvent = NativeSyntheticEvent<{
  readonly value: string;
  readonly selection: ComposerEditorSelection;
  readonly eventCount: number;
  readonly resetGeneration: number;
}>;

type NativePasteImagesEvent = NativeSyntheticEvent<{
  readonly uris: ReadonlyArray<string>;
}>;

type NativePasteTextEvent = NativeSyntheticEvent<{
  readonly value: string;
  readonly eventCount: number;
  readonly resetGeneration: number;
  readonly text: string;
  readonly selection: ComposerEditorSelection;
}>;

interface NativeComposerEditorRef {
  focus: () => Promise<void>;
  blur: () => Promise<void>;
  setSelection: (start: number, end: number) => Promise<void>;
  readState: () => Promise<{
    readonly value: string;
    readonly selection: ComposerEditorSelection;
    readonly eventCount: number;
    readonly resetGeneration: number;
    readonly pasteEventCount: number;
  }>;
}

interface NativeComposerEditorProps extends ViewProps {
  readonly ref?: Ref<NativeComposerEditorRef>;
  readonly controlledDocumentJson: string;
  readonly clipboardFragment: string;
  readonly themeJson: string;
  readonly placeholder: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly contentInsetVertical: number;
  readonly editable: boolean;
  readonly readOnly: boolean;
  readonly enterBehavior: string;
  readonly submitTitle: string;
  readonly alternateSubmitTitle: string;
  readonly scrollEnabled: boolean;
  readonly autoFocus: boolean;
  readonly autoCorrect: boolean;
  readonly spellCheck: boolean;
  readonly onComposerChange: (event: NativeEditorEvent) => void;
  readonly onComposerSelectionChange?: (event: NativeSelectionEvent) => void;
  readonly onComposerPasteImages?: (event: NativePasteImagesEvent) => void;
  readonly onComposerContextPress?: (
    event: NativeSyntheticEvent<{ source: string; start: number; end: number }>,
  ) => void;
  readonly onComposerPasteContext?: (
    event: NativePasteTextEvent & NativeSyntheticEvent<{ fragment: string; html: string }>,
  ) => void;
  readonly textPasteThresholdBytes: number;
  readonly maxInputChars: number;
  readonly onComposerPasteText?: (event: NativePasteTextEvent) => void;
  readonly onComposerFocus?: () => void;
  readonly onComposerBlur?: () => void;
  readonly onComposerSubmit?: (event: NativeSyntheticEvent<{ alternate: boolean }>) => void;
  readonly onComposerContentSizeChange?: (
    event: NativeSyntheticEvent<{ readonly width: number; readonly height: number }>,
  ) => void;
}

const NativeView = requireNativeView<NativeComposerEditorProps>(NATIVE_MODULE_NAME);

// A view command rejects with "Unable to find the view" when the composer's native view is
// unmounted, which can happen while an open question hides the composer slot. There is nothing
// to act on then.
function settleViewCommand(command: Promise<void> | undefined): void {
  command?.catch(() => undefined);
}

export function ComposerEditor({
  ref,
  skills = EMPTY_SKILLS,
  selection,
  style,
  textStyle,
  onChangeText,
  onSelectionChange,
  onPasteImages,
  onPasteText,
  onFocus,
  onBlur,
  onSubmit,
  onContentSizeChange,
  contentInsetVertical = 0,
  readResetGeneration = NO_RESET,
  ...props
}: ComposerEditorProps) {
  const nativeRef = useRef<NativeComposerEditorRef>(null);
  const mostRecentEventCountRef = useRef(0);
  const [mostRecentEventCount, setMostRecentEventCount] = useState(0);
  const [, forceNativeEventRender] = useState(0);
  // Native stamps every event with the reset generation it had applied.
  const nativeResetGenerationRef = useRef(0);
  // The native editor mounts empty, so the snapshot history starts empty: the
  // first controlled payload must be a non-echo so a restored draft (or a
  // recycled native view) is applied rather than skipped.
  const nativeEventSnapshotsRef = useRef<ComposerNativeEventSnapshot[]>([]);
  const [confirmedTokens, setConfirmedTokens] = useState(() => ({
    value: props.value,
    tokens: collectComposerInlineTokens(props.value),
  }));
  const inlineTokens =
    confirmedTokens.value === props.value
      ? confirmedTokens.tokens
      : collectComposerInlineTokens(props.value, {
          preserveTrailingFrom: confirmedTokens.tokens,
        });
  if (inlineTokens !== confirmedTokens.tokens) {
    setConfirmedTokens({ value: props.value, tokens: inlineTokens });
  }
  const bodyText = useScaledTextRole("body");
  const theme = useUniwindTheme();

  const skillLabels = useMemo(() => composerSkillLabels(skills), [skills]);
  const chipTextColor = createNativeComposerTheme(theme).text;
  const tokensJson = useMemo(() => {
    return JSON.stringify(
      composerEditorChips({
        text: props.value,
        tokens: inlineTokens,
        skillLabels,
        context: props.context,
        theme,
        textColor: chipTextColor,
      }),
    );
  }, [inlineTokens, props.value, props.context, skillLabels, theme, chipTextColor]);
  // Every render resolves against the snapshot history, so a render whose
  // (value, selection) lags the acknowledged native state is stamped behind
  // the native revision and rejected by the editor instead of re-applying a
  // stale caret or stale text mid-typing.
  const resetGeneration = readResetGeneration();
  // Native restarts its revision at a reset's stamp, so stamp it at the latest acknowledged event.
  const controlledEventCount =
    // oxlint-disable-next-line react/refs -- a reset newer than the last native event restamps at the acknowledged revision, read during render on purpose
    resetGeneration > nativeResetGenerationRef.current
      ? mostRecentEventCount
      : resolveComposerControlledEventCount(
          props.value,
          selection ?? null,
          mostRecentEventCount,
          // oxlint-disable-next-line react/refs -- echo detection compares against the native events seen so far, read during render on purpose
          nativeEventSnapshotsRef.current,
        );
  const acknowledgesLatestNativeEvent = isComposerNativeEcho(
    props.value,
    selection ?? null,
    mostRecentEventCount,
    // oxlint-disable-next-line react/refs -- echo detection compares against the native events seen so far, read during render on purpose
    nativeEventSnapshotsRef.current,
  );
  const isNativeEcho =
    controlledEventCount === mostRecentEventCount && acknowledgesLatestNativeEvent;
  const controlledDocumentJson = JSON.stringify({
    value: props.value,
    selection: isNativeEcho ? null : (selection ?? null),
    tokensJson,
    mostRecentEventCount: controlledEventCount,
    isNativeEcho,
    resetGeneration,
  });
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- prunes native editor event snapshots once a committed payload acknowledges them
  useEffect(() => {
    if (!acknowledgesLatestNativeEvent) return;
    nativeEventSnapshotsRef.current = pruneAcknowledgedComposerNativeEvents(
      nativeEventSnapshotsRef.current,
      mostRecentEventCount,
    );
  }, [acknowledgesLatestNativeEvent, mostRecentEventCount, nativeEventSnapshotsRef]);
  const assumedValue = props.value;
  const assumedControlledDocumentRef = useRef<string | null>(null);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- records the committed controlled payload as the native editor's assumed state
  useEffect(() => {
    if (assumedControlledDocumentRef.current === controlledDocumentJson) return;
    assumedControlledDocumentRef.current = controlledDocumentJson;
    // A native event that arrived after this render was committed moves the
    // acknowledged revision forward; the editor rejects this payload, so the
    // snapshot history must not assume it applied.
    if (isNativeEcho || controlledEventCount !== mostRecentEventCountRef.current) return;
    nativeEventSnapshotsRef.current = assumeComposerControlledState(
      nativeEventSnapshotsRef.current,
      controlledEventCount,
      assumedValue,
    );
  });
  const acceptNativeEvent = useCallback(
    (event: NativeEditorEvent["nativeEvent"]) => {
      // Read at delivery: a send can clear the draft in the same batch, before this view re-renders.
      const acknowledgedEventCount = acknowledgeComposerNativeEvent(
        mostRecentEventCountRef.current,
        event.eventCount,
        readResetGeneration(),
        event.resetGeneration,
      );
      if (acknowledgedEventCount === null) {
        return false;
      }
      mostRecentEventCountRef.current = acknowledgedEventCount;
      nativeResetGenerationRef.current = event.resetGeneration;
      nativeEventSnapshotsRef.current.push({
        eventCount: acknowledgedEventCount,
        value: event.value,
        selection: event.selection,
      });
      return acknowledgedEventCount;
    },
    [nativeEventSnapshotsRef, readResetGeneration],
  );
  const applyNativeChange = (event: NativeEditorEvent["nativeEvent"]) => {
    const acknowledgedEventCount = acceptNativeEvent(event);
    if (acknowledgedEventCount === false) return;
    onChangeText(event.value);
    onSelectionChange?.(event.selection);
    setMostRecentEventCount(acknowledgedEventCount);
    forceNativeEventRender((sequence) => sequence + 1);
  };
  useImperativeHandle(ref, () => ({
    focus: () => settleViewCommand(nativeRef.current?.focus()),
    blur: () => settleViewCommand(nativeRef.current?.blur()),
    setSelection: (nextSelection) =>
      settleViewCommand(nativeRef.current?.setSelection(nextSelection.start, nextSelection.end)),
    // Tapping outside the editor makes iOS accept a pending autocorrection, and that edit's
    // event can reach JS after the tap's handler has already read the draft.
    flushPendingInput: async () => {
      const state = await Promise.resolve()
        .then(() => nativeRef.current?.readState())
        .catch(() => undefined);
      // Acknowledging past a paste JS has not received yet would get the paste rejected.
      if (state && state.pasteEventCount <= mostRecentEventCountRef.current) {
        applyNativeChange(state);
      }
    },
  }));
  const themeJson = JSON.stringify(createNativeComposerTheme(theme));
  const resolvedTextStyle = StyleSheet.flatten(textStyle) ?? {};
  return (
    <NativeView
      ref={nativeRef}
      controlledDocumentJson={controlledDocumentJson}
      clipboardFragment={props.clipboardFragment ?? ""}
      themeJson={themeJson}
      placeholder={props.placeholder ?? ""}
      fontFamily={
        typeof resolvedTextStyle.fontFamily === "string"
          ? resolvedTextStyle.fontFamily
          : SYSTEM_FONT_FAMILY
      }
      fontSize={
        typeof resolvedTextStyle.fontSize === "number"
          ? resolvedTextStyle.fontSize
          : bodyText.fontSize
      }
      lineHeight={
        typeof resolvedTextStyle.lineHeight === "number"
          ? resolvedTextStyle.lineHeight
          : bodyText.lineHeight
      }
      contentInsetVertical={contentInsetVertical}
      editable={props.editable ?? true}
      readOnly={props.readOnly ?? false}
      enterBehavior={props.enterBehavior ?? DEFAULT_COMPOSER_ENTER_BEHAVIOR}
      submitTitle={props.submitTitle ?? "Send Message"}
      alternateSubmitTitle={props.alternateSubmitTitle ?? props.submitTitle ?? "Send Message"}
      scrollEnabled={props.scrollEnabled ?? true}
      autoFocus={props.autoFocus ?? false}
      autoCorrect={props.autoCorrect ?? true}
      spellCheck={props.spellCheck ?? true}
      textPasteThresholdBytes={onPasteText ? PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES : 0}
      maxInputChars={PROVIDER_SEND_TURN_MAX_INPUT_CHARS}
      style={style as StyleProp<ViewStyle>}
      onComposerChange={(event) => applyNativeChange(event.nativeEvent)}
      onComposerSelectionChange={(event) => {
        const acknowledgedEventCount = acceptNativeEvent(event.nativeEvent);
        if (acknowledgedEventCount === false) return;
        // A selection change that raced a text mutation can carry post-edit
        // text. It must reach the parent alongside the acknowledged revision,
        // or the next render stamps the stale draft at that revision and can
        // re-apply it over the newer native text.
        if (event.nativeEvent.value !== props.value) {
          onChangeText(event.nativeEvent.value);
        }
        onSelectionChange?.(event.nativeEvent.selection);
        setMostRecentEventCount(acknowledgedEventCount);
        forceNativeEventRender((sequence) => sequence + 1);
      }}
      onComposerPasteImages={(event) => onPasteImages?.(event.nativeEvent.uris)}
      onComposerContextPress={(event) => props.onContextPress?.(event.nativeEvent)}
      onComposerPasteContext={(event) => {
        const paste = event.nativeEvent;
        const acknowledgedEventCount = acceptNativeEvent(paste);
        if (acknowledgedEventCount === false) return;
        onChangeText(paste.value);
        onSelectionChange?.(paste.selection);
        props.onPasteContext?.(paste);
        setMostRecentEventCount(acknowledgedEventCount);
        forceNativeEventRender((sequence) => sequence + 1);
      }}
      onComposerPasteText={(event) => {
        const paste = event.nativeEvent;
        const acknowledgedEventCount = acceptNativeEvent(paste);
        if (acknowledgedEventCount === false) return;
        // Synchronize the draft before an async paste captures its insertion target.
        // React props can still precede the last native keystroke.
        onChangeText(paste.value);
        onSelectionChange?.(paste.selection);
        onPasteText?.(paste);
        setMostRecentEventCount(acknowledgedEventCount);
        forceNativeEventRender((sequence) => sequence + 1);
      }}
      onComposerFocus={onFocus}
      onComposerBlur={onBlur}
      onComposerContentSizeChange={
        onContentSizeChange === undefined
          ? undefined
          : (event) => onContentSizeChange(event.nativeEvent)
      }
      onComposerSubmit={
        onSubmit === undefined
          ? undefined
          : (event) => onSubmit(event.nativeEvent.alternate === true)
      }
    />
  );
}

export type {
  ComposerEditorHandle,
  ComposerEditorProps,
  ComposerEditorSelection,
  ComposerTextPaste,
} from "./SupatermComposerEditor.types";
