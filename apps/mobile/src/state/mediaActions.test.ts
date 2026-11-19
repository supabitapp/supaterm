import {
  AuthFilesystemReadScope,
  EnvironmentId,
  ThreadId,
  type AuthSessionState,
} from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  sessions: new Map<string, Pick<AuthSessionState, "authenticated" | "scopes">>(),
  refresh: vi.fn(),
  signedUrl: async () => "https://host.test/image.png",
  previewFile: undefined as { uri: string; dispose: () => void } | undefined,
  download: vi.fn(),
  downloadPreview: vi.fn(),
  saveImage: vi.fn(),
  shareLocal: vi.fn(),
  shareDraft: vi.fn(),
  navigate: vi.fn(),
  copy: vi.fn(),
}));

vi.mock("react", () => ({
  useEffect: () => {},
  useRef: <A>(current: A) => ({ current }),
  useState: <A>(initial: A) => [initial, () => {}],
}));
vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: state.navigate }),
}));
vi.mock("../lib/markdownLinks", () => ({
  normalizeNativeMarkdownUrl: (uri: string) => uri,
}));
vi.mock("./assets", () => ({
  useRefreshAssetUrl: (environmentId: string, resource: unknown) => () => {
    state.refresh(environmentId, resource);
    return state.signedUrl();
  },
}));
vi.mock("./session", () => ({
  environmentSession: { sessionStateAtom: (environmentId: string) => environmentId },
}));
vi.mock("./query", () => ({
  useEnvironmentQuery: (environmentId: string) => ({
    data: state.sessions.get(environmentId) ?? null,
    error: null,
  }),
}));
vi.mock("./atom-registry", () => ({
  appAtomRegistry: {
    get: (environmentId: string) => {
      const session = state.sessions.get(environmentId);
      return session === undefined ? AsyncResult.initial() : AsyncResult.success(session);
    },
  },
}));
vi.mock("../lib/attachmentDownload", () => ({
  downloadAndShareAttachment: async (...args: ReadonlyArray<unknown>) => {
    state.download(...args);
  },
  downloadAttachmentForPreview: async (...args: ReadonlyArray<unknown>) => {
    state.downloadPreview(...args);
    return state.previewFile;
  },
  shareLocalAttachment: async (...args: ReadonlyArray<unknown>) => {
    state.shareLocal(...args);
  },
}));
vi.mock("../lib/saveImageToLibrary", () => ({
  canSaveImageToLibrary: (mimeType: string) => mimeType === "image/png",
  saveImageToLibrary: async (...args: ReadonlyArray<unknown>) => {
    state.saveImage(...args);
  },
}));
vi.mock("expo-haptics", () => ({
  notificationAsync: async () => {},
  NotificationFeedbackType: { Success: "success" },
}));
vi.mock("../lib/copyTextWithHaptic", () => ({ copyTextWithHaptic: state.copy }));
vi.mock("../lib/localAttachmentPreview", () => ({
  loadLocalAttachmentPreview: async () => ({
    share: async (...args: ReadonlyArray<unknown>) => {
      state.shareDraft(...args);
    },
    dispose: vi.fn(),
  }),
}));

import { useMediaActions } from "./mediaActions";
import type { MediaActionsSource } from "../lib/mediaActionsSource";

const environmentId = EnvironmentId.make("media-environment");
const otherEnvironmentId = EnvironmentId.make("other-environment");
const threadId = ThreadId.make("media-thread");
const granted: Pick<AuthSessionState, "authenticated" | "scopes"> = {
  authenticated: true,
  scopes: [AuthFilesystemReadScope],
};
const denied: Pick<AuthSessionState, "authenticated" | "scopes"> = {
  authenticated: true,
  scopes: [],
};

function hostSource(_tag: "workspace-file" | "media-file" = "media-file"): MediaActionsSource {
  return {
    environmentId,
    threadId,
    resource: { _tag, threadId, path: "/repo/image.png" },
    reference: { kind: "file", path: "/repo/image.png", relativePath: "image.png" },
    name: "image.png",
    mimeType: "image/png",
  };
}

beforeEach(() => {
  state.sessions.clear();
  state.sessions.set(environmentId, denied);
  state.refresh.mockReset();
  state.signedUrl = async () => "https://host.test/image.png";
  state.download.mockReset();
  state.downloadPreview.mockReset();
  state.previewFile = undefined;
  state.saveImage.mockReset();
  state.shareLocal.mockReset();
  state.shareDraft.mockReset();
  state.navigate.mockReset();
  state.copy.mockReset();
});

it.each(["workspace-file", "media-file"] as const)(
  "blocks denied %s sharing and file opening while preserving path copying",
  async (_tag) => {
    const media = useMediaActions(hostSource(_tag));
    await media.share();
    media.actions.find(({ id }) => id === "open-file")!.run();
    media.actions.find(({ id }) => id === "copy-full-path")!.run();

    expect(state.refresh).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.copy).toHaveBeenCalledWith("/repo/image.png");
    expect(media.actions.find(({ id }) => id === "save")?.disabled).toBe(true);
    expect(media.actions.find(({ id }) => id === "save-image")?.disabled).toBe(true);
    expect(media.actions.find(({ id }) => id === "open-file")?.disabled).toBe(true);
  },
);

it("rechecks a retained menu action after revocation", async () => {
  state.sessions.set(environmentId, granted);
  const media = useMediaActions(hostSource());
  state.sessions.set(environmentId, denied);

  await media.share();
  media.actions.find(({ id }) => id === "open-file")!.run();

  expect(state.refresh).not.toHaveBeenCalled();
  expect(state.navigate).not.toHaveBeenCalled();
});

it("reenables sharing after gaining access while preserving a retained callback", async () => {
  const media = useMediaActions(hostSource());
  state.sessions.set(environmentId, granted);

  await media.share();

  expect(state.download).toHaveBeenCalledOnce();
  expect(useMediaActions(hostSource()).actions.find(({ id }) => id === "save")?.disabled).toBe(
    false,
  );
});

it.each([false, true])("uses the media environment's grant (allowed: %s)", async (allowed) => {
  state.sessions.set(environmentId, allowed ? granted : denied);
  state.sessions.set(otherEnvironmentId, allowed ? denied : granted);

  await useMediaActions(hostSource()).share();

  expect(state.refresh).toHaveBeenCalledTimes(allowed ? 1 : 0);
  expect(state.download).toHaveBeenCalledTimes(allowed ? 1 : 0);
});

it("stops before downloading if access is revoked while the URL is refreshed", async () => {
  state.sessions.set(environmentId, granted);
  state.signedUrl = async () => {
    state.sessions.set(environmentId, denied);
    return "https://host.test/image.png";
  };

  await useMediaActions(hostSource()).share();

  expect(state.refresh).toHaveBeenCalledOnce();
  expect(state.download).not.toHaveBeenCalled();
});

it("lets an unresolved grant be authorized by an explicit server request", async () => {
  state.sessions.delete(environmentId);

  await useMediaActions(hostSource()).share();

  expect(state.refresh).toHaveBeenCalledOnce();
  expect(state.download).toHaveBeenCalledOnce();
});

it.each(["https://cdn.test/image.png", "file:///device/image.png"])(
  "shares direct media without a host grant: %s",
  async (uri) => {
    await useMediaActions({ uri, name: "image.png", mimeType: "image/png" }).share();

    expect(state.refresh).not.toHaveBeenCalled();
    expect(uri.startsWith("file:") ? state.shareLocal : state.download).toHaveBeenCalledOnce();
  },
);

it("saves a host image from its downloaded file, then removes the file", async () => {
  state.sessions.set(environmentId, granted);
  const disposed = Promise.withResolvers<void>();
  state.previewFile = { uri: "file:///cache/image.png", dispose: disposed.resolve };

  useMediaActions(hostSource())
    .actions.find(({ id }) => id === "save-image")!
    .run();
  await disposed.promise;

  expect(state.downloadPreview).toHaveBeenCalledWith(
    expect.objectContaining({ url: "https://host.test/image.png" }),
  );
  expect(state.saveImage).toHaveBeenCalledWith("file:///cache/image.png", "image/png", "image.png");
});
