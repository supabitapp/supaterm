import type { EnvironmentId, OrchestrationV2ThreadShell, ThreadId } from "@supaterm/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { arrayElementsEqual } from "./entities.ts";
import type { EnvironmentThreadState } from "./threadState.ts";

const isRunning = (status: string) =>
  status === "preparing" || status === "queued" || status === "starting" || status === "running";

type KeptThreads = ReadonlyMap<EnvironmentId, ReadonlySet<ThreadId>>;

// True once a thread's own stream no longer needs to stay open: it is in sync
// and shows a settled session, or it cannot progress (deleted or failed). A
// stream that is still loading or reconnecting keeps waiting for the stop.
function isDetailDone<E>(result: AsyncResult.AsyncResult<EnvironmentThreadState, E>): boolean {
  if (!AsyncResult.isSuccess(result)) return true;
  const { status, data, error } = result.value;
  if (status === "deleted" || Option.isSome(error)) return true;
  return (
    status === "live" &&
    !Option.exists(data, (thread) => thread.runs.some((run) => isRunning(run.status)))
  );
}

/**
 * Keeps the thread state atom mounted for each running thread in the listed
 * environments. Mount the result; its value is only bookkeeping.
 *
 * The shell and detail streams are independent, so the shell can report a
 * stop before the detail loads or catches up. A stopped thread stays mounted
 * until its own detail is live and shows the stop too. Then the stream closes
 * and saves the settled state to disk.
 */
export function createRunningThreadKeepAliveAtom<E>(input: {
  readonly environmentIdsAtom: Atom.Atom<ReadonlyArray<EnvironmentId>>;
  readonly threadsAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<ReadonlyArray<Pick<OrchestrationV2ThreadShell, "id" | "status">>>;
  readonly stateAtom: (
    environmentId: EnvironmentId,
    threadId: ThreadId,
  ) => Atom.Atom<AsyncResult.AsyncResult<EnvironmentThreadState, E>>;
}) {
  // Keeps its identity until a thread starts or stops, so ordinary shell
  // updates do not rebuild the keep-alive set.
  const runningThreadIdsAtom = Atom.family((environmentId: EnvironmentId) => {
    let previous: ReadonlyArray<ThreadId> = [];
    return Atom.make((get) => {
      const running = get(input.threadsAtom(environmentId)).flatMap((thread) =>
        isRunning(thread.status) ? [thread.id] : [],
      );
      if (arrayElementsEqual(previous, running)) return previous;
      previous = running;
      return running;
    }).pipe(Atom.withLabel(`running-thread-ids:${environmentId}`));
  });

  return Atom.make((get): KeptThreads => {
    const previous = Option.getOrUndefined(get.self<KeptThreads>());
    const kept = new Map<EnvironmentId, ReadonlySet<ThreadId>>();
    // An environment that leaves the list is not visited, so its mounts drop.
    for (const environmentId of get(input.environmentIdsAtom)) {
      const threadIds = new Set(get(runningThreadIdsAtom(environmentId)));
      for (const threadId of previous?.get(environmentId) ?? []) {
        if (threadIds.has(threadId)) continue;
        const stateAtom = input.stateAtom(environmentId, threadId);
        // `once`, not `get`: a dependency on a stopped thread would hold its
        // stream open until some other change rebuilds this atom.
        if (isDetailDone(get.once(stateAtom))) continue;
        threadIds.add(threadId);
        // Rebuild when this detail is done, not on each update.
        get.subscribe(stateAtom, (state) => {
          if (isDetailDone(state)) get.refreshSelf();
        });
      }
      for (const threadId of threadIds) get.mount(input.stateAtom(environmentId, threadId));
      kept.set(environmentId, threadIds);
    }
    return kept;
  }).pipe(Atom.withLabel("running-thread-keep-alive"));
}
