import type * as AtomTypes from "effect/reactivity/Atom";
import type { PullRequestAnswerHandlers } from "@supaterm/client-runtime/state/pull-requests";
import * as Effect from "effect/Effect";
import {
  EnvironmentId,
  ProjectId,
  SourceControlProviderKind,
  type PullRequestDetail,
} from "@supaterm/contracts";
import { it } from "@effect/vitest";
import { expect, vi } from "vite-plus/test";
import { render } from "../../../test/render";

const query = vi.hoisted(() => ({
  handlers: {} as PullRequestAnswerHandlers,
}));
vi.mock(import("@supaterm/client-runtime/state/pull-requests"), async (original) => {
  const actual = await original();
  const { AsyncResult, Atom } = await import("effect/reactivity");
  return {
    ...actual,
    createPullRequestEnvironmentAtoms: ((runtime, handlers) => {
      query.handlers = handlers ?? {};
      const environment = actual.createPullRequestEnvironmentAtoms(runtime, handlers);
      const detail = Atom.make<AtomTypes.Type<ReturnType<typeof environment.detail>>>(
        AsyncResult.initial(),
      );
      const activity = Atom.make<AtomTypes.Type<ReturnType<typeof environment.activity>>>(
        AsyncResult.initial(),
      );
      const checks = Atom.make<AtomTypes.Type<ReturnType<typeof environment.checks>>>(
        AsyncResult.initial(),
      );
      return {
        ...environment,
        detail: () => detail,
        activity: () => activity,
        checks: () => checks,
      };
    }) satisfies typeof actual.createPullRequestEnvironmentAtoms,
  };
});
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
}));
vi.mock(import("~/state/threads"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  return {
    ...actual,
    environmentThreadShells: {
      ...actual.environmentThreadShells,
      threadShellsAtom: Atom.make<
        AtomTypes.Type<typeof actual.environmentThreadShells.threadShellsAtom>
      >([]),
    },
  };
});
vi.mock(import("~/hooks/usePullRequestChecksRefresh"), () => ({
  usePullRequestChecksRefresh: () => {},
}));

import { AsyncResult } from "effect/reactivity";
import { appAtomRegistry, AppAtomRegistryProvider } from "~/rpc/atomRegistry";
import { pullRequestEnvironment, useSharedPullRequestSummary } from "~/state/pullRequests";
import { usePullRequestDetail } from "./usePullRequestDetail";
import { writePullRequestDetailSnapshot } from "./pullRequestDetail.logic";

const environmentId = EnvironmentId.make("summary-freshness-regression");
const reference = { projectId: ProjectId.make("project"), repository: "owner/repo", number: 7 };
const detail = (title: string, observedAt: number): PullRequestDetail => ({
  provider: SourceControlProviderKind.make("github"),
  capabilities: {
    diff: true,
    comment: true,
    actions: [],
    mergeMethods: [],
    search: true,
    review: { inlineComment: true, reply: true, resolve: true, verdicts: [] },
    reviewers: { request: true, listCandidates: true },
  },
  viewerPermissions: {
    actions: [],
    comment: true,
    resolve: true,
    verdicts: [],
    requestReviewers: false,
  },
  ...reference,
  projectTitle: "Project",
  workspaceRoot: "/project",
  title,
  body: "",
  url: "https://github.com/owner/repo/pull/7",
  author: null,
  state: "open",
  isDraft: false,
  mergeability: "mergeable",
  additions: 0,
  deletions: 0,
  changedFiles: 0,
  headBranch: "feature",
  baseBranch: "main",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
  observedAt,
  mergedAt: null,
  closedAt: null,
  reviewers: [],
  labels: [],
  checks: [],
  mergeCapabilities: { merge: false, squash: false, rebase: false },
});

function Subject() {
  const { detail: displayed } = usePullRequestDetail(environmentId, reference, null);
  const observed = useSharedPullRequestSummary(environmentId, reference);
  return (
    <>
      <output aria-label="Detail title">{displayed?.title ?? "No detail"}</output>
      <output aria-label="Observed title">{observed?.title ?? "No observation"}</output>
    </>
  );
}

it.effect(
  "keeps disk detail out of the observation cache and rejects an older answer arriving later",
  () =>
    Effect.gen(function* () {
      const detailAtom = pullRequestEnvironment.detail({
        environmentId,
        input: { ...reference, allowStale: false },
      });
      writePullRequestDetailSnapshot(
        localStorage,
        environmentId,
        reference,
        detail("Cached title", 50),
      );
      const content = () => (
        <AppAtomRegistryProvider>
          <Subject />
        </AppAtomRegistryProvider>
      );
      const screen = yield* Effect.acquireDisposable(Effect.promise(() => render(content())));
      yield* Effect.promise(
        async () =>
          await expect
            .element(screen.getByLabelText("Detail title"))
            .toHaveTextContent("Cached title"),
      );
      yield* Effect.promise(
        async () =>
          await expect
            .element(screen.getByLabelText("Observed title"))
            .toHaveTextContent("No observation"),
      );

      const fresh = detail("Fresh title", 200);
      appAtomRegistry.set(detailAtom, AsyncResult.success(fresh, { timestamp: 1000 }));
      yield* query.handlers.detail!(
        { environmentId, input: { ...reference, allowStale: false } },
        fresh,
        appAtomRegistry,
      );
      yield* Effect.promise(() => screen.rerender(content()));
      yield* Effect.promise(
        async () =>
          await expect
            .element(screen.getByLabelText("Observed title"))
            .toHaveTextContent("Fresh title"),
      );

      const older = detail("Older late answer", 100);
      appAtomRegistry.set(detailAtom, AsyncResult.success(older, { timestamp: 2000 }));
      yield* query.handlers.detail!(
        { environmentId, input: { ...reference, allowStale: false } },
        older,
        appAtomRegistry,
      );
      yield* Effect.promise(() => screen.rerender(content()));
      yield* Effect.promise(
        async () =>
          await expect
            .element(screen.getByLabelText("Detail title"))
            .toHaveTextContent("Fresh title"),
      );
      yield* Effect.promise(
        async () =>
          await expect
            .element(screen.getByLabelText("Observed title"))
            .toHaveTextContent("Fresh title"),
      );
    }).pipe(Effect.scoped),
);
