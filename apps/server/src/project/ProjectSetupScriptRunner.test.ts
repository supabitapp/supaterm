import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it, vi } from "@effect/vitest";
import { ProjectId } from "@supaterm/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as TerminalManager from "../terminal/Manager.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectService from "./ProjectService.ts";
import * as ProjectSetupScriptRunner from "./ProjectSetupScriptRunner.ts";

it.effect("resolves setup scripts through the standalone project service", () => {
  const open = vi.fn((input: Parameters<TerminalManager.TerminalManager["Service"]["open"]>[0]) =>
    Effect.succeed({
      threadId: input.threadId,
      terminalId: input.terminalId,
      cwd: input.cwd,
      worktreePath: input.worktreePath ?? null,
      status: "running" as const,
      pid: 123,
      history: "",
      exitCode: null,
      exitSignal: null,
      label: "Shell",
      updatedAt: "2026-06-20T00:00:00.000Z",
    }),
  );
  const write = vi.fn(
    (_input: Parameters<TerminalManager.TerminalManager["Service"]["write"]>[0]) => Effect.void,
  );
  const closeIdle = vi.fn(
    (_input: Parameters<TerminalManager.TerminalManager["Service"]["closeIdle"]>[0]) => Effect.void,
  );
  const listeners: Array<Parameters<TerminalManager.TerminalManager["Service"]["subscribe"]>[0]> =
    [];
  const unsubscribed = new Set<
    Parameters<TerminalManager.TerminalManager["Service"]["subscribe"]>[0]
  >();
  const subscribe: TerminalManager.TerminalManager["Service"]["subscribe"] = (listener) =>
    Effect.sync(() => {
      listeners.push(listener);
      return () => {
        unsubscribed.add(listener);
      };
    });
  const projectId = ProjectId.make("project:setup-runner-v2");
  const project = {
    id: projectId,
    title: "Project",
    workspaceRoot: "/repo",
    repositoryIdentity: null,
    faviconPath: null,
    defaultModelSelection: null,
    scripts: [
      {
        id: "setup",
        name: "Setup",
        command: "vp install",
        icon: "configure" as const,
        runOnWorktreeCreate: true,
      },
      {
        id: "clean",
        name: "Clean",
        command: "cargo clean",
        icon: "build" as const,
        runOnWorktreeCreate: false,
        runOnDone: true,
      },
    ],
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    deletedAt: null,
  };
  const layer = ProjectSetupScriptRunner.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProjectService.ProjectService)({
          getById: () => Effect.succeed(Option.some(project)),
        }),
        Layer.mock(TerminalManager.TerminalManager)({ open, write, subscribe, closeIdle }),
        ServerSettings.layerTest(),
        NodeCrypto.layer,
      ),
    ),
  );

  return Effect.gen(function* () {
    const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
    const result = yield* runner.runForThread({
      threadId: "thread-1",
      projectId,
      worktreePath: "/repo-worktree",
    });
    assert.deepEqual(result, {
      status: "started",
      async: true,
      scriptId: "setup",
      scriptName: "Setup",
      scriptCommand: "vp install",
      terminalId: "setup-setup",
      cwd: "/repo-worktree",
    });
    assert.equal(open.mock.calls[0]?.[0].cwd, "/repo-worktree");
    assert.deepEqual(open.mock.calls[0]?.[0].env, {
      SUPATERM_PROJECT_ROOT: "/repo",
      SUPATERM_WORKTREE_PATH: "/repo-worktree",
      COLORTERM: "",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    });
    assert.equal(write.mock.calls[0]?.[0].data, " vp install\r");
    const lines: string[] = [];
    const observed = yield* runner.runForThread({
      threadId: "thread-1",
      projectId,
      worktreePath: "/repo-worktree",
      observeCompletion: {
        onOutputLine: (line) =>
          Effect.sync(() => {
            lines.push(line);
          }),
      },
    });
    assert.equal(observed.status, "started");
    assert.match(write.mock.calls[1]?.[0].data ?? "", /^ \S/);
    const listener = listeners[0]!;
    yield* listener({
      type: "output",
      threadId: "thread-1",
      terminalId: "setup-setup",
      data: "Downloading 10%\rDownloading 20%\r\nDone\n",
    });
    assert.deepEqual(lines, ["Downloading 10%", "Downloading 20%", "Done"]);
    yield* listener({ type: "closed", threadId: "thread-1", terminalId: "setup-setup" });

    const done = yield* runner.runForThread({
      threadId: "thread-1",
      projectId,
      worktreePath: "/repo-worktree",
      trigger: "done",
    });
    const doneTerminalId = done.status === "started" ? done.terminalId : "";
    assert.match(doneTerminalId, /^done-clean-/);
    assert.equal(write.mock.calls.at(-1)?.[0].data, " cargo clean\r");

    const observedDone = yield* runner.runForThread({
      threadId: "thread-1",
      projectId,
      worktreePath: "/repo-worktree",
      trigger: "done",
      observeCompletion: {},
    });
    const observedTerminalId = observedDone.status === "started" ? observedDone.terminalId : "";
    // Each completion gets its own shell, so a busy one is never typed into.
    assert.notEqual(observedTerminalId, doneTerminalId);
    assert.match(write.mock.calls.at(-1)?.[0].data ?? "", /^ \S/);
    const token = /__SUPATERM_SETUP_DONE___(\w+):/.exec(
      write.mock.calls.at(-1)?.[0].data ?? "",
    )?.[1];
    const doneListener = listeners.at(-1)!;
    const completion = yield* Effect.forkChild(
      observedDone.status === "started" && observedDone.completion
        ? observedDone.completion
        : Effect.die("no completion"),
    );
    yield* doneListener({
      type: "output",
      threadId: "thread-1",
      terminalId: observedTerminalId,
      data: `\r\n__SUPATERM_SETUP_DONE___${token}:0\r\n`,
    });
    yield* Effect.yieldNow;
    assert.equal(closeIdle.mock.calls.length, 0);
    yield* doneListener({
      type: "output",
      threadId: "thread-1",
      terminalId: observedTerminalId,
      data: "$ ",
    });
    assert.deepEqual((yield* Fiber.join(completion)).exitCode, 0);
    assert.deepEqual(closeIdle.mock.calls[0]?.[0], {
      threadId: "thread-1",
      terminalId: observedTerminalId,
    });

    const writeCountBeforeSkip = write.mock.calls.length;
    const skipped = yield* runner.runForThread({
      threadId: "thread-1",
      projectId,
      worktreePath: "/repo-worktree",
      trigger: "done",
      withCommandWriteGuard: () => Effect.succeed(false),
    });
    const skippedTerminalId = open.mock.calls.at(-1)![0].terminalId;
    assert.deepEqual(skipped, { status: "skipped" });
    assert.equal(write.mock.calls.length, writeCountBeforeSkip);
    assert.deepEqual(closeIdle.mock.calls.at(-1)?.[0], {
      threadId: "thread-1",
      terminalId: skippedTerminalId,
    });

    const writeCountBeforeGuardFailure = write.mock.calls.length;
    const failedGuard = yield* Effect.exit(
      runner.runForThread({
        threadId: "thread-1",
        projectId,
        worktreePath: "/repo-worktree",
        trigger: "done",
        observeCompletion: {},
        withCommandWriteGuard: () => Effect.die("projection read failed"),
      }),
    );
    const failedGuardListener = listeners.at(-1)!;
    const failedGuardTerminalId = open.mock.calls.at(-1)![0].terminalId;
    assert.isTrue(Exit.isFailure(failedGuard));
    assert.equal(write.mock.calls.length, writeCountBeforeGuardFailure);
    assert.isTrue(unsubscribed.has(failedGuardListener));
    assert.deepEqual(closeIdle.mock.calls.at(-1)?.[0], {
      threadId: "thread-1",
      terminalId: failedGuardTerminalId,
    });

    const guardEntered = yield* Deferred.make<void>();
    const interruptedRun = yield* Effect.forkChild(
      runner.runForThread({
        threadId: "thread-1",
        projectId,
        worktreePath: "/repo-worktree",
        trigger: "done",
        observeCompletion: {},
        withCommandWriteGuard: () =>
          Deferred.succeed(guardEntered, undefined).pipe(Effect.andThen(Effect.never)),
      }),
    );
    yield* Deferred.await(guardEntered);
    const interruptedTerminalId = open.mock.calls.at(-1)![0].terminalId;
    yield* Fiber.interrupt(interruptedRun);
    const interruptedListener = listeners.at(-1)!;
    assert.isTrue(unsubscribed.has(interruptedListener));
    assert.deepEqual(closeIdle.mock.calls.at(-1)?.[0], {
      threadId: "thread-1",
      terminalId: interruptedTerminalId,
    });
  }).pipe(Effect.provide(layer));
});
