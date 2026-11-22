import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ScopedThreadRef,
} from "@supaterm/contracts";
import { useLayoutEffect } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { type ComposerImageAttachment, useComposerDraftStore } from "../../composerDraftStore";
import type { DraftId } from "../../draftId";
import { useSideChat } from "./useSideChat";

const harness = vi.hoisted(() => ({
  opened: [] as DraftId[],
  forks: [] as Array<() => void>,
}));
vi.mock(import("@supaterm/client-runtime/state/side-chats"), async (importOriginal) => ({
  ...(await importOriginal()),
  sendSideChatFirstMessage: (async (input: { enqueue: () => Promise<unknown> }) => {
    await new Promise<void>((resolve) => harness.forks.push(resolve));
    return { kind: "queued", value: await input.enqueue() };
  }) as never,
}));
vi.mock(import("../../chatPanes/actions"), async (importOriginal) => ({
  ...(await importOriginal()),
  openSideChatBeside: (target) => {
    if (target.kind === "draft") harness.opened.push(target.draftId);
    return true;
  },
}));
vi.mock(import("../../chatPanes/paneScope"), async (importOriginal) => ({
  ...(await importOriginal()),
  usePaneThreadNavigation: () => async () => {},
}));
vi.mock(import("../../state/threadOutbox"), async (importOriginal) => ({
  ...(await importOriginal()),
  enqueueThreadOutboxTurn: (async () => {}) as never,
}));

const environmentId = EnvironmentId.make("environment");
const parent = {
  environmentId,
  id: ThreadId.make("parent"),
  projectId: ProjectId.make("project"),
  branch: null,
  worktreePath: null,
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt" },
  runtimeMode: "full-access",
  interactionMode: "default",
} as const;
const parentRef: ScopedThreadRef = scopeThreadRef(environmentId, parent.id);

function setup() {
  harness.opened = [];
  harness.forks = [];
}

function image(id: string): ComposerImageAttachment {
  return {
    type: "image",
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    sizeBytes: 1,
    previewUrl: `blob:${id}`,
    file: new File([new Uint8Array([1])], `${id}.png`, { type: "image/png" }),
  };
}

function SideChatProbe(props: { onReady: (send: ReturnType<typeof useSideChat>["send"]) => void }) {
  const sideChat = useSideChat({
    parent,
    readSettings: () => ({ runtimeMode: undefined, modelSelection: undefined }),
    onError: () => {},
  });
  useLayoutEffect(() => {
    props.onReady(sideChat.send);
  });
  return null;
}

it("clears a side chat's first message from its composer but keeps what was added while it sent", async () => {
  setup();
  let send!: ReturnType<typeof useSideChat>["send"];
  await using _screen = await render(<SideChatProbe onReady={(value) => (send = value)} />);
  const store = () => useComposerDraftStore.getState();
  const start = async (attachment: ComposerImageAttachment) => {
    store().setPrompt(parentRef, "/side what is this?");
    store().addImage(parentRef, attachment);
    await act(() =>
      send("what is this?", {
        from: parentRef,
        text: "what is this?",
        context: undefined,
        titleSeed: "what is this?",
        attachments: [attachment],
      }),
    );
    return harness.opened.at(-1)!;
  };
  const finish = async (draftId: DraftId) => {
    await act(() => harness.forks.at(-1)!());
    await vi.waitFor(() => expect(store().getDraftThread(draftId)?.promotedTo).toBeTruthy());
  };

  const untouched = await start(image("first"));
  await finish(untouched);
  expect(store().getComposerDraft(untouched)?.images ?? []).toEqual([]);

  const settingsChanged = await start(image("mode"));
  store().setRuntimeMode(settingsChanged, "approval-required");
  await finish(settingsChanged);
  expect(store().getComposerDraft(settingsChanged)?.images ?? []).toEqual([]);

  const edited = await start(image("second"));
  store().addImage(edited, image("added"));
  await finish(edited);
  expect(
    store()
      .getComposerDraft(edited)
      ?.images.map((attachment) => attachment.id),
  ).toContain("added");
});
