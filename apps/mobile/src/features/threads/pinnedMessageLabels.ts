import type { ThreadPinnedMessage } from "@supaterm/contracts";

const PIN_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function pinnedMessageTitle(pin: ThreadPinnedMessage): string {
  return pin.preview === "" ? "Message with attachments" : pin.preview;
}

export function pinnedMessageCaption(pin: ThreadPinnedMessage): string {
  const sentAt = Date.parse(pin.sentAt);
  const author = pin.role === "user" ? "You" : "Agent";
  return Number.isNaN(sentAt) ? author : `${author} · ${PIN_TIME_FORMATTER.format(sentAt)}`;
}
