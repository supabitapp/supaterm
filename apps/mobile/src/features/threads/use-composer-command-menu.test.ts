import { describe, expect, it, vi } from "vite-plus/test";
import { ProviderDriverKind } from "@supaterm/contracts";

vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));

vi.mock("../../state/queries", () => ({
  useComposerPathSearch: () => ({ entries: [], isPending: false }),
  useComposerPullRequestSearch: () => ({ entries: [], isPending: false, error: null }),
}));
vi.mock("../../state/use-composer-drafts", () => ({
  getComposerDraftSnapshot: vi.fn(),
  readComposerDraftSelection: vi.fn(),
  setComposerDraftContext: vi.fn(),
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
  buildComposerSlashCommandItems,
  resolveComposerCommandSelection,
} from "./use-composer-command-menu";

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
