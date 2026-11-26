import type { ThreadPinnedMessage } from "@supaterm/contracts";
import { msg } from "gt-react-native";

import { m, type MessageResolver } from "../../i18n/messages";

const PIN_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function pinnedMessageTitle(pin: ThreadPinnedMessage, resolve: MessageResolver = m): string {
  return pin.preview === "" ? resolve(msg("Message with attachments")) : pin.preview;
}

export function pinnedMessageCaption(
  pin: ThreadPinnedMessage,
  resolve: MessageResolver = m,
): string {
  const sentAt = Date.parse(pin.sentAt);
  const time = Number.isNaN(sentAt) ? "" : PIN_TIME_FORMATTER.format(sentAt);
  if (pin.role !== "user") return time;
  return time === ""
    ? resolve(msg("You", { $context: "author of a pinned message" }))
    : resolve(msg("You · {time}", { time }));
}
