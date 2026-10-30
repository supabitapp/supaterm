import { CircleAlertIcon, MicIcon, SquareIcon } from "@supaterm/icons";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type PointerEvent } from "react";

import { formatVoiceDuration } from "~/voice/formatVoiceDuration";
import type { ComposerVoiceInput } from "~/voice/useComposerVoiceInput";
import { VOICE_LEVEL_HISTORY, type WebVoiceRecorder } from "~/voice/webVoiceRecorder";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

const keepComposerFocus = (event: PointerEvent) => event.preventDefault();

const VOICE_BAR_INDEXES = Array.from({ length: VOICE_LEVEL_HISTORY }, (_, index) => index);

export function ComposerVoiceButton(props: {
  readonly voice: ComposerVoiceInput;
  readonly disabled: boolean;
  readonly shortcutLabel: string | null;
}) {
  const { voice } = props;
  const { availability, state } = voice;
  const navigate = useNavigate();
  const unavailable = availability.unavailableReason !== null && state.phase === "idle";
  const recording = state.phase === "recording";
  const busy =
    state.phase === "preparing" || state.phase === "transcribing" || state.phase === "sending";
  const label = unavailable
    ? "Voice input unavailable"
    : recording
      ? availability.canReview
        ? "Stop and review"
        : "Send voice message"
      : "Voice input";
  const detail = unavailable
    ? availability.unavailableReason
    : recording || busy
      ? null
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
            disabled={props.disabled || busy || (unavailable && !availability.opensSettings)}
            onPointerDown={keepComposerFocus}
            onClick={() => {
              if (unavailable) {
                void navigate({ to: "/settings/general" });
                return;
              }
              voice.toggle();
            }}
          />
        }
      >
        {busy ? <Spinner /> : recording ? <SquareIcon /> : <MicIcon />}
      </TooltipTrigger>
      <TooltipPopup>
        {props.shortcutLabel && !busy ? `${label} (${props.shortcutLabel})` : label}
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

export function composerVoiceBannerItem(voice: ComposerVoiceInput): ComposerBannerStackItem | null {
  const { state, availability } = voice;
  switch (state.phase) {
    case "idle":
      return null;
    case "preparing":
      return {
        id: "voice-input",
        variant: "default",
        priority: "urgent",
        icon: <Spinner />,
        title: "Opening the microphone…",
        actions: (
          <Button size="xs" variant="ghost" onClick={voice.cancel}>
            Cancel
          </Button>
        ),
      };
    case "recording":
      return {
        id: "voice-input",
        variant: "default",
        priority: "urgent",
        icon: <span aria-hidden className="size-2 rounded-full bg-destructive" />,
        title: (
          <span className="flex min-w-0 items-center gap-2.5 pe-1.5">
            <VoiceElapsed recorder={voice.recorder} />
            <VoiceLevelMeter recorder={voice.recorder} />
          </span>
        ),
        description: availability.label,
        actions: (
          <>
            <Button size="xs" variant="ghost" onClick={voice.cancel}>
              Discard
            </Button>
            {availability.canReview ? (
              <Button size="xs" variant="outline" onClick={voice.stop}>
                Stop and review
              </Button>
            ) : null}
            {availability.canSend || availability.canReview ? (
              <Button size="xs" onClick={() => void voice.send()}>
                Send
              </Button>
            ) : null}
          </>
        ),
      };
    case "transcribing":
      return {
        id: "voice-input",
        variant: "default",
        priority: "urgent",
        icon: <Spinner />,
        title: "Transcribing…",
        description: availability.label,
        actions: (
          <Button size="xs" variant="ghost" onClick={voice.cancel}>
            Cancel
          </Button>
        ),
      };
    case "sending":
      return {
        id: "voice-input",
        variant: "default",
        priority: "urgent",
        icon: <Spinner />,
        title: "Saving the voice message…",
      };
    case "error":
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
}
