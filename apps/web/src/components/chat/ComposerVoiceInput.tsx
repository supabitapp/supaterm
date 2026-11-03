import { CircleAlertIcon, MicIcon, SquareIcon, XIcon } from "@supaterm/icons";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

import { isElectron } from "~/env";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useRenderedAppearance } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { DOT_SCOPE_HEIGHT, DOT_SCOPE_WIDTH, DotScope, paintDotScope } from "~/voice/dotScope";
import { formatVoiceDuration } from "~/voice/formatVoiceDuration";
import type { ComposerVoiceInput } from "~/voice/useComposerVoiceInput";
import type { WebVoiceRecorder } from "~/voice/webVoiceRecorder";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { ComposerSendArrowIcon, ComposerSendButton } from "./ComposerPrimaryActions";

const keepComposerFocus = (event: PointerEvent) => event.preventDefault();

// High-refresh displays would otherwise repaint the scope at 120 Hz or more.
const DOT_SCOPE_FRAME_MS = 1000 / 60 - 1;

export function ComposerVoiceButton(props: {
  readonly voice: ComposerVoiceInput;
  readonly disabled: boolean;
  readonly shortcutLabel: string | null;
  readonly holdKeyLabel: string | null;
}) {
  const { voice } = props;
  const { availability } = voice;
  const navigate = useNavigate();
  const unavailable = availability.unavailableReason !== null;
  const label = unavailable ? "Voice input unavailable" : "Voice input";
  const shortcut = [props.shortcutLabel, props.holdKeyLabel && `hold ${props.holdKeyLabel}`]
    .filter(Boolean)
    .join(" or ");
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

function VoiceElapsed(props: { readonly recorder: WebVoiceRecorder }) {
  const [elapsedMs, setElapsedMs] = useState(() => props.recorder.elapsedMs);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- ticks the elapsed label from the live recorder once a second while it records
  useEffect(() => {
    const timer = window.setInterval(() => setElapsedMs(props.recorder.elapsedMs), 1_000);
    return () => window.clearInterval(timer);
  }, [props.recorder]);
  return <span className="tabular-nums">{formatVoiceDuration(elapsedMs)}</span>;
}

// The scope animates only while recording; preparing can wait on a permission prompt indefinitely.
function VoiceDotScope(props: {
  readonly recorder: WebVoiceRecorder;
  readonly recording: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const dark = useRenderedAppearance() === "dark";
  const still = reducedMotion || !props.recording;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- paints the canvas from the live recorder each frame, outside React
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const scope = new DotScope(still);
    const paint = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.round(DOT_SCOPE_WIDTH * ratio);
      if (canvas.width !== width) {
        canvas.width = width;
        canvas.height = Math.round(DOT_SCOPE_HEIGHT * ratio);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      paintDotScope(context, scope, getComputedStyle(canvas).color, dark);
    };
    if (still) {
      for (let settle = 0; settle < 4; settle++) scope.advance(0.25, -120);
      paint();
      return;
    }
    let last: number | null = null;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (last !== null && now - last < DOT_SCOPE_FRAME_MS) return;
      scope.advance(last === null ? 0 : (now - last) / 1000, props.recorder.loudness());
      last = now;
      paint();
    };
    let frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [props.recorder, still, dark]);
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none shrink-0 text-foreground"
      style={{ width: DOT_SCOPE_WIDTH, height: DOT_SCOPE_HEIGHT }}
    />
  );
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
          phase === "sending" ? "ps-3" : "ps-1",
          reviews ? "pe-1" : "pe-3",
        )}
      >
        {phase === "sending" ? null : (
          <VoicePillButton
            label={phase === "recording" ? "Discard" : "Cancel"}
            shortcut={capturing ? "Esc" : null}
            onClick={voice.cancel}
          >
            <XIcon aria-hidden className="size-3.5 text-muted-foreground" />
          </VoicePillButton>
        )}
        {capturing ? (
          <>
            <VoiceElapsed recorder={voice.recorder} />
            <VoiceDotScope recorder={voice.recorder} recording={phase === "recording"} />
          </>
        ) : (
          <span aria-live="polite" className="flex items-center gap-2 text-muted-foreground">
            {phase === "sending" ? <Spinner size="sm" /> : null}
            {phase === "transcribing" ? "Transcribing…" : "Saving…"}
          </span>
        )}
        {reviews ? (
          <VoicePillButton
            label="Stop and review"
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
      state.errorAction === "settings" && !isElectron
        ? "Allow microphone access for this site in your browser, then try again."
        : undefined,
    actions:
      state.errorAction === "settings" && isElectron ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => void window.desktopBridge?.openSystemSettings("microphone")}
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
