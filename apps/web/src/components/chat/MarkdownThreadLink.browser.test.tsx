import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ProjectId, ThreadId } from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { MarkdownThreadLink } from "./MarkdownThreadLink";

import "~/index.css";

const state = vi.hoisted(() => ({
  childTitles: new Map<string, string>(),
  shellOmitsThreads: false,
  metadataSupported: false,
  reply: null as unknown,
  remote: null as unknown,
}));

vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useThreadShell: ((ref: { environmentId: string } | null) =>
    ref?.environmentId === "remote" ? state.remote : null) as never,
  useThreadRefs: (enabled = true) =>
    enabled
      ? [{ environmentId: EnvironmentId.make("remote"), threadId: ThreadId.make("older-thread") }]
      : [],
  useProject: ((ref: { projectId: string } | null) =>
    ref?.projectId === "essay-project" ? { title: "Essays" } : null) as never,
  useSubagentChildTitles: ((ref: unknown) =>
    ref === null ? new Map() : state.childTitles) as never,
  useShellOmitsThreads: (() => state.shellOmitsThreads) as never,
  useThreadLinkMetadataSupported: (() => state.metadataSupported) as never,
}));
vi.mock(import("../ProjectFavicon"), () => ({
  ProjectFavicon: () => (
    <span role="img" aria-label="Essays project icon">
      P
    </span>
  ),
}));
vi.mock(import("../../state/orchestration"), () => ({
  orchestrationEnvironment: { threadLinkMetadata: () => state.reply } as never,
}));

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const PARENT_ID = ThreadId.make("parent");
const CHILD_ID = ThreadId.make("thread:delegated-task:command%3Amcp%3Areview");

function setup(input: {
  childTitles: Record<string, string>;
  shellOmitsThreads: boolean;
  metadataSupported: boolean;
}) {
  const reply = Atom.make<
    AsyncResult.AsyncResult<Record<string, { title: string; projectId: ProjectId | null }>, string>
  >(AsyncResult.initial());
  state.childTitles = new Map(Object.entries(input.childTitles));
  state.shellOmitsThreads = input.shellOmitsThreads;
  state.metadataSupported = input.metadataSupported;
  state.reply = reply;
  state.remote = {
    environmentId: EnvironmentId.make("remote"),
    id: ThreadId.make("older-thread"),
    title: "Remote thread",
    projectId: ProjectId.make("essay-project"),
  };
  return { reply, registry: AtomRegistry.make() };
}

describe("MarkdownThreadLink on servers without thread link lookups", () => {
  it.each([
    {
      name: "an idle subagent the shell omits takes its title from the open thread",
      childTitles: { [CHILD_ID]: "Correctness review" },
      shellOmitsThreads: true,
      chip: "Thread, Correctness review",
    },
    {
      name: "an unknown thread stays openable when the shell can omit it",
      childTitles: {},
      shellOmitsThreads: true,
      chip: "Thread, Thread",
    },
    {
      name: "an unknown thread is unavailable when the shell holds every thread",
      childTitles: {},
      shellOmitsThreads: false,
      chip: "Unavailable context, Thread no longer available",
    },
  ])("$name", async ({ childTitles, shellOmitsThreads, chip }) => {
    setup({ childTitles, shellOmitsThreads, metadataSupported: false });
    await using _screen = await render(
      <MarkdownThreadLink
        environmentId={ENVIRONMENT_ID}
        threadRef={{ environmentId: ENVIRONMENT_ID, threadId: PARENT_ID }}
        link={{ environmentId: ENVIRONMENT_ID, threadId: CHILD_ID }}
        label={null}
      />,
    );
    await expect.element(page.getByLabelText(chip)).toBeVisible();
  });
});

it.each([
  { legacy: false, encoded: false },
  { legacy: true, encoded: false },
  { legacy: false, encoded: true },
])(
  "resolves an unloaded thread with its icon and the correct destination, %j",
  async ({ legacy, encoded }) => {
    const { reply, registry } = setup({
      childTitles: {},
      shellOmitsThreads: true,
      metadataSupported: true,
    });
    using _registry = { [Symbol.dispose]: () => registry.dispose() };
    const environmentId = EnvironmentId.make("environment");
    const threadId = ThreadId.make(encoded ? "older%2Dthread" : "older-thread");
    await using screen = await render(
      <RegistryContext value={registry}>
        <MarkdownThreadLink
          environmentId={environmentId}
          threadRef={null}
          link={{ environmentId: legacy ? null : environmentId, threadId }}
          label={null}
        />
      </RegistryContext>,
    );
    await expect
      .element(screen.getByRole("link", { name: "Thread, Thread", exact: true }))
      .toBeVisible();
    await act(() => registry.set(reply, AsyncResult.failure(Cause.fail("offline"))));
    await expect
      .element(screen.getByRole("link", { name: "Thread, Thread", exact: true }))
      .toBeVisible();
    await act(() =>
      registry.set(
        reply,
        AsyncResult.success({
          [threadId]: { title: "Older essay", projectId: ProjectId.make("essay-project") },
          ...(encoded
            ? {
                "older-thread": {
                  title: "Decoded essay",
                  projectId: ProjectId.make("essay-project"),
                },
              }
            : {}),
        }),
      ),
    );
    const link = screen.getByRole("link", { name: "Thread, Older essay" });
    await expect.element(link).toBeVisible();
    await expect.element(screen.getByRole("img", { name: "Essays project icon" })).toBeVisible();
    await link.click();
    await vi.waitFor(() =>
      expect(screen.router?.state.location.pathname).toBe(
        `/environment/${encodeURIComponent(threadId)}`,
      ),
    );
    if (encoded) {
      await act(() =>
        registry.set(
          reply,
          AsyncResult.success({
            "older-thread": { title: "Decoded essay", projectId: ProjectId.make("essay-project") },
          }),
        ),
      );
      const decoded = screen.getByRole("link", { name: "Thread, Decoded essay" });
      await expect.element(decoded).toBeVisible();
      await decoded.click();
      await vi.waitFor(() =>
        expect(screen.router?.state.location.pathname).toBe("/environment/older-thread"),
      );
    }
    await act(() => registry.set(reply, AsyncResult.success({})));
    if (legacy) {
      const remote = screen.getByRole("link", { name: "Thread, Remote thread" });
      await expect.element(remote).toBeVisible();
      await remote.click();
      await vi.waitFor(() =>
        expect(screen.router?.state.location.pathname).toBe("/remote/older-thread"),
      );
    } else {
      await expect
        .element(screen.getByText("Thread no longer available", { exact: true }))
        .toBeVisible();
    }
  },
);
