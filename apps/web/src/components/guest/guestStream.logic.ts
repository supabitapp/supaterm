import {
  GUEST_ATTACHMENT_ROUTE,
  GUEST_MEDIA_ROUTE,
  GUEST_MESSAGE_MAX_ATTACHMENT_BYTES,
  GUEST_MESSAGE_MAX_ATTACHMENTS,
  GUEST_SHARE_PARAM,
  GuestStreamEvent,
  isProviderSendTurnSupportedImageMimeType,
  type GuestMessageId,
  type GuestShareView,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
  type ThreadGuestMessage,
} from "@supaterm/contracts";
import { applyOrchestrationV2ProjectionEvent } from "@supaterm/client-runtime/state/orchestration-v2-projection";
import { boundedSnapshotProjection } from "@supaterm/shared/orchestrationV2BoundedSnapshot";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export interface GuestStreamState {
  readonly view: GuestShareView | null;
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly sequence: number;
  readonly partial: { readonly latestLocalTurnOrdinal: number | null } | null;
  readonly ended: boolean;
  readonly awaitingRowIds: ReadonlySet<GuestMessageId>;
}

export const initialGuestStreamState: GuestStreamState = {
  view: null,
  projection: null,
  sequence: 0,
  partial: null,
  ended: false,
  awaitingRowIds: new Set(),
};

const guestMessageIdOf = (item: OrchestrationV2TurnItem) =>
  item.type === "user_message" ? item.context?.guest?.guestMessageId : undefined;

function withPendingFrom(
  awaiting: ReadonlySet<GuestMessageId>,
  view: GuestShareView,
): ReadonlySet<GuestMessageId> {
  const pending = view.messages.filter((message) => message.status === "pending");
  if (pending.every((message) => awaiting.has(message.id))) return awaiting;
  return new Set([...awaiting, ...pending.map((message) => message.id)]);
}

function withoutPlaced(
  awaiting: ReadonlySet<GuestMessageId>,
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): ReadonlySet<GuestMessageId> {
  const placed = items.flatMap((item) => {
    const id = guestMessageIdOf(item);
    return id !== undefined && awaiting.has(id) ? [id] : [];
  });
  if (placed.length === 0) return awaiting;
  const next = new Set(awaiting);
  for (const id of placed) next.delete(id);
  return next;
}

const decodeGuestStreamEvent = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.toCodecJson(GuestStreamEvent)),
);

export const parseGuestStreamEvent = (data: string): GuestStreamEvent | null =>
  Option.getOrNull(decodeGuestStreamEvent(data));

export function applyGuestStreamEvent(
  state: GuestStreamState,
  event: GuestStreamEvent,
): GuestStreamState {
  switch (event.type) {
    case "view":
      if (state.view !== null && state.view.shareId !== event.view.shareId) {
        return { ...state, ended: true };
      }
      return {
        ...state,
        view: event.view,
        awaitingRowIds: withPendingFrom(state.awaitingRowIds, event.view),
      };
    case "thread": {
      const item = event.item;
      if (item.kind === "snapshot") {
        const projection = boundedSnapshotProjection(item);
        return {
          ...state,
          projection,
          sequence: item.snapshotSequence,
          partial:
            item.hasMoreHistory === true || (item.historyCursor ?? null) !== null
              ? { latestLocalTurnOrdinal: item.latestLocalTurnOrdinal ?? null }
              : null,
          awaitingRowIds: withoutPlaced(
            state.awaitingRowIds,
            projection.visibleTurnItems.map((row) => row.item),
          ),
        };
      }
      if (item.kind === "synchronized" || item.sequence <= state.sequence) return state;
      if (item.kind === "unknown-event") return { ...state, sequence: item.sequence };
      const projection =
        applyOrchestrationV2ProjectionEvent(
          state.projection,
          item.event,
          state.partial === null ? undefined : { partialTimeline: true, ...state.partial },
        ) ?? state.projection;
      const turnItem = item.event.type === "turn-item.updated" ? item.event.payload : null;
      const watermark = state.partial?.latestLocalTurnOrdinal ?? null;
      return {
        ...state,
        projection,
        sequence: item.sequence,
        partial:
          state.partial !== null &&
          turnItem !== null &&
          (watermark === null || turnItem.ordinal > watermark)
            ? { latestLocalTurnOrdinal: turnItem.ordinal }
            : state.partial,
        awaitingRowIds:
          turnItem === null
            ? state.awaitingRowIds
            : withoutPlaced(state.awaitingRowIds, [turnItem]),
      };
    }
    case "ended":
      return { ...state, ended: true };
  }
}

export function unplacedGuestMessages(
  messages: ReadonlyArray<ThreadGuestMessage>,
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  awaitingRowIds: ReadonlySet<GuestMessageId>,
): ReadonlyArray<ThreadGuestMessage> {
  const placed = new Set(items.flatMap((row) => guestMessageIdOf(row.item) ?? []));
  return messages
    .filter(
      (message) =>
        !placed.has(message.id) && (message.status === "pending" || awaitingRowIds.has(message.id)),
    )
    .toSorted((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

export function formatGuestExpiry(expiresAt: string, nowMs: number): string {
  const minutes = Math.floor((Date.parse(expiresAt) - nowMs) / 60_000);
  if (minutes <= 0) return "Expired";
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h left` : `${minutes}m left`;
}

export function inviteShareId(credential: string): string | null {
  const [shareId, signature] = credential.split(".");
  return shareId && signature ? shareId : null;
}

export const guestAttachmentUrl = (shareId: string, attachmentId: string) =>
  `${GUEST_ATTACHMENT_ROUTE}?${GUEST_SHARE_PARAM}=${encodeURIComponent(shareId)}&id=${encodeURIComponent(attachmentId)}`;

export const guestMediaUrl = (shareId: string, path: string) =>
  `${GUEST_MEDIA_ROUTE}?${GUEST_SHARE_PARAM}=${encodeURIComponent(shareId)}&path=${encodeURIComponent(path)}`;

export function guestFilesProblem(
  files: ReadonlyArray<Pick<File, "type" | "size">>,
): string | null {
  if (files.length > GUEST_MESSAGE_MAX_ATTACHMENTS) {
    return `Attach up to ${GUEST_MESSAGE_MAX_ATTACHMENTS} files to a message.`;
  }
  if (files.reduce((total, file) => total + file.size, 0) > GUEST_MESSAGE_MAX_ATTACHMENT_BYTES) {
    return "Attached files can total up to 10 MB per message.";
  }
  const unsupported = files.some(
    (file) =>
      file.size === 0 ||
      (file.type.toLowerCase().startsWith("image/") &&
        !isProviderSendTurnSupportedImageMimeType(file.type)),
  );
  return unsupported
    ? "This file cannot be attached. Images must be PNG, JPEG, GIF, or WebP."
    : null;
}

export function createGuestAttachmentUrls(shareId: string) {
  let previousItems: ReadonlyArray<OrchestrationV2ProjectedTurnItem> | null = null;
  let previous: ReadonlyMap<string, string> = new Map();
  return (items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>): ReadonlyMap<string, string> => {
    if (items === previousItems) return previous;
    previousItems = items;
    previous = new Map(
      items.flatMap(({ item }) =>
        item.type === "user_message"
          ? item.attachments.map(
              (attachment) => [attachment.id, guestAttachmentUrl(shareId, attachment.id)] as const,
            )
          : [],
      ),
    );
    return previous;
  };
}
