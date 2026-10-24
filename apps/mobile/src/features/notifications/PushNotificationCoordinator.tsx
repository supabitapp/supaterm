import { useAtomValue } from "@effect/atom-react";
import { useLinkTo } from "@react-navigation/native";
import type { EnvironmentId } from "@supaterm/contracts";
import * as Notifications from "expo-notifications";
import { useEffect, useEffectEvent, useRef } from "react";
import { AppState } from "react-native";

import { environmentCatalog } from "../../connection/catalog";
import { workspaceConnections } from "../../state/workspace";
import { isPushThreadVisible } from "./notificationPresence";
import {
  type PushRoute,
  pushChallengeFromPayload,
  pushRouteFromData,
  pushRouteHref,
} from "./notificationPayload";
import { pushChallenges, pushRegistrar } from "./pushRuntime";

const HIDDEN: Notifications.NotificationBehavior = {
  shouldShowBanner: false,
  shouldShowList: false,
  shouldPlaySound: false,
  shouldSetBadge: false,
};

const SHOWN: Notifications.NotificationBehavior = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: true,
  shouldSetBadge: false,
};

function notificationChallenge(notification: Notifications.Notification) {
  const trigger = notification.request.trigger;
  return trigger !== null && typeof trigger === "object" && "payload" in trigger
    ? pushChallengeFromPayload(trigger.payload)
    : null;
}

/** `[environmentId, connected]` pairs as one string, so unrelated presentation changes do not resync. */
function connectionKey(
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly connectionState: string;
  }>,
): string {
  return JSON.stringify(
    environments
      .map((environment) => [
        environment.environmentId,
        environment.connectionState === "connected",
      ])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
}

function parseConnectionKey(key: string) {
  const pairs = JSON.parse(key) as ReadonlyArray<readonly [EnvironmentId, boolean]>;
  return {
    saved: new Set(pairs.map(([environmentId]) => environmentId)),
    connected: new Set(
      pairs.flatMap(([environmentId, connected]) => (connected ? [environmentId] : [])),
    ),
  };
}

async function consumePresentedChallenges(): Promise<void> {
  for (const notification of await Notifications.getPresentedNotificationsAsync()) {
    const challenge = notificationChallenge(notification);
    if (challenge === null) continue;
    pushChallenges.deliver(challenge);
    await Notifications.dismissNotificationAsync(notification.request.identifier);
  }
}

export function PushNotificationCoordinator() {
  return pushRegistrar() === null ? null : <IosPushNotificationCoordinator />;
}

function IosPushNotificationCoordinator() {
  const linkTo = useLinkTo();
  const catalogReady = useAtomValue(
    environmentCatalog.catalogValueAtom,
    (catalog) => catalog.isReady,
  );
  const key = useAtomValue(workspaceConnections.environmentsAtom, connectionKey);
  const syncKey = catalogReady ? key : null;
  const environmentsRef = useRef(parseConnectionKey(key));
  const handledResponses = useRef(new Set<string>());
  const pendingRoute = useRef<PushRoute | null>(null);

  const sync = useEffectEvent(() => {
    if (!catalogReady) return;
    void pushRegistrar()
      ?.sync(environmentsRef.current)
      .catch(() => undefined);
  });

  // Taps route from the decrypted IDs alone, so they work while the host is still connecting.
  // An environment this device no longer knows is ignored rather than paired.
  const openPendingRoute = useEffectEvent(() => {
    const route = pendingRoute.current;
    if (route === null || !catalogReady) return;
    pendingRoute.current = null;
    if (environmentsRef.current.saved.has(route.environmentId as EnvironmentId)) {
      linkTo(pushRouteHref(route));
    }
  });

  const handleResponse = useEffectEvent((response: Notifications.NotificationResponse) => {
    const { identifier } = response.notification.request;
    if (handledResponses.current.has(identifier)) return;
    handledResponses.current.add(identifier);
    Notifications.clearLastNotificationResponse();
    const challenge = notificationChallenge(response.notification);
    if (challenge !== null) {
      pushChallenges.deliver(challenge);
      return;
    }
    const route = pushRouteFromData(response.notification.request.content.data);
    if (route === null) return;
    pendingRoute.current = route;
    openPendingRoute();
  });

  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const challenge = notificationChallenge(notification);
        if (challenge !== null) {
          pushChallenges.deliver(challenge);
          return HIDDEN;
        }
        const route = pushRouteFromData(notification.request.content.data);
        return route !== null && isPushThreadVisible(route.environmentId, route.threadId)
          ? HIDDEN
          : SHOWN;
      },
    });
    const launch = Notifications.getLastNotificationResponse();
    if (launch !== null) handleResponse(launch);
    const responses = Notifications.addNotificationResponseReceivedListener(handleResponse);
    // Reading the token re-registers with APNs, which emits this event again with the same
    // token; syncing on every event would loop.
    let lastToken: string | null = null;
    const tokens = Notifications.addPushTokenListener((token) => {
      if (token.data === lastToken) return;
      const first = lastToken === null;
      lastToken = token.data;
      if (!first) sync();
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void consumePresentedChallenges().catch(() => undefined);
      sync();
    });
    void consumePresentedChallenges().catch(() => undefined);
    return () => {
      responses.remove();
      tokens.remove();
      appState.remove();
      Notifications.setNotificationHandler(null);
    };
  }, []);

  useEffect(() => {
    if (syncKey === null) return;
    environmentsRef.current = parseConnectionKey(syncKey);
    sync();
    openPendingRoute();
  }, [syncKey]);

  return null;
}
