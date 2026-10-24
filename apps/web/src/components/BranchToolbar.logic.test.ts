import { type VcsRef } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  dedupeRemoteBranchesWithLocalMatches,
  deriveLocalBranchNameFromRemoteRef,
  resolveBranchSelectionTarget,
  resolveDraftEnvModeAfterBranchChange,
  resolveEffectiveEnvMode,
  resolveBranchTriggerLabel,
  resolveBranchToolbarPrBranch,
  resolveBranchToolbarValue,
  resolveWorktreeBaseBranch,
  resolveLocalCheckoutBranchMismatch,
  sanitizeNewRefName,
  shouldIncludeBranchPickerItem,
  shouldShowComposerContextStrip,
} from "./BranchToolbar.logic";

describe("resolveDraftEnvModeAfterBranchChange", () => {
  it("switches to local mode when returning from an existing worktree to the main worktree", () => {
    expect(
      resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: null,
        currentWorktreePath: "/repo/.supaterm/worktrees/feature-a",
        effectiveEnvMode: "worktree",
      }),
    ).toBe("local");
  });

  it("uses worktree mode when selecting a ref already attached to a worktree", () => {
    expect(
      resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: "/repo/.supaterm/worktrees/feature-a",
        currentWorktreePath: null,
        effectiveEnvMode: "local",
      }),
    ).toBe("worktree");
  });
});

describe("resolveWorktreeBaseBranch", () => {
  const refs = [{ name: "origin/main", isDefault: true }];

  it("resolves the repository default before the current checkout without a saved selection", () => {
    const branch = resolveWorktreeBaseBranch({
      selectedBranch: null,
      refs,
      refsLoading: false,
      currentGitBranch: "feature/current",
    });
    expect(branch).toBe("origin/main");
    expect(
      resolveBranchToolbarValue({
        envMode: "worktree",
        activeWorktreePath: null,
        activeThreadBranch: branch,
        currentGitBranch: "feature/current",
      }),
    ).toBe(branch);
  });

  it("keeps an explicit base even while refs load", () => {
    expect(
      resolveWorktreeBaseBranch({
        selectedBranch: "upstream/release",
        refs,
        refsLoading: true,
        currentGitBranch: "feature/current",
      }),
    ).toBe("upstream/release");
  });

  it("waits for the default branch before falling back to the current checkout", () => {
    expect(
      resolveWorktreeBaseBranch({
        selectedBranch: null,
        refs: [],
        refsLoading: true,
        currentGitBranch: "feature/current",
      }),
    ).toBeNull();
    expect(
      resolveWorktreeBaseBranch({
        selectedBranch: null,
        refs: [],
        refsLoading: false,
        currentGitBranch: "feature/current",
      }),
    ).toBe("feature/current");
  });

  it("requires a selection when neither a default nor a checkout branch is known", () => {
    expect(
      resolveWorktreeBaseBranch({
        selectedBranch: null,
        refs: [],
        refsLoading: false,
        currentGitBranch: null,
      }),
    ).toBeNull();
  });
});

describe("resolveBranchToolbarValue", () => {
  it("does not display an unresolved checkout fallback as a worktree base", () => {
    expect(
      resolveBranchToolbarValue({
        envMode: "worktree",
        activeWorktreePath: null,
        activeThreadBranch: null,
        currentGitBranch: "main",
      }),
    ).toBeNull();
  });
});

describe("resolveBranchTriggerLabel", () => {
  it("labels an unresolved worktree base as the default branch", () => {
    expect(
      resolveBranchTriggerLabel({
        activeWorktreePath: null,
        effectiveEnvMode: "local",
        resolvedActiveBranch: "main",
        resolvedActiveBranchIsRemote: false,
        startFromOrigin: true,
      }),
    ).toBe("main");
    expect(
      resolveBranchTriggerLabel({
        activeWorktreePath: null,
        effectiveEnvMode: "worktree",
        resolvedActiveBranch: null,
        resolvedActiveBranchIsRemote: null,
        startFromOrigin: true,
      }),
    ).toBe("Default branch");
    expect(
      resolveBranchTriggerLabel({
        activeWorktreePath: null,
        effectiveEnvMode: "local",
        resolvedActiveBranch: null,
        resolvedActiveBranchIsRemote: null,
        startFromOrigin: true,
      }),
    ).toBe("Select ref");
  });
});

describe("resolveBranchToolbarPrBranch", () => {
  it("hides PR state while an optimistic branch switch is in flight", () => {
    expect(
      resolveBranchToolbarPrBranch({
        activeThreadBranch: "feature/current",
        resolvedActiveBranch: "feature/next",
      }),
    ).toBeNull();
  });
});

describe("resolveLocalCheckoutBranchMismatch", () => {
  it("detects when a local thread is associated with a different branch than the checkout", () => {
    expect(
      resolveLocalCheckoutBranchMismatch({
        effectiveEnvMode: "local",
        activeWorktreePath: null,
        activeThreadBranch: "feature/thread",
        currentGitBranch: "feature/current",
      }),
    ).toEqual({
      threadBranch: "feature/thread",
      currentBranch: "feature/current",
    });
  });

  it("ignores dedicated worktrees because their checkout is already thread-scoped", () => {
    expect(
      resolveLocalCheckoutBranchMismatch({
        effectiveEnvMode: "worktree",
        activeWorktreePath: "/repo/.supaterm/worktrees/feature-thread",
        activeThreadBranch: "feature/thread",
        currentGitBranch: "feature/current",
      }),
    ).toBeNull();
  });
});

describe("shouldShowComposerContextStrip", () => {
  it("keeps the strip for a new draft's project picker without a project", () => {
    expect(
      shouldShowComposerContextStrip({
        showProjectPicker: true,
        persistInActiveThreads: false,
        hasActiveProject: false,
        hostsRestingComposerControls: false,
      }),
    ).toBe(true);
  });

  it("shows an active thread's strip only with the preference and something to host", () => {
    const input = { showProjectPicker: false, hasActiveProject: true };
    expect(
      shouldShowComposerContextStrip({
        ...input,
        persistInActiveThreads: false,
        hostsRestingComposerControls: true,
      }),
    ).toBe(false);
    expect(
      shouldShowComposerContextStrip({
        ...input,
        persistInActiveThreads: true,
        hostsRestingComposerControls: false,
      }),
    ).toBe(false);
    expect(
      shouldShowComposerContextStrip({
        ...input,
        persistInActiveThreads: true,
        hostsRestingComposerControls: true,
      }),
    ).toBe(true);
  });
});

describe("resolveEffectiveEnvMode", () => {
  it("keeps a server thread in worktree mode while its worktree is still being created", () => {
    expect(
      resolveEffectiveEnvMode({
        activeWorktreePath: null,
        hasServerThread: true,
        draftThreadEnvMode: undefined,
        preparingWorktree: true,
      }),
    ).toBe("worktree");
    expect(
      resolveEffectiveEnvMode({
        activeWorktreePath: null,
        hasServerThread: true,
        draftThreadEnvMode: undefined,
      }),
    ).toBe("local");
  });
});

describe("deriveLocalBranchNameFromRemoteRef", () => {
  it("supports remote names that contain slashes", () => {
    expect(deriveLocalBranchNameFromRemoteRef("my-org/upstream/feature/demo")).toBe(
      "upstream/feature/demo",
    );
  });
});

describe("dedupeRemoteBranchesWithLocalMatches", () => {
  it("hides remote refs when the matching local ref exists", () => {
    const input: VcsRef[] = [
      {
        name: "feature/demo",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: "origin/feature/demo",
        isRemote: true,
        remoteName: "origin",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: "origin/feature/remote-only",
        isRemote: true,
        remoteName: "origin",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
    ];

    expect(dedupeRemoteBranchesWithLocalMatches(input).map((ref) => ref.name)).toEqual([
      "feature/demo",
      "origin/feature/remote-only",
    ]);
  });

  it("keeps non-origin remote refs visible when git tracks with first-slash local naming", () => {
    const input: VcsRef[] = [
      {
        name: "upstream/feature",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: "my-org/upstream/feature",
        isRemote: true,
        remoteName: "my-org/upstream",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
    ];

    expect(dedupeRemoteBranchesWithLocalMatches(input).map((ref) => ref.name)).toEqual([
      "upstream/feature",
      "my-org/upstream/feature",
    ]);
  });
});

describe("resolveBranchSelectionTarget", () => {
  it("reuses an existing secondary worktree for the selected ref", () => {
    expect(
      resolveBranchSelectionTarget({
        activeProjectCwd: "/repo",
        activeWorktreePath: "/repo/.supaterm/worktrees/feature-a",
        refName: {
          isDefault: false,
          worktreePath: "/repo/.supaterm/worktrees/feature-b",
        },
      }),
    ).toEqual({
      checkoutCwd: "/repo/.supaterm/worktrees/feature-b",
      nextWorktreePath: "/repo/.supaterm/worktrees/feature-b",
      reuseExistingWorktree: true,
    });
  });

  it("switches back to the main repo when the ref already lives there", () => {
    expect(
      resolveBranchSelectionTarget({
        activeProjectCwd: "/repo",
        activeWorktreePath: "/repo/.supaterm/worktrees/feature-a",
        refName: {
          isDefault: true,
          worktreePath: "/repo",
        },
      }),
    ).toEqual({
      checkoutCwd: "/repo",
      nextWorktreePath: null,
      reuseExistingWorktree: true,
    });
  });

  it("keeps checkout in the current worktree for non-default refs", () => {
    expect(
      resolveBranchSelectionTarget({
        activeProjectCwd: "/repo",
        activeWorktreePath: "/repo/.supaterm/worktrees/feature-a",
        refName: {
          isDefault: false,
          worktreePath: null,
        },
      }),
    ).toEqual({
      checkoutCwd: "/repo/.supaterm/worktrees/feature-a",
      nextWorktreePath: "/repo/.supaterm/worktrees/feature-a",
      reuseExistingWorktree: false,
    });
  });
});

describe("shouldIncludeBranchPickerItem", () => {
  it("keeps the synthetic checkout PR item visible for gh pr checkout input", () => {
    expect(
      shouldIncludeBranchPickerItem({
        itemValue: "__checkout_pull_request__:1359",
        normalizedQuery: "gh pr checkout 1359",
        createBranchItemValue: "__create_new_branch__:gh pr checkout 1359",
        checkoutPullRequestItemValue: "__checkout_pull_request__:1359",
      }),
    ).toBe(true);
  });

  it("surfaces an existing ref matching the sanitized query", () => {
    expect(
      shouldIncludeBranchPickerItem({
        itemValue: "new-branch",
        normalizedQuery: "new branch",
        createBranchItemValue: null,
        checkoutPullRequestItemValue: null,
      }),
    ).toBe(true);
  });
});

describe("sanitizeNewRefName", () => {
  it("collapses a run of whitespace into a single dash", () => {
    expect(sanitizeNewRefName("new   branch")).toBe("new-branch");
  });

  it("replaces tabs, which git rejects just like spaces", () => {
    expect(sanitizeNewRefName("new\tbranch")).toBe("new-branch");
  });

  it("preserves whitespace that git accepts", () => {
    expect(sanitizeNewRefName("new\u00a0branch")).toBe("new\u00a0branch");
    expect(sanitizeNewRefName("new\u2009branch")).toBe("new\u2009branch");
  });

  it("does not collapse dashes the user typed", () => {
    expect(sanitizeNewRefName("new - branch")).toBe("new---branch");
    expect(sanitizeNewRefName("foo--bar")).toBe("foo--bar");
  });
});
