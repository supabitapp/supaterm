import { useAtomValue } from "@effect/atom-react";
import { voiceInputSessionActive } from "@supaterm/client-runtime/voice-input";
import type { EnvironmentId, ProjectId, ThreadId } from "@supaterm/contracts";
import { MicIcon, SquareIcon, XIcon } from "@supaterm/icons";
import { useNavigate } from "@tanstack/react-router";
import { type RefObject, useEffect, useId } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { observeResize } from "~/lib/observeResize";
import { useStableCallback } from "~/hooks/useStableCallback";
import { shortcutLabelForCommand } from "~/keybindings";
import { registerCommands } from "~/shortcuts/dispatcher";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { useComposerVoiceInput } from "~/voice/useComposerVoiceInput";
import { resolveVoiceLanguage } from "~/voice/voiceLanguage";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { VoiceElapsed, VoiceLevelMeter, VoicePillButton } from "./ComposerVoiceInput";

const keepFieldFocus = (event: { preventDefault: () => void }) => event.preventDefault();

const notSendable = () => () => Promise.reject(new Error("Text fields don't send voice messages."));

/**
 * Dictates into a plain text field. The voice shortcut belongs to the field while it has focus
 * or a recording, ahead of the chat composer, and the field must be read-only while `onBusyChange`
 * reports busy so the transcript lands on the text it was recorded against.
 */
export function TextFieldVoiceInput(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId?: ThreadId | null | undefined;
  readonly projectId?: ProjectId | null | undefined;
  readonly fieldRef: RefObject<HTMLTextAreaElement | null>;
  /** The field is saving or locked, so a new recording can't start. */
  readonly disabled?: boolean | undefined;
  readonly onChange: (value: string) => void;
  readonly onBusyChange: (busy: boolean) => void;
}) {
  const { fieldRef } = props;
  const ownerKey = useId();
  const navigate = useNavigate();
  const languageSetting = useClientSettings((settings) => settings.voiceLanguage);
  const holdToTalkKey = useClientSettings((settings) => settings.voiceHoldToTalkKey);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const language = resolveVoiceLanguage(languageSetting);
  const voice = useComposerVoiceInput({
    ownerKey,
    environmentId: props.environmentId,
    threadId: props.threadId ?? null,
    projectId: props.projectId ?? null,
    language: language.tag,
    languageLabel: language.label,
    readPrompt: () => fieldRef.current?.value ?? "",
    readSelection: () => {
      const field = fieldRef.current;
      const end = field?.value.length ?? 0;
      return { start: field?.selectionStart ?? end, end: field?.selectionEnd ?? end };
    },
    commitPrompt: (text, selection) => {
      props.onChange(text);
      // The field shows the new text on the next render; the caret follows it there.
      window.requestAnimationFrame(() => {
        const field = fieldRef.current;
        if (!field) return;
        field.focus({ preventScroll: true });
        field.setSelectionRange(selection.start, selection.end);
      });
    },
    canSendVoice: false,
    prepareVoiceSend: notSendable,
    submit: () => undefined,
    onBusyChange: props.onBusyChange,
    holdToTalkKey,
    holdToTalkTarget: fieldRef,
  });
  const owns = useStableCallback(
    () =>
      voice.busy ||
      (!props.disabled &&
        !voiceInputSessionActive() &&
        fieldRef.current !== null &&
        document.activeElement === fieldRef.current),
  );
  const { busy, cancel } = voice;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- stops a recording once its field is hidden, as a closed popover or tab keeps the form mounted
  useEffect(() => {
    const field = fieldRef.current;
    if (!busy || !field) return;
    return observeResize(field, () => {
      if (!field.checkVisibility()) cancel();
    });
  }, [busy, cancel, fieldRef]);
  const toggle = useStableCallback((code: string | undefined) =>
    voice.toggle(code === undefined ? undefined : { code }),
  );
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- registers this field's voice shortcut with the dispatcher, ahead of the composer's, for the field's lifetime
  useEffect(
    () =>
      registerCommands(
        {
          "composer.voice": ({ event, repeat }) => {
            if (!repeat) toggle(event?.code);
          },
        },
        { capture: true, when: owns },
      ),
    [owns, toggle],
  );

  const shortcutLabel = shortcutLabelForCommand(keybindings, "composer.voice");
  const { availability, state } = voice;
  const { phase } = state;

  if (phase === "preparing" || phase === "recording") {
    return (
      <div
        role="group"
        aria-label="Voice input"
        className="flex h-7 shrink-0 items-center gap-2 rounded-full bg-foreground/6 ps-0.5 pe-0.5 text-foreground text-xs"
      >
        <VoicePillButton
          label={phase === "recording" ? "Discard" : "Cancel"}
          shortcut="Esc"
          onClick={voice.cancel}
        >
          <XIcon aria-hidden className="size-3.5 text-muted-foreground" />
        </VoicePillButton>
        <VoiceElapsed recorder={voice.recorder} />
        <VoiceLevelMeter recorder={voice.recorder} />
        <VoicePillButton
          label="Stop and insert"
          shortcut={shortcutLabel}
          disabled={phase !== "recording"}
          onClick={voice.stop}
        >
          <SquareIcon weight="fill" aria-hidden className="size-3" />
        </VoicePillButton>
      </div>
    );
  }
  if (phase === "transcribing") {
    return (
      <span aria-live="polite" className="flex items-center gap-2 text-muted-foreground text-xs">
        <Spinner size="sm" />
        Transcribing…
      </span>
    );
  }

  const unavailable = availability.unavailableReason !== null || !availability.canReview;
  const label = unavailable ? "Voice input unavailable" : "Voice input";
  const detail =
    state.error ?? availability.unavailableReason ?? `Transcribed with ${availability.label}`;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost-muted"
              size="icon-xs"
              aria-label={label}
              disabled={props.disabled || (unavailable && !availability.opensSettings)}
              onPointerDown={keepFieldFocus}
              onClick={() => {
                if (unavailable) {
                  void navigate({ to: "/settings/voice" });
                  return;
                }
                voice.start();
              }}
            />
          }
        >
          <MicIcon />
        </TooltipTrigger>
        <TooltipPopup shortcut={unavailable ? null : shortcutLabel}>
          {label}
          <span className="block text-muted-foreground">{detail}</span>
        </TooltipPopup>
      </Tooltip>
      {state.error ? (
        <span role="status" className="truncate text-destructive text-xs">
          {state.error}
        </span>
      ) : null}
    </span>
  );
}
