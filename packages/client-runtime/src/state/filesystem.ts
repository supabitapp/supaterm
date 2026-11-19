import {
  AuthFilesystemReadScope,
  type FilesystemBrowseEntry,
  WS_METHODS,
  sessionGrantsScope,
  type SessionGrantInput,
} from "@supaterm/contracts";
import { scoreQueryMatch } from "@supaterm/shared/searchRanking";
import { Atom } from "effect/reactivity";

import type {
  EnvironmentConnectionPhase,
  EnvironmentConnectionPresentation,
} from "../connection/presentation.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  canNavigateUp,
  getBrowseDirectoryPath,
  getBrowseLeafPathSegment,
  getBrowseParentPath,
  hasTrailingPathSeparator,
  isFilesystemBrowseQuery,
} from "./projects.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

const BROWSE_IDLE_TTL_MS = 5_000;

export function resolveFilesystemReadAccess(input: {
  readonly isCatalogReady: boolean;
  readonly connection: Pick<EnvironmentConnectionPresentation, "phase" | "error"> | null;
  readonly session: SessionGrantInput | null;
  readonly sessionError: string | null;
}) {
  if (input.sessionError !== null) {
    return { canReadFiles: false, isPending: false, error: input.sessionError };
  }
  if (input.session === null) {
    const isPending =
      !input.isCatalogReady ||
      input.connection?.phase === "connected" ||
      input.connection?.phase === "connecting" ||
      input.connection?.phase === "reconnecting";
    return {
      canReadFiles: false,
      isPending,
      error: isPending ? null : (input.connection?.error ?? "This environment is not connected."),
    };
  }
  return {
    canReadFiles: sessionGrantsScope(input.session, AuthFilesystemReadScope),
    isPending: false,
    error: null,
  };
}

export function getFilesystemBrowsePath(query: string, platform = "", enabled = true) {
  const isBrowsing = enabled && isFilesystemBrowseQuery(query, platform);
  const directoryPath = isBrowsing ? getBrowseDirectoryPath(query) : "";
  const filterQuery =
    isBrowsing && !hasTrailingPathSeparator(query) ? getBrowseLeafPathSegment(query) : "";
  const parentPath = isBrowsing ? getBrowseParentPath(directoryPath) : null;

  return {
    isBrowsing,
    directoryPath,
    filterQuery,
    parentPath,
    canBrowseUp: isBrowsing && canNavigateUp(directoryPath),
  };
}

export function filterFilesystemBrowseEntries(
  entries: ReadonlyArray<FilesystemBrowseEntry>,
  query: string,
) {
  const normalizedQuery = query.normalize("NFC");
  const lowerQuery = query.toLowerCase();
  const lowerNormalizedQuery = normalizedQuery.toLowerCase();
  const showHidden = query.startsWith(".");
  const candidates = entries.filter((entry) => showHidden || !entry.name.startsWith("."));
  const visibleEntries =
    lowerQuery.length === 0
      ? candidates
      : candidates
          .flatMap((entry) => {
            const options = {
              query: lowerNormalizedQuery,
              exactBase: 0,
              prefixBase: 1000,
              boundaryBase: 2000,
              includesBase: 3000,
              fuzzyBase: 4000,
              boundaryMarkers: [" ", "-", "_", "."],
            };
            const rawScore = scoreQueryMatch({
              ...options,
              value: entry.name.toLowerCase(),
              query: lowerQuery,
            });
            const normalizedScore = scoreQueryMatch({
              ...options,
              value: entry.name.normalize("NFC").toLowerCase(),
            });
            const score =
              rawScore === null
                ? normalizedScore
                : normalizedScore === null
                  ? rawScore
                  : Math.min(rawScore, normalizedScore);
            return score === null ? [] : [{ entry, score }];
          })
          .sort((left, right) => left.score - right.score)
          .map((match) => match.entry);
  const normalizedMatches = visibleEntries.filter(
    (entry) => entry.name.normalize("NFC") === normalizedQuery,
  );
  const exactEntry =
    query.length > 0
      ? (visibleEntries.find((entry) => entry.name === query) ??
        (normalizedMatches.length === 1 ? normalizedMatches[0] : null))
      : null;

  return { visibleEntries, exactEntry };
}

/** Shell-style Tab: a single match enters the directory, several extend to their common prefix. */
export function getFilesystemBrowseTabCompletion(
  visibleEntries: ReadonlyArray<FilesystemBrowseEntry>,
  filterQuery: string,
) {
  const lowerQuery = filterQuery.toLowerCase();
  const lowerNormalizedQuery = filterQuery.normalize("NFC").toLowerCase();
  const prefixEntries = visibleEntries.filter(
    (entry) =>
      entry.name.toLowerCase().startsWith(lowerQuery) ||
      entry.name.normalize("NFC").toLowerCase().startsWith(lowerNormalizedQuery),
  );
  const [first, ...rest] = prefixEntries;
  if (first === undefined) return null;
  if (rest.length === 0) return { name: first.name, isComplete: true };
  let prefix = Array.from(first.name);
  for (const entry of rest) {
    const characters = Array.from(entry.name);
    let length = 0;
    while (
      length < prefix.length &&
      prefix[length]?.toLowerCase() === characters[length]?.toLowerCase()
    )
      length += 1;
    prefix = prefix.slice(0, length);
  }
  const name = prefix.join("");
  const lowerName = name.toLowerCase();
  return lowerName.length > lowerQuery.length &&
    prefixEntries.every((entry) => entry.name.toLowerCase().startsWith(lowerName))
    ? { name, isComplete: false }
    : null;
}

export function createBrowseNavigationCoordinator() {
  let generation = 0;

  return {
    invalidate: () => {
      generation += 1;
    },
    run: async (load: () => Promise<void>, commit: () => void) => {
      const navigationGeneration = ++generation;
      await load();
      if (navigationGeneration !== generation) {
        return false;
      }
      commit();
      return true;
    },
  };
}

export function canPreloadBrowsePath(
  connectionPhase: EnvironmentConnectionPhase | null | undefined,
) {
  return connectionPhase === "connected";
}

export function createFilesystemEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    getMetadata: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:filesystem:get-metadata",
      tag: WS_METHODS.filesystemGetMetadata,
    }),
    browse: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:filesystem:browse",
      tag: WS_METHODS.filesystemBrowse,
      idleTtlMs: BROWSE_IDLE_TTL_MS,
      staleTimeMs: 0,
    }),
  };
}
