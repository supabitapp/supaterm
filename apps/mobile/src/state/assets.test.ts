import {
  AuthFilesystemReadScope,
  EnvironmentAuthorizationError,
  EnvironmentId,
  ThreadId,
  type AuthSessionState,
} from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  session: null as Pick<AuthSessionState, "authenticated" | "scopes"> | null,
  phase: "connected" as "connected" | "offline",
  assetAtom: {},
  mint: vi.fn(),
  assetQuery: vi.fn(),
  execute: vi.fn(),
  connection: { _tag: "Some", value: { httpBaseUrl: "https://host.test" } } as
    | { _tag: "Some"; value: { httpBaseUrl: string } }
    | { _tag: "None" },
}));

vi.mock("react", () => ({ useCallback: <A>(callback: A) => callback }));
vi.mock("@effect/atom-react", () => ({
  useAtomMount: () => undefined,
  useAtomSubscribe: () => undefined,
  useAtomValue: (atom: unknown) =>
    atom === state.assetAtom
      ? AsyncResult.success({ relativeUrl: "/api/assets/image.png", expiresAt: 1 })
      : AsyncResult.initial(false),
}));
vi.mock("./session", () => ({
  environmentSession: { sessionStateAtom: () => ({}), preparedConnectionValueAtom: () => ({}) },
  usePreparedConnection: () => ({ _tag: "Some", value: { httpBaseUrl: "https://host.test" } }),
}));
vi.mock("./presentation", () => ({
  useEnvironmentPresentation: () => ({
    isReady: true,
    presentation: { connection: { phase: state.phase, error: null } },
  }),
}));
vi.mock("./query", () => ({
  useEnvironmentQuery: () => ({ data: state.session, error: null }),
}));
vi.mock("./projectClones", () => ({ environmentProjectCloneListAtom: () => null }));
vi.mock("../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("../connection/catalog", () => ({
  environmentCatalog: { sessionGenerationAtom: () => null },
}));
vi.mock("@supaterm/client-runtime/state/assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supaterm/client-runtime/state/assets")>()),
  createAssetEnvironmentAtoms: () => ({ createUrl: state.assetQuery }),
}));
vi.mock("./use-atom-query-runner", () => ({ useAtomQueryRunner: () => state.mint }));

vi.mock("./atom-registry", () => ({ appAtomRegistry: { get: () => state.connection } }));
vi.mock("@supaterm/client-runtime/state/runtime", () => ({ executeAtomQuery: state.execute }));

import { refreshAssetUrl, useRefreshAssetUrl, useAssetUrlState } from "./assets";

const environmentId = EnvironmentId.make("asset-environment");
const threadId = ThreadId.make("asset-thread");
const resource = { _tag: "media-file", threadId, path: "/repo/image.png" } as const;

beforeEach(() => {
  state.session = null;
  state.phase = "connected";
  state.connection = { _tag: "Some", value: { httpBaseUrl: "https://host.test" } };
  state.execute.mockReset();
  state.assetQuery.mockReset().mockReturnValue(state.assetAtom);
  state.mint
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ relativeUrl: "/api/assets/image.png", expiresAt: 1 }));
});

it.each(["workspace-file", "media-file"] as const)(
  "keeps %s loading until its file grant resolves",
  (_tag) => {
    expect(useAssetUrlState(environmentId, { ...resource, _tag })).toEqual({ _tag: "Loading" });
    expect(state.assetQuery).not.toHaveBeenCalled();

    state.session = { authenticated: true, scopes: [AuthFilesystemReadScope] };
    expect(useAssetUrlState(environmentId, { ...resource, _tag })).toEqual({
      _tag: "Success",
      expiresAt: 1,
      url: "https://host.test/api/assets/image.png",
    });
  },
);

it("hides host assets with a denied grant while preserving attachments", () => {
  state.session = { authenticated: true, scopes: [] };
  expect(useAssetUrlState(environmentId, resource)).toEqual({
    _tag: "Failure",
    reason: "missing-file-access",
  });
  expect(state.assetQuery).not.toHaveBeenCalled();
  expect(useAssetUrlState(environmentId, { _tag: "attachment", attachmentId: "upload" })).toEqual({
    _tag: "Success",
    expiresAt: 1,
    url: "https://host.test/api/assets/image.png",
  });
});

it("lets the server authorize an explicit refresh before the client grant loads", async () => {
  await expect(useRefreshAssetUrl(environmentId, resource)()).resolves.toBe(
    "https://host.test/api/assets/image.png",
  );
  expect(state.mint).toHaveBeenCalledWith({ environmentId, input: { resource } });

  const denied = new EnvironmentAuthorizationError({
    message: "This connection cannot read host files.",
    requiredScope: AuthFilesystemReadScope,
  });
  state.mint.mockResolvedValue(AsyncResult.failure(Cause.fail(denied)));
  await expect(useRefreshAssetUrl(environmentId, resource)()).resolves.toBeNull();
});

it("resolves refreshed native preview assets against the current connection", async () => {
  const controller = new AbortController();
  state.execute.mockImplementation(async () => {
    state.connection = { _tag: "Some", value: { httpBaseUrl: "https://reconnected.test" } };
    return AsyncResult.success({ relativeUrl: "/api/assets/fresh-video.mp4", expiresAt: 99 });
  });
  await expect(refreshAssetUrl(environmentId, resource, controller.signal)).resolves.toBe(
    "https://reconnected.test/api/assets/fresh-video.mp4",
  );
  expect(state.execute.mock.calls[0]?.[2]).toMatchObject({
    refresh: true,
    signal: controller.signal,
  });
});

it("does not mint an asset while disconnected or reuse a result after disconnect", async () => {
  state.connection = { _tag: "None" };
  await expect(refreshAssetUrl(environmentId, resource)).resolves.toBeNull();
  expect(state.execute).not.toHaveBeenCalled();
  state.connection = { _tag: "Some", value: { httpBaseUrl: "https://host.test" } };
  state.execute.mockImplementation(async () => {
    state.connection = { _tag: "None" };
    return AsyncResult.success({ relativeUrl: "/api/assets/stale.mp4", expiresAt: 99 });
  });
  await expect(refreshAssetUrl(environmentId, resource)).resolves.toBeNull();
});
