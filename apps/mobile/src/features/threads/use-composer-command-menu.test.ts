import { describe, expect, it, vi } from "vite-plus/test";
import { createElement, useLayoutEffect } from "react";
import { act, create } from "react-test-renderer";
import { makeThreadShellFixture } from "../../test-fixtures";
import { EnvironmentId, ThreadId, ProviderDriverKind } from "@supaterm/contracts";

vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));

vi.mock("../../state/queries", () => ({
  useThreadSearch: vi.fn(),
  useComposerPathSearch: () => ({ entries: [], isPending: false }),
  useComposerPullRequestSearch: () => ({ entries: [], isPending: false, error: null }),
}));
vi.mock("../../state/use-composer-drafts", () => ({
  getComposerDraftSnapshot: vi.fn(),
  setComposerDraftContext: vi.fn(),
  readComposerDraftSelection: () => null,
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => false,
  useAtomRefresh: () => () => {},
}));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "context-id" }));
vi.mock("../../state/server", () => ({
  serverEnvironment: { refreshProviders: Symbol("refreshProviders") },
}));
vi.mock("../../state/preferences", async () => {
  const { Atom } = await import("effect/reactivity");
  return { showSkillsInSlashMenuAtom: Atom.make(false) };
});

import {
  useComposerCommandMenu,
  buildComposerSlashCommandItems,
  resolveComposerCommandSelection,
  resolveComposerMenuSelection,
} from "./use-composer-command-menu";

describe("resolveComposerMenuSelection", () => {
  it("prefers the caret an insertion placed in the current draft text", () => {
    expect(
      resolveComposerMenuSelection({
        draftMessage: "hello @chip ",
        ownerKey: "draft-a",
        inserted: { start: 12, end: 12 },
        local: { ownerKey: "draft-a", start: 2, end: 2 },
      }),
    ).toEqual({ start: 12, end: 12 });
  });

  it("clamps the composer's own caret when the draft shrinks", () => {
    expect(
      resolveComposerMenuSelection({
        draftMessage: "hi",
        ownerKey: "draft-a",
        inserted: null,
        local: { ownerKey: "draft-a", start: 5, end: 9 },
      }),
    ).toEqual({ start: 2, end: 2 });
  });

  it("starts at the end of the draft after switching owners", () => {
    expect(
      resolveComposerMenuSelection({
        draftMessage: "other draft",
        ownerKey: "draft-b",
        inserted: null,
        local: { ownerKey: "draft-a", start: 1, end: 1 },
      }),
    ).toEqual({ start: 11, end: 11 });
  });
});

describe("mobile slash commands", () => {
  const antigravity = {
    driver: ProviderDriverKind.make("antigravity"),
    slashCommands: [{ name: "plan", description: "Plan with Antigravity" }],
  };

  it("keeps native provider commands while hiding legacy mode commands", () => {
    const items = buildComposerSlashCommandItems({
      query: "pl",
      hasThread: true,
      selectedProviderStatus: antigravity,
    });
    const item = items[0];
    if (!item) throw new Error("Expected the provider plan command");
    expect(
      resolveComposerCommandSelection({
        draftMessage: "/plan",
        trigger: { rangeStart: 0, rangeEnd: 5 },
        item,
      }),
    ).toEqual({ text: "/plan ", cursor: 6 });
  });
});

describe("mobile thread mentions across environments", () => {
  const local = EnvironmentId.make("local");
  const linked = EnvironmentId.make("linked");
  const unlinked = EnvironmentId.make("unlinked");
  const threadShells = [local, linked, unlinked].map((environmentId) =>
    makeThreadShellFixture({
      environmentId,
      id: ThreadId.make(`${environmentId}-thread`),
      title: `${environmentId} task`,
    }),
  );

  it.each([false, true])(
    "only offers accessible threads with links enabled: %s",
    async (enabled) => {
      let menu: ReturnType<typeof useComposerCommandMenu> | undefined;
      function Probe() {
        const value = useComposerCommandMenu({
          draftMessage: "@task",
          ownerKey: null,
          environmentId: local,
          threadShells,
          ...(enabled ? { linkedEnvironments: new Map([[linked, "Linked machine"]]) } : {}),
          projectCwd: null,
          selectedProviderStatus: null,
          hasThread: true,
          hasCompactableConversation: false,
          onChangeDraftMessage: () => {},
        });
        useLayoutEffect(() => {
          menu = value;
        });
        return null;
      }
      let root: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          root = create(createElement(Probe));
        });
        const threads = menu!.items.filter((item) => item.type === "thread");
        expect(threads.map((item) => item.thread.environmentId).sort()).toEqual(
          enabled ? [linked, local].sort() : [local],
        );
        if (enabled)
          expect(threads.find((item) => item.thread.environmentId === linked)?.description).toBe(
            "Thread on Linked machine",
          );
      } finally {
        await act(async () => root?.unmount());
      }
    },
  );
});
