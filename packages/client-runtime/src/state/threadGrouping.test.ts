import { EnvironmentId, ProjectId, RunId, ThreadId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  collapseThreadGroups,
  groupInboxThreadsByProject,
  resolveThreadActivityAt,
  toggleCollapsedThreadGroup,
} from "./threadGrouping.ts";

const environmentId = EnvironmentId.make("environment-1");
const projectId = ProjectId.make("project-1");
const at = (day: number) => `2026-03-${String(day).padStart(2, "0")}T12:00:00.000Z`;
const now = at(10);
const projects = [{ key: "one", label: "One", memberProjectRefs: [{ environmentId, projectId }] }];
function thread(id: string, activityAt = now) {
  return {
    id: ThreadId.make(id),
    environmentId,
    projectId,
    createdAt: activityAt,
    reopenedAt: null,
    latestUserAuthoredMessageAt: null,
    latestUserMessageAt: null,
    latestRun: null,
  };
}

describe("thread grouping", () => {
  it("groups scoped project identities in the supplied order without losing unavailable projects", () => {
    const remote = EnvironmentId.make("environment-2");
    const projects = [
      {
        key: "second",
        label: "Second",
        memberProjectRefs: [{ environmentId, projectId: ProjectId.make("project-2") }],
      },
      {
        key: "shared",
        label: "Shared",
        memberProjectRefs: [
          { environmentId, projectId },
          { environmentId: remote, projectId: ProjectId.make("remote") },
        ],
      },
    ];
    const threads = [
      thread("local"),
      { ...thread("remote"), environmentId: remote, projectId: ProjectId.make("remote") },
      { ...thread("second"), projectId: ProjectId.make("project-2") },
      { ...thread("missing"), environmentId: remote },
    ];
    const groups = groupInboxThreadsByProject({ projects, threads });
    expect(
      groups.map((group) => [group.label, group.projectKey, group.threads.map((row) => row.id)]),
    ).toEqual([
      ["Second", "second", ["second"]],
      ["Shared", "shared", ["local", "remote"]],
      ["Other projects", null, ["missing"]],
    ]);
  });

  it("orders by durable activity and ignores streaming metadata", () => {
    const older = { ...thread("older", at(3)), updatedAt: now };
    const newer = thread("newer", at(9));
    expect(
      groupInboxThreadsByProject({ projects, threads: [older, newer] })[0]?.threads.map(
        (row) => row.id,
      ),
    ).toEqual(["newer", "older"]);
    expect(resolveThreadActivityAt({ ...older, reopenedAt: now })).toBe(Date.parse(now));
    expect(resolveThreadActivityAt({ ...older, latestUserMessageAt: now })).toBe(
      Date.parse(older.createdAt),
    );
    const { latestUserAuthoredMessageAt: _authoredAt, ...legacy } = older;
    expect(resolveThreadActivityAt({ ...legacy, latestUserMessageAt: now })).toBe(Date.parse(now));
    expect(
      resolveThreadActivityAt({
        ...older,
        latestUserAuthoredMessageAt: at(9),
        latestUserMessageAt: now,
      }),
    ).toBe(Date.parse(at(9)));
    expect(
      resolveThreadActivityAt({
        ...older,
        latestRun: {
          runId: RunId.make("run"),
          status: "completed",
          requestedAt: at(9),
          startedAt: now,
          completedAt: null,
          assistantMessageId: null,
        },
      }),
    ).toBe(Date.parse(at(9)));
    expect(
      resolveThreadActivityAt({
        ...older,
        latestRun: {
          runId: RunId.make("run"),
          status: "completed",
          requestedAt: at(9),
          startedAt: at(9),
          completedAt: now,
          assistantMessageId: null,
        },
      }),
    ).toBe(Date.parse(now));
  });

  it("omits empty groups and deterministically orders ties", () => {
    expect(groupInboxThreadsByProject({ projects, threads: [] })).toEqual([]);
    const groups = groupInboxThreadsByProject({ projects, threads: [thread("z"), thread("a")] });
    expect(groups[0]?.threads.map((row) => row.id)).toEqual(["a", "z"]);
  });

  it("collapses groups to the threads that must stay visible and keeps their full count", () => {
    const groups = groupInboxThreadsByProject({
      projects,
      threads: [
        thread("open"),
        thread("other"),
        { ...thread("elsewhere"), projectId: ProjectId.make("missing") },
      ],
    });
    const collapsed = collapseThreadGroups(
      groups,
      new Set(["project:one", "project:unavailable"]),
      (row) => row.id === "open",
    );
    expect(
      collapsed.map((group) => [
        group.label,
        group.collapsed,
        group.count,
        group.threads.map((row) => row.id),
      ]),
    ).toEqual([
      ["One", true, 2, ["open"]],
      ["Other projects", true, 1, []],
    ]);
  });

  it("toggles a group's collapsed key without touching the others", () => {
    expect(toggleCollapsedThreadGroup(["project:b"], "project:a")).toEqual([
      "project:b",
      "project:a",
    ]);
    expect(toggleCollapsedThreadGroup(["project:b", "project:a"], "project:b")).toEqual([
      "project:a",
    ]);
  });
});
