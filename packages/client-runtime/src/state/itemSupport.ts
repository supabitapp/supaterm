import type { OrchestrationV2ThreadProjection, TurnItemId } from "@supaterm/contracts";

type Projection = OrchestrationV2ThreadProjection;

export interface V2ItemSupport {
  readonly providerSession: Projection["providerSessions"][number] | null;
  readonly contextHandoff: Projection["contextHandoffs"][number] | null;
  readonly contextTransfer: Projection["contextTransfers"][number] | null;
}

export const EMPTY_V2_ITEM_SUPPORT: V2ItemSupport = Object.freeze({
  providerSession: null,
  contextHandoff: null,
  contextTransfer: null,
});

export function resolveV2ItemSupport(projection: Projection, itemId: TurnItemId): V2ItemSupport {
  const item =
    projection.turnItems.find((candidate) => candidate.id === itemId) ??
    projection.visibleTurnItems.find((candidate) => candidate.sourceItemId === itemId)?.item ??
    null;
  if (item === null) return EMPTY_V2_ITEM_SUPPORT;

  const providerThread =
    item.providerThreadId === null || item.providerThreadId === undefined
      ? null
      : (projection.providerThreads.find((candidate) => candidate.id === item.providerThreadId) ??
        null);
  const providerSession =
    providerThread?.providerSessionId == null
      ? null
      : (projection.providerSessions.find(
          (candidate) => candidate.id === providerThread.providerSessionId,
        ) ?? null);
  const contextHandoff =
    item.type === "handoff"
      ? (projection.contextHandoffs.find((candidate) => candidate.id === item.contextHandoffId) ??
        null)
      : null;
  const contextTransfer =
    contextHandoff?.transferId == null
      ? null
      : (projection.contextTransfers.find(
          (candidate) => candidate.id === contextHandoff.transferId,
        ) ?? null);

  return { providerSession, contextHandoff, contextTransfer };
}

export function v2ItemSupportEqual(left: V2ItemSupport, right: V2ItemSupport): boolean {
  return (
    left.providerSession === right.providerSession &&
    left.contextHandoff === right.contextHandoff &&
    left.contextTransfer === right.contextTransfer
  );
}
