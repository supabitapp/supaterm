import { EnvironmentId, type VcsRef } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  dedupeRemoteBranchesWithLocalMatches,
  deriveLocalBranchNameFromRemoteRef,
  resolveEnvironmentOptionLabel,
  resolveBranchSelectionTarget,
  resolveCurrentWorkspaceLabel,
  resolveDraftEnvModeAfterBranchChange,
  resolveEffectiveEnvMode,
  resolveEnvModeLabel,
  resolveBranchTriggerLabel,
  resolveBranchToolbarPrBranch,
  resolveBranchToolbarValue,
  resolveWorktreeBaseBranch,
  resolveLockedWorkspaceLabel,
  resolveLocalCheckoutBranchMismatch,
  resolvePreviousWorktreeLabel,
  resolvePreviousWorktreeSeed,
  sanitizeNewRefName,
  shouldIncludeBranchPickerItem,
  shouldShowComposerContextStrip,
  shouldShowEnvironmentIndicator,
} from "./BranchToolbar.logic";

const localEnvironmentId = EnvironmentId.make("environment-local");
const remoteEnvironmentId = EnvironmentId.make("environment-remote");

describe("resolvePreviousWorktreeSeed", () => {
  it("picks the most recently updated worktree thread", () => {
    expect(
      resolvePreviousWorktreeSeed({
        threads: [
          {
            branch: "supaterm/older",
            worktreePath: "/repo/.supaterm/worktrees/older",
            updatedAt: "2026-07-20T00:00:00.000Z",
          },
          {
            branch: "supaterm/newer",
            worktreePath: "/repo/.supaterm/worktrees/newer",
            updatedAt: "2026-07-22T00:00:00.000Z",
          },
          { branch: "main", worktreePath: null, updatedAt: "2026-07-23T00:00:00.000Z" },
        ],
        currentWorktreePath: null,
      }),
    ).toEqual({ branch: "supaterm/newer", worktreePath: "/repo/.supaterm/worktrees/newer" });
  });

  it("skips the worktree the composer already points at", () => {
    expect(
      resolvePreviousWorktreeSeed({
        threads: [
          {
            branch: "supaterm/current",
            worktreePath: "/repo/.supaterm/worktrees/current",
            updatedAt: "2026-07-22T00:00:00.000Z",
          },
        ],
        currentWorktreePath: "/repo/.supaterm/worktrees/current",
      }),
    ).toBeNull();
  });

  it("returns null when no thread has a worktree", () => {
    expect(
      resolvePreviousWorktreeSeed({
        threads: [{ branch: "main", worktreePath: null, updatedAt: "2026-07-22T00:00:00.000Z" }],
        currentWorktreePath: null,
      }),
    ).toBeNull();
  });

  it("ignores archived threads and threads with unparseable timestamps", () => {
    expect(
      resolvePreviousWorktreeSeed({
        threads: [
          {
            branch: "supaterm/archived",
            worktreePath: "/repo/.supaterm/worktrees/archived",
            updatedAt: "2026-07-23T00:00:00.000Z",
            archivedAt: "2026-07-23T01:00:00.000Z",
          },
          {
            branch: "supaterm/garbage-timestamp",
            worktreePath: "/repo/.supaterm/worktrees/garbage",
            updatedAt: "not-a-date",
          },
          {
            branch: "supaterm/live",
            worktreePath: "/repo/.supaterm/worktrees/live",
            updatedAt: "2026-07-21T00:00:00.000Z",
            archivedAt: null,
          },
        ],
        currentWorktreePath: null,
      }),
    ).toEqual({ branch: "supaterm/live", worktreePath: "/repo/.supaterm/worktrees/live" });
  });
});

describe("resolvePreviousWorktreeLabel", () => {
  it("includes the branch when known", () => {
    expect(
      resolvePreviousWorktreeLabel({ branch: "supaterm/fix-thing", worktreePath: "/wt" }),
    ).toBe("Previous worktree (supaterm/fix-thing)");
    expect(resolvePreviousWorktreeLabel({ branch: null, worktreePath: "/wt" })).toBe(
      "Previous worktree",
    );
  });
});

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

  it("keeps new-worktree mode when selecting a base ref before worktree creation", () => {
    expect(
      resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: null,
        currentWorktreePath: null,
        effectiveEnvMode: "worktree",
      }),
    ).toBe("worktree");
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

  it("keeps an explicitly selected worktree base ref", () => {
    expect(
      resolveBranchToolbarValue({
        envMode: "worktree",
        activeWorktreePath: null,
        activeThreadBranch: "feature/base",
        currentGitBranch: "main",
      }),
    ).toBe("feature/base");
  });

  it("shows the actual checked-out ref when not selecting a new worktree base", () => {
    expect(
      resolveBranchToolbarValue({
        envMode: "local",
        activeWorktreePath: null,
        activeThreadBranch: "feature/base",
        currentGitBranch: "main",
      }),
    ).toBe("main");
  });
});

describe("resolveBranchTriggerLabel", () => {
  it("marks the remote base when a new worktree will start from remote", () => {
    expect(
      resolveBranchTriggerLabel({
        activeWorktreePath: null,
        effectiveEnvMode: "worktree",
        resolvedActiveBranch: "main",
        resolvedActiveBranchIsRemote: false,
        startFromOrigin: true,
      }),
    ).toBe("From main (remote)");
  });

  it("marks the remote base for local branch names that contain slashes", () => {
    expect(
      resolveBranchTriggerLabel({
        activeWorktreePath: null,
        effectiveEnvMode: "worktree",
        resolvedActiveBranch: "feature/demo",
        resolvedActiveBranchIsRemote: false,
        startFromOrigin: true,
      }),
    ).toBe("From feature/demo (remote)");
  });

  it("shows the local ref when start from remote is disabled", () => {
    expect(
      resolveBranchTriggerLabel({
        activeWorktreePath: null,
        effectiveEnvMode: "worktree",
        resolvedActiveBranch: "main",
        resolvedActiveBranchIsRemote: false,
        startFromOrigin: false,
      }),
    ).toBe("From main");
  });

  it("does not add a remote marker for an explicit remote ref", () => {
    expect(
      resolveBranchTriggerLabel({
        activeWorktreePath: null,
        effectiveEnvMode: "worktree",
        resolvedActiveBranch: "origin/feature/demo",
        resolvedActiveBranchIsRemote: true,
        startFromOrigin: true,
      }),
    ).toBe("From origin/feature/demo");
  });

  it("preserves an explicit ref from a non-origin remote", () => {
    expect(
      resolveBranchTriggerLabel({
        activeWorktreePath: null,
        effectiveEnvMode: "worktree",
        resolvedActiveBranch: "upstream/feature/demo",
        resolvedActiveBranchIsRemote: true,
        startFromOrigin: true,
      }),
    ).toBe("From upstream/feature/demo");
  });

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

  it("does not fabricate a remote marker while branch metadata is loading", () => {
    expect(
      resolveBranchTriggerLabel({
        activeWorktreePath: null,
        effectiveEnvMode: "worktree",
        resolvedActiveBranch: "upstream/feature/demo",
        resolvedActiveBranchIsRemote: null,
        startFromOrigin: true,
      }),
    ).toBe("From upstream/feature/demo");
  });
});

describe("resolveBranchToolbarPrBranch", () => {
  it("uses the explicit thread branch when it matches the displayed branch", () => {
    expect(
      resolveBranchToolbarPrBranch({
        activeThreadBranch: "feature/current",
        resolvedActiveBranch: "feature/current",
      }),
    ).toBe("feature/current");
  });

  it("hides PR state while an optimistic branch switch is in flight", () => {
    expect(
      resolveBranchToolbarPrBranch({
        activeThreadBranch: "feature/current",
        resolvedActiveBranch: "feature/next",
      }),
    ).toBeNull();
  });

  it("does not infer PR state without an explicit thread branch", () => {
    expect(
      resolveBranchToolbarPrBranch({
        activeThreadBranch: null,
        resolvedActiveBranch: "feature/current",
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

  it("ignores matching local checkout state", () => {
    expect(
      resolveLocalCheckoutBranchMismatch({
        effectiveEnvMode: "local",
        activeWorktreePath: null,
        activeThreadBranch: "feature/thread",
        currentGitBranch: "feature/thread",
      }),
    ).toBeNull();
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

  it("ignores new-worktree base selection before a worktree exists", () => {
    expect(
      resolveLocalCheckoutBranchMismatch({
        effectiveEnvMode: "worktree",
        activeWorktreePath: null,
        activeThreadBranch: "feature/base",
        currentGitBranch: "main",
      }),
    ).toBeNull();
  });
});

describe("resolveEnvironmentOptionLabel", () => {
  it("prefers the primary environment's machine label", () => {
    expect(
      resolveEnvironmentOptionLabel({
        isPrimary: true,
        environmentId: localEnvironmentId,
        runtimeLabel: "Julius's Mac mini",
        savedLabel: "Local environment",
      }),
    ).toBe("Julius's Mac mini");
  });

  it("falls back to 'This device' for generic primary labels", () => {
    expect(
      resolveEnvironmentOptionLabel({
        isPrimary: true,
        environmentId: localEnvironmentId,
        runtimeLabel: "Local environment",
        savedLabel: "Local",
      }),
    ).toBe("This device");
  });

  it("keeps configured labels for non-primary environments", () => {
    expect(
      resolveEnvironmentOptionLabel({
        isPrimary: false,
        environmentId: remoteEnvironmentId,
        runtimeLabel: null,
        savedLabel: "Build box",
      }),
    ).toBe("Build box");
  });
});

describe("shouldShowEnvironmentIndicator", () => {
  it("shows the indicator whenever multiple environments are pickable", () => {
    expect(
      shouldShowEnvironmentIndicator({
        activeEnvironment: { isPrimary: true },
        canPickEnvironment: true,
      }),
    ).toBe(true);
  });

  it("shows a sole remote environment so the user knows where the project runs", () => {
    expect(
      shouldShowEnvironmentIndicator({
        activeEnvironment: { isPrimary: false },
        canPickEnvironment: false,
      }),
    ).toBe(true);
  });

  it("hides a sole primary (this-device) environment", () => {
    expect(
      shouldShowEnvironmentIndicator({
        activeEnvironment: { isPrimary: true },
        canPickEnvironment: false,
      }),
    ).toBe(false);
  });

  it("hides the indicator when the active environment is unknown", () => {
    expect(
      shouldShowEnvironmentIndicator({
        activeEnvironment: null,
        canPickEnvironment: false,
      }),
    ).toBe(false);
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
  it("treats draft threads already attached to a worktree as current-checkout mode", () => {
    expect(
      resolveEffectiveEnvMode({
        activeWorktreePath: "/repo/.supaterm/worktrees/feature-a",
        hasServerThread: false,
        draftThreadEnvMode: "worktree",
      }),
    ).toBe("local");
  });

  it("keeps explicit new-worktree mode for draft threads without a worktree path", () => {
    expect(
      resolveEffectiveEnvMode({
        activeWorktreePath: null,
        hasServerThread: false,
        draftThreadEnvMode: "worktree",
      }),
    ).toBe("worktree");
  });

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

describe("resolveEnvModeLabel", () => {
  it("uses explicit workspace labels", () => {
    expect(resolveEnvModeLabel("local")).toBe("Current checkout");
    expect(resolveEnvModeLabel("worktree")).toBe("New worktree");
  });
});

describe("resolveCurrentWorkspaceLabel", () => {
  it("describes the main repo checkout when no worktree path is active", () => {
    expect(resolveCurrentWorkspaceLabel(null)).toBe("Current checkout");
  });

  it("describes the active checkout as a worktree when one is attached", () => {
    expect(resolveCurrentWorkspaceLabel("/repo/.supaterm/worktrees/feature-a")).toBe(
      "Current worktree",
    );
  });
});

describe("resolveLockedWorkspaceLabel", () => {
  it("uses a shorter label for the main repo checkout", () => {
    expect(resolveLockedWorkspaceLabel(null, "local")).toBe("Local checkout");
  });

  it("uses a shorter label for an attached worktree", () => {
    expect(resolveLockedWorkspaceLabel("/repo/.supaterm/worktrees/feature-a", "worktree")).toBe(
      "Worktree",
    );
  });

  it("describes a worktree that is still being created as a new worktree", () => {
    expect(resolveLockedWorkspaceLabel(null, "worktree")).toBe("New worktree");
  });
});

describe("deriveLocalBranchNameFromRemoteRef", () => {
  it("strips the remote prefix from a remote ref", () => {
    expect(deriveLocalBranchNameFromRemoteRef("origin/feature/demo")).toBe("feature/demo");
  });

  it("supports remote names that contain slashes", () => {
    expect(deriveLocalBranchNameFromRemoteRef("my-org/upstream/feature/demo")).toBe(
      "upstream/feature/demo",
    );
  });

  it("returns the original name when ref is malformed", () => {
    expect(deriveLocalBranchNameFromRemoteRef("origin/")).toBe("origin/");
    expect(deriveLocalBranchNameFromRemoteRef("/feature/demo")).toBe("/feature/demo");
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

  it("keeps all entries when no local match exists for a remote ref", () => {
    const input: VcsRef[] = [
      {
        name: "feature/local",
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
      "feature/local",
      "origin/feature/remote-only",
    ]);
  });

  it("keeps non-origin remote refs visible even when a matching local ref exists", () => {
    const input: VcsRef[] = [
      {
        name: "feature/demo",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: "my-org/upstream/feature/demo",
        isRemote: true,
        remoteName: "my-org/upstream",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
    ];

    expect(dedupeRemoteBranchesWithLocalMatches(input).map((ref) => ref.name)).toEqual([
      "feature/demo",
      "my-org/upstream/feature/demo",
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

  it("checks out the default ref in the main repo when leaving a secondary worktree", () => {
    expect(
      resolveBranchSelectionTarget({
        activeProjectCwd: "/repo",
        activeWorktreePath: "/repo/.supaterm/worktrees/feature-a",
        refName: {
          isDefault: true,
          worktreePath: null,
        },
      }),
    ).toEqual({
      checkoutCwd: "/repo",
      nextWorktreePath: null,
      reuseExistingWorktree: false,
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

  it("keeps the synthetic create-ref item visible for arbitrary ref input", () => {
    expect(
      shouldIncludeBranchPickerItem({
        itemValue: "__create_new_branch__:feature/demo",
        normalizedQuery: "feature/demo",
        createBranchItemValue: "__create_new_branch__:feature/demo",
        checkoutPullRequestItemValue: null,
      }),
    ).toBe(true);
  });

  it("still filters ordinary ref items by query text", () => {
    expect(
      shouldIncludeBranchPickerItem({
        itemValue: "main",
        normalizedQuery: "gh pr checkout 1359",
        createBranchItemValue: "__create_new_branch__:gh pr checkout 1359",
        checkoutPullRequestItemValue: "__checkout_pull_request__:1359",
      }),
    ).toBe(false);
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

  it("surfaces a ref from a partial query containing a space", () => {
    expect(
      shouldIncludeBranchPickerItem({
        itemValue: "hello-world",
        normalizedQuery: "hello w",
        createBranchItemValue: null,
        checkoutPullRequestItemValue: null,
      }),
    ).toBe(true);
  });

  it("excludes refs matching neither the raw nor the sanitized query", () => {
    expect(
      shouldIncludeBranchPickerItem({
        itemValue: "main",
        normalizedQuery: "new branch",
        createBranchItemValue: null,
        checkoutPullRequestItemValue: null,
      }),
    ).toBe(false);
  });
});

describe("sanitizeNewRefName", () => {
  it("replaces a space with a dash", () => {
    expect(sanitizeNewRefName("new branch")).toBe("new-branch");
  });

  it("collapses a run of whitespace into a single dash", () => {
    expect(sanitizeNewRefName("new   branch")).toBe("new-branch");
  });

  it("trims surrounding whitespace instead of turning it into dashes", () => {
    expect(sanitizeNewRefName("  new branch  ")).toBe("new-branch");
  });

  it("replaces tabs, which git rejects just like spaces", () => {
    expect(sanitizeNewRefName("new\tbranch")).toBe("new-branch");
  });

  it("preserves whitespace that git accepts", () => {
    expect(sanitizeNewRefName("new\u00a0branch")).toBe("new\u00a0branch");
    expect(sanitizeNewRefName("new\u2009branch")).toBe("new\u2009branch");
  });

  it("keeps slashes so nested ref names survive", () => {
    expect(sanitizeNewRefName("feature/new thing")).toBe("feature/new-thing");
  });

  it("preserves case because git ref names are case sensitive", () => {
    expect(sanitizeNewRefName("Feature/New Thing")).toBe("Feature/New-Thing");
  });

  it("leaves an already valid ref name untouched", () => {
    expect(sanitizeNewRefName("feature/login")).toBe("feature/login");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(sanitizeNewRefName("   ")).toBe("");
  });

  it("does not collapse dashes the user typed", () => {
    expect(sanitizeNewRefName("new - branch")).toBe("new---branch");
    expect(sanitizeNewRefName("foo--bar")).toBe("foo--bar");
  });
});
