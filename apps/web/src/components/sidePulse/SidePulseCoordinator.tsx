import type { DesktopSidePulseBridge } from "@supaterm/contracts";
import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import { useEffect, useSyncExternalStore } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { getDocumentActivity, subscribeDocumentActivity } from "../../lib/documentActivity";
import { useQuietSidebarThreadShells } from "../../state/entities";
import { useConnectedEnvironmentIds } from "../../state/environments";
import { getSidePulseBridge } from "./sidePulseBridge";
import { selectSidePulseLedState } from "./sidePulseLedState";

/** Keeps a mounted SidePulse lit with the most urgent state across the user's threads. */
export function SidePulseCoordinator() {
  const enabled = useClientSettings((settings) => settings.sidePulse.enabled);
  const bridge = getSidePulseBridge();
  if (!enabled || bridge === null) return null;
  return <ActiveSidePulseCoordinator bridge={bridge} />;
}

function ActiveSidePulseCoordinator({ bridge }: { readonly bridge: DesktopSidePulseBridge }) {
  const threads = useQuietSidebarThreadShells();
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const routeThreadRef = useThreadRouteRef();
  const focused = useSyncExternalStore(subscribeDocumentActivity, getDocumentActivity).focused;
  const nowMinute = useNowMinute();
  const ledState = selectSidePulseLedState({
    threads,
    connectedEnvironmentIds,
    viewingThreadKey: focused && routeThreadRef !== null ? scopedThreadKey(routeThreadRef) : null,
    now: `${nowMinute}:00.000Z`,
  });
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- sends the aggregate agent state to the SidePulse LEDs over the desktop bridge
  useEffect(() => {
    void bridge.setLedState(ledState).catch(() => undefined);
  }, [bridge, ledState]);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- clears the LEDs when this window stops reporting thread state, such as when the app shell unmounts for the auth gate
  useEffect(
    () => () => {
      void bridge.setLedState(null).catch(() => undefined);
    },
    [bridge],
  );
  return null;
}
