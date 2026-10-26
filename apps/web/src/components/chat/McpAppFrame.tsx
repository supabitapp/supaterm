import { makeMcpAppRequests } from "@supaterm/client-runtime/mcp-apps/requests";
import type { EnvironmentId, ThreadId, TurnItemId } from "@supaterm/contracts";
import {
  makeMcpAppHost,
  McpAppHostRefusal,
  mcpAppStyleVariables,
  type McpAppCallToolResult,
  type McpAppDisplayMode,
  type McpAppHost,
  type McpAppHostContext,
} from "@supaterm/client-runtime/mcp-apps";
import {
  clampMcpAppHeight,
  MCP_APP_DEFAULT_HEIGHT,
  MCP_APP_MAX_HEIGHT,
  mcpAppAllowAttribute,
  mcpAppFileName,
  type McpAppReference,
} from "@supaterm/shared/mcpApp";
import { ShrinkIcon } from "@supaterm/icons";
import { useEffect, useRef, useState, type FocusEvent, type ToggleEvent } from "react";
import { flushSync } from "react-dom";

import { useLongLivedAssetUrl } from "~/assets/longLivedAssetUrls";
import { APP_VERSION } from "~/branding";
import { isConfirmDialogActive, requestConfirmDialog } from "~/confirmDialog";
import { useHtmlRenderTheme } from "~/hooks/useHtmlRenderTheme";
import { useStableCallback } from "~/hooks/useStableCallback";
import { Button } from "~/components/ui/button";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { useTurnItemDetail } from "~/state/queries";
import { mcpAppEnvironment } from "~/state/mcpApps";
import { useAtomCommand } from "~/state/use-atom-command";
import { observeResize } from "~/lib/observeResize";

const fullscreenSupported =
  typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype;

const PAGE_ACTIVATION_MS = 5_000;

// Frame input does not bubble here. An app can refocus itself, so focus
// alone cannot exclude activation from input elsewhere in Supaterm.
let lastPageInputAt = Number.NEGATIVE_INFINITY;
if (typeof window !== "undefined") {
  const note = () => {
    lastPageInputAt = performance.now();
  };
  if (navigator.userActivation?.isActive) note();
  for (const type of ["pointerdown", "pointerup", "touchend", "keydown"] as const) {
    window.addEventListener(type, note, true);
  }
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function McpAppFrame(props: {
  readonly environmentId: EnvironmentId;

  readonly threadId: ThreadId;

  readonly conversationThreadId: ThreadId;
  readonly itemId: TurnItemId;

  readonly revision: string;
  readonly app: McpAppReference;
  readonly onSendMessage: ((text: string) => Promise<void>) | undefined;

  readonly awaitingUser?: boolean;

  readonly onFullscreenChange?: (fullscreen: boolean) => void;
}) {
  const { app } = props;
  const theme = useHtmlRenderTheme();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(MCP_APP_DEFAULT_HEIGHT);
  const [navigatedAway, setNavigatedAway] = useState(false);
  const [displayMode, setDisplayMode] = useState<McpAppDisplayMode>("inline");

  const [closed, setClosed] = useState(false);

  const [documentGeneration, setDocumentGeneration] = useState(0);
  // Closing and reopening replaces the box, which re-attaches this.
  const attachBox = (box: HTMLDivElement) => {
    boxRef.current = box;
    setWidth(box.clientWidth);
    const stopResize = observeResize(box, ([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
      // Full screen reports the viewport, which can change height alone.
      if (fullscreenSupported && box.matches(":popover-open")) {
        hostRef.current?.updateHostContext();
      }
    });
    return () => {
      stopResize();
      boxRef.current = null;
    };
  };

  const resource = {
    _tag: "attachment" as const,
    attachmentId: app.attachmentId,
    fileName: mcpAppFileName(app),
    mimeType: "text/html",
    disposition: "inline" as const,
    renderIntent: "mcp-app" as const,
  };
  // The frame keeps its first URL: a re-minted one would reload the app.
  const [src, setSrc] = useState<string | null>(null);
  const asset = useLongLivedAssetUrl(src === null ? props.environmentId : null, resource);
  if (src === null && asset._tag === "Success") setSrc(asset.url);

  const detail = useTurnItemDetail({
    environmentId: props.environmentId,
    threadId: props.threadId,
    itemId: props.itemId,
    revision: props.revision,
  });
  const storedItem = detail.data?.item;
  // The host gets the tool call pushed by an effect keyed on it, so it must stay cached.
  const toolCall =
    storedItem?.type === "dynamic_tool"
      ? {
          arguments: storedItem.input,
          result: (storedItem.output as { readonly result?: unknown } | undefined)?.result as
            | McpAppCallToolResult
            | undefined,
        }
      : undefined;

  const callTool = useAtomCommand(mcpAppEnvironment.callTool, { reportFailure: false });
  const toolInfo = useAtomCommand(mcpAppEnvironment.toolInfo, { reportFailure: false });
  const toolDefinition = useEnvironmentQuery(
    mcpAppEnvironment.toolInfoQuery({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, itemId: props.itemId, name: app.tool },
    }),
  ).data?.tool;
  const readResource = useAtomCommand(mcpAppEnvironment.readResource, { reportFailure: false });
  const updateModelContext = useAtomCommand(mcpAppEnvironment.updateModelContext, {
    reportFailure: false,
  });

  // Read live values without rebuilding the host and losing the app session.
  const readLive = useStableCallback(() => ({
    theme,
    width,
    props,
    callTool,
    toolInfo,
    readResource,
    updateModelContext,
    displayMode,
    toolDefinition,
  }));
  const hostRef = useRef<McpAppHost | null>(null);

  const [stepAsideFor, setStepAsideFor] = useState(props.awaitingUser);
  if (stepAsideFor !== props.awaitingUser) {
    setStepAsideFor(props.awaitingUser);
    if (props.awaitingUser === true) setDisplayMode("inline");
  }
  // The box is in the top layer exactly while its full-screen chrome is
  // mounted, so every way out of full screen (including the step-aside above,
  // decided during render) closes the popover and releases the timeline pin.
  const attachFullscreenChrome = (chrome: HTMLDivElement) => {
    const box = chrome.parentElement;
    if (box === null) return;
    if (!box.matches(":popover-open")) box.showPopover();
    readLive().props.onFullscreenChange?.(true);
    return () => {
      if (box.matches(":popover-open")) box.hidePopover();
      readLive().props.onFullscreenChange?.(false);
    };
  };
  // Light dismiss (Escape) closes the popover without React.
  const onBoxToggle = (event: ToggleEvent<HTMLDivElement>) => {
    if (event.newState === "closed") setDisplayMode("inline");
  };
  const onBoxBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (
      displayMode === "fullscreen" &&
      next instanceof Node &&
      !event.currentTarget.contains(next)
    ) {
      setDisplayMode("inline");
    }
  };

  const loads = useRef({ generation: 0, count: 0 });
  const onFrameLoad = () => {
    if (loads.current.generation !== documentGeneration) {
      loads.current = { generation: documentGeneration, count: 0 };
    }
    loads.current.count += 1;
    if (loads.current.count > 1) {
      hostRef.current?.dispose();
      setNavigatedAway(true);
    }
  };

  // The host belongs to this frame element, which is replaced when the document is reopened.
  const attachFrame = (frame: HTMLIFrameElement) => {
    frameRef.current = frame;
    const hostContext = (): McpAppHostContext => {
      const current = readLive();
      return {
        theme: current.theme.appearance,
        styles: { variables: mcpAppStyleVariables(current.theme.variables) },
        displayMode: current.displayMode,
        availableDisplayModes: fullscreenSupported ? ["inline", "fullscreen"] : ["inline"],
        containerDimensions:
          current.displayMode === "fullscreen"
            ? {
                width: frameRef.current?.clientWidth || window.innerWidth,
                height: frameRef.current?.clientHeight || window.innerHeight,
              }
            : { width: current.width, maxHeight: MCP_APP_MAX_HEIGHT },
        platform: isElectron ? "desktop" : "web",
        locale: navigator.language,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        userAgent: `supaterm/${APP_VERSION}`,
        deviceCapabilities: {
          touch: window.matchMedia("(pointer: coarse)").matches,
          hover: window.matchMedia("(hover: hover)").matches,
        },
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
        ...(current.toolDefinition === undefined
          ? {}
          : { toolInfo: { tool: current.toolDefinition } }),
      };
    };

    const ask = async (message: string) => {
      flushSync(() => setDisplayMode("inline"));
      const approved = await requestConfirmDialog(message);

      if (approved === undefined) {
        throw new McpAppHostRefusal("Supaterm could not ask for approval here.");
      }
      return approved;
    };
    const target = () => frameRef.current?.contentWindow ?? null;

    const requests = makeMcpAppRequests({
      target: () => readLive().props,
      commands: readLive,
      confirmTool: async ({ name, title, arguments: args }) =>
        (await ask(
          `Allow ${app.server} to run ${title ?? name}?\n${JSON.stringify(args, null, 2)}`,
        )) === true,
      confirmDownload: async (files) =>
        (await ask(`Save ${files.map((file) => file.name).join(", ")} from ${app.server}?`)) ===
        true,
      saveFile: ({ name, mimeType, bytes }) =>
        saveBlob(new Blob([bytes.slice()], { type: mimeType }), name),
    });
    const host = makeMcpAppHost({
      app,
      hostVersion: APP_VERSION,

      post: (message) => target()?.postMessage(message, "*"),
      hostContext,
      ...requests,
      openLink: async (url) => {
        if (document.activeElement !== frameRef.current || !navigator.userActivation?.isActive) {
          throw new McpAppHostRefusal("Links open only from a click in the app.");
        }
        window.open(url, "_blank", "noopener,noreferrer");
      },
      sendMessage: async (text) => {
        const send = readLive().props.onSendMessage;
        if (send === undefined) throw new McpAppHostRefusal("Messages are not available here.");
        const approved = await ask(`Send this message from ${app.server}?\n${text}`);
        if (approved !== true) throw new McpAppHostRefusal("Declined by the user.");
        await send(text);
      },
      requestDisplayMode: async (mode) => {
        const otherFullscreen = document.querySelector("[data-mcp-app-fullscreen]");
        if (
          mode === "fullscreen" &&
          (!fullscreenSupported ||
            document.activeElement !== frameRef.current ||
            !navigator.userActivation?.isActive ||
            performance.now() - lastPageInputAt < PAGE_ACTIVATION_MS ||
            readLive().props.awaitingUser === true ||
            isConfirmDialogActive() ||
            (otherFullscreen !== null && otherFullscreen !== boxRef.current))
        ) {
          return readLive().displayMode;
        }
        setDisplayMode(mode);
        return mode;
      },
      onRequestTeardown: () => {
        if (readLive().displayMode === "fullscreen") {
          setDisplayMode("inline");
          return;
        }

        void host.teardown().then(() => setClosed(true));
      },
      onSizeChanged: (size) => {
        if (readLive().displayMode === "fullscreen") return;
        if (size.height !== undefined) setHeight(clampMcpAppHeight(size.height));
      },
    });
    hostRef.current = host;
    const receive = (event: MessageEvent) => {
      if (event.source !== null && event.source === target()) host.receive(event.data);
    };
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);

      void host.teardown();
      hostRef.current = null;
      frameRef.current = null;
    };
  };

  useEffect(() => {
    hostRef.current?.updateHostContext();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Context changes trigger a resend.
  }, [theme, width, displayMode, toolDefinition]);

  useEffect(() => {
    if (toolCall !== undefined) hostRef.current?.setToolCall(toolCall);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Each new document needs the call.
  }, [toolCall, src, documentGeneration]);

  if (closed) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-muted-foreground text-xs">
        <span>The {app.server} app was closed</span>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            setSrc(null);
            setDocumentGeneration((value) => value + 1);
            setClosed(false);
          }}
        >
          Show app
        </Button>
      </div>
    );
  }

  const fullscreen = displayMode === "fullscreen";
  return (
    <div style={{ height }}>
      <div
        ref={attachBox}
        {...(fullscreenSupported
          ? { popover: "auto" as const, onToggle: onBoxToggle, onBlur: onBoxBlur }
          : {})}
        data-mcp-app-fullscreen={fullscreen ? "" : undefined}
        className={cn(
          "relative size-full overflow-hidden",
          app.prefersBorder === true && !fullscreen && "rounded-lg border border-border",
          fullscreen
            ? "fixed inset-0 m-0 flex h-dvh max-h-none w-dvw max-w-none flex-col border-0 bg-background p-0"
            : "block! static! m-0 border-0 bg-transparent p-0 text-inherit",
        )}
      >
        {fullscreen ? (
          <div
            ref={attachFullscreenChrome}
            className="flex h-10 shrink-0 items-center justify-between border-border border-b px-3 text-sm"
          >
            <span className="truncate">{app.server}</span>
            <Button
              aria-label="Exit full screen"
              size="icon-sm"
              variant="ghost"
              onClick={() => setDisplayMode("inline")}
            >
              <ShrinkIcon className="size-4" />
            </Button>
          </div>
        ) : null}
        {navigatedAway ? (
          <p className="flex size-full items-center justify-center text-muted-foreground text-xs">
            The {app.server} app left its page and was stopped
          </p>
        ) : src !== null ? (
          <iframe
            ref={attachFrame}
            src={src}
            title={`${app.server} app`}

            sandbox="allow-scripts allow-forms"
            allow={mcpAppAllowAttribute(app.permissions)}
            onLoad={onFrameLoad}
            className={cn("block w-full border-0", fullscreen ? "min-h-0 flex-1" : "h-full")}
            style={{ colorScheme: theme.appearance }}
          />
        ) : asset._tag === "Failure" ? (
          <p className="flex size-full items-center justify-center text-muted-foreground text-xs">
            Unable to load the {app.server} app
          </p>
        ) : null}
      </div>
    </div>
  );
}
