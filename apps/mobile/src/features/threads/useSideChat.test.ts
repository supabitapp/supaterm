import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type RuntimeMode,
  type ServerConfig,
} from "@supaterm/contracts";
import { createElement, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  draft: {} as { modelSelection?: ModelSelection; runtimeMode?: RuntimeMode },
  serverConfig: null as ServerConfig | null,
  enqueue: vi.fn(async (_message: unknown) => {}),
  alert: vi.fn(),
  dispatch: vi.fn(),
  uuids: 0,
}));

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => false }));
vi.mock("@react-navigation/native", () => ({
  StackActions: { push: (name: string, params: object) => ({ name, params }) },
  useNavigation: () => ({ dispatch: state.dispatch }),
}));
vi.mock("@supaterm/client-runtime/state/side-chats", () => ({
  sideChatStartBlockedReason: () => null,
  sendSideChatFirstMessage: async (input: { enqueue: () => Promise<unknown> }) => {
    try {
      return { kind: "queued", value: await input.enqueue() };
    } catch (error) {
      return { kind: "failed", reason: String(error) };
    }
  },
}));
vi.mock("../../components/ui/Dialog", () => ({ alert: state.alert }));
vi.mock("../../lib/commandMetadata", () => ({
  makeQueuedMessageMetadata: () => ({
    messageId: "message",
    commandId: "command",
    createdAt: "2026-11-10T00:00:00.000Z",
  }),
}));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => `uuid-${(state.uuids += 1)}` }));
vi.mock("../../state/atom-registry", () => ({
  appAtomRegistry: {
    get: (atom: unknown) =>
      atom === "config"
        ? state.serverConfig
        : (atom as { threadId: string }).threadId === "parent"
          ? {
              id: "parent",
              projectId: "project",
              modelSelection: { instanceId: "codex", model: "gpt-5.4" },
              runtimeMode: "full-access",
            }
          : null,
  },
}));
vi.mock("../../state/server", () => ({ serverEnvironment: { configValueAtom: () => "config" } }));
vi.mock("../../state/threads", () => ({
  environmentThreadShells: { threadShellAtom: (ref: unknown) => ref },
  environmentThreadDetails: { worktreePendingAtom: () => "worktree-pending" },
  threadEnvironment: {},
}));
vi.mock("../../state/entities", () => ({ useEnvironmentServerConfig: () => null }));
vi.mock("../../state/session", () => ({ useEnvironmentScope: vi.fn() }));
vi.mock("../../state/thread-outbox", () => ({ enqueueThreadOutboxMessage: state.enqueue }));
vi.mock("../../state/use-composer-drafts", () => ({
  getComposerDraftSnapshot: () => state.draft,
}));
vi.mock("./threadForkNavigation", () => ({ waitForThreadShellReady: vi.fn() }));

import { startSideChat, useSideChat } from "./useSideChat";

const start = (content?: Parameters<typeof startSideChat>[0]["content"]) =>
  startSideChat({
    environmentId: EnvironmentId.make("primary"),
    parentThreadId: ThreadId.make("parent"),
    targetThreadId: ThreadId.make("side"),
    text: "why does this fail?",
    ...(content ? { content } : {}),
  });

it("starts a side chat with the mode and model the parent's composer shows", async () => {
  const selection: ModelSelection = {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.4",
    options: [{ id: "reasoningEffort", value: "xhigh" }],
  };
  state.draft = { modelSelection: selection, runtimeMode: "approval-required" };
  state.serverConfig = null;

  expect(await start()).toBe("queued");
  expect(state.enqueue).toHaveBeenCalledWith(
    expect.objectContaining({
      threadId: "side",
      modelSelection: selection,
      runtimeMode: "approval-required",
    }),
  );

  // A model the send would refuse does not start a side chat either.
  vi.clearAllMocks();
  state.serverConfig = {
    providers: [{ instanceId: "codex", driver: "codex", enabled: false }],
  } as unknown as ServerConfig;
  expect(await start()).toBeNull();
  expect(state.enqueue).not.toHaveBeenCalled();
  expect(state.alert).toHaveBeenCalledOnce();
});

it("sends the parent composer's attachments and context with the first message", async () => {
  state.draft = {};
  state.serverConfig = null;
  const attachments = [{ id: "image-1", type: "image" }] as never;
  const context = { version: 1, records: [{ kind: "image", attachmentId: "image-1" }] } as never;

  expect(await start({ attachments, context })).toBe("queued");
  expect(state.enqueue).toHaveBeenLastCalledWith(
    expect.objectContaining({ text: "why does this fail?", attachments, context }),
  );
});

async function mountSideChat() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let sideChat!: ReturnType<typeof useSideChat>;
  function Probe() {
    const value = useSideChat(EnvironmentId.make("primary"), {
      environmentId: EnvironmentId.make("primary"),
      id: ThreadId.make("parent"),
      projectId: "project",
      lineage: {},
      deletedAt: null,
    } as never);
    useLayoutEffect(() => {
      sideChat = value;
    });
    return null;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(Probe));
  });
  return {
    send: (...args: Parameters<typeof sideChat.send>) => sideChat.send(...args),
    [Symbol.asyncDispose]: async () => {
      await act(async () => renderer.unmount());
      vi.unstubAllGlobals();
    },
  };
}

it.each([
  ["text only", undefined],
  [
    "with attachments",
    { attachments: [{ id: "image-1", type: "image" }] as never, context: undefined },
  ],
])(
  "/side %s retries a first message that was not saved under the same side chat",
  async (_label, content) => {
    vi.clearAllMocks();
    state.draft = {};
    state.serverConfig = null;
    state.enqueue.mockRejectedValueOnce(new Error("Storage is full."));
    await using sideChat = await mountSideChat();

    expect(await sideChat.send("what is this?", content)).toBe(false);
    expect(await sideChat.send("what is this?", content)).toBe(true);
    const [first, retry] = state.enqueue.mock.calls.map(
      ([message]) => (message as { threadId: string }).threadId,
    );
    expect(retry).toBe(first);
  },
);
