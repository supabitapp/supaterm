// @effect-diagnostics nodeBuiltinImport:off - Names download files on the shared disk.
import {
  DesktopBrowserCommand,
  DesktopBrowserEvent,
  type DesktopBrowserEvent as DesktopBrowserEventType,
  type PreviewAutomationLoadError,
} from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { createCdpRelayConnection, type CdpRelayConnection } from "./CdpRelay.ts";
import { sendPageCommand } from "./GuestInput.ts";

const encodeEvent = Schema.encodeSync(Schema.fromJsonString(DesktopBrowserEvent));
const decodeCommand = Schema.decodeUnknownOption(Schema.fromJsonString(DesktopBrowserCommand));
const lineEncoder = new TextEncoder();

const AGENT_INPUT_COMMAND =
  /"method":"(?:Input\.|Page\.navigate"|Runtime\.(?:evaluate|callFunctionOn)")/;
const AGENT_INPUT_METHOD = /^(?:Input\.|Page\.navigate$|Runtime\.(?:evaluate|callFunctionOn)$)/;
const AGENT_INPUT_WINDOW_MS = 5_000;
const POINTER_TRAVEL = new Set<unknown>(["mouseMoved", "mouseWheel"]);
const FOCUS_IDLE = "5 seconds";
const CAPTURE_DRAW_WAIT = "1 second";
const FIRST_PAGE_TIMEOUT = "5 seconds";
const ERR_ABORTED = -3;

export interface DesktopBrowserTabKey {
  readonly threadId: string;
  readonly tabId: string;
}

export interface DesktopBrowserTabDebugger {
  readonly webContents: Electron.WebContents;
  readonly debugger: Electron.Debugger;
  /** Runs after the server clears the tab's cookies, so state kept beside them goes too. */
  readonly cookiesCleared?: () => Promise<void>;
}

const keyOf = ({ threadId, tabId }: DesktopBrowserTabKey) => `${threadId}\u0000${tabId}`;

interface AttachedTab {
  readonly key: DesktopBrowserTabKey;
  readonly debuggee: DesktopBrowserTabDebugger;
  relay: CdpRelayConnection | null;
  screenshotTurn: object | null;
  readonly waitingScreenshots: Array<{
    readonly start: () => void;
    readonly live: () => boolean;
    held: boolean;
  }>;
  downloadDirectory: string | null;
  pendingDownloadGuid: string | null;

  agentInputAt: number;
  agentLedAt: number;
  focusEmulated: boolean;
  focusChange: Promise<void> | null;
  focusUses: number;
  readonly focusPending: Map<object, string | undefined>;
  readonly capturing: Set<object>;
  painting: boolean;
  agentUsed: boolean;
  focusReleasing: boolean;
  readonly screencasts: Map<string | undefined, { started: boolean; pending: number }>;
  readonly onMessage: (
    event: Electron.Event,
    method: string,
    params: unknown,
    sessionId: string,
  ) => void;
  readonly onNewDocument: () => void;
  stopWaiting: (() => void) | null;
}

export class DesktopBrowserHost extends Context.Service<
  DesktopBrowserHost,
  {
    readonly events: Stream.Stream<Uint8Array>;
    readonly handleCommandLine: (line: string) => Effect.Effect<void>;
    readonly attach: (key: DesktopBrowserTabKey, debuggee: DesktopBrowserTabDebugger) => void;
    readonly detach: (key: DesktopBrowserTabKey) => void;
    readonly loadFailed: (key: DesktopBrowserTabKey, failure: PreviewAutomationLoadError) => void;
    readonly setShown: (key: DesktopBrowserTabKey, shown: boolean | undefined) => void;
    /** Whether the client draws the guest at full detail while it is captured. */
    readonly setCaptureDrawn: (key: DesktopBrowserTabKey, drawn: boolean | undefined) => void;
    readonly humanStartedDownload: (source: Electron.WebContents) => boolean;
    /** Whether what the page does now follows the agent's input, not a viewer's. */
    readonly agentLedPage: (source: Electron.WebContents) => boolean;
    readonly placeDownload: (source: Electron.WebContents, item: Electron.DownloadItem) => boolean;
    readonly pointers: Stream.Stream<{
      readonly key: DesktopBrowserTabKey;
      readonly phase: "move" | "click";
      readonly x: number;
      readonly y: number;
    }>;
    /** Whether a guest needs its frames painted while the panel hides it. */
    readonly painting: Stream.Stream<{
      readonly key: DesktopBrowserTabKey;
      readonly active: boolean;
    }>;
  }
>()("@supaterm/desktop/preview/DesktopBrowserHost") {}

export const make = Effect.gen(function* () {
  const outbox = yield* PubSub.unbounded<DesktopBrowserEventType>();
  const pointers = yield* PubSub.sliding<{
    readonly key: DesktopBrowserTabKey;
    readonly phase: "move" | "click";
    readonly x: number;
    readonly y: number;
  }>(16);
  const painting = yield* PubSub.unbounded<{
    readonly key: DesktopBrowserTabKey;
    readonly active: boolean;
  }>();
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const tabs = new Map<string, AttachedTab>();
  const agentTurns = new Set<string>();
  const shownTabs = new Map<string, boolean>();
  const drawnTabs = new Set<string>();
  const drawWaiters = new Map<string, Set<() => void>>();
  const emit = (event: DesktopBrowserEventType) => runFork(PubSub.publish(outbox, event));

  const nextScreenshot = (tab: AttachedTab) => {
    tab.screenshotTurn = null;
    tab.waitingScreenshots.shift()?.start();
    releaseFocusWhenIdle(tab);
    syncPainting(tab);
  };

  const takeScreenshot = (
    tab: AttachedTab,
    relay: CdpRelayConnection,
    ownerLive: () => boolean,
    capture: (current: () => boolean, held: boolean) => Promise<unknown>,
  ) =>
    new Promise<unknown>((resolve, reject) => {
      const live = () => tab.relay === relay && ownerLive();
      const waiting = {
        start: () => {
          if (!live()) {
            reject(new Error("The preview connection that asked for this screenshot closed."));
            nextScreenshot(tab);
            return;
          }
          const turn = {};
          tab.screenshotTurn = turn;
          capture(() => tab.screenshotTurn === turn && live(), waiting.held)
            .finally(() => {
              if (tab.screenshotTurn === turn) nextScreenshot(tab);
            })
            .then(resolve, reject);
        },
        live,
        held: true,
      };
      if (tab.screenshotTurn === null) waiting.start();
      else {
        tab.waitingScreenshots.push(waiting);
        setFocusEmulation(tab, true);
        syncPainting(tab);
      }
    });

  const setFocusEmulation = (tab: AttachedTab, enabled: boolean) => {
    if (tab.focusEmulated === enabled) return;
    tab.focusEmulated = enabled;
    const change: Promise<void> = tab.debuggee.debugger
      .sendCommand("Emulation.setFocusEmulationEnabled", { enabled })
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        if (tab.focusChange === change) tab.focusChange = null;
      });
    tab.focusChange = change;
  };

  const waitingHolds = (tab: AttachedTab) =>
    tab.waitingScreenshots.some((waiting) => waiting.held && waiting.live());

  const releaseFocusWhenIdle = (tab: AttachedTab) => {
    if (tab.focusReleasing) return;
    tab.focusReleasing = true;
    runFork(
      Effect.gen(function* () {
        let uses: number;
        do {
          uses = tab.focusUses;
          yield* Effect.sleep(FOCUS_IDLE);
        } while (uses !== tab.focusUses);
        tab.focusReleasing = false;
        if (tab.focusPending.size > 0 || tab.screencasts.size > 0 || waitingHolds(tab)) {
          return;
        }
        if (tab.agentUsed && agentTurns.has(tab.key.threadId)) return;
        tab.agentUsed = false;
        if (tabs.get(keyOf(tab.key)) === tab) setFocusEmulation(tab, false);
      }),
    );
  };

  const syncPainting = (tab: AttachedTab) => {
    const active =
      tabs.get(keyOf(tab.key)) === tab &&
      (tab.screencasts.size > 0 ||
        tab.capturing.size > 0 ||
        tab.waitingScreenshots.some((waiting) => waiting.live()));
    if (tab.painting === active) return;
    tab.painting = active;
    runFork(PubSub.publish(painting, { key: tab.key, active }));
  };

  const holdFocus = <A>(tab: AttachedTab, owner: string | undefined, work: () => Promise<A>) => {
    const pending = {};
    tab.focusPending.set(pending, owner);
    tab.focusUses += 1;
    setFocusEmulation(tab, true);
    releaseFocusWhenIdle(tab);
    return work().finally(() => {
      if (!tab.focusPending.delete(pending)) return;
      tab.focusUses += 1;
      releaseFocusWhenIdle(tab);
    });
  };

  const whenDrawn = (tab: AttachedTab) =>
    new Promise<void>((resolve) => {
      const id = keyOf(tab.key);
      const waiters = drawWaiters.get(id) ?? new Set();
      drawWaiters.set(id, waiters);
      const done = () => {
        waiters.delete(done);
        if (waiters.size === 0 && drawWaiters.get(id) === waiters) drawWaiters.delete(id);
        resolve();
      };
      waiters.add(done);
      runFork(Effect.sleep(CAPTURE_DRAW_WAIT).pipe(Effect.andThen(Effect.sync(done))));
    });

  const paintUntilAnswered = <A>(tab: AttachedTab, send: () => Promise<A>) => {
    const sent = {};
    tab.capturing.add(sent);
    syncPainting(tab);
    return (drawnTabs.has(keyOf(tab.key)) ? send() : whenDrawn(tab).then(send)).finally(() => {
      tab.capturing.delete(sent);
      syncPainting(tab);
    });
  };

  const dropFocusHolds = (tab: AttachedTab) => {
    tab.focusPending.clear();
    releaseFocusWhenIdle(tab);
    syncPainting(tab);
  };

  const dropRelay = (tab: AttachedTab) => {
    tab.relay = null;
    tab.screencasts.clear();
    tab.agentUsed = false;
    dropFocusHolds(tab);
  };

  const leaveScreencast = (tab: AttachedTab, owner: string | undefined) => {
    if (!tab.screencasts.delete(owner) || tab.screencasts.size > 0) return;
    void tab.debuggee.debugger.sendCommand("Page.stopScreencast").catch(() => {});
  };

  const dropSessionHolds = (tab: AttachedTab, owner: string) => {
    leaveScreencast(tab, owner);
    for (const [pending, holder] of tab.focusPending) {
      if (holder === owner) tab.focusPending.delete(pending);
    }
    releaseFocusWhenIdle(tab);
    syncPainting(tab);
  };

  const endAgentTurn = (threadId: string) => {
    agentTurns.delete(threadId);
    for (const tab of tabs.values()) {
      if (tab.key.threadId !== threadId) continue;
      tab.agentUsed = false;
      for (const waiting of tab.waitingScreenshots) waiting.held = false;
      dropFocusHolds(tab);
    }
  };

  const relayFor = (tab: AttachedTab) => {
    if (tab.relay) return tab.relay;
    const { webContents, debugger: debuggee, cookiesCleared } = tab.debuggee;
    const send = async (method: string, params: Record<string, unknown>, sessionId?: string) => {
      const result = await sendPageCommand(webContents, debuggee, method, params, sessionId);
      if (method === "Network.clearBrowserCookies") await cookiesCleared?.();
      return result;
    };
    const detachedOwners = new Set<string>();
    const streamingOwners = new Set<string>();
    const relay: CdpRelayConnection = createCdpRelayConnection(
      {
        send: (method, params, sessionId, owner) => {
          const stream =
            sessionId === undefined && method === "Page.startScreencast"
              ? (tab.screencasts.get(owner) ?? { started: false, pending: 0 })
              : undefined;
          if (stream) {
            stream.pending += 1;
            tab.screencasts.set(owner, stream);
            if (owner !== undefined) streamingOwners.add(owner);
            syncPainting(tab);
          } else if (sessionId === undefined && method === "Page.stopScreencast") {
            tab.screencasts.delete(owner);
            syncPainting(tab);
            if (tab.screencasts.size > 0) return Promise.resolve({});
          }
          if (AGENT_INPUT_METHOD.test(method)) {
            if (owner === undefined || !streamingOwners.has(owner)) {
              tab.agentUsed = true;
              tab.agentLedAt = performance.now();
            } else if (method.startsWith("Input.") && !POINTER_TRAVEL.has(params["type"])) {
              tab.agentLedAt = Number.NEGATIVE_INFINITY;
            }
          }
          const forward = (current?: () => boolean) => {
            const change = tab.focusChange;
            const stale = () => tab.relay !== relay || (current !== undefined && !current());
            const sendUnlessStale = () =>
              stale()
                ? Promise.reject(new Error("The page this screenshot was for has moved on."))
                : send(method, params, sessionId);
            const run = () =>
              current === undefined || stale()
                ? sendUnlessStale()
                : paintUntilAnswered(tab, sendUnlessStale);
            return change === null ? run() : change.then(run);
          };
          return method === "Page.captureScreenshot"
            ? takeScreenshot(
                tab,
                relay,
                () => owner === undefined || !detachedOwners.has(owner),
                (current, held) =>
                  held ? holdFocus(tab, owner, () => forward(current)) : forward(current),
              )
            : method === "Page.startScreencast"
              ? holdFocus(tab, owner, forward).then(
                  (result) => {
                    if (stream) {
                      stream.pending -= 1;
                      stream.started = true;
                      if (tab.screencasts.get(owner) !== stream && tab.screencasts.size === 0) {
                        void debuggee.sendCommand("Page.stopScreencast").catch(() => {});
                      }
                    }
                    return result;
                  },
                  (cause: unknown) => {
                    if (stream) stream.pending -= 1;
                    if (
                      stream &&
                      !stream.started &&
                      stream.pending === 0 &&
                      tab.relay === relay &&
                      tab.screencasts.get(owner) === stream
                    ) {
                      leaveScreencast(tab, owner);
                    }
                    releaseFocusWhenIdle(tab);
                    syncPainting(tab);
                    throw cause;
                  },
                )
              : holdFocus(tab, owner, forward);
        },
        sessionDetached: (owner) => {
          detachedOwners.add(owner);
          dropSessionHolds(tab, owner);
        },
        receivesScreencast: (owner) => tab.screencasts.has(owner),
        ackScreencastFrame: (frameId) =>
          void debuggee
            .sendCommand("Page.screencastFrameAck", { sessionId: frameId })
            .catch(() => {}),
        targetId: () =>
          debuggee
            .sendCommand("Target.getTargetInfo")
            .then((result: { targetInfo: { targetId: string } }) => result.targetInfo.targetId),
        url: () => webContents.getURL(),
        title: () => webContents.getTitle(),
        userAgent: () => webContents.getUserAgent(),
        setDownloadDirectory: (directory) => {
          tab.downloadDirectory = directory;
        },
      },
      (message) => {
        if (tab.relay === relay && tabs.get(keyOf(tab.key)) === tab) {
          emit({ type: "cdp", ...tab.key, message });
        }
      },
      () => {
        if (tab.relay !== relay || tabs.get(keyOf(tab.key)) !== tab) return;
        void debuggee
          .sendCommand("Target.setAutoAttach", {
            autoAttach: false,
            waitForDebuggerOnStart: false,
            flatten: true,
          })
          .catch(() => {});
        if (tab.screencasts.size > 0) {
          void debuggee.sendCommand("Page.stopScreencast").catch(() => {});
        }
        setFocusEmulation(tab, false);
        detach(tab.key);
      },
    );
    tab.relay = relay;
    return relay;
  };

  const placeDownload = (source: Electron.WebContents, item: Electron.DownloadItem) => {
    const tab = [...tabs.values()].find(
      (candidate) => candidate.debuggee.webContents === source && candidate.downloadDirectory,
    );
    if (!tab?.downloadDirectory || !tab.pendingDownloadGuid) return false;
    item.setSavePath(NodePath.join(tab.downloadDirectory, tab.pendingDownloadGuid));
    tab.pendingDownloadGuid = null;
    return true;
  };

  const detach = (key: DesktopBrowserTabKey) => {
    const id = keyOf(key);
    const tab = tabs.get(id);
    if (!tab) return;
    tabs.delete(id);
    const announced = tab.stopWaiting === null;
    tab.stopWaiting?.();
    tab.relay = null;
    tab.debuggee.debugger.off("message", tab.onMessage);
    tab.debuggee.webContents.off("did-navigate", tab.onNewDocument);
    syncPainting(tab);
    if (announced) emit({ type: "detached", ...key });
  };

  const attach = (key: DesktopBrowserTabKey, debuggee: DesktopBrowserTabDebugger) => {
    const id = keyOf(key);
    if (tabs.get(id)?.debuggee.webContents === debuggee.webContents) return;
    detach(key);
    const tab: AttachedTab = {
      key,
      debuggee,
      relay: null,
      screenshotTurn: null,
      waitingScreenshots: [],
      downloadDirectory: null,
      pendingDownloadGuid: null,
      agentInputAt: Number.NEGATIVE_INFINITY,
      agentLedAt: Number.NEGATIVE_INFINITY,
      focusEmulated: false,
      focusChange: null,
      focusUses: 0,
      focusPending: new Map(),
      capturing: new Set(),
      painting: false,
      agentUsed: false,
      focusReleasing: false,
      screencasts: new Map(),
      onMessage: (_event, method, params, sessionId) => {
        if (method === "Page.downloadWillBegin") {
          const guid = (params as { guid?: unknown } | undefined)?.guid;
          tab.pendingDownloadGuid = typeof guid === "string" ? guid : null;
        }
        tab.relay?.event(method, params, sessionId);
      },
      onNewDocument: () => {
        tab.capturing.clear();
        dropFocusHolds(tab);
        if (tab.screenshotTurn !== null) nextScreenshot(tab);
      },
      stopWaiting: null,
    };
    tabs.set(id, tab);
    debuggee.debugger.on("message", tab.onMessage);
    debuggee.webContents.on("did-navigate", tab.onNewDocument);
    const announce = () => {
      emit({ type: "attached", ...key });
      const shown = shownTabs.get(id);
      if (shown !== undefined) emit({ type: "shown", ...key, shown });
    };
    if (!debuggee.webContents.isLoadingMainFrame()) {
      announce();
      return;
    }
    const { webContents } = debuggee;
    const onFailLoad = (
      _event: Electron.Event,
      code: number,
      _description: string,
      _url: string,
      isMainFrame: boolean,
    ) => {
      if (isMainFrame && code !== ERR_ABORTED) ready();
    };
    const ready = () => {
      if (tab.stopWaiting === null) return;
      if (webContents.isDestroyed()) return detach(key);
      tab.stopWaiting();
      announce();
    };
    const timeout = runFork(
      Effect.sleep(FIRST_PAGE_TIMEOUT).pipe(Effect.andThen(Effect.sync(ready))),
    );
    tab.stopWaiting = () => {
      tab.stopWaiting = null;
      webContents.off("dom-ready", ready);
      webContents.off("did-stop-loading", ready);
      webContents.off("did-fail-load", onFailLoad);
      runFork(Fiber.interrupt(timeout));
    };
    webContents.on("dom-ready", ready);
    webContents.on("did-stop-loading", ready);
    webContents.on("did-fail-load", onFailLoad);
  };

  const setShown = (key: DesktopBrowserTabKey, shown: boolean | undefined) => {
    const id = keyOf(key);
    if (shown === undefined) {
      shownTabs.delete(id);
      return;
    }
    if (shownTabs.get(id) === shown) return;
    shownTabs.set(id, shown);
    if (tabs.get(id)?.stopWaiting === null) emit({ type: "shown", ...key, shown });
  };

  const setCaptureDrawn = (key: DesktopBrowserTabKey, drawn: boolean | undefined) => {
    const id = keyOf(key);
    if (!drawn) {
      drawnTabs.delete(id);
      return;
    }
    drawnTabs.add(id);
    for (const done of drawWaiters.get(id) ?? []) done();
    drawWaiters.delete(id);
  };

  const loadFailed: DesktopBrowserHost["Service"]["loadFailed"] = (key, failure) => {
    if (tabs.has(keyOf(key))) emit({ type: "loadFailed", ...key, ...failure });
  };

  const handleCommandLine = (line: string) =>
    Effect.sync(() => {
      const command = decodeCommand(line);
      if (Option.isNone(command)) return;
      if (command.value.type === "turn") {
        if (command.value.active) agentTurns.add(command.value.threadId);
        else endAgentTurn(command.value.threadId);
        return;
      }
      const tab = tabs.get(keyOf(command.value));
      if (!tab) return;
      if (command.value.type === "pointer") {
        const { threadId, tabId, phase, x, y } = command.value;
        runFork(PubSub.publish(pointers, { key: { threadId, tabId }, phase, x, y }));
        return;
      }
      if (command.value.type === "release") {
        dropRelay(tab);
        return;
      }
      if (AGENT_INPUT_COMMAND.test(command.value.message)) tab.agentInputAt = performance.now();
      relayFor(tab).receive(command.value.message);
    });

  const humanStartedDownload = (source: Electron.WebContents) => {
    const tab = [...tabs.values()].find((candidate) => candidate.debuggee.webContents === source);
    return tab !== undefined && performance.now() - tab.agentInputAt > AGENT_INPUT_WINDOW_MS;
  };

  const agentLedPage = (source: Electron.WebContents) => {
    const tab = [...tabs.values()].find((candidate) => candidate.debuggee.webContents === source);
    return tab !== undefined && performance.now() - tab.agentLedAt <= AGENT_INPUT_WINDOW_MS;
  };

  const announceAll = Effect.suspend(() => {
    agentTurns.clear();
    return Effect.forEach(
      [...tabs.values()],
      (tab) => {
        dropRelay(tab);
        if (tab.stopWaiting !== null) return Effect.void;
        const shown = shownTabs.get(keyOf(tab.key));
        return PubSub.publish(outbox, { type: "attached", ...tab.key }).pipe(
          Effect.andThen(
            shown !== undefined
              ? PubSub.publish(outbox, { type: "shown", ...tab.key, shown })
              : Effect.void,
          ),
        );
      },
      { discard: true },
    );
  });

  return DesktopBrowserHost.of({
    pointers: Stream.fromPubSub(pointers),
    painting: Stream.fromPubSub(painting),
    events: Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(outbox);
        yield* announceAll;
        return Stream.fromSubscription(subscription);
      }),
    ).pipe(Stream.map((event) => lineEncoder.encode(`${encodeEvent(event)}\n`))),
    handleCommandLine,
    attach,
    detach,
    loadFailed,
    setShown,
    setCaptureDrawn,
    placeDownload,
    humanStartedDownload,
    agentLedPage,
  });
});

export const layer = Layer.effect(DesktopBrowserHost, make);
