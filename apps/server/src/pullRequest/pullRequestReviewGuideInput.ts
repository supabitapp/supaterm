import type { PullRequestActivity, PullRequestDetail } from "@supaterm/contracts";

const SETTLED_REMARK_CHARS = 200;

function oneLine(text: string) {
  const flat = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > SETTLED_REMARK_CHARS ? `${flat.slice(0, SETTLED_REMARK_CHARS)}…` : flat;
}

function settledReviewSummary(activity: PullRequestActivity) {
  return activity.reviewThreads
    .filter((thread) => thread.isResolved || thread.isOutdated)
    .flatMap((thread) => {
      const opener = thread.comments[0];
      if (opener === undefined) return [];
      const who = opener.author?.login ?? "ghost";
      const state = thread.isResolved ? "resolved" : "outdated";
      return [`- ${thread.path} (${state}, ${who}): ${oneLine(opener.body)}`];
    })
    .join("\n");
}

export function reviewGuideInputFromPullRequest(
  detail: PullRequestDetail,
  activity: PullRequestActivity,
  baseCommit: string,
) {
  return {
    number: detail.number,
    title: detail.title,
    description: detail.body,
    baseBranch: detail.baseBranch,
    baseCommit,
    settledReview: settledReviewSummary(activity),
  };
}
