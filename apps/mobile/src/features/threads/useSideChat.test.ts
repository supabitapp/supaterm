import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type RuntimeMode,
  type ServerConfig,
} from "@supaterm/contracts";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  draft: {} as { modelSelection?: ModelSelection; runtimeMode?: RuntimeMode },
  serverConfig: null as ServerConfig | null,
  enqueue: vi.fn(async (_message: unknown) => {}),
  alert: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({ StackActions: {}, useNavigation: vi.fn() }));
vi.mock("@supaterm/client-runtime/state/side-chats", () => ({
  sideChatStartBlockedReason: vi.fn(),
  sendSideChatFirstMessage: async (input: { enqueue: () => Promise<unknown> }) => ({
    kind: "queued",
    value: await input.enqueue(),
  }),
}));
vi.mock("../../components/ui/Dialog", () => ({ alert: state.alert }));
vi.mock("../../lib/commandMetadata", () => ({
  makeQueuedMessageMetadata: () => ({
    messageId: "message",
    commandId: "command",
    createdAt: "2026-11-10T00:00:00.000Z",
  }),
}));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "uuid" }));
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
  environmentThreadDetails: {},
  threadEnvironment: {},
}));
vi.mock("../../state/entities", () => ({ useEnvironmentServerConfig: vi.fn() }));
vi.mock("../../state/session", () => ({ useEnvironmentScope: vi.fn() }));
vi.mock("../../state/thread-outbox", () => ({ enqueueThreadOutboxMessage: state.enqueue }));
vi.mock("../../state/use-composer-drafts", () => ({
  getComposerDraftSnapshot: () => state.draft,
}));
vi.mock("./threadForkNavigation", () => ({ waitForThreadShellReady: vi.fn() }));

import { startSideChat } from "./useSideChat";

const start = () =>
  startSideChat({
    environmentId: EnvironmentId.make("primary"),
    parentThreadId: ThreadId.make("parent"),
    targetThreadId: ThreadId.make("side"),
    text: "why does this fail?",
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
