import { msg, T, useGT } from "gt-react";
import { CircleAlertIcon, MicIcon, SquareIcon, XIcon } from "@supaterm/icons";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type PointerEvent, type ReactNode } from "react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { formatVoiceDuration } from "~/voice/formatVoiceDuration";
import type { ComposerVoiceInput } from "~/voice/useComposerVoiceInput";
import { VOICE_LEVEL_HISTORY, type WebVoiceRecorder } from "~/voice/webVoiceRecorder";
import { m, type MessageResolver } from "~/i18n/messages";
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
  readonly holdKeyLabel: string | null;
}) {
  const { voice } = props;
  const { availability } = voice;
  const gt = useGT();
  const navigate = useNavigate();
  const unavailable = availability.unavailableReason !== null;
  const label = unavailable ? gt("Voice input unavailable") : gt("Voice input");
  const hold = props.holdKeyLabel ? gt("hold {key}", { key: props.holdKeyLabel }) : null;
  const shortcut =
    props.shortcutLabel && hold
      ? gt("{shortcut} or {hold}", { shortcut: props.shortcutLabel, hold })
      : props.shortcutLabel || hold;
  const detail = unavailable
    ? availability.unavailableReason
    : availability.canReview
      ? gt("Transcribed with {model}", { model: availability.label })
      : gt("Records now; sends once the environment is reachable.");
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
      <TooltipPopup>
        {shortcut ? `${label} (${shortcut})` : label}
        {detail ? <span className="block text-muted-foreground">{detail}</span> : null}
      </TooltipPopup>
    </Tooltip>
  );
}

export function VoiceElapsed(props: { readonly recorder: Pick<WebVoiceRecorder, "elapsedMs"> }) {
  const [elapsedMs, setElapsedMs] = useState(() => props.recorder.elapsedMs);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- ticks the elapsed label from the live recorder on each of its whole seconds
  useEffect(() => {
    const recorder = props.recorder;
    let timer = 0;
    const tick = () => {
      const elapsed = recorder.elapsedMs;
      setElapsedMs(elapsed);
      timer = window.setTimeout(tick, 1_000 - (elapsed % 1_000));
    };
    timer = window.setTimeout(tick, 1_000 - (recorder.elapsedMs % 1_000));
    return () => window.clearTimeout(timer);
  }, [props.recorder]);
  return <span className="tabular-nums">{formatVoiceDuration(elapsedMs)}</span>;
}

/** Bars follow the recorder's level history without re-rendering React on every sample. */
export function VoiceLevelMeter(props: { readonly recorder: WebVoiceRecorder }) {
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

export function VoicePillButton(props: {
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
  const gt = useGT();
  const sendLabel = availability.canSend ? gt("Send voice message") : gt("Transcribe and send");
  return (
    <>
      <div
        role="group"
        aria-label={gt("Voice input")}
        className={cn(
          "flex h-8 shrink-0 items-center gap-2 rounded-full bg-foreground/6 text-foreground text-sm",
          phase === "sending" ? "ps-3" : "ps-1",
          reviews ? "pe-1" : "pe-3",
        )}
      >
        {phase === "sending" ? null : (
          <VoicePillButton
            label={
              phase === "recording"
                ? gt("Discard", { $context: "verb, discards the voice recording" })
                : gt("Cancel", { $context: "verb, stops voice input" })
            }
            shortcut={capturing ? "Esc" : null}
            onClick={voice.cancel}
          >
            <XIcon aria-hidden className="size-3.5 text-muted-foreground" />
          </VoicePillButton>
        )}
        {capturing ? (
          <>
            <VoiceElapsed recorder={voice.recorder} />
            <VoiceLevelMeter recorder={voice.recorder} />
          </>
        ) : (
          <span aria-live="polite" className="flex items-center gap-2 text-muted-foreground">
            {phase === "sending" ? <Spinner size="sm" /> : null}
            {phase === "transcribing" ? <T>Transcribing…</T> : <T>Saving…</T>}
          </span>
        )}
        {reviews ? (
          <VoicePillButton
            label={gt("Stop and review")}
            shortcut={props.shortcutLabel}
            disabled={phase !== "recording"}
            onClick={voice.stop}
          >
            <SquareIcon weight="fill" aria-hidden className="size-3" />
          </VoicePillButton>
        ) : null}
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

export function composerVoiceBannerItem(
  voice: ComposerVoiceInput,
  resolve: MessageResolver = m,
): ComposerBannerStackItem | null {
  const { state } = voice;
  if (state.phase !== "error") return null;
  return {
    id: "voice-input",
    variant: "error",
    icon: <CircleAlertIcon />,
    title: state.error ?? resolve(msg("Voice input stopped.")),
    description:
      state.errorAction === "settings" && !isElectron
        ? resolve(msg("Allow microphone access for this site in your browser, then try again."))
        : undefined,
    actions:
      state.errorAction === "settings" && isElectron ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => void window.desktopBridge?.openSystemSettings("microphone")}
        >
          <T>Open settings</T>
        </Button>
      ) : state.errorAction !== null ? (
        <Button size="xs" variant="ghost" onClick={voice.start}>
          <T>Record again</T>
        </Button>
      ) : null,
    dismissLabel: resolve(msg("Dismiss")),
    onDismiss: voice.cancel,
  };
}
