import { runAtomCommand } from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentId } from "@supaterm/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { isAppActive, subscribeAppState } from "../lib/appState";
import { appAtomRegistry } from "../state/atom-registry";
import { environmentPresentations } from "../state/presentation";
import { serverEnvironment } from "../state/server";
import { environmentShell } from "../state/shell";
import { createWidgetRefresher, WIDGET_REFRESH_INTERVAL } from "./subscriptionUsageSnapshot";

const shellDoneAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const shell = get(environmentShell.stateValueAtom(environmentId));
    return shell.status === "live" || Option.isSome(shell.error);
  }),
);

const refreshableEnvironmentsAtom = Atom.make((get) =>
  [...get(environmentPresentations.presentationsAtom)].flatMap(([environmentId, presentation]) =>
    presentation.connection.phase === "connected" && get(shellDoneAtom(environmentId))
      ? [environmentId]
      : [],
  ),
);

/**
 * App-lifetime worker that keeps provider quotas fresh for the usage widget:
 * on resume, on every connection change, and on a fixed interval while active.
 * Each environment is refreshed at most once per interval.
 */
export function installSubscriptionUsageRefresh() {
  const refresh = createWidgetRefresher((environmentId: EnvironmentId) =>
    runAtomCommand(
      appAtomRegistry,
      serverEnvironment.refreshProviders,
      { environmentId, input: {} },
      { label: serverEnvironment.refreshProviders.label, reportFailure: false },
    ),
  );
  const update = () => {
    if (!isAppActive() || !appAtomRegistry.get(environmentCatalog.catalogValueAtom).isReady) return;
    void refresh(appAtomRegistry.get(refreshableEnvironmentsAtom), Date.now());
  };

  const unsubscribeCatalog = appAtomRegistry.subscribe(environmentCatalog.catalogValueAtom, update);
  const unsubscribeEnvironments = appAtomRegistry.subscribe(refreshableEnvironmentsAtom, update, {
    immediate: true,
  });
  const unsubscribeAppState = subscribeAppState(update);
  const timer = setInterval(update, WIDGET_REFRESH_INTERVAL);
  return () => {
    unsubscribeCatalog();
    unsubscribeEnvironments();
    unsubscribeAppState();
    clearInterval(timer);
  };
}
