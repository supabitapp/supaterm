import { useAtomValue } from "@effect/atom-react";
import type {
  CodexMicroAction,
  CodexMicroInputEvent,
  DesktopCodexMicroBridge,
  EnvironmentId,
} from "@supaterm/contracts";
import {
  isEnvironmentConnected,
  type EnvironmentPresentation,
} from "@supaterm/client-runtime/connection";
import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { useComposerHandleContext } from "../../composerHandleContext";
import { useClientSettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import {
  readVoiceInputActivity,
  subscribeVoiceInputActivity,
} from "../../voice/voiceInputActivity";
import { useSidebarThreadShells } from "../../state/entities";
import { useThreadJumpTargets } from "../sidebar/threadJumpTargets";
import { environmentPresentations } from "../../state/presentation";
import { buildThreadRouteParams } from "../../threadRoutes";
import { resolveCodexMicroEncoderAction, resolveCodexMicroSlotAction } from "./codexMicroCatalog";
import {
  buildCodexMicroLightingModel,
  buildCodexMicroSlotViews,
  selectCodexMicroSlotBindings,
} from "./codexMicroSlots";
import { runCommand } from "../../shortcuts/dispatcher";
import { getCodexMicroBridge } from "./codexMicroBridge";
import { publishCodexMicroInput, publishCodexMicroSlots } from "./codexMicroStore";

function subscribeWindowFocus(listener: () => void) {
  window.addEventListener("focus", listener);
  window.addEventListener("blur", listener);
  return () => {
    window.removeEventListener("focus", listener);
    window.removeEventListener("blur", listener);
  };
}

function readWindowFocus() {
  return document.hasFocus();
}

function selectConnectedEnvironmentIds(
  presentations: ReadonlyMap<EnvironmentId, EnvironmentPresentation>,
): ReadonlySet<EnvironmentId> {
  const connected = new Set<EnvironmentId>();
  for (const [environmentId, presentation] of presentations) {
    if (isEnvironmentConnected(presentation)) connected.add(environmentId);
  }
  return connected;
}

/** Keeps the keyboard's agent keys lit for the threads they follow and runs its key presses. */
export function CodexMicroCoordinator() {
  const enabled = useClientSettings((settings) => settings.codexMicro.enabled);
  const bridge = getCodexMicroBridge();
  if (!enabled || bridge === null) return null;
  return <ActiveCodexMicroCoordinator bridge={bridge} />;
}

function ActiveCodexMicroCoordinator({ bridge }: { readonly bridge: DesktopCodexMicroBridge }) {
  const router = useRouter();
  const composerHandleRef = useComposerHandleContext();
  const settings = useClientSettings((current) => ({
    source: current.codexMicro.agentSource,
    customAgentKeys: current.codexMicro.customAgentKeys,
    layout: current.codexMicro.layout,
  }));
  const threads = useSidebarThreadShells();
  const jumpTargets = useThreadJumpTargets();
  const connectedEnvironmentIds = useAtomValue(
    environmentPresentations.presentationsAtom,
    selectConnectedEnvironmentIds,
  );
  const routeThreadRef = useThreadRouteRef();
  const routeThreadKey = routeThreadRef === null ? null : scopedThreadKey(routeThreadRef);
  const windowFocused = useSyncExternalStore(subscribeWindowFocus, readWindowFocus);
  const nowMinute = useNowMinute();
  const voiceActivity = useSyncExternalStore(subscribeVoiceInputActivity, readVoiceInputActivity);

  const views = buildCodexMicroSlotViews({
    bindings: selectCodexMicroSlotBindings({
      source: settings.source,
      threads,
      jumpTargets,
      customAgentKeys: settings.customAgentKeys,
      now: `${nowMinute}:00.000Z`,
    }),
    routeThreadKey,
    windowFocused,
    connectedEnvironmentIds,
  });
  const sentViewsKeyRef = useRef<string | null>(null);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- sends slot bindings and voice activity to the keyboard's lighting over the desktop bridge and publishes slot views
  useEffect(() => {
    const key = JSON.stringify({ views, voiceActivity });
    if (key === sentViewsKeyRef.current) return;
    sentViewsKeyRef.current = key;
    publishCodexMicroSlots(views);
    void bridge
      .setLighting(buildCodexMicroLightingModel(views, voiceActivity))
      .catch(() => undefined);
  }, [bridge, views, voiceActivity]);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- releases hardware lighting and published slots when the coordinator unmounts
  useEffect(
    () => () => {
      // A remount (StrictMode, or an Activity boundary) must publish again after this clears.
      sentViewsKeyRef.current = null;
      publishCodexMicroSlots([]);
      void bridge.setLighting(buildCodexMicroLightingModel([], "idle")).catch(() => undefined);
    },
    [bridge],
  );

  const runAction = (action: CodexMicroAction | null) => {
    if (action === null) return;
    switch (action.type) {
      case "command":
        runCommand(action.command, "device");
        return;
      case "composer-text":
        composerHandleRef?.current?.insertTextAtEnd(action.text, { ensureLeadingBoundary: true });
        return;
      case "open-settings":
        void router.navigate({ to: "/settings/general" });
        return;
      case "open-codex-micro-settings":
        void router.navigate({ to: "/settings/codex-micro" });
        return;
    }
  };

  const handleInput = useStableCallback((event: CodexMicroInputEvent) => {
    publishCodexMicroInput(event);
    switch (event.type) {
      case "agent-key": {
        if (event.thread !== null) {
          void router.navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(event.thread),
          });
          return;
        }
        runAction(views.find((view) => view.key === event.key)?.action ?? null);
        return;
      }
      case "key":
        if (event.phase === "press") {
          runAction(resolveCodexMicroSlotAction(settings.layout.slots[event.slot]));
        }
        return;
      case "joystick":
        runAction(settings.layout.analogStick[event.direction]);
        return;
      case "encoder":
        runAction(resolveCodexMicroEncoderAction(settings.layout, event.input));
        return;
    }
  });

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- subscribes to Codex Micro keyboard input through the desktop bridge
  useEffect(() => bridge.onInput(handleInput), [bridge, handleInput]);

  return null;
}
