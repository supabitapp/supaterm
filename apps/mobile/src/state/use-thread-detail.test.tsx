import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentThreadDetailAtoms,
  EMPTY_ENVIRONMENT_THREAD_STATE,
  type EnvironmentThreadState,
} from "@supaterm/client-runtime/state/threads";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import { CommandId, EnvironmentId, MessageId } from "@supaterm/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { v2Projection } from "../../../../packages/client-runtime/src/state/orchestrationV2TestFixtures";
import { appAtomRegistry } from "./atom-registry";
import {
  pendingThreadCreationOutcomesAtom,
  pendingThreadCreationShell,
  recordPendingThreadCreationOutcome,
} from "./pending-thread-creation";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { useSelectedThreadComposerMetadata } from "./use-thread-detail";

const transport = vi.hoisted(() => ({ serverCreated: false, snapshotRequests: 0 }));
const environmentId = EnvironmentId.make("environment-1");
const threadId = v2Projection.thread.id;
const threadKey = `${environmentId}:${threadId}`;
const message: QueuedThreadMessage = {
  environmentId,
  threadId,
  commandId: CommandId.make("create-thread"),
  messageId: MessageId.make("first-message"),
  text: "Check the thread",
  attachments: [],
  modelSelection: v2Projection.thread.modelSelection,
  runtimeMode: "full-access",
  createdAt: "2026-10-04T18:30:00.000Z",
  creation: {
    projectId: v2Projection.thread.projectId,
    workspaceMode: "local",
    branch: null,
    worktreePath: null,
  },
};
const shellAtom = Atom.make<EnvironmentThreadShell | null>(null);
const queueAtom = Atom.make<Readonly<Record<string, ReadonlyArray<QueuedThreadMessage>>>>({});
const emptyStateAtom = Atom.make(AsyncResult.success(EMPTY_ENVIRONMENT_THREAD_STATE));
const stateAtom = Atom.make(() => {
  transport.snapshotRequests += 1;
  return AsyncResult.success<EnvironmentThreadState>(
    transport.serverCreated
      ? { ...EMPTY_ENVIRONMENT_THREAD_STATE, data: Option.some(v2Projection), status: "live" }
      : { ...EMPTY_ENVIRONMENT_THREAD_STATE, status: "deleted" },
  );
}).pipe(Atom.setIdleTTL(0));
const details = createEnvironmentThreadDetailAtoms(() => stateAtom);

vi.mock("@react-navigation/native", () => ({
  useRoute: () => ({ params: { environmentId, threadId } }),
}));
vi.mock("./entities", () => ({
  useQuietThreadShell: () => useAtomValue(shellAtom),
  useProject: () => null,
}));
vi.mock("./threads", () => ({
  get environmentThreadDetails() {
    return details;
  },
  useEnvironmentThread: (environment: unknown, thread: unknown) => {
    const state = useAtomValue(
      environment === null || thread === null ? emptyStateAtom : stateAtom,
    );
    return Option.getOrThrow(AsyncResult.value(state));
  },
}));
vi.mock("./use-thread-outbox", () => ({
  useThreadOutboxMessages: () => useAtomValue(queueAtom),
}));
vi.mock("./use-remote-environment-registry", () => ({
  useRemoteEnvironmentRuntime: () => null,
  useSavedRemoteConnection: () => null,
}));

let renderer: ReactTestRenderer | null = null;
function Probe() {
  useSelectedThreadComposerMetadata();
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  transport.serverCreated = false;
  transport.snapshotRequests = 0;
  appAtomRegistry.set(shellAtom, null);
  appAtomRegistry.set(queueAtom, { [threadKey]: [message] });
  appAtomRegistry.set(pendingThreadCreationOutcomesAtom, {});
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

async function openThread() {
  await act(() => {
    renderer = create(
      <RegistryContext.Provider value={appAtomRegistry}>
        <Probe />
      </RegistryContext.Provider>,
    );
  });
}

describe("selected thread detail readers", () => {
  it("waits for queued creation delivery before requesting the thread snapshot", async () => {
    await openThread();
    expect(transport.snapshotRequests).toBe(0);

    transport.serverCreated = true;
    await act(() => {
      recordPendingThreadCreationOutcome({ kind: "delivered", message });
      appAtomRegistry.set(queueAtom, {});
    });
    expect(transport.snapshotRequests).toBe(1);
    expect(Option.getOrThrow(AsyncResult.value(appAtomRegistry.get(stateAtom))).status).toBe(
      "live",
    );
  });

  it("starts reading when the server shell arrives before creation delivery returns", async () => {
    await openThread();
    expect(transport.snapshotRequests).toBe(0);

    transport.serverCreated = true;
    await act(() => appAtomRegistry.set(shellAtom, pendingThreadCreationShell(message)));
    expect(transport.snapshotRequests).toBe(1);
  });

  it("does not request a snapshot for a rejected creation", async () => {
    await openThread();
    await act(() => {
      recordPendingThreadCreationOutcome({ kind: "failed", message, reason: "Launch failed" });
      appAtomRegistry.set(queueAtom, {});
    });
    expect(transport.snapshotRequests).toBe(0);
  });
});
