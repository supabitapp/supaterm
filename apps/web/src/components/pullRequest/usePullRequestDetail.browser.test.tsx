import {
  EnvironmentId,
  ProjectId,
  SourceControlProviderKind,
  type PullRequestDetail,
} from "@supaterm/contracts";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";

const query = vi.hoisted(() => ({ detail: null as PullRequestDetail | null, timestamp: 0 }));
vi.mock(import("~/state/query"), () => ({
  useEnvironmentQuery: (key: unknown) => ({
    data: key === "detail" ? query.detail : null,
    dataUpdatedAt: key === "detail" ? query.timestamp : 0,
    error: null,
    failure: null,
    isPending: false,
    isSuccess: true,
    refresh: () => {},
  }),
}));
vi.mock(import("~/state/pullRequests"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    pullRequestEnvironment: {
      ...actual.pullRequestEnvironment,
      detail: (() => "detail") as never,
      activity: (() => "activity") as never,
      checks: (() => "checks") as never,
    },
  };
});
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
}));
vi.mock(import("~/hooks/usePullRequestChecksRefresh"), () => ({
  usePullRequestChecksRefresh: () => {},
}));

import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";
import { useSharedPullRequestSummary } from "~/state/pullRequests";
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
  const observed = useSharedPullRequestSummary(environmentId, reference, null);
  return (
    <>
      <output aria-label="Detail title">{displayed?.title ?? "No detail"}</output>
      <output aria-label="Observed title">{observed?.title ?? "No observation"}</output>
    </>
  );
}

it("keeps disk detail out of the observation cache and rejects an older answer arriving later", async () => {
  query.detail = null;
  query.timestamp = 0;
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
  await using screen = await render(content());
  await expect.element(screen.getByLabelText("Detail title")).toHaveTextContent("Cached title");
  await expect.element(screen.getByLabelText("Observed title")).toHaveTextContent("No observation");

  query.detail = detail("Fresh title", 200);
  query.timestamp = 1000;
  await screen.rerender(content());
  await expect.element(screen.getByLabelText("Observed title")).toHaveTextContent("Fresh title");

  query.detail = detail("Older late answer", 100);
  query.timestamp = 2000;
  await screen.rerender(content());
  await expect.element(screen.getByLabelText("Detail title")).toHaveTextContent("Fresh title");
  await expect.element(screen.getByLabelText("Observed title")).toHaveTextContent("Fresh title");
});
