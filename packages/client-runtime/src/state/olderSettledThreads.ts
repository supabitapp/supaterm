import {
  isOlderSettledThreadShell,
  ORCHESTRATION_V2_WS_METHODS,
  type EnvironmentId,
  type OrchestrationV2OlderSettledCursor,
  type OrchestrationV2OlderSettledThreadsPage,
  type OrchestrationV2SearchThreadsInput,
  type OrchestrationV2ThreadFamily,
  type OrchestrationV2ThreadShell,
  type ProjectId,
  type ThreadId,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import { request } from "../rpc/client.ts";
import { createEnvironmentQueryAtomFamily, selectEnvironmentQueryData } from "./runtime.ts";
import type { EnvironmentShellState } from "./shell.ts";
import { threadFamilyRead } from "./threadFamilies.ts";

const OLDER_SETTLED_PAGE_SIZE = 25;

const COUNT_REREAD_DELAY = "500 millis";

export interface OlderSettled {
  readonly before: string;
  readonly beforeMs: number;
  readonly counts: ReadonlyMap<ProjectId, number>;
}

export interface OlderSettledScope {
  readonly environmentId: EnvironmentId;
  readonly projectIds: ReadonlyArray<ProjectId> | null;
}

export interface OlderSettledPages {
  readonly reads: ReadonlyArray<OrchestrationV2ThreadFamily>;
  readonly frontier: OrchestrationV2OlderSettledCursor | null;
  readonly status: "ready" | "pending" | "failed";
}

const NO_PAGES: OlderSettledPages = { reads: [], frontier: null, status: "ready" };

type OlderSettledRow = Pick<
  OrchestrationV2ThreadShell,
  "id" | "projectId" | "lineage" | "doneOverride" | "doneAt"
>;

export interface OlderSettledShelfEnvironment {
  readonly older: OlderSettled | null;
  readonly pages: OlderSettledPages;
}

export function olderSettledCountKey(
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  beforeMs: number,
  removedAt: ReadonlyMap<ThreadId, number>,
): string {
  let lastRemoval = 0;
  for (const sequence of removedAt.values()) lastRemoval = Math.max(lastRemoval, sequence);
  const rows: string[] = [];
  for (const thread of threads) {
    if (thread.lineage.relationshipToParent === "subagent") continue;
    const older = isOlderSettledThreadShell(thread, beforeMs);
    if (older || DateTime.toEpochMillis(thread.createdAt) < beforeMs) {
      rows.push(`${thread.id}:${older ? 1 : 0}`);
    }
  }
  return `${lastRemoval}|${rows.sort().join(",")}`;
}

function atOrAboveCursor(
  thread: Pick<OrchestrationV2ThreadShell, "id" | "doneAt">,
  cursor: OrchestrationV2OlderSettledCursor,
): boolean {
  if (thread.doneAt === null) return true;
  const doneAt = DateTime.formatIso(thread.doneAt);
  return !(
    doneAt < cursor.settledAt ||
    (cursor.threadId !== undefined && doneAt === cursor.settledAt && thread.id > cursor.threadId)
  );
}

export function settledShelfFrontier(
  environments: ReadonlyArray<OlderSettledShelfEnvironment>,
): OrchestrationV2OlderSettledCursor | null {
  let highest: OrchestrationV2OlderSettledCursor | null = null;
  for (const { older, pages } of environments) {
    if (older === null || pages.frontier === null || pages.status === "failed") continue;
    const frontier = pages.frontier;

    if (
      highest === null ||
      frontier.settledAt > highest.settledAt ||
      (frontier.settledAt === highest.settledAt &&
        frontier.threadId !== undefined &&
        (highest.threadId === undefined || frontier.threadId < highest.threadId))
    ) {
      highest = frontier;
    }
  }
  return highest;
}

export function isListedSettledThread(
  thread: Pick<OrchestrationV2ThreadShell, "id" | "doneAt">,
  frontier: OrchestrationV2OlderSettledCursor | null,
): boolean {
  return frontier === null || atOrAboveCursor(thread, frontier);
}

export function unloadedOlderSettledCount(input: {
  readonly olderSettled: (environmentId: EnvironmentId) => OlderSettled | null;
  readonly scopes: ReadonlyArray<OlderSettledScope>;

  readonly threads: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly source: OlderSettledRow;
  }>;
}): number {
  let unloaded = 0;
  for (const scope of input.scopes) {
    const older = input.olderSettled(scope.environmentId);
    if (older === null) continue;
    if (scope.projectIds === null) {
      for (const count of older.counts.values()) unloaded += count;
    } else {
      for (const projectId of scope.projectIds) unloaded += older.counts.get(projectId) ?? 0;
    }
    for (const thread of input.threads) {
      if (
        thread.environmentId === scope.environmentId &&
        (scope.projectIds === null || scope.projectIds.includes(thread.source.projectId)) &&
        isOlderSettledThreadShell(thread.source, older.beforeMs)
      ) {
        unloaded -= 1;
      }
    }
  }
  return Math.max(0, unloaded);
}

export function wantedOlderSettledPages(input: {
  readonly requested: ReadonlyMap<EnvironmentId, number>;
  readonly environments: ReadonlyMap<EnvironmentId, OlderSettledShelfEnvironment>;
  readonly listedCount: number;
  readonly visibleCount: number;
}): ReadonlyMap<EnvironmentId, number> {
  if (input.listedCount >= input.visibleCount) return input.requested;
  const frontier = settledShelfFrontier([...input.environments.values()]);
  if (frontier === null) return input.requested;
  let next: Map<EnvironmentId, number> | null = null;
  for (const [environmentId, { older, pages }] of input.environments) {
    if (older === null || pages.status !== "ready" || pages.frontier === null) continue;
    if (
      pages.frontier.settledAt !== frontier.settledAt ||
      pages.frontier.threadId !== frontier.threadId
    ) {
      continue;
    }
    next ??= new Map(input.requested);
    next.set(environmentId, (input.requested.get(environmentId) ?? 0) + 1);
  }
  return next ?? input.requested;
}

export function createOlderSettledThreadAtoms<R, ER, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
  shellStateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<EnvironmentShellState, E>>,
) {
  const shellStateValue = (state: AsyncResult.AsyncResult<EnvironmentShellState, E>) =>
    AsyncResult.getOrElse(state, () => null);

  const countReadAtom = createEnvironmentQueryAtomFamily(runtime, {
    label: "environment-data:orchestration:older-settled-counts",
    staleTimeMs: Number.POSITIVE_INFINITY,

    idleTtlMs: 0,
    execute: Effect.fn("OlderSettledThreads.readCounts")(function* (input: {
      readonly generation: number;
      readonly before: string;
      readonly key: string;
    }) {
      yield* Effect.sleep(COUNT_REREAD_DELAY);
      return yield* request(ORCHESTRATION_V2_WS_METHODS.getOlderSettledThreads, {
        before: { settledAt: input.before },
        limit: 0,
      });
    }),
  });

  const pageReadAtom = createEnvironmentQueryAtomFamily(runtime, {
    label: "environment-data:orchestration:older-settled-page",
    staleTimeMs: Number.POSITIVE_INFINITY,

    idleTtlMs: 0,
    execute: Effect.fn("OlderSettledThreads.readPage")(function* (input: {
      readonly generation: number;
      readonly projectIds: ReadonlyArray<ProjectId> | null;
      readonly before: OrchestrationV2OlderSettledCursor;
    }) {
      return yield* request(ORCHESTRATION_V2_WS_METHODS.getOlderSettledThreads, {
        before: input.before,
        ...(input.projectIds === null ? {} : { projectIds: input.projectIds }),
        limit: OLDER_SETTLED_PAGE_SIZE,
      });
    }),
  });

  const countsOf = (source: {
    readonly counts: OrchestrationV2OlderSettledThreadsPage["counts"];
  }) => new Map(source.counts.map(({ projectId, count }) => [projectId, count] as const));

  const olderSettledAtom = Atom.family((environmentId: EnvironmentId) => {
    let generation = -1;

    let snapshotKey: string | null = null;
    let keyInputs: { readonly threads: unknown; readonly removedAt: unknown } | null = null;
    let key = "";
    let fromSnapshot: OlderSettled | null = null;
    let lastRead: OlderSettled | null = null;
    let lastReadPage: OrchestrationV2OlderSettledThreadsPage | null = null;
    return Atom.make((get): OlderSettled | null => {
      const state = shellStateValue(get(shellStateAtom(environmentId)));
      const snapshot = state === null ? null : Option.getOrNull(state.snapshot);
      const cut = snapshot?.olderSettled;
      if (state === null || snapshot === null || cut === undefined) return null;
      if (fromSnapshot?.before !== cut.before || state.generation !== generation) {
        fromSnapshot = {
          before: cut.before,
          beforeMs: DateTime.toEpochMillis(DateTime.makeUnsafe(cut.before)),
          counts: countsOf(cut),
        };
      }

      if (keyInputs?.threads !== snapshot.threads || keyInputs.removedAt !== state.removedAt) {
        keyInputs = { threads: snapshot.threads, removedAt: state.removedAt };
        key = olderSettledCountKey(snapshot.threads, fromSnapshot.beforeMs, state.removedAt);
      }
      if (state.generation !== generation) {
        generation = state.generation;
        snapshotKey = snapshot.snapshotSequence === cut.asOfSequence ? key : null;
        lastRead = null;
      }

      if (key === snapshotKey || state.generation === 0) return fromSnapshot;
      const read = selectEnvironmentQueryData(
        get(
          countReadAtom({
            environmentId,
            input: { generation: state.generation, before: cut.before, key },
          }),
        ),
      );
      if (read !== null && read !== lastReadPage) {
        lastReadPage = read;
        lastRead = { ...fromSnapshot, counts: countsOf(read) };
      }
      return lastRead ?? fromSnapshot;
    }).pipe(Atom.withLabel(`environment-older-settled:${environmentId}`));
  });

  const pagesKey = (scope: OlderSettledScope, pages: number) =>
    JSON.stringify([
      scope.environmentId,
      scope.projectIds === null ? null : [...scope.projectIds].sort(),
      pages,
    ]);

  const pagesAtom = Atom.family((key: string) => {
    const [environmentId, projectIds, pages] = JSON.parse(key) as [
      EnvironmentId,
      ReadonlyArray<ProjectId> | null,
      number,
    ];
    let previous = NO_PAGES;
    const keep = (next: OlderSettledPages): OlderSettledPages => {
      const same =
        next.status === previous.status &&
        next.frontier?.settledAt === previous.frontier?.settledAt &&
        next.frontier?.threadId === previous.frontier?.threadId &&
        (next.frontier === null) === (previous.frontier === null) &&
        next.reads.length === previous.reads.length &&
        next.reads.every((read, index) => read === previous.reads[index]);
      if (!same) previous = next;
      return previous;
    };
    return Atom.make((get) => {
      const state = shellStateValue(get(shellStateAtom(environmentId)));
      const cut = state === null ? undefined : Option.getOrNull(state.snapshot)?.olderSettled;

      if (state === null || cut === undefined || state.generation === 0) return keep(NO_PAGES);
      let frontier: OrchestrationV2OlderSettledCursor = { settledAt: cut.before };
      if (pages === 0) return keep({ reads: [], frontier, status: "ready" });
      const reads: OrchestrationV2ThreadFamily[] = [];
      for (let index = 0; index < pages; index += 1) {
        const result = get(
          pageReadAtom({
            environmentId,
            input: { generation: state.generation, projectIds, before: frontier },
          }),
        );
        const page = selectEnvironmentQueryData(result);
        if (page === null) {
          return keep({
            reads,
            frontier,
            status: threadFamilyRead(result) === "failed" ? "failed" : "pending",
          });
        }
        reads.push(page);
        const last = page.threads.at(-1);
        if (page.threads.length < OLDER_SETTLED_PAGE_SIZE || last?.doneAt == null) {
          return keep({ reads, frontier: null, status: "ready" });
        }
        frontier = { settledAt: DateTime.formatIso(last.doneAt), threadId: last.id };
      }
      return keep({ reads, frontier, status: "ready" });
    }).pipe(Atom.withLabel(`environment-older-settled-pages:${key}`));
  });

  const pageRowsAtom = Atom.family((key: string) =>
    Atom.map(pagesAtom(key), (pages) => pages.reads).pipe(
      Atom.withLabel(`environment-older-settled-page-rows:${key}`),
    ),
  );

  const searchGenerationAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): number | "waiting" | "none" => {
      const state = shellStateValue(get(shellStateAtom(environmentId)));
      if (state !== null && state.generation > 0) return state.generation;
      return state?.status === "synchronizing" ? "waiting" : "none";
    }),
  );
  const searchReadAtom = createEnvironmentQueryAtomFamily(runtime, {
    label: "environment-data:orchestration:older-settled-search",
    idleTtlMs: 60_000,
    execute: Effect.fn("OlderSettledThreads.search")(function* (input: {
      readonly generation: number;
      readonly search: OrchestrationV2SearchThreadsInput;
    }) {
      return yield* request(ORCHESTRATION_V2_WS_METHODS.searchThreads, input.search);
    }),
  });

  const searchAtom = Atom.family((key: string) => {
    const [environmentId, search] = JSON.parse(key) as [
      EnvironmentId,
      OrchestrationV2SearchThreadsInput,
    ];
    return Atom.make((get) => {
      const generation = get(searchGenerationAtom(environmentId));

      return typeof generation === "number"
        ? get(searchReadAtom({ environmentId, input: { generation, search } }))
        : AsyncResult.initial(generation === "waiting");
    }).pipe(Atom.withLabel(`environment-older-settled-search:${key}`));
  });

  const shelfAtom = Atom.family((key: string) => {
    const entries = JSON.parse(key) as ReadonlyArray<readonly [string, string]>;
    let previous: ReadonlyMap<EnvironmentId, OlderSettledShelfEnvironment> = new Map();
    return Atom.make((get): ReadonlyMap<EnvironmentId, OlderSettledShelfEnvironment> => {
      const shelf = new Map<EnvironmentId, OlderSettledShelfEnvironment>();
      let changed = previous.size !== entries.length;
      for (const [environmentId, pagesKey] of entries) {
        const older = get(olderSettledAtom(environmentId as EnvironmentId));
        const pages = get(pagesAtom(pagesKey));
        const prior = previous.get(environmentId as EnvironmentId);
        changed ||= prior?.older !== older || prior.pages !== pages;
        shelf.set(environmentId as EnvironmentId, { older, pages });
      }
      if (changed) previous = shelf;
      return previous;
    }).pipe(Atom.withLabel(`environment-older-settled-shelf:${key}`));
  });

  const retryPages = (
    registry: AtomRegistry.AtomRegistry,
    scope: OlderSettledScope,
    pages: number,
  ) => {
    const state = shellStateValue(registry.get(shellStateAtom(scope.environmentId)));
    const result = registry.get(pagesAtom(pagesKey(scope, pages)));
    if (state === null || result.status !== "failed" || result.frontier === null) return;
    registry.refresh(
      pageReadAtom({
        environmentId: scope.environmentId,
        input: {
          generation: state.generation,
          projectIds: scope.projectIds === null ? null : [...scope.projectIds].sort(),
          before: result.frontier,
        },
      }),
    );
  };

  return {
    olderSettledAtom,

    shelfAtom: (
      scopes: ReadonlyArray<{ readonly scope: OlderSettledScope; readonly pages: number }>,
    ) =>
      shelfAtom(
        JSON.stringify(
          scopes.map(({ scope, pages }) => [scope.environmentId, pagesKey(scope, pages)] as const),
        ),
      ),
    retryPages,

    pagesAtom: (scope: OlderSettledScope, pages: number) => pagesAtom(pagesKey(scope, pages)),

    pageRowsAtom: (scope: OlderSettledScope, pages: number) => pageRowsAtom(pagesKey(scope, pages)),
    rowsKey: (scope: OlderSettledScope, pages: number) => `older-settled:${pagesKey(scope, pages)}`,

    searchAtom: (environmentId: EnvironmentId, search: OrchestrationV2SearchThreadsInput) =>
      searchAtom(JSON.stringify([environmentId, search])),
  };
}
