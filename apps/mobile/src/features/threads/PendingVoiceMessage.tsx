import { Pressable, View, type ColorValue } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { DictationElapsedTime } from "../voice-input/ComposerDictationControl";
import { retryHeldThreadOutboxMessage } from "../../state/thread-outbox";
import type { QueuedThreadMessage, QueuedVoiceRecording } from "../../state/thread-outbox-model";
import { removeThreadOutboxMessage } from "../../state/thread-outbox-removal";

export function PendingVoiceMessageBody(props: { readonly voice: QueuedVoiceRecording }) {
  const seconds = Math.max(1, Math.round(props.voice.durationMs / 1000));
  return (
    <View
      accessible
      accessibilityLabel={`Voice message, ${seconds} seconds`}
      className="flex-row items-center gap-2"
    >
      <SymbolView
        name="mic"
        size={14}
        weight="medium"
        tintColorClassName="accent-user-bubble-foreground-muted"
        type="monochrome"
      />
      <Text className="font-supaterm-medium text-sm text-user-bubble-foreground">
        Voice message
      </Text>
      <DictationElapsedTime className="text-user-bubble-foreground-muted" seconds={seconds} />
    </View>
  );
}

function discard(message: QueuedThreadMessage) {
  Dialog.confirm({
    title: "Discard voice message?",
    message: "The recording will be deleted.",
    confirmText: "Discard",
    destructive: true,
    onConfirm: () => {
      void removeThreadOutboxMessage(message).catch((error: unknown) => {
        Dialog.alert(
          "Could not discard the message",
          error instanceof Error ? error.message : "Try again.",
        );
      });
    },
  });
}

/** Retry for a message whose delivery stopped, and discard for a recording. */
export function PendingMessageActions(props: {
  readonly message: QueuedThreadMessage;
  readonly iconColor: ColorValue;
}) {
  const { message } = props;
  return (
    <>
      {message.failure !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try sending again"
          hitSlop={8}
          className="size-7 items-center justify-center"
          onPress={() => void retryHeldThreadOutboxMessage(message)}
        >
          <SymbolView name="arrow.clockwise" size={14} tintColor={props.iconColor} />
        </Pressable>
      ) : null}
      {message.voice ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Discard voice message"
          hitSlop={8}
          className="size-7 items-center justify-center"
          onPress={() => discard(message)}
        >
          <SymbolView name="trash" size={14} tintColor={props.iconColor} />
        </Pressable>
      ) : null}
    </>
  );
}
