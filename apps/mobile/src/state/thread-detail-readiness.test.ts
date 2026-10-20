import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import { CommandId, EnvironmentId, MessageId, ProjectId, ThreadId } from "@supaterm/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { scopedThreadKey } from "../lib/scopedEntities";
import { makeThreadShellFixture } from "../test-fixtures";
import type { PendingThreadCreationOutcome } from "./pending-thread-creation";
import { createThreadDetailReadiness } from "./thread-detail-readiness";
import type { QueuedThreadMessage } from "./thread-outbox-model";

const ref = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
};
const key = scopedThreadKey(ref.environmentId, ref.threadId);
const message: QueuedThreadMessage = {
  ...ref,
  commandId: CommandId.make("create"),
  messageId: MessageId.make("prompt"),
  text: "Inspect this image",
  attachments: [],
  createdAt: "2026-10-20T00:00:00.000Z",
  creation: {
    projectId: ProjectId.make("project"),
    workspaceMode: "local",
    branch: null,
    worktreePath: null,
  },
};
let registry: AtomRegistry.AtomRegistry;

beforeEach(() => {
  registry = AtomRegistry.make();
});

afterEach(() => registry.dispose());

function harness() {
  const shells = Atom.family((_key: string) => Atom.make<EnvironmentThreadShell | null>(null));
  const outcomes = Atom.make<Readonly<Record<string, PendingThreadCreationOutcome>>>({});
  const queued = Atom.make<Readonly<Record<string, ReadonlyArray<QueuedThreadMessage>>>>({
    [key]: [message],
  });
  const ready = createThreadDetailReadiness({
    threadShellAtom: (target) => shells(scopedThreadKey(target.environmentId, target.threadId)),
    outcomesAtom: outcomes,
    queuedMessagesAtom: queued,
  });
  const atom = ready(ref);
  registry.mount(atom);
  return { atom, ready, shells, outcomes, queued };
}

describe("thread detail readiness", () => {
  it("waits for creation delivery and stays ready when the queued message is removed", () => {
    const h = harness();
    expect(registry.get(h.atom)).toBe(false);
    registry.set(h.outcomes, { [key]: { kind: "delivered", message } });
    expect(registry.get(h.atom)).toBe(true);
    registry.set(h.queued, {});
    registry.set(h.outcomes, {});
    expect(registry.get(h.atom)).toBe(true);
  });

  it("starts reading when the server shell arrives before delivery returns", () => {
    const h = harness();
    expect(registry.get(h.atom)).toBe(false);
    registry.set(
      h.shells(key),
      makeThreadShellFixture({ environmentId: ref.environmentId, id: ref.threadId }),
    );
    expect(registry.get(h.atom)).toBe(true);
  });

  it("keeps failed creations blocked through retry until delivery succeeds", () => {
    const h = harness();
    registry.set(h.outcomes, { [key]: { kind: "failed", message, reason: "Launch failed" } });
    registry.set(h.queued, {});
    expect(registry.get(h.atom)).toBe(false);
    registry.set(h.queued, { [key]: [message] });
    registry.set(h.outcomes, {});
    expect(registry.get(h.atom)).toBe(false);
    registry.set(h.outcomes, { [key]: { kind: "delivered", message } });
    expect(registry.get(h.atom)).toBe(true);
  });

  it("loads existing routes without a shell and ignores ordinary follow-up messages", () => {
    const h = harness();
    registry.set(h.queued, {});
    expect(registry.get(h.atom)).toBe(true);
    const { creation: _creation, ...followUp } = message;
    registry.set(h.queued, { [key]: [followUp] });
    expect(registry.get(h.atom)).toBe(true);
  });

  it("isolates the same thread ID across environments", () => {
    const h = harness();
    expect(registry.get(h.atom)).toBe(false);
    expect(registry.get(h.ready({ ...ref, environmentId: EnvironmentId.make("other") }))).toBe(
      true,
    );
  });

  it("does not restart a ready reader when unrelated outbox state changes", () => {
    const h = harness();
    registry.set(h.queued, {});
    let starts = 0;
    registry.mount(
      Atom.make((get) => {
        if (get(h.atom)) starts += 1;
      }),
    );
    expect(starts).toBe(1);
    registry.set(h.queued, { "other:thread": [message] });
    registry.set(h.outcomes, { "other:thread": { kind: "delivered", message } });
    expect(starts).toBe(1);
  });
});
