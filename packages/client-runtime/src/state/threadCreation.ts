import type {
  EnvironmentId,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadShell,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { AsyncResult, Atom } from "effect/reactivity";

import type { StartThreadTurnInput } from "../operations/commands.ts";
import type { AtomCommand } from "./runtime.ts";

export function optimisticThreadCreationShell(
  input: StartThreadTurnInput,
  creation: NonNullable<NonNullable<StartThreadTurnInput["bootstrap"]>["createThread"]>,
  createdAt: DateTime.Utc,
): OrchestrationV2ThreadShell {
  const prepareWorktree = input.bootstrap?.prepareWorktree;
  return {
    id: input.threadId,
    projectId: creation.projectId,
    title: input.titleSeed ?? creation.title,
    providerInstanceId: (input.modelSelection ?? creation.modelSelection).instanceId,
    modelSelection: input.modelSelection ?? creation.modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    branch: prepareWorktree ? (prepareWorktree.branch ?? null) : creation.branch,
    worktreePath: prepareWorktree ? null : creation.worktreePath,
    createdBy: "user",
    creationSource: input.creationSource ?? "web",
    lineage: {
      rootThreadId: input.threadId,
      parentThreadId: null,
      relationshipToParent: null,
    },
    forkedFrom: null,
    activeProviderThreadId: null,
    latestRunId: null,
    activeRunId: null,
    // Without a run id yet, only the activity status makes clients count the thread as working.
    activityRunStatus: "preparing",
    activityRunStartedAt: createdAt,
    status: "preparing",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    doneOverride: null,
    doneAt: null,
    deletedAt: null,
  };
}

/** Appends creations the snapshot doesn't know yet, active or archived, keeping the first of each id. */
export function withOptimisticThreadCreations(
  snapshot: OrchestrationV2ShellSnapshot | null,
  creations: ReadonlyArray<OrchestrationV2ThreadShell>,
): OrchestrationV2ShellSnapshot | null {
  if (snapshot === null || creations.length === 0) return snapshot;
  const knownIds = new Set([
    ...snapshot.threads.map((thread) => thread.id),
    ...snapshot.archivedThreads.map((thread) => thread.id),
  ]);
  const added: OrchestrationV2ThreadShell[] = [];
  for (const thread of creations) {
    if (knownIds.has(thread.id)) continue;
    knownIds.add(thread.id);
    added.push(thread);
  }
  return added.length === 0 ? snapshot : { ...snapshot, threads: [...snapshot.threads, ...added] };
}

export function createOptimisticThreadCreation(
  sourceSnapshotAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<OrchestrationV2ShellSnapshot | null>,
) {
  const pendingAtom = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<ReadonlyArray<OrchestrationV2ThreadShell>>([]).pipe(Atom.keepAlive),
  );
  const snapshotAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) =>
      withOptimisticThreadCreations(
        get(sourceSnapshotAtom(environmentId)),
        get(pendingAtom(environmentId)),
      ),
    ),
  );

  function wrap<A, E>(
    command: AtomCommand<
      { readonly environmentId: EnvironmentId; readonly input: StartThreadTurnInput },
      A,
      E
    >,
  ): typeof command {
    return {
      label: command.label,
      run: async (registry, target) => {
        const input = target.input;
        const creation = input.bootstrap?.createThread;
        if (creation === undefined) return command.run(registry, target);
        const source = sourceSnapshotAtom(target.environmentId);
        const current = registry.get(source);
        if (
          current?.threads.some((thread) => thread.id === input.threadId) ||
          current?.archivedThreads.some((thread) => thread.id === input.threadId)
        ) {
          return command.run(registry, target);
        }
        const thread = optimisticThreadCreationShell(
          input,
          creation,
          input.createdAt === undefined
            ? DateTime.nowUnsafe()
            : DateTime.makeUnsafe(input.createdAt),
        );
        const pending = pendingAtom(target.environmentId);
        const remove = () =>
          registry.update(pending, (threads) => threads.filter((item) => item !== thread));
        registry.update(pending, (threads) => [...threads, thread]);
        const reconcile = (snapshot: OrchestrationV2ShellSnapshot | null) => {
          if (
            snapshot?.threads.some((item) => item.id === thread.id) ||
            snapshot?.archivedThreads.some((item) => item.id === thread.id)
          ) {
            remove();
            unsubscribe();
          }
        };
        const unsubscribe = registry.subscribe(source, reconcile);
        reconcile(registry.get(source));
        let accepted = false;
        try {
          const result = await command.run(registry, target);
          accepted = AsyncResult.isSuccess(result);
          return result;
        } finally {
          if (!accepted) {
            remove();
            unsubscribe();
          }
        }
      },
    };
  }

  return { snapshotAtom, wrap };
}
