import { RegistryContext } from "@effect/atom-react";
import { type AssetCreateUrlResult, EnvironmentId, ThreadId } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mint = vi.hoisted(() => vi.fn<() => Promise<AssetCreateUrlResult>>());
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
  const family = Atom.family((_key: string) =>
    Atom.make(Effect.tryPromise(() => mint())).pipe(Atom.keepAlive),
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
  readPreparedConnection: (() => ({ httpBaseUrl: "https://host.test" })) as never,
  usePreparedConnection: (() => ({
    _tag: "Some",
    value: { httpBaseUrl: "https://host.test" },
  })) as never,
}));

import ChatMarkdown from "./ChatMarkdown";

const roots: Root[] = [];
let registry: AtomRegistry.AtomRegistry;

const imageUrl = (version: string) =>
  `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>#${version}`;
const assetResult = (version: string): AssetCreateUrlResult => ({
  relativeUrl: imageUrl(version),
  expiresAt: 1,
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  registry = AtomRegistry.make();
  mint.mockReset().mockResolvedValue(assetResult("updated"));
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  registry.dispose();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function createTestRoot() {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  return {
    container,
    render: (children: ReactNode) =>
      act(async () => {
        root.render(
          <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>,
        );
      }),
  };
}

it("opens host media through server authorization before the client grant loads", async () => {
  mint.mockResolvedValue({ relativeUrl: "/api/assets/image.png", expiresAt: 1 });
  const onImageExpand = vi.fn();
  const { container, render } = createTestRoot();
  await render(
    <ChatMarkdown
      cwd="/repo"
      threadRef={{
        environmentId: EnvironmentId.make("media-environment"),
        threadId: ThreadId.make("media-thread"),
      }}
      text="[Open image](/tmp/image.png)"
      onImageExpand={onImageExpand}
    />,
  );
  const link = container.querySelector<HTMLAnchorElement>('a[href="/tmp/image.png"]');
  expect(link).not.toBeNull();
  await act(async () => link!.click());
  await vi.waitFor(() =>
    expect(onImageExpand).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [expect.objectContaining({ src: "https://host.test/api/assets/image.png" })],
      }),
    ),
  );
});

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
    let resolveMint!: (result: Awaited<ReturnType<typeof mint>>) => void;
    mint.mockReturnValue(new Promise((resolve) => (resolveMint = resolve)));
    const onImageExpand = vi.fn();
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(markdown("thread-a", "[Open image](/tmp/image.png)", onImageExpand)),
    );
    const link = container.querySelector<HTMLAnchorElement>('a[href="/tmp/image.png"]');
    expect(link).not.toBeNull();
    await act(async () => link!.click());
    for (const { threadId, text } of visits) {
      await act(async () => root.render(markdown(threadId, text, onImageExpand)));
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

const threadRef = {
  environmentId: EnvironmentId.make("media-environment"),
  threadId: ThreadId.make("media-thread"),
};

function markdown(workspaceMutationId?: string | null) {
  return (
    <ChatMarkdown
      cwd="/repo"
      imageBaseDir="/repo"
      threadRef={threadRef}
      text="![Diagram](diagram.svg)"
      workspaceMutationId={workspaceMutationId}
    />
  );
}

function renderedImage(container: HTMLElement) {
  return container.querySelector<HTMLImageElement>('img[alt="Diagram"]')?.getAttribute("src");
}

it("ordinary chat keeps its embedded asset URL across renders and reopening", async () => {
  const { container, render } = createTestRoot();
  await render(markdown());
  expect(renderedImage(container)).toBe(imageUrl("updated"));
  mint.mockResolvedValue(assetResult("changed"));

  await render(markdown());
  await render(null);
  await render(markdown());

  expect(renderedImage(container)).toBe(imageUrl("updated"));
  expect(mint).toHaveBeenCalledTimes(1);
});

it.each(["URL", "failure"] as const)(
  "reopening a file preview with no workspace mutation replaces its cached %s",
  async (cached) => {
    if (cached === "failure") mint.mockRejectedValueOnce(new Error("Image missing"));
    else mint.mockResolvedValueOnce(assetResult("stale"));
    const { container, render } = createTestRoot();
    await render(markdown(null));
    expect(renderedImage(container)).toBe(cached === "URL" ? imageUrl("stale") : undefined);
    await render(null);

    mint.mockResolvedValue(assetResult("updated"));
    await render(markdown(null));

    expect(renderedImage(container)).toBe(imageUrl("updated"));
    expect(mint).toHaveBeenCalledTimes(2);
  },
);

it.each(["initial", "refresh"] as const)(
  "shows the latest workspace edit after a pending %s asset request settles",
  async (request) => {
    let resolvePending!: (value: AssetCreateUrlResult) => void;
    const pending = new Promise<AssetCreateUrlResult>((resolve) => {
      resolvePending = resolve;
    });
    const { container, render } = createTestRoot();
    if (request === "refresh") {
      await render(markdown("m0"));
      expect(renderedImage(container)).toBe(imageUrl("updated"));
    }

    mint.mockReturnValueOnce(pending).mockResolvedValue(assetResult("latest"));
    await render(markdown("m1"));
    const callsBeforeEdits = mint.mock.calls.length;
    await render(markdown("m2"));
    await render(markdown("m3"));
    expect(mint).toHaveBeenCalledTimes(callsBeforeEdits);

    await act(async () => {
      resolvePending(assetResult("before-edits"));
      await pending;
    });

    expect(renderedImage(container)).toBe(imageUrl("latest"));
    expect(mint).toHaveBeenCalledTimes(callsBeforeEdits + 1);
    await render(markdown("m3"));
    expect(mint).toHaveBeenCalledTimes(callsBeforeEdits + 1);
  },
);
