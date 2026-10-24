import { useAtomValue } from "@effect/atom-react";
import {
  RETRY_SAVED_RECORDING,
  type SavedRecordingEntry,
} from "@supaterm/client-runtime/voice-input";
import { Pressable, View } from "react-native";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Chip } from "../../components/ui/Chip";
import { cn } from "../../lib/cn";
import { dictationReachableAtom } from "../../state/dictation";
import { savedVoiceRecordings, usePendingVoiceRecordings } from "./pendingVoiceRecordings";
import { voiceRecordingRunner } from "./transcribeVoiceRecording";
import {
  formatVoiceRecordingDuration,
  voiceRecordingRetry,
  voiceRecordingStatus,
} from "./voiceInputPresentation";

/** Recordings saved for this draft whose transcript has not landed in it. */
export function PendingVoiceRecordingList(props: {
  readonly ownerKey: string | null;
  readonly insertDisabled?: boolean;
  readonly onInsert: (transcript: string) => boolean;
  readonly className?: string;
}) {
  const recordings = usePendingVoiceRecordings(props.ownerKey);
  if (recordings.length === 0) return null;
  return (
    <View className={cn("gap-1", props.className)}>
      {recordings.map((recording) => (
        <PendingVoiceRecordingRow
          key={recording.id}
          recording={recording}
          insertDisabled={props.insertDisabled ?? false}
          onInsert={props.onInsert}
        />
      ))}
    </View>
  );
}

function PendingVoiceRecordingRow(props: {
  readonly recording: SavedRecordingEntry;
  readonly insertDisabled: boolean;
  readonly onInsert: (transcript: string) => boolean;
}) {
  const { recording } = props;
  const reachable = useAtomValue(dictationReachableAtom(recording.environmentId));
  const retry = voiceRecordingRetry(recording, reachable);
  const transcript = recording.status === "ready" ? recording.transcript : null;
  const status = voiceRecordingStatus(recording, reachable);
  const duration = formatVoiceRecordingDuration(recording.durationMs);
  return (
    <View className="min-h-11 flex-row items-center gap-2">
      {recording.status === "transcribing" ? (
        <AppActivityIndicator size="small" colorClassName="accent-icon-muted" />
      ) : (
        <SymbolView name="mic" size={16} tintColorClassName="accent-icon-muted" type="monochrome" />
      )}
      <View
        accessible
        accessibilityLabel={`Voice recording, ${duration}. ${status}`}
        className="min-w-0 flex-1"
      >
        <Text className="text-sm text-foreground" numberOfLines={1}>
          Voice recording · {duration}
          {transcript ? <Text className="text-foreground-muted"> · {transcript}</Text> : null}
        </Text>
        <Text
          accessibilityLiveRegion="polite"
          className={cn(
            "text-xs",
            recording.status === "failed" ? "text-danger-foreground" : "text-foreground-muted",
          )}
          numberOfLines={2}
        >
          {status}
        </Text>
      </View>
      {recording.persisted ? null : (
        <Chip
          size="small"
          label="Save"
          accessibilityLabel="Save recording on this device"
          onPress={() => void savedVoiceRecordings.retrySave(recording.id)}
        />
      )}
      {retry ? (
        <Chip
          size="small"
          label="Retry"
          accessibilityLabel="Retry transcription"
          disabled={retry === "disabled"}
          onPress={() => {
            if (reachable) void voiceRecordingRunner.retry(recording.id);
            else void savedVoiceRecordings.update(recording.id, RETRY_SAVED_RECORDING);
          }}
        />
      ) : null}
      {transcript !== null ? (
        <Chip
          size="small"
          label="Insert"
          accessibilityLabel="Insert transcript at the cursor"
          disabled={props.insertDisabled}
          onPress={() => {
            if (props.onInsert(transcript)) void savedVoiceRecordings.discard(recording.id);
          }}
        />
      ) : null}
      <Pressable
        accessibilityLabel="Discard voice recording"
        accessibilityRole="button"
        className="size-8 items-center justify-center active:opacity-70"
        hitSlop={6}
        onPress={() => void savedVoiceRecordings.discard(recording.id)}
      >
        <SymbolView
          name="xmark"
          size={12}
          tintColorClassName="accent-icon-muted"
          type="monochrome"
        />
      </Pressable>
    </View>
  );
}
