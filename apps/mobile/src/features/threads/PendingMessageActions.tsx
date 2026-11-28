import { msg, useGT } from "gt-react-native";
import { Pressable, type ColorValue } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import * as Dialog from "../../components/ui/Dialog";
import type { QueuedThreadMessage } from "../../state/thread-outbox-model";
import { removeThreadOutboxMessage } from "../../state/thread-outbox-removal";
import { m } from "../../i18n/messages";

function discard(message: QueuedThreadMessage) {
  Dialog.confirm({
    title: m(msg("Discard voice message?")),
    message: m(msg("The recording will be deleted.")),
    confirmText: m(msg("Discard", { $context: "verb, deletes the voice recording" })),
    destructive: true,
    onConfirm: () => {
      void removeThreadOutboxMessage(message).catch((error: unknown) => {
        Dialog.alert(
          m(msg("Could not discard the message")),
          error instanceof Error ? error.message : m(msg("Try again.")),
        );
      });
    },
  });
}

/** Only a legacy voice message stops, and its bare recording is not worth sending. */
export function PendingMessageActions(props: {
  readonly message: QueuedThreadMessage;
  readonly iconColor: ColorValue;
}) {
  const gt = useGT();
  const { message } = props;
  if (message.failure === undefined) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={gt("Discard voice message")}
      hitSlop={8}
      className="size-7 items-center justify-center"
      onPress={() => discard(message)}
    >
      <SymbolView name="trash" size={14} tintColor={props.iconColor} />
    </Pressable>
  );
}
