/**
 * Electron allows one debugger client per webContents, so the relay shares the
 * attach the preview manager already holds.
 */

export interface CdpRelayTarget {
  readonly send: (
    method: string,
    params: Record<string, unknown>,
    sessionId: string | undefined,
    owner?: string,
  ) => Promise<unknown>;
  readonly sessionDetached?: (owner: string) => void;
  /** Whether a page session, by owner as `send` names it, gets the page's screencast frames. */
  readonly receivesScreencast: (owner: string | undefined) => boolean;
  /** Acknowledges a native screencast frame, letting Chromium send the next one. */
  readonly ackScreencastFrame: (frameId: number) => void;
  /** The page's own CDP target id; Playwright keys the main frame by it. */
  readonly targetId: () => Promise<string>;
  readonly url: () => string;
  readonly title: () => string;
  readonly userAgent: () => string;
  /**
   * The desktop app and the server it launched share a disk, so the server's
   * Playwright reads the file where it asked for it.
   */
  readonly setDownloadDirectory: (directory: string | null) => void;
}

export interface CdpRelayConnection {
  readonly receive: (raw: string) => void;
  readonly event: (method: string, params: unknown, sessionId: string | undefined) => void;
}

interface CdpCommand {
  readonly id: number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
  readonly sessionId?: string;
}

const isCommand = (value: unknown): value is CdpCommand =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { id?: unknown }).id === "number" &&
  typeof (value as { method?: unknown }).method === "string";

const MAX_CDP_PAYLOAD_SIZE = 64 * 1024 * 1024;
const MAY_ESCAPE = /[^\x20\x21\x23-\x5b\x5d-\ud7ff\ue000-\uffff]/;
const serializedSize = (text: string) =>
  (MAY_ESCAPE.test(text) ? text.length * 6 : text.length) + 3;

const fitsPayloadBudget = (message: unknown) => {
  let remaining = MAX_CDP_PAYLOAD_SIZE;
  const visit = (value: unknown): boolean => {
    remaining -= typeof value === "string" ? serializedSize(value) : 26;
    if (remaining < 0) return false;
    if (typeof value !== "object" || value === null) return true;
    if (Array.isArray(value)) return value.every(visit);
    return Object.entries(value).every(([key, item]) => {
      remaining -= serializedSize(key);
      return visit(item);
    });
  };
  return visit(message);
};

const BROWSER_CONTEXT_ID = "supaterm-preview";
const ANNOUNCE = Symbol("announce");
const PAGE_SESSION_ID = "supaterm-preview-page";

const ACKNOWLEDGED = new Set([
  "Target.setDiscoverTargets",
  "Browser.grantPermissions",
  "Browser.resetPermissions",
  "Browser.cancelDownload",
]);

export function createCdpRelayConnection(
  target: CdpRelayTarget,
  write: (message: string) => void,
  close: () => void,
): CdpRelayConnection {
  let closed = false;
  const send = (message: Record<string, unknown>) => {
    if (closed) return;
    if (fitsPayloadBudget(message)) {
      write(JSON.stringify(message));
      return;
    }
    if (typeof message["id"] === "number") {
      write(
        JSON.stringify({
          id: message["id"],
          error: { code: -32000, message: "CDP payload too large" },
          ...(message["sessionId"] === undefined ? {} : { sessionId: message["sessionId"] }),
        }),
      );
      return;
    }
    closed = true;
    close();
  };
  let attached = false;
  let downloadEventsEnabled = false;
  const sessions = new Map<string, "browser" | "page">([[PAGE_SESSION_ID, "page"]]);
  const unackedFrames = new Map<string, number>();
  const skippedFrames = new Map<string, Record<string, unknown>>();
  const heldNativeFrames: Array<number> = [];
  const releaseHeldFramesWithoutHolders = () => {
    if (skippedFrames.size === 0)
      for (const frameId of heldNativeFrames.splice(0)) target.ackScreencastFrame(frameId);
  };
  const sendFrame = (sessionId: string, params: Record<string, unknown>) => {
    unackedFrames.set(sessionId, params["sessionId"] as number);
    send({ method: "Page.screencastFrame", params, sessionId });
  };
  let sessionSequence = 0;
  const newSession = (kind: "browser" | "page") => {
    const sessionId = `supaterm-preview-${kind}-${++sessionSequence}`;
    sessions.set(sessionId, kind);
    return sessionId;
  };
  const targetInfo = async () => ({
    targetId: await target.targetId(),
    type: "page",
    title: target.title(),
    url: target.url(),
    attached: true,
    canAccessOpener: false,
    browserContextId: BROWSER_CONTEXT_ID,
  });

  const browserCommand = async (command: CdpCommand): Promise<unknown> => {
    if (ACKNOWLEDGED.has(command.method)) return {};
    switch (command.method) {
      case "Browser.setDownloadBehavior": {
        const directory = command.params?.["downloadPath"];
        const allowed = command.params?.["behavior"] !== "deny" && typeof directory === "string";
        const result = await target.send(
          "Page.setDownloadBehavior",
          { behavior: command.params?.["behavior"] === "deny" ? "deny" : "default" },
          undefined,
        );
        target.setDownloadDirectory(allowed ? directory : null);
        downloadEventsEnabled = command.params?.["eventsEnabled"] === true;
        return result;
      }
      case "Browser.getVersion":
        return {
          protocolVersion: "1.3",
          product: "Electron",
          revision: "",
          userAgent: target.userAgent(),
          jsVersion: "",
        };
      case "Target.getTargetInfo":
        return {
          targetInfo: {
            targetId: "browser",
            type: "browser",
            title: "",
            url: "",
            attached: true,
            canAccessOpener: false,
          },
        };
      case "Target.getBrowserContexts":
        return { browserContextIds: [] };
      case "Target.getTargets":
        return { targetInfos: [await targetInfo()] };
      case "Target.attachToBrowserTarget":
        return { sessionId: newSession("browser") };
      case "Target.attachToTarget": {
        const targetId = command.params?.["targetId"];
        if (targetId !== (await target.targetId()))
          throw new Error("Only this preview tab's page can be attached.");
        return { sessionId: newSession("page") };
      }
      case "Target.detachFromTarget": {
        const sessionId = command.params?.["sessionId"];
        if (typeof sessionId === "string" && sessionId !== PAGE_SESSION_ID) {
          sessions.delete(sessionId);
          unackedFrames.delete(sessionId);
          skippedFrames.delete(sessionId);
          releaseHeldFramesWithoutHolders();
          target.sessionDetached?.(sessionId);
        }
        return {};
      }
      case "Target.setAutoAttach": {
        if (attached) return {};
        attached = true;
        const info = await targetInfo();
        return {
          [ANNOUNCE]: {
            method: "Target.attachedToTarget",
            params: { sessionId: PAGE_SESSION_ID, targetInfo: info, waitingForDebugger: false },
          },
        };
      }
      default:
        throw new Error(`Not supported for a desktop preview tab: ${command.method}`);
    }
  };

  let runtimeReset: Promise<unknown> | undefined;

  const pageCommand = (command: CdpCommand): Promise<unknown> => {
    const child = sessions.get(command.sessionId!) === "page" ? undefined : command.sessionId;
    const owner =
      child === undefined && command.sessionId !== PAGE_SESSION_ID ? command.sessionId : undefined;
    if (command.method === "Runtime.runIfWaitingForDebugger" && child === undefined) {
      return Promise.resolve({});
    }
    if (command.method === "Emulation.setFocusEmulationEnabled") return Promise.resolve({});
    if (command.method === "Page.screencastFrameAck" && child === undefined) {
      const sessionId = command.sessionId!;
      if (unackedFrames.get(sessionId) === command.params?.["sessionId"]) {
        unackedFrames.delete(sessionId);
        const skipped = skippedFrames.get(sessionId);
        skippedFrames.delete(sessionId);
        if (
          skipped !== undefined &&
          target.receivesScreencast(sessionId === PAGE_SESSION_ID ? undefined : sessionId)
        )
          sendFrame(sessionId, skipped);
        const released = heldNativeFrames.shift();
        if (released !== undefined) target.ackScreencastFrame(released);
      }
      return Promise.resolve({});
    }
    if (command.method === "Page.stopScreencast" && child === undefined) {
      skippedFrames.delete(command.sessionId!);
      releaseHeldFramesWithoutHolders();
    }
    if (command.method === "Runtime.enable" && child === undefined) {
      runtimeReset ??= target.send("Runtime.disable", {}, undefined, owner).catch(() => undefined);
      return runtimeReset.then(() =>
        target.send(command.method, command.params ?? {}, undefined, owner),
      );
    }
    return target.send(command.method, command.params ?? {}, child, owner);
  };

  return {
    receive: (raw) => {
      if (closed) return;
      let command: unknown;
      try {
        command = JSON.parse(raw);
      } catch {
        return;
      }
      if (!isCommand(command)) return;
      const result =
        command.sessionId === undefined || sessions.get(command.sessionId) === "browser"
          ? browserCommand(command)
          : pageCommand(command);
      const route = command.sessionId === undefined ? {} : { sessionId: command.sessionId };
      void result.then(
        (value) => {
          const announce =
            typeof value === "object" && value !== null && ANNOUNCE in value
              ? (value as { [ANNOUNCE]: Record<string, unknown> })[ANNOUNCE]
              : undefined;
          send({ id: command.id, result: announce ? {} : (value ?? {}), ...route });
          if (announce) send(announce);
        },
        (cause: unknown) =>
          send({
            id: command.id,
            error: {
              code: -32000,
              message: cause instanceof Error ? cause.message : String(cause),
            },
            ...route,
          }),
      );
    },
    event: (method, params, sessionId) => {
      if (!attached) return;
      if (method.startsWith("Page.download")) method = method.replace("Page.", "Browser.");
      if (method.startsWith("Browser.download")) {
        if (downloadEventsEnabled) send({ method, params });
        return;
      }
      if (sessionId) {
        send({ method, params, sessionId });
        return;
      }
      if (method === "Page.screencastFrame") {
        const frame = (params ?? {}) as Record<string, unknown>;
        const frameId = frame["sessionId"];
        if (typeof frameId !== "number") return;
        let held = false;
        let delivered = false;
        for (const [id, kind] of sessions) {
          if (kind !== "page") continue;
          if (!target.receivesScreencast(id === PAGE_SESSION_ID ? undefined : id)) continue;
          if (unackedFrames.has(id)) {
            skippedFrames.set(id, frame);
            held = true;
          } else {
            sendFrame(id, frame);
            delivered = true;
          }
        }
        if (held && !delivered) heldNativeFrames.push(frameId);
        else target.ackScreencastFrame(frameId);
        return;
      }
      for (const [id, kind] of sessions)
        if (kind === "page") send({ method, params, sessionId: id });
    },
  };
}
