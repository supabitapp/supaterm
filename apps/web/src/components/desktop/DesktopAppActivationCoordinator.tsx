import type { DesktopAppActivationRequest } from "@supaterm/contracts";
import { useEffect, useEffectEvent, useState } from "react";

import {
  createDesktopAppActivationRunner,
  handleDesktopAppConnectionRequest,
} from "../../desktopAppActivation";
import { connectPairing } from "../../connection/onboarding";
import { useOpenLocalWorkspace } from "../../hooks/useOpenLocalWorkspace";
import { useAtomCommand } from "../../state/use-atom-command";

export function DesktopAppActivationCoordinator() {
  const openLocalWorkspace = useOpenLocalWorkspace();
  const registerPairing = useAtomCommand(connectPairing, {
    reportFailure: false,
    reportDefect: false,
  });
  const [runRequest] = useState(createDesktopAppActivationRunner);
  const activation = window.desktopBridge?.appActivation;
  const ready = activation !== undefined && openLocalWorkspace.ready;

  const processRequest = useEffectEvent(async (request: DesktopAppActivationRequest) =>
    request.type === "add-connection"
      ? handleDesktopAppConnectionRequest(request, registerPairing)
      : openLocalWorkspace.open(request),
  );

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- subscribes to desktop activation requests over the bridge and marks the renderer ready
  useEffect(() => {
    if (!ready || activation === undefined) return;

    let subscribed = true;
    const unsubscribe = activation.onRequest((request) => {
      void runRequest(request, processRequest, (response) => activation.complete(response)).catch(
        () => undefined,
      );
    });
    // Skip readiness if React runs cleanup before this subscription can receive requests.
    queueMicrotask(() => {
      if (subscribed) void activation.setReady(true).catch(() => undefined);
    });
    return () => {
      subscribed = false;
      void activation.setReady(false).catch(() => undefined);
      unsubscribe();
    };
  }, [activation, ready, runRequest]);

  return null;
}
