import {
  dictationSourceLabel,
  type DictationAvailability,
} from "@supaterm/client-runtime/state/dictation";
import { CircleAlertIcon, MicIcon, MicOffIcon, SquareIcon } from "lucide-react";
import { useEffect, useState, type PointerEvent } from "react";

import type { ComposerDictation } from "~/dictation/useComposerDictation";
import type { WebVoiceRecorder } from "~/dictation/webVoiceRecorder";
import { useLocalDictationEnvironmentId } from "~/state/dictation";
import { useEnvironmentPresentation } from "~/state/presentation";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

const keepComposerFocus = (event: PointerEvent) => event.preventDefault();

function useRouteLabel(availability: DictationAvailability): string | null {
  const environmentId = availability.kind === "hidden" ? null : availability.environmentId;
  const localEnvironmentId = useLocalDictationEnvironmentId();
  const { presentation } = useEnvironmentPresentation(environmentId);
  if (environmentId === null) return null;
  return environmentId === localEnvironmentId
    ? "this computer"
    : (presentation?.entry.target.label ?? null);
}

function sourceCopy(dictation: ComposerDictation, routeLabel: string | null): string | null {
  if (dictation.availability.kind !== "available") return null;
  const label = dictationSourceLabel(dictation.availability.source);
  return routeLabel ? `${label} on ${routeLabel}` : label;
}

function RouteCopy(props: { readonly dictation: ComposerDictation }) {
  return sourceCopy(props.dictation, useRouteLabel(props.dictation.availability));
}

export function ComposerDictationButton(props: {
  readonly dictation: ComposerDictation;
  readonly disabled: boolean;
  readonly shortcutLabel: string | null;
}) {
  const { dictation } = props;
  const { availability } = dictation;
  const routeLabel = useRouteLabel(availability);
  if (availability.kind === "hidden") return null;
  if (availability.kind !== "available") {
    const title =
      availability.kind === "needs-source"
        ? "Set up voice input"
        : `${availability.source.label} can't transcribe`;
    const detail =
      availability.kind === "needs-source"
        ? `Choose which account transcribes${routeLabel ? ` on ${routeLabel}` : ""}.`
        : (availability.source.unavailableReason ?? "Open Settings to choose another account.");
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-composer-shortcut="composer.dictate"
              aria-label={title}
              disabled={props.disabled}
              onPointerDown={keepComposerFocus}
              onClick={dictation.openSetup}
            />
          }
        >
          {availability.kind === "needs-source" ? <MicIcon /> : <MicOffIcon />}
        </TooltipTrigger>
        <TooltipPopup>
          {title}
          <span className="block text-muted-foreground">{detail}</span>
        </TooltipPopup>
      </Tooltip>
    );
  }
  const phase = dictation.state.phase;
  const recording = phase === "recording";
  const busy = phase === "preparing" || phase === "transcribing";
  const label = recording ? "Stop and insert transcript" : busy ? "Transcribing" : "Dictate";
  const detail = recording
    ? null
    : dictation.connected
      ? sourceCopy(dictation, routeLabel)
      : "Record now. Transcribes once connected.";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-composer-shortcut="composer.dictate"
            aria-label={label}
            aria-pressed={recording}
            disabled={props.disabled || phase === "transcribing"}
            onPointerDown={keepComposerFocus}
            onClick={dictation.toggle}
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

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function RecordingTimer(props: { readonly recorder: WebVoiceRecorder }) {
  const [elapsedMs, setElapsedMs] = useState(() => props.recorder.elapsedMs ?? 0);
  useEffect(() => {
    const timer = window.setInterval(() => setElapsedMs(props.recorder.elapsedMs ?? 0), 1_000);
    return () => window.clearInterval(timer);
  }, [props.recorder]);
  return <span className="tabular-nums">Recording {formatElapsed(elapsedMs)}</span>;
}

const LEVEL_STYLE = {
  opacity: "calc(0.25 + var(--dictation-level, 0) * 0.75)",
  scale: "calc(0.7 + var(--dictation-level, 0) * 0.5)",
};

function RecordingLevel(props: { readonly recorder: WebVoiceRecorder }) {
  return (
    <span
      ref={(element) => {
        props.recorder.setLevelTarget(element);
        return () => props.recorder.setLevelTarget(null);
      }}
      className="relative grid place-items-center"
    >
      <span
        aria-hidden
        className="absolute size-5 rounded-full bg-destructive/20"
        style={LEVEL_STYLE}
      />
      <MicIcon className="relative text-destructive" />
    </span>
  );
}

function canOpenMicrophoneSettings(): boolean {
  return typeof window.desktopBridge?.openSystemSettings === "function";
}

export function composerDictationBannerItem(props: {
  readonly dictation: ComposerDictation;
  readonly canSendVoice: boolean;
}): ComposerBannerStackItem | null {
  const { dictation } = props;
  const { state } = dictation;
  switch (state.phase) {
    case "idle":
      return null;
    case "preparing":
      return {
        id: "dictation",
        variant: "default",
        priority: "urgent",
        icon: <Spinner />,
        title: "Preparing microphone…",
        actions: (
          <Button size="xs" variant="ghost" onClick={dictation.cancel}>
            Cancel
          </Button>
        ),
      };
    case "recording":
      return {
        id: "dictation",
        variant: "default",
        priority: "urgent",
        icon: <RecordingLevel recorder={dictation.recorder} />,
        title: <RecordingTimer recorder={dictation.recorder} />,
        description: dictation.connected ? (
          <RouteCopy dictation={dictation} />
        ) : (
          "Offline. Recording continues and transcribes once connected."
        ),
        actions: (
          <>
            <Button size="xs" variant="ghost" onClick={dictation.cancel}>
              Cancel
            </Button>
            {props.canSendVoice ? (
              <Button size="xs" onClick={() => void dictation.transcribeAndSend()}>
                {dictation.connected ? "Transcribe and send" : "Queue voice message"}
              </Button>
            ) : (
              <Button size="xs" onClick={dictation.stop}>
                Insert transcript
              </Button>
            )}
          </>
        ),
      };
    case "transcribing":
      return {
        id: "dictation",
        variant: "default",
        priority: "urgent",
        icon: <Spinner />,
        title: "Transcribing…",
        description: <RouteCopy dictation={dictation} />,
        actions: (
          <Button size="xs" variant="ghost" onClick={dictation.cancel}>
            Cancel
          </Button>
        ),
      };
    case "error":
      return {
        id: "dictation",
        variant: "error",
        priority: "urgent",
        icon: <CircleAlertIcon />,
        title: state.error ?? "Voice input failed.",
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
            <Button size="xs" variant="ghost" onClick={dictation.retry}>
              Retry
            </Button>
          ) : null,
        dismissLabel: "Dismiss",
        onDismiss: dictation.cancel,
      };
  }
}
