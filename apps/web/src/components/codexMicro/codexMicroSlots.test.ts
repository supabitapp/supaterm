import {
  DEFAULT_CODEX_MICRO_CUSTOM_AGENT_KEYS,
  EnvironmentId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@supaterm/contracts";
import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture, type ThreadFixtureOverrides } from "../../test-fixtures";
import {
  buildCodexMicroLightingModel,
  buildCodexMicroSlotViews,
  selectCodexMicroSlotBindings,
} from "./codexMicroSlots";

const NOW = "2026-03-10T12:00:00.000Z";
const environmentId = EnvironmentId.make("environment-test");

function thread(id: string, overrides: ThreadFixtureOverrides = {}): EnvironmentThreadShell {
  return makeThreadFixture({ id: ThreadId.make(id), title: id, ...overrides });
}

function completedAt(at: string, lastVisitedAt: string | null = at) {
  return {
    latestRun: {
      runId: RunId.make(`run-${at}`),
      status: "completed" as const,
      assistantMessageId: null,
      requestedAt: at,
      startedAt: at,
      completedAt: at,
    },
    lastVisitedAt,
  };
}

const running = {
  runtime: {
    status: "running" as const,
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: "Codex",
    lastError: null,
    updatedAt: NOW,
  },
};

function boundIds(bindings: ReturnType<typeof selectCodexMicroSlotBindings>) {
  return bindings.map((binding) => (binding.type === "thread" ? binding.ref.threadId : null));
}

describe("selectCodexMicroSlotBindings", () => {
  it("follows the six most recent open threads and leaves the rest of the keys empty", () => {
    const threads = [
      thread("older", completedAt("2026-03-10T08:00:00.000Z")),
      thread("newest", completedAt("2026-03-10T11:00:00.000Z")),
      thread("done", {
        ...completedAt("2026-03-10T11:30:00.000Z"),
        doneAt: NOW,
        doneOverride: "done",
      }),
      thread("reopened", {
        ...completedAt("2026-03-10T10:00:00.000Z"),
        doneAt: NOW,
        doneOverride: "active",
      }),
      thread("snoozed", {
        ...completedAt("2026-03-10T11:40:00.000Z"),
        snoozedUntil: "2026-03-11T09:00:00.000Z",
        snoozedAt: "2026-03-10T11:45:00.000Z",
      }),
      thread("archived", { ...completedAt("2026-03-10T11:50:00.000Z"), archivedAt: NOW }),
    ];

    expect(
      boundIds(
        selectCodexMicroSlotBindings({
          source: "recent",
          threads,
          customAgentKeys: DEFAULT_CODEX_MICRO_CUSTOM_AGENT_KEYS,
          now: NOW,
        }),
      ),
    ).toEqual(["newest", "reopened", "older", null, null, null]);
  });

  it("follows pinned threads in their saved order", () => {
    const threads = [
      thread("second", { pinOrderKey: "b", pinnedAt: NOW }),
      thread("unpinned"),
      thread("first", { pinOrderKey: "a", pinnedAt: NOW }),
    ];

    expect(
      boundIds(
        selectCodexMicroSlotBindings({
          source: "pinned",
          threads,
          customAgentKeys: DEFAULT_CODEX_MICRO_CUSTOM_AGENT_KEYS,
          now: NOW,
        }),
      ).slice(0, 3),
    ).toEqual(["first", "second", null]);
  });

  it("puts threads that need the user ahead of unread and working ones", () => {
    const threads = [
      thread("working", { ...completedAt("2026-03-10T11:00:00.000Z"), ...running }),
      thread("unread", completedAt("2026-03-10T10:00:00.000Z", "2026-03-10T09:00:00.000Z")),
      thread("idle", completedAt("2026-03-10T11:30:00.000Z")),
      thread("approval", {
        ...completedAt("2026-03-10T07:00:00.000Z"),
        hasPendingApprovals: true,
      }),
    ];

    expect(
      boundIds(
        selectCodexMicroSlotBindings({
          source: "attention",
          threads,
          customAgentKeys: DEFAULT_CODEX_MICRO_CUSTOM_AGENT_KEYS,
          now: NOW,
        }),
      ).slice(0, 4),
    ).toEqual(["approval", "unread", "working", "idle"]);
  });

  it("binds custom keys to their assigned threads and actions", () => {
    const bindings = selectCodexMicroSlotBindings({
      source: "custom",
      threads: [thread("assigned")],
      customAgentKeys: {
        ...DEFAULT_CODEX_MICRO_CUSTOM_AGENT_KEYS,
        AG00: { type: "thread", environmentId, threadId: ThreadId.make("assigned") },
        AG01: { type: "thread", environmentId, threadId: ThreadId.make("deleted") },
        AG02: { type: "action", action: { type: "command", command: "chat.new" } },
      },
      now: NOW,
    });

    expect(bindings[0]).toMatchObject({ type: "thread", thread: { id: "assigned" } });
    expect(bindings[1]).toMatchObject({
      type: "thread",
      thread: null,
      ref: { threadId: "deleted" },
    });
    expect(bindings[2]).toEqual({
      type: "action",
      action: { type: "command", command: "chat.new" },
    });
    expect(bindings[3]).toEqual({ type: "empty" });
  });
});

describe("buildCodexMicroSlotViews", () => {
  const connected = new Set([environmentId]);

  function views(
    threads: ReadonlyArray<EnvironmentThreadShell>,
    options: { routeThreadKey?: string | null; windowFocused?: boolean; connected?: boolean } = {},
  ) {
    return buildCodexMicroSlotViews({
      bindings: selectCodexMicroSlotBindings({
        source: "recent",
        threads,
        customAgentKeys: DEFAULT_CODEX_MICRO_CUSTOM_AGENT_KEYS,
        now: NOW,
      }),
      routeThreadKey: options.routeThreadKey ?? null,
      windowFocused: options.windowFocused ?? true,
      connectedEnvironmentIds: options.connected === false ? new Set() : connected,
    });
  }

  it("maps thread state to key colors", () => {
    const statuses = views([
      thread("approval", { ...completedAt("2026-03-10T11:05:00.000Z"), hasPendingApprovals: true }),
      thread("input", { ...completedAt("2026-03-10T11:04:00.000Z"), hasPendingUserInput: true }),
      thread("working", { ...completedAt("2026-03-10T11:03:00.000Z"), ...running }),
      thread("unread", completedAt("2026-03-10T11:02:00.000Z", "2026-03-10T09:00:00.000Z")),
      thread("idle", completedAt("2026-03-10T11:01:00.000Z")),
    ]).map((view) => view.status);

    expect(statuses).toEqual([
      "awaiting-approval",
      "awaiting-response",
      "working",
      "unread",
      "idle",
      "off",
    ]);
  });

  it("shows the thread you are looking at as read and marks it selected", () => {
    const unread = thread(
      "unread",
      completedAt("2026-03-10T11:02:00.000Z", "2026-03-10T09:00:00.000Z"),
    );
    const routeThreadKey = scopedThreadKey({ environmentId, threadId: ThreadId.make("unread") });

    expect(views([unread], { routeThreadKey })[0]).toMatchObject({
      status: "idle",
      selected: true,
    });
    expect(views([unread], { routeThreadKey, windowFocused: false })[0]).toMatchObject({
      status: "unread",
      selected: true,
    });
  });

  it("does not report work on an environment that is not connected", () => {
    expect(
      views([thread("working", { ...completedAt(NOW), ...running })], { connected: false })[0]
        ?.status,
    ).toBe("idle");
  });

  it("drops the thread from keys that are off", () => {
    const model = buildCodexMicroLightingModel(views([thread("only")]));

    expect(model.slots).toHaveLength(6);
    expect(model.slots[0]).toMatchObject({ thread: { threadId: "only" }, status: "idle" });
    expect(model.slots[1]).toEqual({ thread: null, status: "off", selected: false });
  });
});
