import {
  EnvironmentId,
  MessageId,
  ThreadId,
  type OrchestrationV2ShellSnapshot,
} from "@supaterm/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as Option from "effect/Option";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { StartThreadTurnInput } from "../operations/commands.ts";
import { v2Now, v2ShellSnapshot, v2ThreadShell } from "./orchestrationV2TestFixtures.ts";
import type { AtomCommandResult } from "./runtime.ts";
import { createOptimisticThreadCreation } from "./threadCreation.ts";
import { isThreadWorking } from "./threadInbox.ts";
import { resolveThreadListDurationStartedAt } from "./threadTiming.ts";
import { createEnvironmentThreadShellAtoms } from "./threadShell.ts";
import { PrimaryConnectionTarget } from "../connection/model.ts";
import { sortActiveThreadsByOrderKey } from "./threadSort.ts";

const environmentId = EnvironmentId.make("environment");
const newThreadId = ThreadId.make("new-thread");
const input: StartThreadTurnInput = {
  threadId: newThreadId,
  createdAt: "2026-06-21T00:00:00.000Z",
  message: {
    messageId: MessageId.make("first-message"),
    role: "user",
    text: "Build a dashboard",
    attachments: [],
  },
  titleSeed: "Build a dashboard",
  runtimeMode: "full-access",
  interactionMode: "default",
  bootstrap: {
    createThread: {
      projectId: v2ThreadShell.projectId,
      title: "New thread",
      modelSelection: v2ThreadShell.modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
      worktreePath: null,
      createdAt: "2026-06-20T00:00:00.000Z",
    },
    prepareWorktree: { projectCwd: "/workspace/project", baseBranch: "main" },
  },
};

const registries: AtomRegistry.AtomRegistry[] = [];
afterEach(() => {
  for (const registry of registries) registry.dispose();
  registries.length = 0;
});

function makeHarness() {
  const source = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<OrchestrationV2ShellSnapshot | null>(v2ShellSnapshot),
  );
  const creation = createOptimisticThreadCreation(source);
  const registry = AtomRegistry.make();
  registries.push(registry);
  const sidebar = creation.snapshotAtom(environmentId);
  registry.mount(sidebar);
  const reply = Promise.withResolvers<AtomCommandResult<{ sequence: number }, Error>>();
  const command = {
    label: "start-turn",
    run: vi.fn(() => reply.promise),
  };
  const start = (turnInput = input, targetEnvironmentId = environmentId) =>
    creation.wrap(command).run(registry, {
      environmentId: targetEnvironmentId,
      input: turnInput,
    });
  return { registry, source, sidebar, reply, command, start, creation };
}

describe("optimistic thread creation", () => {
  it("shows a new worktree thread immediately without claiming a persisted message", async () => {
    const h = makeHarness();
    const result = h.start();
    expect(h.command.run).toHaveBeenCalledOnce();
    expect(h.registry.get(h.sidebar)?.threads.at(-1)).toMatchObject({
      id: newThreadId,
      title: "Build a dashboard",
      projectId: v2ThreadShell.projectId,
      modelSelection: v2ThreadShell.modelSelection,
      branch: null,
      worktreePath: null,
      status: "preparing",
      latestRunId: null,
      latestUserMessageAt: null,
      itemCount: 0,
    });
    expect(h.registry.get(h.source(environmentId))).toBe(v2ShellSnapshot);
    h.reply.resolve(AsyncResult.success({ sequence: 1 }));
    await result;
    expect(h.registry.get(h.sidebar)?.threads).toHaveLength(2);
  });

  it("keeps an accepted row through unrelated shell updates and replaces it exactly once", async () => {
    const h = makeHarness();
    const result = h.start();
    h.reply.resolve(AsyncResult.success({ sequence: 2 }));
    await result;
    h.registry.set(h.source(environmentId), { ...v2ShellSnapshot, snapshotSequence: 3 });
    expect(h.registry.get(h.sidebar)?.threads).toHaveLength(2);
    const confirmed = {
      ...v2ThreadShell,
      id: newThreadId,
      title: "Server title",
      worktreePath: "/workspace/worktrees/dashboard",
      latestUserMessageAt: v2Now,
    };
    const snapshot = {
      ...v2ShellSnapshot,
      snapshotSequence: 4,
      threads: [...v2ShellSnapshot.threads, confirmed],
    };
    h.registry.set(h.source(environmentId), snapshot);
    expect(h.registry.get(h.sidebar)).toBe(snapshot);
    expect(h.registry.get(h.sidebar)?.threads.at(-1)).toBe(confirmed);
    h.registry.set(h.source(environmentId), { ...v2ShellSnapshot, snapshotSequence: 5 });
    expect(h.registry.get(h.sidebar)?.threads).toHaveLength(1);
  });

  it("removes a rejected creation while preserving existing threads", async () => {
    const h = makeHarness();
    const result = h.start();
    h.reply.resolve(AsyncResult.fail(new Error("Launch rejected")));
    expect((await result)._tag).toBe("Failure");
    expect(h.registry.get(h.sidebar)).toBe(v2ShellSnapshot);
  });

  it("preserves a real thread when its shell arrives before a failed reply", async () => {
    const h = makeHarness();
    const result = h.start();
    const snapshot = {
      ...v2ShellSnapshot,
      threads: [...v2ShellSnapshot.threads, { ...v2ThreadShell, id: newThreadId }],
    };
    h.registry.set(h.source(environmentId), snapshot);
    expect(h.registry.get(h.sidebar)).toBe(snapshot);
    h.reply.resolve(AsyncResult.fail(new Error("Connection lost")));
    await result;
    expect(h.registry.get(h.sidebar)).toBe(snapshot);
  });

  it("isolates concurrent launches by environment and thread", async () => {
    const h = makeHarness();
    const otherEnvironmentId = EnvironmentId.make("other-environment");
    const otherThreadId = ThreadId.make("other-thread");
    const first = h.start();
    const second = h.start({ ...input, threadId: otherThreadId });
    const third = h.start(input, otherEnvironmentId);
    expect(h.registry.get(h.sidebar)?.threads.map((thread) => thread.id)).toEqual([
      v2ThreadShell.id,
      newThreadId,
      otherThreadId,
    ]);
    expect(
      h.registry
        .get(h.creation.snapshotAtom(otherEnvironmentId))
        ?.threads.map((thread) => thread.id),
    ).toEqual([v2ThreadShell.id, newThreadId]);
    h.reply.resolve(AsyncResult.fail(new Error("Launch rejected")));
    await Promise.all([first, second, third]);
    expect(h.registry.get(h.sidebar)).toBe(v2ShellSnapshot);
    expect(h.registry.get(h.creation.snapshotAtom(otherEnvironmentId))).toBe(v2ShellSnapshot);
  });

  it("does not preview sends to existing threads or launches without creation", async () => {
    const h = makeHarness();
    const existing = h.start({ ...input, threadId: v2ThreadShell.id });
    const normalInput = { ...input };
    delete normalInput.bootstrap;
    const normal = h.start(normalInput);
    expect(h.registry.get(h.sidebar)).toBe(v2ShellSnapshot);
    h.reply.resolve(AsyncResult.success({ sequence: 1 }));
    await Promise.all([existing, normal]);
    expect(h.registry.get(h.sidebar)).toBe(v2ShellSnapshot);
  });

  it("shows retries as one row and preserves the remaining launch after a rejection", async () => {
    const h = makeHarness();
    const secondReply = Promise.withResolvers<AtomCommandResult<{ sequence: number }, Error>>();
    h.command.run.mockReturnValueOnce(h.reply.promise).mockReturnValueOnce(secondReply.promise);
    const first = h.start();
    const second = h.start();
    expect(h.registry.get(h.sidebar)?.threads).toHaveLength(2);
    h.reply.resolve(AsyncResult.fail(new Error("First attempt rejected")));
    await first;
    expect(h.registry.get(h.sidebar)?.threads).toHaveLength(2);
    secondReply.resolve(AsyncResult.success({ sequence: 1 }));
    await second;
    expect(h.registry.get(h.sidebar)?.threads).toHaveLength(2);
  });

  it("shows the row in both sidebar lists while server refs and point reads stay unchanged", async () => {
    const h = makeHarness();
    const catalogValueAtom = Atom.make({
      isReady: true,
      entries: new Map([
        [
          environmentId,
          {
            target: new PrimaryConnectionTarget({
              environmentId,
              label: "Environment",
              httpBaseUrl: "https://example.test",
              wsBaseUrl: "wss://example.test",
            }),
            profile: Option.none(),
            enabled: true,
          },
        ],
      ]),
    });
    const server = createEnvironmentThreadShellAtoms({ catalogValueAtom, snapshotAtom: h.source });
    const sidebar = createEnvironmentThreadShellAtoms({
      catalogValueAtom,
      snapshotAtom: h.creation.snapshotAtom,
    });
    const projectList = sidebar.threadShellsForProjectRefsAtom([
      { environmentId, projectId: v2ThreadShell.projectId },
    ]);
    h.registry.mount(sidebar.threadShellsAtom);
    h.registry.mount(projectList);
    const result = h.start();
    const rows = h.registry.get(sidebar.threadShellsAtom);
    expect(rows.map((thread) => thread.id)).toEqual([v2ThreadShell.id, newThreadId]);
    expect(isThreadWorking(rows.at(-1)!)).toBe(true);
    expect(resolveThreadListDurationStartedAt(rows.at(-1)!)).toBe(input.createdAt);
    expect(sortActiveThreadsByOrderKey(rows).map((thread) => thread.id)).toEqual([
      newThreadId,
      v2ThreadShell.id,
    ]);
    expect(h.registry.get(projectList)).toEqual(rows);
    expect(h.registry.get(server.threadRefsAtom)).toEqual([
      { environmentId, threadId: v2ThreadShell.id },
    ]);
    expect(
      h.registry.get(server.threadShellAtom({ environmentId, threadId: newThreadId })),
    ).toBeNull();
    h.reply.resolve(AsyncResult.fail(new Error("Launch rejected")));
    await result;
    expect(h.registry.get(sidebar.threadShellsAtom)).toHaveLength(1);
    expect(h.registry.get(projectList)).toHaveLength(1);
  });
});
