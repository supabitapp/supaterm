import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/models";
import {
  isListedDoneThread,
  doneShelfFrontier,
  unloadedOlderDoneCount,
  wantedOlderDonePages,
  type OlderDoneScope,
} from "@supaterm/client-runtime/state/threads";
import type { EnvironmentId, ProjectId } from "@supaterm/contracts";
import { useEffect, useState } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { olderDoneThreads, threadFamilies } from "./threads";

const NO_PAGES: ReadonlyMap<EnvironmentId, number> = new Map();

/**
 * The Done shelf for one scope when shells leave older done threads out: which rows it may
 * list, how many threads it holds in all, and the pages read below each environment's cut, whose
 * rows merge into the thread list. `useOlderDoneShelfGrowth` reads the next pages.
 */
export function useOlderDoneShelf(input: {
  readonly scopes: ReadonlyArray<OlderDoneScope>;
  /** A collapsed shelf mounts no pages, so a reconnect reads none; expanding restores them. */
  readonly expanded: boolean;
  /** Rows the shelf shows; pages are read until it lists that many. */
  readonly visibleCount: number;
}) {
  const scopeKey = JSON.stringify(input.scopes);
  const [requested, setRequested] = useState({ scopeKey, pages: NO_PAGES });
  const pages = requested.scopeKey === scopeKey && input.expanded ? requested.pages : NO_PAGES;
  const shelfScopes = input.scopes.map((scope) => ({
    scope,
    pages: pages.get(scope.environmentId) ?? 0,
  }));
  const shelfKey = JSON.stringify(shelfScopes);
  const shelf = useAtomValue(olderDoneThreads.shelfAtom(shelfScopes));
  useEffect(() => {
    const releases = (JSON.parse(shelfKey) as typeof shelfScopes).flatMap(({ scope, pages }) =>
      pages === 0
        ? []
        : [
            threadFamilies.mountRows(
              appAtomRegistry,
              scope.environmentId,
              olderDoneThreads.rowsKey(scope, pages),
              olderDoneThreads.pageRowsAtom(scope, pages),
            ),
          ],
    );
    return () => {
      for (const release of releases) release();
    };
  }, [shelfKey]);

  const olderOf = (environmentId: EnvironmentId) => shelf.get(environmentId)?.older ?? null;
  const pagesOf = (environmentId: EnvironmentId) => shelf.get(environmentId)?.pages;
  const frontier = doneShelfFrontier([...shelf.values()]);
  const loaded = shelfScopes.filter(({ pages }) => pages > 0);
  return {
    environments: shelf,
    visibleCount: input.expanded ? input.visibleCount : 0,
    pages,
    grow: (next: ReadonlyMap<EnvironmentId, number>) => setRequested({ scopeKey, pages: next }),
    isListed: (thread: EnvironmentThreadShell) => isListedDoneThread(thread.source, frontier),
    /** Older done threads in scope that are not local; add it to the local Done rows. */
    unloadedCount: (threads: ReadonlyArray<EnvironmentThreadShell>) =>
      unloadedOlderDoneCount({ olderDone: olderOf, scopes: input.scopes, threads }),
    loading: loaded.some(({ scope }) => pagesOf(scope.environmentId)?.status === "pending"),
    failed: loaded.some(({ scope }) => pagesOf(scope.environmentId)?.status === "failed"),
    retry: () => {
      for (const { scope, pages } of loaded) {
        olderDoneThreads.retryPages(appAtomRegistry, scope, pages);
      }
    },
  };
}

/** Reads the next pages while the shelf lists fewer rows than it shows. */
export function useOlderDoneShelfGrowth(
  shelf: ReturnType<typeof useOlderDoneShelf>,
  listedDoneThreads: ReadonlyArray<EnvironmentThreadShell>,
) {
  const wanted = wantedOlderDonePages({
    requested: shelf.pages,
    environments: shelf.environments,
    listedCount: listedDoneThreads.length,
    visibleCount: shelf.visibleCount,
  });
  const { grow, pages } = shelf;
  useEffect(() => {
    if (wanted !== pages) grow(wanted);
  }, [wanted, pages, grow]);
}

/**
 * Threads of these projects that this client does not hold (older done threads), for counts
 * shown outside the shelf, such as a removal confirm.
 */
export function readUnloadedThreadCount(
  members: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly id: ProjectId }>,
  threads: ReadonlyArray<EnvironmentThreadShell>,
): number {
  return unloadedOlderDoneCount({
    olderDone: (environmentId) =>
      appAtomRegistry.get(olderDoneThreads.olderDoneAtom(environmentId)),
    scopes: [...new Set(members.map((member) => member.environmentId))].map((environmentId) => ({
      environmentId,
      projectIds: members.flatMap((member) =>
        member.environmentId === environmentId ? [member.id] : [],
      ),
    })),
    threads: threads.filter((thread) =>
      members.some(
        (member) => member.environmentId === thread.environmentId && member.id === thread.projectId,
      ),
    ),
  });
}
