import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@supaterm/contracts";

import type { ComposerDraft, ComposerDraftWorkspaceSelection } from "./use-composer-drafts";
import {
  applyHeldNewTaskDraft,
  buildPendingDraftTasks,
  buildPendingQueuedTasks,
  type PendingDraftProjectDefaults,
  pendingDraftBranchNeedsRefs,
  resolvePendingDraftBranch,
} from "./pending-new-tasks-model";
import type { QueuedThreadMessage } from "./thread-outbox-model";

const environmentId = EnvironmentId.make("env-1");
const projectId = ProjectId.make("project-1");

function draft(
  text: string,
  createdAt: string,
  overrides: Partial<ComposerDraft> = {},
): ComposerDraft {
  return {
    text,
    attachments: [],
    project: { environmentId, projectId, createdAt },
    ...overrides,
  };
}

describe("buildPendingDraftTasks", () => {
  it("surfaces every new-task draft with content, newest first", () => {
    const tasks = buildPendingDraftTasks({
      "new-task:draft-old": draft("first idea", "2026-09-05T09:00:00.000Z", {
        workspaceSelection: { mode: "worktree", branch: "main", worktreePath: null },
      }),
      "new-task:draft-new": draft("second idea", "2026-09-05T11:00:00.000Z"),
    });

    expect(
      tasks.map((task) => [task.title, task.draft.workspaceSelection?.branch ?? null]),
    ).toEqual([
      ["second idea", null],
      ["first idea", "main"],
    ]);
    expect(tasks[1]).toMatchObject({
      key: "draft-task:new-task:draft-old",
      environmentId,
      projectId,
      draftKey: "new-task:draft-old",
      createdAt: "2026-09-05T09:00:00.000Z",
    });
  });
});

describe("applyHeldNewTaskDraft", () => {
  const otherProjectId = ProjectId.make("project-2");
  const tasks = (drafts: Record<string, ComposerDraft>) =>
    buildPendingDraftTasks({
      "new-task:other": draft("other idea", "2026-09-05T08:00:00.000Z"),
      ...drafts,
    });
  const titles = (drafts: Record<string, ComposerDraft>) => tasks(drafts).map((task) => task.title);
  const held = { draftKey: "new-task:open", content: { text: "first words", attachments: [] } };

  it("keeps the held text while the user types", () => {
    const drafts = { "new-task:open": draft("first words and more", "2026-09-05T09:00:00.000Z") };

    expect(titles(applyHeldNewTaskDraft(drafts, held))).toEqual(["first words", "other idea"]);
  });

  it("keeps the row while the user clears the text", () => {
    const drafts = { "new-task:open": draft("", "2026-09-05T09:00:00.000Z") };

    expect(titles(applyHeldNewTaskDraft(drafts, held))).toEqual(["first words", "other idea"]);
  });

  it("files the row under the draft's current project", () => {
    const drafts = {
      "new-task:open": draft("first words and more", "2026-09-05T09:00:00.000Z", {
        project: {
          environmentId,
          projectId: otherProjectId,
          createdAt: "2026-09-05T09:00:00.000Z",
        },
      }),
    };

    expect(
      tasks(applyHeldNewTaskDraft(drafts, held)).map((task) => [task.title, task.projectId]),
    ).toEqual([
      ["first words", otherProjectId],
      ["other idea", projectId],
    ]);
  });

  it("hides a draft that had no row when it opened", () => {
    const drafts = { "new-task:open": draft("fresh idea", "2026-09-05T09:00:00.000Z") };

    expect(
      titles(applyHeldNewTaskDraft(drafts, { draftKey: "new-task:open", content: null })),
    ).toEqual(["other idea"]);
  });

  it("drops the row once the draft is sent or discarded", () => {
    const drafts = { "new-task:open": { text: "", attachments: [] } };

    expect(titles(applyHeldNewTaskDraft(drafts, held))).toEqual(["other idea"]);
  });

  it("leaves the drafts alone when nothing is held", () => {
    const drafts = { "new-task:open": draft("idea", "2026-09-05T09:00:00.000Z") };

    expect(applyHeldNewTaskDraft(drafts, null)).toBe(drafts);
  });
});

const projectCwd = "/repo";
const localDefault: PendingDraftProjectDefaults = {
  canChooseWorkspace: true,
  defaultMode: "local",
  defaultModeSettled: true,
};
const worktreeDefault: PendingDraftProjectDefaults = { ...localDefault, defaultMode: "worktree" };
const resolve = (
  input: Omit<Parameters<typeof resolvePendingDraftBranch>[0], "defaults" | "isGitRepo"> & {
    readonly defaults?: PendingDraftProjectDefaults;
  },
) => resolvePendingDraftBranch({ defaults: localDefault, isGitRepo: true, ...input });
const branches = [
  { name: "feature", current: true, isDefault: false },
  { name: "origin/main", current: false, isDefault: true, isRemote: true },
];

function draftWith(workspaceSelection?: ComposerDraftWorkspaceSelection): ComposerDraft {
  return {
    text: "unsent",
    attachments: [],
    project: {
      environmentId: EnvironmentId.make("env-1"),
      projectId: ProjectId.make("project-1"),
      createdAt: "2026-10-26T00:00:00.000Z",
    },
    ...(workspaceSelection ? { workspaceSelection } : {}),
  };
}

describe("resolvePendingDraftBranch", () => {
  it("shows the project's default for a draft that never picked a mode", () => {
    const untouched = draftWith();
    expect(pendingDraftBranchNeedsRefs(untouched, worktreeDefault)).toBe(true);
    expect(resolve({ draft: untouched, defaults: worktreeDefault, branches, projectCwd })).toBe(
      "origin/main",
    );
    // Until supaterm.json settles, the environment default may still be replaced.
    expect(
      resolve({
        draft: untouched,
        defaults: { ...worktreeDefault, defaultModeSettled: false },
        branches,
        projectCwd,
      }),
    ).toBeNull();
    // A local default starts on the checkout without naming a branch, as on main.
    expect(pendingDraftBranchNeedsRefs(untouched, localDefault)).toBe(false);
    expect(resolve({ draft: untouched, branches, projectCwd })).toBeNull();
  });

  it("shows the default base for a worktree draft that never picked one", () => {
    const worktree = draftWith({ mode: "worktree", branch: null, worktreePath: null });
    expect(pendingDraftBranchNeedsRefs(worktree, localDefault)).toBe(true);
    expect(resolve({ draft: worktree, branches, projectCwd })).toBe("origin/main");
  });

  it("shows the current branch for a local draft that follows the checkout", () => {
    const local = draftWith({
      mode: "local",
      branch: null,
      worktreePath: null,
      followsCurrentCheckout: true,
    });
    expect(resolve({ draft: local, branches, projectCwd })).toBe("feature");
    expect(resolve({ draft: local, branches: [], projectCwd })).toBeNull();
  });

  it("keeps a chosen branch without loading refs", () => {
    const chosen = draftWith({ mode: "local", branch: "release", worktreePath: null });
    expect(pendingDraftBranchNeedsRefs(chosen, localDefault)).toBe(false);
    expect(resolve({ draft: chosen, branches, projectCwd })).toBe("release");
  });
});

function queuedCreation(environmentId: string): QueuedThreadMessage {
  return {
    environmentId: EnvironmentId.make(environmentId),
    threadId: ThreadId.make(`thread-${environmentId}`),
    messageId: MessageId.make(`message-${environmentId}`),
    commandId: CommandId.make(`command-${environmentId}`),
    text: "Test",
    attachments: [],
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
    creation: {
      projectId: ProjectId.make("project-1"),
      workspaceMode: "local",
      branch: null,
      worktreePath: null,
    },
    createdAt: "2026-11-10T01:10:00.000Z",
  };
}

describe("buildPendingQueuedTasks", () => {
  it("lists only creations the outbox is not sending yet", () => {
    const sending = EnvironmentId.make("sending");
    const syncing = EnvironmentId.make("syncing");
    const readOnly = EnvironmentId.make("read-only");
    const retrying = EnvironmentId.make("retrying");
    const { modelSelection: _model, ...modelless } = queuedCreation("sending");
    const tasks = buildPendingQueuedTasks(
      [
        ...["sending", "syncing", "read-only", "retrying", "offline"].map(queuedCreation),
        { ...modelless, messageId: MessageId.make("message-modelless") },
      ],
      {
        connectedEnvironmentIds: new Set([sending, syncing, readOnly, retrying]),
        operableEnvironmentIds: new Set([sending, syncing, retrying]),
        shellStatuses: new Map([
          [sending, "live"],
          [syncing, "synchronizing"],
          [readOnly, "live"],
          [retrying, "live"],
        ]),
        retryingMessageIds: { [MessageId.make("message-retrying")]: true },
      },
    );

    expect(tasks).toHaveLength(5);
    expect(new Set(tasks.map((task) => task.environmentId))).toEqual(
      new Set(["syncing", "read-only", "retrying", "offline", "sending"]),
    );
  });
});
