import { PrimaryConnectionTarget } from "@supaterm/client-runtime/connection";
import { RegistryContext } from "@effect/atom-react";
import {
  AssetAccessError,
  type AssetCreateUrlResult,
  EnvironmentId,
  ThreadId,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AtomRegistry } from "effect/reactivity";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";

const mint = vi.hoisted(() => vi.fn<() => Promise<AssetCreateUrlResult>>());
const remoteOpen = vi.hoisted(() => ({
  state: { mode: "local-exec" as "local-exec" | "remote-unavailable" },
  isResolved: true,
  label: "media-host",
  httpBaseUrl: "https://host.test",
}));
// Atoms derived from the server config run in the real registry over a missing config.
vi.mock(import("../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const noConfig = Atom.make(null);
  return {
    ...actual,
    serverEnvironment: { ...actual.serverEnvironment, configValueAtom: (() => noConfig) as never },
  };
});

vi.mock(import("../state/assets"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const isAssetError = Schema.is(AssetAccessError);
  const family = Atom.family((_key: string) =>
    Atom.make(
      Effect.tryPromise({
        try: () => mint(),
        catch: (error) => (isAssetError(error) ? error : new Cause.UnknownError(error)),
      }),
    ).pipe(Atom.keepAlive),
  );
  return {
    ...actual,
    assetEnvironment: {
      ...actual.assetEnvironment,
      createUrl: (target) => family(JSON.stringify(target)),
    },
  };
});
vi.mock(import("../state/filesystem"), async (original) => ({
  ...(await original()),
  useFilesystemReadAccess: () => ({ canReadFiles: true, isPending: false, error: null }),
}));
vi.mock(import("../state/session"), async (original) => ({
  ...(await original()),
  readEnvironmentScope: () => false,
  useEnvironmentScope: () => false,
  readPreparedConnection: (() => ({
    httpBaseUrl: "https://host.test",
    target: remoteOpen.isResolved
      ? new PrimaryConnectionTarget({
          environmentId: EnvironmentId.make("media-environment"),
          label: remoteOpen.label,
          httpBaseUrl: remoteOpen.httpBaseUrl,
          wsBaseUrl: "wss://host.test",
        })
      : undefined,
  })) as never,
  usePreparedConnection: (() => ({
    _tag: "Some",
    value: { httpBaseUrl: "https://host.test" },
  })) as never,
}));

vi.mock(import("../remoteOpen"), async (original) => ({
  ...(await original()),
  useRemoteOpenResolution: () => remoteOpen,
}));

import ChatMarkdown from "./ChatMarkdown";

const imageUrl = (version: string) =>
  `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>#${version}`;
const assetResult = (version: string): AssetCreateUrlResult => ({
  relativeUrl: imageUrl(version),
  expiresAt: 1,
});

function setup() {
  mint.mockReset().mockResolvedValue(assetResult("updated"));
  remoteOpen.isResolved = true;
  remoteOpen.state.mode = "local-exec";
  remoteOpen.label = "media-host";
  remoteOpen.httpBaseUrl = "https://host.test";
  const registry = AtomRegistry.make();
  return { registry, [Symbol.dispose]: () => registry.dispose() };
}

async function renderInRegistry(registry: AtomRegistry.AtomRegistry, ui: ReactNode) {
  const wrap = (node: ReactNode) => (
    <RegistryContext.Provider value={registry}>{node}</RegistryContext.Provider>
  );
  const screen = await render(wrap(ui));
  return Object.assign(screen, { update: (node: ReactNode) => screen.rerender(wrap(node)) });
}

describe("pending media requests", () => {
  const environmentId = EnvironmentId.make("media-environment");
  const markdown = (threadId: string, text: string, onImageExpand: () => void) => (
    <ChatMarkdown
      cwd="/repo"
      threadRef={{ environmentId, threadId: ThreadId.make(threadId) }}
      text={text}
      onImageExpand={onImageExpand}
    />
  );

  async function resolveAfterVisiting(visits: ReadonlyArray<{ threadId: string; text: string }>) {
    using env = setup();
    let resolveMint!: (result: Awaited<ReturnType<typeof mint>>) => void;
    mint.mockReturnValue(new Promise((resolve) => (resolveMint = resolve)));
    const onImageExpand = vi.fn();
    await using screen = await renderInRegistry(
      env.registry,
      markdown("thread-a", "[Open image](/tmp/image.png)", onImageExpand),
    );
    const { container } = screen;
    const link = container.querySelector<HTMLAnchorElement>('a[href="/tmp/image.png"]');
    expect(link).not.toBeNull();
    await act(async () => link!.click());
    for (const { threadId, text } of visits) {
      await screen.update(markdown(threadId, text, onImageExpand));
    }
    await act(async () => resolveMint({ relativeUrl: "/api/assets/image.png", expiresAt: 1 }));
    return onImageExpand;
  }

  it("opens after the reply re-renders in the same thread", async () => {
    const onImageExpand = await resolveAfterVisiting([
      { threadId: "thread-a", text: "[Open image](/tmp/image.png) and more" },
    ]);
    expect(onImageExpand).toHaveBeenCalledTimes(1);
  });

  it("stays closed when it finishes loading in another thread", async () => {
    const onImageExpand = await resolveAfterVisiting([
      { threadId: "thread-b", text: "[Open image](/tmp/image.png)" },
    ]);
    expect(onImageExpand).not.toHaveBeenCalled();
  });

  it("stays closed when it finishes loading after returning to its thread", async () => {
    const onImageExpand = await resolveAfterVisiting([
      { threadId: "thread-b", text: "[Open image](/tmp/image.png)" },
      { threadId: "thread-a", text: "[Open image](/tmp/image.png)" },
    ]);
    expect(onImageExpand).not.toHaveBeenCalled();
  });
});
