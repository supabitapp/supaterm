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

import { dispatchAppCommand } from "../../appCommandBus";
import { useComposerHandleContext } from "../../composerHandleContext";
import { useClientSettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { useSidebarThreadShells } from "../../state/entities";
import { environmentPresentations } from "../../state/presentation";
import { buildThreadRouteParams } from "../../threadRoutes";
import { toastManager } from "../ui/toast";
import { resolveCodexMicroEncoderAction, resolveCodexMicroSlotAction } from "./codexMicroCatalog";
import {
  buildCodexMicroLightingModel,
  buildCodexMicroSlotViews,
  selectCodexMicroSlotBindings,
} from "./codexMicroSlots";
import {
  getCodexMicroBridge,
  publishCodexMicroInput,
  publishCodexMicroSlots,
} from "./codexMicroStore";

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
  const enabled = useClientSettings((settings) => settings.codexMicroEnabled);
  const bridge = getCodexMicroBridge();
  if (!enabled || bridge === null) return null;
  return <ActiveCodexMicroCoordinator bridge={bridge} />;
}

function ActiveCodexMicroCoordinator({ bridge }: { readonly bridge: DesktopCodexMicroBridge }) {
  const router = useRouter();
  const composerHandleRef = useComposerHandleContext();
  const settings = useClientSettings((current) => ({
    source: current.codexMicroAgentSource,
    customAgentKeys: current.codexMicroCustomAgentKeys,
    layout: current.codexMicroLayout,
  }));
  const threads = useSidebarThreadShells();
  const connectedEnvironmentIds = useAtomValue(
    environmentPresentations.presentationsAtom,
    selectConnectedEnvironmentIds,
  );
  const routeThreadRef = useThreadRouteRef();
  const routeThreadKey = routeThreadRef === null ? null : scopedThreadKey(routeThreadRef);
  const windowFocused = useSyncExternalStore(subscribeWindowFocus, readWindowFocus);
  const nowMinute = useNowMinute();

  const views = buildCodexMicroSlotViews({
    bindings: selectCodexMicroSlotBindings({
      source: settings.source,
      threads,
      customAgentKeys: settings.customAgentKeys,
      now: `${nowMinute}:00.000Z`,
    }),
    routeThreadKey,
    windowFocused,
    connectedEnvironmentIds,
  });
  const sentViewsKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = JSON.stringify(views);
    if (key === sentViewsKeyRef.current) return;
    sentViewsKeyRef.current = key;
    publishCodexMicroSlots(views);
    void bridge.setLighting(buildCodexMicroLightingModel(views, "idle")).catch(() => undefined);
  }, [bridge, views]);
  useEffect(() => () => publishCodexMicroSlots([]), []);

  const runAction = (action: CodexMicroAction | null) => {
    if (action === null) return;
    switch (action.type) {
      case "command":
        dispatchAppCommand(action.command);
        return;
      case "composer-text":
        composerHandleRef?.current?.insertTextAtEnd(action.text, { ensureLeadingBoundary: true });
        return;
      case "push-to-talk":
        toastManager.add({
          id: "codex-micro-dictation",
          type: "info",
          title: "Dictation isn't available on desktop yet",
          timeout: 2500,
        });
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

  useEffect(() => bridge.onInput(handleInput), [bridge, handleInput]);

  return null;
}
