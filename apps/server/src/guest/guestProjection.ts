import type {
  OrchestrationV2DomainEvent,
  OrchestrationV2ThreadStreamItem,
  OrchestrationV2TurnItem,
} from "@supaterm/contracts";

export function sanitizeGuestTurnItem(item: OrchestrationV2TurnItem): OrchestrationV2TurnItem {
  if (item.type !== "file_change") return item;
  const { diffStr: _diff, oldStr: _old, newStr: _new, ...projected } = item;
  return projected;
}

export function sanitizeGuestDomainEvent(
  event: OrchestrationV2DomainEvent,
): OrchestrationV2DomainEvent {
  return event.type === "turn-item.updated"
    ? { ...event, payload: sanitizeGuestTurnItem(event.payload) }
    : event;
}

export function sanitizeGuestSnapshot(
  snapshot: Extract<OrchestrationV2ThreadStreamItem, { readonly kind: "snapshot" }>,
) {
  return {
    ...snapshot,
    projection: {
      ...snapshot.projection,
      turnItems: snapshot.projection.turnItems.map(sanitizeGuestTurnItem),
      visibleTurnItems: snapshot.projection.visibleTurnItems.map((row) => ({
        ...row,
        item: sanitizeGuestTurnItem(row.item),
      })),
    },
  };
}
