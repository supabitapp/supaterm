// @effect-diagnostics globalDate:off -- Native local dates independently verify calendar and DST boundaries.
import { EnvironmentId, ProjectId, RunId, ThreadId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  collapseThreadGroups,
  groupInboxThreads,
  resolveThreadActivityAt,
  toggleCollapsedThreadGroup,
} from "./threadGrouping.ts";

const environmentId = EnvironmentId.make("environment-1");
const projectId = ProjectId.make("project-1");
const local = (day: number, hour = 0) => new Date(2026, 2, day, hour).toISOString();
const now = local(10, 12);
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
  it("uses local calendar boundaries and moves groups at midnight", () => {
    const groups = groupInboxThreads({
      mode: "updated",
      now,
      threads: [
        thread("today", local(10)),
        thread("yesterday", local(9)),
        thread("week", local(4)),
        thread("older", local(3, 23)),
      ],
    });
    expect(groups.map((group) => [group.label, group.threads.map((row) => row.id)])).toEqual([
      ["Today", ["today"]],
      ["Yesterday", ["yesterday"]],
      ["Last 7 days", ["week"]],
      ["Older", ["older"]],
    ]);
    expect(
      groupInboxThreads({
        mode: "updated",
        now: local(11, 0),
        threads: [thread("today", local(10))],
      })[0]?.label,
    ).toBe("Yesterday");
  });

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
    const groups = groupInboxThreads({ mode: "project", projects, threads });
    expect(groups.map((group) => [group.label, group.threads.map((row) => row.id)])).toEqual([
      ["Second", ["second"]],
      ["Shared", ["local", "remote"]],
      ["Other projects", ["missing"]],
    ]);
  });

  it("orders by durable activity and ignores streaming metadata", () => {
    const older = { ...thread("older", local(3)), updatedAt: now };
    const newer = thread("newer", local(9));
    const input = { mode: "updated" as const, now, threads: [older, newer] };
    expect(groupInboxThreads(input).map((group) => group.threads.map((row) => row.id))).toEqual([
      ["newer"],
      ["older"],
    ]);
    expect(resolveThreadActivityAt({ ...older, reopenedAt: now })).toBe(Date.parse(now));
    expect(resolveThreadActivityAt({ ...older, latestUserMessageAt: now })).toBe(
      Date.parse(older.createdAt),
    );
    const { latestUserAuthoredMessageAt: _authoredAt, ...legacy } = older;
    expect(resolveThreadActivityAt({ ...legacy, latestUserMessageAt: now })).toBe(Date.parse(now));
    expect(
      resolveThreadActivityAt({
        ...older,
        latestUserAuthoredMessageAt: local(9),
        latestUserMessageAt: now,
      }),
    ).toBe(Date.parse(local(9)));
    expect(
      resolveThreadActivityAt({
        ...older,
        latestRun: {
          runId: RunId.make("run"),
          status: "completed",
          requestedAt: local(9),
          startedAt: now,
          completedAt: null,
          assistantMessageId: null,
        },
      }),
    ).toBe(Date.parse(local(9)));
    expect(
      resolveThreadActivityAt({
        ...older,
        latestRun: {
          runId: RunId.make("run"),
          status: "completed",
          requestedAt: local(9),
          startedAt: local(9),
          completedAt: now,
          assistantMessageId: null,
        },
      }),
    ).toBe(Date.parse(now));
  });

  it("omits empty groups and deterministically orders ties", () => {
    expect(groupInboxThreads({ mode: "updated", now, threads: [] })).toEqual([]);
    const groups = groupInboxThreads({
      mode: "updated",
      now,
      threads: [thread("z"), thread("a")],
    });
    expect(groups[0]?.threads.map((row) => row.id)).toEqual(["a", "z"]);
  });

  it("collapses groups to the threads that must stay visible and keeps their full count", () => {
    const groups = groupInboxThreads({
      mode: "updated",
      now,
      threads: [thread("open", local(10)), thread("other", local(10)), thread("old", local(3))],
    });
    const collapsed = collapseThreadGroups(
      groups,
      new Set(["updated:today", "updated:older"]),
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
      ["Today", true, 2, ["open"]],
      ["Older", true, 1, []],
    ]);
  });

  it("toggles a group's collapsed key without touching the others", () => {
    expect(toggleCollapsedThreadGroup(["updated:today"], "project:a")).toEqual([
      "updated:today",
      "project:a",
    ]);
    expect(toggleCollapsedThreadGroup(["updated:today", "project:a"], "updated:today")).toEqual([
      "project:a",
    ]);
  });
});
