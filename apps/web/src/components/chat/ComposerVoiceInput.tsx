import { CircleAlertIcon, MicIcon, SquareIcon, XIcon } from "@supaterm/icons";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type PointerEvent, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { formatVoiceDuration } from "~/voice/formatVoiceDuration";
import type { ComposerVoiceInput } from "~/voice/useComposerVoiceInput";
import { VOICE_LEVEL_HISTORY, type WebVoiceRecorder } from "~/voice/webVoiceRecorder";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { ComposerSendArrowIcon, ComposerSendButton } from "./ComposerPrimaryActions";

const keepComposerFocus = (event: PointerEvent) => event.preventDefault();

const VOICE_BAR_INDEXES = Array.from({ length: VOICE_LEVEL_HISTORY }, (_, index) => index);

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

function VoicePillButton(props: {
  readonly label: string;
  readonly shortcut: string | null;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={props.label}
            disabled={props.disabled}
            className="relative flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none transition-[background-color,scale] duration-150 ease-out before:absolute before:-inset-2 hover:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.96] disabled:pointer-events-none disabled:opacity-64 motion-reduce:transition-none"
            onPointerDown={keepComposerFocus}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup shortcut={props.shortcut}>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

export function ComposerVoiceSession(props: {
  readonly voice: ComposerVoiceInput;
  readonly shortcutLabel: string | null;
}) {
  const { voice } = props;
  const { availability, state } = voice;
  const { phase } = state;
  const capturing = phase === "preparing" || phase === "recording";
  const reviews = capturing && availability.canReview;
  const sendLabel = availability.canSend ? "Send voice message" : "Transcribe and send";
  return (
    <>
      <div
        role="group"
        aria-label="Voice input"
        className={cn(
          "flex h-8 shrink-0 items-center gap-2 rounded-full bg-foreground/6 text-foreground text-sm",
          reviews ? "ps-1" : "ps-3",
          phase === "sending" ? "pe-3" : "pe-1",
        )}
      >
        {reviews ? (
          <VoicePillButton
            label="Stop and review"
            shortcut={props.shortcutLabel}
            disabled={phase !== "recording"}
            onClick={voice.stop}
          >
            <SquareIcon aria-hidden className="size-3 fill-current" />
          </VoicePillButton>
        ) : null}
        {capturing ? (
          <>
            <VoiceElapsed recorder={voice.recorder} />
            <VoiceLevelMeter recorder={voice.recorder} />
          </>
        ) : (
          <span aria-live="polite" className="flex items-center gap-2 text-muted-foreground">
            {phase === "sending" ? <Spinner size="sm" /> : null}
            {phase === "transcribing" ? "Transcribing…" : "Saving…"}
          </span>
        )}
        {phase === "sending" ? null : (
          <VoicePillButton
            label={phase === "recording" ? "Discard" : "Cancel"}
            shortcut={capturing ? "Esc" : null}
            onClick={voice.cancel}
          >
            <XIcon aria-hidden className="size-3.5 text-muted-foreground" />
          </VoicePillButton>
        )}
      </div>
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <ComposerSendButton
            type="button"
            aria-label={sendLabel}
            disabled={phase !== "recording" || !(availability.canSend || availability.canReview)}
            onPointerDown={keepComposerFocus}
            onClick={() => void voice.send()}
          >
            {capturing ? <ComposerSendArrowIcon /> : <Spinner size="sm" aria-hidden="true" />}
          </ComposerSendButton>
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
