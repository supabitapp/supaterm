import type { PullRequestAnswerHandlers } from "@supaterm/client-runtime/state/pull-requests";
import {
  EnvironmentId,
  ProjectId,
  type PullRequestFilesViewedResult,
  type PullRequestListEntry,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { beforeEach, vi } from "vite-plus/test";
import { expect, it } from "@effect/vitest";

const fixture = vi.hoisted(() => ({
  handlers: undefined as PullRequestAnswerHandlers | undefined,
  viewed: [{ path: "src/index.ts", state: "viewed" }] as PullRequestFilesViewedResult["files"],
  viewedReads: 0,
  statsReads: 0,
}));

vi.mock("../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("@supaterm/client-runtime/state/pull-requests", async () => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const detail = Atom.make(AsyncResult.success({ headSha: "old-head" }));
  const filesViewed = Atom.make(() => {
    fixture.viewedReads += 1;
    return { files: fixture.viewed, truncated: false };
  });
  const stats = Atom.make(() => ++fixture.statsReads);
  return {
    createPullRequestEnvironmentAtoms: (_runtime: unknown, handlers: PullRequestAnswerHandlers) => {
      fixture.handlers = handlers;
      return {
        detail: () => detail,
        filesViewed: () => filesViewed,
        listStats: () => stats,
        refreshes: Atom.make(0),
      };
    },
    createPullRequestStackAtomFamily: () => Atom.make(null),
  };
});

import {
  composerPullRequests,
  pullRequestListPagesFamily,
  pullRequestListPagesKey,
  pullRequestListStatsFamily,
} from "./pull-requests";

const target = {
  environmentId: EnvironmentId.make("env"),
  input: { projectId: ProjectId.make("project"), repository: "org/repo", number: 1 },
};

beforeEach(() => {
  fixture.viewed = [{ path: "src/index.ts", state: "viewed" }];
  fixture.viewedReads = 0;
  fixture.statsReads = 0;
});

it.effect("refreshes mounted viewed files when the detail head changes", () =>
  Effect.gen(function* () {
    const registry = AtomRegistry.make();
    using _registry = { [Symbol.dispose]: () => registry.dispose() };
    const atom = composerPullRequests.filesViewed(target);
    using _mounted = { [Symbol.dispose]: registry.mount(atom) };
    expect(registry.get(atom)).toMatchObject({ files: [{ state: "viewed" }] });
    const detail = registry.get(composerPullRequests.detail(target));
    const previous = AsyncResult.getOrElse(detail, () => null)!;
    yield* fixture.handlers!.detail!(target, previous, registry);
    expect(fixture.viewedReads).toBe(1);

    fixture.viewed = [{ path: "src/index.ts", state: "dismissed" }];
    yield* fixture.handlers!.detail!(target, { ...previous, headSha: "new-head" }, registry);
    expect(registry.get(atom)).toMatchObject({ files: [{ state: "dismissed" }] });
    expect(fixture.viewedReads).toBe(2);
  }),
);

it.effect(
  "invalidates cached stats and refreshes their mounted query after a newer list answer",
  () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      using _registry = { [Symbol.dispose]: () => registry.dispose() };
      const statsInput = { refs: [target.input] };
      const statsTarget = { environmentId: target.environmentId, input: statsInput };
      const statsAtom = composerPullRequests.listStats(statsTarget);
      using _mounted = { [Symbol.dispose]: registry.mount(statsAtom) };
      registry.get(statsAtom);
      const stat = { ...target.input, additions: 3, deletions: 1 };
      const row = { ...target.input, updatedAt: "2026-10-01T00:00:00Z" } as PullRequestListEntry;
      const listTarget = { environmentId: target.environmentId, input: { state: "open" as const } };
      const page = {
        entries: [row],
        nextCursors: {},
        truncated: false,
        viewers: {},
        providers: [],
        errors: [],
      };
      yield* fixture.handlers!.list!(listTarget, page, registry);
      yield* fixture.handlers!.listStats!(statsTarget, { stats: [stat] }, registry);
      const cache = pullRequestListStatsFamily(target.environmentId);
      expect([...registry.get(cache).stats.values()]).toEqual([stat]);
      yield* fixture.handlers!.list!(listTarget, page, registry);
      expect(fixture.statsReads).toBe(1);

      const updated = { ...page, entries: [{ ...row, updatedAt: "2026-10-02T00:00:00Z" }] };
      yield* fixture.handlers!.list!(listTarget, updated, registry);
      expect(registry.get(cache).stats.size).toBe(0);
      expect(fixture.statsReads).toBe(2);
      expect(
        registry.get(pullRequestListPagesFamily(pullRequestListPagesKey(listTarget)))?.entries,
      ).toEqual(updated.entries);
    }),
);
