// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off - Playwright callbacks run outside the Effect runtime.

import {
  type BrowserRecordingFrameRate,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  type PreviewAutomationClickInput,
  type PreviewAutomationConsoleEntry,
  type PreviewAutomationDragInput,
  type PreviewAutomationEvaluateInput,
  type PreviewAutomationHoverInput,
  type PreviewAutomationNetworkEntry,
  type PreviewAutomationPressInput,
  type PreviewAutomationScrollInput,
  type PreviewAutomationSelectInput,
  type PreviewAutomationSelectResult,
  type PreviewAutomationSnapshot,
  type PreviewAutomationSnapshotMetadata,
  type PreviewAutomationSnapshotStage,
  type PreviewAutomationTypeInput,
  type PreviewAutomationUploadInput,
  type PreviewAutomationWaitForInput,
} from "@supaterm/contracts";
import { constVoid } from "effect/Function";
import { MousePointer, MousePointerFilled } from "@supaterm/icons/nodes";
import type { CDPSession, ConsoleMessage, Frame, Locator, Page } from "playwright-core";
import * as NodeCrypto from "node:crypto";
import * as NodeUtil from "node:util";
import { BrowserControlInterrupted } from "./SessionControl.ts";

const MAX_EVALUATION_BYTES = 64_000;
const MAX_VISIBLE_TEXT_LENGTH = 20_000;
const MAX_SCREENSHOT_WIDTH = 1280;
const SCREENSHOT_TIMEOUT_MS = 3_000;
const WAIT_POLL_MS = 100;
export const DIAGNOSTIC_BUFFER_LIMIT = 200;

export class ServerBrowserOperationError extends Error {
  readonly tag: string;
  readonly detail: unknown;

  constructor(tag: string, message: string, detail?: unknown, options?: ErrorOptions) {
    super(message, options);
    this.tag = tag;
    this.detail = detail;
  }
}

export const toOperationError = (
  cause: unknown,
  timeoutMs?: number,
): ServerBrowserOperationError => {
  if (cause instanceof BrowserControlInterrupted)
    return new ServerBrowserOperationError(
      "PreviewAutomationControlInterruptedError",
      cause.message,
      cause.reason,
    );
  if (cause instanceof ServerBrowserOperationError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  const firstLine = message.split("\n")[0] ?? message;
  if (cause instanceof Error && cause.name === "TimeoutError") {
    return new ServerBrowserOperationError(
      "PreviewAutomationTimeoutError",
      withActionabilityReason(firstLine, cause),
      timeoutMs === undefined ? undefined : { timeoutMs },
    );
  }
  if (/while parsing selector|Unknown engine|Unexpected token/i.test(message)) {
    return new ServerBrowserOperationError("PreviewAutomationInvalidSelectorError", firstLine);
  }
  if (/not an <input>|not editable|not an editable/i.test(message)) {
    return new ServerBrowserOperationError("PreviewAutomationTargetNotEditableError", firstLine);
  }
  return new ServerBrowserOperationError("PreviewAutomationExecutionError", firstLine);
};

const withActionabilityReason = (message: string, cause: Error) => {
  const reason = NodeUtil.stripVTControlCharacters(cause.message)
    .split("\n")
    .map((line) => line.trim())
    .findLast((line) => line.startsWith("- element is "))
    ?.slice(2);
  return reason === undefined ? message : `${message} Playwright last saw: ${reason}.`;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const TARGET_COUNT_MS = 250;
const MAX_TARGET_CHARS = 200;

const pageRefs = new WeakMap<Page, { generation: string; refs: Map<string, string> }>();
const refNamespace = NodeCrypto.randomUUID().slice(0, 8);
let snapshotSequence = 0;
const nextRefGeneration = () => `${refNamespace}-${(++snapshotSequence).toString(36)}`;

/** A takeover revokes previously issued refs even when the document stays unchanged. */
export const invalidateRefs = (page: Page) => {
  const state = pageRefs.get(page);
  if (state) {
    state.generation = nextRefGeneration();
    state.refs.clear();
  }
};

const refsFor = (page: Page) => {
  let state = pageRefs.get(page);
  if (!state) {
    state = { generation: nextRefGeneration(), refs: new Map<string, string>() };
    pageRefs.set(page, state);
    page.on("framenavigated", () => invalidateRefs(page));
    page.on("framedetached", () => invalidateRefs(page));
  }
  return state;
};

const targetLocator = (
  page: Page,
  input: { readonly locator?: string | undefined; readonly selector?: string | undefined },
): Locator | null => {
  const selector = input.locator ?? input.selector;
  if (selector === undefined) return null;
  const engines = selector.replace(
    /\\.|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,
    " ",
  );
  if (/(?:^|>>)\s*\*?aria-ref\s*=/.test(engines)) {
    const ref = /^\s*aria-ref\s*=\s*(\S+)\s*$/.exec(selector)?.[1];
    const nativeRef = ref === undefined ? undefined : pageRefs.get(page)?.refs.get(ref);
    if (nativeRef === undefined) {
      throw new ServerBrowserOperationError(
        "PreviewAutomationInvalidSelectorError",
        "This element ref is stale or belongs to another tab. Take a fresh snapshot and use its locator.",
        { staleRef: true },
      );
    }
    return page.locator(`aria-ref=${nativeRef}`);
  }
  return page.locator(selector);
};

export type PointerReporter = (
  point: { readonly x: number; readonly y: number },
  phase: "move" | "click",
) => Promise<void>;
const noPointer: PointerReporter = async () => {};

const DETACHED = /^locator\.scrollIntoViewIfNeeded: Element is not attached to the DOM(?:\n|$)/;

const scrollIntoView = async (locator: Locator, timeout: number) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      return await locator.scrollIntoViewIfNeeded({ timeout: Math.max(1, deadline - Date.now()) });
    } catch (cause) {
      if (!(cause instanceof Error && DETACHED.test(cause.message)) || Date.now() >= deadline) {
        throw cause;
      }
    }
  }
};

const targetPoint = async (
  page: Page,
  locator: Locator | null,
  input: { readonly x?: number | undefined; readonly y?: number | undefined },
  timeout: () => number,
) => {
  if (locator === null) return { x: input.x ?? 0, y: input.y ?? 0 };
  await scrollIntoView(locator, timeout());
  const box = await locator.boundingBox({ timeout: timeout() });
  if (box) return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const viewport = page.viewportSize();
  return { x: (viewport?.width ?? 0) / 2, y: (viewport?.height ?? 0) / 2 };
};

const SNAPSHOT_SCRIPT = `(() => {
  return {
    url: location.href,
    title: document.title,
    loading: document.readyState !== "complete",
    visibleText: document.body?.innerText || "",
    interactiveElements: [],
  };
})()`;

const MASKED_VALUE = "••••••••";

/**
 * A `data:` URL carries its content, which can be a whole file, and URLs and diagnostics
 * reach tool results and provider logs. Keeps only the media type: the payload can hold any
 * character and parameters are page-chosen too.
 */
export const withoutDataPayload = (url: string) => {
  const value = url
    .replace(/^["']/, "")
    .replace(/\\(x[\da-f]{2}|u[\da-f]{4}|.)/gi, (_escape, code: string) =>
      code.length > 1
        ? String.fromCharCode(Number.parseInt(code.slice(1), 16))
        : ({ t: "\t", n: "\n", r: "\r", '"': '"', "\\": "\\" }[code] ?? "\u0001"),
    )
    .replace(/[\t\n\r]/g, "")
    .replace(/^[\u0000-\u0020]+/, "");
  const parsed = /^data:([^,;]*)/i.exec(value);
  if (!parsed) return url;
  const type = parsed[1]!.trim();
  const mediaType = /^[\w.+-]{1,64}\/[\w.+-]{1,64}$/.test(type) ? type : "";
  return `data:${mediaType},…`;
};

/**
 * Chromium's own console messages, which carry no arguments, quote `data:` URLs whole, as in a
 * blocked navigation or a CSP violation. Everything after the first one goes, since Chromium
 * accepts any type and a payload can hold any character. What a page logs itself is its own
 * text, like anything else it shows, so it stays.
 */
export const consoleText = (message: ConsoleMessage) =>
  message.args().length > 0
    ? message.text()
    : message.text().replace(/(?<![a-z\d])data:[^,;]*[,;][\s\S]*/i, withoutDataPayload);

const withoutTreeDataPayloads = (tree: string) =>
  tree
    .split("\n")
    .map((line) => {
      const url = /^(\s*- \/url: )(.*)$/s.exec(line);
      return url ? url[1] + withoutDataPayload(url[2]!) : line;
    })
    .join("\n");

const SNAPSHOT_TIMEOUT_MS = 10_000;
const FRAME_ANSWER_MS = 1_000;

const DOTTED_SCRIPT = `(() => {
  const values = [];
  const visit = (root) => {
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) visit(element.shadowRoot);
      const field = element.localName === "input" || element.localName === "textarea";
      if (!field && !element.isContentEditable) continue;
      const dots = getComputedStyle(element).getPropertyValue("-webkit-text-security");
      if (element.type !== "password" && (dots === "none" || dots === "")) continue;
      // Raw as page text shows it, and normalized as the tree does.
      for (const value of field ? [element.value, element.defaultValue] : [element.textContent ?? ""])
        values.push(value, value.replace(/[\\u200b\\u00ad]/g, "").trim().replace(/\\s+/g, " "));
    }
  };
  visit(document);
  return [...new Set(values.filter((value) => value.trim()))];
})()`;

const pageChanged = () =>
  new ServerBrowserOperationError(
    "PreviewAutomationExecutionError",
    "The page changed while capturing its snapshot. Take another snapshot.",
  );

type SnapshotStage = typeof PreviewAutomationSnapshotStage.Type;

interface SnapshotStages {
  readonly running: Map<SnapshotStage, number>;
  readonly timedOut: Set<SnapshotStage>;
}

const snapshotTimedOut = (stages?: SnapshotStages) =>
  new ServerBrowserOperationError(
    "PreviewAutomationTimeoutError",
    `Snapshot capture timed out after ${SNAPSHOT_TIMEOUT_MS}ms. Try the snapshot again.`,
    {
      timeoutMs: SNAPSHOT_TIMEOUT_MS,
      pendingStages: stages ? [...new Set([...stages.timedOut, ...stages.running.keys()])] : [],
    },
  );

const frameUnanswered = () =>
  new ServerBrowserOperationError(
    "PreviewAutomationTimeoutError",
    `A frame on the page didn't answer within ${FRAME_ANSWER_MS}ms, so its content couldn't be checked for hidden values. Try the snapshot again.`,
    { timeoutMs: FRAME_ANSWER_MS, pendingStages: ["frames"] },
  );

const isTimeout = (cause: unknown) => cause instanceof Error && cause.name === "TimeoutError";

const VALUE_TOO_LONG = "A password field holds a value too long to hide, so no snapshot was taken.";

const frameSessions = new WeakMap<Frame, Promise<CDPSession>>();

const answered = <A>(promise: Promise<A>) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), FRAME_ANSWER_MS);
  });
  return Promise.race([promise.catch(() => undefined), late]).finally(() => clearTimeout(timer));
};

const openReaders = async (page: Page, cdp: CDPSession) => {
  const frames = page.frames();
  const owners = new Map<Frame, CDPSession | null | undefined>(
    await Promise.all(
      frames.map(async (frame) => {
        if (frame === page.mainFrame()) return [frame, cdp] as const;
        const session = frameSessions.get(frame) ?? page.context().newCDPSession(frame);
        frameSessions.set(frame, session);
        try {
          return [frame, await session] as const;
        } catch (cause) {
          frameSessions.delete(frame);
          const desktop = String(cause).includes("Only this preview tab's page can be attached");
          return [frame, desktop ? null : undefined] as const;
        }
      }),
    ),
  );
  const ownerOf = (frame: Frame): CDPSession | null => {
    const owner = owners.get(frame);
    if (owner !== undefined) return owner;
    const parent = frame.parentFrame();
    return parent ? ownerOf(parent) : null;
  };
  const sessionReader = (frame: Frame, session: CDPSession) => {
    const owned = frames.filter((each) => ownerOf(each) === session);
    const open = async () => {
      const { frameTree } = await session.send("Page.getFrameTree");
      const ids = (node: typeof frameTree): Array<string> => [
        node.frame.id,
        ...(node.childFrames ?? []).flatMap(ids),
      ];
      if (ids(frameTree).length !== owned.length) throw pageChanged();
      return Promise.all(
        ids(frameTree).map(async (frameId) => {
          const world = await session.send("Page.createIsolatedWorld", {
            frameId,
            worldName: "supaterm-preview",
          });
          return world.executionContextId;
        }),
      );
    };
    let contexts: ReturnType<typeof open> | undefined;
    const read = async () => {
      const values = (contexts ??= open()).then((ids) =>
        Promise.all(
          ids.map(async (contextId) => {
            const { result, exceptionDetails } = await session.send("Runtime.evaluate", {
              contextId,
              expression: DOTTED_SCRIPT,
              returnByValue: true,
            });
            if (exceptionDetails) throw pageChanged();
            return result.value as Array<string>;
          }),
        ),
      );
      try {
        return (await values).flat();
      } catch (cause) {
        if (session !== cdp) {
          frameSessions.delete(frame);
          void session.detach().catch(constVoid);
        }
        throw cause;
      }
    };
    return { frames: owned, read };
  };
  const readers = [
    sessionReader(page.mainFrame(), cdp),
    ...frames.flatMap((frame) => {
      const owner = owners.get(frame);
      if (owner) return owner === cdp ? [] : [sessionReader(frame, owner)];
      const own = () => frame.evaluate(DOTTED_SCRIPT) as Promise<Array<string>>;
      return ownerOf(frame) === null ? [{ frames: [frame], read: own }] : [];
    }),
  ];
  return {
    readers,
    read: async (before?: ReadonlyArray<unknown>) => {
      const now = page.frames();
      if (now.length !== frames.length || now.some((frame, i) => frame !== frames[i])) {
        throw pageChanged();
      }
      return Promise.all(
        readers.map((reader, i) => {
          if (i === 0) return reader.read().catch(() => Promise.reject(pageChanged()));
          return before && !before[i] ? undefined : answered(reader.read());
        }),
      );
    },
  };
};

const dottedPattern = (values: ReadonlyArray<string>) => {
  const sources = values
    .flatMap((value) => {
      const json = JSON.stringify(value).slice(1, -1);
      const quoted = value.replace(/[\\"\p{Cc}]/gu, (char) =>
        '\\"\b\f\n\r\t'.includes(char)
          ? JSON.stringify(char).slice(1, -1)
          : `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
      );
      const forms = [value, json, quoted].flatMap((form) => [form, form.replaceAll("'", "''")]);
      return [...new Set(forms)].map((form) => ({ form, word: value.length < 4 }));
    })
    .toSorted((a, b) => b.form.length - a.form.length)
    .map(({ form, word }) => {
      const literal = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return word ? `(?<![\\p{L}\\p{N}_])${literal}(?![\\p{L}\\p{N}_])` : literal;
    });
  if (sources.length === 0) return undefined;
  const pattern = new RegExp(sources.join("|"), "gu");
  try {
    pattern.test("");
    pattern.test("\u2022");
  } catch {
    throw new ServerBrowserOperationError("PreviewAutomationExecutionError", VALUE_TOO_LONG);
  }
  return pattern;
};

const TREE_LINE =
  /^(\s*- '?[^\s"':]+)( "(?:[^"\\]|\\.)*"| \/(?:.*?\/)?)?((?: \[(?:active|checked(?:=mixed)?|disabled|expanded|level=\d+|pressed(?:=mixed)?|selected|ref=(?:f\d+)?e\d+|cursor=pointer|box=-?\d+,-?\d+,\d+,\d+)\])*'?)(:.*)?$/;

const maskTree = (tree: string, dotted: RegExp) =>
  tree
    .split("\n")
    .map((line) => {
      const node = TREE_LINE.exec(line);
      const name = node?.[1]?.length ?? 0;
      const attributes = name + (node?.[2]?.length ?? 0);
      const end = attributes + (node?.[3]?.length ?? 0);
      const kept = (from: number, to: number) => to <= name || (from >= attributes && to <= end);
      return line.replace(dotted, (match: string, offset: number) =>
        kept(offset, offset + match.length) ? match : MASKED_VALUE,
      );
    })
    .join("\n");

const pngSize = (base64: string) => {
  const header = Buffer.from(base64.slice(0, 32), "base64");
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
};

export const jpegSize = (base64: string) => {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8)
    throw new Error("Invalid JPEG screenshot.");
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error("Invalid JPEG screenshot.");
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 7) break;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      if (width && height) return { width, height };
      break;
    }
    offset += length;
  }
  throw new Error("Invalid JPEG screenshot.");
};

const scaledSize = (size: { readonly width: number; readonly height: number }, scale: number) =>
  scale < 1
    ? { width: Math.round(size.width * scale), height: Math.round(size.height * scale) }
    : size;

const readPageMetrics = async (cdp: CDPSession) => {
  const { frameTree } = await cdp.send("Page.getFrameTree");
  const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
    frameId: frameTree.frame.id,
    worldName: "supaterm-preview-metrics",
  });
  let { cssVisualViewport } = await cdp.send("Page.getLayoutMetrics");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const zoom = cssVisualViewport.zoom ?? 1;
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: "({ ratio: devicePixelRatio, width: innerWidth, height: innerHeight })",
      contextId: executionContextId,
      returnByValue: true,
    });
    ({ cssVisualViewport } = await cdp.send("Page.getLayoutMetrics"));
    if ((cssVisualViewport.zoom ?? 1) === zoom) {
      const { ratio, width, height } = result.value as {
        readonly ratio: number;
        readonly width: number;
        readonly height: number;
      };
      return { ratio, width, height, zoom };
    }
  }
  throw new Error(
    "The page's zoom kept changing while the snapshot read its size. Try the snapshot again.",
  );
};

export const captureViewport = async (
  cdp: CDPSession,
  options: { readonly format: "png" | "jpeg"; readonly quality?: number },
) => {
  const capture = cdp.send("Page.captureScreenshot", {
    format: options.format,
    ...(options.quality === undefined ? {} : { quality: options.quality }),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new ServerBrowserOperationError(
            "PreviewAutomationExecutionError",
            "The browser is not producing screenshot frames. For a desktop tab, show or restore the Supaterm window and try again.",
          ),
        ),
      SCREENSHOT_TIMEOUT_MS,
    );
  });
  const { data } = await Promise.race([capture, expired]).finally(() => clearTimeout(timer));
  return data;
};

export const captureFinalRecordingFrame = (cdp: CDPSession, quality: number) =>
  answered(
    cdp
      .send("Runtime.evaluate", {
        expression: `(async () => {
          const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          await paint();
          await Promise.allSettled(document.getAnimations()
            .filter(animation => animation.playState === "running" && animation.effect?.getComputedTiming().iterations !== Infinity)
            .map(animation => animation.finished));
          await paint();
        })()`,
        awaitPromise: true,
      })
      .then(() => captureViewport(cdp, { format: "jpeg", quality })),
  );

const SHRINK_PNG = `async function (png, width, height) {
  const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  // Namespaced, as an XML document's createElement makes a plain element with no getContext.
  const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL("image/png").slice("data:image/png;base64,".length);
}`;

const shrinkPng = async (cdp: CDPSession, png: string, scale: number) => {
  const size = pngSize(png);
  const { frameTree } = await cdp.send("Page.getFrameTree");
  const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
    frameId: frameTree.frame.id,
    worldName: "supaterm-preview-screenshot",
  });
  const { result, exceptionDetails } = await cdp.send("Runtime.callFunctionOn", {
    functionDeclaration: SHRINK_PNG,
    executionContextId,
    arguments: [
      { value: png },
      { value: Math.round(size.width * scale) },
      { value: Math.round(size.height * scale) },
    ],
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error("The snapshot could not shrink its screenshot.");
  return result.value as string;
};

type SnapshotInput = {
  readonly page: Page;
  readonly cdp: CDPSession;
  /** Headless pages render at the scale the server set; a desktop page at its display's. */
  readonly renderScale: number | "display";
  readonly fullScreenshot?: boolean | undefined;
  readonly consoleEntries: ReadonlyArray<PreviewAutomationConsoleEntry>;
  readonly networkEntries: ReadonlyArray<PreviewAutomationNetworkEntry>;
  readonly actionTimeline: PreviewAutomationSnapshot["actionTimeline"];
};

const renderingOf = async (input: SnapshotInput) => {
  if (input.renderScale !== "display") {
    const viewport = input.page.viewportSize() ?? { width: 1280, height: 800 };
    return { renderScale: input.renderScale, viewport };
  }
  const page = await readPageMetrics(input.cdp);
  return {
    renderScale: page.ratio / page.zoom,
    viewport: {
      width: Math.round(page.width * page.zoom),
      height: Math.round(page.height * page.zoom),
    },
  };
};

const capture = async (
  input: SnapshotInput,
  deadline: number,
  stages: SnapshotStages,
  metadataOnly: boolean,
) => {
  const { running } = stages;
  const track = async <A>(stage: SnapshotStage, operation: () => Promise<A>) => {
    running.set(stage, (running.get(stage) ?? 0) + 1);
    try {
      const result = await operation();
      stages.timedOut.delete(stage);
      return result;
    } catch (cause) {
      if (isTimeout(cause)) stages.timedOut.add(stage);
      throw cause;
    } finally {
      const count = (running.get(stage) ?? 1) - 1;
      if (count === 0) running.delete(stage);
      else running.set(stage, count);
    }
  };
  const { renderScale, viewport } = await track("metrics", () => renderingOf(input));
  if (Date.now() >= deadline) throw snapshotTimedOut();
  const scale = Math.min(1, MAX_SCREENSHOT_WIDTH / (viewport.width * renderScale));
  const state = refsFor(input.page);
  invalidateRefs(input.page);
  const generation = state.generation;
  const { readers, read } = await track("frames", () => openReaders(input.page, input.cdp));
  const before = await track("frames", () => read());
  const pageAndScreenshot = Promise.all([
    track(
      "page state",
      () =>
        input.page.evaluate(SNAPSHOT_SCRIPT) as Promise<
          Pick<
            PreviewAutomationSnapshot,
            "url" | "title" | "loading" | "visibleText" | "interactiveElements"
          >
        >,
    ),
    track("screenshot", () =>
      metadataOnly
        ? captureViewport(input.cdp, { format: "jpeg", quality: 10 }).then((data) => ({
            data,
            full: undefined,
          }))
        : captureViewport(input.cdp, { format: "png" }).then(async (full) =>
            scale < 1
              ? {
                  data: await shrinkPng(input.cdp, full, scale),
                  full: input.fullScreenshot ? full : undefined,
                }
              : { data: full, full: undefined },
          ),
    ),
  ]);
  void pageAndScreenshot.catch(constVoid);
  const tree = await track("accessibility tree", () =>
    input.page.ariaSnapshot({
      mode: "ai",
      boxes: true,
      timeout: Math.max(1, deadline - Date.now() - 2_000),
    }),
  );
  const after = await track("frames", () => read(before));
  if (after.some((values, i) => values && JSON.stringify(values) !== JSON.stringify(before[i])))
    throw pageChanged();
  const dotted = dottedPattern(after.flatMap((values) => values ?? []));
  const unread = readers.flatMap((reader, i) => (after[i] ? [] : reader.frames));
  const filled = /^\s*- iframe (?:\[active\] )?\[ref=(\S+?)\].*:$/gm;
  for (const [, ref] of unread.length ? tree.matchAll(filled) : []) {
    const iframe = await track("frames", () =>
      input.page.locator(`aria-ref=${ref}`).elementHandle({ timeout: 2_000 }),
    );
    if (!iframe) throw pageChanged();
    const frame = await track("frames", () => iframe.contentFrame());
    void iframe.dispose().catch(constVoid);
    if (frame && unread.includes(frame)) throw frameUnanswered();
  }
  const [page, { full, data }] = await pageAndScreenshot;
  if (state.generation !== generation) throw pageChanged();
  const mask = (text: string) => (dotted ? text.replace(dotted, MASKED_VALUE) : text);
  const redacted = withoutTreeDataPayloads(tree);
  const accessibilityTree = (dotted ? maskTree(redacted, dotted) : redacted)
    .slice(0, MAX_VISIBLE_TEXT_LENGTH)
    .replace(/\[ref=((?:f\d+)?e\d+)\]/g, (_match, nativeRef: string) => {
      const ref = `supaterm-${generation}-${nativeRef}`;
      state.refs.set(ref, nativeRef);
      return `[ref=${ref}]`;
    });
  return {
    ...page,
    url: withoutDataPayload(page.url),
    visibleText: mask(page.visibleText).slice(0, MAX_VISIBLE_TEXT_LENGTH),
    accessibilityTree,
    consoleEntries: [...input.consoleEntries],
    networkEntries: [...input.networkEntries],
    actionTimeline: [...input.actionTimeline],
    screenshot: metadataOnly
      ? scaledSize(jpegSize(data), scale)
      : { mimeType: "image/png" as const, data, ...pngSize(data) },
    ...(full !== undefined ? { fullScreenshot: { data: full, ...pngSize(full) } } : {}),
  };
};

const snapshotTurns = new WeakMap<Page, number>();

const runSnapshot = async (input: SnapshotInput, metadataOnly: boolean) => {
  const deadline = Date.now() + SNAPSHOT_TIMEOUT_MS;
  const stages: SnapshotStages = { running: new Map(), timedOut: new Set() };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(snapshotTimedOut(stages)), SNAPSHOT_TIMEOUT_MS);
  });
  const turn = (snapshotTurns.get(input.page) ?? 0) + 1;
  snapshotTurns.set(input.page, turn);
  const captured = capture(input, deadline, stages, metadataOnly).catch((cause: unknown) =>
    Date.now() < deadline &&
    snapshotTurns.get(input.page) === turn &&
    !(cause instanceof Error && cause.message === VALUE_TOO_LONG)
      ? capture(input, deadline, stages, metadataOnly)
      : Promise.reject(cause),
  );
  try {
    return await Promise.race([captured, expired]);
  } catch (cause) {
    throw isTimeout(cause) ? snapshotTimedOut(stages) : cause;
  } finally {
    clearTimeout(timer);
  }
};

export const snapshot = (input: SnapshotInput) =>
  runSnapshot(input, false) as Promise<PreviewAutomationSnapshot>;

export const snapshotMetadata = (input: SnapshotInput) =>
  runSnapshot(input, true) as Promise<PreviewAutomationSnapshotMetadata>;

/**
 * A click whose handler opens a dialog does not finish until the dialog is
 * resolved, so it returns as soon as the dialog opens; status then reports it.
 */
export const click = async (
  page: Page,
  input: PreviewAutomationClickInput,
  pointer: PointerReporter = noPointer,
): Promise<{ readonly x: number; readonly y: number }> => {
  const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const remaining = () => Math.max(1, deadline - Date.now());
  const locator = targetLocator(page, input);
  try {
    return await clickTarget(page, locator, input, remaining, pointer);
  } catch (cause) {
    throw locator === null ? cause : await namedTargetTimeout(locator, input, cause);
  }
};

const namedTargetTimeout = async (
  locator: Locator,
  input: { readonly locator?: string | undefined; readonly selector?: string | undefined },
  cause: unknown,
) => {
  if (!(cause instanceof Error && cause.name === "TimeoutError")) return cause;
  const selector = JSON.stringify(input.locator ?? input.selector);
  const target =
    selector.length > MAX_TARGET_CHARS ? `${selector.slice(0, MAX_TARGET_CHARS)}...` : selector;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const matches = await Promise.race([
    locator.count().catch(() => undefined),
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), TARGET_COUNT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  const reason =
    matches === undefined
      ? `The click may have happened; check the page before retrying. Whether ${target} still matches an element is unknown.`
      : matches === 0
        ? `The click may have happened and removed its target or navigated; check the page before retrying. No element matches ${target} after the timeout; take a fresh snapshot and use its locator.`
        : `The click may have happened; check the page before retrying. ${target} still matches an element after the timeout.`;
  const message = withActionabilityReason(reason, cause);
  return new ServerBrowserOperationError(
    "PreviewAutomationTimeoutError",
    message,
    { reason: message },
    { cause },
  );
};

const clickTarget = async (
  page: Page,
  locator: Locator | null,
  input: PreviewAutomationClickInput,
  timeout: () => number,
  pointer: PointerReporter,
) => {
  const point = await targetPoint(page, locator, input, timeout);
  await pointer(point, "click");
  const options = { button: input.button ?? "left", clickCount: input.clickCount ?? 1 } as const;
  const clicked =
    locator === null
      ? page.mouse.click(point.x, point.y, options)
      : locator.click({ ...options, timeout: timeout() });
  let onDialog = constVoid;
  const dialogOpened = new Promise<"dialog">((resolve) => {
    onDialog = () => resolve("dialog");
    page.once("dialog", onDialog);
  });
  try {
    if ((await Promise.race([clicked, dialogOpened])) === "dialog") void clicked.catch(constVoid);
  } finally {
    page.off("dialog", onDialog);
  }
  return point;
};

type FocusCandidate = {
  readonly tagName: string;
  readonly type?: string;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly isContentEditable?: boolean;
  readonly shadowRoot?: { readonly activeElement: FocusCandidate | null } | null;
  readonly focus?: () => void;
  getRootNode(): { readonly activeElement?: FocusCandidate | null };
  contains(other: FocusCandidate): boolean;
};

const focusTextTarget = (target: FocusCandidate | null) => {
  let element =
    target ??
    (globalThis as unknown as { document: { activeElement: FocusCandidate | null } }).document
      .activeElement;
  if (target === null) {
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    if (element && ["IFRAME", "FRAME", "FENCEDFRAME", "OBJECT", "EMBED"].includes(element.tagName))
      return false;
  }
  if (element == null) return false;
  const nonText = [
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ];
  const textControl =
    element.tagName === "TEXTAREA" ||
    (element.tagName === "INPUT" && !nonText.includes(element.type ?? "text"));
  if (!(textControl || element.isContentEditable) || element.disabled || element.readOnly) {
    return false;
  }
  element.focus?.();
  const active = element.getRootNode().activeElement;
  return active != null && (active === element || element.contains(active));
};

const focusedTextField = async (page: Page, timeout: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new ServerBrowserOperationError(
            "PreviewAutomationTimeoutError",
            `The page did not report its focused element within ${timeout}ms, so no text was typed.`,
            { timeoutMs: timeout },
          ),
        ),
      timeout,
    );
  });
  return await Promise.race([page.evaluate(focusTextTarget, null), expired]).finally(() =>
    clearTimeout(timer),
  );
};

export const type = async (page: Page, input: PreviewAutomationTypeInput) => {
  const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const locator = targetLocator(page, input);
  if (locator !== null && input.clear) {
    await locator.fill(input.text, { timeout });
    return;
  }
  const focused =
    locator === null
      ? await focusedTextField(page, timeout)
      : await locator.evaluate(focusTextTarget as (target: unknown) => boolean, undefined, {
          timeout,
        });
  if (focused !== true) {
    throw new ServerBrowserOperationError(
      "PreviewAutomationTargetNotEditableError",
      "The target is not an enabled text field, so no text was typed.",
    );
  }
  if (input.clear) {
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Delete");
  }
  await page.keyboard.insertText(input.text);
};

export const hover = async (
  page: Page,
  input: PreviewAutomationHoverInput,
  pointer: PointerReporter = noPointer,
) => {
  const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const remaining = () => Math.max(1, deadline - Date.now());
  const locator = targetLocator(page, input);
  await pointer(await targetPoint(page, locator, input, remaining), "move");
  if (locator === null) {
    await page.mouse.move(input.x ?? 0, input.y ?? 0);
    return;
  }
  await locator.hover({ timeout: remaining() });
};

export const select = async (
  page: Page,
  input: PreviewAutomationSelectInput,
): Promise<PreviewAutomationSelectResult> => {
  const locator = targetLocator(page, input)!;
  const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const options = await locator.evaluate(
    (element) =>
      element.tagName === "SELECT"
        ? Array.from(
            (element as unknown as { options: ArrayLike<{ value: string; label: string }> })
              .options,
            ({ value, label }) => ({ value, label: label.trim() }),
          )
        : null,
    undefined,
    { timeout },
  );
  const values =
    options &&
    input.values.map(
      (entry) =>
        (
          options.find((option) => option.value === entry) ??
          options.find((option) => option.label === entry.trim())
        )?.value ?? entry,
    );
  if (values === null)
    throw new ServerBrowserOperationError(
      "PreviewAutomationTargetNotEditableError",
      "This element is not a <select>. Click a custom dropdown, then click its option.",
    );
  return { selected: await locator.selectOption(values, { timeout }) };
};

export const drag = async (
  page: Page,
  input: PreviewAutomationDragInput,
  pointer: PointerReporter = noPointer,
) => {
  const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const remaining = () => Math.max(1, deadline - Date.now());
  const source = targetLocator(page, { locator: input.source })!;
  const target = targetLocator(page, { locator: input.target })!;
  await pointer(await targetPoint(page, source, {}, remaining), "move");

  const dragFailure = source.dragTo(target, { timeout: remaining(), steps: 5 }).then(
    () => null,
    (error: unknown) => ({ error }),
  );
  const end = await target.boundingBox({ timeout: remaining() }).catch(() => null);
  if (end) await pointer({ x: end.x + end.width / 2, y: end.y + end.height / 2 }, "move");
  const failure = await dragFailure;
  if (failure) throw failure.error;
};

export const setInputFiles = async (page: Page, input: PreviewAutomationUploadInput) => {
  const locator = targetLocator(page, input);
  if (locator === null) return false;
  await locator.setInputFiles([...input.paths], { timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS });
  return true;
};

export const press = async (page: Page, input: PreviewAutomationPressInput) => {
  await page.keyboard.press([...(input.modifiers ?? []), input.key].join("+"));
};

export const scroll = async (page: Page, input: PreviewAutomationScrollInput) => {
  const delta = [input.deltaX ?? 0, input.deltaY ?? 0] as const;
  const locator = targetLocator(page, input);
  if (locator === null) {
    await page.evaluate(`scrollBy(${delta[0]}, ${delta[1]})`);
    return;
  }
  await locator.evaluate((element, [x, y]) => element.scrollBy(x, y), delta);
};

const UNRESPONSIVE_SCRIPT_PROBE_MS = 1_000;

/**
 * A same-site navigation reuses the renderer, so it never commits while a page script holds it.
 * Call before starting the navigation: Chrome does not deliver a terminate once one is pending.
 */
export const stopUnresponsiveScript = async (cdp: CDPSession, budgetMs = Infinity) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const answered = cdp.send("Runtime.evaluate", { expression: "0" }).then(
    () => true,
    () => true,
  );
  const expired = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.min(budgetMs, UNRESPONSIVE_SCRIPT_PROBE_MS));
  });
  const responsive = await Promise.race([answered, expired]).finally(() => clearTimeout(timer));
  if (!responsive) void cdp.send("Runtime.terminateExecution").catch(constVoid);
};

export const evaluate = async (
  cdp: CDPSession,
  input: PreviewAutomationEvaluateInput,
  timeoutMs: number,
) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      void cdp.send("Runtime.terminateExecution").catch(constVoid);
      reject(
        new ServerBrowserOperationError(
          "PreviewAutomationTimeoutError",
          `Evaluation did not finish within ${timeoutMs}ms and was stopped.`,
        ),
      );
    }, timeoutMs);
  });
  const params = {
    expression: input.expression,
    awaitPromise: input.awaitPromise ?? true,
    returnByValue: true,
  };
  const evaluation = cdp.send("Runtime.evaluate", params).then((classic) => {
    const failure = classic.exceptionDetails;
    const unparsed =
      failure?.exception?.className === "SyntaxError" &&
      failure.scriptId !== undefined &&
      failure.stackTrace === undefined;
    return unparsed && !timedOut && input.expression.includes("await")
      ? cdp.send("Runtime.evaluate", { ...params, replMode: true })
      : classic;
  });
  void evaluation.catch(constVoid);
  const result = await Promise.race([evaluation, expired]).finally(() => clearTimeout(timer));
  if (result.exceptionDetails) {
    throw new ServerBrowserOperationError(
      "PreviewAutomationExecutionError",
      result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
    );
  }
  const value =
    "value" in result.result ? result.result.value : (result.result.description ?? null);
  const actualBytes = Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  if (actualBytes > MAX_EVALUATION_BYTES) {
    throw new ServerBrowserOperationError(
      "PreviewAutomationResultTooLargeError",
      `Evaluation result is ${actualBytes} bytes; the limit is ${MAX_EVALUATION_BYTES}.`,
      { maximumBytes: MAX_EVALUATION_BYTES },
    );
  }
  return value;
};

export const waitFor = async (page: Page, input: PreviewAutomationWaitForInput) => {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const locator = targetLocator(page, input);
  const { text, urlIncludes } = input;
  const checks: Array<() => Promise<boolean>> = [];
  if (locator !== null) checks.push(async () => (await locator.count()) > 0);
  if (text !== undefined) {
    checks.push(() =>
      page
        .evaluate(`(document.body?.innerText ?? "").includes(${JSON.stringify(text)})`)
        .then((found) => found === true)
        .catch(() => false),
    );
  }
  if (urlIncludes !== undefined) checks.push(async () => page.url().includes(urlIncludes));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new ServerBrowserOperationError(
            "PreviewAutomationTimeoutError",
            `Waited ${timeoutMs}ms without every condition holding.`,
          ),
        ),
      timeoutMs,
    );
  });
  try {
    for (;;) {
      const results = await Promise.race([Promise.all(checks.map((check) => check())), expired]);
      if (results.every(Boolean)) return;
      await Promise.race([new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS)), expired]);
    }
  } finally {
    clearTimeout(timer);
  }
};

const NET_ERROR_CODES: Readonly<Record<string, number>> = {
  ERR_FAILED: -2,
  ERR_TIMED_OUT: -7,
  ERR_CONNECTION_CLOSED: -100,
  ERR_CONNECTION_RESET: -101,
  ERR_CONNECTION_REFUSED: -102,
  ERR_NAME_NOT_RESOLVED: -105,
  ERR_INTERNET_DISCONNECTED: -106,
  ERR_ADDRESS_UNREACHABLE: -109,
  ERR_CERT_AUTHORITY_INVALID: -202,
  ERR_EMPTY_RESPONSE: -324,
};

export const parseNetError = (errorText: string) => {
  const description = /ERR_[A-Z\d_]+/.exec(errorText)?.[0] ?? errorText;
  return { description, code: NET_ERROR_CODES[description] ?? -2 };
};

export const recordingEncoderScript = (frameRate: BrowserRecordingFrameRate) => `(() => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const chunks = [];
  let recorder = null;
  let started = null;
  let stopped = null;
  let sizeBytes = 0;
  let tooLarge = false;
  let frame = null;
  let cursor = null;
  let ring = null;
  const AGENT_CURSOR_PATH = new Path2D(${JSON.stringify(MousePointer)});
  const AGENT_CURSOR_FILL_PATH = new Path2D(${JSON.stringify(MousePointerFilled)});
  let ringTimer = null;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  const paint = () => {
    if (!frame) return;
    const fit = Math.min(canvas.width / frame.width, canvas.height / frame.height);
    const width = frame.width * fit;
    const height = frame.height * fit;
    offsetX = (canvas.width - width) / 2;
    offsetY = (canvas.height - height) / 2;
    if (width < canvas.width || height < canvas.height) {
      context.fillStyle = "#000";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(frame, offsetX, offsetY, width, height);
    scale = (width / frame.width) * frame.cssScale;
    if (ring) {
      const age = (performance.now() - ring.at) / 400;
      if (age < 1) {
        context.beginPath();
        context.arc(offsetX + ring.x * scale, offsetY + ring.y * scale, (8 + 18 * age) * scale, 0, Math.PI * 2);
        context.strokeStyle = "rgba(59,130,246," + (0.9 * (1 - age)) + ")";
        context.lineWidth = 3 * scale;
        context.stroke();
      }
    }
    if (cursor) {
      // The agent cursor (MousePointerIcon, as in the live panel), never the human arrow.
      const s = 20 / 24 * scale;
      context.save();
      context.translate(offsetX + cursor.x * scale - 2 * scale, offsetY + cursor.y * scale - 2 * scale);
      context.scale(s, s);
      context.fillStyle = "#fff";
      context.shadowColor = "rgba(0,0,0,0.25)";
      context.shadowBlur = 2;
      context.fill(AGENT_CURSOR_FILL_PATH);
      context.fillStyle = "#2563eb";
      context.shadowColor = "transparent";
      context.fill(AGENT_CURSOR_PATH);
      context.restore();
    }
  };
  window.__supatermRecorder = {
    async frame(base64, cssWidth) {
      if (tooLarge) return false;
      // A per-character atob copy costs ~30 ms on a 3200x1800 frame and throttles recordings.
      const bytes = Uint8Array.fromBase64(base64);
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
      if (tooLarge) { bitmap.close(); return false; }
      if (!recorder) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const mimeType = ["video/mp4;codecs=avc1.640033", "video/webm;codecs=vp9", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
        const bitsPerSecond = Math.min(50e6, Math.max(2.5e6, bitmap.width * bitmap.height * ${frameRate} * 0.05));
        recorder = new MediaRecorder(canvas.captureStream(${frameRate}), { mimeType, videoBitsPerSecond: bitsPerSecond });
        started = new Promise((resolve, reject) => {
          recorder.onstart = resolve;
          recorder.onerror = (event) => reject(event.error);
        });
        stopped = new Promise((resolve) => { recorder.onstop = resolve; });
        recorder.ondataavailable = (event) => {
          if (tooLarge || event.data.size === 0) return;
          sizeBytes += event.data.size;
          if (sizeBytes > ${PROVIDER_SEND_TURN_MAX_FILE_BYTES}) {
            tooLarge = true;
            chunks.length = 0;
            clearInterval(ringTimer);
            frame?.close();
            frame = null;
            if (recorder.state !== "inactive") recorder.stop();
            for (const track of recorder.stream.getTracks()) track.stop();
            return;
          }
          chunks.push(event.data);
        };
        recorder.start(1000);
      }
      // Frame px per page CSS px, before fitting into the canvas.
      bitmap.cssScale = bitmap.width / cssWidth;
      frame?.close();
      frame = bitmap;
      paint();
      await started;
      return true;
    },
    cursor(x, y, click) {
      if (tooLarge) return;
      cursor = { x, y };
      if (click) {
        ring = { x, y, at: performance.now() };
        clearInterval(ringTimer);
        ringTimer = setInterval(() => {
          paint();
          if (performance.now() - ring.at > 400) { ring = null; clearInterval(ringTimer); paint(); }
        }, 33);
      }
      paint();
    },
    async stop() {
      if (!recorder) return { mimeType: null, count: 0, bytes: 0 };
      if (recorder.state !== "inactive") {
        // Consume the cached frame, then wait for the final paint to reach the
        // capture stream. Animation ticks alone can stop before it is delivered.
        const video = document.createElement("video");
        video.muted = true;
        video.srcObject = recorder.stream;
        const nextFrame = () => Promise.race([
          new Promise(resolve => video.requestVideoFrameCallback(resolve)),
          stopped,
        ]);
        const initial = nextFrame();
        void video.play().catch(() => {});
        await initial;
        if (recorder.state !== "inactive") {
          const delivered = nextFrame();
          recorder.stream.getVideoTracks()[0].requestFrame();
          paint();
          await delivered;
        }
        video.pause();
        video.srcObject = null;
        if (recorder.state !== "inactive") recorder.stop();
      }
      await stopped;
      return { mimeType: recorder.mimeType, count: chunks.length, bytes: sizeBytes };
    },
    async chunk(index) {
      const bytes = new Uint8Array(await chunks[index].arrayBuffer());
      if (typeof bytes.toBase64 === "function") return bytes.toBase64();
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return btoa(binary);
    },
    download() {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
      link.download = "recording";
      link.click();
    },
  };
})()`;
