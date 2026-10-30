import {
  CommandId,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ThreadId,
} from "@supaterm/contracts";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as KeyedLock from "@supaterm/shared/KeyedLock";
import { makeDrainableWorker } from "@supaterm/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import { threadHasUnfinishedWork } from "../orchestration-v2/Orchestrator.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as ManagedProjectFolders from "./ManagedProjectFolders.ts";
import * as ProjectService from "./ProjectService.ts";

export class ScratchThreadPromotionError extends Schema.TaggedError<ScratchThreadPromotionError>()(
  "ScratchThreadPromotionError",
  {
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.reason;
  }
}

const isScratchThreadPromotionError = Schema.is(ScratchThreadPromotionError);

const PromotionIntent = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/i)),
  projectId: ProjectId,
  folder: Schema.String,
  title: Schema.String,
  threadIds: Schema.Array(ThreadId),
});
type PromotionIntent = typeof PromotionIntent.Type;
const encodeIntent = Schema.encodeEffect(Schema.fromJsonString(PromotionIntent));
const decodeIntent = Schema.decodeUnknownEffect(Schema.fromJsonString(PromotionIntent));

export class ScratchThreadPromotion extends Context.Service<
  ScratchThreadPromotion,
  {
    readonly promote: (input: {
      readonly threadId: ThreadId;
    }) => Effect.Effect<{ readonly projectId: ProjectId }, ScratchThreadPromotionError>;
    readonly drain: Effect.Effect<void>;
  }
>()("supaterm/project/ScratchThreadPromotion") {}

export const make = Effect.gen(function* () {
  const managedFolders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const projects = yield* ProjectService.ProjectService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
  const crypto = yield* Crypto.Crypto;
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig.ServerConfig;
  const platform = yield* HostProcess.Platform;
  const directory = path.join(config.stateDir, "scratch-promotions");
  const locks = yield* KeyedLock.make<string>();
  const filename = (id: string) => path.join(directory, `${id}.json`);
  const fail = (reason: string) => (cause: unknown) =>
    new ScratchThreadPromotionError({ reason, cause });
  const syncDirectory =
    platform === "win32"
      ? Effect.void
      : Effect.scoped(fs.open(directory, { flag: "r" }).pipe(Effect.flatMap((file) => file.sync)));

  const pending = Effect.gen(function* () {
    if (!(yield* fs.exists(directory))) return [];
    const names = yield* fs.readDirectory(directory);
    return yield* Effect.forEach(
      names.filter((name) => /^[a-f0-9-]{36}\.json$/i.test(name)),
      (name) => fs.readFileString(path.join(directory, name)).pipe(Effect.flatMap(decodeIntent)),
    );
  });

  const persist = Effect.fn("ScratchThreadPromotion.persist")(function* (intent: PromotionIntent) {
    const json = yield* encodeIntent(intent);
    yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `${intent.id}.${yield* crypto.randomUUIDv4()}.tmp`);
    yield* Effect.acquireUseRelease(
      Effect.succeed(temporary),
      (temporary) =>
        Effect.gen(function* () {
          yield* Effect.scoped(
            Effect.gen(function* () {
              const file = yield* fs.open(temporary, { flag: "wx", mode: 0o600 });
              yield* file.writeAll(new TextEncoder().encode(json));
              yield* file.sync;
            }),
          );
          yield* fs.rename(temporary, filename(intent.id));
          yield* syncDirectory;
        }).pipe(Effect.uninterruptible),
      (temporary) => fs.remove(temporary, { force: true }).pipe(Effect.ignore),
    );
  });

  const applyIntent = Effect.fn("ScratchThreadPromotion.applyIntent")(function* (
    intent: PromotionIntent,
  ) {
    const projectId = yield* projects
      .bootstrap({
        commandId: CommandId.make(`scratch-promotion-project:${intent.id}`),
        projectId: intent.projectId,
        title: intent.title,
        workspaceRoot: intent.folder,
      })
      .pipe(
        Effect.map(({ project }) => project.id),
        Effect.catchTags({
          ProjectConflictError: (conflict) => Effect.succeed(conflict.conflictingProjectId),
        }),
      );
    if (projectId !== intent.projectId) {
      intent = { ...intent, projectId };
      yield* persist(intent);
    }
    yield* orchestrator.adoptThreadCohort({
      commandId: CommandId.make(`scratch-promotion:${intent.id}`),
      projectId,
      threadIds: intent.threadIds,
    });
    yield* scheduledTasks.moveThreadTasks({ threadIds: intent.threadIds, projectId });
    yield* fs.remove(filename(intent.id), { force: true });
    yield* syncDirectory;
    return { projectId };
  });

  const recover = Effect.gen(function* () {
    for (const intent of yield* pending) {
      yield* locks.withLock(intent.folder, applyIntent(intent)).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Scratch project promotion remains pending", {
            id: intent.id,
            cause,
          }),
        ),
      );
    }
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not read pending scratch promotions", { cause }),
    ),
  );
  const recovery = yield* makeDrainableWorker(() => recover);
  yield* orchestrator.streamDomainEvents.pipe(
    Stream.filter(
      (event) => event.type === "run.updated" || event.type === "runtime-request.updated",
    ),
    Stream.runForEach(() => recovery.enqueue(undefined)),
    Effect.forkScoped({ startImmediately: true }),
  );
  yield* recover;
  yield* recovery
    .enqueue(undefined)
    .pipe(Effect.repeat(Schedule.spaced("1 minute")), Effect.forkScoped);

  const promote: ScratchThreadPromotion["Service"]["promote"] = Effect.fn(
    "ScratchThreadPromotion.promote",
  )(function* (input) {
    const thread = yield* threads.getThreadShell(input.threadId).pipe(
      Effect.mapError(fail("Could not read the thread.")),
      Effect.filterOrFail(
        (shell) => shell !== null,
        () => new ScratchThreadPromotionError({ reason: "Thread not found." }),
      ),
    );
    const project = yield* projects
      .getById(thread.projectId)
      .pipe(Effect.mapError(fail("Could not read the thread's project.")));
    const folder = thread.worktreePath ?? Option.getOrUndefined(project)?.workspaceRoot;
    const scratchRoot = Option.getOrUndefined(yield* managedFolders.scratchRoot);
    const isScratch = yield* managedFolders.isScratchProject(thread.projectId);
    const alreadyPromoted =
      Option.isSome(project) && project.value.workspaceRoot === folder && !isScratch;
    if (
      folder === undefined ||
      scratchRoot === undefined ||
      path.dirname(folder) !== scratchRoot ||
      !(isScratch || alreadyPromoted)
    ) {
      return yield* new ScratchThreadPromotionError({
        reason: "Only a No project thread with its own folder can become a project.",
      });
    }
    return yield* locks
      .withLock(
        folder,
        Effect.gen(function* () {
          const saved = (yield* pending).find((intent) => intent.folder === folder);
          if (saved !== undefined) return yield* applyIntent(saved);
          const snapshot = yield* Effect.flatten(
            threads.readShellSnapshot({ worktreePath: folder }),
          );
          const moveSet = new Map<ThreadId, OrchestrationV2ThreadShell>();
          if (isScratch) moveSet.set(thread.id, thread);
          for (const candidate of [...snapshot.threads, ...snapshot.archivedThreads]) {
            if (yield* managedFolders.isScratchProject(candidate.projectId))
              moveSet.set(candidate.id, candidate);
          }
          for (const candidate of moveSet.values()) {
            const records = yield* threads.getThreadRecords(
              candidate.id,
              ["runs", "runtimeRequests"],
              { turnItemTypes: [] },
            );
            if (threadHasUnfinishedWork(records)) {
              return yield* new ScratchThreadPromotionError({
                reason: `"${candidate.title}" is still working. Finish or stop it first.`,
              });
            }
          }
          if (moveSet.size === 0 && Option.isSome(project)) return { projectId: project.value.id };
          const id = yield* crypto.randomUUIDv4();
          const intent = {
            id,
            projectId: ProjectId.make(id),
            folder,
            title: thread.title,
            threadIds: [...moveSet.keys()],
          };
          yield* persist(intent);
          return yield* applyIntent(intent);
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          isScratchThreadPromotionError(cause)
            ? cause
            : fail("Project promotion is pending and will retry automatically.")(cause),
        ),
      );
  });

  return ScratchThreadPromotion.of({ promote, drain: recovery.drain });
});

export const layer = Layer.effect(ScratchThreadPromotion, make);
