import { scopeProjectRef, scopeThreadRef } from "@supaterm/client-runtime/environment";
import { type DesktopBridge, EnvironmentId, ProjectId, ThreadId } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  DraftId,
  hydrateImagesFromPersisted,
  useComposerDraftStore,
} from "../../composerDraftStore";
import {
  questionAttachmentDraftId,
  trackOpenQuestionAttachmentDraft,
} from "../../questionAttachments";
import {
  beginSnapShotAnimationWhenReady,
  deliverSnapShot,
  dismissFailedSnapShot,
  resolveExistingSnapShotTarget,
  resolveSnapShotAttachmentTarget,
  resolveSnapShotDeliveryTarget,
} from "./SnapShotCoordinator";
import {
  beginSnapShotAnimation,
  dismissAllSnapShotAnimations,
  getPendingSnapShotAnimations,
  scheduleSnapShotAnimationDestination,
} from "../../lib/snapShotAnimation";

vi.mock(import("../../hooks/useSettings"), { spy: true });
vi.mock(import("../../hooks/useHandleNewThread"), { spy: true });
vi.mock(import("../../lib/snapShotSound"), { spy: true });
vi.mock(import("../../lib/imageCompression"), { spy: true });

const { fake } = vi.hoisted(() => ({
  fake: <
    F extends (...args: never[]) => unknown = { call(...args: Array<unknown>): unknown }["call"],
  >(
    initial?: F,
  ) => {
    const script = { queue: [] as Array<F>, fallback: initial };
    const target = {
      call: (...args: Parameters<F>) =>
        (script.queue.shift() ?? script.fallback)?.(...args) as ReturnType<F>,
    };
    const spy = vi.spyOn(target, "call");
    const scripted = Object.assign(spy, {
      implement: (next: F) => {
        script.fallback = next;
        return scripted;
      },
      implementOnce: (next: F) => {
        script.queue.push(next);
        return scripted;
      },
      reset: (next?: F) => {
        script.queue = [];
        script.fallback = next ?? initial;
        spy.mockClear();
        return scripted;
      },
    });
    return scripted;
  },
}));
const storage = vi.hoisted(() => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    write: (key: string, value: string) => {
      values.set(key, value);
    },
    setItem: fake((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
  vi.stubGlobal("localStorage", storage);
  return storage;
});

const environmentId = EnvironmentId.make("snap-shot-environment");
const projectRef = scopeProjectRef(environmentId, ProjectId.make("snap-shot-project"));

function setup(): Disposable {
  storage.clear();
  vi.stubGlobal("localStorage", storage);
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
  return {
    [Symbol.dispose]() {
      dismissAllSnapShotAnimations();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    },
  };
}

describe("window capture failures", () => {
  it("does not resurrect a failed capture when its draft becomes ready later", async () => {
    using _env = setup();
    const target = DraftId.make("snap-shot-draft");
    let resolveTarget: ((target: DraftId) => void) | undefined;
    const targetReady = new Promise<DraftId>((resolve) => {
      resolveTarget = resolve;
    });
    const pendingStarts = new Set<string>();
    const soundedIds = new Set(["older", "newer"]);
    const olderStart = beginSnapShotAnimationWhenReady("older", targetReady, pendingStarts);
    await beginSnapShotAnimationWhenReady("newer", Promise.resolve(target), pendingStarts);

    dismissFailedSnapShot("older", soundedIds, pendingStarts);
    resolveTarget?.(target);
    await olderStart;

    expect(getPendingSnapShotAnimations().map(({ id }) => id)).toEqual(["newer"]);
    expect(soundedIds).toEqual(new Set(["newer"]));
    expect(pendingStarts.size).toBe(0);
  });
});

describe("window capture target resolution", () => {
  it("follows a draft to its promoted server thread", () => {
    using _env = setup();
    const draftId = DraftId.make("snap-shot-draft");
    const promotedRef = scopeThreadRef(environmentId, ThreadId.make("snap-shot-promoted-thread"));
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, {
      threadId: ThreadId.make("snap-shot-draft-thread"),
    });
    store.markDraftThreadPromoting(draftId, promotedRef);

    expect(resolveExistingSnapShotTarget(draftId, null)).toEqual(promotedRef);
  });
});

describe("open question delivery", () => {
  const threadRef = scopeThreadRef(environmentId, ThreadId.make("question-thread"));
  const first = questionAttachmentDraftId(environmentId, threadRef.threadId, "request-1", "q1");
  const second = questionAttachmentDraftId(environmentId, threadRef.threadId, "request-1", "q2");
  const request = { draftId: first, requestKeys: [first, second] };
  const capture = {
    id: "12345678-1234-1234-1234-123456789abc",
    name: "window.png",
    mimeType: "image/png" as const,
    sizeBytes: 3,
    dataUrl: "data:image/png;base64,AQID",
    source: {
      kind: "snap-shot" as const,
      capturedAt: "2026-09-01T00:00:00.000Z",
      appName: "Editor",
      windowTitle: "main.ts",
    },
  };
  const makeBridge = (readSnapShot: () => Promise<typeof capture> = async () => capture) => {
    const acknowledgeSnapShot = vi.fn(async () => undefined);
    const bridge = { readSnapShot, acknowledgeSnapShot } as unknown as DesktopBridge;
    return { bridge, acknowledgeSnapShot };
  };

  it("attaches a capture to the open question draft and leaves the thread draft alone", async () => {
    using _env = setup();
    const pins = new Map();
    const untrack = trackOpenQuestionAttachmentDraft(threadRef, request);
    try {
      const { bridge, acknowledgeSnapShot } = makeBridge();
      await deliverSnapShot(bridge, capture, () =>
        resolveSnapShotAttachmentTarget(pins, capture.id, threadRef),
      );
      const store = useComposerDraftStore.getState();
      expect(store.getComposerDraft(first)?.images.map(({ id }) => id)).toEqual([capture.id]);
      expect(store.getComposerDraft(threadRef)?.images ?? []).toHaveLength(0);
      expect(acknowledgeSnapShot).toHaveBeenCalledExactlyOnceWith(capture.id);
      const repeat = hydrateImagesFromPersisted([{ ...capture, id: "repeat" }]);
      expect(store.addImages(first, repeat)).toEqual([]);
      expect(store.getComposerDraft(first)?.images.map(({ id }) => id)).toEqual([capture.id]);
    } finally {
      untrack();
    }
  });

  it("falls back to the thread when a newer question replaces the pinned one during compression", async () => {
    using _env = setup();
    const pins = new Map();
    const untrackFirst = trackOpenQuestionAttachmentDraft(threadRef, request);
    let untrackSecond = () => {};
    const compressImage = async (file: File) => {
      untrackSecond = trackOpenQuestionAttachmentDraft(threadRef, {
        ...request,
        draftId: second,
      });
      untrackFirst();
      return { ok: true as const, file, recompressed: false };
    };
    try {
      const { bridge, acknowledgeSnapShot } = makeBridge();
      const resolveTarget = () => resolveSnapShotAttachmentTarget(pins, capture.id, threadRef);
      expect(resolveTarget()).toBe(first);
      await deliverSnapShot(bridge, capture, resolveTarget, compressImage);
      const store = useComposerDraftStore.getState();
      expect(store.getComposerDraft(first)?.images ?? []).toHaveLength(0);
      expect(store.getComposerDraft(second)?.images ?? []).toHaveLength(0);
      expect(store.getComposerDraft(threadRef)?.images.map(({ id }) => id)).toEqual([capture.id]);
      expect(acknowledgeSnapShot).toHaveBeenCalledExactlyOnceWith(capture.id);
    } finally {
      untrackFirst();
      untrackSecond();
    }
  });

  it("keeps a capture pinned before any question off a question that opens during the read", async () => {
    using _env = setup();
    const pins = new Map();
    const resolveTarget = () => resolveSnapShotAttachmentTarget(pins, capture.id, threadRef);
    expect(resolveTarget()).toEqual(threadRef);
    let untrack = () => {};
    const { bridge, acknowledgeSnapShot } = makeBridge(async () => {
      untrack = trackOpenQuestionAttachmentDraft(threadRef, request);
      return capture;
    });
    try {
      await deliverSnapShot(bridge, capture, resolveTarget);
      const store = useComposerDraftStore.getState();
      expect(store.getComposerDraft(first)?.images ?? []).toHaveLength(0);
      expect(store.getComposerDraft(threadRef)?.images.map(({ id }) => id)).toEqual([capture.id]);
      expect(acknowledgeSnapShot).toHaveBeenCalledExactlyOnceWith(capture.id);
    } finally {
      untrack();
    }
  });
});

describe("durable snapshot delivery", () => {
  it.each([false, true])(
    "retains a capture on quota failure and retries without duplicates (staged: %s)",
    async (staged) => {
      using _env = setup();
      const target = scopeThreadRef(environmentId, ThreadId.make("quota-thread"));
      const capture = {
        id: "12345678-1234-1234-1234-123456789abc",
        name: "window.png",
        mimeType: "image/png" as const,
        sizeBytes: 3,
        dataUrl: "data:image/png;base64,AQID",
        source: {
          kind: "snap-shot" as const,
          capturedAt: "2026-09-01T00:00:00.000Z",
          appName: "Editor",
          windowTitle: "main.ts",
        },
      };
      const acknowledgeSnapShot = vi.fn(async () => undefined);
      const bridge = {
        readSnapShot: async () => capture,
        acknowledgeSnapShot,
      } as unknown as DesktopBridge;
      const write = storage.write;
      storage.setItem.implement(() => {
        throw new Error("QuotaExceededError");
      });
      try {
        if (staged) {
          const store = useComposerDraftStore.getState();
          store.addImage(target, {
            type: "image",
            ...capture,
            previewUrl: capture.dataUrl,
            file: new File([new Uint8Array([1, 2, 3])], capture.name, { type: capture.mimeType }),
          });
          void store.syncPersistedAttachments(target, [capture]);
        }
        await expect(deliverSnapShot(bridge, capture, () => target)).rejects.toThrow(
          "could not be saved",
        );
        expect(acknowledgeSnapShot).not.toHaveBeenCalled();
        expect(
          useComposerDraftStore.getState().getComposerDraft(target)?.nonPersistedImageIds,
        ).toContain(capture.id);
        storage.setItem.implement(write);
        await deliverSnapShot(bridge, capture, () => target);
        expect(acknowledgeSnapShot).toHaveBeenCalledExactlyOnceWith(capture.id);
        expect(useComposerDraftStore.getState().getComposerDraft(target)?.images).toHaveLength(1);
        expect(
          useComposerDraftStore.getState().getComposerDraft(target)?.persistedAttachments,
        ).toHaveLength(1);
      } finally {
        storage.setItem.implement(write);
      }
    },
  );
});

describe("snapshot destination ownership", () => {
  it.each(["unmount", "blur", "disabled animations"])(
    "keeps the original environment and thread after %s",
    async (reason) => {
      using _env = setup();
      const original = scopeThreadRef(environmentId, ThreadId.make("original"));
      const next = scopeThreadRef(EnvironmentId.make("another-environment"), ThreadId.make("next"));
      const targets = new Map<string, Promise<typeof original | null>>();
      let current = original;
      const resolveTarget = async () => current;
      const requested = resolveSnapShotDeliveryTarget(targets, "capture", resolveTarget);
      if (reason !== "disabled animations") {
        beginSnapShotAnimation("capture", original);
        if (reason === "unmount") {
          const unmount = scheduleSnapShotAnimationDestination("capture", () => undefined);
          unmount();
        } else dismissAllSnapShotAnimations();
      }
      current = next;
      await requested;
      expect(getPendingSnapShotAnimations()).toHaveLength(0);
      expect(await resolveSnapShotDeliveryTarget(targets, "capture", resolveTarget)).toEqual(
        original,
      );
      expect(await resolveSnapShotDeliveryTarget(targets, "later-capture", resolveTarget)).toEqual(
        next,
      );
    },
  );
});
