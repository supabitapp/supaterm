import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mint = vi.hoisted(() => vi.fn());
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
vi.mock(import("../state/use-atom-query-runner"), async (original) => ({
  ...(await original()),
  useAtomQueryRunner: (() => mint) as never,
}));
vi.mock(import("../state/session"), async (original) => ({
  ...(await original()),
  readEnvironmentScope: () => false,
  useEnvironmentScope: () => false,
  readPreparedConnection: (() => ({ httpBaseUrl: "https://host.test" })) as never,
}));

import ChatMarkdown from "./ChatMarkdown";

const roots: Root[] = [];
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("opens host media through server authorization before the client grant loads", async () => {
  mint.mockResolvedValue(
    AsyncResult.success({ relativeUrl: "/api/assets/image.png", expiresAt: 1 }),
  );
  const onImageExpand = vi.fn();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      <ChatMarkdown
        cwd="/repo"
        threadRef={{
          environmentId: EnvironmentId.make("media-environment"),
          threadId: ThreadId.make("media-thread"),
        }}
        text="[Open image](/tmp/image.png)"
        onImageExpand={onImageExpand}
      />,
    ),
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
    let resolveMint!: (result: unknown) => void;
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
    await act(async () =>
      resolveMint(AsyncResult.success({ relativeUrl: "/api/assets/image.png", expiresAt: 1 })),
    );
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
