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
  detail: null as PullRequestDetail | null,
  timestamp: 0,
  detailAtom: null as unknown,
  handlers: {} as PullRequestAnswerHandlers,
}));
vi.mock(import("@supaterm/client-runtime/state/pull-requests"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    createPullRequestEnvironmentAtoms: ((runtime, handlers) => {
      query.handlers = handlers ?? {};
      return actual.createPullRequestEnvironmentAtoms(runtime, handlers);
    }) as typeof actual.createPullRequestEnvironmentAtoms,
  };
});
vi.mock(import("~/state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (key: unknown) => ({
    data: key === query.detailAtom ? query.detail : null,
    dataUpdatedAt: key === query.detailAtom ? query.timestamp : 0,
    error: null,
    failure: null,
    isPending: false,
    isSuccess: true,
    refresh: () => {},
  }),
}));
vi.mock(import("~/state/session"), () => ({
  useEnvironmentScope: () => true,
}));
vi.mock(import("~/connection/runtime"), async () => {
  const { Atom } = await import("effect/reactivity");
  const Layer = await import("effect/Layer");
  return { connectionAtomRuntime: Atom.runtime(Layer.empty) };
});
vi.mock(import("~/state/threads"), async () => {
  const { Atom } = await import("effect/reactivity");
  return { environmentThreadShells: { threadShellsAtom: Atom.make([]) } };
});
vi.mock(import("~/hooks/usePullRequestChecksRefresh"), () => ({
  usePullRequestChecksRefresh: () => {},
}));

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
      query.detail = null;
      query.timestamp = 0;
      query.detailAtom = pullRequestEnvironment.detail({
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
      const screen = yield* Effect.acquireRelease(
        Effect.promise(() => render(content())),
        (screen) => Effect.promise(() => screen[Symbol.asyncDispose]()),
      );
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

      query.detail = detail("Fresh title", 200);
      query.timestamp = 1000;
      yield* query.handlers.detail!(
        { environmentId, input: { ...reference, allowStale: false } },
        query.detail,
        appAtomRegistry,
      );
      yield* Effect.promise(() => screen.rerender(content()));
      yield* Effect.promise(
        async () =>
          await expect
            .element(screen.getByLabelText("Observed title"))
            .toHaveTextContent("Fresh title"),
      );

      query.detail = detail("Older late answer", 100);
      query.timestamp = 2000;
      yield* query.handlers.detail!(
        { environmentId, input: { ...reference, allowStale: false } },
        query.detail,
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
