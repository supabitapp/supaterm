import { CircleAlertIcon, MicIcon, SquareIcon, XIcon } from "@supaterm/icons";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type PointerEvent } from "react";

import { formatVoiceDuration } from "~/voice/formatVoiceDuration";
import type { ComposerVoiceInput } from "~/voice/useComposerVoiceInput";
import { VOICE_LEVEL_HISTORY, type WebVoiceRecorder } from "~/voice/webVoiceRecorder";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { ComposerSendArrowIcon, composerSendButtonClassName } from "./ComposerPrimaryActions";

const keepComposerFocus = (event: PointerEvent) => event.preventDefault();

const VOICE_BAR_INDEXES = Array.from({ length: VOICE_LEVEL_HISTORY }, (_, index) => index);

/** Starts voice input; while a recording is open, {@link ComposerVoiceSession} takes its place. */
export function ComposerVoiceButton(props: {
  readonly voice: ComposerVoiceInput;
  readonly disabled: boolean;
  readonly shortcutLabel: string | null;
}) {
  const { voice } = props;
  const { availability } = voice;
  const navigate = useNavigate();
  const unavailable = availability.unavailableReason !== null;
  const label = unavailable ? "Voice input unavailable" : "Voice input";
  const detail = unavailable
    ? availability.unavailableReason
    : availability.canReview
      ? `Transcribed with ${availability.label}`
      : "Records now; sends once the environment is reachable.";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={props.disabled || (unavailable && !availability.opensSettings)}
            onPointerDown={keepComposerFocus}
            onClick={() => {
              if (unavailable) {
                void navigate({ to: "/settings/general" });
                return;
              }
              voice.start();
            }}
          />
        }
      >
        <MicIcon />
      </TooltipTrigger>
      <TooltipPopup>
        {props.shortcutLabel ? `${label} (${props.shortcutLabel})` : label}
        {detail ? <span className="block text-muted-foreground">{detail}</span> : null}
      </TooltipPopup>
    </Tooltip>
  );
}

function VoiceElapsed(props: { readonly recorder: WebVoiceRecorder }) {
  const [elapsedMs, setElapsedMs] = useState(() => props.recorder.elapsedMs);
  useEffect(() => {
    const timer = window.setInterval(() => setElapsedMs(props.recorder.elapsedMs), 1_000);
    return () => window.clearInterval(timer);
  }, [props.recorder]);
  return <span className="tabular-nums">{formatVoiceDuration(elapsedMs)}</span>;
}

/** Bars follow the recorder's level history without re-rendering React on every sample. */
function VoiceLevelMeter(props: { readonly recorder: WebVoiceRecorder }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none flex h-4 items-center gap-0.5"
      ref={(element) => {
        if (!element) return;
        const bars = Array.from(element.children) as HTMLElement[];
        props.recorder.setLevelListener((levels) => {
          bars.forEach((bar, index) => {
            bar.style.scale = `1 ${Math.max(0.15, levels[index] ?? 0)}`;
          });
        });
        return () => props.recorder.setLevelListener(null);
      }}
    >
      {VOICE_BAR_INDEXES.map((index) => (
        <span
          key={index}
          className="h-full w-0.5 origin-center scale-y-[0.15] rounded-full bg-foreground/70 transition-transform duration-100 ease-out motion-reduce:transition-none"
        />
      ))}
    </span>
  );
}

function canOpenMicrophoneSettings(): boolean {
  return typeof window.desktopBridge?.openSystemSettings === "function";
}

function VoiceSessionAction(props: {
  readonly voice: ComposerVoiceInput;
  readonly shortcutLabel: string | null;
}) {
  const { voice } = props;
  const { phase } = voice.state;
  if (phase === "sending") {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center">
        <Spinner size="sm" />
      </span>
    );
  }
  const reviews = phase === "recording" && voice.availability.canReview;
  const label = reviews ? "Stop and review" : phase === "recording" ? "Discard" : "Cancel";
  const capturing = phase === "preparing" || phase === "recording";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className="relative flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground outline-none transition-[background-color,scale] duration-150 ease-out before:absolute before:-inset-2 hover:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.96] motion-reduce:transition-none"
            onPointerDown={keepComposerFocus}
            onClick={reviews ? voice.stop : voice.cancel}
          />
        }
      >
        {reviews ? (
          <SquareIcon aria-hidden className="size-3 fill-current" />
        ) : (
          <XIcon aria-hidden className="size-3.5" />
        )}
      </TooltipTrigger>
      <TooltipPopup shortcut={reviews ? props.shortcutLabel : capturing ? "Esc" : null}>
        {label}
      </TooltipPopup>
    </Tooltip>
  );
}

/** Replaces the microphone and send buttons while a recording is open or on its way. */
export function ComposerVoiceSession(props: {
  readonly voice: ComposerVoiceInput;
  readonly shortcutLabel: string | null;
}) {
  const { voice } = props;
  const { availability, state } = voice;
  const capturing = state.phase === "preparing" || state.phase === "recording";
  const sendLabel = availability.canSend ? "Send voice message" : "Transcribe and send";
  return (
    <>
      <div
        role="group"
        aria-label="Voice input"
        className="flex h-8 shrink-0 items-center gap-2 rounded-full bg-foreground/6 ps-1 pe-3 text-foreground text-sm"
      >
        <VoiceSessionAction voice={voice} shortcutLabel={props.shortcutLabel} />
        {capturing ? (
          <>
            <VoiceElapsed recorder={voice.recorder} />
            <VoiceLevelMeter recorder={voice.recorder} />
          </>
        ) : (
          <span aria-live="polite" className="text-muted-foreground">
            {state.phase === "transcribing" ? "Transcribing…" : "Saving…"}
          </span>
        )}
      </div>
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <button
            type="button"
            className={composerSendButtonClassName}
            aria-label={sendLabel}
            disabled={
              state.phase !== "recording" || !(availability.canSend || availability.canReview)
            }
            onPointerDown={keepComposerFocus}
            onClick={() => void voice.send()}
          >
            {capturing ? <ComposerSendArrowIcon /> : <Spinner size="sm" aria-hidden="true" />}
          </button>
        </TooltipTrigger>
        <TooltipPopup side="top">{sendLabel}</TooltipPopup>
      </Tooltip>
    </>
  );
}

export function composerVoiceBannerItem(voice: ComposerVoiceInput): ComposerBannerStackItem | null {
  const { state } = voice;
  if (state.phase !== "error") return null;
  return {
    id: "voice-input",
    variant: "error",
    priority: "urgent",
    icon: <CircleAlertIcon />,
    title: state.error ?? "Voice input stopped.",
    description:
      state.errorAction === "settings" && !canOpenMicrophoneSettings()
        ? "Allow microphone access for this site in your browser, then try again."
        : undefined,
    actions:
      state.errorAction === "settings" && canOpenMicrophoneSettings() ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => void window.desktopBridge?.openSystemSettings?.("microphone")}
        >
          Open settings
        </Button>
      ) : state.errorAction !== null ? (
        <Button size="xs" variant="ghost" onClick={voice.start}>
          Record again
        </Button>
      ) : null,
    dismissLabel: "Dismiss",
    onDismiss: voice.cancel,
  };
}
