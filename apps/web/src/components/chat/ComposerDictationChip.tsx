import { useAtomValue } from "@effect/atom-react";
import { CopyIcon, MicIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { isPendingClipRunning, transcribePendingClip } from "~/dictation/pendingClipRunner";
import {
  discardPendingClip,
  retrySavingPendingClip,
  updatePendingClip,
  type PendingClip,
} from "~/dictation/pendingClips";
import { threadOutboxDeliverableAtom } from "~/state/threadOutbox";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function statusCopy(clip: PendingClip, connected: boolean): string {
  if (!clip.persisted) return "Couldn't save this recording. Keep this window open.";
  switch (clip.status) {
    case "transcribing":
      return "Transcribing…";
    case "ready":
      return "Transcript ready";
    case "failed":
      return clip.error ?? "Could not transcribe this recording.";
    case "waiting":
      if (!connected) return "Transcribes once connected";
      return clip.error ?? "Waiting to transcribe";
  }
}

export function ComposerDictationChip(props: {
  readonly clip: PendingClip;
  readonly insertDisabledReason: string | null;
  readonly onInsert: (text: string) => boolean;
}) {
  const { clip } = props;
  const connected = useAtomValue(threadOutboxDeliverableAtom(clip.environmentId));
  const [saving, setSaving] = useState(false);
  const transcript = clip.status === "ready" ? clip.transcript : null;

  const retry = () => {
    updatePendingClip(clip.id, { status: "waiting", error: null, retryAt: 0 });
    if (connected && !isPendingClipRunning(clip.id)) void transcribePendingClip(clip.id);
  };
  const retrySaving = async () => {
    setSaving(true);
    const saved = await retrySavingPendingClip(clip.id);
    setSaving(false);
    if (!saved) {
      toastManager.add({
        type: "error",
        title: "Couldn't save the recording",
        description: "This browser refused to store it. Keep this window open.",
      });
    }
  };
  const insert = () => {
    if (transcript !== null && props.onInsert(transcript)) void discardPendingClip(clip.id);
  };
  const copy = async () => {
    if (transcript === null) return;
    const copied = await navigator.clipboard.writeText(transcript).then(
      () => true,
      () => false,
    );
    toastManager.add(
      copied
        ? { type: "success", title: "Transcript copied" }
        : { type: "error", title: "Couldn't copy the transcript" },
    );
  };

  return (
    <div className="flex min-w-0 items-center gap-2 py-1 text-sm text-foreground">
      {clip.status === "transcribing" ? <Spinner /> : <MicIcon className="size-4 shrink-0" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          Voice recording · {formatDuration(clip.durationMs)}
          {transcript ? <span className="text-muted-foreground"> · {transcript}</span> : null}
        </span>
        <span
          role={clip.status === "failed" ? "alert" : "status"}
          className="block truncate text-xs text-secondary-label"
        >
          {statusCopy(clip, connected)}
        </span>
      </span>
      {!clip.persisted ? (
        <Button size="xs" variant="ghost" disabled={saving} onClick={() => void retrySaving()}>
          Retry saving
        </Button>
      ) : null}
      {clip.status === "failed" || (clip.status === "waiting" && connected && clip.error) ? (
        <Button size="xs" variant="ghost" onClick={retry}>
          Retry
        </Button>
      ) : null}
      {transcript !== null ? (
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="xs"
                  variant="ghost"
                  aria-disabled={props.insertDisabledReason !== null}
                  onClick={() => {
                    if (props.insertDisabledReason === null) insert();
                  }}
                />
              }
            >
              Insert
            </TooltipTrigger>
            <TooltipPopup>{props.insertDisabledReason ?? "Insert at the cursor"}</TooltipPopup>
          </Tooltip>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Copy transcript"
            onClick={() => void copy()}
          >
            <CopyIcon />
          </Button>
        </>
      ) : null}
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Discard voice recording"
        onClick={() => void discardPendingClip(clip.id)}
      >
        <XIcon />
      </Button>
    </div>
  );
}
