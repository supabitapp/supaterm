import { EnvironmentId, ProviderInstanceId, RunId, type VcsRef } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";
import { dedupeRemoteBranchesWithLocalMatches } from "@supaterm/shared/git";
import {
  deriveLocalBranchNameFromRemoteRef,
  isWorktreeChangeBlocked,
  resolveBranchSelectionTarget,
  resolveDraftEnvModeAfterBranchChange,
  resolveEffectiveEnvMode,
  resolveBranchTriggerLabel,
  resolveBranchToolbarPrBranch,
  resolveBranchToolbarValue,
  resolveWorktreeBaseBranch,
  resolveLocalCheckoutBranchMismatch,
  resolveLockedWorkspaceLabel,
  sanitizeNewRefName,
  shouldIncludeBranchPickerItem,
  shouldShowComposerContextStrip,
  isBranchHoldCurrent,
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
  const refs = [
    { name: "feature/current", isDefault: false, current: true },
    { name: "origin/main", isDefault: true, current: false },
  ];

  it("resolves the repository default before the current checkout without a saved selection", () => {
    const branch = resolveWorktreeBaseBranch({ selectedBranch: null, refs, refsLoading: false });
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
      }),
    ).toBe("upstream/release");
  });

  it("waits for the default branch before falling back to the current checkout", () => {
    const current = refs.filter((ref) => ref.current);
    expect(
      resolveWorktreeBaseBranch({ selectedBranch: null, refs: current, refsLoading: true }),
    ).toBeNull();
    expect(
      resolveWorktreeBaseBranch({ selectedBranch: null, refs: current, refsLoading: false }),
    ).toBe("feature/current");
  });

  it("offers nothing while a clone has no refs, then the default branch once they are listed", () => {
    expect(
      resolveWorktreeBaseBranch({ selectedBranch: null, refs: [], refsLoading: false }),
    ).toBeNull();
    expect(resolveWorktreeBaseBranch({ selectedBranch: null, refs, refsLoading: false })).toBe(
      "origin/main",
    );
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

describe("resolveLockedWorkspaceLabel", () => {
  it.each([
    ["/home/me/.supaterm/worktrees/app/supaterm-ff466c42", "supaterm-ff466c42"],
    ["/home/me/.supaterm/worktrees/app/supaterm-ff466c42/", "supaterm-ff466c42"],
    ["C:\\Users\\me\\worktrees\\feature-x", "feature-x"],
  ])("names the worktree at %s", (path, label) => {
    expect(resolveLockedWorkspaceLabel(path, "worktree")).toBe(label);
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
  it.each([
    ["feature/demo", "origin/feature/demo", true],
    ["feature/demo", "feature/demo", false],
    ["demo", "demo", true],
    ["origin/", "origin/", true],
    ["/demo", "/demo", true],
    ["", "", false],
  ])("filters origin ref %s / %s (hidden: %s)", (localName, remoteName, hidden) => {
    const input: VcsRef[] = [
      {
        name: localName,
        current: false,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: remoteName,
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

    const result = dedupeRemoteBranchesWithLocalMatches(input);
    const expected = hidden ? [input[0], input[2]] : input;
    expect(result).toEqual(expected);
    for (const [index, ref] of result.entries()) {
      expect(ref).toBe(expected[index]);
    }
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
        activeProjectCwd: "/repo/nested-checkout/packages/app",
        activeProjectCheckoutRoot: "/repo/nested-checkout",
        activeWorktreePath: null,
        refName: { isDefault: true, worktreePath: "/repo" },
      }),
    ).toEqual({
      checkoutCwd: "/repo",
      nextWorktreePath: "/repo",
      reuseExistingWorktree: true,
      staysInActiveCheckout: false,
    });
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
      staysInActiveCheckout: false,
    });
  });

  it("switches back to the main repo when the ref already lives there", () => {
    // A subdirectory project's own checkout is reported at the repository root.
    // The checkout root is undefined until the project's status loads.
    for (const [activeProjectCwd, activeWorktreePath, activeProjectCheckoutRoot] of [
      ["/repo", "/repo/.supaterm/worktrees/feature-a", "/repo"],
      ["/repo/packages/app", "/repo/.supaterm/worktrees/feature-a", "/repo"],
      ["/repo/packages/app", null, "/repo"],
      ["/repo/packages/app", "/repo/.supaterm/worktrees/feature-a", undefined],
      ["/repo/packages/app", null, undefined],
    ] as const) {
      expect(
        resolveBranchSelectionTarget({
          activeProjectCwd,
          activeProjectCheckoutRoot,
          activeWorktreePath,
          refName: {
            isDefault: true,
            worktreePath: "/repo",
          },
        }),
      ).toEqual({
        checkoutCwd: "/repo",
        nextWorktreePath: null,
        reuseExistingWorktree: true,
        // A ref listed in the thread's own checkout may be stale, so it is checked out, not assumed.
        staysInActiveCheckout: activeWorktreePath === null,
      });
    }
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
      staysInActiveCheckout: true,
    });
  });
});

describe("isWorktreeChangeBlocked", () => {
  const runtime = (status: "preparing" | "running" | "completed") => ({
    status,
    activeRunId: status === "completed" ? null : RunId.make("run"),
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: null,
    lastError: null,
  });

  it.each([
    ["preparing", "/repo/wt-a", null, true],
    ["running", "/repo/wt-a", "/repo/wt-b", true],
    ["running", null, "/repo/wt-b", true],
    ["running", "/repo/wt-a", "/repo/wt-a", false],
    ["completed", "/repo/wt-a", null, false],
  ] as const)(
    "a %s turn moving %s -> %s is blocked: %s",
    (status, currentWorktreePath, nextWorktreePath, blocked) => {
      expect(
        isWorktreeChangeBlocked({
          runtime: runtime(status),
          currentWorktreePath,
          nextWorktreePath,
        }),
      ).toBe(blocked);
    },
  );
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

describe("isBranchHoldCurrent", () => {
  const environmentId = EnvironmentId.make("env-a");
  const hold = {
    branch: "feature",
    environmentId,
    checkouts: [{ cwd: "/repo", replaces: "main" }],
  };
  const current = { canonicalBranch: "main", environmentId, cwd: "/repo" };

  it("keeps showing the checked-out branch while status still reports the old one", () => {
    expect(isBranchHoldCurrent(hold, current)).toBe(true);
  });

  it("lets go once status moves, even to a different branch than the checkout", () => {
    for (const canonicalBranch of ["feature", "other", null]) {
      expect(isBranchHoldCurrent(hold, { ...current, canonicalBranch })).toBe(false);
    }
  });

  it("does not apply to another checkout that happens to be on the old branch", () => {
    expect(isBranchHoldCurrent(hold, { ...current, cwd: "/other" })).toBe(false);
  });

  it("follows a thread moving from its worktree to the project root", () => {
    const moveHold = {
      branch: "main",
      environmentId,
      checkouts: [
        { cwd: "/repo-feature", replaces: "feature" },
        { cwd: "/repo", replaces: "dev" },
      ],
    };
    expect(
      isBranchHoldCurrent(moveHold, {
        environmentId,
        cwd: "/repo-feature",
        canonicalBranch: "feature",
      }),
    ).toBe(true);
    expect(
      isBranchHoldCurrent(moveHold, { environmentId, cwd: "/repo", canonicalBranch: "dev" }),
    ).toBe(true);
    expect(
      isBranchHoldCurrent(moveHold, { environmentId, cwd: "/repo", canonicalBranch: "main" }),
    ).toBe(false);
  });

  it("does not apply to the same path on another environment", () => {
    expect(
      isBranchHoldCurrent(hold, { ...current, environmentId: EnvironmentId.make("env-b") }),
    ).toBe(false);
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
