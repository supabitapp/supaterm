import { AsyncResult } from "effect/reactivity";
import { appAtomRegistry } from "../../state/atom-registry";
import { Button } from "../../components/ui/Button";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import * as Dialog from "../../components/ui/Dialog";
import { makeMcpAppRequests } from "@supaterm/client-runtime/mcp-apps/requests";
import type { EnvironmentId, ThreadId, TurnItemId } from "@supaterm/contracts";
import {
  makeMcpAppHost,
  McpAppHostRefusal,
  mcpAppStyleVariables,
  type McpAppCallToolResult,
  type McpAppHost,
  type McpAppHostContext,
} from "@supaterm/client-runtime/mcp-apps";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import { CommandId, MessageId } from "@supaterm/contracts";
import {
  mcpAppAllowAttribute,
  mcpAppFileName,
  mcpAppReferencesEqual,
  type McpAppReference,
} from "@supaterm/shared/mcpApp";
import * as Predicate from "effect/Predicate";
import Constants from "expo-constants";
import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { AppText as Text } from "../../components/ui/AppText";
import { shareGeneratedAttachment } from "../../lib/attachmentDownload";
import { mobileHtmlRenderTheme } from "../../lib/htmlRenderTheme";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { uuidv4 } from "../../lib/uuid";
import { useAssetUrlState } from "../../state/assets";
import { useThreadShell } from "../../state/entities";
import { mcpAppEnvironment } from "../../state/mcpApps";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { MCP_APP_INLINE_MAX_HEIGHT, mcpAppInlineHeight } from "./mcpAppSizing";

const ROW_BOTTOM_MARGIN = 8;

function outerDocument(src: string, allow: string, secret: string) {
  const attribute = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%;background:transparent}iframe{border:0;display:block;width:100%;height:100%}</style></head>
<body><iframe id="app" sandbox="allow-scripts allow-forms" allow="${attribute(allow)}"></iframe>
<script>(function(){var frame=document.getElementById("app"),secret=${JSON.stringify(secret)},loads=0,live=true;
var send=function(m){var u=navigator.userActivation;window.ReactNativeWebView.postMessage(JSON.stringify({secret:secret,active:!!(u&&u.isActive)&&document.activeElement===frame,message:m}));};
frame.addEventListener("load",function(){loads+=1;if(loads>1&&live){live=false;send({supaterm:"navigated"});}});
window.addEventListener("message",function(e){if(live&&e.source===frame.contentWindow)send(e.data);});
window.__supatermMcpAppReceive=function(m){live&&frame.contentWindow&&frame.contentWindow.postMessage(m,"*");};
frame.src=${JSON.stringify(src).replace(/</g, "\\u003c")};})();</script></body></html>`;
}

const confirm = (title: string, message: string, action: string) =>
  new Promise<boolean>((resolve) => {
    Dialog.alert(
      title,
      message,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: action, onPress: () => resolve(true) },
      ],

      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });

export function ThreadMcpApp(props: {
  readonly environmentId: EnvironmentId;

  readonly threadId: ThreadId;

  readonly conversationThreadId: ThreadId;
  readonly itemId: TurnItemId;
  readonly revision: string;
  readonly app: McpAppReference;
  readonly width: number;

  readonly displayMode?: "inline" | "fullscreen";

  readonly onExitFullscreen?: () => void;

  readonly height?: number;
}) {
  const [height, setHeight] = useState(MCP_APP_INLINE_MAX_HEIGHT);
  const [app, setApp] = useState(props.app);
  if (!mcpAppReferencesEqual(app, props.app)) {
    setApp(props.app);
    setHeight(MCP_APP_INLINE_MAX_HEIGHT);
  }
  const fullscreen = props.displayMode === "fullscreen";
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [closed, setClosed] = useState(false);

  const [presentedFullscreen, setPresentedFullscreen] = useState(false);

  const [documentKey, setDocumentKeyState] = useState(0);

  const { themeId, themeAppearance, themeVariables, systemColorsActive } =
    useAppearancePreferences();
  const theme = useMemo(
    () =>
      mobileHtmlRenderTheme({
        themeId,
        appearance: themeAppearance,
        variables: themeVariables,
        systemColors: systemColorsActive,
        platform: Platform.OS,
      }),
    [themeId, themeAppearance, themeVariables, systemColorsActive],
  );
  const resource = useMemo(
    () => ({
      _tag: "attachment" as const,
      attachmentId: app.attachmentId,
      fileName: mcpAppFileName(app),
      mimeType: "text/html",
      disposition: "inline" as const,
      renderIntent: "mcp-app" as const,
    }),
    [app],
  );
  const asset = useAssetUrlState(props.environmentId, resource);

  const [uri, setUri] = useState<string | null>(null);
  if (uri === null && asset._tag === "Success") setUri(asset.url);
  const [loaded, setLoaded] = useState(false);
  const [navigatedAway, setNavigatedAway] = useState(false);

  const [generation, setGeneration] = useState(0);
  const [crashed, setCrashed] = useState(false);
  const restart = () => {
    if (generation > 0) {
      setCrashed(true);
      return;
    }
    setLoaded(false);
    setHeight(MCP_APP_INLINE_MAX_HEIGHT);

    if (asset._tag === "Success") setUri(asset.url);
    setGeneration(1);
  };

  const [secret] = useState(uuidv4);

  const setDocumentKey = (next: (value: number) => number) => {
    setLoaded(false);
    setHeight(MCP_APP_INLINE_MAX_HEIGHT);
    setNavigatedAway(false);
    if (asset._tag === "Success") setUri(asset.url);
    setDocumentKeyState(next);
  };

  const returnedFromFullscreen = useEffectEvent(() => {
    setDocumentKey((value) => value + 1);
    setPresentedFullscreen(false);
  });
  useEffect(() => {
    if (!presentedFullscreen) return;
    return navigation.addListener("focus", returnedFromFullscreen);
  }, [navigation, presentedFullscreen]);

  const detailAtom = orchestrationEnvironment.turnItem({
    environmentId: props.environmentId,
    input: { threadId: props.threadId, itemId: props.itemId, revision: props.revision },
  });
  const toolInfoResult = useEnvironmentQuery(
    mcpAppEnvironment.toolInfoQuery({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, itemId: props.itemId, name: app.tool },
    }),
  );
  const toolDefinition = toolInfoResult.data?.tool;
  const callTool = useAtomCommand(mcpAppEnvironment.callTool, { reportFailure: false });
  const toolInfo = useAtomCommand(mcpAppEnvironment.toolInfo, { reportFailure: false });
  const readResource = useAtomCommand(mcpAppEnvironment.readResource, { reportFailure: false });
  const updateModelContext = useAtomCommand(mcpAppEnvironment.updateModelContext, {
    reportFailure: false,
  });

  const conversation = useThreadShell(
    scopeThreadRef(props.environmentId, props.conversationThreadId),
  );
  const awaitingUser =
    conversation?.hasPendingApprovals === true || conversation?.hasPendingUserInput === true;
  const live = {
    awaitingUser,
    theme,
    asset,
    props,
    callTool,
    toolInfo,
    readResource,
    updateModelContext,
    insets,
    toolDefinition,
    navigation,
  };
  const latest = useRef(live);
  const [host, setHost] = useState<McpAppHost | null>(null);
  useEffect(() => {
    const previous = latest.current;
    latest.current = live;
    if (
      previous.theme !== live.theme ||
      previous.insets !== live.insets ||
      previous.toolDefinition !== live.toolDefinition ||
      previous.props.width !== live.props.width ||
      previous.props.height !== live.props.height ||
      previous.props.displayMode !== live.props.displayMode
    ) {
      host?.updateHostContext();
    }
  });
  useEffect(() => {
    if (host === null) return;
    return appAtomRegistry.subscribe(
      detailAtom,
      (result) => {
        if (!AsyncResult.isSuccess(result) || result.value.item.type !== "dynamic_tool") return;
        const item = result.value.item;
        const output = item.output as { readonly result?: unknown } | undefined;
        host.setToolCall({
          arguments: item.input,
          result: output?.result as McpAppCallToolResult | undefined,
        });
      },
      { immediate: true },
    );
  }, [host, detailAtom]);
  const userActive = useRef(false);

  const attachWebView = useCallback(
    (view: WebView<object> | null) => {
      if (view === null) return;

      const hostContext = (): McpAppHostContext => {
        const current = latest.current;
        const isFullscreen = current.props.displayMode === "fullscreen";
        return {
          theme: current.theme.appearance,
          styles: { variables: mcpAppStyleVariables(current.theme.variables) },
          displayMode: isFullscreen ? "fullscreen" : "inline",
          availableDisplayModes: ["inline", "fullscreen"],
          containerDimensions: isFullscreen
            ? {
                width: current.props.width,
                height: current.props.height ?? MCP_APP_INLINE_MAX_HEIGHT,
              }
            : { width: current.props.width, maxHeight: MCP_APP_INLINE_MAX_HEIGHT },
          platform: "mobile",
          locale: Intl.DateTimeFormat().resolvedOptions().locale,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          userAgent: `supaterm/${Constants.expoConfig?.version ?? "0.0.0"}`,
          deviceCapabilities: { touch: true, hover: false },

          safeAreaInsets: isFullscreen
            ? { top: 0, right: current.insets.right, bottom: 0, left: current.insets.left }
            : { top: 0, right: 0, bottom: 0, left: 0 },
          ...(current.toolDefinition === undefined
            ? {}
            : { toolInfo: { tool: current.toolDefinition } }),
        };
      };
      const requests = makeMcpAppRequests({
        target: () => latest.current.props,
        commands: () => latest.current,
        confirmTool: ({ name, title, arguments: args }) =>
          confirm(
            `Allow ${app.server} to run ${title ?? name}?`,
            JSON.stringify(args, null, 2),
            "Allow",
          ),
        confirmDownload: (files) =>
          confirm(
            `Save a file from ${app.server}?`,
            files.map((file) => file.name).join(", "),
            "Save",
          ),
        saveFile: async ({ name, mimeType, bytes }) => {
          const shared = await shareGeneratedAttachment({
            bytes,
            attachment: { name, mimeType },
            signal: new AbortController().signal,
          });
          if (!shared) throw new McpAppHostRefusal("Sharing is not available on this device.");
        },
      });
      const next = makeMcpAppHost({
        app,
        hostVersion: Constants.expoConfig?.version ?? "0.0.0",
        post: (message) =>
          view.injectJavaScript(
            `window.__supatermMcpAppReceive&&window.__supatermMcpAppReceive(${JSON.stringify(message)});true;`,
          ),
        hostContext,
        ...requests,
        openLink: async (url) => {
          if (!(await confirm(`Open a link from ${app.server}?`, url, "Open"))) {
            throw new McpAppHostRefusal("Declined by the user.");
          }
          if (!(await tryOpenExternalUrl(url, "mcp-app"))) {
            throw new McpAppHostRefusal("The link could not be opened.");
          }
        },
        sendMessage: async (text) => {
          if (!(await confirm(`Send this message from ${app.server}?`, text, "Send"))) {
            throw new McpAppHostRefusal("Declined by the user.");
          }

          await enqueueThreadOutboxMessage({
            environmentId: latest.current.props.environmentId,
            threadId: latest.current.props.conversationThreadId,
            messageId: MessageId.make(uuidv4()),
            commandId: CommandId.make(uuidv4()),
            text,
            attachments: [],
            dispatchMode: "queue",
            createdAt: new Date().toISOString(),
          });
        },
        requestDisplayMode: async (mode) => {
          const current = latest.current.props;

          if (
            mode === "fullscreen" &&
            (!userActive.current ||
              latest.current.awaitingUser ||
              !latest.current.navigation.isFocused())
          ) {
            return current.displayMode ?? "inline";
          }
          if (mode === "fullscreen" && current.displayMode !== "fullscreen") {
            await next.teardown();

            if (latest.current.awaitingUser || !latest.current.navigation.isFocused()) {
              setLoaded(false);
              setHeight(MCP_APP_INLINE_MAX_HEIGHT);
              setNavigatedAway(false);
              if (latest.current.asset._tag === "Success") setUri(latest.current.asset.url);
              setDocumentKeyState((value) => value + 1);
              return "inline";
            }
            setPresentedFullscreen(true);
            latest.current.navigation.navigate("ThreadMcpApp", {
              environmentId: String(current.environmentId),
              threadId: String(current.threadId),
              conversationThreadId: String(current.conversationThreadId),
              itemId: String(current.itemId),
              revision: current.revision,
            });
            return "fullscreen";
          }
          if (mode === "inline" && current.displayMode === "fullscreen") {
            await next.teardown();
            current.onExitFullscreen?.();
            return "inline";
          }
          return current.displayMode ?? "inline";
        },
        onRequestTeardown: () => {
          const current = latest.current.props;
          if (current.displayMode === "fullscreen") {
            void next.teardown().then(() => current.onExitFullscreen?.());
          } else {
            void next.teardown().then(() => setClosed(true));
          }
        },
        onSizeChanged: (size) => {
          if (latest.current.props.displayMode === "fullscreen") return;
          const nextHeight = mcpAppInlineHeight(size.height);
          if (nextHeight !== undefined) setHeight(nextHeight);
        },
      });
      setHost(next);
      return () => {
        void next.teardown();
        setHost((current) => (current === next ? null : current));
      };
    },
    [app],
  );

  const source = useMemo(
    () =>
      uri === null
        ? null
        : { html: outerDocument(uri, mcpAppAllowAttribute(app.permissions), secret) },
    [uri, app.permissions, secret],
  );

  if (presentedFullscreen) {
    return (
      <View
        style={{ height, marginBottom: ROW_BOTTOM_MARGIN }}
        className="items-center justify-center rounded-lg border border-border"
      >
        <Text className="text-sm text-foreground-muted">
          The {app.server} app is open full screen
        </Text>
      </View>
    );
  }

  if (closed) {
    return (
      <View
        style={{ height, marginBottom: ROW_BOTTOM_MARGIN }}
        className="items-center justify-center gap-2 rounded-lg border border-border"
      >
        <Text className="text-sm text-foreground-muted">The {app.server} app was closed</Text>
        <View className="items-center">
          <Button
            label="Show app"
            tone="secondary"
            onPress={() => {
              setDocumentKey((value) => value + 1);
              setClosed(false);
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={fullscreen ? { flex: 1 } : { height, marginBottom: ROW_BOTTOM_MARGIN }}>
      {navigatedAway ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-sm text-foreground-muted">
            The {app.server} app left its page and was stopped
          </Text>
        </View>
      ) : uri !== null && !crashed ? (
        <WebView<object>
          key={`${documentKey}:${generation}:${uri}`}
          ref={attachWebView}
          onContentProcessDidTerminate={restart}
          onRenderProcessGone={restart}
          source={source!}
          accessibilityLabel={`${app.server} app`}
          style={{ flex: 1, backgroundColor: "transparent" }}
          nestedScrollEnabled
          originWhitelist={["*"]}

          onShouldStartLoadWithRequest={(request) =>
            Platform.OS === "android" ||
            request.isTopFrame === false ||
            request.url === "about:blank"
          }
          setSupportMultipleWindows={false}
          onLoadEnd={() => setLoaded(true)}

          onError={() => setCrashed(true)}
          onHttpError={() => setCrashed(true)}
          onMessage={(event: WebViewMessageEvent) => {
            let envelope: unknown;
            try {
              envelope = JSON.parse(event.nativeEvent.data);
            } catch {
              return;
            }
            if (!Predicate.isObject(envelope) || envelope.secret !== secret) return;
            const message = envelope.message;
            if (Predicate.isObject(message) && message.supaterm === "navigated") {
              host?.dispose();
              setNavigatedAway(true);
              return;
            }
            userActive.current = envelope.active === true;
            host?.receive(message);
            userActive.current = false;
          }}
        />
      ) : asset._tag === "Failure" || crashed ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-sm text-foreground-muted">Unable to load the {app.server} app</Text>
        </View>
      ) : null}
      {uri !== null && !loaded && !crashed && !navigatedAway ? (
        <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
          <AppActivityIndicator />
        </View>
      ) : null}
    </View>
  );
}
