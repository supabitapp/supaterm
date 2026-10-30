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
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { useAssetUrlRefresh, useAssetUrlState } from "~/assets/assetUrls";
import { APP_VERSION } from "~/branding";
import { isConfirmDialogActive, requestConfirmDialog } from "~/confirmDialog";
import { useHtmlRenderTheme } from "~/hooks/useHtmlRenderTheme";
import { Button } from "~/components/ui/button";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { useTurnItemDetail } from "~/state/queries";
import { mcpAppEnvironment } from "~/state/mcpApps";
import { useAtomCommand } from "~/state/use-atom-command";
import { useEnvironmentQuery } from "~/state/query";
import { observeResize } from "~/lib/observeResize";

const MIN_URL_LIFE_MS = 5 * 60_000;
const fullscreenSupported =
  typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype;

const PAGE_ACTIVATION_MS = 5_000;
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
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Measures the mounted iframe container and observes its width until that container is replaced.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    setWidth(box.clientWidth);
    return observeResize(box, ([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Closing and reopening replaces the box.
  }, [closed]);

  const resource = {
    _tag: "attachment" as const,
    attachmentId: app.attachmentId,
    fileName: mcpAppFileName(app),
    mimeType: "text/html",
    disposition: "inline" as const,
    renderIntent: "mcp-app" as const,
  };
  const asset = useAssetUrlState(props.environmentId, resource);
  const refreshAsset = useAssetUrlRefresh(props.environmentId, resource);

  const [src, setSrc] = useState<string | null>(null);
  const [mintFailed, setMintFailed] = useState(false);
  const minting = useRef(false);
  const cachedUrl = asset._tag === "Success" ? asset.url : null;
  const cachedExpiresAt = asset._tag === "Success" ? asset.expiresAt : 0;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Pins one viable asset URL for the iframe document so later cache refreshes cannot navigate the running app.
  useEffect(() => {
    if (src !== null || cachedUrl === null || minting.current) return;
    if (cachedExpiresAt - Date.now() > MIN_URL_LIFE_MS) {
      // oxlint-disable-next-line react/set-state-in-effect -- Adopts the cached URL once it is known to last.
      setSrc(cachedUrl);
      return;
    }
    minting.current = true;
    void refreshAsset().then(
      (url) => (url === null ? setMintFailed(true) : setSrc(url)),
      () => setMintFailed(true),
    );
  }, [src, cachedUrl, cachedExpiresAt, refreshAsset]);

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
  const readResource = useAtomCommand(mcpAppEnvironment.readResource, { reportFailure: false });
  const updateModelContext = useAtomCommand(mcpAppEnvironment.updateModelContext, {
    reportFailure: false,
  });

  const toolInfoResult = useEnvironmentQuery(
    mcpAppEnvironment.toolInfoQuery({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, itemId: props.itemId, name: app.tool },
    }),
  );
  const toolDefinition = toolInfoResult.data?.tool;

  const live = {
    theme,
    width,
    props,
    callTool,
    toolInfo,
    readResource,
    updateModelContext,
    displayMode,
    toolDefinition,
  };
  const hostRef = useRef<McpAppHost | null>(null);
  const readLive = useEffectEvent(() => live);

  const lastPageInputAt = useRef(Number.NEGATIVE_INFINITY);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Tracks window input while the app is mounted to validate iframe fullscreen requests.
  useEffect(() => {
    const note = () => {
      lastPageInputAt.current = performance.now();
    };
    if (navigator.userActivation?.isActive) note();
    const types = ["pointerdown", "pointerup", "touchend", "keydown"] as const;
    for (const type of types) window.addEventListener(type, note, true);
    return () => {
      for (const type of types) window.removeEventListener(type, note, true);
    };
  }, []);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Keeps the container's native popover and fullscreen ownership in step with display mode.
  useEffect(() => {
    const box = boxRef.current;
    if (box === null || !fullscreenSupported) return;
    const shown = box.matches(":popover-open");
    if (displayMode === "fullscreen" && !shown) box.showPopover();
    if (displayMode !== "fullscreen" && shown) box.hidePopover();

    if (displayMode === "fullscreen") {
      readLive().props.onFullscreenChange?.(true);
      return () => readLive().props.onFullscreenChange?.(false);
    }
  }, [displayMode]);

  const [stepAsideFor, setStepAsideFor] = useState(props.awaitingUser);
  if (stepAsideFor !== props.awaitingUser) {
    setStepAsideFor(props.awaitingUser);
    if (props.awaitingUser === true) setDisplayMode("inline");
  }

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Owns focus, Escape and resize listeners while the iframe is fullscreen.
  useEffect(() => {
    if (displayMode !== "fullscreen") return;
    const leave = () => setDisplayMode("inline");
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !boxRef.current?.contains(event.target)) leave();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") leave();
    };
    const onResize = () => hostRef.current?.updateHostContext();
    document.addEventListener("focusin", onFocus);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("focusin", onFocus);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [displayMode]);

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

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Creates the iframe RPC host and message listener for each document, then tears both down on disposal.
  useEffect(() => {
    if (src === null) return;
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
          (document.activeElement !== frameRef.current ||
            !navigator.userActivation?.isActive ||
            performance.now() - lastPageInputAt.current < PAGE_ACTIVATION_MS ||
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
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A reopened document needs a new host.
  }, [src, app, documentGeneration]);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- pushes theme, width, display mode and tool definition to the MCP app host in the iframe
  useEffect(() => {
    hostRef.current?.updateHostContext();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Context changes trigger a resend.
  }, [theme, width, displayMode, toolDefinition]);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- sends the current tool call to the MCP app host, again for each new iframe document
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
            minting.current = false;
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
        ref={boxRef}

        {...(fullscreenSupported ? { popover: "manual" as const } : {})}
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
          <div className="flex h-10 shrink-0 items-center justify-between border-border border-b px-3 text-sm">
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
            ref={frameRef}
            src={src}
            title={`${app.server} app`}

            sandbox="allow-scripts allow-forms"
            allow={mcpAppAllowAttribute(app.permissions)}
            onLoad={onFrameLoad}
            className={cn("block w-full border-0", fullscreen ? "min-h-0 flex-1" : "h-full")}
            style={{ colorScheme: theme.appearance }}
          />
        ) : asset._tag === "Failure" || mintFailed ? (
          <p className="flex size-full items-center justify-center text-muted-foreground text-xs">
            Unable to load the {app.server} app
          </p>
        ) : null}
      </div>
    </div>
  );
}
