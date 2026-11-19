import type { ConnectionTarget } from "@supaterm/client-runtime/connection";
import {
  REMOTE_CAPABLE_EDITOR_IDS,
  type EditorId,
  type EnvironmentId,
  type RemoteOpenTarget,
} from "@supaterm/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import { useAtomValue } from "@effect/atom-react";

import { browserClientOs, type BrowserIdentity } from "~/connection/clientMetadata";
import { isDesktopLocalConnectionTarget } from "~/connection/desktopLocal";
import { isLoopbackHostname } from "~/environments/primary/target";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { environmentPresentations } from "~/state/presentation";
import { hostEnvironmentIdAtom } from "~/state/primaryEnvironment";

export interface RemoteOpenHost {
  readonly kind: "ssh-alias" | RemoteOpenTarget["kind"];
  readonly host: string;
  readonly username?: string;
}

export type RemoteOpenState =
  | { readonly mode: "local-exec" }
  | { readonly mode: "remote-links"; readonly host: RemoteOpenHost }
  | { readonly mode: "remote-unavailable" };

export type RemoteOpenMode = RemoteOpenState["mode"];

export interface RemoteOpenResolution {
  readonly state: RemoteOpenState;
  readonly isResolved: boolean;
}

const LOCAL_EXEC: RemoteOpenState = { mode: "local-exec" };
const REMOTE_UNAVAILABLE: RemoteOpenState = { mode: "remote-unavailable" };
const UNRESOLVED_REMOTE_OPEN: RemoteOpenResolution = {
  state: LOCAL_EXEC,
  isResolved: false,
};

function parseHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function resolveRemoteOpenState(input: {
  readonly target: ConnectionTarget | null;
  readonly sshTarget: { readonly alias: string; readonly username: string | null } | null;
  readonly remoteOpenTargets: ReadonlyArray<RemoteOpenTarget> | undefined;
  readonly isDesktopRenderer: boolean;
  readonly hostEnvironmentId: string | null;
}) {
  const { target } = input;
  if (target === null || target.environmentId === input.hostEnvironmentId) {
    return LOCAL_EXEC satisfies RemoteOpenState;
  }
  if (target._tag === "PrimaryConnectionTarget") {
    if (input.isDesktopRenderer) {
      return LOCAL_EXEC satisfies RemoteOpenState;
    }
    const hostname = parseHostname(target.httpBaseUrl);
    if (hostname !== null && isLoopbackHostname(hostname)) {
      return LOCAL_EXEC satisfies RemoteOpenState;
    }
  } else if (isDesktopLocalConnectionTarget(target)) {
    return LOCAL_EXEC satisfies RemoteOpenState;
  }

  if (input.sshTarget !== null && input.sshTarget.alias.length > 0) {
    const { alias } = input.sshTarget;
    const userSeparator = alias.lastIndexOf("@");
    const host = userSeparator === -1 ? alias : alias.slice(userSeparator + 1);
    const username =
      input.sshTarget.username?.trim() ||
      (userSeparator === -1 ? null : alias.slice(0, userSeparator));
    return {
      mode: "remote-links",
      host: {
        kind: "ssh-alias",
        host,
        ...(username === null ? {} : { username }),
      },
    } satisfies RemoteOpenState;
  }
  const advertised = input.remoteOpenTargets?.[0];
  if (advertised !== undefined) {
    return { mode: "remote-links", host: advertised } satisfies RemoteOpenState;
  }
  return REMOTE_UNAVAILABLE satisfies RemoteOpenState;
}

function remoteOpenStatesEqual(previous: RemoteOpenState, next: RemoteOpenState) {
  if (previous.mode !== next.mode) return false;
  if (previous.mode !== "remote-links" || next.mode !== "remote-links") return true;
  return (
    previous.host.kind === next.host.kind &&
    previous.host.host === next.host.host &&
    previous.host.username === next.host.username
  );
}

const remoteOpenResolutionAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const presentation = get(environmentPresentations.presentationAtom(environmentId));
    const entry = presentation?.entry ?? null;
    if (entry === null) {
      return UNRESOLVED_REMOTE_OPEN;
    }
    const profile = Option.getOrNull(entry.profile);
    const next: RemoteOpenResolution = {
      state: resolveRemoteOpenState({
        target: entry.target,
        sshTarget:
          profile !== null && profile._tag === "SshConnectionProfile" ? profile.target : null,
        remoteOpenTargets: presentation?.serverConfig?.remoteOpenTargets,
        isDesktopRenderer: window.desktopBridge !== undefined,
        hostEnvironmentId: get(hostEnvironmentIdAtom),
      }),
      isResolved: true,
    };
    const previous = Option.getOrNull(get.self<RemoteOpenResolution>());
    return previous !== null &&
      previous.isResolved &&
      remoteOpenStatesEqual(previous.state, next.state)
      ? previous
      : next;
  }).pipe(Atom.withLabel(`remote-open-resolution:${environmentId}`)),
);

const UNRESOLVED_REMOTE_OPEN_ATOM = Atom.make(UNRESOLVED_REMOTE_OPEN);

export function useRemoteOpenResolution(environmentId: EnvironmentId | null) {
  return useAtomValue(
    environmentId === null ? UNRESOLVED_REMOTE_OPEN_ATOM : remoteOpenResolutionAtom(environmentId),
  );
}

export function useRemoteOpenState(environmentId: EnvironmentId | null) {
  return useRemoteOpenResolution(environmentId).state;
}

const REMOTE_FALLBACK_EDITORS: ReadonlyArray<EditorId> = ["vscode"];

export function remoteFallbackEditors(identity: BrowserIdentity) {
  const os = browserClientOs(identity);
  return os === "iOS" || os === "Android" ? [] : REMOTE_FALLBACK_EDITORS;
}

const remoteCapableEditorsAtom = Atom.make((get) => {
  const probe = window.desktopBridge?.probeRemoteEditors;
  probe?.().then(
    (ids) => {
      const remoteCapable = ids.filter((id) => REMOTE_CAPABLE_EDITOR_IDS.includes(id));
      if (remoteCapable.length > 0) get.setSelf(remoteCapable);
    },
    () => undefined,
  );
  return remoteFallbackEditors(navigator);
}).pipe(Atom.keepAlive, Atom.withLabel("remote-capable-editors"));

export function useRemoteCapableEditors() {
  return useAtomValue(remoteCapableEditorsAtom);
}

/** Resolves false when the desktop refuses the URL, including unsupported editor schemes. */
export async function openRemoteEditorUrl(url: string) {
  const bridge = window.desktopBridge;
  if (bridge !== undefined) {
    try {
      return await bridge.openExternal(url);
    } catch {
      return false;
    }
  }
  window.location.assign(url);
  return true;
}

const REMOTE_OPEN_HINT_KEY = "supaterm:remote-open-hint-seen";

export function useRemoteOpenHint(): readonly [seen: boolean, markSeen: () => void];
export function useRemoteOpenHint() {
  const [seen, setSeen] = useLocalStorage(REMOTE_OPEN_HINT_KEY, false, Schema.Boolean);
  return [seen, () => setSeen(true)] as const satisfies readonly [
    seen: boolean,
    markSeen: () => void,
  ];
}
