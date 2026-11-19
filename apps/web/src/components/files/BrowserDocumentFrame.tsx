import { useAtomValue } from "@effect/atom-react";
import {
  type KeybindingCommand,
  type KeybindingShortcut,
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
  type ScopedThreadRef,
  PANE_FOCUS_KEYBINDING_COMMANDS,
  THREAD_JUMP_KEYBINDING_COMMANDS,
} from "@supaterm/contracts";
import {
  type FilePreviewScroll,
  filePreviewRestoreScrollMessage,
  isFilePreviewScrollRestored,
  readFilePreviewScroll,
  type HtmlRenderSelectionEvent,
  type HtmlRenderShortcut,
  htmlRenderShortcutsMessage,
  htmlRenderThemeFragment,
  htmlRenderThemeMessage,
  htmlRenderResult,
  readHtmlRenderContentHeight,
  readHtmlRenderImageRequest,
  readHtmlRenderKeyDown,
  readHtmlRenderLinkRequest,
  readHtmlRenderSelectionEvent,
} from "@supaterm/shared/htmlRender";
import {
  isMacPlatform,
  matchesKeybindingShortcut,
  normalizeEventKey,
  shortcutConflictKey,
} from "@supaterm/shared/keybindings";
import {
  createContext,
  lazy,
  Suspense,
  use,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { isElectron } from "~/env";
import { FileSurfaceLoading } from "./fileSurfaceChrome";
import type { PdfViewState } from "./PdfViewer";

import { useOpenLink } from "~/browser/useOpenLink";
import { ExpandedImageDialog } from "~/components/chat/ExpandedImageDialog";
import type { ExpandedImagePreview } from "~/components/chat/ExpandedImagePreview";
import { useHtmlRenderTheme } from "~/hooks/useHtmlRenderTheme";
import { useOpenChangeRequestLink } from "~/lib/openPullRequestLink";
import { readLocalApi } from "~/localApi";
import { cn } from "~/lib/utils";
import { primaryServerKeybindingsAtom, serverEnvironment } from "~/state/server";

const HTML_RENDER_SHORTCUT_COMMANDS: ReadonlySet<KeybindingCommand> = new Set([
  "commandPalette.toggle",
  "filePicker.toggle",
  "projectPicker.toggle",
  "projectSearch.toggle",
  "chat.find",
  "sidebar.toggle",
  "rightPanel.toggle",
  "rightPanel.toggleMaximized",
  "threadPanel.toggle",
  "terminal.toggle",
  "preview.toggle",
  "automations.open",
  "navigation.back",
  "navigation.forward",
  "thread.previous",
  "thread.next",
  ...THREAD_JUMP_KEYBINDING_COMMANDS,
  ...MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
  "pane.focusNext",
  "pane.focusPrevious",
  ...PANE_FOCUS_KEYBINDING_COMMANDS,
]);

export const isPdfPreviewFile = (path: string) => /\.pdf$/i.test(path.split(/[?#]/, 1)[0] ?? "");

const PdfViewer = lazy(() => import("./PdfViewer"));

const browserPdfViewerAvailable = () =>
  !isElectron &&
  navigator.pdfViewerEnabled &&
  !/iPad|iPhone|iPod/.test(navigator.userAgent) &&
  !(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export const NativePdfViewerContext = createContext(browserPdfViewerAvailable);

function PdfDocument(props: { src: string; title: string; documentKey: string }) {
  const [view, setView] = useState<PdfViewState>({ page: 0, offset: 0, zoom: null, left: 0 });
  return (
    <PdfDocumentRevision
      key={props.documentKey}
      src={props.src}
      title={props.title}
      positionKey={props.documentKey}
      initialView={view}
      onViewChange={setView}
    />
  );
}

function PdfDocumentRevision(props: {
  src: string;
  title: string;
  positionKey: string;
  initialView: PdfViewState;
  onViewChange: (view: PdfViewState) => void;
}) {
  const [src] = useState(props.src);
  const native = use(NativePdfViewerContext)();
  return native ? (
    // oxlint-disable-next-line react/iframe-missing-sandbox -- Chromium's PDF plugin requires an unsandboxed frame; src is an exact-file asset grant.
    <iframe
      src={`${src.split("#", 1)[0]}#navpanes=0&view=FitH`}
      title={props.title}
      className="block h-full min-h-0 w-full flex-1 border-0 bg-white"
    />
  ) : (
    <Suspense fallback={<FileSurfaceLoading />}>
      <PdfViewer
        src={src}
        title={props.title}
        positionKey={props.positionKey}
        initialView={props.initialView}
        onViewChange={props.onViewChange}
      />
    </Suspense>
  );
}

export function BrowserDocumentFrame(props: {
  readonly src: string;
  readonly title: string;
  readonly pdf: boolean;
  readonly htmlRender?: boolean;
  readonly threadRef?: ScopedThreadRef | undefined;
  /** Stable resource identity and revision; defaults to src for callers that reload on URL changes. */
  readonly documentKey?: string | undefined;
  /** Resource identity without its revision, so PDF reloads can retain the reading position. */
  readonly documentId?: string | undefined;
}) {
  const key = props.documentKey ?? props.src;
  return props.pdf ? (
    <PdfDocument
      key={props.documentId ?? key}
      documentKey={key}
      src={props.src}
      title={props.title}
    />
  ) : props.htmlRender ? (
    <HtmlRenderDocument
      key={key}
      src={props.src}
      title={props.title}
      threadRef={props.threadRef}
      className="min-h-0 flex-1"
    />
  ) : (
    <FileDocument
      key={props.documentId ?? key}
      documentKey={key}
      src={props.src}
      title={props.title}
    />
  );
}

interface FileDocumentRevision {
  readonly key: string;
  readonly src: string;
}

interface FileDocumentFrames {
  readonly shown: FileDocumentRevision;
  readonly next: FileDocumentRevision | null;
}

const showRevision = (next: FileDocumentRevision) => (current: FileDocumentFrames) =>
  current.next === next ? { shown: next, next: null } : current;

const FILE_DOCUMENT_SWAP_TIMEOUT_MS = 5_000;

function FileDocument(props: {
  readonly documentKey: string;
  readonly src: string;
  readonly title: string;
}) {
  const [frames, setFrames] = useState<FileDocumentFrames>(() => ({
    shown: { key: props.documentKey, src: props.src },
    next: null,
  }));
  if ((frames.next ?? frames.shown).key !== props.documentKey) {
    setFrames({
      shown: frames.shown,
      next:
        frames.shown.key === props.documentKey ? null : { key: props.documentKey, src: props.src },
    });
  }
  const { next } = frames;
  const shownFrame = useRef<HTMLIFrameElement>(null);
  const nextFrame = useRef<HTMLIFrameElement>(null);
  const scroll = useRef<FilePreviewScroll | null>(null);
  const reveal = (revision: FileDocumentRevision) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setFrames(showRevision(revision))));
  const onFrameMessage = useEffectEvent((event: MessageEvent) => {
    const position = readFilePreviewScroll(event.data);
    if (position !== undefined) {
      if (event.source === shownFrame.current?.contentWindow) scroll.current = position;
    } else if (
      next !== null &&
      event.source === nextFrame.current?.contentWindow &&
      isFilePreviewScrollRestored(event.data)
    ) {
      reveal(next);
    }
  });
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- listens for the frames' scroll reports
  useEffect(() => {
    const onMessage = (event: MessageEvent) => onFrameMessage(event);
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- swaps in a revision whose load event never arrives
  useEffect(() => {
    if (next === null) return;
    const timer = setTimeout(() => setFrames(showRevision(next)), FILE_DOCUMENT_SWAP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [next]);
  return (
    <div className="relative min-h-0 flex-1">
      {[next, frames.shown].map((revision) =>
        revision === null ? null : (
          <iframe
            key={revision.key}
            ref={revision === next ? nextFrame : shownFrame}
            src={revision.src}
            title={props.title}
            className="absolute inset-0 size-full border-0"
            style={{ backgroundColor: "Canvas" }}
            sandbox="allow-scripts allow-forms allow-popups allow-downloads"
            inert={revision === next}
            aria-hidden={revision === next ? true : undefined}
            onLoad={
              revision === next
                ? (event) => {
                    if (scroll.current === null) {
                      reveal(revision);
                      return;
                    }
                    event.currentTarget.contentWindow?.postMessage(
                      filePreviewRestoreScrollMessage(scroll.current),
                      "*",
                    );
                  }
                : undefined
            }
          />
        ),
      )}
    </div>
  );
}

/** Keep the initial URL while mounted; re-signing must not reload the page. */
export function HtmlRenderDocument(props: {
  readonly src: string;
  readonly title: string;
  readonly className?: string;
  readonly threadRef?: ScopedThreadRef | undefined;
  readonly onContentHeight?: (height: number) => void;
  /** What the page says about its text selection. Boxes are in the frame's own coordinates. */
  readonly onSelection?:
    | ((frame: HTMLIFrameElement, event: HtmlRenderSelectionEvent) => void)
    | undefined;
  /** Reports fullscreen changes so virtualized rows can stay mounted. */
  readonly onFullscreenChange?: ((fullscreen: boolean) => void) | undefined;
}) {
  const theme = useHtmlRenderTheme();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [src] = useState(() => `${props.src.split("#", 1)[0]}${htmlRenderThemeFragment(theme)}`);
  const [loaded, setLoaded] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  const postTheme = () => {
    frameRef.current?.contentWindow?.postMessage(htmlRenderThemeMessage(theme), "*");
  };
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- posts the current theme to the sandboxed iframe's window
  useEffect(postTheme, [theme]);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const environmentKeybindings = useAtomValue(
    serverEnvironment.configValueAtom(props.threadRef?.environmentId ?? null),
  )?.keybindings;
  const mac = isMacPlatform(navigator.platform);
  const resolve = (shortcut: KeybindingShortcut) => ({
    key: shortcut.key,
    metaKey: shortcut.metaKey || (shortcut.modKey && mac),
    ctrlKey: shortcut.ctrlKey || (shortcut.modKey && !mac),
    shiftKey: shortcut.shiftKey,
    altKey: shortcut.altKey,
  });
  const blocked = [...keybindings, ...(environmentKeybindings ?? [])].flatMap((binding) =>
    HTML_RENDER_SHORTCUT_COMMANDS.has(binding.command) ? [] : [resolve(binding.shortcut)],
  );
  const shortcutsByKey = new Map<string, HtmlRenderShortcut>();
  for (const { command, shortcut } of keybindings) {
    if (
      HTML_RENDER_SHORTCUT_COMMANDS.has(command) &&
      (shortcut.metaKey || shortcut.ctrlKey || shortcut.modKey)
    ) {
      shortcutsByKey.set(shortcutConflictKey(shortcut, navigator.platform), resolve(shortcut));
    }
  }
  const shortcuts = [...shortcutsByKey.values()];
  const postShortcuts = () => {
    frameRef.current?.contentWindow?.postMessage(
      htmlRenderShortcutsMessage(shortcuts, blocked),
      "*",
    );
  };
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- posts allowed and blocked shortcuts to the sandboxed iframe's window
  useEffect(postShortcuts, [blocked, shortcuts]);
  const isShortcut = useEffectEvent(
    (key: NonNullable<ReturnType<typeof readHtmlRenderKeyDown>>) => {
      const matches = (shortcut: HtmlRenderShortcut) =>
        matchesKeybindingShortcut(key, { ...shortcut, modKey: false }, navigator.platform);
      const allowed = shortcuts.filter(matches);
      return (
        allowed.length > 0 &&
        !blocked.some(matches) &&
        (key.key.length === 1 ||
          key.key === "Dead" ||
          allowed.some((shortcut) => shortcut.key === normalizeEventKey(key.key)))
      );
    },
  );
  const openChangeRequestLink = useOpenChangeRequestLink(props.threadRef);
  const openLink = useOpenLink(props.threadRef);
  const open = useEffectEvent((url: string, modifiers: { metaKey: boolean; ctrlKey: boolean }) => {
    if (modifiers.metaKey || modifiers.ctrlKey) {
      void readLocalApi()
        ?.shell.openExternal(url)
        .catch((cause: unknown) => console.error(cause));
      return;
    }
    if (
      props.threadRef !== undefined &&
      openChangeRequestLink(
        { ...modifiers, preventDefault: () => undefined, stopPropagation: () => undefined },
        url,
        undefined,
        props.threadRef.environmentId,
      )
    ) {
      return;
    }
    void openLink(url, { event: modifiers }).catch((cause: unknown) => console.error(cause));
  });
  const { onFullscreenChange } = props;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- reports fullscreen to the parent while the image viewer is open, and clears it on unmount
  useEffect(() => {
    if (expandedImage === null) return;
    onFullscreenChange?.(true);
    return () => onFullscreenChange?.(false);
  }, [expandedImage, onFullscreenChange]);
  const onFrameMessage = useEffectEvent((frame: HTMLIFrameElement, event: MessageEvent) => {
    const height = readHtmlRenderContentHeight(event.data);
    if (height !== undefined) {
      props.onContentHeight?.(height);
      return;
    }
    const selection = readHtmlRenderSelectionEvent(event.data);
    if (selection !== undefined) {
      if (selection._tag === "cleared" || document.activeElement === frame) {
        props.onSelection?.(frame, selection);
      }
      return;
    }
    if (document.activeElement !== frame || navigator.userActivation?.isActive === false) return;
    const linkRequest = readHtmlRenderLinkRequest(event.data);
    if (linkRequest !== undefined) {
      open(linkRequest.url, linkRequest);
      frame.contentWindow?.postMessage(htmlRenderResult(linkRequest.id), "*");
      return;
    }
    const key = readHtmlRenderKeyDown(event.data);
    if (key !== undefined) {
      if (isShortcut(key)) {
        frame.dispatchEvent(
          new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true }),
        );
      }
      return;
    }
    const imageRequest = readHtmlRenderImageRequest(event.data);
    if (imageRequest !== undefined) {
      setExpandedImage({ images: [...imageRequest.images], index: imageRequest.index });
    }
  });
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- attaches a window message listener for the iframe at commit, before its first height post
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source === frame.contentWindow) onFrameMessage(frame, event);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return (
    <>
      <iframe
        ref={frameRef}
        src={src}
        title={props.title}
        sandbox="allow-scripts allow-forms"
        allow="fullscreen"
        loading="lazy"
        onLoad={() => {
          setLoaded(true);
          postTheme();
          postShortcuts();
        }}
        className={cn("border-0 scheme-light", props.className)}
        style={loaded ? { colorScheme: theme.appearance } : undefined}
      />
      {expandedImage !== null ? (
        <ExpandedImageDialog preview={expandedImage} onClose={() => setExpandedImage(null)} />
      ) : null}
    </>
  );
}
