import { PullRequestListedAction } from "@supaterm/contracts";
import { sourceControlClients } from "@supaterm/client-runtime/source-control-clients";
import { describe, expect, it } from "vite-plus/test";
import {
  allowedMergeMethods,
  canPerformPullRequestAction,
  mergeUnavailableReason,
  pullRequestActionLabel,
  resolveMergeMethod,
} from "./pullRequestActions";

const LISTED_ACTIONS = PullRequestListedAction.literals;
const GITHUB = sourceControlClients.get("github").changeRequest;
const GITLAB = sourceControlClients.get("gitlab").changeRequest;

type Detail = Parameters<typeof allowedMergeMethods>[0];

function detail(overrides: Partial<Detail> = {}) {
  return {
    state: "open",
    isDraft: false,
    mergeability: "mergeable",
    autoMergeEnabled: false,
    capabilities: {
      actions: LISTED_ACTIONS,
      mergeMethods: ["merge", "squash", "rebase"],
      updateMethods: ["merge", "rebase"],
    },
    viewerPermissions: { actions: LISTED_ACTIONS, updateMethods: ["merge"] },
    mergeCapabilities: { merge: true, squash: true, rebase: false },
    ...overrides,
  } satisfies Detail;
}

describe("mobile pull request actions", () => {
  it("requires both provider support and account permission", () => {
    expect(
      canPerformPullRequestAction(detail({ viewerPermissions: { actions: [] } }), "merge"),
    ).toBe(false);
    expect(
      canPerformPullRequestAction(
        detail({ capabilities: { actions: [], mergeMethods: ["merge"] } }),
        "merge",
      ),
    ).toBe(false);
    expect(mergeUnavailableReason(detail(), false, GITHUB)).toContain("read-only");
  });

  it("blocks a conflicting PR's immediate merge and explains why", () => {
    const pr = detail({ mergeability: "conflicting" });
    expect(canPerformPullRequestAction(pr, "merge")).toBe(false);
    expect(mergeUnavailableReason(pr, true, GITHUB)).toContain("conflicts");
  });

  it("picks the chosen, project default, then last used merge method the repository allows", () => {
    const pr = detail();
    expect(resolveMergeMethod(pr, null, "merge", "squash")).toBe("merge");
    expect(resolveMergeMethod(pr, "squash", "merge", "merge")).toBe("squash");
    expect(resolveMergeMethod(pr, null, "rebase", "merge")).toBe("merge");
    expect(resolveMergeMethod(pr, null, null, undefined)).toBe("squash");
    expect(
      resolveMergeMethod(
        detail({ mergeCapabilities: { merge: true, squash: false, rebase: false } }),
        null,
        null,
        "rebase",
      ),
    ).toBe("merge");
  });

  it("names the change request with its host's term", () => {
    expect(pullRequestActionLabel("close", GITHUB)).toBe("Close pull request");
    expect(pullRequestActionLabel("close", GITLAB)).toBe("Close merge request");
    expect(pullRequestActionLabel("revert", GITLAB)).toBe("Create revert merge request");
    expect(mergeUnavailableReason(detail({ state: "merged" }), true, GITLAB)).toBe(
      "This merge request has been merged.",
    );
  });
});
