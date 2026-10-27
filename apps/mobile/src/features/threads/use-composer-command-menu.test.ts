import { describe, expect, it, vi } from "vite-plus/test";
import { ProviderDriverKind } from "@supaterm/contracts";

const refreshProviders = vi.hoisted(() => vi.fn());
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
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => refreshProviders,
}));

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

  it("offers /side and /btw over provider commands of the same name only where side chats exist", () => {
    const provider = {
      driver: ProviderDriverKind.make("codex"),
      slashCommands: [
        { name: "side", description: "Provider side" },
        { name: "btw", description: "Provider btw" },
      ],
    };
    const commands = (offersSideChats: boolean) =>
      buildComposerSlashCommandItems({
        query: "",
        hasThread: true,
        offersSideChats,
        selectedProviderStatus: provider,
      }).map((item) => [item.type, item.label]);

    expect(commands(true)).toEqual([
      ["slash-command", "/model"],
      ["slash-command", "/side"],
      ["slash-command", "/btw"],
    ]);
    expect(commands(false)).toEqual([
      ["slash-command", "/model"],
      ["provider-slash-command", "/side"],
      ["provider-slash-command", "/btw"],
    ]);
  });
});
