import {
  EnvironmentId,
  ProjectId,
  DEFAULT_SERVER_SETTINGS,
  type ServerConfig,
  ProviderInstanceId,
  ScheduledTaskId,
  type ScheduledTask,
} from "@supaterm/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type {
  SidebarProjectGroupMember,
  SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";

import { deriveProviderInstanceEntries } from "../../providerInstances";
import { resolveSettingsScope, type SettingsScopeSearch } from "../settings/settingsScope";
import {
  defaultAutomationProjectId,
  lastRunLabel,
  matchesAutomationScope,
  nextRunLabel,
  relativeLabel,
  scheduleFromDraft,
  scheduleLabel,
  scheduledTaskDefaultModel,
  taskToDraft,
  validateAutomationsSearch,
} from "./automations.logic";

const laptopId = EnvironmentId.make("laptop");
const serverId = EnvironmentId.make("server");
const environments = [
  { environmentId: laptopId, label: "Laptop" },
  { environmentId: serverId, label: "Server" },
];

function member(id: string, environmentId: EnvironmentId): SidebarProjectGroupMember {
  return {
    id: ProjectId.make(id),
    environmentId,
    title: "supaterm",
    workspaceRoot: `/repos/${id}`,
    physicalProjectKey: `${environmentId}:/repos/${id}`,
    environmentLabel:
      environments.find((environment) => environment.environmentId === environmentId)?.label ??
      null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
  };
}

const first = member("first", laptopId);
const second = member("second", laptopId);
const third = member("third", serverId);
const other = member("other", serverId);

function group(
  projectKey: string,
  members: readonly SidebarProjectGroupMember[],
): SidebarProjectSnapshot {
  return {
    ...members[0]!,
    projectKey,
    displayName: projectKey,
    memberProjects: members,
    memberProjectRefs: members.map((project) => ({
      environmentId: project.environmentId,
      projectId: project.id,
    })),
    groupedProjectCount: members.length,
    environmentPresence: "mixed",
    allRemoteMembersAreDesktopLocal: false,
    allRemoteMembersAreWsl: false,
    remoteEnvironmentLabels: [],
    pinned: false,
    archived: false,
  };
}

const sameIdElsewhere = member("first", serverId);
const groups = [
  group("supaterm", [first, second, third]),
  group("other", [other, sameIdElsewhere]),
];
const tasks = [first, second, third, other, sameIdElsewhere].map((project, index) => ({
  id: `task-${index}`,
  environmentId: project.environmentId,
  projectId: project.id,
}));

function matchingTaskIds(search: SettingsScopeSearch) {
  const scope = resolveSettingsScope(search, groups, environments);
  return tasks.flatMap((task) =>
    matchesAutomationScope(scope, task.environmentId, task.projectId) ? [task.id] : [],
  );
}

describe("automations scope", () => {
  it("matches every checkout of a grouped project across environments", () => {
    expect(matchingTaskIds({ project: "supaterm" })).toEqual(["task-0", "task-1", "task-2"]);
  });

  it("does not match an unrelated environment's project that shares an ID", () => {
    const scope = resolveSettingsScope({ project: "supaterm" }, groups, environments);
    expect(matchesAutomationScope(scope, laptopId, first.id)).toBe(true);
    expect(matchesAutomationScope(scope, serverId, sameIdElsewhere.id)).toBe(false);
  });

  it("narrows to one environment, alone or within a project", () => {
    expect(matchingTaskIds({ machine: serverId })).toEqual(["task-2", "task-3", "task-4"]);
    expect(matchingTaskIds({ project: "supaterm", machine: serverId })).toEqual(["task-2"]);
  });

  it("matches a stale duplicate record at a checkout's path, on that environment only", () => {
    const stale = member("stale-first", laptopId);
    const withStale = {
      ...groups[0]!,
      memberProjectRefs: [
        ...groups[0]!.memberProjectRefs,
        { environmentId: laptopId, projectId: stale.id },
      ],
    };
    const scope = resolveSettingsScope({ project: "supaterm" }, [withStale], environments);
    expect(matchesAutomationScope(scope, laptopId, stale.id)).toBe(true);
    const serverScope = resolveSettingsScope(
      { project: "supaterm", machine: serverId },
      [withStale],
      environments,
    );
    expect(matchesAutomationScope(serverScope, laptopId, stale.id)).toBe(false);
  });

  it("defaults a new automation to a pinned open project, and to an archived one only when scoped to it", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const project = (id: string, pinnedAt: string | null, archivedAt: string | null) => ({
      id: ProjectId.make(id),
      pinnedAt,
      archivedAt,
    });
    const all = resolveSettingsScope({}, groups, environments);
    const scoped = resolveSettingsScope({ project: "supaterm" }, groups, environments);
    expect(
      defaultAutomationProjectId([project("a", null, null), project("b", at, null)], all),
    ).toBe("b");
    expect(defaultAutomationProjectId([project("x", null, at)], all)).toBe("");
    expect(defaultAutomationProjectId([project("x", null, at)], scoped)).toBe("x");
  });

  it("keeps tasks of removed projects when no project is selected", () => {
    const scope = resolveSettingsScope({}, groups, environments);
    expect(matchesAutomationScope(scope, laptopId, ProjectId.make("removed"))).toBe(true);
  });

  it("matches nothing when the selection is gone", () => {
    expect(matchingTaskIds({ project: "removed" })).toEqual([]);
    expect(matchingTaskIds({ machine: "removed" })).toEqual([]);
  });
});

const legacyTask: ScheduledTask = {
  id: ScheduledTaskId.make("legacy-task"),
  title: "Review issues",
  prompt: "Review open issues",
  enabled: true,
  schedule: { type: "interval", everyMs: 60_000 },
  projectId: ProjectId.make("project"),
  threadId: null,
  workspaceStrategy: { type: "worktree", baseRef: "release" },
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  createdBy: "user",
  creationSource: "web",
  createdAt: "2026-09-17T00:00:00.000Z",
  updatedAt: "2026-09-17T00:00:00.000Z",
  nextRunAt: null,
  lastRunAt: null,
  lastRunStatus: "never",
  lastRunError: null,
  runCount: 0,
};

describe("editing scheduled task branch settings", () => {
  it("keeps an omitted origin flag on the local base branch", () => {
    const draft = taskToDraft(legacyTask);
    expect(draft.baseRef).toBe("release");
    expect(draft.startFromOrigin).toBe(false);
  });

  it.each([true, false])("preserves an explicit origin flag of %s", (startFromOrigin) => {
    const draft = taskToDraft({
      ...legacyTask,
      workspaceStrategy: { type: "worktree", baseRef: "release", startFromOrigin },
    });
    expect(draft.startFromOrigin).toBe(startFromOrigin);
  });
});

describe("one-time scheduled tasks", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips the run time through the local date-time input", () => {
    const runAt = "2026-11-03T17:00:42.000Z";
    const draft = taskToDraft({ ...legacyTask, schedule: { type: "once", runAt } });
    expect(draft.scheduleMode).toBe("once");
    expect(scheduleFromDraft(draft)).toEqual({ type: "once", runAt });
    const moved = scheduleFromDraft({ ...draft, runAt: "2026-11-04T09:30" });
    expect(moved).toEqual({ type: "once", runAt: new Date("2026-11-04T09:30").toISOString() });
    expect(scheduleFromDraft({ ...draft, runAt: "" })).toBeNull();
  });

  it("rejects a time skipped by daylight saving", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    const draft = taskToDraft({
      ...legacyTask,
      schedule: { type: "once", runAt: "2027-03-14T18:00:00.000Z" },
    });
    expect(scheduleFromDraft({ ...draft, runAt: "2027-03-14T02:30" })).toBeNull();
  });

  it("keeps the saved offset when an edit stays in an hour that repeats", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    // 01:30 PST, the second 01:30 on 2026-11-01.
    const draft = taskToDraft({
      ...legacyTask,
      schedule: { type: "once", runAt: "2026-11-01T09:30:00.000Z" },
    });
    expect(scheduleFromDraft({ ...draft, runAt: "2026-11-01T01:35" })).toEqual({
      type: "once",
      runAt: "2026-11-01T09:35:00.000Z",
    });
  });
});

describe("scheduled task model defaults", () => {
  const instanceId = ProviderInstanceId.make("codex");
  const projectId = ProjectId.make("project");
  const environmentSelection = {
    instanceId,
    model: "environment-model",
    options: [{ id: "reasoning", value: "high" }],
  };
  const projectSelection = { instanceId, model: "project-model" };
  const config = {
    settings: { ...DEFAULT_SERVER_SETTINGS, defaultModelSelection: environmentSelection },
    providers: [
      {
        instanceId,
        driver: "codex",
        displayName: "Codex",
        enabled: true,
        installed: true,
        status: "ready",
        auth: { status: "authenticated" },
        models: [
          { slug: "first-model", name: "First", isCustom: false, capabilities: null },
          {
            slug: "catalog-default",
            name: "Default",
            isDefault: true,
            isCustom: false,
            capabilities: null,
          },
          { slug: "environment-model", name: "Environment", isCustom: false, capabilities: null },
          { slug: "project-model", name: "Project", isCustom: false, capabilities: null },
        ],
      },
    ],
  } as unknown as ServerConfig;
  const resolve = (
    value: ServerConfig,
    project: { id: typeof projectId; defaultModelSelection?: typeof projectSelection } | null,
  ) =>
    scheduledTaskDefaultModel(
      value.settings,
      project,
      deriveProviderInstanceEntries(value.providers),
    );
  it("uses the environment default with its provider options", () => {
    expect(resolve(config, { id: projectId })).toEqual(environmentSelection);
  });
  it("prefers the project's configured model", () => {
    expect(resolve(config, { id: projectId, defaultModelSelection: projectSelection })).toEqual(
      projectSelection,
    );
    expect(
      resolve(
        {
          ...config,
          settings: {
            ...config.settings,
            projectSettingsOverrides: {
              [projectId]: { defaultModelSelection: projectSelection },
            },
          },
        },
        { id: projectId },
      ),
    ).toEqual(projectSelection);
  });
  it("uses the advertised default instead of catalog order when no default is configured", () => {
    expect(
      resolve({ ...config, settings: { ...config.settings, defaultModelSelection: null } }, null),
    ).toEqual({ instanceId, model: "catalog-default" });
  });
  it("falls back to the environment default when the project provider is unavailable", () => {
    expect(
      resolve(config, {
        id: projectId,
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("unavailable"),
          model: "missing",
        },
      }),
    ).toEqual(environmentSelection);
  });
  it("does not choose an implicit model on a disabled provider", () => {
    expect(
      resolve(
        {
          ...config,
          providers: config.providers.map((provider) => ({ ...provider, enabled: false })),
        },
        null,
      ),
    ).toBeNull();
  });
});

describe("automation labels", () => {
  const now = Date.parse("2026-10-04T12:00:00.000Z");
  const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();

  it("marks fixed times as environment time and leaves intervals unqualified", () => {
    expect(
      scheduleLabel({ type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] }),
    ).toBe("Weekdays at 09:00 (environment time)");
    expect(scheduleLabel({ type: "fixed_time", timeOfDay: "18:30" })).toBe(
      "Daily at 18:30 (environment time)",
    );
    expect(scheduleLabel({ type: "interval", everyMs: 15 * 60_000 })).toBe("Every 15 min");
    expect(scheduleLabel({ type: "interval", everyMs: 90 * 60_000 })).toBe("Every 90 min");
    expect(scheduleLabel({ type: "interval", everyMs: 60 * 60_000 })).toBe("Every hour");
    expect(scheduleLabel({ type: "interval", everyMs: 6 * 60 * 60_000 })).toBe("Every 6 hours");
    expect(scheduleLabel({ type: "interval", everyMs: 24 * 60 * 60_000 })).toBe("Every day");
    expect(scheduleLabel({ type: "interval", everyMs: 7 * 24 * 60 * 60_000 })).toBe("Every 7 days");
  });

  it.each([
    [at(30_000), "in under a minute"],
    [at(5 * 60_000), "in 5m"],
    [at(3 * 3_600_000), "in 3h"],
    [at(-30_000), "just now"],
    [at(-5 * 60_000), "5m ago"],
    [at(-2 * 86_400_000), "2d ago"],
  ])("labels %s relative to now as %s", (value, expected) => {
    expect(relativeLabel(value, now)).toBe(expected);
  });

  it("says when the next run is, or why there is none", () => {
    expect(nextRunLabel({ enabled: true, nextRunAt: at(5 * 60_000) }, now)).toBe("Next run in 5m");
    expect(nextRunLabel({ enabled: true, nextRunAt: null }, now)).toBe("Not scheduled");
    expect(nextRunLabel({ enabled: false, nextRunAt: null }, now)).toBe("Paused");
  });

  it("describes delivery, not agent completion", () => {
    expect(lastRunLabel({ lastRunStatus: "never", lastRunAt: null }, now)).toBeNull();
    expect(lastRunLabel({ lastRunStatus: "running", lastRunAt: at(0) }, now)).toBe("Sending…");
    expect(lastRunLabel({ lastRunStatus: "succeeded", lastRunAt: at(-5 * 60_000) }, now)).toBe(
      "Sent 5m ago",
    );
    expect(lastRunLabel({ lastRunStatus: "failed", lastRunAt: at(-60_000) }, now)).toBe(
      "Couldn't send",
    );
    // A run that lands between clock ticks has a timestamp after `now`.
    expect(lastRunLabel({ lastRunStatus: "succeeded", lastRunAt: at(20_000) }, now)).toBe(
      "Sent just now",
    );
  });
});

describe("automations search", () => {
  it("keeps the scope separate from the one-shot task link", () => {
    expect(
      validateAutomationsSearch({
        project: "supaterm",
        machine: "server",
        checkout: "ignored",
        environmentId: "laptop",
        taskId: "task-1",
      }),
    ).toEqual({
      project: "supaterm",
      machine: "server",
      environmentId: laptopId,
      taskId: "task-1",
    });
    expect(validateAutomationsSearch({ project: " ", machine: "", taskId: 4 })).toEqual({});
  });
});
