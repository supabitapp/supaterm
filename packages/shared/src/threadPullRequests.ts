import type { ThreadLinkedPullRequest, ThreadPullRequestLink } from "@supaterm/contracts";

/** Tombstones prevent sync from re-adding hidden members. */
export function visibleThreadPullRequests(links: ReadonlyArray<ThreadPullRequestLink>) {
  return links.filter((link) => link.source !== "stack-dismissed");
}

export function threadPullRequestUpdatedAtMs(link: ThreadPullRequestLink) {
  const value = link.snapshot?.updatedAt ?? link.linkedAt;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

export interface ThreadSearchPullRequest {
  readonly number: number;
  readonly title: string | null;
  /** `owner/repo#123` and the pull request URL, matched only by a whole query. */
  readonly references: ReadonlyArray<string>;
}

const SEARCHED_PULL_REQUEST_TITLES = 3;

/** Pull requests thread search matches by number, title, and reference. */
export function threadSearchPullRequests(thread: {
  readonly pullRequests?: ReadonlyArray<ThreadPullRequestLink> | undefined;
  readonly branchPullRequest?: ThreadLinkedPullRequest | null | undefined;
}) {
  const entry = (
    link: Pick<ThreadLinkedPullRequest, "number" | "repository" | "url">,
    title: string | null,
  ) => ({
    number: link.number,
    title,
    references: [`${link.repository}#${link.number}`, link.url],
  });
  const branch = thread.branchPullRequest ? [entry(thread.branchPullRequest, null)] : [];
  const newestFirst = [...visibleThreadPullRequests(thread.pullRequests ?? [])].sort(
    (left, right) => threadPullRequestUpdatedAtMs(right) - threadPullRequestUpdatedAtMs(left),
  );
  return branch.concat(
    newestFirst.map((link, index) =>
      entry(link, index < SEARCHED_PULL_REQUEST_TITLES ? (link.snapshot?.title ?? null) : null),
    ),
  );
}

export function threadPullRequestSearchTerms(thread: {
  readonly pullRequests?: ReadonlyArray<ThreadPullRequestLink> | undefined;
  readonly branchPullRequest?: ThreadLinkedPullRequest | null | undefined;
}) {
  return threadSearchPullRequests(thread).flatMap((pullRequest) => [
    `#${pullRequest.number}`,
    ...pullRequest.references,
    ...(pullRequest.title ? [pullRequest.title] : []),
  ]);
}
