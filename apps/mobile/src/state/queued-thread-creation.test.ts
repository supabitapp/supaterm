import "./threadOutbox.test-support";
import { ProjectId } from "@supaterm/contracts";
import { ProviderInstanceId } from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { appAtomRegistry } from "./atom-registry";
import { editingQueuedMessageIdsAtom } from "./use-thread-outbox";
import { prepareQueuedThreadCreation } from "./queued-thread-creation";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import type { VcsListRefsResult } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { harness, queuedMessage, remainingMessages } from "./threadOutbox.test-support";

describe("queued worktree branch resolution", () => {
  const refs: VcsListRefsResult = {
    isRepo: true,
    hasPrimaryRemote: true,
    nextCursor: null,
    totalCount: 2,
    refs: [
      {
        name: "feature/current",
        current: true,
        isDefault: false,
        isRemote: false,
        worktreePath: null,
      },
      { name: "main", current: false, isDefault: true, isRemote: false, worktreePath: null },
    ],
  };
  const task = (): QueuedThreadMessage => ({
    ...queuedMessage({ messageId: "message-default-base", text: "Create a new feature" }),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    creation: {
      projectId: ProjectId.make("project-1"),
      projectCwd: "/repo",
      workspaceMode: "worktree",
      branch: null,
      worktreePath: null,
      useDefaultBranch: true,
      startFromOrigin: true,
    },
  });

  it("persists a concrete base before delivery and reuses it on retry", async () => {
    const message = task();
    const fetchRefs = vi.fn(async () => AsyncResult.success(refs));
    await harness.manager.enqueue(message);

    const result = await prepareQueuedThreadCreation(message, "/repo", fetchRefs);

    expect(AsyncResult.isSuccess(result)).toBe(true);
    if (!AsyncResult.isSuccess(result) || !result.value) throw new Error("No prepared task");
    expect(result.value.creation).toEqual({
      projectId: message.creation?.projectId,
      projectCwd: "/repo",
      workspaceMode: "worktree",
      branch: "main",
      worktreePath: null,
      startFromOrigin: true,
    });
    expect(remainingMessages()).toEqual([result.value.message]);
    expect(harness.writeOutboxMessage.mock.calls.at(-1)?.[0]).toBe(result.value.message);
    expect(fetchRefs).toHaveBeenCalledWith({
      environmentId: message.environmentId,
      input: { cwd: "/repo", limit: 100, refresh: true },
    });
    await prepareQueuedThreadCreation(result.value.message, "/repo", fetchRefs);
    expect(fetchRefs).toHaveBeenCalledTimes(1);
  });

  it.each(["local", "worktree"] as const)(
    "keeps an explicit %s workspace unchanged",
    async (mode) => {
      const initial = task();
      const message = {
        ...initial,
        creation: {
          ...initial.creation!,
          workspaceMode: mode,
          branch: "release",
          worktreePath: "/chosen",
        },
      };
      const fetchRefs = vi.fn(async () => AsyncResult.success(refs));
      await harness.manager.enqueue(message);

      const result = await prepareQueuedThreadCreation(message, "/repo", fetchRefs);

      expect(AsyncResult.isSuccess(result) && result.value?.message).toBe(message);
      expect(fetchRefs).not.toHaveBeenCalled();
    },
  );

  it("leaves a failed branch request queued for the caller to retry", async () => {
    const message = task();
    const failure = AsyncResult.failure<VcsListRefsResult, Error>(
      Cause.fail(new Error("Socket is not connected")),
    );
    await harness.manager.enqueue(message);

    const result = await prepareQueuedThreadCreation(message, "/repo", async () => failure);

    expect(AsyncResult.isFailure(result) && result.cause).toBe(failure.cause);
    expect(remainingMessages()).toEqual([message]);
  });

  it.each([true, false])(
    "reports an unresolvable base without changing workspace: isRepo=%s",
    async (isRepo) => {
      const message = task();
      await harness.manager.enqueue(message);

      const result = await prepareQueuedThreadCreation(message, "/repo", async () =>
        AsyncResult.success({ ...refs, isRepo, refs: [] }),
      );

      expect(AsyncResult.isFailure(result)).toBe(true);
      expect(remainingMessages()).toEqual([message]);
    },
  );

  it("preserves an edit accepted while the branch request is in flight", async () => {
    const message = task();
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<VcsListRefsResult>();
    await harness.manager.enqueue(message);
    const preparation = prepareQueuedThreadCreation(message, "/repo", async () => {
      started.resolve();
      return AsyncResult.success(await response.promise);
    });
    await started.promise;
    const edited = {
      ...message,
      text: "Edited prompt",
      creation: { ...message.creation!, branch: "release" },
    };
    await harness.manager.update(edited);
    response.resolve(refs);

    const result = await preparation;

    expect(AsyncResult.isSuccess(result) && result.value).toBeNull();
    expect(remainingMessages()).toEqual([edited]);
  });

  it("keeps the original durable payload when its editor opens during the branch write", async () => {
    const message = task();
    await harness.manager.enqueue(message);
    const revision = harness.manager.revisionOf(message.messageId);
    harness.writeOutboxMessage.mockImplementationOnce(async () => {
      appAtomRegistry.set(editingQueuedMessageIdsAtom, { [message.messageId]: "editing" });
    });

    const result = await prepareQueuedThreadCreation(message, "/repo", async () =>
      AsyncResult.success(refs),
    );

    expect(AsyncResult.isSuccess(result) && result.value).toBeNull();
    expect(remainingMessages()).toEqual([message]);
    expect(harness.manager.revisionOf(message.messageId)).toBe(revision);
    expect(harness.writeOutboxMessage.mock.calls.at(-1)?.[0]).toBe(message);
  });

  it("retains default-base intent when the resolved branch cannot be saved", async () => {
    const message = task();
    await harness.manager.enqueue(message);
    harness.writeOutboxMessage.mockRejectedValueOnce(new Error("Storage unavailable"));

    await expect(
      prepareQueuedThreadCreation(message, "/repo", async () => AsyncResult.success(refs)),
    ).rejects.toMatchObject({ operation: "update" });

    expect(remainingMessages()).toEqual([message]);
  });

  it("reports a failed durable restore after the editor takes ownership", async () => {
    const message = task();
    await harness.manager.enqueue(message);
    harness.writeOutboxMessage
      .mockImplementationOnce(async () => {
        appAtomRegistry.set(editingQueuedMessageIdsAtom, { [message.messageId]: "editing" });
      })
      .mockRejectedValueOnce(new Error("Storage unavailable"));

    await expect(
      prepareQueuedThreadCreation(message, "/repo", async () => AsyncResult.success(refs)),
    ).rejects.toMatchObject({ operation: "update" });

    expect(remainingMessages()).toEqual([message]);
  });
});
