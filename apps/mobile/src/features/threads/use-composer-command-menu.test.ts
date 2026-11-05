import { describe, expect, it, vi } from "vite-plus/test";
import { ProviderDriverKind, type ServerConfig } from "@supaterm/contracts";

vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));

vi.mock("../../state/queries", () => ({
  useComposerPathSearch: () => ({ entries: [], isPending: false }),
  useComposerPullRequestSearch: () => ({ entries: [], isPending: false, error: null }),
}));
vi.mock("../../state/use-composer-drafts", () => ({
  getComposerDraftSnapshot: vi.fn(),
  setComposerDraftContext: vi.fn(),
  useComposerDraftSelection: vi.fn(),
}));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "context-id" }));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    providersValueAtom: vi.fn(),
    refreshProviders: Symbol("refreshProviders"),
  },
}));
vi.mock("../../state/preferences", async () => {
  const { Atom } = await import("effect/reactivity");
  return { showSkillsInSlashMenuAtom: Atom.make(false) };
});

import {
  buildComposerSlashCommandItems,
  composerModelCandidates,
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

  it("offers /side and /btw only where the thread can start a side chat", () => {
    const labels = (offersSideChat: boolean) =>
      buildComposerSlashCommandItems({
        query: "",
        hasThread: true,
        offersSideChat,
        selectedProviderStatus: antigravity,
      }).map((item) => item.label);
    expect(labels(true)).toEqual(expect.arrayContaining(["/side", "/btw"]));
    expect(labels(false)).not.toContain("/side");
  });
});

describe("composerModelCandidates", () => {
  const provider = (instanceId: string, overrides: object, models: object[]) => ({
    instanceId,
    driver: instanceId,
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    models: models.map((model) => ({ isCustom: false, capabilities: null, ...model })),
    ...overrides,
  });

  it("offers current models from usable providers only", () => {
    const config = {
      providers: [
        provider("codex", {}, [
          { slug: "gpt-5.4", name: "GPT-5.4" },
          { slug: "gpt-4", name: "GPT-4", isLegacy: true },
        ]),
        provider("claudeAgent", { auth: { status: "unauthenticated" } }, [
          { slug: "claude-opus-4-5", name: "Claude Opus 4.5" },
        ]),
        provider("cursor", { enabled: false }, [{ slug: "composer-2", name: "Composer 2" }]),
        provider("opencode", { availability: "unavailable" }, [
          { slug: "openai/gpt-5.4", name: "GPT-5.4" },
        ]),
      ],
    } as unknown as ServerConfig;
    expect(
      composerModelCandidates(config, null).map(
        ({ instanceId, model }) => `${instanceId}/${model}`,
      ),
    ).toEqual(["codex/gpt-5.4"]);
  });
});
