import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, PreviewRuntime, PreviewSessionSnapshot } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import { environmentCatalog } from "~/connection/catalog";
import { isElectron } from "~/env";
import { isPreviewSupportedInRuntime } from "~/previewStateStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { readPreparedConnection } from "~/state/session";
import {
  readEnvironmentSupportsServerBrowser,
  useEnvironmentSupportsServerBrowser,
} from "~/state/entities";
import { environmentServerConfigsAtom } from "~/state/server";

import { tunnelsEnvironmentLoopback } from "./browserTargetResolver";

/** Whether this desktop loads the environment's localhost itself: it is local, or its tunnel is on. */
const desktopLoadsLoopbackAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const target = get(environmentCatalog.catalogValueAtom).entries.get(environmentId)?.target;
    if (!tunnelsEnvironmentLoopback(target)) return true;
    const config = get(environmentServerConfigsAtom).get(environmentId);
    return config !== undefined && config.settings.enablePreviewTunnel;
  }).pipe(Atom.withLabel(`preview:desktop-loads-loopback:${environmentId}`)),
);

export function previewRuntimeFor(environmentId: EnvironmentId): PreviewRuntime | undefined {
  if (!readEnvironmentSupportsServerBrowser(environmentId)) return undefined;
  if (readPreparedConnection(environmentId)?.connectionMethod === "relay") return "server";
  // Without its tunnel, another environment's tabs stream from it, as on the web.
  if (
    isPreviewSupportedInRuntime() &&
    environmentId !== appAtomRegistry.get(primaryEnvironmentIdAtom) &&
    appAtomRegistry.get(desktopLoadsLoopbackAtom(environmentId))
  ) {
    return undefined;
  }
  return "server";
}

export function alternatePreviewRuntime(
  environmentId: EnvironmentId,
  primaryEnvironmentId: EnvironmentId | null,
  serverBrowser: boolean,
  desktopLoadsLoopback: boolean,
  snapshot: Pick<PreviewSessionSnapshot, "runtime"> | null | undefined,
): PreviewRuntime | null {
  if (!snapshot || !serverBrowser || !isPreviewSupportedInRuntime()) return null;
  if (environmentId === primaryEnvironmentId) return null;
  if (readPreparedConnection(environmentId)?.connectionMethod === "relay") return null;
  if (snapshot.runtime === "server") return desktopLoadsLoopback ? "desktop" : null;
  return "server";
}

export function useDesktopLoadsLoopback(environmentId: EnvironmentId): boolean {
  return useAtomValue(desktopLoadsLoopbackAtom(environmentId));
}

export function isPreviewAvailableFor(environmentId: EnvironmentId): boolean {
  return isPreviewSupportedInRuntime() || readEnvironmentSupportsServerBrowser(environmentId);
}

export function usePreviewAvailable(environmentId: EnvironmentId | null): boolean {
  const serverBrowser = useEnvironmentSupportsServerBrowser(environmentId);
  return isPreviewSupportedInRuntime() || serverBrowser;
}

/**
 * Whether this client draws a server tab with its own `<webview>`. The desktop
 * app renders its own server tabs natively when their page is attached there;
 * headless-backed tabs use the server stream on every client.
 */
export function rendersServerTabNatively(
  environmentId: EnvironmentId,
  primaryEnvironmentId: EnvironmentId | null,
  snapshot: Pick<PreviewSessionSnapshot, "runtime" | "browserBacking"> | null | undefined,
): boolean {
  return (
    isElectron &&
    snapshot?.runtime === "server" &&
    snapshot.browserBacking !== "headless" &&
    primaryEnvironmentId !== null &&
    environmentId === primaryEnvironmentId
  );
}

export function useRendersServerTabNatively(
  environmentId: EnvironmentId,
  snapshot: Pick<PreviewSessionSnapshot, "runtime" | "browserBacking"> | null | undefined,
): boolean {
  return rendersServerTabNatively(environmentId, useAtomValue(primaryEnvironmentIdAtom), snapshot);
}
