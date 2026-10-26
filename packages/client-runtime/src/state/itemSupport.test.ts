import {
  NodeId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  TurnItemId,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { v2Projection, v2ThreadId } from "./orchestrationV2TestFixtures.ts";
import { EMPTY_V2_ITEM_SUPPORT, resolveV2ItemSupport, v2ItemSupportEqual } from "./itemSupport.ts";

const now = DateTime.makeUnsafe("2026-06-20T00:00:00.000Z");
const runId = RunId.make("run-1");
const nodeId = NodeId.make("node-1");
const itemId = TurnItemId.make("item-1");
const providerInstanceId = ProviderInstanceId.make("codex");
const providerSessionId = ProviderSessionId.make("provider-session-1");
const providerThreadId = ProviderThreadId.make("provider-thread-1");
const providerTurnId = ProviderTurnId.make("provider-turn-1");

const commandItem: OrchestrationV2TurnItem = {
  id: itemId,
  threadId: v2ThreadId,
  runId,
  nodeId,
  providerThreadId,
  providerTurnId,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 0,
  status: "running",
  title: null,
  startedAt: now,
  completedAt: null,
  updatedAt: now,
  type: "command_execution",
  input: "vp check",
};

const providerThread: OrchestrationV2ThreadProjection["providerThreads"][number] = {
  id: providerThreadId,
  driver: ProviderDriverKind.make("codex"),
  providerInstanceId,
  providerSessionId,
  appThreadId: v2ThreadId,
  ownerNodeId: nodeId,
  nativeThreadRef: null,
  nativeConversationHeadRef: null,
  status: "active",
  firstRunOrdinal: 1,
  lastRunOrdinal: 1,
  handoffIds: [],
  forkedFrom: null,
  createdAt: now,
  updatedAt: now,
};

const providerSession = {
  id: providerSessionId,
} as unknown as OrchestrationV2ThreadProjection["providerSessions"][number];

describe("resolveV2ItemSupport", () => {
  it("links a turn item to its provider session through its provider thread", () => {
    const support = resolveV2ItemSupport(
      {
        ...v2Projection,
        providerThreads: [providerThread],
        providerSessions: [providerSession],
        turnItems: [commandItem],
      },
      itemId,
    );

    expect(support.providerSession).toBe(providerSession);
    expect(support.contextHandoff).toBeNull();
    expect(support.contextTransfer).toBeNull();
  });

  it("resolves synthetic items from the authoritative visible sequence", () => {
    const projection = {
      ...v2Projection,
      providerThreads: [providerThread],
      providerSessions: [providerSession],
      visibleTurnItems: [
        {
          position: 0,
          visibility: "synthetic" as const,
          sourceThreadId: v2ThreadId,
          sourceItemId: itemId,
          item: commandItem,
        },
      ],
    };

    expect(resolveV2ItemSupport(projection, itemId).providerSession).toBe(providerSession);
  });

  it("links a handoff item to its context handoff and transfer", () => {
    const contextHandoff = {
      id: "handoff-1",
      transferId: "transfer-1",
    } as unknown as OrchestrationV2ThreadProjection["contextHandoffs"][number];
    const contextTransfer = {
      id: "transfer-1",
    } as unknown as OrchestrationV2ThreadProjection["contextTransfers"][number];
    const handoffItem = {
      ...commandItem,
      providerThreadId: null,
      type: "handoff",
      contextHandoffId: "handoff-1",
    } as unknown as OrchestrationV2TurnItem;

    const support = resolveV2ItemSupport(
      {
        ...v2Projection,
        contextHandoffs: [contextHandoff],
        contextTransfers: [contextTransfer],
        turnItems: [handoffItem],
      },
      itemId,
    );

    expect(support.contextHandoff).toBe(contextHandoff);
    expect(support.contextTransfer).toBe(contextTransfer);
    expect(support.providerSession).toBeNull();
  });

  it("compares support by entity identity", () => {
    expect(v2ItemSupportEqual(EMPTY_V2_ITEM_SUPPORT, { ...EMPTY_V2_ITEM_SUPPORT })).toBe(true);
    expect(
      v2ItemSupportEqual(EMPTY_V2_ITEM_SUPPORT, {
        ...EMPTY_V2_ITEM_SUPPORT,
        providerSession,
      }),
    ).toBe(false);
  });
});
